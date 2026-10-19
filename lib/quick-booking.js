import {lockResources,lockAppointmentResources} from './row-locks.js';
import {createHash} from 'node:crypto';
import {transaction} from './operations.js';
import {audit} from './db.js';
import {assignedScope,patientVisible} from './data-scopes.js';
import {checkAppointment} from './appointment-workflow.js';
import {servicePrice,snapshotPrice} from './readiness-workflows.js';
import {appointmentEnd} from './booking-time.js';
function requirePermission(actor,permission){if(!actor.active||!actor.permissions.includes(permission))throw Object.assign(Error('الصلاحية المطلوبة غير متاحة'),{status:403})}
export async function quickBook(db,body,actor){
 for(const p of ['patients.view','appointments.view','appointments.create'])requirePermission(actor,p);
 if(body.patient)requirePermission(actor,'patients.create');
 if(typeof body.request_id!=='string'||!/^[a-f0-9-]{36}$/.test(body.request_id))throw Error('مرجع الحجز غير صحيح');
 const fingerprint=createHash('sha256').update(JSON.stringify([body.patient_id||null,body.patient||null,body.provider,body.service,body.start,body.end||null,body.room||'',body.package_id||null])).digest('hex');
 return transaction(db,async()=>{
  await lockResources(db,['booking-request:'+body.request_id,body.patient?'patient-phone:'+createHash('sha256').update(String(body.patient.phone||'').trim()).digest('hex'):null]);
  await lockAppointmentResources(db,body);
  const previous=await db.prepare('SELECT * FROM booking_requests WHERE id=?').get(body.request_id);
  if(previous){if(previous.actor!==actor.id||previous.fingerprint!==fingerprint)throw Error('مرجع الحجز مستخدم لطلب آخر');return {ok:true,patient_id:Number(previous.patient_id),appointment_id:Number(previous.appointment_id)}}
  const provider=await db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('doctor','physio','physio_lead')").get(body.provider);
  if(!provider)throw Error('اختر ممارسًا نشطًا');
  if(await assignedScope(db,actor,'appointments')&&body.provider!==actor.id)throw Object.assign(Error('الموعد خارج نطاق حسابك'),{status:403});
  const price=await servicePrice(db,body.service,body.start?.slice(0,10));if(!price)throw Error('أعد قائمة الخدمات والأسعار السارية أولًا');
  const policy=await db.prepare('SELECT duration_minutes FROM service_booking_policy WHERE service_id=?').get(price.service_id);
  const end=policy?.duration_minutes?appointmentEnd(body.start,Number(policy.duration_minutes)):body.end;
  let patientId=Number(body.patient_id),patientCreated=false;
  if(body.patient){
   if(body.patient_id)throw Error('اختر ملفًا موجودًا أو مريضًا جديدًا');
   const name=String(body.patient.name||'').trim(),phone=String(body.patient.phone||'').trim(),birth=String(body.patient.birth||'');
   if(!name||name.length>200||!phone||phone.length>50)throw Error('اسم المريض ورقم الهاتف مطلوبان');
   if(birth&&(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||!Number.isFinite(Date.parse(birth+'T00:00:00Z'))||new Date(birth+'T00:00:00Z').toISOString().slice(0,10)!==birth))throw Error('تاريخ الميلاد غير صحيح');
   if(await db.prepare('SELECT id FROM patients WHERE phone=? AND active=1').get(phone))throw Error('يوجد ملف بنفس الهاتف؛ ابحث عنه أو راجع التسجيل من صفحة المرضى');
   patientId=Number((await db.prepare('INSERT INTO patients(name,phone,birth,creator) VALUES(?,?,?,?)').run(name,phone,birth,actor.id)).lastInsertRowid);
   patientCreated=true;
  }else if(!Number.isInteger(patientId)||patientId<1||!await patientVisible(db,patientId,actor))throw Object.assign(Error('ملف المريض غير متاح'),{status:403});
  await checkAppointment(db,{...body,patient_id:patientId,end});
  const appointmentId=Number((await db.prepare('INSERT INTO appointments(patient_id,provider,start,end,room,service) VALUES(?,?,?,?,?,?)').run(patientId,body.provider,body.start,end,body.room||'',body.service)).lastInsertRowid);
  if(body.package_id){const {linkPackage}=await import('./packages.js');await linkPackage(db,appointmentId,body.package_id)}
  await snapshotPrice(db,'appointment',appointmentId,price,price.amount);
  await db.prepare('INSERT INTO booking_requests(id,actor,fingerprint,patient_id,appointment_id) VALUES(?,?,?,?,?)').run(body.request_id,actor.id,fingerprint,patientId,appointmentId);
  if(patientCreated)await audit(actor.id,'patients.save',String(patientId),null,{createdFromBooking:true},db);
  await audit(actor.id,'appointments.create',String(appointmentId),null,{patient_id:patientId,provider:body.provider,start:body.start,end,price_id:price.id},db);
  return {ok:true,patient_id:patientId,appointment_id:appointmentId};
 });
}
