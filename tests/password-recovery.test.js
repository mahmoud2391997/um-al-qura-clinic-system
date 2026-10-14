import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, hashPassword, verifyPassword } from '../lib/db.js';
import { requestPasswordReset, completePasswordReset } from '../lib/password-recovery.js';
async function setup() {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('o','Demo','o@invalid','disabled','owner');INSERT INTO sessions VALUES('old','o',999999999999)");
  return db;
}
test('reset tokens are hashed expiring single-use and successful reset revokes all old sessions', async () => {
  const db = await setup(),
    now = 1000000;
  let token;
  await requestPasswordReset(db, 'o@invalid', async x => {
    token = x.token;
  }, now);
  const row = await db.prepare('SELECT * FROM password_resets').get();
  assert.notEqual(row.token_hash, token);
  await assert.rejects(async () => await completePasswordReset(db, token, 'new-password-123', hashPassword, now + 1800001));
  await completePasswordReset(db, token, 'new-password-123', hashPassword, now + 1);
  assert.equal(verifyPassword('new-password-123', (await db.prepare('SELECT password FROM users').get()).password), true);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions').get()).n, 0);
  await assert.rejects(async () => await completePasswordReset(db, token, 'another-password-123', hashPassword, now + 2));
  db.close();
});
test('unconfigured mail and delivery failures do not leave usable reset tokens; unknown account sends nothing', async () => {
  const db = await setup();
  await assert.rejects(requestPasswordReset(db, 'o@invalid', null));
  await assert.rejects(requestPasswordReset(db, 'o@invalid', async () => {
    throw Error('Fail');
  }));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM password_resets').get()).n, 0);
  let sent = 0;
  await requestPasswordReset(db, 'other@invalid', async () => sent++);
  assert.equal(sent, 0);
  db.close();
});
