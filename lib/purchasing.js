import {transaction,stockMovement} from './operations.js';
import {audit} from './db.js';
import {validExpiry} from './stock-batches.js';
const permission=(actor,action)=>{if(!actor.active||!actor.permissions.includes('purchasing.'+action))throw Error('ليس لديك صلاحية المشتريات لهذا الإجراء');};
const visible=(request,actor)=>request.creator===actor.id||actor.permissions.includes('purchasing.approve');
function required(value,label){if(!String(value??'').trim())throw Error(label+' مطلوب');return String(value).trim();}
function itemsFor(db,input){if(!Array.isArray(input)||!input.length||input.length>100)throw Error('أضف أصناف الطلب');const seen=new Set();return input.map(row=>{const id=Number(row.item_id),quantity=Number(row.quantity),price=Number(row.price);if(!Number.isInteger(id)||!db.prepare('SELECT id FROM inventory WHERE id=?').get(id))throw Error('الصنف غير موجود');if(seen.has(id))throw Error('لا تكرر الصنف في الطلب');seen.add(id);if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<0)throw Error('الكمية أو السعر غير صحيح');return {item_id:id,quantity,price};});}
function requestFor(db,id,actor){const request=db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(id);if(!request||!visible(request,actor))throw Error('الطلب غير متاح');return request;}
export function listPurchasing(db,path,actor){permission(actor,'view');const all=actor.permissions.includes('purchasing.approve');
 if(path==='purchasing/catalog')return db.prepare('SELECT id,name,unit,quantity FROM inventory ORDER BY name').all();
 if(path==='purchasing/requests')return db.prepare('SELECT p.*,u.name requester FROM purchase_requests p JOIN users u ON u.id=p.creator WHERE ? OR p.creator=? ORDER BY p.id DESC').all(Number(all),actor.id).map(r=>({...r,items:JSON.parse(r.items)}));
 if(path==='purchasing/orders')return db.prepare('SELECT o.*,r.title,r.supplier,r.creator requester_id,r.items,r.total FROM purchase_orders o JOIN purchase_requests r ON r.id=o.request_id WHERE ? OR r.creator=? ORDER BY o.id DESC').all(Number(all),actor.id).map(o=>({...o,items:JSON.parse(o.items).map(i=>({...i,received:db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM purchase_receipts WHERE order_id=? AND item_id=?').get(o.id,i.item_id).n}))}));
 return db.prepare('SELECT t.*,i.name item FROM purchase_receipts t JOIN inventory i ON i.id=t.item_id JOIN purchase_orders o ON o.id=t.order_id JOIN purchase_requests r ON r.id=o.request_id WHERE ? OR r.creator=? ORDER BY t.id DESC').all(Number(all),actor.id);
}
export function savePurchasing(db,path,body,actor){return transaction(db,()=>{
 let before=null,after=null;
 if(path==='purchasing/requests'){
  if(['approve','reject'].includes(body.action)){
   permission(actor,'approve');before=requestFor(db,body.id,actor);
   if(before.status!=='Submitted')throw Error('الطلب ليس بانتظار الموافقة');
   if(before.creator===actor.id)throw Error('لا يجوز اعتماد أو رفض طلبك بنفسك');
   const reason=body.action==='reject'?required(body.decision_reason,'سبب الرفض'):String(body.decision_reason||'');
   db.prepare('UPDATE purchase_requests SET status=?,reviewer=?,decision_reason=? WHERE id=?').run(body.action==='approve'?'Approved':'Rejected',actor.id,reason,before.id);
   after=db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(before.id);
  }else{
   if(body.id){permission(actor,'edit');before=requestFor(db,body.id,actor);if(before.creator!==actor.id||before.status!=='Draft')throw Error('التعديل لمقدم الطلب على المسودة فقط');}else permission(actor,'create');
   const items=itemsFor(db,body.items),total=items.reduce((n,i)=>n+i.quantity*i.price,0);if(!Number.isFinite(total))throw Error('إجمالي الطلب غير صحيح');
   const values=[required(body.title,'العنوان'),required(body.department,'القسم'),validExpiry(required(body.needed,'تاريخ الاحتياج')),required(body.priority,'الأولوية'),required(body.reason,'سبب الطلب'),String(body.supplier||''),String(body.cost_center||''),body.action==='submit'?'Submitted':'Draft',JSON.stringify(items),total];
   if(!['Normal','High','Critical'].includes(body.priority))throw Error('الأولوية غير صحيحة');
   let id=body.id;if(id)db.prepare('UPDATE purchase_requests SET title=?,department=?,needed=?,priority=?,reason=?,supplier=?,cost_center=?,status=?,items=?,total=? WHERE id=?').run(...values,id);else id=Number(db.prepare('INSERT INTO purchase_requests(title,department,needed,priority,reason,supplier,cost_center,status,items,total,creator) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...values,actor.id).lastInsertRowid);
   after=db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(id);
  }
 }else if(path==='purchasing/orders'&&body.action==='convert'){
  permission(actor,'create');const request=requestFor(db,body.request_id,actor);if(request.status!=='Approved')throw Error('اعتماد الطلب مطلوب قبل أمر الشراء');
  const existing=db.prepare('SELECT * FROM purchase_orders WHERE request_id=?').get(request.id);if(existing)return {before:null,after:existing};
  const id=Number(db.prepare('INSERT INTO purchase_orders(request_id,creator) VALUES(?,?)').run(request.id,actor.id).lastInsertRowid);after=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
 }else if(path==='purchasing/orders'&&body.action==='receive'){
  permission(actor,'edit');const order=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.id);if(!order)throw Error('أمر الشراء غير موجود');const request=requestFor(db,order.request_id,actor);
  const key=required(body.idempotency_key,'معرف الاستلام');if(key.length>200)throw Error('معرف الاستلام غير صحيح');
  const existing=db.prepare('SELECT * FROM purchase_receipts WHERE idempotency_key=?').get(key);
  if(existing){if(existing.order_id!==order.id||existing.item_id!==Number(body.item_id)||existing.quantity!==Number(body.quantity)||existing.batch_number!==String(body.batch_number)||existing.batch_expiry!==String(body.batch_expiry||'')||existing.reference!==String(body.reference||''))throw Error('معرف الاستلام مستخدم لعملية مختلفة');return {before:null,after:existing};}
  if(order.status==='Received')throw Error('تم استلام أمر الشراء بالكامل');const line=JSON.parse(request.items).find(i=>i.item_id===Number(body.item_id));if(!line)throw Error('الصنف ليس ضمن أمر الشراء');
  const qty=Number(body.quantity),received=db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM purchase_receipts WHERE order_id=? AND item_id=?').get(order.id,line.item_id).n;if(!Number.isFinite(qty)||qty<=0||qty>line.quantity-received)throw Error('الكمية تتجاوز المتبقي في أمر الشراء');
  stockMovement(db,{item_id:line.item_id,kind:'Receipt',quantity:qty,cost:line.price,batch_number:body.batch_number,batch_expiry:body.batch_expiry,reference:'PO-'+order.id+' '+String(body.reference||''),reason:'استلام أمر شراء معتمد'},actor.id);
  const receiptId=Number(db.prepare('INSERT INTO purchase_receipts(order_id,item_id,quantity,batch_number,batch_expiry,reference,actor,idempotency_key) VALUES(?,?,?,?,?,?,?,?)').run(order.id,line.item_id,qty,body.batch_number,body.batch_expiry||'',body.reference||'',actor.id,key).lastInsertRowid);
  const complete=JSON.parse(request.items).every(i=>db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM purchase_receipts WHERE order_id=? AND item_id=?').get(order.id,i.item_id).n>=i.quantity);
  before=order;db.prepare('UPDATE purchase_orders SET status=? WHERE id=?').run(complete?'Received':'Partial',order.id);after={...db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(order.id),receipt_id:receiptId};
 }else throw Error('إجراء المشتريات غير صحيح');
 audit(actor.id,path+'.'+(body.action||'save'),String(after.id),before,after,db);return {before,after};
});}
