import {roleScopes,scopeRows,assignedScope,patientVisible,saveRoleScopes} from '../../../lib/data-scopes.js';
import {financeRequest,correctCashClosure} from '../../../lib/finance-workflow.js';
import {loginAllowed,loginFailure,loginSuccess,revokeSessions} from '../../../lib/auth-security.js';
import {documentPaths,documentTargets,listDocuments,saveDocument} from '../../../lib/documents.js';
import {followupProgram} from '../../../lib/clinical-programs.js';
import {exportRows,toCsv} from '../../../lib/exports.js';
import {rescheduleAppointment} from '../../../lib/appointment-workflow.js';
import {tickAutomation,saveAutomation} from '../../../lib/automation.js';
import {extraPaths,listExtras,saveExtras} from '../../../lib/purchasing-extras.js';
import {listPurchasing,savePurchasing} from '../../../lib/purchasing.js';
import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomBytes,randomUUID} from 'node:crypto';
import {db as mainDb,hashPassword,verifyPassword,audit as recordAudit} from '../../../lib/db.js';
import {demoDatabase,demoEnabled,demoSession,restoreDemoSession} from '../../../lib/demo.js';
import {operationPages} from '../../../lib/operations-config.js';
import {recordPayment,discountInvoice,enforceFinanceLimit} from '../../../lib/finance.js';
import {approveClinicalSession} from '../../../lib/session-resources.js';
import {validateClinical,saveClinicalDetails} from '../../../lib/clinical.js';
import {linkPackage,consumePackage} from '../../../lib/packages.js';
import {transaction} from '../../../lib/operations.js';
import {listOperations,saveOperation} from '../../../lib/operations.js';
import {allowed,validPermissions} from '../../../lib/permissions.js';
export const runtime='nodejs';
const response=(x,status=200)=>NextResponse.json(x,{status});
async function handle(req,{params}){
try{
const path=(await params).path.join('/');const method=req.method;
if(process.env.CLINIC_DEMO_ONLY==='1'&&['setup','login'].includes(path)){if(path==='setup'&&method==='GET')return response({needed:false});return response({error:'النسخة المنشورة للديمو فقط؛ استخدم استعراض الديمو بدون تسجيل'},403);}
if(method==='POST'&&(!req.headers.get('origin')||new URL(req.headers.get('origin')).host!==req.headers.get('host')))return response({error:'مصدر الطلب غير مسموح'},403);
const body=method==='POST'?await req.json():{};const jar=await cookies();
if(path==='demo'&&method==='POST'){
 if(!demoEnabled())return response({error:'الديمو غير متاح في هذه البيئة'},404);
 const result=demoSession(body.role||'owner');
 if(!result)return response({error:'دور العرض غير متاح'},400);
 jar.set('clinic_demo',result.token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:3600});return response({ok:true,demo:true});
}
const demoToken=jar.get('clinic_demo')?.value;
const isDemo=restoreDemoSession(demoToken);
if(process.env.CLINIC_DEMO_ONLY==='1'&&!isDemo)return response({error:'افتح الديمو لبدء جلسة العرض'},401);
const db=isDemo?demoDatabase:mainDb;
const audit=(...args)=>recordAudit(...args,db);
const sessionToken=isDemo?demoToken:jar.get('clinic_session')?.value;
if(path==='setup'&&method==='GET')return response({needed:!db.prepare('SELECT id FROM users LIMIT 1').get()});
if(path==='setup'&&method==='POST'){
 if(db.prepare('SELECT id FROM users LIMIT 1').get())return response({error:'تم إعداد النظام بالفعل'},409);
 if(!body.name||!body.email||!body.password||body.password.length<12)return response({error:'أدخل الاسم والبريد وكلمة مرور 12 حرفًا على الأقل'},400);
 const id=randomUUID();db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(id,body.name,body.email.toLowerCase(),hashPassword(body.password),'owner');audit(id,'setup','users',null,{id,name:body.name});return response({ok:true});
}
if(path==='login'&&method==='POST'){
 const email=String(body.email||'').trim().toLowerCase().slice(0,254);if(!loginAllowed(db,email))return response({error:'محاولات الدخول كثيرة؛ حاول بعد ربع ساعة'},429);
 const u=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
 if(!u||!verifyPassword(String(body.password),u.password)){loginFailure(db,email);return response({error:'بيانات الدخول غير صحيحة'},401);}loginSuccess(db,email);
 const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,Date.now()+28800000);jar.set('clinic_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:28800});return response({ok:true});
}
const user=db.prepare('SELECT u.id,u.name,u.email,u.role,u.active,r.permissions FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role WHERE s.token=? AND s.expires>?').get(sessionToken||'',Date.now());
if(!user?.active)return response({error:'سجّل الدخول أولًا'},401);
const permissions=JSON.parse(user.permissions);
if(req.method==='GET')tickAutomation(db);
if(path==='finance/staff'){if(method!=='GET'||!allowed(user,permissions,'finance','view'))return response({error:'صلاحية المالية مطلوبة'},403);return response(db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('doctor','physio','physio_lead')").all());}
if(['tasks/alerts','tasks/recurring','tasks/policy','tasks/escalations','tasks/staff'].includes(path)){if(!allowed(user,permissions,'tasks','view'))return response({error:'صلاحية المهام مطلوبة'},403);if(method==='POST'){if(!['tasks/recurring','tasks/policy'].includes(path))return response({error:'للقراءة فقط'},403);try{return response(saveAutomation(db,path,body,user))}catch(e){return response({error:e.message},400);}}if(path==='tasks/alerts')return response(db.prepare('SELECT * FROM alerts ORDER BY id DESC').all().filter(a=>permissions.includes(a.module+'.view')&&(user.role==='owner'||a.owner===user.id)));if(path==='tasks/staff')return response(db.prepare('SELECT id,name FROM users WHERE active=1').all());if(path==='tasks/escalations')return response(db.prepare('SELECT e.*,t.title FROM task_escalations e JOIN tasks t ON t.id=e.task_id WHERE e.owner=? OR t.owner=?').all(user.id,user.id));if(user.role!=='owner')return response({error:'الإعدادات للمالك'},403);return response(db.prepare('SELECT * FROM '+(path==='tasks/policy'?'automation_policy':'recurring_tasks')+' ORDER BY id DESC').all());}
if(path==='me')return response({user:{id:user.id,name:user.name,role:user.role},permissions,scopes:roleScopes(db,user.role),demo:isDemo});
if(path==='logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(sessionToken);if(isDemo)jar.delete('clinic_demo');else jar.delete('clinic_session');return response({ok:true});}
const documentPath=path.replace(/\/targets$/,'');if(documentPaths.includes(documentPath)){try{const actor={...user,permissions};if(method==='GET')return response(path.endsWith('/targets')?documentTargets(db,documentPath,actor):listDocuments(db,documentPath,actor));if(path.endsWith('/targets'))return response({error:'للقراءة فقط'},403);return response(saveDocument(db,documentPath,body,actor));}catch(e){return response({error:e.message},400)}}
if(path==='reports/export'&&method==='POST'){try{return response({csv:toCsv(exportRows(db,String(body.path),{...user,permissions}))})}catch(e){return response({error:e.message},403)}}
if(extraPaths.includes(path)){const actor={...user,permissions};try{if(method==='GET')return response(listExtras(db,path,actor));if(path==='purchasing/invoice-orders')return response({error:'للقراءة فقط'},403);const result=saveExtras(db,path,body,actor);return response(result.file?result:{ok:true});}catch(e){return response({error:e.message},400);}}
if(path.startsWith('purchasing/')){if(!['purchasing/requests','purchasing/orders','purchasing/receipts','purchasing/catalog'].includes(path))return response({error:'المسار غير موجود'},404);const actor={...user,permissions};try{if(method==='GET')return response(listPurchasing(db,path,actor));if(['purchasing/catalog','purchasing/receipts'].includes(path))return response({error:'السجل للقراءة فقط'},403);savePurchasing(db,path,body,actor);return response({ok:true});}catch(e){return response({error:e.message},400);}}
const mod=path.split('/')[0];const action=method==='GET'?'view':(['approve','refund','discount'].includes(body.action)||path==='finance/approvals'&&body.action==='reject')?'approve':body.id?'edit':'create';
if(!allowed(user,permissions,mod,action))return response({error:'ليس لديك صلاحية لهذا الإجراء'},403);
if(path==='finance/policy'&&user.role!=='owner')return response({error:'ضبط الحدود المالية مخصص لمالك المجمع'},403);
if(mod==='finance'&&method==='POST'){try{enforceFinanceLimit(db,body,user.role==='owner')}catch(e){return response({error:e.message},403);}}
if(path==='reports/integrations'&&user.role!=='owner')return response({error:'سجل التكاملات مخصص للمالك'},403);
if(path==='finance/cashbox'&&method==='POST'&&!allowed(user,permissions,'finance','approve'))return response({error:'إقفال الصندوق يحتاج صلاحية اعتماد المالية'},403);
if(path==='finance/approvals'){try{if(method==='POST')return response(financeRequest(db,body,{...user,permissions}));return response(db.prepare('SELECT * FROM finance_requests WHERE ? OR creator=? ORDER BY id DESC').all(Number(user.role==='owner'||permissions.includes('finance.approve')),user.id));}catch(e){return response({error:e.message},400)}}
if(path==='finance/cash-corrections'&&method==='POST'){try{return response(correctCashClosure(db,body,{...user,permissions}))}catch(e){return response({error:e.message},400)}}
if(path==='clinical/templates'&&method==='POST'&&user.role!=='owner'&&!['doctor','physio','physio_lead'].includes(user.role))return response({error:'إعداد القالب للمالك أو الممارس المؤهل'},403);
if(path==='clinical/home-followup'&&method==='POST'){try{followupProgram(db,body,{...user,permissions});audit(user.id,'clinical.home-followup',String(body.program_id),null,body);return response({ok:true})}catch(e){return response({error:e.message},400)}}
if(path==='appointments/waiting'&&method==='POST'){const waiting=body.id?db.prepare('SELECT * FROM waiting_list WHERE id=?').get(body.id):null;if(body.id&&!waiting)return response({error:'سجل الانتظار غير موجود'},404);if(assignedScope(db,user,'appointments')&&(waiting?.provider||body.provider)!==user.id)return response({error:'سجل الانتظار خارج نطاق حسابك'},403);if(!patientVisible(db,waiting?.patient_id||body.patient_id,user,'patients'))return response({error:'المريض خارج نطاق حسابك'},403);}
if(operationPages[path]){
 if(method==='GET'){const rows=listOperations(db,path,permissions,user);return response(['clinical/progress','clinical/home-followup'].includes(path)?scopeRows(db,'clinical',rows,user):path==='appointments/waiting'?scopeRows(db,'appointments',rows,user):rows);}
 if(path==='inventory/movements'&&body.kind==='Adjustment'&&!allowed(user,permissions,'inventory','approve'))return response({error:'تسوية المخزون تحتاج صلاحية اعتماد'},403);
 try{const result=saveOperation(db,path,body,user.id);audit(user.id,path+'.'+(body.action||'save'),String(result.after.id||body.id||'new'),result.before,result.after);return response({ok:true});}catch(e){return response({error:e.message},400);}
}
if(mod==='roles'){
 if(method==='GET')return response(db.prepare('SELECT * FROM roles').all().map(r=>({...r,permissions:JSON.parse(r.permissions),scopes:roleScopes(db,r.id)})));
 if(user.role!=='owner')return response({error:'إدارة الصلاحيات لمالك المجمع'},403);
 if(!body.name||!validPermissions(body.permissions))return response({error:'الصلاحيات غير صحيحة'},400);
 if(body.id==='owner'&&!['roles.view','roles.edit','users.view','users.edit'].every(p=>body.permissions.includes(p)))return response({error:'احتفظ بصلاحيات إدارة المستخدمين والأدوار لمنع فقدان التحكم'},400);
 const id=body.id||randomUUID();transaction(db,()=>{const before=db.prepare('SELECT * FROM roles WHERE id=?').get(id);db.prepare('INSERT INTO roles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions').run(id,body.name,JSON.stringify(body.permissions));if(body.scopes)saveRoleScopes(db,id,body.scopes);audit(user.id,'roles.save',id,before,body);});return response({ok:true});
}
if(path==='users/revoke'&&method==='POST'){if(user.role!=='owner')return response({error:'إبطال الجلسات للمالك'},403);const count=revokeSessions(db,String(body.id));audit(user.id,'users.sessions.revoke',String(body.id),null,{count});return response({ok:true})}
if(mod==='users'){
 if(method==='GET')return response(db.prepare('SELECT id,name,email,role,active FROM users').all());
 if(user.role!=='owner')return response({error:'إدارة حسابات الموظفين وإسناد الأدوار لمالك المجمع'},403);
 if(!body.name||!body.email||!body.role||(!body.id&&String(body.password||'').length<12))return response({error:'راجع البيانات وكلمة المرور'},400);
 if(body.role==='owner'&&user.role!=='owner')return response({error:'إسناد المالك يتطلب صلاحية المالك'},403);
 const id=body.id||randomUUID();const before=db.prepare('SELECT id,name,email,role,active FROM users WHERE id=?').get(id);
 if(before?.role==='owner'&&user.role!=='owner')return response({error:'حساب المالك محمي'},403);
 if(before&&body.password&&String(body.password).length<12)return response({error:'كلمة المرور الجديدة 12 حرفًا على الأقل'},400);
 if(before){if(before.role==='owner'&&(body.role!=='owner'||body.active===false))return response({error:'حساب المالك لا يمكن تعطيله من هذه الشاشة'},400);db.prepare('UPDATE users SET name=?,email=?,role=?,active=? WHERE id=?').run(body.name,body.email.toLowerCase(),body.role,body.active===false?0:1,id);if(body.password)db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(String(body.password)),id);if(body.password||body.role!==before.role||body.active===false)revokeSessions(db,id);}
 else db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(id,body.name,body.email.toLowerCase(),hashPassword(body.password),body.role);
 audit(user.id,'users.save',id,before,{name:body.name,email:body.email,role:body.role});return response({ok:true});
}
if(mod==='audit'&&method==='GET')return response(db.prepare('SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON a.actor=u.id ORDER BY a.id DESC LIMIT 100').all());
if(mod==='patients'){
 if(method==='GET')return response(scopeRows(db,'patients',db.prepare('SELECT * FROM patients WHERE active=1 ORDER BY id DESC').all(),user));
 if(!body.name?.trim()||!body.phone?.trim())return response({error:'الاسم والهاتف مطلوبان'},400);
 if(body.id&&!patientVisible(db,body.id,user))return response({error:'ملف المريض غير متاح'},403);
 const dup=db.prepare('SELECT id,name FROM patients WHERE phone=? AND active=1').all(body.phone.trim());
 if(dup.length&&!body.confirmDuplicate&&!body.id)return response({error:'يوجد ملف بنفس الهاتف، راجع التكرار أو أكد تسجيل فرد آخر',duplicates:dup.filter(r=>patientVisible(db,r.id,user))},409);
 if(body.id)db.prepare('UPDATE patients SET name=?,phone=?,source=?,birth=?,gender=? WHERE id=?').run(body.name,body.phone,body.source||'',body.birth||'',body.gender||'',body.id);
 else db.prepare('INSERT INTO patients(name,phone,source,birth,gender,creator) VALUES(?,?,?,?,?,?)').run(body.name.trim(),body.phone.trim(),body.source||'',body.birth||'',body.gender||'',user.id);
 audit(user.id,'patients.save',String(body.id||'new'),null,body);return response({ok:true});
}
if(mod==='appointments'){
 if(method==='GET')return response(scopeRows(db,'appointments',db.prepare('SELECT a.*,p.name patient FROM appointments a JOIN patients p ON p.id=a.patient_id ORDER BY start').all(),user));
 if(body.id&&assignedScope(db,user,'appointments')&&!db.prepare('SELECT id FROM appointments WHERE id=? AND provider=?').get(body.id,user.id))return response({error:'الموعد غير متاح'},403);
 if(!body.id&&assignedScope(db,user,'appointments')&&body.provider!==user.id)return response({error:'الموعد خارج نطاق حسابك'},403);
 if(body.patient_id&&!patientVisible(db,body.patient_id,user,'patients'))return response({error:'المريض خارج نطاق حسابك'},403);
 if(body.id&&body.action==='reschedule'){try{rescheduleAppointment(db,body,user.id);return response({ok:true})}catch(e){return response({error:e.message},400)}}
 if(body.id){const before=db.prepare('SELECT * FROM appointments WHERE id=?').get(body.id);if(!before)return response({error:'الموعد غير موجود'},404);if(!['Pending','Confirmed','Arrived','Waiting','In Service','Completed','Cancelled','No show'].includes(body.status))return response({error:'حالة غير صحيحة'},400);if(['Cancelled','No show'].includes(body.status)&&!body.reason)return response({error:'سبب الإلغاء أو عدم الحضور مطلوب'},400);transaction(db,()=>{if(body.package_id)linkPackage(db,body.id,body.package_id);if(body.status==='Completed')consumePackage(db,body.id);db.prepare(`UPDATE appointments SET status=?,reason=?,arrived=CASE WHEN ?='Arrived' THEN CURRENT_TIMESTAMP ELSE arrived END,started=CASE WHEN ?='In Service' THEN CURRENT_TIMESTAMP ELSE started END,completed=CASE WHEN ?='Completed' THEN CURRENT_TIMESTAMP ELSE completed END WHERE id=?`).run(body.status,body.reason||'',body.status,body.status,body.status,body.id);});audit(user.id,'appointments.status',String(body.id),before,body);return response({ok:true});}
 if(!body.patient_id||!body.provider||!body.start||!body.end||Date.parse(body.end)<=Date.parse(body.start))return response({error:'راجع المريض والممارس ووقت البداية والنهاية'},400);
 const conflict=db.prepare(`SELECT id FROM appointments WHERE status NOT IN ('Cancelled','No show') AND start<? AND end>? AND (provider=? OR (room<>'' AND room=?))`).get(body.end,body.start,body.provider,body.room||'');if(conflict)return response({error:'تعارض في الممارس أو الغرفة'},409);
 transaction(db,()=>{const result=db.prepare('INSERT INTO appointments(patient_id,provider,start,end,room,service) VALUES(?,?,?,?,?,?)').run(body.patient_id,body.provider,body.start,body.end,body.room||'',body.service||'');if(body.package_id)linkPackage(db,Number(result.lastInsertRowid),body.package_id);});audit(user.id,'appointments.create','new',null,body);return response({ok:true});
}
if(mod==='clinical'){
 const clinician=['doctor','physio','physio_lead'].includes(user.role);
 if(method==='GET')return response(assignedScope(db,user,'clinical')?db.prepare('SELECT c.*,p.name patient,d.structured,d.episode_id FROM clinical c JOIN patients p ON p.id=c.patient_id LEFT JOIN clinical_details d ON d.clinical_id=c.id WHERE c.provider=? ORDER BY c.id DESC').all(user.id):db.prepare('SELECT c.*,p.name patient,d.structured,d.episode_id FROM clinical c JOIN patients p ON p.id=c.patient_id LEFT JOIN clinical_details d ON d.clinical_id=c.id ORDER BY c.id DESC').all());
 if(!clinician)return response({error:'التوثيق السريري للممارس المؤهل فقط'},403);
 if(body.id){const before=db.prepare('SELECT * FROM clinical WHERE id=? AND provider=?').get(body.id,user.id);if(!before)return response({error:'السجل غير متاح'},404);if(before.approved)return response({error:'السجل معتمد؛ استخدم إضافة موثقة'},409);if(body.action==='approve')approveClinicalSession(db,body.id,user.id);else transaction(db,()=>{validateClinical({...body,kind:before.kind});db.prepare('UPDATE clinical SET content=? WHERE id=?').run(body.content||'',body.id);saveClinicalDetails(db,body.id,{...body,kind:before.kind},user.id);});audit(user.id,'clinical.update',String(body.id),before,body);return response({ok:true});}
 if(body.patient_id&&!patientVisible(db,body.patient_id,user,'clinical'))return response({error:'المريض خارج نطاق حسابك'},403);
 if(!body.patient_id||!body.content||!body.episode)return response({error:'المريض والحالة والمحتوى مطلوبون'},400);
 if(body.kind==='Addendum'&&!body.parent_id)return response({error:'الإضافة الموثقة تحتاج مرجعًا معتمدًا'},400);
 if(body.parent_id&&!db.prepare('SELECT id FROM clinical WHERE id=? AND provider=? AND patient_id=? AND episode=? AND approved=1').get(body.parent_id,user.id,body.patient_id,body.episode))return response({error:'الإضافة تحتاج سجلًا معتمدًا يخصك'},400);
 transaction(db,()=>{validateClinical(body);const result=db.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content,parent_id) VALUES(?,?,?,?,?,?)').run(body.patient_id,user.id,body.kind,body.episode,body.content,body.parent_id||null);saveClinicalDetails(db,Number(result.lastInsertRowid),body,user.id);});audit(user.id,'clinical.create','new',null,{kind:body.kind,patient_id:body.patient_id});return response({ok:true});
}
if(mod==='finance'){
 if(method==='GET')return response(db.prepare('SELECT i.*,p.name patient FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY i.id DESC').all());
 if(body.id){const result=body.action==='discount'?discountInvoice(db,body,user.id):recordPayment(db,body,user.id);audit(user.id,'finance.'+(body.action||'payment'),String(body.id),result.before,result.after);return response({ok:true});}
 const amount=Number(body.amount);if(!body.patient_id||!body.service||!Number.isFinite(amount)||amount<=0)return response({error:'راجع بيانات الفاتورة'},400);db.prepare('INSERT INTO invoices(patient_id,service,amount) VALUES(?,?,?)').run(body.patient_id,body.service,amount);audit(user.id,'finance.invoice','new',null,body);return response({ok:true});
}
if(mod==='tasks'){
 if(method==='GET')return response(db.prepare('SELECT t.*,u.name owner_name,CASE WHEN e.task_id IS NULL THEN 0 ELSE 1 END escalated FROM tasks t LEFT JOIN users u ON u.id=t.owner LEFT JOIN task_escalations e ON e.task_id=t.id WHERE ? OR t.owner=? OR e.owner=? ORDER BY due').all(Number(user.role==='owner'||permissions.includes('tasks.approve')),user.id,user.id));
 if(body.id){const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(body.id);if(!task||(task.owner!==user.id&&user.role!=='owner'&&!permissions.includes('tasks.approve')))return response({error:'المهمة غير متاحة للتعديل'},403);if(body.status==='Completed'&&!body.evidence)return response({error:'دليل الإتمام مطلوب'},400);if(!['Open','In Progress','Waiting','Completed','Cancelled'].includes(body.status))return response({error:'حالة غير صحيحة'},400);db.prepare('UPDATE tasks SET status=?,evidence=? WHERE id=?').run(body.status,body.evidence||'',body.id);}
 else {if(!body.title||!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(body.owner)||!body.due)return response({error:'العنوان والمسؤول والاستحقاق مطلوبون'},400);db.prepare('INSERT INTO tasks(title,owner,due,priority) VALUES(?,?,?,?)').run(body.title,body.owner,body.due,body.priority||'Normal');}audit(user.id,'tasks.save',String(body.id||'new'),null,body);return response({ok:true});
}
return response({error:'غير متاح'},404);
}catch(e){console.error(e);return response({error:'تعذر تنفيذ الطلب؛ راجع البيانات وحاول مجددًا'},400);}
}
export const GET=handle;export const POST=handle;
