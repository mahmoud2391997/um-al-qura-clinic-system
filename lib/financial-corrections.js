import { transaction } from './operations.js';
import { recordPayment } from './finance.js';
import { ensureCashDayOpen, clinicDay } from './cashbox.js';
import { audit } from './db.js';
const tables = {
  Payment: 'payments',
  Expense: 'expenses',
  SupplierPayment: 'supplier_payments'
};
export async function correctFinancialRecord(db, body, actor) {
  return await transaction(db, async () => {
    if (!actor.active || !actor.permissions.includes('finance.' + (body.id ? 'approve' : 'create'))) throw Error('صلاحية المالية مطلوبة');
    if (!body.id) {
      const table = tables[body.kind],
        row = table && (await db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(body.source_id));
      if (!row || !String(body.reason || '').trim()) throw Error('حدد نوع القيد ورقمه وسبب التصحيح');
      if (row.amount <= 0 || body.kind === 'Expense' && row.supplier_payment_id) throw Error('القيد ليس قابلًا للإلغاء المباشر؛ صحح سداد المورد المرتبط');
      if (await db.prepare('SELECT id FROM financial_corrections WHERE kind=? AND compensation_id=?').get(body.kind, row.id)) throw Error('هذا قيد تعويضي؛ لا تلغِ سجل التصحيح');
      const existing = await db.prepare('SELECT * FROM financial_corrections WHERE kind=? AND source_id=?').get(body.kind, row.id);
      if (existing) return {
        before: existing,
        after: existing
      };
      const id = Number((await db.prepare('INSERT INTO financial_corrections(kind,source_id,reason,creator,snapshot) VALUES(?,?,?,?,?)').run(body.kind, row.id, body.reason, actor.id, JSON.stringify(row))).lastInsertRowid),
        after = await db.prepare('SELECT * FROM financial_corrections WHERE id=?').get(id);
      await audit(actor.id, 'finance.correction.request', String(id), null, after, db);
      return {
        before: null,
        after
      };
    }
    if (actor.role !== 'owner') throw Error('تصحيح القيود المالية يحتاج مراجعة المالك');
    const before = await db.prepare('SELECT * FROM financial_corrections WHERE id=?').get(body.id);
    if (!before) throw Error('طلب التصحيح غير موجود');
    if (before.status !== 'Pending') return {
      before,
      after: before
    };
    if (before.creator === actor.id) throw Error('الطلب يحتاج مراجعًا مختلفًا');
    if (!['approve', 'reject'].includes(body.action)) throw Error('حدد القرار');
    let compensation = null;
    if (body.action === 'reject') {
      if (!String(body.decision || '').trim()) throw Error('سبب الرفض مطلوب');
    } else {
      const row = await db.prepare('SELECT * FROM ' + tables[before.kind] + ' WHERE id=?').get(before.source_id);
      if (!row || JSON.stringify(row) !== before.snapshot) throw Error('القيد تغير بعد الطلب؛ راجع بياناته أولًا');
      const date = clinicDay();
      if (row.method === 'Cash') await ensureCashDayOpen(db, date);
      const reason = 'تصحيح قيد ' + before.source_id + ': ' + before.reason;
      if (before.kind === 'Payment') {
        await recordPayment(db, {
          id: row.invoice_id,
          action: row.kind === 'Payment' ? 'refund' : 'payment',
          payment: row.amount,
          method: row.method,
          reason
        }, actor.id);
        compensation = Number((await db.prepare('SELECT last_insert_rowid() id').get()).id);
      } else {
        let payment = null;
        if (before.kind === 'SupplierPayment') {
          const paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) n FROM supplier_payments WHERE invoice_id=?').get(row.invoice_id)).n;
          if (paid < row.amount) throw Error('الإلغاء يتجاوز المسدد الحالي');
          payment = Number((await db.prepare('INSERT INTO supplier_payments(invoice_id,amount,method,date,reference,actor,idempotency_key) VALUES(?,?,?,?,?,?,?)').run(row.invoice_id, -row.amount, row.method, date, reason, actor.id, 'CORRECTION-' + before.id)).lastInsertRowid);
        }
        const expense = Number((await db.prepare('INSERT INTO expenses(title,category,supplier,amount,date,method,cost_center,reference,supplier_payment_id) VALUES(?,?,?,?,?,?,?,?,?)').run(reason, 'تصحيح مالي', row.supplier || '', -row.amount, date, row.method, row.cost_center || '', reason, payment)).lastInsertRowid);
        compensation = before.kind === 'SupplierPayment' ? payment : expense;
      }
    }
    await db.prepare('UPDATE financial_corrections SET status=?,reviewer=?,decision=?,compensation_id=? WHERE id=?').run(body.action === 'approve' ? 'Approved' : 'Rejected', actor.id, body.decision || '', compensation, before.id);
    const after = await db.prepare('SELECT * FROM financial_corrections WHERE id=?').get(before.id);
    await audit(actor.id, 'finance.correction.' + body.action, String(before.id), before, after, db);
    return {
      before,
      after
    };
  });
}
