import {listIncidents,saveIncident,incidentPermission} from '../../../lib/quality-incidents.js';
import {saveServicePrice,listServicePrices,priceForRecord,snapshotPrice,requestBelowCost,decideBelowCost,setAdjustmentPolicy,requestAdjustment,decideAdjustment,issueMaintenancePart,linkLeadVisit,funnelMetrics,filteredReport} from '../../../lib/readiness-workflows.js';
import { checkProductionEnvironment } from '../../../scripts/check-env.mjs';
import { patientProfile, linkPatientTask } from '../../../lib/patient-profile.js';
import {bootstrapAuthorized} from '../../../lib/bootstrap.js';
import {postgresConfigured,withPostgres} from '../../../lib/postgres.js';
import { asyncMap, asyncFilter } from "../../../lib/async-collections.js";
import { runScheduledAutomation, automationRunAuthorized } from '../../../lib/automation-runner.js';
import { requestPasswordReset, completePasswordReset, configuredEmailDelivery } from '../../../lib/password-recovery.js';
import { correctFinancialRecord } from '../../../lib/financial-corrections.js';
import { returnPackageSession } from '../../../lib/package-returns.js';
import { roleScopes, scopeRows, assignedScope, patientVisible, saveRoleScopes } from '../../../lib/data-scopes.js';
import { financeRequest, correctCashClosure } from '../../../lib/finance-workflow.js';
import { loginAllowed, loginFailure, loginSuccess, revokeSessions } from '../../../lib/auth-security.js';
import { documentPaths, documentTargets, listDocuments, saveDocument } from '../../../lib/documents.js';
import { followupProgram } from '../../../lib/clinical-programs.js';
import { exportRows, toCsv } from '../../../lib/exports.js';
import { toPdf, toXlsx } from '../../../lib/report-files.js';
import { rescheduleAppointment } from '../../../lib/appointment-workflow.js';
import { tickAutomation, saveAutomation } from '../../../lib/automation.js';
import { extraPaths, listExtras, saveExtras } from '../../../lib/purchasing-extras.js';
import { listPurchasing, savePurchasing } from '../../../lib/purchasing.js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes, randomUUID } from 'node:crypto';
import { db as localDb, hashPassword, verifyPassword, audit as recordAudit } from '../../../lib/db.js';
import { demoDatabase, demoEnabled, demoSession, restoreDemoSession } from '../../../lib/demo.js';
import { operationPages } from '../../../lib/operations-config.js';
import { recordPayment, discountInvoice, enforceFinanceLimit } from '../../../lib/finance.js';
import { approveClinicalSession } from '../../../lib/session-resources.js';
import { validateClinical, saveClinicalDetails } from '../../../lib/clinical.js';
import { linkPackage, consumePackage } from '../../../lib/packages.js';
import { transaction } from '../../../lib/operations.js';
import { listOperations, saveOperation } from '../../../lib/operations.js';
import { allowed, validPermissions } from '../../../lib/permissions.js';
export const runtime = 'nodejs';
const response = (x, status = 200) => NextResponse.json(x, {
  status,
  headers: {'Cache-Control':'private, no-store', Vary:'Cookie'}
});
async function handle(req, {
  params
}, mainDb = localDb) {
  try {
    const path = (await params).path.join('/');
    const method = req.method;
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
    if (method === 'POST' && (!req.headers.get('origin') || new URL(req.headers.get('origin')).host !== req.headers.get('host'))) return response({
      error: 'مصدر الطلب غير مسموح'
    }, 403);
    const body = method === 'POST' ? await req.json() : {};
    const jar = await cookies();
    if (path === 'demo' && method === 'POST') {
      if (!demoEnabled()) return response({
        error: 'الديمو غير متاح في هذه البيئة'
      }, 404);
      const result = await demoSession(body.role || 'owner');
      if (!result) return response({
        error: 'دور العرض غير متاح'
      }, 400);
      jar.delete('clinic_session');
      jar.set('clinic_demo', result.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 3600
      });
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
        if (!(await loginAllowed(db, key))) return response({
          error: 'طلبات كثيرة؛ حاول بعد ربع ساعة'
        }, 429);
        await loginFailure(db, key);
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
      if (!(await loginAllowed(db, email))) return response({
        error: 'محاولات الدخول كثيرة؛ حاول بعد ربع ساعة'
      }, 429);
      const u = await db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
      if (!u || !verifyPassword(String(body.password), u.password)) {
        await loginFailure(db, email);
        return response({
          error: 'بيانات الدخول غير صحيحة'
        }, 401);
      }
      await loginSuccess(db, email);
      const token = randomBytes(32).toString('hex');
      await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, u.id, Date.now() + 28800000);
      jar.delete('clinic_demo');
      jar.set('clinic_session', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 28800
      });
      return response({
        ok: true
      });
    }
    const user = await db.prepare('SELECT u.id,u.name,u.email,u.role,u.active,r.permissions FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role WHERE s.token=? AND s.expires>?').get(sessionToken || '', Date.now());
    if (!user?.active) return response({
      error: 'سجّل الدخول أولًا'
    }, 401);
    const permissions = JSON.parse(user.permissions);
    const auditedResponse = async (payload, status = 200) => {
      const metadata = {role: user.role, scopes: await roleScopes(db, user.role)};
      if (method === 'GET' && path !== 'me' && status < 400) {
        await audit(user.id, 'data.read.success', path, null, {...metadata, count: Array.isArray(payload) ? payload.length : 1});
      } else if (method === 'POST' && body.action === 'download') {
        await audit(user.id, status < 400 ? 'data.download.success' : 'data.download.denied', path, null, {...metadata, count: status < 400 ? 1 : 0});
      } else if (status === 403 && (method === 'GET' || path === 'reports/export')) {
        await audit(user.id, path === 'reports/export' ? 'data.export.denied' : 'data.read.denied', path, null, metadata);
      }
      return response(payload, status);
    };
    const readinessActor={...user,permissions};
    const readinessRoutes=['finance/service-prices','finance/below-cost','inventory/adjustment-policy','inventory/adjustment-requests','equipment/parts-issue','marketing/visits','reports/filtered'];
    if(readinessRoutes.includes(path)){
      try{
        if(method==='GET'){
          if(path==='finance/service-prices')return auditedResponse(await listServicePrices(db,readinessActor));
          if(path==='reports/filtered')return auditedResponse(await filteredReport(db,Object.fromEntries(new URL(req.url).searchParams),readinessActor));
          if(path==='marketing/visits')return auditedResponse(await funnelMetrics(db,readinessActor));
          const permission=path.startsWith('finance/')?'finance.view':path.startsWith('inventory/')?'inventory.view':'equipment.view';
          if(!permissions.includes(permission))return auditedResponse({error:'غير مصرح'},403);
          if(path==='finance/below-cost')return auditedResponse(await asyncFilter(await db.prepare('SELECT id,patient_id,price_id,amount,reason,creator,status,reviewer,decision,invoice_id FROM below_cost_requests ORDER BY id').all(),row=>patientVisible(db,row.patient_id,readinessActor)));
          if(path==='inventory/adjustment-policy')return auditedResponse(await db.prepare('SELECT * FROM stock_adjustment_policy').all());
          if(path==='inventory/adjustment-requests')return auditedResponse(await db.prepare('SELECT * FROM stock_adjustment_requests ORDER BY id').all());
          return auditedResponse(await db.prepare('SELECT p.*,a.batch_id,a.quantity FROM maintenance_parts p JOIN stock_allocations a ON a.movement_id=p.movement_id ORDER BY p.id').all());
        }
        const result=path==='finance/service-prices'?await saveServicePrice(db,body,readinessActor):path==='finance/below-cost'?(body.action?await decideBelowCost(db,body,readinessActor):await requestBelowCost(db,body,readinessActor)):path==='inventory/adjustment-policy'?await setAdjustmentPolicy(db,body,readinessActor):path==='inventory/adjustment-requests'?(body.action?await decideAdjustment(db,body,readinessActor):await requestAdjustment(db,body,readinessActor)):path==='equipment/parts-issue'?await issueMaintenancePart(db,body,readinessActor):path==='marketing/visits'?await linkLeadVisit(db,body,readinessActor):null;
        if(result===null)return auditedResponse({error:'للقراءة فقط'},405);return auditedResponse(result);
      }catch(e){return auditedResponse({error:e.message},400)}
    }
    if(path==='patients/task-link'&&method==='POST'){try{return auditedResponse(await linkPatientTask(db,Number(body.patient_id),Number(body.task_id),{...user,permissions}))}catch{return auditedResponse({error:'ربط المهمة غير متاح'},403)}}
    if (path.startsWith('patients/profile/') && method === 'GET') {
      try { return auditedResponse(await patientProfile(db, Number(path.split('/')[2]), {...user,permissions})); }
      catch { return auditedResponse({error:'ملف المريض غير متاح'},403); }
    }
    // One consistent metadata-only event for scoped and ordinary reads.
    const privateResponse = rows => auditedResponse(rows);
    if (req.method === 'GET') await tickAutomation(db);
    if (path === 'appointments/staff' && method === 'GET') {
      if (!allowed(user, permissions, 'appointments', 'view')) return auditedResponse({error:'صلاحية المواعيد مطلوبة'},403);
      return auditedResponse(await db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('doctor','physio','physio_lead') ORDER BY name").all());
    }
    if (path === 'finance/staff') {
      if (method !== 'GET' || !allowed(user, permissions, 'finance', 'view')) return auditedResponse({
        error: 'صلاحية المالية مطلوبة'
      }, 403);
      return auditedResponse(await db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('doctor','physio','physio_lead')").all());
    }
    if (['tasks/alerts', 'tasks/recurring', 'tasks/policy', 'tasks/escalations', 'tasks/staff'].includes(path)) {
      if (!allowed(user, permissions, 'tasks', 'view')) return auditedResponse({
        error: 'صلاحية المهام مطلوبة'
      }, 403);
      if (method === 'POST') {
        if (!['tasks/recurring', 'tasks/policy'].includes(path)) return auditedResponse({
          error: 'للقراءة فقط'
        }, 403);
        try {
          return auditedResponse(await saveAutomation(db, path, body, user));
        } catch (e) {
          return auditedResponse({
            error: e.message
          }, 400);
        }
      }
      if (path === 'tasks/alerts') return auditedResponse((await db.prepare('SELECT * FROM alerts ORDER BY id DESC').all()).filter(a => permissions.includes(a.module + '.view') && (user.role === 'owner' || a.owner === user.id)));
      if (path === 'tasks/staff') return auditedResponse(await db.prepare('SELECT id,name FROM users WHERE active=1').all());
      if (path === 'tasks/escalations') return auditedResponse(await db.prepare('SELECT e.*,t.title FROM task_escalations e JOIN tasks t ON t.id=e.task_id WHERE e.owner=? OR t.owner=?').all(user.id, user.id));
      if (user.role !== 'owner') return auditedResponse({
        error: 'الإعدادات للمالك'
      }, 403);
      return auditedResponse(await db.prepare('SELECT * FROM ' + (path === 'tasks/policy' ? 'automation_policy' : 'recurring_tasks') + ' ORDER BY id DESC').all());
    }
    if (path === 'me') return auditedResponse({
      user: {
        id: user.id,
        name: user.name,
        role: user.role
      },
      permissions,
      scopes: await roleScopes(db, user.role),
      demo: isDemo
    });
    if (path === 'logout' && method === 'POST') {
      await db.prepare('DELETE FROM sessions WHERE token=?').run(sessionToken);
      if (isDemo) jar.delete('clinic_demo');else jar.delete('clinic_session');
      return auditedResponse({
        ok: true
      });
    }
    const documentPath = path.replace(/\/targets$/, '');
    if (documentPaths.includes(documentPath)) {
      try {
        const actor = {
          ...user,
          permissions
        };
        if (method === 'GET') return privateResponse(path.endsWith('/targets') ? await documentTargets(db, documentPath, actor) : await listDocuments(db, documentPath, actor));
        if (path.endsWith('/targets')) return auditedResponse({
          error: 'للقراءة فقط'
        }, 403);
        return auditedResponse(await saveDocument(db, documentPath, body, actor));
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (path === 'reports/export' && method === 'POST') {
      try {
        const format = body.format || 'csv';
        if (!['csv', 'pdf', 'xlsx'].includes(format)) throw Error('صيغة التقرير غير متاحة');
        const actor = { ...user, permissions };
        if (format === 'csv') return auditedResponse({csv: toCsv(await exportRows(db, String(body.path), actor))});
        const file = await exportRows(db, String(body.path), actor, {format, render: format === 'pdf' ? toPdf : toXlsx});
        return new Response(file, {headers:{
          'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="clinic-report.${format}"`,
          'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff',
        }});
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 403);
      }
    }
    if (extraPaths.includes(path)) {
      const actor = {
        ...user,
        permissions
      };
      try {
        if (method === 'GET') return auditedResponse(await listExtras(db, path, actor));
        if (path === 'purchasing/invoice-orders') return auditedResponse({
          error: 'للقراءة فقط'
        }, 403);
        const result = await saveExtras(db, path, body, actor);
        return auditedResponse(result.file ? result : {
          ok: true
        });
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (path.startsWith('purchasing/') && path !== 'purchasing/vendors') {
      if (!['purchasing/requests', 'purchasing/orders', 'purchasing/receipts', 'purchasing/catalog'].includes(path)) return auditedResponse({
        error: 'المسار غير موجود'
      }, 404);
      const actor = {
        ...user,
        permissions
      };
      try {
        if (method === 'GET') return auditedResponse(await listPurchasing(db, path, actor));
        if (['purchasing/catalog', 'purchasing/receipts'].includes(path)) return auditedResponse({
          error: 'السجل للقراءة فقط'
        }, 403);
        await savePurchasing(db, path, body, actor);
        return auditedResponse({
          ok: true
        });
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if(path==='quality/incidents/staff'){
      try{incidentPermission({...user,permissions},'view');}catch{return auditedResponse({error:'Permission denied'},403);}
      if(method!=='GET')return auditedResponse({error:'Read only'},405);
      return auditedResponse(await db.prepare('SELECT id,name FROM users WHERE active=1 ORDER BY name').all());
    }
    if(path==='quality/incidents'){
      const actor={...user,permissions};
      try{incidentPermission(actor,method==='GET'?'view':body.id?'edit':'create');}catch{return auditedResponse({error:'غير مصرح'},403);}
      try{return auditedResponse(method==='GET'?await listIncidents(db,actor):await saveIncident(db,body,actor));}catch(e){return auditedResponse({error:e.message},400);}
    }
    const mod = path.split('/')[0];
    const action = method === 'GET' ? 'view' : ['approve', 'refund', 'discount'].includes(body.action) || ['finance/approvals', 'finance/package-returns', 'finance/corrections'].includes(path) && body.action === 'reject' ? 'approve' : body.id ? 'edit' : 'create';
    if (!allowed(user, permissions, mod, action)) return auditedResponse({
      error: 'ليس لديك صلاحية لهذا الإجراء'
    }, 403);
    if (path === 'finance/policy' && user.role !== 'owner') return auditedResponse({
      error: 'ضبط الحدود المالية مخصص لمالك المجمع'
    }, 403);
    if (mod === 'finance' && method === 'POST') {
      try {
        await enforceFinanceLimit(db, body, user.role === 'owner');
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 403);
      }
    }
    if (path === 'reports/integrations' && user.role !== 'owner') return auditedResponse({
      error: 'سجل التكاملات مخصص للمالك'
    }, 403);
    if (path === 'finance/cashbox' && method === 'POST' && !allowed(user, permissions, 'finance', 'approve')) return auditedResponse({
      error: 'إقفال الصندوق يحتاج صلاحية اعتماد المالية'
    }, 403);
    if (path === 'finance/corrections') {
      try {
        if (method === 'POST') return auditedResponse(await correctFinancialRecord(db, body, {
          ...user,
          permissions
        }));
        return auditedResponse(await db.prepare('SELECT id,kind,source_id,reason,creator,status,reviewer,decision,compensation_id,time FROM financial_corrections WHERE ? OR creator=? ORDER BY id DESC').all(Number(user.role === 'owner' || permissions.includes('finance.approve')), user.id));
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (path === 'finance/package-returns') {
      try {
        if (method === 'POST') return auditedResponse(await returnPackageSession(db, body, {
          ...user,
          permissions
        }));
        return auditedResponse(await db.prepare('SELECT * FROM package_returns WHERE ? OR creator=? ORDER BY id DESC').all(Number(user.role === 'owner' || permissions.includes('finance.approve')), user.id));
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (path === 'finance/approvals') {
      try {
        if (method === 'POST') return auditedResponse(await financeRequest(db, body, {
          ...user,
          permissions
        }));
        return auditedResponse(await db.prepare('SELECT * FROM finance_requests WHERE ? OR creator=? ORDER BY id DESC').all(Number(user.role === 'owner' || permissions.includes('finance.approve')), user.id));
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (path === 'finance/cash-corrections' && method === 'POST') {
      try {
        return auditedResponse(await correctCashClosure(db, body, {
          ...user,
          permissions
        }));
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (path === 'clinical/templates' && method === 'POST' && user.role !== 'owner' && !['doctor', 'physio', 'physio_lead'].includes(user.role)) return auditedResponse({
      error: 'إعداد القالب للمالك أو الممارس المؤهل'
    }, 403);
    if (path === 'clinical/home-followup' && method === 'POST') {
      try {
        await followupProgram(db, body, {
          ...user,
          permissions
        });
        await audit(user.id, 'clinical.home-followup', String(body.program_id), null, body);
        return auditedResponse({
          ok: true
        });
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (path === 'appointments/waiting' && method === 'POST') {
      const waiting = body.id ? await db.prepare('SELECT * FROM waiting_list WHERE id=?').get(body.id) : null;
      if (body.id && !waiting) return auditedResponse({
        error: 'سجل الانتظار غير موجود'
      }, 404);
      if ((await assignedScope(db, user, 'appointments')) && (waiting?.provider || body.provider) !== user.id) return auditedResponse({
        error: 'سجل الانتظار خارج نطاق حسابك'
      }, 403);
      if (!(await patientVisible(db, waiting?.patient_id || body.patient_id, user, 'patients'))) return auditedResponse({
        error: 'المريض خارج نطاق حسابك'
      }, 403);
    }
    if (operationPages[path]) {
      if (method === 'GET') {
        const rows = await listOperations(db, path, permissions, user);
        return privateResponse(['clinical/progress', 'clinical/home-followup'].includes(path) ? await scopeRows(db, 'clinical', rows, user) : path === 'appointments/waiting' ? await scopeRows(db, 'appointments', rows, user) : rows);
      }
      if (path === 'inventory/movements' && body.kind === 'Adjustment') return auditedResponse({
        error: 'تسوية المخزون تحتاج صلاحية اعتماد'
      }, 403);
      try {
        const result = await saveOperation(db, path, body, user.id);
        await audit(user.id, path + '.' + (body.action || 'save'), String(result.after.id || body.id || 'new'), result.before, result.after);
        return auditedResponse({
          ok: true
        });
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
    if (mod === 'roles') {
      if (method === 'GET') return auditedResponse(await asyncMap(await db.prepare('SELECT * FROM roles').all(), async r => ({
        ...r,
        permissions: JSON.parse(r.permissions),
        scopes: await roleScopes(db, r.id)
      })));
      if (user.role !== 'owner') return auditedResponse({
        error: 'إدارة الصلاحيات لمالك المجمع'
      }, 403);
      if (!body.name || !validPermissions(body.permissions)) return auditedResponse({
        error: 'الصلاحيات غير صحيحة'
      }, 400);
      if (body.id === 'owner' && !['roles.view', 'roles.edit', 'users.view', 'users.edit'].every(p => body.permissions.includes(p))) return auditedResponse({
        error: 'احتفظ بصلاحيات إدارة المستخدمين والأدوار لمنع فقدان التحكم'
      }, 400);
      const id = body.id || randomUUID();
      await transaction(db, async () => {
        const before = await db.prepare('SELECT * FROM roles WHERE id=?').get(id);
        await db.prepare('INSERT INTO roles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions').run(id, body.name, JSON.stringify(body.permissions));
        if (body.scopes) await saveRoleScopes(db, id, body.scopes);
        await audit(user.id, 'roles.save', id, before, body);
      });
      return auditedResponse({
        ok: true
      });
    }
    if (path === 'users/revoke' && method === 'POST') {
      if (user.role !== 'owner') return auditedResponse({
        error: 'إبطال الجلسات للمالك'
      }, 403);
      const count = await revokeSessions(db, String(body.id));
      await audit(user.id, 'users.sessions.revoke', String(body.id), null, {
        count
      });
      return auditedResponse({
        ok: true
      });
    }
    if (mod === 'users') {
      if (method === 'GET') return auditedResponse(await db.prepare('SELECT id,name,email,role,active FROM users').all());
      if (user.role !== 'owner') return auditedResponse({
        error: 'إدارة حسابات الموظفين وإسناد الأدوار لمالك المجمع'
      }, 403);
      if (!body.name || !body.email || !body.role || !body.id && String(body.password || '').length < 12) return auditedResponse({
        error: 'راجع البيانات وكلمة المرور'
      }, 400);
      if (body.role === 'owner' && user.role !== 'owner') return auditedResponse({
        error: 'إسناد المالك يتطلب صلاحية المالك'
      }, 403);
      const id = body.id || randomUUID();
      const before = await db.prepare('SELECT id,name,email,role,active FROM users WHERE id=?').get(id);
      if (before?.role === 'owner' && user.role !== 'owner') return auditedResponse({
        error: 'حساب المالك محمي'
      }, 403);
      if (before && body.password && String(body.password).length < 12) return auditedResponse({
        error: 'كلمة المرور الجديدة 12 حرفًا على الأقل'
      }, 400);
      if (before) {
        if (before.role === 'owner' && (body.role !== 'owner' || body.active === false)) return auditedResponse({
          error: 'حساب المالك لا يمكن تعطيله من هذه الشاشة'
        }, 400);
        await db.prepare('UPDATE users SET name=?,email=?,role=?,active=? WHERE id=?').run(body.name, body.email.toLowerCase(), body.role, body.active === false ? 0 : 1, id);
        if (body.password) await db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(String(body.password)), id);
        if (body.password || body.role !== before.role || body.active === false) await revokeSessions(db, id);
      } else await db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(id, body.name, body.email.toLowerCase(), hashPassword(body.password), body.role);
      await audit(user.id, 'users.save', id, before, {
        name: body.name,
        email: body.email,
        role: body.role
      });
      return auditedResponse({
        ok: true
      });
    }
    if (mod === 'audit' && method === 'GET') return auditedResponse(await db.prepare('SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON a.actor=u.id ORDER BY a.id DESC LIMIT 100').all());
    if (mod === 'patients') {
      if (method === 'GET') return privateResponse(await scopeRows(db, 'patients', await db.prepare('SELECT * FROM patients WHERE active=1 ORDER BY id DESC').all(), user));
      if (!body.name?.trim() || !body.phone?.trim()) return auditedResponse({
        error: 'الاسم والهاتف مطلوبان'
      }, 400);
      if (body.id && !(await patientVisible(db, body.id, user))) return auditedResponse({
        error: 'ملف المريض غير متاح'
      }, 403);
      const dup = await db.prepare('SELECT id,name FROM patients WHERE phone=? AND active=1').all(body.phone.trim());
      if (dup.length && !body.confirmDuplicate && !body.id) return auditedResponse({
        error: 'يوجد ملف بنفس الهاتف، راجع التكرار أو أكد تسجيل فرد آخر',
        duplicates: await asyncFilter(dup, async r => await patientVisible(db, r.id, user))
      }, 409);
      if (body.id) await db.prepare('UPDATE patients SET name=?,phone=?,source=?,birth=?,gender=? WHERE id=?').run(body.name, body.phone, body.source || '', body.birth || '', body.gender || '', body.id);else await db.prepare('INSERT INTO patients(name,phone,source,birth,gender,creator) VALUES(?,?,?,?,?,?)').run(body.name.trim(), body.phone.trim(), body.source || '', body.birth || '', body.gender || '', user.id);
      await audit(user.id, 'patients.save', String(body.id || 'new'), null, body);
      return auditedResponse({
        ok: true
      });
    }
    if (mod === 'appointments') {
      if (method === 'GET') return privateResponse(await scopeRows(db, 'appointments', await db.prepare('SELECT a.*,p.name patient FROM appointments a JOIN patients p ON p.id=a.patient_id ORDER BY start').all(), user));
      if (body.id && (await assignedScope(db, user, 'appointments')) && !(await db.prepare('SELECT id FROM appointments WHERE id=? AND provider=?').get(body.id, user.id))) return auditedResponse({
        error: 'الموعد غير متاح'
      }, 403);
      if (!body.id && (await assignedScope(db, user, 'appointments')) && body.provider !== user.id) return auditedResponse({
        error: 'الموعد خارج نطاق حسابك'
      }, 403);
      if (body.patient_id && !(await patientVisible(db, body.patient_id, user, 'patients'))) return auditedResponse({
        error: 'المريض خارج نطاق حسابك'
      }, 403);
      if (body.id && body.action === 'reschedule') {
        try {
          await rescheduleAppointment(db, body, user.id);
          return auditedResponse({
            ok: true
          });
        } catch (e) {
          return auditedResponse({
            error: e.message
          }, 400);
        }
      }
      if (body.id) {
        const before = await db.prepare('SELECT * FROM appointments WHERE id=?').get(body.id);
        if (!before) return auditedResponse({
          error: 'الموعد غير موجود'
        }, 404);
        if (!['Pending', 'Confirmed', 'Arrived', 'Waiting', 'In Service', 'Completed', 'Cancelled', 'No show'].includes(body.status)) return auditedResponse({
          error: 'حالة غير صحيحة'
        }, 400);
        if (['Cancelled', 'No show'].includes(body.status) && !body.reason) return auditedResponse({
          error: 'سبب الإلغاء أو عدم الحضور مطلوب'
        }, 400);
        await transaction(db, async () => {
          if (body.package_id) await linkPackage(db, body.id, body.package_id);
          if (body.status === 'Completed') await consumePackage(db, body.id);
          await db.prepare(`UPDATE appointments SET status=?,reason=?,arrived=CASE WHEN ?='Arrived' THEN CURRENT_TIMESTAMP ELSE arrived END,started=CASE WHEN ?='In Service' THEN CURRENT_TIMESTAMP ELSE started END,completed=CASE WHEN ?='Completed' THEN CURRENT_TIMESTAMP ELSE completed END WHERE id=?`).run(body.status, body.reason || '', body.status, body.status, body.status, body.id);
        });
        await audit(user.id, 'appointments.status', String(body.id), before, body);
        return auditedResponse({
          ok: true
        });
      }
      if (!body.patient_id || !body.provider || !body.start || !body.end || Date.parse(body.end) <= Date.parse(body.start)) return auditedResponse({
        error: 'راجع المريض والممارس ووقت البداية والنهاية'
      }, 400);
      const conflict = await db.prepare(`SELECT id FROM appointments WHERE status NOT IN ('Cancelled','No show') AND start<? AND end>? AND (provider=? OR (room<>'' AND room=?))`).get(body.end, body.start, body.provider, body.room || '');
      if (conflict) return auditedResponse({
        error: 'تعارض في الممارس أو الغرفة'
      }, 409);
      await transaction(db, async () => {
        const price=await priceForRecord(db,body.service||'',body.start.slice(0,10));
        const result = await db.prepare('INSERT INTO appointments(patient_id,provider,start,end,room,service) VALUES(?,?,?,?,?,?)').run(body.patient_id, body.provider, body.start, body.end, body.room || '', body.service || '');
        if(price)await snapshotPrice(db,'appointment',Number(result.lastInsertRowid),price,price.amount);
        if (body.package_id) await linkPackage(db, Number(result.lastInsertRowid), body.package_id);
      });
      await audit(user.id, 'appointments.create', 'new', null, body);
      return auditedResponse({
        ok: true
      });
    }
    if (mod === 'clinical') {
      const clinician = ['doctor', 'physio', 'physio_lead'].includes(user.role);
      if (method === 'GET') return privateResponse((await assignedScope(db, user, 'clinical')) ? await db.prepare('SELECT c.*,p.name patient,d.structured,d.episode_id FROM clinical c JOIN patients p ON p.id=c.patient_id LEFT JOIN clinical_details d ON d.clinical_id=c.id WHERE c.provider=? ORDER BY c.id DESC').all(user.id) : await db.prepare('SELECT c.*,p.name patient,d.structured,d.episode_id FROM clinical c JOIN patients p ON p.id=c.patient_id LEFT JOIN clinical_details d ON d.clinical_id=c.id ORDER BY c.id DESC').all());
      if (!clinician) return auditedResponse({
        error: 'التوثيق السريري للممارس المؤهل فقط'
      }, 403);
      if (body.id) {
        const before = await db.prepare('SELECT * FROM clinical WHERE id=? AND provider=?').get(body.id, user.id);
        if (!before) return auditedResponse({
          error: 'السجل غير متاح'
        }, 404);
        if (before.approved) return auditedResponse({
          error: 'السجل معتمد؛ استخدم إضافة موثقة'
        }, 409);
        if (body.action === 'approve') await approveClinicalSession(db, body.id, user.id);else await transaction(db, async () => {
          validateClinical({
            ...body,
            kind: before.kind
          });
          await db.prepare('UPDATE clinical SET content=? WHERE id=?').run(body.content || '', body.id);
          await saveClinicalDetails(db, body.id, {
            ...body,
            kind: before.kind
          }, user.id);
        });
        await audit(user.id, 'clinical.update', String(body.id), before, body);
        return auditedResponse({
          ok: true
        });
      }
      if (body.patient_id && !(await patientVisible(db, body.patient_id, user, 'clinical'))) return auditedResponse({
        error: 'المريض خارج نطاق حسابك'
      }, 403);
      if (!body.patient_id || !body.content || !body.episode) return auditedResponse({
        error: 'المريض والحالة والمحتوى مطلوبون'
      }, 400);
      if (body.kind === 'Addendum' && !body.parent_id) return auditedResponse({
        error: 'الإضافة الموثقة تحتاج مرجعًا معتمدًا'
      }, 400);
      if (body.parent_id && !(await db.prepare('SELECT id FROM clinical WHERE id=? AND provider=? AND patient_id=? AND episode=? AND approved=1').get(body.parent_id, user.id, body.patient_id, body.episode))) return auditedResponse({
        error: 'الإضافة تحتاج سجلًا معتمدًا يخصك'
      }, 400);
      await transaction(db, async () => {
        validateClinical(body);
        const result = await db.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content,parent_id) VALUES(?,?,?,?,?,?)').run(body.patient_id, user.id, body.kind, body.episode, body.content, body.parent_id || null);
        await saveClinicalDetails(db, Number(result.lastInsertRowid), body, user.id);
      });
      await audit(user.id, 'clinical.create', 'new', null, {
        kind: body.kind,
        patient_id: body.patient_id
      });
      return auditedResponse({
        ok: true
      });
    }
    if (mod === 'finance') {
      if (method === 'GET') return privateResponse(await db.prepare('SELECT i.*,p.name patient FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY i.id DESC').all());
      if (body.id) {
        const result = body.action === 'discount' ? await discountInvoice(db, body, user.id) : await recordPayment(db, body, user.id);
        await audit(user.id, 'finance.' + (body.action || 'payment'), String(body.id), result.before, result.after);
        return auditedResponse({
          ok: true
        });
      }
      const amount = Number(body.amount);
      if (!body.patient_id || !body.service || !Number.isFinite(amount) || amount <= 0) return auditedResponse({
        error: 'راجع بيانات الفاتورة'
      }, 400);
      await transaction(db,async()=>{const price=await priceForRecord(db,body.service,undefined,amount);const result=await db.prepare('INSERT INTO invoices(patient_id,service,amount) VALUES(?,?,?)').run(body.patient_id,body.service,amount);if(price)await snapshotPrice(db,'invoice',Number(result.lastInsertRowid),price,amount)});
      await audit(user.id, 'finance.invoice', 'new', null, body);
      return auditedResponse({
        ok: true
      });
    }
    if (mod === 'tasks') {
      if (method === 'GET') return auditedResponse(await db.prepare('SELECT t.*,u.name owner_name,CASE WHEN e.task_id IS NULL THEN 0 ELSE 1 END escalated FROM tasks t LEFT JOIN users u ON u.id=t.owner LEFT JOIN task_escalations e ON e.task_id=t.id WHERE ? OR t.owner=? OR e.owner=? ORDER BY due').all(Number(user.role === 'owner' || permissions.includes('tasks.approve')), user.id, user.id));
      if (body.id) {
        const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(body.id);
        if (!task || task.owner !== user.id && user.role !== 'owner' && !permissions.includes('tasks.approve')) return auditedResponse({
          error: 'المهمة غير متاحة للتعديل'
        }, 403);
        if (body.status === 'Completed' && !body.evidence) return auditedResponse({
          error: 'دليل الإتمام مطلوب'
        }, 400);
        if (!['Open', 'In Progress', 'Waiting', 'Completed', 'Cancelled'].includes(body.status)) return auditedResponse({
          error: 'حالة غير صحيحة'
        }, 400);
        await db.prepare('UPDATE tasks SET status=?,evidence=? WHERE id=?').run(body.status, body.evidence || '', body.id);
      } else {
        if (!body.title || !(await db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(body.owner)) || !body.due) return auditedResponse({
          error: 'العنوان والمسؤول والاستحقاق مطلوبون'
        }, 400);
        await db.prepare('INSERT INTO tasks(title,owner,due,priority) VALUES(?,?,?,?)').run(body.title, body.owner, body.due, body.priority || 'Normal');
      }
      await audit(user.id, 'tasks.save', String(body.id || 'new'), null, body);
      return auditedResponse({
        ok: true
      });
    }
    return auditedResponse({
      error: 'غير متاح'
    }, 404);
  } catch (e) {
    console.error('Clinic request failed',e.code||e.name);
    return response({
      error: 'تعذر تنفيذ الطلب؛ راجع البيانات وحاول مجددًا'
    }, 400);
  }
}
let sqliteQueue=Promise.resolve();
async function dispatch(req,context){
 const path=(await context.params).path.join('/');
 const demoRequest=path==='demo'||(req.headers.get('cookie')||'').includes('clinic_demo=')&&!['login','setup','automation/run'].includes(path);
 checkProductionEnvironment();
 if(path==='environment')return response({demoAvailable:demoEnabled(),persistent:postgresConfigured(),demoOnly:process.env.CLINIC_DEMO_ONLY==='1'});
 if(postgresConfigured()&&!demoRequest&&process.env.CLINIC_DEMO_ONLY!=='1'){
  try{return await withPostgres(database=>handle(req,context,database));}catch(e){console.error('Database request failed',e.code||e.name);return response({error:'تعذر الاتصال بقاعدة البيانات؛ حاول لاحقًا'},503);}
 }
 const previous=sqliteQueue;let release;sqliteQueue=new Promise(resolve=>release=resolve);await previous;
 try{return await handle(req,context,localDb);}finally{release();}
}
export const GET=dispatch;
export const POST=dispatch;
