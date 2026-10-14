import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { stockMovement, listOperations } from '../lib/operations.js';
async function setup() {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO inventory(id,name,sku) VALUES(1,'Demo','DEMO')");
  return db;
}
async function receive(db, number, quantity, expiry) {
  return await stockMovement(db, {
    item_id: 1,
    kind: 'Receipt',
    batch_number: number,
    batch_expiry: expiry,
    quantity,
    cost: 2,
    reason: 'Demo'
  }, 'store');
}
test('FEFO splits issue across eligible batches and records allocations', async () => {
  const db = await setup();
  await receive(db, 'later', 5, '2099-02-01');
  await receive(db, 'first', 2, '2099-01-01');
  await stockMovement(db, {
    item_id: 1,
    kind: 'Issue',
    quantity: 3,
    reason: 'Demo'
  }, 'store');
  assert.deepEqual((await db.prepare('SELECT quantity FROM stock_batches ORDER BY id').all()).map(r => r.quantity), [4, 0]);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_allocations WHERE movement_id=3').get()).n, 2);
  assert.equal((await db.prepare('SELECT quantity FROM inventory').get()).quantity, 4);
  db.close();
});
test('expired balances are visible but cannot be issued; receipt validation rolls back', async () => {
  const db = await setup();
  await receive(db, 'good', 2, '2099-01-01');
  await db.exec("INSERT INTO stock_batches(item_id,number,expiry,quantity) VALUES(1,'expired','2000-01-01',4);UPDATE inventory SET quantity=6");
  await assert.rejects(async () => await stockMovement(db, {
    item_id: 1,
    kind: 'Issue',
    quantity: 3,
    reason: 'Demo'
  }, 'store'), /الصالح/);
  assert.equal((await db.prepare('SELECT quantity FROM inventory').get()).quantity, 6);
  await assert.rejects(async () => await receive(db, 'bad', 2, '2000-01-01'), /منتهية/);
  await assert.rejects(async () => await receive(db, 'bad', 2, '2099-02-30'), /غير صحيح/);
  assert.equal((await listOperations(db, 'inventory/batches')).filter(r => r.status === 'منتهية').length, 1);
  db.close();
});
test('opening balances migrate and approved adjustments preserve batch totals', async () => {
  const db = await setup();
  await db.exec('UPDATE inventory SET quantity=5,average_cost=3');
  await stockMovement(db, {
    item_id: 1,
    kind: 'Adjustment',
    quantity: 2,
    reason: 'Count'
  }, 'store');
  assert.equal((await db.prepare('SELECT SUM(quantity) n FROM stock_batches').get()).n, 2);
  await stockMovement(db, {
    item_id: 1,
    kind: 'Adjustment',
    quantity: 4,
    reason: 'Count'
  }, 'store');
  assert.equal((await db.prepare('SELECT SUM(quantity) n FROM stock_batches').get()).n, 4);
  db.close();
});
