import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { withPostgres, closePostgres } from '../lib/postgres.js';
import { rowConcurrentRoute } from '../lib/row-locks.js';
test(
  'PostgreSQL converted mutations use shared migration barrier, legacy paths stay exclusive and rollback flag restores global lock',
  { skip: process.env.CLINIC_TEST_POSTGRES !== '1' },
  async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert(['localhost', '127.0.0.1'].includes(url.hostname));
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    const schema = 'lock_mode_' + randomUUID().replaceAll('-', ''),
      previousSchema = process.env.CLINIC_POSTGRES_SCHEMA,
      previousFlag = process.env.CLINIC_POSTGRES_GLOBAL_LOCK;
    try {
      await admin.query('CREATE SCHEMA ' + schema);
      process.env.CLINIC_POSTGRES_SCHEMA = schema;
      process.env.CLINIC_POSTGRES_GLOBAL_LOCK = '0';
      const mode = (db) =>
        db
          .prepare(
            "SELECT mode FROM pg_locks WHERE locktype='advisory' AND objid=740014 AND pid=pg_backend_pid()",
          )
          .get();
      assert.equal(
        (await withPostgres(mode, { concurrent: true })).mode,
        'ShareLock',
      );
      assert.equal((await withPostgres(mode)).mode, 'ExclusiveLock');
      process.env.CLINIC_POSTGRES_GLOBAL_LOCK = '1';
      assert.equal(
        (await withPostgres(mode, { concurrent: true })).mode,
        'ExclusiveLock',
      );
      assert.equal(rowConcurrentRoute('POST', 'appointments/book'), true);
      assert.equal(rowConcurrentRoute('GET', 'appointments'), false);
      assert.equal(rowConcurrentRoute('POST', 'finance/corrections'), false);
    } finally {
      await closePostgres();
      if (previousSchema === undefined)
        delete process.env.CLINIC_POSTGRES_SCHEMA;
      else process.env.CLINIC_POSTGRES_SCHEMA = previousSchema;
      if (previousFlag === undefined)
        delete process.env.CLINIC_POSTGRES_GLOBAL_LOCK;
      else process.env.CLINIC_POSTGRES_GLOBAL_LOCK = previousFlag;
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin.end();
    }
  },
);
