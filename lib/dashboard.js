import {assignedScope} from './data-scopes.js';
import {omanDate} from './stock-batches.js';
const amount=value=>Math.round(Number(value||0)*1000)/1000;
/** Only return aggregates for modules the caller can read; no patient narratives or cross-role counts. */
export async function dashboardSummary(db,actor,now=new Date()){
 if(!actor?.active)throw Error('Authentication required');
 const can=module=>actor.permissions?.includes(module+'.view'),date=omanDate(now),sections={};
 if(can('patients')){
  const assigned=await assignedScope(db,actor,'patients');
  const query=assigned?'SELECT COUNT(*) n FROM patients p WHERE p.creator=? OR EXISTS(SELECT 1 FROM clinical c WHERE c.patient_id=p.id AND c.provider=?) OR EXISTS(SELECT 1 FROM appointments a WHERE a.patient_id=p.id AND a.provider=?)':'SELECT COUNT(*) n FROM patients';
  sections.patients={total:Number((await db.prepare(query).get(...(assigned?[actor.id,actor.id,actor.id]:[]))).n)};
 }
 if(can('appointments')){
  const assigned=await assignedScope(db,actor,'appointments');
  const rows=await db.prepare('SELECT status FROM appointments WHERE substr(start,1,10)=?'+(assigned?' AND provider=?':'')).all(...(assigned?[date,actor.id]:[date]));
  sections.appointments={today:rows.length,waiting:rows.filter(r=>['Arrived','Waiting'].includes(r.status)).length,inService:rows.filter(r=>r.status==='In Service').length,completed:rows.filter(r=>r.status==='Completed').length};
 }
 if(can('tasks')){
  const all=actor.role==='owner'||actor.permissions.includes('tasks.approve');
  const row=await db.prepare("SELECT COUNT(*) n,COALESCE(SUM(CASE WHEN due IS NOT NULL AND due<>'' AND substr(due,1,10)<? THEN 1 ELSE 0 END),0) overdue FROM tasks WHERE status NOT IN ('Completed','Cancelled')"+(all?'':' AND owner=?')).get(...(all?[date]:[date,actor.id]));
  sections.tasks={open:Number(row.n),overdue:Number(row.overdue)};
 }
 if(can('finance')){
  const debt=await db.prepare('SELECT COALESCE(SUM(CASE WHEN amount>paid THEN amount-paid ELSE 0 END),0) n FROM invoices').get();
  // SQLite timestamps are UTC; the translator uses the equivalent +4-hour PostgreSQL date expression.
  const receipts=await db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='Payment' THEN amount WHEN kind='Refund' THEN -amount ELSE 0 END),0) n FROM payments WHERE date(time,'+4 hours')=?").get(date);
  sections.finance={outstanding:amount(debt.n),collectionsToday:amount(receipts.n)};
 }
 if(can('equipment')){
  const blocked=await db.prepare("SELECT COUNT(*) n FROM equipment e WHERE e.status<>'Active' OR (e.capacity>0 AND e.used>=e.capacity) OR EXISTS(SELECT 1 FROM maintenance m WHERE m.equipment_id=e.id AND m.priority='Critical' AND m.status NOT IN ('Completed','Cancelled'))").get();
  const due=await db.prepare("SELECT COUNT(*) n FROM equipment e WHERE e.status<>'Retired' AND ((e.next_maintenance<>'' AND e.next_maintenance<=?) OR EXISTS(SELECT 1 FROM maintenance m WHERE m.equipment_id=e.id AND m.status NOT IN ('Completed','Cancelled') AND substr(m.due,1,10)<=?))").get(date,date);
  sections.equipment={unavailable:Number(blocked.n),maintenanceDue:Number(due.n)};
 }
 if(can('inventory')){
  const stock=await db.prepare('SELECT COUNT(*) n FROM inventory WHERE quantity<=minimum').get(),expired=await db.prepare("SELECT COUNT(*) n FROM stock_batches WHERE quantity>0 AND expiry<>'' AND expiry<?").get(date);
  sections.inventory={lowStock:Number(stock.n),expiredBatches:Number(expired.n)};
 }
 return {date,sections};
}
