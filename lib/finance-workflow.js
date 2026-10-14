import { transaction } from './operations.js';
import { recordPayment, discountInvoice, enforceFinanceLimit } from './finance.js';
import { audit } from './db.js';
const requirePermission = (actor, action) => {
  if (!actor.active || !actor.permissions.includes('finance.' + action)) throw Error('صلاحية المالية مطلوبة');
};
export async function financeRequest(db, body, actor) {
  return await transaction(db, async () => {
    requirePermission(actor, body.id ? 'approve' : 'create');
    if (body.id) {
      const before = await db.prepare('SELECT * FROM finance_requests WHERE id=?').get(body.id);
      if (!before) throw Error('الطلب غير موجود');
      if (before.status !== 'Pending') return {
        before,
        after: before
      };
      if (before.creator === actor.id) throw Error('لا تعتمد طلبًا أنشأته بنفسك');
      if (!['approve', 'reject'].includes(body.action)) throw Error('اختر الاعتماد أو الرفض');
      if (body.action === 'reject') {
        if (!String(body.decision || '').trim()) throw Error('سبب الرفض مطلوب');
        await db.prepare("UPDATE finance_requests SET status='Rejected',reviewer=?,decision=? WHERE id=?").run(actor.id, body.decision, before.id);
      } else {
        const operation = {
          id: before.invoice_id,
          action: before.kind,
          payment: before.amount,
          discount: before.amount,
          method: before.method,
          reason: before.reason
        };
        await enforceFinanceLimit(db, operation, actor.role === 'owner');
        if (before.kind === 'discount') await discountInvoice(db, operation, actor.id);else await recordPayment(db, operation, actor.id);
        await db.prepare("UPDATE finance_requests SET status='Approved',reviewer=?,decision=? WHERE id=?").run(actor.id, body.decision || '', before.id);
      }
      const after = await db.prepare('SELECT * FROM finance_requests WHERE id=?').get(before.id);
      await audit(actor.id, 'finance.request.' + body.action, String(before.id), before, after, db);
      return {
        before,
        after
      };
    }
    const amount = Number(body.amount),
      invoice = await db.prepare('SELECT * FROM invoices WHERE id=?').get(body.invoice_id);
    if (!invoice || !['discount', 'refund'].includes(body.kind) || !Number.isFinite(amount) || amount <= 0 || !['Cash', 'Card', 'Transfer', 'Other'].includes(body.method) || !String(body.reason || '').trim()) throw Error('راجع الفاتورة ونوع الطلب والمبلغ والسبب');
    if (body.kind === 'refund' && amount > invoice.paid || body.kind === 'discount' && amount > invoice.amount - invoice.paid) throw Error('المبلغ يتجاوز رصيد الفاتورة');
    const id = Number((await db.prepare('INSERT INTO finance_requests(invoice_id,kind,amount,method,reason,creator) VALUES(?,?,?,?,?,?)').run(invoice.id, body.kind, amount, body.method, body.reason, actor.id)).lastInsertRowid);
    const after = await db.prepare('SELECT * FROM finance_requests WHERE id=?').get(id);
    await audit(actor.id, 'finance.request.create', String(id), null, after, db);
    return {
      before: null,
      after
    };
  });
}
export async function correctCashClosure(db, body, actor) {
  return await transaction(db, async () => {
    requirePermission(actor, 'approve');
    if (actor.role !== 'owner') throw Error('تصحيح الإقفال يحتاج مالك المجمع');
    const closure = await db.prepare('SELECT * FROM cash_closures WHERE id=?').get(body.closure_id),
      counted = Number(body.counted);
    if (!closure || body.counted === undefined || String(body.counted).trim() === '' || !Number.isFinite(counted) || counted < 0 || !String(body.reason || '').trim() || !String(body.reference || '').trim()) throw Error('راجع الإقفال والنقد المصحح والمرجع والسبب');
    const existing = await db.prepare('SELECT * FROM cash_corrections WHERE closure_id=? AND reference=?').get(closure.id, body.reference);
    if (existing) {
      if (existing.counted !== Math.round(counted * 1000) / 1000) throw Error('مرجع التصحيح مستخدم بقيمة مختلفة');
      return {
        before: closure,
        after: existing
      };
    }
    const previous = (await db.prepare('SELECT counted FROM cash_corrections WHERE closure_id=? ORDER BY id DESC LIMIT 1').get(closure.id))?.counted ?? closure.counted,
      value = Math.round(counted * 1000) / 1000;
    const id = Number((await db.prepare('INSERT INTO cash_corrections(closure_id,previous,counted,difference,reference,reason,actor) VALUES(?,?,?,?,?,?,?)').run(closure.id, previous, value, Math.round((value - closure.expected) * 1000) / 1000, body.reference, body.reason, actor.id)).lastInsertRowid),
      after = await db.prepare('SELECT * FROM cash_corrections WHERE id=?').get(id);
    await audit(actor.id, 'finance.cash.correct', String(closure.id), closure, after, db);
    return {
      before: closure,
      after
    };
  });
}
