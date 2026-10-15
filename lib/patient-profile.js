import { patientVisible, scopeRows } from './data-scopes.js';
import { listDocuments } from './documents.js';
import { audit } from './db.js';
export async function patientProfile(db, id, actor) {
  const can=module=>actor.active&&actor.permissions.includes(module+'.view');
  if(!can('patients')||!Number.isSafeInteger(id)||id<1||!await patientVisible(db,id,actor))throw Error('ملف المريض غير متاح');
  const patient=await db.prepare('SELECT id,name,phone,birth,gender,source,active FROM patients WHERE id=?').get(id);
  const result={patient};
  if(can('appointments'))result.appointments=await scopeRows(db,'appointments',await db.prepare('SELECT id,patient_id,provider,start,end,service,status,arrived,started,completed FROM appointments WHERE patient_id=? ORDER BY start DESC').all(id),actor);
  if(can('clinical'))result.clinical=await scopeRows(db,'clinical',await db.prepare('SELECT id,patient_id,provider,kind,episode,content,approved FROM clinical WHERE patient_id=? ORDER BY id DESC').all(id),actor);
  if(can('clinical'))result.episodes=await scopeRows(db,'clinical',await db.prepare('SELECT id,title,status,provider FROM episodes WHERE patient_id=? ORDER BY id DESC').all(id),actor);
  if(can('finance'))result.invoices=await db.prepare('SELECT id,service,amount,paid FROM invoices WHERE patient_id=? ORDER BY id DESC').all(id);
  if(can('tasks')) result.tasks=await db.prepare('SELECT t.id,t.title,t.due,t.priority,t.status FROM tasks t JOIN patient_tasks pt ON pt.task_id=t.id WHERE pt.patient_id=? AND (? OR t.owner=?) ORDER BY t.due').all(id,Number(actor.role==='owner'||actor.permissions.includes('tasks.approve')),actor.id);
  const documents=[];
  for(const module of ['patients','clinical'])if(can(module))documents.push(...(await listDocuments(db,module+'/attachments',actor)).filter(row=>row.target_id===id));
  result.documents=documents;
  await audit(actor.id,'patient.profile.read',String(id),null,{sections:Object.keys(result)},db);
  return result;
}

export async function linkPatientTask(db,patientId,taskId,actor){
 if(!actor.active||!actor.permissions.includes('tasks.edit')||!actor.permissions.includes('patients.view')||!await patientVisible(db,patientId,actor))throw Error('صلاحية ربط المهمة بالمريض مطلوبة');
 const task=await db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
 if(!task||task.owner!==actor.id&&actor.role!=='owner'&&!actor.permissions.includes('tasks.approve'))throw Error('المهمة غير متاحة');
 await db.prepare('INSERT INTO patient_tasks(patient_id,task_id) VALUES(?,?) ON CONFLICT(patient_id,task_id) DO NOTHING').run(patientId,taskId);
 await audit(actor.id,'patient.task.link',String(patientId),null,{task_id:taskId},db);
 return {ok:true};
}
