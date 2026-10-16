import {randomUUID} from 'node:crypto';
import {audit} from './db.js';
import {transaction} from './operations.js';

export function incidentPermission(actor,action){if(!actor?.active||!actor.permissions?.includes('incidents.'+action))throw Error('صلاحية الحوادث المقيدة مطلوبة');}
export async function listIncidents(db,actor){incidentPermission(actor,'view');return db.prepare('SELECT * FROM quality_incidents ORDER BY occurred DESC,id').all();}
const fields=['kind','title','description','category','occurred','owner','due','status','corrective','preventive','closure_evidence'];
export async function saveIncident(db,body,actor){
 incidentPermission(actor,body.id?'edit':'create');
 return transaction(db,async()=>{
 const before=body.id?await db.prepare('SELECT * FROM quality_incidents WHERE id=?').get(body.id):null;
 if(body.id&&!before)throw Error('البلاغ غير موجود');
 if(before?.status==='Closed')throw Error('البلاغ المغلق لا يقبل التعديل');
 const row=Object.fromEntries(fields.map(k=>[k,String(body[k]??before?.[k]??(k==='status'?'Open':'')).trim()]));
 for(const k of ['title','description','category','occurred','owner','due'])if(!row[k]||row[k].length>4000)throw Error('بيانات البلاغ غير مكتملة');
 for(const k of fields)if(row[k].length>12000)throw Error('النص أطول من المسموح');
 if(!['Incident','Near Miss'].includes(row.kind)||!['Open','In Progress','Closed'].includes(row.status))throw Error('نوع أو حالة غير صحيحة');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(row.occurred)||(!Number.isFinite(Date.parse(row.occurred))||new Date(row.occurred).toISOString().slice(0,10)!==row.occurred)||!/^\d{4}-\d{2}-\d{2}$/.test(row.due)||(!Number.isFinite(Date.parse(row.due))||new Date(row.due).toISOString().slice(0,10)!==row.due)||row.due<row.occurred)throw Error('التواريخ غير صحيحة');
 if(!(await db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(row.owner)))throw Error('المسؤول غير متاح');
 if(!before&&row.status!=='Open')throw Error('البلاغ يبدأ مفتوحاً');
 if(before&&Number(body.version)!==Number(before.version))throw Error('تم تحديث البلاغ؛ أعد تحميله');
 if(row.status==='Closed'){
 incidentPermission(actor,'approve');
 if(!row.corrective||!row.preventive||!row.closure_evidence)throw Error('الإغلاق يتطلب إجراء تصحيحياً ووقائياً ودليل الإغلاق');
 }
 const id=before?.id||randomUUID(),closedBy=row.status==='Closed'?actor.id:null,closedAt=row.status==='Closed'?new Date().toISOString():null;
 if(before){const result=await db.prepare('UPDATE quality_incidents SET '+fields.map(k=>k+'=?').join(',')+',closed_by=?,closed_at=?,version=version+1 WHERE id=? AND version=?').run(...fields.map(k=>row[k]),closedBy,closedAt,id,before.version);if(!result.changes)throw Error('تم تحديث البلاغ؛ أعد تحميله');}
 else await db.prepare('INSERT INTO quality_incidents(id,'+fields.join(',')+',creator,closed_by,closed_at) VALUES('+Array(15).fill('?').join(',')+')').run(id,...fields.map(k=>row[k]),actor.id,closedBy,closedAt);
 const after=await db.prepare('SELECT * FROM quality_incidents WHERE id=?').get(id);
 // Sensitive narrative stays in the restricted record, not duplicated into broad audit access.
 await audit(actor.id,'quality.incident.'+(before?(row.status==='Closed'?'close':'update'):'create'),id,before?{status:before.status,version:before.version}:null,{status:after.status,version:after.version},db);
 return {ok:true,id,version:after.version};
 });
}
