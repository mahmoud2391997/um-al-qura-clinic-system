import {endpointAllowed} from '../../../lib/api-audit-policy.js';
import {checkProductionEnvironment} from '../../../scripts/check-env.mjs';
import {postgresConfigured,withPostgres} from '../../../lib/postgres.js';
import {roleScopes} from '../../../lib/data-scopes.js';
import {tickAutomation} from '../../../lib/automation.js';
import {db as localDb} from '../../../lib/db.js';
import {demoEnabled} from '../../../lib/demo.js';
import {allowed} from '../../../lib/permissions.js';
import {authenticate} from '../../../lib/api-handlers/auth.js';
import {response} from '../../../lib/api-handlers/response.js';
import {handleInventory} from '../../../lib/api-handlers/inventory.js';
import {handleAppointments} from '../../../lib/api-handlers/appointments.js';
import {handleReadiness} from '../../../lib/api-handlers/readiness.js';
import {handlePatients} from '../../../lib/api-handlers/patients.js';
import {handleFinance} from '../../../lib/api-handlers/finance.js';
import {handleTasks} from '../../../lib/api-handlers/tasks.js';
import {handleIdentity} from '../../../lib/api-handlers/identity.js';
import {handleAttachments} from '../../../lib/api-handlers/attachments.js';
import {handleReports} from '../../../lib/api-handlers/reports.js';
import {handlePurchasing} from '../../../lib/api-handlers/purchasing.js';
import {handleAssets} from '../../../lib/api-handlers/assets.js';
import {handleClinical} from '../../../lib/api-handlers/clinical.js';
import {handleAdmin} from '../../../lib/api-handlers/admin.js';
export const runtime='nodejs';
const moduleHandlers=[handleAppointments,handleReadiness,handlePatients,handleFinance,handleTasks,handleIdentity,handleAttachments,handleReports,handlePurchasing,handleAssets,handleClinical,handleAdmin];
async function handle(req,{params},mainDb=localDb){
try{const authentication=await authenticate(req,params,mainDb);
if(authentication instanceof Response)return authentication;
const {path,method,endpoint,body,jar,isDemo,db,audit,sessionToken,user,permissions}=authentication;
const auditedResponse = async (payload, status = 200) => {
      const metadata = {role: user.role, scopes: await roleScopes(db, user.role)};
      if (method === 'GET' && path !== 'me' && status < 400) {
        await audit(user.id, 'data.read.success', path, null, {...metadata, count: Array.isArray(payload) ? payload.length : 1});
      } else if (method === 'POST' && body.action === 'download') {
        await audit(user.id, status < 400 ? 'data.download.success' : 'data.download.denied', path, null, {...metadata, count: status < 400 ? 1 : 0});
      } else if (status === 403 && method === 'POST' && path !== 'reports/export') {
        await audit(user.id,'data.write.denied',path,null,metadata);
      } else if (status === 403 && (method === 'GET' || path === 'reports/export')) {
        await audit(user.id, path === 'reports/export' ? 'data.export.denied' : 'data.read.denied', path, null, metadata);
      }
      if (method === 'POST' && status < 400 && body.action !== 'download' && path !== 'reports/export') {
        await audit(user.id,'data.write.success',path,null,{...metadata,method});
      }
      return response(payload, status);
    };
if (!endpointAllowed(endpoint,{...user,permissions},body)) return auditedResponse({error:'غير مصرح'},403);
const privateResponse=rows=>auditedResponse(rows);
const readinessActor={...user,permissions},mod=path.split('/')[0];
const action = method === 'GET' ? 'view' : ['approve', 'refund', 'discount'].includes(body.action) || ['finance/approvals', 'finance/package-returns', 'finance/corrections'].includes(path) && body.action === 'reject' ? 'approve' : body.id ? 'edit' : 'create';
const context={...authentication,req,auditedResponse,privateResponse,readinessActor,mod,action};
for(const phase of ['early','session','domain','records']){
 if(phase==='session'&&method==='GET')await tickAutomation(db);
 if(phase==='domain'){if (!allowed(user, permissions, mod, action)) return auditedResponse({
      error: 'ليس لديك صلاحية لهذا الإجراء'
    }, 403);}
 if(phase==='records'){const result=await handleInventory(context);if(result!==undefined)return result;}
 for(const handler of moduleHandlers){const result=await handler(context,phase);if(result!==undefined)return result;}
}
return auditedResponse({error:'غير متاح'},404);
}catch(e){console.error('Clinic request failed',e.code||e.name);return response({error:'تعذر تنفيذ الطلب؛ راجع البيانات وحاول مجددًا'},400);}
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
