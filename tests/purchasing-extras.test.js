import {setAttachmentScanner} from '../lib/attachment-storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { savePurchasing } from '../lib/purchasing.js';
import { saveExtras, listExtras } from '../lib/purchasing-extras.js';
import { saveOperation } from '../lib/operations.js';
const store = {
    id: 'store',
    role: 'store',
    active: 1,
    permissions: ['purchasing.view', 'purchasing.create', 'purchasing.edit']
  },
  owner = {
    id: 'owner',
    role: 'owner',
    active: 1,
    permissions: [...store.permissions, 'purchasing.approve', 'finance.view', 'finance.create', 'finance.edit']
  };
async function setup() {
  const db = createDatabase(':memory:');
  setAttachmentScanner(db,async()=> 'Clean');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('store','Store','s@invalid','disabled','store'),('owner','Owner','o@invalid','disabled','owner'),('reviewer','Reviewer','r@invalid','disabled','manager');INSERT INTO inventory(id,name,sku) VALUES(1,'Item','SKU')");
  const request = (await savePurchasing(db, 'purchasing/requests', {
    title: 'Demo',
    department: 'Demo',
    needed: '2099-01-01',
    priority: 'Normal',
    reason: 'Demo',
    items: [{
      item_id: 1,
      quantity: 5,
      price: 10
    }],
    action: 'submit'
  }, store)).after;
  return {
    db,
    request
  };
}
async function approvedOrder() {
  const {
    db,
    request
  } = await setup();
  await savePurchasing(db, 'purchasing/requests', {
    id: request.id,
    action: 'approve'
  }, owner);
  const quote = (await saveExtras(db, 'purchasing/quotes', {
    request_id: request.id,
    supplier: 'Demo Vendor',
    items: [{
      item_id: 1,
      price: 8
    }]
  }, store)).after;
  await saveExtras(db, 'purchasing/quotes', {
    id: quote.id,
    action: 'approve'
  }, owner);
  const order = (await savePurchasing(db, 'purchasing/orders', {
    request_id: request.id,
    action: 'convert',
    quote_id: quote.id
  }, store)).after;
  await savePurchasing(db, 'purchasing/orders', {
    id: order.id,
    action: 'receive',
    item_id: 1,
    quantity: 2,
    batch_number: 'B1',
    idempotency_key: 'receipt'
  }, store);
  return {
    db,
    request,
    quote,
    order
  };
}
test('approval limit requires owner above threshold and policy is owner-only', async () => {
  const {
    db,
    request
  } = await setup();
  const reviewer = {
    ...owner,
    id: 'reviewer',
    role: 'manager'
  };
  await saveExtras(db, 'purchasing/policy', {
    approval_limit: 20,
    payment_limit: 10
  }, owner);
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/requests', {
    id: request.id,
    action: 'approve'
  }, reviewer), /حد الاعتماد/);
  await assert.rejects(async () => await saveExtras(db, 'purchasing/policy', {
    approval_limit: 100,
    payment_limit: 100
  }, reviewer), /للمالك/);
  await savePurchasing(db, 'purchasing/requests', {
    id: request.id,
    action: 'approve'
  }, owner);
  db.close();
});
test('approved quote prices are frozen into order and determine receipt valuation', async () => {
  const {
    db,
    order
  } = await approvedOrder();
  assert.equal(order.total, 40);
  assert.equal(order.supplier, 'Demo Vendor');
  assert.equal((await db.prepare('SELECT average_cost FROM inventory').get()).average_cost, 8);
  assert.equal((await listExtras(db, 'purchasing/invoice-orders', owner))[0].available, 16);
  db.close();
});
test('supplier invoices cannot exceed received value and payments cannot repeat', async () => {
  const {
    db,
    order
  } = await approvedOrder();
  await assert.rejects(async () => await saveExtras(db, 'purchasing/invoices', {
    order_id: order.id,
    number: 'N',
    amount: 17,
    date: '2026-01-01'
  }, owner), /المستلم/);
  const inv = (await saveExtras(db, 'purchasing/invoices', {
    order_id: order.id,
    number: 'N',
    amount: 16,
    date: '2026-01-01'
  }, owner)).after;
  const payment = {
    id: inv.id,
    action: 'pay',
    amount: 5,
    method: 'Transfer',
    date: '2026-01-01',
    reference: 'REF',
    idempotency_key: 'PAY'
  };
  await saveExtras(db, 'purchasing/invoices', payment, owner);
  await saveExtras(db, 'purchasing/invoices', payment, owner);
  assert.equal((await listExtras(db, 'purchasing/invoices', owner))[0].paid, 5);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM expenses').get()).n, 1);
  await assert.rejects(async () => await saveExtras(db, 'purchasing/invoices', {
    ...payment,
    amount: 12,
    idempotency_key: 'NEW'
  }, owner), /المتبقي/);
  await assert.rejects(async () => await saveOperation(db, 'finance/expenses', {
    id: 1
  }, owner.id), /مرتبط/);
  db.close();
});
test('cash payment rejects closed day and non-owner payment above configured limit', async () => {
  const {
    db,
    order
  } = await approvedOrder();
  const inv = (await saveExtras(db, 'purchasing/invoices', {
    order_id: order.id,
    number: 'N',
    amount: 16,
    date: '2026-01-01'
  }, owner)).after;
  await db.exec("INSERT INTO cash_closures(date) VALUES('2026-01-01')");
  const payment = {
    id: inv.id,
    action: 'pay',
    amount: 2,
    method: 'Cash',
    date: '2026-01-01',
    reference: 'REF',
    idempotency_key: 'PAY'
  };
  await assert.rejects(async () => await saveExtras(db, 'purchasing/invoices', payment, owner), /مقفل/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM supplier_payments').get()).n, 0);
  await assert.rejects(async () => await saveExtras(db, 'purchasing/invoices', {
    ...payment,
    method: 'Transfer'
  }, {
    ...owner,
    id: 'reviewer',
    role: 'finance'
  }), /حد الموظف/);
  db.close();
});
test('attachments are scoped and downloads do not disclose another requester files', async () => {
  const {
    db,
    request
  } = await setup();
  const data = Buffer.from('%PDF-1.4\nSynthetic\n%%EOF').toString('base64');
  const a = (await saveExtras(db, 'purchasing/attachments', {
    request_id: request.id,
    name: 'quote.pdf',
    mime: 'application/pdf',
    data
  }, store)).after;
  assert.equal((await listExtras(db, 'purchasing/attachments', {
    ...store,
    id: 'reviewer'
  })).length, 0);
  await assert.rejects(async () => await saveExtras(db, 'purchasing/attachments', {
    id: a.id,
    action: 'download'
  }, {
    ...store,
    id: 'reviewer'
  }), /غير متاح/);
  assert.equal((await saveExtras(db, 'purchasing/attachments', {
    id: a.id,
    action: 'download'
  }, store)).file.data, data);
  await assert.rejects(async () => await saveExtras(db, 'purchasing/attachments', {
    request_id: request.id,
    name: 'bad.pdf',
    mime: 'application/pdf',
    data: Buffer.from('bad').toString('base64')
  }, store), /لا يطابق/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM purchase_attachments').get()).n, 1);
  db.close();
});
test('unapproved quote cannot be selected or approve its own creator', async () => {
  const {
    db,
    request
  } = await setup();
  await savePurchasing(db, 'purchasing/requests', {
    id: request.id,
    action: 'approve'
  }, owner);
  const q = (await saveExtras(db, 'purchasing/quotes', {
    request_id: request.id,
    supplier: 'Vendor',
    items: [{
      item_id: 1,
      price: 8
    }]
  }, store)).after;
  await assert.rejects(async () => await savePurchasing(db, 'purchasing/orders', {
    request_id: request.id,
    action: 'convert',
    quote_id: q.id
  }, store), /المعتمد/);
  await assert.rejects(async () => await saveExtras(db, 'purchasing/quotes', {
    id: q.id,
    action: 'approve'
  }, {
    ...owner,
    id: 'store'
  }), /بنفسك/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM purchase_orders').get()).n, 0);
  db.close();
});
