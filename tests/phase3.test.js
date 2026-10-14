import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { saveOperation, listOperations } from '../lib/operations.js';
test('costing totals and report scope protect financial data', async () => {
  const db = createDatabase(':memory:');
  await saveOperation(db, 'finance/costing', {
    service: 'Demo',
    price: 100,
    staff: 25,
    consumables: 10,
    device: 5,
    overhead: 10
  }, 'test');
  const r = (await listOperations(db, 'finance/costing'))[0];
  assert.equal(r.total_cost, 50);
  assert.equal(r.margin, 50);
  assert.equal(r.margin_percent, 50);
  await db.prepare('INSERT INTO invoices(amount,paid) VALUES(100,30)').run();
  assert.equal((await listOperations(db, 'reports', ['finance.view'])).find(r => r.metric === 'المتبقي').value, 70);
  assert.equal((await listOperations(db, 'reports', ['patients.view'])).length, 1);
  db.close();
});
test('quality and campaigns reject invalid state', async () => {
  const db = createDatabase(':memory:');
  await assert.rejects(async () => await saveOperation(db, 'quality', {
    title: 'Demo',
    category: 'Service',
    description: 'Demo',
    owner: 'Demo',
    due: '2026-10-10',
    status: 'Closed',
    resolution: ''
  }, 'test'), /دليل الإغلاق/);
  await assert.rejects(async () => await saveOperation(db, 'quality/satisfaction', {
    reference: 'D',
    score: 6,
    comment: 'D',
    date: '2026-10-10'
  }, 'test'), /1 إلى 5/);
  await assert.rejects(async () => await saveOperation(db, 'marketing/campaigns', {
    name: 'D',
    channel: 'D',
    budget: 10,
    start: '2026-10-11',
    end: '2026-10-10'
  }, 'test'), /قبل البداية/);
  await assert.rejects(async () => await saveOperation(db, 'reports', {}, 'test'), /للقراءة/);
  db.close();
});
import { queueIntegration } from '../lib/integrations.js';
test('outbox deduplicates requests and remains awaiting provider', async () => {
  const db = createDatabase(':memory:');
  const data = {
    kind: 'appointment_reminder',
    reference: 'Demo',
    payload: {
      synthetic: true
    },
    idempotencyKey: 'same'
  };
  assert.equal((await queueIntegration(db, data)).id, (await queueIntegration(db, data)).id);
  assert.equal((await queueIntegration(db, data)).status, 'Awaiting Provider');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_jobs').get()).n, 1);
  db.close();
});
import { linkPackage, consumePackage } from '../lib/packages.js';
import { transaction } from '../lib/operations.js';
test('packages deduct once and exhausted completion rolls back', async () => {
  const db = createDatabase(':memory:');
  await db.prepare("INSERT INTO patients(name,phone) VALUES('D','D')").run();
  await db.prepare("INSERT INTO packages(patient_id,service,total,expiry) VALUES(1,'D',1,'2027-01-01')").run();
  for (let i = 1; i <= 2; i++) {
    await db.prepare("INSERT INTO appointments(id,patient_id,service,start) VALUES(?,1,'D','2026-10-10T10:00')").run(i);
    await linkPackage(db, i, 1);
  }
  await consumePackage(db, 1);
  await consumePackage(db, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM package_usage').get()).n, 1);
  await assert.rejects(async () => await transaction(db, async () => {
    await consumePackage(db, 2);
    await db.prepare("UPDATE appointments SET status='Completed' WHERE id=2").run();
  }), /متبقية/);
  assert.equal((await db.prepare('SELECT status FROM appointments WHERE id=2').get()).status, 'Pending');
  db.close();
});
