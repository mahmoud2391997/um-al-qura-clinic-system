import { ensureCashDayOpen, clinicDay } from './cashbox.js';
import { transaction } from './operations.js';
export async function recordPayment(db, body, actor) {
  return await transaction(db, async () => {
    const before = await db.prepare('SELECT * FROM invoices WHERE id=?').get(body.id);
    const amount = Number(body.payment);
    if (!before || !Number.isFinite(amount) || amount <= 0) throw Error('قيمة العملية غير صحيحة');
    const kind = body.action === 'refund' ? 'Refund' : 'Payment';
    const method = body.method || 'Cash';
    if (!['Cash', 'Card', 'Transfer', 'Other'].includes(method)) throw Error('وسيلة الدفع غير صحيحة');
    if (kind === 'Refund' && !String(body.reason || '').trim()) throw Error('سبب الاسترداد مطلوب');
    if (kind === 'Payment' && before.paid + amount > before.amount || kind === 'Refund' && amount > before.paid) throw Error('العملية تتجاوز رصيد الفاتورة');
    if (method === 'Cash') await ensureCashDayOpen(db, clinicDay());
    const signed = kind === 'Refund' ? -amount : amount;
    await db.prepare('UPDATE invoices SET paid=paid+? WHERE id=?').run(signed, body.id);
    await db.prepare('INSERT INTO payments(invoice_id,kind,amount,method,reason,actor) VALUES(?,?,?,?,?,?)').run(body.id, kind, amount, method, body.reason || '', actor);
    return {
      before,
      after: await db.prepare('SELECT * FROM invoices WHERE id=?').get(body.id)
    };
  });
}
export async function discountInvoice(db, body, actor) {
  return await transaction(db, async () => {
    const before = await db.prepare('SELECT * FROM invoices WHERE id=?').get(body.id);
    const amount = Number(body.discount);
    if (!before || !Number.isFinite(amount) || amount <= 0 || before.amount - amount < before.paid) throw Error('الخصم يتجاوز المبلغ المتبقي');
    if (!String(body.reason || '').trim()) throw Error('سبب الخصم مطلوب');
    await db.prepare('UPDATE invoices SET amount=amount-? WHERE id=?').run(amount, body.id);
    await db.prepare('INSERT INTO discounts(invoice_id,amount,reason,actor) VALUES(?,?,?,?)').run(body.id, amount, body.reason, actor);
    return {
      before,
      after: await db.prepare('SELECT * FROM invoices WHERE id=?').get(body.id)
    };
  });
}
export async function enforceFinanceLimit(db, body, isOwner) {
  if (isOwner || !['refund', 'discount'].includes(body.action)) return;
  const policy = await db.prepare('SELECT * FROM finance_policy WHERE id=1').get();
  const value = Number(body.action === 'discount' ? body.discount : body.payment);
  if (value > policy[body.action + '_limit']) throw Error('المبلغ يتجاوز حد اعتماد الموظف؛ يلزم تنفيذ العملية بواسطة مالك المجمع');
}
