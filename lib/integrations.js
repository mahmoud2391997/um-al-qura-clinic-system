// Provider-neutral local outbox. No network transport is configured.
export async function queueIntegration(db, {
  kind,
  reference,
  payload,
  idempotencyKey
}) {
  if (!['appointment_reminder', 'payment_request','review_request'].includes(kind)) throw Error('نوع التكامل غير مدعوم');
  if (!reference || !idempotencyKey || !payload || typeof payload !== 'object') throw Error('بيانات التكامل غير مكتملة');
  await db.prepare('INSERT OR IGNORE INTO integration_jobs(kind,reference,payload,idempotency_key,status) VALUES(?,?,?,?,?)').run(kind, reference, JSON.stringify(payload), idempotencyKey, 'Awaiting Provider');
  const row = await db.prepare('SELECT id,kind,reference,status FROM integration_jobs WHERE idempotency_key=?').get(idempotencyKey);
  return row;
}
