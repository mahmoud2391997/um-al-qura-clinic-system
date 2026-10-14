import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { loginAllowed, loginFailure, loginSuccess, revokeSessions } from '../lib/auth-security.js';
test('failed login attempts expire, successful login resets, and session revocation is isolated', async () => {
  const db = createDatabase(':memory:'),
    now = 10000000;
  for (let i = 0; i < 5; i++) {
    assert.equal(await loginAllowed(db, 'demo', now), true);
    await loginFailure(db, 'demo', now);
  }
  assert.equal(await loginAllowed(db, 'demo', now), false);
  assert.equal(await loginAllowed(db, 'other', now), true);
  assert.equal(await loginAllowed(db, 'demo', now + 900001), true);
  await loginFailure(db, 'demo', now + 900001);
  await loginSuccess(db, 'demo');
  assert.equal(await loginAllowed(db, 'demo', now + 900002), true);
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('p','Demo','p@invalid','disabled','physio'),('q','Demo','q@invalid','disabled','physio');INSERT INTO sessions VALUES('first','p',99999999999),('second','q',99999999999)");
  assert.equal(await revokeSessions(db, 'p'), 1);
  assert.equal((await db.prepare('SELECT user_id FROM sessions').get()).user_id, 'q');
  db.close();
});
