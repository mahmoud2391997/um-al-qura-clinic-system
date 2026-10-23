import { clinicDay } from './cashbox.js';
import {lockRecord} from './row-locks.js';
import { validateHomeProgram } from './clinical-programs.js';
import { transaction, consumeEquipment, stockMovement } from './operations.js';
export function sessionResources(data) {
  const resources = [];
  for (const [key, idKey, quantityKey, kind] of [['equipment', 'equipment_id', 'equipment_quantity', 'equipment'], ['items', 'item_id', 'item_quantity', 'item']]) {
    if (data[key] !== undefined) {
      if (!Array.isArray(data[key]) || data[key].length > 100) throw Error('قائمة الموارد غير صحيحة');
      for (const row of data[key]) {
        if (!row || typeof row !== 'object') throw Error('بيانات المورد غير صحيحة');
        resources.push({
          kind,
          id: row.id,
          quantity: row.quantity
        });
      }
    } else if (data[idKey] !== undefined && data[idKey] !== null && String(data[idKey]).trim() !== '') resources.push({
      kind,
      id: data[idKey],
      quantity: data[quantityKey]
    });else if (data[quantityKey] !== undefined && data[quantityKey] !== null && String(data[quantityKey]).trim() !== '') throw Error('حدد المورد مع الكمية');
  }
  const totals = new Map();
  for (const row of resources) {
    if (!Number.isInteger(Number(row.id)) || Number(row.id) <= 0) throw Error('رقم المورد غير صحيح');
    if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0 || row.kind === 'equipment' && !Number.isInteger(Number(row.quantity))) throw Error('كمية المورد غير صحيحة');
    const key = row.kind + ':' + Number(row.id),
      previous = totals.get(key);
    const quantity = Number(row.quantity) + (previous?.quantity || 0);
    if (!Number.isFinite(quantity)) throw Error('كمية المورد غير صحيحة');
    totals.set(key, {
      kind: row.kind,
      id: Number(row.id),
      quantity
    });
  }
  return [...totals.values()];
}
export function validateSessionResources(data) {
  sessionResources(data);
}
export async function approveClinicalSession(db, id, provider) {
  return await transaction(db, async () => {
    await lockRecord(db,'clinical',id);
    const record = await db.prepare('SELECT c.*,d.structured FROM clinical c LEFT JOIN clinical_details d ON d.clinical_id=c.id WHERE c.id=? AND c.provider=?').get(id, provider);
    if (!record) throw Error('السجل غير متاح للممارس');
    if (record.approved) return {
      alreadyApproved: true
    };
    if (record.kind === 'Home Program') validateHomeProgram(JSON.parse(record.structured || '{}'));
    if (record.kind === 'Session') {
      const data = JSON.parse(record.structured || '{}');
      validateSessionResources(data);
      const reference = 'CLINICAL-' + id;
      let consumables = 0,
        deviceCost = 0;
      for (const resource of sessionResources(data).sort((a,b)=>a.kind.localeCompare(b.kind)||a.id-b.id)) {
        if (resource.kind === 'equipment') {
          const used = await consumeEquipment(db, {
            id: resource.id,
            quantity: resource.quantity,
            reference
          }, provider);
          deviceCost += used.before.capacity ? used.before.replacement_cost / used.before.capacity * resource.quantity : 0;
        } else {
          const movement = await stockMovement(db, {
            item_id: resource.id,
            kind: 'Issue',
            quantity: resource.quantity,
            reason: 'استهلاك جلسة معتمدة',
            reference
          }, provider);
          consumables += (await db.prepare('SELECT COALESCE(SUM(a.quantity*b.cost),0) n FROM stock_allocations a JOIN stock_batches b ON b.id=a.batch_id WHERE a.movement_id=?').get(movement.movement_id)).n;
        }
      }
      const rate = await db.prepare('SELECT * FROM cost_rates WHERE provider=?').get(provider),
        minutes = Number(data.minutes || 0),
        staff = rate && minutes ? rate.hourly * minutes / 60 : 0,
        overhead = rate?.overhead || 0;
      await db.prepare('INSERT INTO session_report_facts(clinical_id,approved_day) VALUES(?,?) ON CONFLICT(clinical_id) DO NOTHING').run(id,clinicDay());
      await db.prepare('INSERT INTO clinical_costs VALUES(?,?,?,?,?,?,?,?)').run(id, minutes, staff, consumables, deviceCost, overhead, staff + consumables + deviceCost + overhead, Number(!!rate && minutes > 0));
    }
    if (record.kind === 'Discharge') await db.prepare("UPDATE episodes SET status='Closed' WHERE id=(SELECT episode_id FROM clinical_details WHERE clinical_id=?)").run(id);
    await db.prepare('UPDATE clinical SET approved=1 WHERE id=?').run(id);
    return {
      alreadyApproved: false
    };
  });
}
