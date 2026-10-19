export const outboxSchema = `CREATE TABLE IF NOT EXISTS integration_delivery(job_id BIGINT PRIMARY KEY,state TEXT NOT NULL,attempts BIGINT NOT NULL,next_attempt BIGINT,last_code TEXT,updated BIGINT NOT NULL)`;
function retryPolicy(policy) {
  for (const key of ['maxAttempts', 'baseDelayMs', 'maxDelayMs', 'batchSize'])
    if (!Number.isSafeInteger(policy?.[key]) || policy[key] < 1)
      throw Error('Outbox retry settings must be explicitly configured');
  if (policy.maxDelayMs < policy.baseDelayMs)
    throw Error('Outbox maximum delay must cover base delay');
  return policy;
}
// transaction(fn) must commit each claim/result separately; delivery occurs between them.
export async function processOutbox({
  transaction,
  deliver,
  policy,
  now = Date.now(),
}) {
  if (!deliver) return { configured: false, processed: 0 };
  retryPolicy(policy);
  let processed = 0,
    delivered = 0,
    deadLetter = 0,
    uncertain = 0;
  for (let i = 0; i < policy.batchSize; i++) {
    const claim = await transaction(async (db) => {
      await db.exec(outboxSchema);
      const jobs = await db
        .prepare(
          "SELECT j.* FROM integration_jobs j LEFT JOIN integration_delivery d ON d.job_id=j.id WHERE (d.job_id IS NULL OR (d.state='Pending' AND d.next_attempt<=?)) AND j.status<>'Delivered' ORDER BY j.id",
        )
        .all(now);
      for (const job of jobs) {
        await db
          .prepare(
            "INSERT INTO integration_delivery(job_id,state,attempts,next_attempt,updated) VALUES(?,'Pending',0,?,?) ON CONFLICT(job_id) DO NOTHING",
          )
          .run(job.id, now, now);
        const changed = await db
          .prepare(
            "UPDATE integration_delivery SET state='Sending',attempts=attempts+1,updated=? WHERE job_id=? AND state='Pending' AND next_attempt<=?",
          )
          .run(now, job.id, now);
        if (changed.changes) {
          const state = await db
            .prepare('SELECT attempts FROM integration_delivery WHERE job_id=?')
            .get(job.id);
          return { ...job, attempt: state.attempts };
        }
      }
      return null;
    });
    if (!claim) break;
    processed++;
    let state = 'Delivered',
      code = null,
      next = null;
    try {
      await deliver({
        id: claim.id,
        kind: claim.kind,
        reference: claim.reference,
        payload: JSON.parse(claim.payload),
        idempotencyKey: claim.idempotency_key,
      });
      delivered++;
    } catch (error) {
      code = 'delivery_failed';
      if (error.definitelyNotSent === true) {
        state = claim.attempt >= policy.maxAttempts ? 'DeadLetter' : 'Pending';
        if (state === 'Pending')
          next =
            now +
            Math.min(
              policy.maxDelayMs,
              policy.baseDelayMs * 2 ** Math.min(claim.attempt - 1, 30),
            );
        else deadLetter++;
      } else {
        state = 'Uncertain';
        uncertain++;
        code = 'delivery_outcome_unknown';
      }
    }
    await transaction(async (db) => {
      const result = await db
        .prepare(
          "UPDATE integration_delivery SET state=?,next_attempt=?,last_code=?,updated=? WHERE job_id=? AND state='Sending' AND attempts=?",
        )
        .run(state, next, code, now, claim.id, claim.attempt);
      if (!result.changes) throw Error('Outbox claim changed before result');
      await db
        .prepare('UPDATE integration_jobs SET status=? WHERE id=?')
        .run(state, claim.id);
    });
  }
  return { configured: true, processed, delivered, deadLetter, uncertain };
}
