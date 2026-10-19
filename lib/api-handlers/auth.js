import {requestClientKey,mutationOriginAllowed,sessionCookieOptions} from '../request-security.js';
import {acceptInvitation} from '../invitations.js';
import {findEndpoint} from '../api-audit-policy.js';
import {bootstrapAuthorized} from '../bootstrap.js';
import {postgresConfigured} from '../postgres.js';
import {runScheduledAutomation,automationRunAuthorized,automationHealth} from '../automation-runner.js';
import {requestPasswordReset,completePasswordReset,configuredEmailDelivery} from '../password-recovery.js';
import {loginAllowed,loginFailure,loginSuccess} from '../auth-security.js';
import {cookies} from 'next/headers';
import {randomBytes,randomUUID} from 'node:crypto';
import {hashPassword,verifyPassword,audit as recordAudit} from '../db.js';
import {demoDatabase,demoEnabled,demoSession,restoreDemoSession} from '../demo.js';
import {response} from './response.js';
export async function authenticate(req,params,mainDb){
const path = (await params).path.join('/');
const method = req.method;
const endpoint = findEndpoint(method, path);
if (!endpoint) return response({error:'غير متاح'},404);
if(path==='automation/health'){
 if(!automationRunAuthorized(req.headers.get('authorization'),process.env.CLINIC_AUTOMATION_SECRET))return response({error:'غير مصرح'},403);
 return response(await automationHealth(mainDb,req.headers.get('authorization'),process.env.CLINIC_AUTOMATION_SECRET));
}
if (path === 'automation/run') {
      const authorization = req.headers.get('authorization'),
        secret = process.env.CLINIC_AUTOMATION_SECRET;
      if (method !== 'POST' || !automationRunAuthorized(authorization, secret)) return response({
        error: 'غير مصرح'
      }, 403);
      try {
        return response(await runScheduledAutomation(mainDb, authorization, secret, mainDb.dialect === 'postgres' || process.env.CLINIC_DEMO_ONLY !== '1' && process.env.VERCEL !== '1' && process.env.CLINIC_DB !== ':memory:'));
      } catch (e) {
        return response({
          error: e.message
        }, 503);
      }
    }
if ((process.env.CLINIC_DEMO_ONLY === '1'||process.env.VERCEL==='1'&&!postgresConfigured()) && ['setup', 'login'].includes(path)) {
      if (path === 'setup' && method === 'GET') return response({
        needed: false
      });
      return response({
        error: 'النسخة المنشورة للديمو فقط؛ استخدم استعراض الديمو بدون تسجيل'
      }, 403);
    }
if (method === 'POST' && !mutationOriginAllowed(req,process.env.NODE_ENV==='production'?process.env.CLINIC_BASE_URL:undefined)) return response({
      error: 'مصدر الطلب غير مسموح'
    }, 403);
const body = method === 'POST' ? await req.json() : {};
const jar = await cookies();
const clientKey=requestClientKey(req.headers);
if (path === 'demo' && method === 'POST') {
      if (!demoEnabled()) return response({
        error: 'الديمو غير متاح في هذه البيئة'
      }, 404);
      const result = await demoSession(body.role || 'owner');
      if (!result) return response({
        error: 'دور العرض غير متاح'
      }, 400);
      jar.delete('clinic_session');
      jar.set('clinic_demo', result.token, sessionCookieOptions(3600));
      return response({
        ok: true,
        demo: true
      });
    }
const demoToken = jar.get('clinic_demo')?.value;
const isDemo = !['login','setup'].includes(path) && await restoreDemoSession(demoToken);
if (process.env.CLINIC_DEMO_ONLY === '1' && !isDemo) return response({
      error: 'افتح الديمو لبدء جلسة العرض'
    }, 401);
if (demoToken && !isDemo && !['login','setup'].includes(path)) { jar.delete('clinic_demo'); return response({error:'انتهى العرض التجريبي أو تم إيقافه؛ سجّل الدخول من جديد'},401); }
const db = isDemo ? demoDatabase : mainDb;
const audit = async (...args) => await recordAudit(...args, db);
const sessionToken = isDemo ? demoToken : jar.get('clinic_session')?.value;
if (path === 'setup' && method === 'GET') return response({
      needed: !(await db.prepare('SELECT id FROM users LIMIT 1').get()),tokenRequired:!isDemo&&(process.env.NODE_ENV==='production'||mainDb.dialect==='postgres'&&process.env.VERCEL==='1')
    });
if (path === 'setup' && method === 'POST') {
      if(!isDemo&&(process.env.NODE_ENV==='production'||mainDb.dialect==='postgres'&&process.env.VERCEL==='1')&&!bootstrapAuthorized(body.setupToken,process.env.CLINIC_SETUP_TOKEN))return response({error:'رمز إعداد المالك مطلوب؛ اطلبه من مسؤول النشر'},403);
      if (await db.prepare('SELECT id FROM users LIMIT 1').get()) return response({
        error: 'تم إعداد النظام بالفعل'
      }, 409);
      if (!body.name || !body.email || !body.password || body.password.length < 12) return response({
        error: 'أدخل الاسم والبريد وكلمة مرور 12 حرفًا على الأقل'
      }, 400);
      const id = randomUUID();
      await db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(id, body.name, body.email.toLowerCase(), hashPassword(body.password), 'owner');
      await audit(id, 'setup', 'users', null, {
        id,
        name: body.name
      });
      return response({
        ok: true
      });
    }
if (path === 'password/request-reset' && method === 'POST') {
      if (isDemo) return response({
        error: 'استعادة البريد غير مفعلة في الديمو'
      }, 503);
      const deliver = configuredEmailDelivery();
      if (!deliver) return response({
        error: 'خدمة البريد غير مفعلة؛ اطلب إعادة التعيين من مالك المجمع'
      }, 503);
      try {
        const email = String(body.email || '').trim().toLowerCase().slice(0, 254),
          key = 'reset:' + email;
        if (!(await loginAllowed(db, key))||!(await loginAllowed(db,'ip:reset:'+clientKey))) return response({
          error: 'طلبات كثيرة؛ حاول بعد ربع ساعة'
        }, 429);
        await loginFailure(db, key);
        await loginFailure(db,'ip:reset:'+clientKey);
        await requestPasswordReset(db, email, deliver);
        return response({
          ok: true
        });
      } catch (e) {
        return response({
          error: e.message
        }, 400);
      }
    }
if(path==='password/accept-invitation'&&method==='POST'){
 if(isDemo)return response({error:'غير متاح'},403);
 try{return response(await acceptInvitation(db,body.token,body.password));}catch{return response({error:'الرابط انتهى أو استُخدم، أو كلمة المرور غير صحيحة'},400);}
}
if (path === 'password/reset' && method === 'POST') {
      if (isDemo) return response({
        error: 'استعادة البريد غير مفعلة في الديمو'
      }, 503);
      try {
        const result = await completePasswordReset(db, body.token, body.password, hashPassword);
        await audit(result.user_id, 'users.password.reset', result.user_id, null, {
          sessionsRevoked: true
        });
        jar.delete('clinic_session');
        return response({
          ok: true
        });
      } catch (e) {
        return response({
          error: e.message
        }, 400);
      }
    }
if (path === 'login' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
      if (!(await loginAllowed(db, email))||!(await loginAllowed(db,'ip:login:'+clientKey))) return response({
        error: 'محاولات الدخول كثيرة؛ حاول بعد ربع ساعة'
      }, 429);
      const u = await db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
      if (!u || !verifyPassword(String(body.password), u.password)) {
        await loginFailure(db, email);
        await loginFailure(db,'ip:login:'+clientKey);
        return response({
          error: 'بيانات الدخول غير صحيحة'
        }, 401);
      }
      await loginSuccess(db, email);
      const token = randomBytes(32).toString('hex');
      await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, u.id, Date.now() + 28800000);
      jar.delete('clinic_demo');
      jar.set('clinic_session', token, sessionCookieOptions(28800));
      return response({
        ok: true
      });
    }
const user = await db.prepare('SELECT u.id,u.name,u.email,u.role,u.active,r.permissions FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role WHERE s.token=? AND s.expires>?').get(sessionToken || '', Date.now());
if (!user?.active) return response({
      error: 'سجّل الدخول أولًا'
    }, 401);
const permissions = JSON.parse(user.permissions);
return {path,method,endpoint,body,jar,isDemo,db,audit,sessionToken,user,permissions};
}
