import { clinicInstant } from './staff-capacity.js';
import { queueIntegration } from './integrations.js';
export async function queueDueReminders(db, now, leadMinutes) {
  if (leadMinutes === undefined || leadMinutes === null || leadMinutes === '')
    return { configured: false, queued: 0 };
  if (!Number.isSafeInteger(leadMinutes) || leadMinutes < 1)
    throw Error(
      'Reminder lead time must be explicitly configured as positive minutes',
    );
  let queued = 0;
  const current = now.getTime(),
    until = current + leadMinutes * 60000;
  for (const row of await db
    .prepare(
      "SELECT id,start FROM appointments WHERE status IN ('Pending','Confirmed')",
    )
    .all()) {
    let start;
    try {
      start = clinicInstant(row.start);
    } catch {
      continue;
    }
    if (start <= current || start > until) continue;
    const key = 'appointment-reminder:' + row.id + ':' + row.start;
    if (
      await db
        .prepare('SELECT id FROM integration_jobs WHERE idempotency_key=?')
        .get(key)
    )
      continue;
    await queueIntegration(db, {
      kind: 'appointment_reminder',
      reference: 'appointment:' + row.id,
      payload: { appointment_id: row.id },
      idempotencyKey: key,
    });
    queued++;
  }
  return { configured: true, queued };
}
