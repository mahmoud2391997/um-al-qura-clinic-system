import {randomUUID} from 'node:crypto';
import {transaction} from './operations.js';
import {omanDate} from './stock-batches.js';
const optionalFields=['purchase_date','purchase_cost','vendor_id','maintenance_interval_days','last_maintenance','next_maintenance'];
function date(value,label){
 if(!value)return '';
 const text=String(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text+'T00:00:00Z'))||new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)throw Error(label+' غير صحيح');
 return text;
}
function daysAfter(value,days){return new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export async function validateAsset(db,body){
 const previous=body.id?await db.prepare('SELECT * FROM equipment WHERE id=?').get(body.id):null;
 // Old clients may omit the newly added fields; never erase an existing purchase history.
 for(const key of optionalFields)if(body[key]===undefined&&previous)body[key]=previous[key];
 for(const key of ['purchase_date','last_maintenance','next_maintenance'])body[key]=date(body[key],key);
 if(body.purchase_cost!==undefined&&body.purchase_cost!==null&&body.purchase_cost!==''){
  const cost=Number(body.purchase_cost);if(!Number.isFinite(cost)||cost<0)throw Error('قيمة الشراء غير صحيحة');body.purchase_cost=cost;
 }else body.purchase_cost=null;
 if(body.maintenance_interval_days!==undefined&&body.maintenance_interval_days!==null&&body.maintenance_interval_days!==''){
  const interval=Number(body.maintenance_interval_days);if(!Number.isInteger(interval)||interval<1||interval>36500)throw Error('دورية الصيانة عدد صحيح موجب حتى 36500 يوم');body.maintenance_interval_days=interval;
 }else body.maintenance_interval_days=null;
 if(body.last_maintenance&&body.next_maintenance&&body.next_maintenance<body.last_maintenance)throw Error('الصيانة القادمة قبل آخر صيانة');
 if(body.purchase_date&&body.last_maintenance&&body.last_maintenance<body.purchase_date)throw Error('آخر صيانة قبل تاريخ الشراء');
 if(body.vendor_id){
  const vendor=await db.prepare('SELECT * FROM vendors WHERE id=?').get(body.vendor_id);
  if(!vendor||vendor.status!=='Active'&&body.vendor_id!==previous?.vendor_id)throw Error('اختر موردًا نشطًا من سجل الموردين');
 }else body.vendor_id=null;
}
export async function validateVendor(db,body){
 return transaction(db,async()=>{
  const before=body.id?await db.prepare('SELECT * FROM vendors WHERE id=?').get(body.id):null;
  if(body.id&&!before)throw Error('المورد غير موجود');
  const text=(key,max)=>{const v=String(body[key]??'').trim();if(v.length>max||/[\u0000-\u001f]/.test(v))throw Error('بيانات المورد غير صحيحة');return v;};
  const name=text('name',200),registration=text('registration',100),phone=text('phone',50),email=text('email',254),address=text('address',1000),status=body.status;
  if(!name||!registration)throw Error('اسم المورد ورقم التسجيل / المرجع مطلوبان');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('البريد الإلكتروني غير صحيح');
  if(phone&&!/^[+\d() .-]{3,50}$/.test(phone))throw Error('الهاتف غير صحيح');
  if(!['Active','Inactive'].includes(status))throw Error('حالة المورد غير صحيحة');
  const duplicate=await db.prepare('SELECT id FROM vendors WHERE registration=?').get(registration);
  if(duplicate&&duplicate.id!==before?.id)throw Error('رقم تسجيل المورد / المرجع مستخدم');
  const id=before?.id||randomUUID();
  if(before)await db.prepare('UPDATE vendors SET name=?,registration=?,phone=?,email=?,address=?,status=? WHERE id=?').run(name,registration,phone,email,address,status,id);
  else await db.prepare('INSERT INTO vendors(id,name,registration,phone,email,address,status) VALUES(?,?,?,?,?,?,?)').run(id,name,registration,phone,email,address,status);
  return {before,after:await db.prepare('SELECT * FROM vendors WHERE id=?').get(id)};
 });
}
export async function completeAssetMaintenance(db,body){
 return transaction(db,async()=>{
  const before=await db.prepare('SELECT * FROM maintenance WHERE id=?').get(body.id);
  if(!before)throw Error('البلاغ غير موجود');
  if(before.status==='Completed')return {before,after:before};
  const device=await db.prepare('SELECT * FROM equipment WHERE id=?').get(before.equipment_id);
  const completed=omanDate();
  if(device.last_maintenance&&device.last_maintenance>completed)throw Error('تاريخ آخر صيانة يتجاوز تاريخ الإغلاق');
  const started=String(before.opened||before.due||'');
  const instant=Date.parse(started.length===10?started+'T00:00:00Z':started.replace(' ','T')+(/(?:Z|[+-]\d{2}:\d{2})$/.test(started)?'':'Z'));
  if(!Number.isFinite(instant))throw Error('تاريخ بدء الصيانة غير صحيح');
  const downtime=Math.max(0,(Date.now()-instant)/3600000);
  await db.prepare("UPDATE maintenance SET status='Completed',closed=CURRENT_TIMESTAMP,downtime_hours=? WHERE id=?").run(downtime,body.id);
  const next=device.maintenance_interval_days?daysAfter(completed,device.maintenance_interval_days):device.next_maintenance;
  await db.prepare('UPDATE equipment SET last_maintenance=?,next_maintenance=? WHERE id=?').run(completed,next,device.id);
  // Closing a ticket does not automatically release an unsafe or retired device.
  return {before:{...before,equipment:device},after:{...await db.prepare('SELECT * FROM maintenance WHERE id=?').get(body.id),equipment:await db.prepare('SELECT * FROM equipment WHERE id=?').get(device.id)}};
 });
}
