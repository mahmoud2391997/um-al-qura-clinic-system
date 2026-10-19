export async function loginAllowed(db, email, now = Date.now()) {
  await db.prepare('DELETE FROM login_attempts WHERE started<?').run(now - 15 * 60 * 1000);
  return ((await db.prepare('SELECT failures FROM login_attempts WHERE email=?').get(email))?.failures || 0) < 5;
}
export async function loginFailure(db, email, now = Date.now()) {
  await db.prepare('INSERT INTO login_attempts(email,failures,started) VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET failures=login_attempts.failures+1').run(email, now);
}
export async function loginSuccess(db, email) {
  await db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
}
export async function revokeSessions(db, id) {
  if (!(await db.prepare('SELECT id FROM users WHERE id=?').get(id))) throw Error('الحساب غير موجود');
  return (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)).changes;
}
