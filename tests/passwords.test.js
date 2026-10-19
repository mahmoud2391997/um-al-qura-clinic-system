import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CLINIC_DB = ':memory:';
const {
  hashPassword,
  verifyPassword,
  db
} = await import('../lib/db.js');
test('passwords salted and wrong password denied', () => {
  const a = hashPassword('a-long-test-password');
  const b = hashPassword('a-long-test-password');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('a-long-test-password', a), true);
  assert.equal(verifyPassword('wrong-password', a), false);
});
test('database seeds every agreed role without users or default password', async () => {
  assert.equal((await db.prepare('SELECT count(*) n FROM roles').get()).n, 13);
  assert.equal((await db.prepare('SELECT count(*) n FROM users').get()).n, 0);
});

test('disabled and malformed password hashes fail closed without throwing',()=>{for(const hash of [null,undefined,'disabled','salt:invalid','a'.repeat(32)+':'+'0'.repeat(126)])assert.equal(verifyPassword('synthetic-password',hash),false);});
