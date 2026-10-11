import {transaction,consumeEquipment,stockMovement} from './operations.js';
export function sessionResources(data){
 const resources=[];
 for(const [key,idKey,quantityKey,kind] of [['equipment','equipment_id','equipment_quantity','equipment'],['items','item_id','item_quantity','item']]){
  if(data[key]!==undefined){
   if(!Array.isArray(data[key])||data[key].length>100)throw Error('قائمة الموارد غير صحيحة');
   for(const row of data[key]){
    if(!row||typeof row!=='object')throw Error('بيانات المورد غير صحيحة');
    resources.push({kind,id:row.id,quantity:row.quantity});
   }
  }else if(data[idKey]!==undefined&&data[idKey]!==null&&String(data[idKey]).trim()!=='')resources.push({kind,id:data[idKey],quantity:data[quantityKey]});
  else if(data[quantityKey]!==undefined&&data[quantityKey]!==null&&String(data[quantityKey]).trim()!=='')throw Error('حدد المورد مع الكمية');
 }
 const totals=new Map();
 for(const row of resources){
  if(!Number.isInteger(Number(row.id))||Number(row.id)<=0)throw Error('رقم المورد غير صحيح');
  if(!Number.isFinite(Number(row.quantity))||Number(row.quantity)<=0||(row.kind==='equipment'&&!Number.isInteger(Number(row.quantity))))throw Error('كمية المورد غير صحيحة');
  const key=row.kind+':'+Number(row.id), previous=totals.get(key);
  const quantity=Number(row.quantity)+(previous?.quantity||0);
  if(!Number.isFinite(quantity))throw Error('كمية المورد غير صحيحة');
  totals.set(key,{kind:row.kind,id:Number(row.id),quantity});
 }
 return [...totals.values()];
}
export function validateSessionResources(data){sessionResources(data);}
export function approveClinicalSession(db,id,provider){return transaction(db,()=>{
 const record=db.prepare('SELECT c.*,d.structured FROM clinical c LEFT JOIN clinical_details d ON d.clinical_id=c.id WHERE c.id=? AND c.provider=?').get(id,provider);
 if(!record)throw Error('السجل غير متاح للممارس');
 if(record.approved)return {alreadyApproved:true};
 if(record.kind==='Session'){
  const data=JSON.parse(record.structured||'{}');validateSessionResources(data);
  const reference='CLINICAL-'+id;
  for(const resource of sessionResources(data)){
   if(resource.kind==='equipment')consumeEquipment(db,{id:resource.id,quantity:resource.quantity,reference},provider);
   else stockMovement(db,{item_id:resource.id,kind:'Issue',quantity:resource.quantity,reason:'استهلاك جلسة معتمدة',reference},provider);
  }
 }
 db.prepare('UPDATE clinical SET approved=1 WHERE id=?').run(id);
 return {alreadyApproved:false};
});}
