import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { recordPayment, discountInvoice } from '../lib/finance.js';
test('ledger and invoice stay consistent on collection refund and rejected overdraft', async () => {
  const db = createDatabase(':memory:');
  await db.prepare('INSERT INTO invoices(amount,paid) VALUES(100,0)').run();
  await recordPayment(db, {
    id: 1,
    payment: 60,
    method: 'Card'
  }, 'D');
  await assert.rejects(async () => await recordPayment(db, {
    id: 1,
    payment: 50
  }, 'D'), /تتجاوز/);
  await recordPayment(db, {
    id: 1,
    payment: 10,
    action: 'refund',
    reason: 'Demo'
  }, 'D');
  assert.equal((await db.prepare('SELECT paid FROM invoices').get()).paid, 50);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM payments').get()).n, 2);
  await assert.rejects(async () => await discountInvoice(db, {
    id: 1,
    discount: 60,
    reason: 'Demo'
  }, 'D'), /يتجاوز/);
  await discountInvoice(db, {
    id: 1,
    discount: 20,
    reason: 'Demo'
  }, 'D');
  assert.equal((await db.prepare('SELECT amount FROM invoices').get()).amount, 80);
  db.close();
});
test('financial limits require owner above configured amount', async () => {
  const {
    enforceFinanceLimit
  } = await import('../lib/finance.js');
  const {
    createDatabase
  } = await import('../lib/db.js');
  const db = createDatabase(':memory:');
  await db.prepare('UPDATE finance_policy SET discount_limit=50,refund_limit=100 WHERE id=1').run();
  await assert.doesNotReject(async () => await enforceFinanceLimit(db, {
    action: 'discount',
    discount: 50
  }, false));
  await assert.rejects(async () => await enforceFinanceLimit(db, {
    action: 'discount',
    discount: 51
  }, false), /مالك/);
  await assert.rejects(async () => await enforceFinanceLimit(db, {
    action: 'refund',
    payment: 101
  }, false), /مالك/);
  await assert.doesNotReject(async () => await enforceFinanceLimit(db, {
    action: 'refund',
    payment: 101
  }, true));
  db.close();
});
