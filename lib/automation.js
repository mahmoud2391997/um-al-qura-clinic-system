import {transaction} from './operations.js';
import {omanDate,validExpiry} from './stock-batches.js';
import {audit} from './db.js';
const ownerFor=(db,role)=>db.prepare('SELECT id FROM users WHERE role=? AND active=1 ORDER BY id LIMIT 1').get(role)?.id||db.prepare("SELECT id FROM users WHERE role='owner' AND active=1 LIMIT 1").get()?.id||'';
export function tickAutomation(db,now=new Date()){return transaction(db,()=>{
 const today=omanDate(now),policy=db.prepare('SELECT * FROM automation_policy').get(),keys=new Set();
 function alert(key,module,title,reference,role,severity='High'){
  keys.add(key);const owner=ownerFor(db,role);db.prepare("INSERT INTO alerts(key,module,title,reference,owner,severity) VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET status='Open',owner=excluded.owner").run(key,module,title,String(reference),owner,severity);
  let existing=db.prepare('SELECT task_id FROM auto_task_keys WHERE key=?').get('alert:'+key);if(!existing){const id=Number(db.prepare('INSERT INTO tasks(title,owner,due,priority) VALUES(?,?,?,?)').run(title,owner,today+'T17:00',severity).lastInsertRowid);db.prepare('INSERT INTO auto_task_keys VALUES(?,?)').run('alert:'+key,id);}
 }
 for(const i of db.prepare('SELECT * FROM inventory WHERE quantity<=minimum').all())alert('stock:'+i.id,'inventory','رصيد منخفض: '+i.name,i.id,'store');
 for(const b of db.prepare("SELECT b.*,i.name FROM stock_batches b JOIN inventory i ON i.id=b.item_id WHERE b.quantity>0 AND b.expiry<>''").all())if((Date.parse(b.expiry)-Date.parse(today))/86400000<=policy.expiry_days)alert('expiry:'+b.id+':'+b.expiry,'inventory','صلاحية دفعة '+b.number+' — '+b.name,b.id,'store',b.expiry<today?'Critical':'High');
 for(const d of db.prepare('SELECT * FROM equipment WHERE capacity>0').all())if(d.used/d.capacity*100>=policy.device_percent)alert('device:'+d.id+':'+d.capacity,'equipment','عداد الجهاز قريب من الحد: '+d.name,d.id,'maintenance');
 for(const l of db.prepare('SELECT * FROM licenses').all())if((Date.parse(l.expiry)-Date.parse(today))/86400000<=policy.expiry_days)alert('license:'+l.id+':'+l.expiry,'compliance','تجديد الوثيقة: '+l.title,l.id,'manager',l.expiry<today?'Critical':'High');
 for(const o of db.prepare("SELECT * FROM obligations WHERE status<>'Paid'").all())if((Date.parse(o.due)-Date.parse(today))/86400000<=policy.expiry_days)alert('obligation:'+o.id+':'+o.due,'compliance','استحقاق الالتزام: '+o.title,o.id,'manager');
 for(const a of db.prepare("SELECT id,key FROM alerts WHERE status='Open'").all())if(!keys.has(a.key)){db.prepare("UPDATE alerts SET status='Resolved' WHERE id=?").run(a.id);const task=db.prepare('SELECT task_id FROM auto_task_keys WHERE key=?').get('alert:'+a.key);if(task){db.prepare("UPDATE tasks SET status='Completed',evidence='زالت حالة التنبيه تلقائيًا' WHERE id=? AND status NOT IN ('Completed','Cancelled')").run(task.task_id);db.prepare('DELETE FROM auto_task_keys WHERE key=?').run('alert:'+a.key);}}
 for(const rule of db.prepare('SELECT * FROM recurring_tasks WHERE active=1').all()){
  let due=rule.due,count=0;while(due<=today&&count++<100){const key='recurring:'+rule.id+':'+due;if(!db.prepare('SELECT key FROM auto_task_keys WHERE key=?').get(key)){const id=Number(db.prepare('INSERT INTO tasks(title,owner,due,priority) VALUES(?,?,?,?)').run(rule.title,rule.owner,due+'T17:00',rule.priority).lastInsertRowid);db.prepare('INSERT INTO auto_task_keys VALUES(?,?)').run(key,id);}
   due=new Date(Date.parse(due+'T00:00:00Z')+rule.every_days*86400000).toISOString().slice(0,10);
  }db.prepare('UPDATE recurring_tasks SET due=? WHERE id=?').run(due,rule.id);
 }
 const cutoff=now.getTime()-policy.escalation_hours*3600000,supervisor=ownerFor(db,'owner');
 for(const task of db.prepare("SELECT * FROM tasks WHERE status NOT IN ('Completed','Cancelled')").all())if(Date.parse(task.due.length===10?task.due+'T17:00:00+04:00':(/(?:Z|[+-]\d\d:\d\d)$/.test(task.due)?task.due:task.due+'+04:00'))<cutoff&&!db.prepare('SELECT task_id FROM task_escalations WHERE task_id=?').get(task.id)){
  db.prepare('INSERT INTO task_escalations(task_id,owner) VALUES(?,?)').run(task.id,supervisor);audit('system','tasks.escalate',String(task.id),null,{owner:supervisor},db);
 }
 return {alerts:db.prepare("SELECT COUNT(*) n FROM alerts WHERE status='Open'").get().n};
});}
export function saveAutomation(db,path,body,actor){if(actor.role!=='owner'||!actor.active)throw Error('إعداد الأتمتة للمالك');return transaction(db,()=>{
 if(path==='tasks/policy'){for(const [key,min,max] of [['expiry_days',0,365],['device_percent',1,100],['escalation_hours',1,8760]])if(!Number.isFinite(Number(body[key]))||Number(body[key])<min||Number(body[key])>max)throw Error('حدود التنبيه غير صحيحة');db.prepare('UPDATE automation_policy SET expiry_days=?,device_percent=?,escalation_hours=? WHERE id=1').run(Number(body.expiry_days),Number(body.device_percent),Number(body.escalation_hours));}
 else {const days=Number(body.every_days);if(!body.title||!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(body.owner)||!Number.isInteger(days)||days<1||days>3650||!['Normal','High','Critical'].includes(body.priority))throw Error('راجع المسؤول والتكرار والأولوية');validExpiry(body.due);if(!body.due)throw Error('الاستحقاق مطلوب');if(body.id)db.prepare('UPDATE recurring_tasks SET title=?,owner=?,due=?,every_days=?,priority=?,active=? WHERE id=?').run(body.title,body.owner,body.due,days,body.priority,Number(body.active)===0?0:1,body.id);else db.prepare('INSERT INTO recurring_tasks(title,owner,due,every_days,priority,active) VALUES(?,?,?,?,?,?)').run(body.title,body.owner,body.due,days,body.priority,Number(body.active)===0?0:1);}
 audit(actor.id,path+'.save',String(body.id||'new'),null,body,db);return {ok:true};
});}
