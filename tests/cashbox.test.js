import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { closeCashDay, clinicDay } from '../lib/cashbox.js';
import { saveOperation } from '../lib/operations.js';
test('cash close snapshots net cash, excludes cards and locks expenses', async () => {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO invoices(id,patient_id,amount,paid) VALUES(1,1,500,100);INSERT INTO payments(invoice_id,kind,amount,method,time) VALUES(1,'Payment',100,'Cash','2026-01-01 12:00:00'),(1,'Refund',20,'Cash','2026-01-01 13:00:00'),(1,'Payment',200,'Card','2026-01-01 14:00:00');INSERT INTO expenses(id,title,amount,method,date) VALUES(1,'Demo',30,'Cash','2026-01-01');");
  await assert.rejects(async () => await closeCashDay(db, {
    date: '2026-01-01',
    opening: 10,
    counted: 65
  }, 'demo'), /سبب/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM cash_closures').get()).n, 0);
  const {
    after
  } = await closeCashDay(db, {
    date: '2026-01-01',
    opening: 10,
    counted: 65,
    reason: 'فرق جرد تجريبي'
  }, 'demo');
  assert.equal(after.expected, 60);
  assert.equal(after.difference, 5);
  await assert.rejects(async () => await closeCashDay(db, {
    date: '2026-01-01',
    opening: 10,
    counted: 60
  }, 'demo'), /مقفل/);
  await assert.rejects(async () => await saveOperation(db, 'finance/expenses', {
    id: 1,
    date: '2026-01-02',
    method: 'Card'
  }, 'demo'), /مقفل/);
  await assert.rejects(async () => await saveOperation(db, 'finance/expenses', {
    date: '2026-01-01',
    method: 'Cash'
  }, 'demo'), /مقفل/);
  assert.equal((await db.prepare('SELECT date FROM expenses WHERE id=1').get()).date, '2026-01-01');
  db.close();
});
test('Muscat midnight boundaries determine cash day and closure availability', async () => {
  assert.equal(clinicDay(new Date('2026-01-01T19:59:59Z')), '2026-01-01');
  assert.equal(clinicDay(new Date('2026-01-01T20:00:00Z')), '2026-01-02');
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO invoices(id,patient_id,amount) VALUES(1,1,500);INSERT INTO payments(invoice_id,kind,amount,method,time) VALUES(1,'Payment',10,'Cash','2025-12-31 19:59:59'),(1,'Payment',20,'Cash','2025-12-31 20:00:00'),(1,'Payment',30,'Cash','2026-01-01 19:59:59'),(1,'Payment',40,'Cash','2026-01-01 20:00:00');");
  const body = {
    date: '2026-01-01',
    opening: 0,
    counted: 50
  };
  await assert.rejects(async () => await closeCashDay(db, body, 'demo', new Date('2026-01-01T19:59:59Z')), /منتهي/);
  const {
    after
  } = await closeCashDay(db, body, 'demo', new Date('2026-01-01T20:00:00Z'));
  assert.equal(after.collections, 50);
  assert.equal(after.difference, 0);
  db.close();
});
