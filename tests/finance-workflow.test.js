import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { financeRequest, correctCashClosure } from '../lib/finance-workflow.js';
async function setup() {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('f','Demo','f@invalid','disabled','finance'),('o','Demo','o@invalid','disabled','owner');INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO invoices(id,patient_id,service,amount,paid) VALUES(1,1,'Demo',100,60)");
  return db;
}
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
test('financial requests cannot self-approve and execution is atomic idempotent and rechecks live balance', async () => {
  const db = await setup();
  const r = (await financeRequest(db, {
    invoice_id: 1,
    kind: 'refund',
    amount: 10,
    method: 'Card',
    reason: 'Demo'
  }, f)).after;
  assert.equal((await db.prepare('SELECT paid FROM invoices').get()).paid, 60);
  await assert.rejects(async () => await financeRequest(db, {
    id: r.id,
    action: 'approve'
  }, f));
  await financeRequest(db, {
    id: r.id,
    action: 'approve'
  }, o);
  await financeRequest(db, {
    id: r.id,
    action: 'approve'
  }, o);
  assert.equal((await db.prepare('SELECT paid FROM invoices').get()).paid, 50);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM payments').get()).n, 1);
  const next = (await financeRequest(db, {
    invoice_id: 1,
    kind: 'refund',
    amount: 50,
    method: 'Card',
    reason: 'Demo'
  }, f)).after;
  await db.exec('UPDATE invoices SET paid=5');
  await assert.rejects(async () => await financeRequest(db, {
    id: next.id,
    action: 'approve'
  }, o));
  assert.equal((await db.prepare('SELECT status FROM finance_requests WHERE id=?').get(next.id)).status, 'Pending');
  db.close();
});
test('cash correction preserves original closure and needs owner; reference retry cannot duplicate', async () => {
  const db = await setup();
  await db.exec("INSERT INTO cash_closures(id,date,expected,counted,difference) VALUES(1,'2026-10-01',20,19,-1)");
  const body = {
    closure_id: 1,
    counted: 20,
    reference: 'Demo',
    reason: 'Demo'
  };
  await assert.rejects(async () => await correctCashClosure(db, body, f));
  await correctCashClosure(db, body, o);
  await correctCashClosure(db, body, o);
  assert.equal((await db.prepare('SELECT counted FROM cash_closures').get()).counted, 19);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM cash_corrections').get()).n, 1);
  assert.equal((await db.prepare('SELECT difference FROM cash_corrections').get()).difference, 0);
  await assert.rejects(async () => await correctCashClosure(db, {
    ...body,
    counted: 21
  }, o));
  db.close();
});
