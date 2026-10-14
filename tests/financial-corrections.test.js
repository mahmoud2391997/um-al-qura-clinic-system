import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { correctFinancialRecord } from '../lib/financial-corrections.js';
const f = {
    id: 'f',
    active: 1,
    role: 'finance',
    permissions: ['finance.create', 'finance.approve']
  },
  o = {
    ...f,
    id: 'o',
    role: 'owner'
  };
async function setup() {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('f','Demo','f@invalid','disabled','finance'),('o','Demo','o@invalid','disabled','owner');INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO invoices(id,patient_id,amount,paid) VALUES(1,1,100,20);INSERT INTO payments(id,invoice_id,kind,amount,method,actor) VALUES(1,1,'Payment',20,'Card','f');INSERT INTO expenses(id,title,amount,date,method) VALUES(1,'Demo',10,'2026-10-01','Card')");
  return db;
}
test('historical financial correction appends compensation and never rewrites or reverses twice', async () => {
  const db = await setup(),
    before = await db.prepare('SELECT * FROM payments WHERE id=1').get(),
    r = (await correctFinancialRecord(db, {
      kind: 'Payment',
      source_id: 1,
      reason: 'Demo'
    }, f)).after;
  await assert.rejects(async () => await correctFinancialRecord(db, {
    id: r.id,
    action: 'approve'
  }, f));
  await correctFinancialRecord(db, {
    id: r.id,
    action: 'approve'
  }, o);
  await correctFinancialRecord(db, {
    id: r.id,
    action: 'approve'
  }, o);
  assert.deepEqual(await db.prepare('SELECT * FROM payments WHERE id=1').get(), before);
  assert.equal((await db.prepare('SELECT paid FROM invoices').get()).paid, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM payments').get()).n, 2);
  await assert.rejects(async () => await correctFinancialRecord(db, {
    kind: 'Payment',
    source_id: 2,
    reason: 'Demo'
  }, f));
  db.close();
});
test('expense correction preserves source and rejects stale approval after a source edit', async () => {
  const db = await setup(),
    r = (await correctFinancialRecord(db, {
      kind: 'Expense',
      source_id: 1,
      reason: 'Demo'
    }, f)).after;
  await db.exec('UPDATE expenses SET amount=12 WHERE id=1');
  await assert.rejects(async () => await correctFinancialRecord(db, {
    id: r.id,
    action: 'approve'
  }, o));
  await db.exec('UPDATE expenses SET amount=10 WHERE id=1');
  await correctFinancialRecord(db, {
    id: r.id,
    action: 'approve'
  }, o);
  assert.equal((await db.prepare('SELECT amount FROM expenses WHERE id=1').get()).amount, 10);
  assert.equal((await db.prepare('SELECT SUM(amount) n FROM expenses').get()).n, 0);
  db.close();
});
test('supplier payment correction keeps payable and expense ledger aligned', async () => {
  const db = await setup();
  await db.exec("INSERT INTO purchase_requests(id,creator) VALUES(1,'f');INSERT INTO purchase_orders(id,request_id) VALUES(1,1);INSERT INTO supplier_invoices(id,order_id,amount) VALUES(1,1,50);INSERT INTO supplier_payments(id,invoice_id,amount,method,date,idempotency_key) VALUES(1,1,20,'Card','2026-10-01','demo');INSERT INTO expenses(title,amount,date,method,supplier_payment_id) VALUES('Supplier Demo',20,'2026-10-01','Card',1)");
  const r = (await correctFinancialRecord(db, {
    kind: 'SupplierPayment',
    source_id: 1,
    reason: 'Demo'
  }, f)).after;
  await correctFinancialRecord(db, {
    id: r.id,
    action: 'approve'
  }, o);
  assert.equal((await db.prepare('SELECT SUM(amount) n FROM supplier_payments').get()).n, 0);
  assert.equal((await db.prepare('SELECT SUM(amount) n FROM expenses WHERE supplier_payment_id IS NOT NULL').get()).n, 0);
  assert.equal((await db.prepare('SELECT amount FROM supplier_payments WHERE id=1').get()).amount, 20);
  db.close();
});
