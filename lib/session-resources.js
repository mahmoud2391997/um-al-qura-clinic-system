import {transaction,consumeEquipment,stockMovement} from './operations.js';
export function validateSessionResources(data){
 for(const [idKey,quantityKey,label,integerQuantity] of [['equipment_id','equipment_quantity','الجهاز',true],['item_id','item_quantity','الصنف',false]]){
  const id=data[idKey],quantity=data[quantityKey];
  if(id===undefined||id===null||String(id).trim()===''){
   if(quantity!==undefined&&quantity!==null&&String(quantity).trim()!=='')throw Error('حدد رقم '+label+' مع الكمية');
   continue;
  }
  if(!Number.isInteger(Number(id))||Number(id)<=0)throw Error('رقم '+label+' غير صحيح');
  if(!Number.isFinite(Number(quantity))||Number(quantity)<=0||(integerQuantity&&!Number.isInteger(Number(quantity))))throw Error('كمية '+label+' غير صحيحة');
 }
}
export function approveClinicalSession(db,id,provider){return transaction(db,()=>{
 const record=db.prepare('SELECT c.*,d.structured FROM clinical c LEFT JOIN clinical_details d ON d.clinical_id=c.id WHERE c.id=? AND c.provider=?').get(id,provider);
 if(!record)throw Error('السجل غير متاح للممارس');
 if(record.approved)return {alreadyApproved:true};
 if(record.kind==='Session'){
  const data=JSON.parse(record.structured||'{}');validateSessionResources(data);
  const reference='CLINICAL-'+id;
  if(data.equipment_id)consumeEquipment(db,{id:Number(data.equipment_id),quantity:Number(data.equipment_quantity),reference},provider);
  if(data.item_id)stockMovement(db,{item_id:Number(data.item_id),kind:'Issue',quantity:Number(data.item_quantity),reason:'استهلاك جلسة معتمدة',reference},provider);
 }
 db.prepare('UPDATE clinical SET approved=1 WHERE id=?').run(id);
 return {alreadyApproved:false};
});}
