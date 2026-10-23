// Self-contained synthetic PostgreSQL recovery + actual application acceptance.
// No source/target DATABASE_URL is accepted, and no existing database is used.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { postgresSchema } from '../lib/postgres-schema.js';
import { readinessSchema } from '../lib/readiness-schema.js';
import { defaultRoles } from '../lib/permissions.js';
const directory = mkdtempSync(join(tmpdir(), 'clinic-financial-restore-'));
const container = 'clinic-financial-restore-' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex'),
  token = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
let client,
  app,
  logs = '';
try {
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=' + password,
    '-p',
    '127.0.0.1::5432',
    'postgres:17-alpine',
  );
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      docker(
        'exec',
        container,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
      );
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert(ready);
  const port = docker('port', container, '5432').trim().split(':').at(-1);
  const url = (name) =>
    'postgresql://postgres:' + password + '@127.0.0.1:' + port + '/' + name;
  docker('exec', container, 'createdb', '-U', 'postgres', 'synthetic_source');
  client = new pg.Client({ connectionString: url('synthetic_source') });
  await client.connect();
  await client.query(postgresSchema);
  await client.query(readinessSchema);
  for (const [id, name, permissions] of defaultRoles)
    await client.query('INSERT INTO roles VALUES($1,$2,$3)', [
      id,
      name,
      JSON.stringify(permissions),
    ]);
  await client.query(
    "CREATE TABLE clinic_postgres_migrations(name TEXT PRIMARY KEY);INSERT INTO clinic_postgres_migrations VALUES('initial');INSERT INTO users(id,name,email,password,role) VALUES('synthetic-owner','Synthetic Owner','owner@example.test','disabled','owner');INSERT INTO patients(id,name,phone) VALUES(1,'Synthetic recovery patient','TEST');INSERT INTO invoices(id,patient_id,service,amount,paid) VALUES(1,1,'Synthetic recovery service',50,25);INSERT INTO payments(invoice_id,kind,amount,method,time) VALUES(1,'Payment',30,'Card','2026-01-02 00:00:00'),(1,'Refund',5,'Card','2026-01-02 01:00:00');INSERT INTO invoice_report_facts VALUES(1,'2026-01-02','Synthetic recovery service','Synthetic department');",
  );
  await client.query(
    'INSERT INTO sessions(token,user_id,expires) VALUES($1,$2,$3)',
    [token, 'synthetic-owner', Date.now() + 3600000],
  );
  // These scan records represent an already-scanned synthetic file restored from
  // trusted storage. No production scanner bypass or environment flag is introduced.
  const bytes = Buffer.from('%PDF-1.4\nSynthetic restored attachment');
  const { createHash } = await import('node:crypto');
  await client.query(
    'INSERT INTO documents(id,path,target_id,name,mime,size,data,actor) VALUES(1,$1,1,$2,$3,$4,$5,$6)',
    [
      'patients/attachments',
      'synthetic.pdf',
      'application/pdf',
      bytes.length,
      bytes.toString('base64'),
      'synthetic-owner',
    ],
  );
  await client.query(
    'CREATE TABLE attachment_scans(store_table TEXT NOT NULL,attachment_id BIGINT NOT NULL,state TEXT NOT NULL,digest TEXT NOT NULL,scanned_at TEXT,PRIMARY KEY(store_table,attachment_id))',
  );
  await client.query(
    "INSERT INTO attachment_scans VALUES('documents',1,'Clean',$1,$2)",
    [
      createHash('sha256').update(bytes).digest('hex'),
      new Date().toISOString(),
    ],
  );
  await client.end();
  client = null;
  const archive = join(directory, 'source.dump'),
    encrypted = join(directory, 'source.enc'),
    key = join(directory, 'key'),
    restored = join(directory, 'restored.dump');
  const dump = execFileSync('docker', [
    'exec',
    container,
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'synthetic_source',
    '-Fc',
  ]);
  writeFileSync(archive, dump, { mode: 0o600 });
  writeFileSync(key, randomBytes(32).toString('base64url'), { mode: 0o600 });
  const crypt = (mode, input, output) =>
    execFileSync(
      process.execPath,
      ['infra/scripts/crypt.mjs', mode, input, output, key],
      { stdio: 'pipe' },
    );
  crypt('encrypt', archive, encrypted);
  const corrupt = Buffer.from(readFileSync(encrypted));
  corrupt[corrupt.length - 1] ^= 1;
  writeFileSync(join(directory, 'corrupt.enc'), corrupt);
  assert.notEqual(
    spawnSync(process.execPath, [
      'infra/scripts/crypt.mjs',
      'decrypt',
      join(directory, 'corrupt.enc'),
      join(directory, 'rejected.dump'),
      key,
    ]).status,
    0,
  );
  crypt('decrypt', encrypted, restored);
  assert.deepEqual(readFileSync(restored), dump);
  docker('exec', container, 'createdb', '-U', 'postgres', 'synthetic_restored');
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'pg_restore',
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      '-U',
      'postgres',
      '-d',
      'synthetic_restored',
    ],
    { input: readFileSync(restored), stdio: 'pipe' },
  );
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const appPort = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + appPort;
  app = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(appPort),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: url('synthetic_restored'),
        VERCEL: '',
        CLINIC_DB: ':memory:',
        CLINIC_DEMO: '0',
        CLINIC_DEMO_ONLY: '0',
      },
      stdio: 'pipe',
    },
  );
  app.stdout.on('data', (b) => (logs = (logs + b).slice(-4000)));
  app.stderr.on('data', (b) => (logs = (logs + b).slice(-4000)));
  ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/api/environment')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert(ready, 'Restored application must start');
  const headers = { cookie: 'clinic_session=' + token, origin: base };
  const response = await fetch(
    base + '/api/reports/financial?group_by=service',
    { headers },
  );
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.rows[0].net_collections, 25);
  assert.equal(report.rows[0].billed_net, 50);
  assert.equal(report.coverage.undated_invoices, 0);
  const attachment = await fetch(base + '/api/patients/attachments', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, action: 'download' }),
  });
  assert.equal(attachment.status, 200);
  assert.equal((await attachment.json()).file.data, bytes.toString('base64'));
  console.log(
    'PASS: encrypted synthetic full-schema backup -> corruption rejected -> isolated PostgreSQL restore -> actual authenticated financial report and byte-identical protected attachment download.',
  );
} catch (error) {
  console.error('Synthetic recovery acceptance failed:', error.message);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (client) await client.end();
  if (app) {
    app.kill('SIGTERM');
    await Promise.race([new Promise((r) => app.once('exit', r)), delay(5000)]);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
  try {
    docker('rm', '-f', container);
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
