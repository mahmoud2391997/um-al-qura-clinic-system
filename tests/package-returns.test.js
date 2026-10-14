import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { consumePackage, linkPackage } from '../lib/packages.js';
import { usedPackageSessions, returnPackageSession } from '../lib/package-returns.js';
test('return approval preserves consumption history restores balance once and rejects self approval or re-completion', async () => {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('f','Demo','f@invalid','disabled','finance'),('o','Demo','o@invalid','disabled','owner');INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO packages(id,patient_id,service,total,expiry) VALUES(1,1,'Demo',1,'2099-01-01');INSERT INTO appointments(id,patient_id,service,start) VALUES(1,1,'Demo','2026-10-12T10:00'),(2,1,'Demo','2026-10-13T10:00')");
  await linkPackage(db, 1, 1);
  await consumePackage(db, 1);
  const f = {
      id: 'f',
      active: 1,
      permissions: ['finance.create', 'finance.approve']
    },
    o = {
      ...f,
      id: 'o'
    };
  const r = (await returnPackageSession(db, {
    appointment_id: 1,
    reason: 'Demo'
  }, f)).after;
  assert.equal(await usedPackageSessions(db, 1), 1);
  await assert.rejects(async () => await returnPackageSession(db, {
    id: r.id,
    action: 'approve'
  }, f));
  await returnPackageSession(db, {
    id: r.id,
    action: 'approve'
  }, o);
  await returnPackageSession(db, {
    id: r.id,
    action: 'approve'
  }, o);
  assert.equal(await usedPackageSessions(db, 1), 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM package_usage').get()).n, 1);
  await assert.rejects(async () => await consumePackage(db, 1));
  await linkPackage(db, 2, 1);
  await consumePackage(db, 2);
  assert.equal(await usedPackageSessions(db, 1), 1);
  db.close();
});
