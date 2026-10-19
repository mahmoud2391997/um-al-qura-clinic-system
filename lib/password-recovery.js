import { randomBytes, createHash } from 'node:crypto';
const digest = token => createHash('sha256').update(token).digest('hex');
export async function requestPasswordReset(db, email, deliver, now = Date.now()) {
  if (typeof deliver !== 'function') throw Error('خدمة البريد غير مفعلة؛ اطلب إعادة التعيين من مالك المجمع');
  const account = await db.prepare('SELECT id,email FROM users WHERE email=? AND active=1').get(String(email || '').trim().toLowerCase());
  if (!account) return {
    ok: true
  };
  if (await db.prepare('SELECT token_hash FROM password_resets WHERE user_id=? AND expires>?').get(account.id, now)) return {
    ok: true
  };
  const token = randomBytes(32).toString('hex'),
    hash = digest(token);
  await db.prepare('DELETE FROM password_resets WHERE user_id=?').run(account.id);
  await db.prepare('INSERT INTO password_resets(token_hash,user_id,expires) VALUES(?,?,?)').run(hash, account.id, now + 30 * 60 * 1000);
  try {
    await deliver({
      email: account.email,
      token
    });
  } catch {
    await db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(hash);
    throw Object.assign(Error('تعذر إرسال رسالة الاستعادة؛ حاول لاحقًا'),{code:'RECOVERY_DELIVERY_FAILED'});
  }
  return {
    ok: true
  };
}
export async function completePasswordReset(db, token, password, hashPassword, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(String(token || '')) || String(password || '').length < 12) throw Error('رابط الاستعادة أو كلمة المرور غير صحيح');
  const encoded = hashPassword(String(password));
  await db.exec('SAVEPOINT password_reset');
  try {
    // Claim inside the transaction: concurrent PostgreSQL requests cannot both
    // consume the same token. A later failure rolls this deletion back as well.
    const row = await db.prepare('DELETE FROM password_resets WHERE token_hash=? AND expires>? RETURNING user_id').get(digest(token), now);
    if (!row || !(await db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(row.user_id))) throw Error('الرابط انتهى أو استُخدم');
    await db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, row.user_id);
    await db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
    await db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.user_id);
    await db.exec('RELEASE SAVEPOINT password_reset');
    return {
      ok: true,
      user_id: row.user_id
    };
  } catch (e) {
    await db.exec('ROLLBACK TO SAVEPOINT password_reset; RELEASE SAVEPOINT password_reset');
    throw e;
  }
}
export function configuredEmailDelivery() {
  const endpoint = process.env.CLINIC_EMAIL_ENDPOINT,
    key = process.env.CLINIC_EMAIL_KEY,
    base = process.env.CLINIC_BASE_URL;
  if (!endpoint || !key || !base) return null;
  const url = new URL(endpoint),
    origin = new URL(base);
  if (url.protocol !== 'https:' || origin.protocol !== 'https:') throw Error('خدمة البريد والرابط الأساسي يحتاجان HTTPS');
  return async ({
    email,
    token,kind='reset',ttlMinutes
  }) => {
    const link = new URL('/', origin);
    link.hash = (kind==='invite'?'invite=':'reset=') + token;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        to: email,
        subject: kind==='invite'?'دعوة حساب مجمع أم القرى':'استعادة حساب مجمع أم القرى',
        text: (kind==='invite'?'دعوة إنشاء كلمة مرور، مدة الصلاحية بالدقائق: '+ttlMinutes+' — ':'رابط إعادة تعيين كلمة المرور صالح لمدة 30 دقيقة: ') + link.toString()
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw Error('تعذر الإرسال');
  };
}
