import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { tickAutomation, saveAutomation } from '../lib/automation.js';
import { replaceComponent, renewLicense, payObligation } from '../lib/equipment-renewals.js';
import { consumeEquipment } from '../lib/operations.js';
async function setup() {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('owner','Owner','o@invalid','disabled','owner'),('store','Store','s@invalid','disabled','store');INSERT INTO inventory(id,name,sku,quantity,minimum) VALUES(1,'Item','ITEM',1,3);INSERT INTO equipment(id,name,component,capacity,used,replacement_cost) VALUES(1,'Device','Old',100,95,10);INSERT INTO licenses(id,title,issued,expiry,reference) VALUES(1,'License','2025-01-01','2026-01-01','old');INSERT INTO obligations(id,title,amount,due,recurrence) VALUES(1,'Rent',10,'2026-01-31','Monthly')");
  return db;
}
test('automatic alerts recurring tasks and escalations are idempotent and resolve', async () => {
  const db = await setup(),
    actor = {
      id: 'owner',
      role: 'owner',
      active: 1
    };
  await saveAutomation(db, 'tasks/recurring', {
    title: 'Review',
    owner: 'store',
    due: '2026-01-01',
    every_days: 7,
    priority: 'Normal'
  }, actor);
  await tickAutomation(db, new Date('2026-01-10T12:00:00Z'));
  const tasks = (await db.prepare('SELECT COUNT(*) n FROM tasks').get()).n;
  await tickAutomation(db, new Date('2026-01-10T12:00:00Z'));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM tasks').get()).n, tasks);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='Review'").get()).n, 2);
  assert.ok((await db.prepare('SELECT COUNT(*) n FROM task_escalations').get()).n > 0);
  await db.exec('UPDATE inventory SET quantity=10');
  await tickAutomation(db, new Date('2026-01-10T12:00:00Z'));
  assert.equal((await db.prepare("SELECT status FROM alerts WHERE key='stock:1'").get()).status, 'Resolved');
  db.close();
});
test('replacement preserves the old counter and increments the active component only', async () => {
  const db = await setup();
  await replaceComponent(db, {
    equipment_id: 1,
    name: 'New',
    serial: 'NEW',
    capacity: 50,
    cost: 20,
    reason: 'Worn'
  }, 'owner');
  await consumeEquipment(db, {
    id: 1,
    quantity: 3,
    reference: 'Session'
  }, 'owner');
  assert.deepEqual((await db.prepare('SELECT used FROM equipment_components ORDER BY id').all()).map(r => r.used), [95, 3]);
  assert.equal((await db.prepare('SELECT used FROM equipment').get()).used, 3);
  await assert.rejects(async () => await replaceComponent(db, {
    equipment_id: 1,
    name: 'Bad',
    serial: 'BAD',
    capacity: 0,
    cost: 1,
    reason: 'Test'
  }, 'owner'));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM equipment_components WHERE end IS NULL').get()).n, 1);
  db.close();
});
test('license renewal keeps its previous version and monthly obligations clamp month-end', async () => {
  const db = await setup();
  await renewLicense(db, {
    id: 1,
    issued: '2026-01-02',
    expiry: '2027-01-01',
    reference: 'new'
  }, 'owner');
  assert.equal((await db.prepare('SELECT expiry FROM license_versions').get()).expiry, '2026-01-01');
  await assert.rejects(async () => await renewLicense(db, {
    id: 1,
    issued: '2026-01-02',
    expiry: '2026-01-01',
    reference: 'bad'
  }, 'owner'));
  await payObligation(db, 1, 'owner');
  assert.equal((await db.prepare('SELECT due FROM obligations').get()).due, '2026-02-28');
  assert.equal((await db.prepare('SELECT due FROM obligation_payments').get()).due, '2026-01-31');
  db.close();
});
