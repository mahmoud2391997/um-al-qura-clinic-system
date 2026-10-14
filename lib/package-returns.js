import { transaction } from './operations.js';
import { audit } from './db.js';
export async function usedPackageSessions(db, id) {
  return (await db.prepare("SELECT COUNT(*) n FROM package_usage u LEFT JOIN package_returns r ON r.usage_id=u.id AND r.status='Approved' WHERE u.package_id=? AND r.id IS NULL").get(id)).n;
}
export async function returnPackageSession(db, body, actor) {
  return await transaction(db, async () => {
    const permission = body.id ? 'approve' : 'create';
    if (!actor.active || !actor.permissions.includes('finance.' + permission)) throw Error('صلاحية المالية مطلوبة');
    if (body.id) {
      const before = await db.prepare('SELECT * FROM package_returns WHERE id=?').get(body.id);
      if (!before) throw Error('طلب الرد غير موجود');
      if (before.status !== 'Pending') return {
        before,
        after: before
      };
      if (before.creator === actor.id) throw Error('راجع الطلب بواسطة موظف آخر');
      if (!['approve', 'reject'].includes(body.action)) throw Error('حدد القرار');
      if (body.action === 'reject' && !String(body.decision || '').trim()) throw Error('سبب الرفض مطلوب');
      await db.prepare('UPDATE package_returns SET status=?,reviewer=?,decision=? WHERE id=?').run(body.action === 'approve' ? 'Approved' : 'Rejected', actor.id, body.decision || '', before.id);
      const after = await db.prepare('SELECT * FROM package_returns WHERE id=?').get(before.id);
      await audit(actor.id, 'finance.package.return.' + body.action, String(before.id), before, after, db);
      return {
        before,
        after
      };
    }
    const usage = await db.prepare('SELECT * FROM package_usage WHERE appointment_id=?').get(body.appointment_id);
    if (!usage || !String(body.reason || '').trim()) throw Error('حدد موعدًا خُصمت جلسة باقته والسبب');
    const existing = await db.prepare('SELECT * FROM package_returns WHERE usage_id=?').get(usage.id);
    if (existing) return {
      before: existing,
      after: existing
    };
    const id = Number((await db.prepare('INSERT INTO package_returns(usage_id,appointment_id,package_id,reason,creator) VALUES(?,?,?,?,?)').run(usage.id, usage.appointment_id, usage.package_id, body.reason, actor.id)).lastInsertRowid),
      after = await db.prepare('SELECT * FROM package_returns WHERE id=?').get(id);
    await audit(actor.id, 'finance.package.return.request', String(id), null, after, db);
    return {
      before: null,
      after
    };
  });
}
