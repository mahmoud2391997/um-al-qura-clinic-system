import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { savePurchasing, listPurchasing } from '../lib/purchasing.js';
const store = {
    id: 'store',
    active: 1,
    permissions: ['purchasing.view', 'purchasing.create', 'purchasing.edit']
  },
  owner = {
    id: 'owner',
    role: 'owner',
    active: 1,
    permissions: [...store.permissions, 'purchasing.approve']
  };
async function setup() {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('store','Store','s@invalid','disabled','store'),('owner','Owner','o@invalid','disabled','owner'),('other','Other','x@invalid','disabled','store');INSERT INTO inventory(id,name,sku) VALUES(1,'Item','SKU'),(2,'Second','SECOND')");
  return db;
}
const body = {
  title: 'Demo',
  department: 'Demo',
  needed: '2099-01-01',
  priority: 'Normal',
  reason: 'Demo',
  items: [{
    item_id: 1,
    quantity: 3,
    price: 2
  }, {
    item_id: 2,
    quantity: 4,
    price: 3
  }],
  action: 'submit'
};
async function order(db) {
  const r = (await savePurchasing(db, 'purchasing/requests', body, store)).after;
  await savePurchasing(db, 'purchasing/requests', {
    id: r.id,
    action: 'approve'
  }, owner);
  return (await savePurchasing(db, 'purchasing/orders', {
    action: 'convert',
    request_id: r.id
  }, store)).after;
}
test('request approval and conversion do not touch stock; conversion is once', async () => {
  const db = await setup(),
    o = await order(db);
  assert.equal((await db.prepare('SELECT SUM(quantity) n FROM inventory').get()).n, 0);
  assert.equal((await savePurchasing(db, 'purchasing/orders', {
    action: 'convert',
    request_id: o.request_id
  }, store)).after.id, o.id);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM purchase_orders').get()).n, 1);
  db.close();
});
test('permissions, ownership and state protect draft edits and review', async () => {
  const db = await setup();
  const r = (await savePurchasing(db, 'purchasing/requests', body, store)).after;
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/requests', {
    id: r.id,
    action: 'approve'
  }, store), /صلاحية/);
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/requests', {
    ...body,
    id: r.id
  }, store), /المسودة/);
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/orders', {
    action: 'convert',
    request_id: r.id
  }, store), /اعتماد/);
  assert.equal((await listPurchasing(db, 'purchasing/requests', {
    ...store,
    id: 'other'
  })).length, 0);
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/requests', {
    id: r.id,
    action: 'approve'
  }, {
    ...owner,
    id: 'store'
  }), /بنفسك/);
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/requests', {
    id: r.id,
    action: 'reject'
  }, owner), /سبب/);
  db.close();
});
test('partial receipts allocate batches and duplicate retry cannot restock', async () => {
  const db = await setup(),
    o = await order(db);
  const receipt = {
    id: o.id,
    action: 'receive',
    item_id: 1,
    quantity: 2,
    batch_number: 'B1',
    batch_expiry: '2099-02-01',
    idempotency_key: 'key1'
  };
  await savePurchasing(db, 'purchasing/orders', receipt, store);
  await savePurchasing(db, 'purchasing/orders', receipt, store);
  assert.equal((await db.prepare('SELECT quantity FROM inventory WHERE id=1').get()).quantity, 2);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM purchase_receipts').get()).n, 1);
  assert.equal((await db.prepare('SELECT status FROM purchase_orders').get()).status, 'Partial');
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/orders', {
    ...receipt,
    quantity: 3,
    idempotency_key: 'key2'
  }, store), /المتبقي/);
  await savePurchasing(db, 'purchasing/orders', {
    ...receipt,
    quantity: 1,
    idempotency_key: 'key2'
  }, store);
  await savePurchasing(db, 'purchasing/orders', {
    ...receipt,
    item_id: 2,
    quantity: 4,
    idempotency_key: 'key3'
  }, store);
  assert.equal((await db.prepare('SELECT status FROM purchase_orders').get()).status, 'Received');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_batches').get()).n, 3);
  db.close();
});
test('invalid expiry and reused key rollback without a receipt or stock increase', async () => {
  const db = await setup(),
    o = await order(db);
  const receipt = {
    id: o.id,
    action: 'receive',
    item_id: 1,
    quantity: 1,
    batch_number: 'B',
    batch_expiry: '2000-01-01',
    idempotency_key: 'key'
  };
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/orders', receipt, store), /منتهية/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM purchase_receipts').get()).n, 0);
  assert.equal((await db.prepare('SELECT quantity FROM inventory WHERE id=1').get()).quantity, 0);
  await savePurchasing(db, 'purchasing/orders', {
    ...receipt,
    batch_expiry: ''
  }, store);
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/orders', {
    ...receipt,
    batch_expiry: '',
    quantity: 2
  }, store), /مختلفة/);
  db.close();
});
test('items cannot repeat and totals are recomputed by server', async () => {
  const db = await setup();
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/requests', {
    ...body,
    items: [body.items[0], body.items[0]]
  }, store), /تكرر/);
  const r = (await savePurchasing(db, 'purchasing/requests', {
    ...body,
    total: 999999
  }, store)).after;
  assert.equal(r.total, 18);
  await assert.rejects(async () => await listPurchasing(db, 'purchasing/requests', {
    ...store,
    active: 0
  }), /صلاحية/);
  db.close();
});
