import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CLINIC_DB = ':memory:';
const {
  createDatabase
} = await import('../lib/db.js');
const {
  stockMovement,
  consumeEquipment
} = await import('../lib/operations.js');
test('stock receipt updates weighted cost and over-issue rolls back atomically', async () => {
  const db = createDatabase(':memory:');
  await db.prepare('INSERT INTO inventory(id,name,sku,quantity,average_cost) VALUES(1,?,?,?,?)').run('Test', 'test', 2, 10);
  await stockMovement(db, {
    item_id: 1,
    kind: 'Receipt',
    batch_number: 'TEST',
    quantity: 2,
    cost: 20,
    reason: 'Test'
  }, 'test');
  assert.equal((await db.prepare('SELECT average_cost FROM inventory').get()).average_cost, 15);
  await assert.rejects(async () => await stockMovement(db, {
    item_id: 1,
    kind: 'Issue',
    quantity: 5,
    reason: 'Test'
  }, 'test'));
  assert.equal((await db.prepare('SELECT quantity FROM inventory').get()).quantity, 4);
  assert.equal((await db.prepare('SELECT count(*) n FROM stock_movements').get()).n, 1);
  await stockMovement(db, {
    item_id: 1,
    kind: 'Adjustment',
    quantity: 0,
    reason: 'Test'
  }, 'test');
  assert.equal((await db.prepare('SELECT quantity FROM inventory').get()).quantity, 0);
  db.close();
});
test('equipment use blocked for faults and exhausted counter without recording a movement', async () => {
  const db = createDatabase(':memory:');
  await db.prepare('INSERT INTO equipment(id,name,status,capacity,used) VALUES(1,?,?,?,?)').run('Test', 'Active', 100, 90);
  await assert.rejects(async () => await consumeEquipment(db, {
    id: 1,
    quantity: 11,
    reference: 'test'
  }, 'test'));
  await consumeEquipment(db, {
    id: 1,
    quantity: 5,
    reference: 'test'
  }, 'test');
  assert.equal((await db.prepare('SELECT used FROM equipment').get()).used, 95);
  await db.prepare('INSERT INTO maintenance(equipment_id,priority,status) VALUES(1,?,?)').run('Critical', 'Open');
  await assert.rejects(async () => await consumeEquipment(db, {
    id: 1,
    quantity: 1,
    reference: 'test'
  }, 'test'));
  assert.equal((await db.prepare('SELECT count(*) n FROM equipment_usage').get()).n, 1);
  assert.equal((await db.prepare('SELECT used FROM equipment').get()).used, 95);
  db.close();
});
