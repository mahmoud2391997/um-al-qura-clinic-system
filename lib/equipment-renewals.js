import { transaction } from './operations.js';
import { audit } from './db.js';
import { validExpiry, omanDate } from './stock-batches.js';
export async function replaceComponent(db, body, actor) {
  return await transaction(db, async () => {
    const device = await db.prepare('SELECT * FROM equipment WHERE id=?').get(body.equipment_id);
    if (!device) throw Error('الجهاز غير موجود');
    const capacity = Number(body.capacity),
      cost = Number(body.cost);
    if (!body.name || !body.serial || !body.reason || !Number.isInteger(capacity) || capacity < 1 || !Number.isFinite(cost) || cost < 0) throw Error('راجع بيانات القطعة والسبب والتكلفة');
    let previous = await db.prepare('SELECT * FROM equipment_components WHERE equipment_id=? AND end IS NULL').get(device.id);
    if (!previous && device.capacity > 0) {
      const id = Number((await db.prepare('INSERT INTO equipment_components(equipment_id,name,serial,capacity,used,cost) VALUES(?,?,?,?,?,?)').run(device.id, device.component || 'قطعة سابقة', device.serial || 'LEGACY', device.capacity, device.used, device.replacement_cost)).lastInsertRowid);
      previous = await db.prepare('SELECT * FROM equipment_components WHERE id=?').get(id);
    }
    await db.prepare('UPDATE equipment_components SET end=CURRENT_TIMESTAMP,reason=?,used=? WHERE equipment_id=? AND end IS NULL').run(body.reason, device.used, device.id);
    const id = Number((await db.prepare('INSERT INTO equipment_components(equipment_id,name,serial,capacity,cost,reason) VALUES(?,?,?,?,?,?)').run(device.id, body.name, body.serial, capacity, cost, body.reason)).lastInsertRowid);
    await db.prepare('UPDATE equipment SET component=?,capacity=?,used=0,replacement_cost=? WHERE id=?').run(body.name, capacity, cost, device.id);
    const after = await db.prepare('SELECT * FROM equipment_components WHERE id=?').get(id);
    await audit(actor, 'equipment.replace', String(device.id), previous, after, db);
    return {
      before: previous,
      after
    };
  });
}
export async function renewLicense(db, body, actor) {
  return await transaction(db, async () => {
    const before = await db.prepare('SELECT * FROM licenses WHERE id=?').get(body.id);
    if (!before) throw Error('الترخيص غير موجود');
    const issued = validExpiry(body.issued),
      expiry = validExpiry(body.expiry);
    if (!issued || !expiry || expiry <= before.expiry || expiry <= issued || !body.reference) throw Error('راجع تاريخ التجديد والمرجع');
    await db.prepare('INSERT INTO license_versions(license_id,issued,expiry,reference,actor) VALUES(?,?,?,?,?)').run(before.id, before.issued, before.expiry, before.reference, actor);
    await db.prepare("UPDATE licenses SET issued=?,expiry=?,reference=?,status='Valid' WHERE id=?").run(issued, expiry, body.reference, before.id);
    const after = await db.prepare('SELECT * FROM licenses WHERE id=?').get(before.id);
    await audit(actor, 'compliance.renew', String(before.id), before, after, db);
    return {
      before,
      after
    };
  });
}
export async function payObligation(db, id, actor, expectedDue) {
  return await transaction(db, async () => {
    const before = await db.prepare('SELECT * FROM obligations WHERE id=?').get(id);
    if (!before) throw Error('الالتزام غير موجود');
    if (expectedDue !== undefined && before.due !== expectedDue) return {
      before,
      after: before
    };
    if (before.status === 'Paid') throw Error('تم تسجيل السداد مسبقًا');
    await db.prepare('INSERT INTO obligation_payments(obligation_id,due,amount,actor) VALUES(?,?,?,?)').run(id, before.due, before.amount, actor);
    let due = before.due,
      status = 'Paid';
    if (['Monthly', 'Yearly'].includes(before.recurrence)) {
      const date = new Date(before.due + 'T00:00:00Z'),
        day = date.getUTCDate();
      date.setUTCDate(1);
      if (before.recurrence === 'Monthly') date.setUTCMonth(date.getUTCMonth() + 1);else date.setUTCFullYear(date.getUTCFullYear() + 1);
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, last));
      due = date.toISOString().slice(0, 10);
      status = 'Due';
    }
    await db.prepare('UPDATE obligations SET due=?,status=? WHERE id=?').run(due, status, id);
    const after = await db.prepare('SELECT * FROM obligations WHERE id=?').get(id);
    await audit(actor, 'compliance.obligation.paid', String(id), before, after, db);
    return {
      before,
      after
    };
  });
}
