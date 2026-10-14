import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CLINIC_DB = ':memory:';
const {
  createDatabase
} = await import('../lib/db.js');
const {
  approveClinicalSession
} = await import('../lib/session-resources.js');
async function example() {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('physio','Demo','demo@example.invalid','disabled','physio');INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO clinical(id,patient_id,provider,kind,episode,content) VALUES(1,1,'physio','Session','Demo','Demo');INSERT INTO episodes(id,patient_id,provider,title) VALUES(1,1,'physio','Demo');INSERT INTO clinical_details VALUES(1,1,'{\"equipment_id\":1,\"equipment_quantity\":5,\"item_id\":1,\"item_quantity\":2}');INSERT INTO equipment(id,name,status,capacity,used) VALUES(1,'Demo','Active',100,10);INSERT INTO inventory(id,name,sku,quantity,average_cost) VALUES(1,'Demo','DEMO',3,10);");
  return db;
}
test('approval consumes device and inventory once; draft consumes nothing', async () => {
  const db = await example();
  assert.equal((await db.prepare('SELECT used FROM equipment').get()).used, 10);
  await approveClinicalSession(db, 1, 'physio');
  await approveClinicalSession(db, 1, 'physio');
  assert.equal((await db.prepare('SELECT used FROM equipment').get()).used, 15);
  assert.equal((await db.prepare('SELECT quantity FROM inventory').get()).quantity, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_movements').get()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM equipment_usage').get()).n, 1);
  db.close();
});
test('stock shortage rolls back device use and keeps clinical note unapproved', async () => {
  const db = await example();
  await db.exec('UPDATE inventory SET quantity=1');
  await assert.rejects(async () => await approveClinicalSession(db, 1, 'physio'), /الرصيد/);
  assert.equal((await db.prepare('SELECT used FROM equipment').get()).used, 10);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM equipment_usage').get()).n, 0);
  assert.equal((await db.prepare('SELECT approved FROM clinical').get()).approved, 0);
  db.close();
});
test('another provider and a critical device fault cannot consume resources', async () => {
  const db = await example();
  await assert.rejects(async () => await approveClinicalSession(db, 1, 'another'), /غير متاح/);
  await db.exec("INSERT INTO maintenance(equipment_id,priority,status) VALUES(1,'Critical','Open')");
  await assert.rejects(async () => await approveClinicalSession(db, 1, 'physio'), /عطل/);
  assert.equal((await db.prepare('SELECT quantity FROM inventory').get()).quantity, 3);
  assert.equal((await db.prepare('SELECT approved FROM clinical').get()).approved, 0);
  db.close();
});
test('multiple resources aggregate repeated items and consume only once', async () => {
  const db = await example();
  await db.exec("INSERT INTO equipment(id,name,status,capacity,used) VALUES(2,'Second','Active',100,0);INSERT INTO inventory(id,name,sku,quantity,average_cost) VALUES(2,'Second','SECOND',10,2)");
  await db.prepare('UPDATE clinical_details SET structured=?').run(JSON.stringify({
    equipment: [{
      id: 1,
      quantity: 2
    }, {
      id: 2,
      quantity: 3
    }, {
      id: 1,
      quantity: 4
    }],
    items: [{
      id: 1,
      quantity: 1
    }, {
      id: 2,
      quantity: 2.5
    }, {
      id: 1,
      quantity: 1
    }]
  }));
  await approveClinicalSession(db, 1, 'physio');
  await approveClinicalSession(db, 1, 'physio');
  assert.deepEqual((await db.prepare('SELECT used FROM equipment ORDER BY id').all()).map(r => r.used), [16, 3]);
  assert.deepEqual((await db.prepare('SELECT quantity FROM inventory ORDER BY id').all()).map(r => r.quantity), [1, 7.5]);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_movements').get()).n, 2);
  db.close();
});
test('last resource failure rolls back all earlier resources', async () => {
  const db = await example();
  await db.prepare('UPDATE clinical_details SET structured=?').run(JSON.stringify({
    equipment: [{
      id: 1,
      quantity: 2
    }],
    items: [{
      id: 1,
      quantity: 1
    }, {
      id: 999,
      quantity: 1
    }]
  }));
  await assert.rejects(async () => await approveClinicalSession(db, 1, 'physio'));
  assert.equal((await db.prepare('SELECT used FROM equipment').get()).used, 10);
  assert.equal((await db.prepare('SELECT quantity FROM inventory').get()).quantity, 3);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_movements').get()).n, 0);
  assert.equal((await db.prepare('SELECT approved FROM clinical').get()).approved, 0);
  db.close();
});
test('malformed resource arrays and fractional device counts are rejected', async () => {
  const {
    validateSessionResources
  } = await import('../lib/session-resources.js');
  for (const data of [{
    equipment: {}
  }, {
    items: [null]
  }, {
    equipment: [{
      id: 1,
      quantity: 1.5
    }]
  }, {
    items: [{
      id: 0,
      quantity: 1
    }]
  }, {
    items: [{
      id: 1,
      quantity: -1
    }]
  }]) assert.throws(() => validateSessionResources(data));
});
