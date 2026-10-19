// Real parallel HTTP requests against a disposable loopback PostgreSQL schema.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL || '');
assert(
  ['localhost', '127.0.0.1'].includes(url.hostname),
  'Disposable PostgreSQL must be loopback',
);
assert(
  /test|disposable|hardening/.test(url.pathname),
  'Database name must clearly identify test use',
);
const schema = 'http_concurrency_' + randomUUID().replaceAll('-', ''),
  client = new pg.Client({ connectionString: url.toString() });
await client.connect();
let app,
  logs = '';
try {
  await client.query('CREATE SCHEMA ' + schema);
  await client.query('SET search_path TO ' + schema);
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port;
  app = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        CLINIC_DB: ':memory:',
        CLINIC_POSTGRES_SCHEMA: schema,
        CLINIC_POSTGRES_GLOBAL_LOCK: '0',
        CLINIC_DEMO_ONLY: '0',
        DEMO_MODE: 'off',
        VERCEL: '',
      },
      stdio: 'pipe',
    },
  );
  app.stdout.on('data', (b) => (logs = (logs + b).slice(-20000)));
  app.stderr.on('data', (b) => (logs = (logs + b).slice(-20000)));
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/api/setup')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert(ready, 'Synthetic PostgreSQL server failed to start');
  let cookie = '';
  const call = async (path, body) => {
    const r = await fetch(base + '/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      value: await r.json(),
      cookie: r.headers
        .getSetCookie()
        .find((s) => s.startsWith('clinic_session='))
        ?.split(';')[0],
    };
  };
  const password = randomBytes(24).toString('hex');
  assert.equal(
    (
      await call('setup', {
        name: 'Synthetic owner',
        email: 'owner@example.test',
        password,
      })
    ).status,
    200,
  );
  const login = await call('login', { email: 'owner@example.test', password });
  assert.equal(login.status, 200);
  cookie = login.cookie;
  const users = await call('users');
  const ownerId = users.value.find((u) => u.role === 'owner').id;
  assert.equal(
    (
      await call('users', {
        id: '',
        name: 'Synthetic clinician',
        email: 'provider@example.test',
        password,
        role: 'physio',
      })
    ).status,
    200,
  );
  const provider = (await call('users')).value.find(
    (u) => u.role === 'physio',
  ).id;
  assert.equal(
    (
      await call('patients', {
        name: 'Synthetic patient',
        phone: 'HTTP-SYNTHETIC',
      })
    ).status,
    200,
  );
  const patient = (await call('patients')).value[0].id;
  assert.equal(
    (
      await call('finance/service-prices', {
        name: 'Synthetic service',
        department: 'Synthetic',
        effective_date: '2026-01-01',
        amount: 100,
        floor: 10,
        duration_minutes: 30,
      })
    ).status,
    200,
  );
  const body = {
    patient_id: patient,
    provider,
    service: 'Synthetic service',
    start: '2099-02-01T09:00',
    room: 'Synthetic room',
  };
  const booking = await Promise.all(
    [1, 2].map(() =>
      call('appointments/book', { ...body, request_id: randomUUID() }),
    ),
  );
  assert.equal(booking.filter((r) => r.status === 200).length, 1);
  assert(booking.every((r) => [200, 400, 409].includes(r.status)));
  const retry = {
      ...body,
      start: '2099-02-01T10:00',
      request_id: randomUUID(),
    },
    same = await Promise.all([
      call('appointments/book', retry),
      call('appointments/book', retry),
    ]);
  assert(same.every((r) => r.status === 200));
  assert.equal(same[0].value.appointment_id, same[1].value.appointment_id);
  const ids = [
    booking.find((r) => r.status === 200).value.appointment_id,
    same[0].value.appointment_id,
  ];
  await client.query(
    "INSERT INTO packages(id,patient_id,service,total,expiry) VALUES(91,$1,'Synthetic service',1,'2100-01-01')",
    [patient],
  );
  for (const id of ids)
    await client.query(
      'INSERT INTO appointment_packages(appointment_id,package_id) VALUES($1,91)',
      [id],
    );
  const consumed = await Promise.all(
    ids.map((id) => call('appointments', { id, status: 'Completed' })),
  );
  assert.equal(consumed.filter((r) => r.status === 200).length, 1);
  assert.equal(
    Number(
      (
        await client.query(
          'SELECT COUNT(*) n FROM package_usage WHERE package_id=91',
        )
      ).rows[0].n,
    ),
    1,
  );
  await client.query(
    "INSERT INTO inventory(id,name,quantity,average_cost,expiry) VALUES(91,'Synthetic stock',10,2,'');INSERT INTO stock_batches(item_id,number,expiry,quantity,cost) VALUES(91,'SYNTHETIC','',10,2)",
  );
  const stock = await Promise.all(
    [1, 2].map(() =>
      call('inventory/movements', {
        item_id: 91,
        kind: 'Issue',
        quantity: 7,
        cost: 2,
        reason: 'Synthetic issue',
      }),
    ),
  );
  assert.equal(stock.filter((r) => r.status === 200).length, 1);
  assert.equal(
    Number(
      (await client.query('SELECT quantity FROM inventory WHERE id=91')).rows[0]
        .quantity,
    ),
    3,
  );
  await client.query(
    "INSERT INTO invoices(id,patient_id,service,amount,paid) VALUES(91,$1,'Synthetic service',100,0)",
    [patient],
  );
  const payments = await Promise.all(
    [1, 2].map(() => call('finance', { id: 91, payment: 60, method: 'Card' })),
  );
  assert.equal(payments.filter((r) => r.status === 200).length, 1);
  assert.equal(
    Number(
      (await client.query('SELECT paid FROM invoices WHERE id=91')).rows[0]
        .paid,
    ),
    60,
  );
  const closings = await Promise.all(
    [1, 2].map(() =>
      call('finance/cashbox', {
        date: '2026-01-01',
        opening: 0,
        counted: 0,
        reason: 'Synthetic close',
      }),
    ),
  );
  assert.equal(closings.filter((r) => r.status === 200).length, 1);
  assert.equal(
    Number(
      (
        await client.query(
          "SELECT COUNT(*) n FROM cash_closures WHERE date='2026-01-01'",
        )
      ).rows[0].n,
    ),
    1,
  );
  console.log(
    'PASS parallel PostgreSQL HTTP: provider/room conflict, idempotent booking, last package use, FEFO stock, invoice collection and one cash close; owner=' +
      Boolean(ownerId),
  );
} catch (error) {
  console.error(error.message);
  console.error('Synthetic server diagnostics:', logs);
  process.exitCode = 1;
} finally {
  if (app) {
    app.kill('SIGTERM');
    await Promise.race([new Promise((r) => app.once('exit', r)), delay(5000)]);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
  await client.query('DROP SCHEMA ' + schema + ' CASCADE');
  await client.end();
}
