import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CLINIC_DB = ':memory:';
const {
  db
} = await import('../lib/db.js');
const {
  demoDatabase,
  demoSession,
  demoEnabled
} = await import('../lib/demo.js');
test('demo records isolated from clinic database', async () => {
  assert.equal((await db.prepare('SELECT count(*) n FROM patients').get()).n, 0);
  assert.equal((await demoDatabase.prepare('SELECT count(*) n FROM patients').get()).n, 150);
  assert.equal((await db.prepare('SELECT count(*) n FROM users').get()).n, 0);
});
test('demo sessions only created for demo roles in demo database', async () => {
  assert.equal(await demoSession('arbitrary-role'), null);
  const s = await demoSession('physio');
  assert.equal((await demoDatabase.prepare('SELECT user_id FROM sessions WHERE token=?').get(s.token)).user_id, 'demo-physio');
  assert.equal(await db.prepare('SELECT token FROM sessions WHERE token=?').get(s.token), undefined);
});
test('production demo disabled unless explicitly enabled', () => {
  const before = process.env.NODE_ENV;
  const flag = process.env.CLINIC_DEMO;
  const override = process.env.DEMO_MODE;
  try {
  process.env.NODE_ENV = 'production';
  delete process.env.CLINIC_DEMO;
  delete process.env.DEMO_MODE;
  assert.equal(demoEnabled(), false);
  process.env.CLINIC_DEMO = '1';
  assert.equal(demoEnabled(), true);
  process.env.DEMO_MODE = 'off';
  assert.equal(demoEnabled(), false);
  process.env.DEMO_MODE = 'on';
  assert.equal(demoEnabled(), true);
  } finally {
  if (before === undefined) delete process.env.NODE_ENV;else process.env.NODE_ENV = before;
  if (flag === undefined) delete process.env.CLINIC_DEMO;else process.env.CLINIC_DEMO = flag;
  if (override === undefined) delete process.env.DEMO_MODE;else process.env.DEMO_MODE = override;
  }
});
test('every agreed role has a separate demo identity and session', async () => {
  const {
    defaultRoles
  } = await import('../lib/permissions.js');
  for (const [role] of defaultRoles) {
    const s = await demoSession(role);
    assert.ok(s);
    assert.equal((await demoDatabase.prepare('SELECT user_id FROM sessions WHERE token=?').get(s.token)).user_id, 'demo-' + role);
    assert.equal((await demoDatabase.prepare('SELECT role FROM users WHERE id=?').get('demo-' + role)).role, role);
  }
});
test('every demo tab has data and sample invoice ledger balances reconcile', async () => {
  const {
    operationPages
  } = await import('../lib/operations-config.js');
  const {
    listOperations
  } = await import('../lib/operations.js');
  const {
    defaultRoles
  } = await import('../lib/permissions.js');
  for (const path of Object.keys(operationPages)) assert.ok((await listOperations(demoDatabase, path, defaultRoles[0][2])).length > 0, path);
  for (const table of ['patients', 'appointments', 'clinical', 'tasks', 'users', 'roles', 'audit']) assert.ok((await demoDatabase.prepare('SELECT COUNT(*) n FROM ' + table).get()).n > 0, table);
  for (const row of await demoDatabase.prepare("SELECT i.id,i.paid,SUM(CASE WHEN p.kind='Refund' THEN -p.amount ELSE p.amount END) net FROM invoices i JOIN payments p ON p.invoice_id=i.id GROUP BY i.id").all()) assert.equal(row.paid, row.net);
  for (const row of await demoDatabase.prepare('SELECT * FROM cash_closures').all()) assert.equal(row.difference, Math.round((row.counted - row.expected) * 100) / 100);
});
test('demo session rehydrates after instance loss without accessing real sessions', async () => {
  const {
    restoreDemoSession
  } = await import('../lib/demo.js');
  const {
    token
  } = await demoSession('finance');
  await demoDatabase.prepare('DELETE FROM sessions WHERE token=?').run(token);
  assert.equal(await restoreDemoSession(token), true);
  assert.equal((await demoDatabase.prepare('SELECT user_id FROM sessions WHERE token=?').get(token)).user_id, 'demo-finance');
  assert.equal(await restoreDemoSession('arbitrary.123.bad'), false);
  assert.equal(await db.prepare('SELECT token FROM sessions WHERE token=?').get(token), undefined);
});
