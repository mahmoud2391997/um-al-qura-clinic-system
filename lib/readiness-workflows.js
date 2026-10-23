import { marketingMetrics } from './marketing-metrics.js';
import { captureInvoiceFacts } from './financial-report.js';
import {randomUUID} from 'node:crypto';
import {audit} from './db.js';
import {transaction,stockMovement} from './operations.js';
import {patientVisible,scopeRows} from './data-scopes.js';
import {omanDate} from './stock-batches.js';
import {queueIntegration} from './integrations.js';
const required=(s,label)=>{if(typeof s!=='string'||!s.trim()||s.length>2000)throw Error(label+' مطلوب');return s.trim()};
function can(actor,permission){if(!actor.active||!actor.permissions.includes(permission))throw Error('الصلاحية المطلوبة غير متاحة');}
const owner=actor=>{if(!actor.active||actor.role!=='owner')throw Error('الإجراء للمالك فقط')};
function number(n,zero=true){n=Number(n);if(!Number.isFinite(n)||n<0||!zero&&n===0)throw Error('قيمة غير صحيحة');return n;}
function date(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('التاريخ غير صحيح');return s;}
export async function saveServicePrice(db,body,actor){owner(actor);
 if(body.action==='booking-duration')return transaction(db,async()=>{
  const service=await db.prepare('SELECT id FROM service_catalog WHERE id=? AND active=1').get(body.service_id);if(!service)throw Error('الخدمة غير متاحة');
  const before=await db.prepare('SELECT duration_minutes FROM service_booking_policy WHERE service_id=?').get(service.id);
  if(body.duration_minutes===null)await db.prepare('DELETE FROM service_booking_policy WHERE service_id=?').run(service.id);
  else{const duration=Number(body.duration_minutes);if(!Number.isInteger(duration)||duration<1||duration>1440)throw Error('مدة الخدمة يجب أن تكون دقائق صحيحة بين 1 و1440');await db.prepare('INSERT INTO service_booking_policy(service_id,duration_minutes) VALUES(?,?) ON CONFLICT(service_id) DO UPDATE SET duration_minutes=excluded.duration_minutes').run(service.id,duration)}
  await audit(actor.id,'service.booking.duration',service.id,before||null,{duration_minutes:body.duration_minutes},db);return {ok:true};
 });
 return transaction(db,async()=>{
 const name=required(body.name,'اسم الخدمة'),department=required(body.department,'القسم'),effective=date(body.effective_date),amount=number(body.amount,false),floor=number(body.floor);
 if(floor>amount)throw Error('حد السعر يتجاوز السعر الأساسي');
 let service=await db.prepare('SELECT * FROM service_catalog WHERE name=?').get(name);
 if(!service){service={id:randomUUID(),name,department};await db.prepare('INSERT INTO service_catalog(id,name,department) VALUES(?,?,?)').run(service.id,name,department)}
 else if(service.department!==department)throw Error('اسم الخدمة مرتبط بقسم مختلف؛ لا تغير التاريخ المسجل');
 if(body.duration_minutes!==undefined&&body.duration_minutes!==''){const duration=Number(body.duration_minutes);if(!Number.isInteger(duration)||duration<1||duration>1440)throw Error('مدة الخدمة يجب أن تكون دقائق صحيحة بين 1 و1440');await db.prepare('INSERT INTO service_booking_policy(service_id,duration_minutes) VALUES(?,?) ON CONFLICT(service_id) DO UPDATE SET duration_minutes=excluded.duration_minutes').run(service.id,duration)}
 const id=randomUUID();await db.prepare('INSERT INTO service_prices(id,service_id,effective_date,amount,floor,actor) VALUES(?,?,?,?,?,?)').run(id,service.id,effective,amount,floor,actor.id);
 await audit(actor.id,'service.price.created',service.id,null,{price_id:id,effective_date:effective},db);return {ok:true,id};
})}
export async function listServicePrices(db,actor){if(!actor.active||!['appointments.view','finance.view'].some(p=>actor.permissions.includes(p)))throw Error('غير مصرح');return db.prepare('SELECT p.*,s.name,s.department,b.duration_minutes FROM service_prices p JOIN service_catalog s ON s.id=p.service_id LEFT JOIN service_booking_policy b ON b.service_id=s.id WHERE s.active=1 ORDER BY s.name,p.effective_date DESC').all()}
export async function servicePrice(db,name,day=omanDate()){
 date(day);return db.prepare('SELECT p.*,s.name,s.department FROM service_prices p JOIN service_catalog s ON s.id=p.service_id WHERE s.name=? AND s.active=1 AND p.effective_date<=? ORDER BY p.effective_date DESC LIMIT 1').get(name,day);
}
export async function snapshotPrice(db,kind,id,price,amount){await db.prepare('INSERT INTO record_prices(kind,record_id,price_id,service_name,amount,floor) VALUES(?,?,?,?,?,?)').run(kind,id,price.id,price.name,amount,price.floor)}
export async function priceForRecord(db,name,day,amount){const exists=await db.prepare('SELECT id FROM service_catalog LIMIT 1').get();const price=await servicePrice(db,name,day);if(!exists&&process.env.NODE_ENV==='production'&&db.dialect==='postgres')throw Error('يلزم إعداد قائمة الخدمات والأسعار قبل التشغيل');if(exists&&!price)throw Error('اختر خدمة لها سعر ساري معتمد');if(price&&amount!==undefined&&number(amount,false)<price.floor)throw Error('السعر أقل من الحد؛ يلزم طلب تجاوز واعتماد منفصل');return price;}
export async function requestBelowCost(db,body,actor){can(actor,'finance.create');return transaction(db,async()=>{
 can(actor,'patients.view');if(!await patientVisible(db,Number(body.patient_id),actor))throw Error('المريض غير متاح');
 const key=required(body.idempotency_key,'مرجع منع التكرار');const previous=await db.prepare('SELECT * FROM below_cost_requests WHERE idempotency_key=?').get(key);if(previous){if(previous.creator!==actor.id)throw Error('مرجع مستخدم');return {ok:true,id:previous.id}}
 const price=await servicePrice(db,body.service,omanDate()),amount=number(body.amount,false);if(!price||amount>=price.floor)throw Error('طلب التجاوز يخص سعرًا أقل من حد خدمة معتمدة');
 const id=randomUUID();await db.prepare('INSERT INTO below_cost_requests(id,patient_id,price_id,amount,reason,creator,idempotency_key) VALUES(?,?,?,?,?,?,?)').run(id,Number(body.patient_id),price.id,amount,required(body.reason,'سبب التجاوز'),actor.id,key);await audit(actor.id,'price.override.request',id,null,{price_id:price.id},db);return {ok:true,id};
})}
export async function decideBelowCost(db,body,actor){can(actor,'finance.approve');return transaction(db,async()=>{
 const row=await db.prepare('SELECT * FROM below_cost_requests WHERE id=?').get(body.id);if(!row||row.creator===actor.id||!await patientVisible(db,row.patient_id,actor))throw Error('الموافق يجب أن يكون شخصًا آخر وله نطاق المريض');if(row.status!=='Pending')return {ok:true,invoice_id:row.invoice_id};
 const approve=body.action==='approve';if(!approve&&body.action!=='reject')throw Error('قرار غير صحيح');const reason=required(body.decision,'سبب القرار');let invoiceId=null;
 if(approve){const price=await db.prepare('SELECT p.*,s.name FROM service_prices p JOIN service_catalog s ON s.id=p.service_id WHERE p.id=?').get(row.price_id);invoiceId=Number((await db.prepare('INSERT INTO invoices(patient_id,service,amount) VALUES(?,?,?)').run(row.patient_id,price.name,row.amount)).lastInsertRowid);await snapshotPrice(db,'invoice',invoiceId,price,row.amount);await captureInvoiceFacts(db,invoiceId)}
 await db.prepare('UPDATE below_cost_requests SET status=?,reviewer=?,decision=?,invoice_id=? WHERE id=?').run(approve?'Approved':'Rejected',actor.id,reason,invoiceId,row.id);await audit(actor.id,'price.override.decision',row.id,null,{status:approve?'Approved':'Rejected',invoice_id:invoiceId},db);return {ok:true,invoice_id:invoiceId};
})}
export async function setAdjustmentPolicy(db,body,actor){owner(actor);const quantity=number(body.quantity_limit),value=number(body.value_limit);await db.prepare('INSERT INTO stock_adjustment_policy(id,quantity_limit,value_limit) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET quantity_limit=excluded.quantity_limit,value_limit=excluded.value_limit').run(quantity,value);await audit(actor.id,'inventory.adjustment.policy','1',null,{quantity_limit:quantity,value_limit:value},db);return {ok:true}}
export async function requestAdjustment(db,body,actor){can(actor,'inventory.create');return transaction(db,async()=>{
 const key=required(body.idempotency_key,'مرجع منع التكرار');const previous=await db.prepare('SELECT * FROM stock_adjustment_requests WHERE idempotency_key=?').get(key);if(previous){if(previous.creator!==actor.id)throw Error('مرجع مستخدم');return {ok:true,id:previous.id,status:previous.status}}
 const policy=await db.prepare('SELECT * FROM stock_adjustment_policy WHERE id=1').get(),item=await db.prepare('SELECT * FROM inventory WHERE id=?').get(Number(body.item_id));if(!policy)throw Error('المالك لم يحدد حدود تسوية الجرد بعد');if(!item)throw Error('الصنف غير موجود');const quantity=number(body.quantity),delta=Math.abs(item.quantity-quantity),reason=required(body.reason,'سبب التسوية');
 const large=delta>policy.quantity_limit||delta*item.average_cost>policy.value_limit;const id=randomUUID();await db.prepare('INSERT INTO stock_adjustment_requests(id,item_id,previous,quantity,cost,reason,creator,idempotency_key) VALUES(?,?,?,?,?,?,?,?)').run(id,item.id,item.quantity,quantity,item.average_cost,reason,actor.id,key);
 if(!large){const moved=await stockMovement(db,{item_id:item.id,kind:'Adjustment',quantity,cost:item.average_cost,reason,reference:id},actor.id);await db.prepare("UPDATE stock_adjustment_requests SET status='Applied',movement_id=? WHERE id=?").run(moved.movement_id,id)}
 await audit(actor.id,'inventory.adjustment.request',id,null,{requires_approval:large},db);return {ok:true,id,status:large?'Pending':'Applied'};
})}
export async function decideAdjustment(db,body,actor){can(actor,'inventory.approve');return transaction(db,async()=>{
 const row=await db.prepare('SELECT * FROM stock_adjustment_requests WHERE id=?').get(body.id);if(!row||row.creator===actor.id)throw Error('يلزم موافق مستقل');if(row.status!=='Pending')return {ok:true};const decision=required(body.decision,'سبب القرار');let movement=null;if(body.action==='approve'){const item=await db.prepare('SELECT * FROM inventory WHERE id=?').get(row.item_id);if(item.quantity!==row.previous||item.average_cost!==row.cost)throw Error('تغير رصيد الصنف؛ أنشئ طلبًا جديدًا');movement=(await stockMovement(db,{item_id:row.item_id,kind:'Adjustment',quantity:row.quantity,cost:row.cost,reason:row.reason,reference:row.id},actor.id)).movement_id}else if(body.action!=='reject')throw Error('قرار غير صحيح');
 await db.prepare('UPDATE stock_adjustment_requests SET status=?,reviewer=?,decision=?,movement_id=? WHERE id=?').run(body.action==='approve'?'Approved':'Rejected',actor.id,decision,movement,row.id);await audit(actor.id,'inventory.adjustment.decision',row.id,null,{movement_id:movement},db);return {ok:true};
})}
export async function issueMaintenancePart(db,body,actor){can(actor,'equipment.edit');can(actor,'inventory.create');return transaction(db,async()=>{
 const key=required(body.idempotency_key,'مرجع منع التكرار');const previous=await db.prepare('SELECT * FROM maintenance_parts WHERE idempotency_key=?').get(key);if(previous){if(previous.creator!==actor.id)throw Error('مرجع مستخدم');return {ok:true,id:previous.id}}
 const ticket=await db.prepare('SELECT * FROM maintenance WHERE id=?').get(Number(body.ticket_id));if(!ticket||ticket.status==='Completed')throw Error('تذكرة الصيانة غير متاحة');const item=await db.prepare('SELECT average_cost FROM inventory WHERE id=?').get(Number(body.item_id));if(!item)throw Error('الصنف غير موجود');const id=randomUUID();const movement=await stockMovement(db,{item_id:Number(body.item_id),kind:'Issue',quantity:number(body.quantity,false),cost:item.average_cost,reason:required(body.reason,'سبب الصرف'),reference:'maintenance:'+ticket.id},actor.id);await db.prepare('INSERT INTO maintenance_parts(id,ticket_id,movement_id,creator,idempotency_key) VALUES(?,?,?,?,?)').run(id,ticket.id,movement.movement_id,actor.id,key);await audit(actor.id,'maintenance.part.issue',String(ticket.id),null,{movement_id:movement.movement_id},db);return {ok:true,id};
})}
export async function linkLeadVisit(db,body,actor){can(actor,'marketing.edit');can(actor,'appointments.view');return transaction(db,async()=>{
 const lead=await db.prepare('SELECT * FROM leads WHERE id=?').get(Number(body.lead_id)),appointment=await db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(body.appointment_id));if(!lead||!appointment||!await patientVisible(db,appointment.patient_id,actor))throw Error('الاستفسار أو الموعد غير متاح');
 const visible=await scopeRows(db,'appointments',[appointment],actor);if(!visible.length)throw Error('الموعد خارج نطاق الحساب');
 const previous=await db.prepare('SELECT * FROM lead_visits WHERE lead_id=?').get(lead.id);if(previous){if(previous.appointment_id!==appointment.id)throw Error('الاستفسار مرتبط بموعد آخر');return {ok:true}}
 await db.prepare("INSERT INTO lead_visits(lead_id,patient_id,appointment_id,stage) VALUES(?,?,?,'Booked')").run(lead.id,appointment.patient_id,appointment.id);await transition(db,lead.id,'Booked',actor.id);return {ok:true};
})}
async function transition(db,id,stage,actor){await db.prepare('INSERT INTO lead_transitions(id,lead_id,stage,actor,time) VALUES(?,?,?,?,?)').run(randomUUID(),id,stage,actor,new Date().toISOString());await db.prepare('UPDATE lead_visits SET stage=? WHERE lead_id=?').run(stage,id);await db.prepare('UPDATE leads SET status=? WHERE id=?').run(stage==='ReviewRequested'?'Attended':stage,id)}
export async function syncLeadVisits(db){for(const row of await db.prepare('SELECT v.*,a.status,a.arrived FROM lead_visits v JOIN appointments a ON a.id=v.appointment_id').all()){
 if(row.stage==='Booked'&&(row.arrived||['Arrived','Waiting','In Service','Completed'].includes(row.status)))await transition(db,row.lead_id,'Attended','automation');
 if(row.status==='Completed'&&row.stage!=='ReviewRequested'){await queueIntegration(db,{kind:'review_request',reference:'appointment:'+row.appointment_id,payload:{appointment_id:row.appointment_id},idempotencyKey:'review:'+row.appointment_id});await transition(db,row.lead_id,'ReviewRequested','automation')}
}}
export async function funnelMetrics(db,actor){can(actor,'marketing.view');return marketingMetrics(db)}
export async function filteredReport(db,filters,actor){can(actor,'reports.view');const from=filters.from?date(filters.from):null,to=filters.to?date(filters.to):null;if(from&&to&&from>to)throw Error('الفترة غير صحيحة');const services=await db.prepare('SELECT name,department FROM service_catalog').all();const department=new Map(services.map(s=>[s.name,s.department]));
 let appointments=actor.permissions.includes('appointments.view')?await scopeRows(db,'appointments',await db.prepare('SELECT * FROM appointments').all(),actor):[];
 appointments=appointments.filter(a=>(!from||a.start?.slice(0,10)>=from)&&(!to||a.start?.slice(0,10)<=to)&&(!filters.service||a.service===filters.service)&&(!filters.provider||a.provider===filters.provider)&&(!filters.department||department.get(a.service)===filters.department));
 const elapsed=(a,b)=>{const n=(Date.parse(b)-Date.parse(a))/60000;return Number.isFinite(n)&&n>=0?n:null};const waits=appointments.map(a=>elapsed(a.arrived,a.started)).filter(n=>n!==null);const scheduled=appointments.filter(a=>!['Cancelled','No show'].includes(a.status)).reduce((n,a)=>n+(elapsed(a.start,a.end)||0),0);const used=appointments.filter(a=>a.status==='Completed').reduce((n,a)=>n+(elapsed(a.start,a.end)||0),0);
 return {appointments:appointments.length,completed:appointments.filter(a=>a.status==='Completed').length,scheduled_minutes:scheduled,completed_scheduled_minutes:used,utilization:scheduled?used/scheduled:0,average_wait_minutes:waits.length?waits.reduce((a,b)=>a+b,0)/waits.length:null,waiting_samples:waits.length,definition:'utilization = completed scheduled minutes / non-cancelled scheduled minutes; not staff capacity',filters:{from,to,service:filters.service||null,provider:filters.provider||null,department:filters.department||null}};
}
