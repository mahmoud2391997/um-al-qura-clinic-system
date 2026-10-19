import { randomUUID } from 'node:crypto';
import { transaction } from './operations.js';
import { audit } from './db.js';
import { assignedScope } from './data-scopes.js';
export const capacitySchema = `
CREATE TABLE IF NOT EXISTS practitioner_working_hours(id TEXT PRIMARY KEY,provider TEXT NOT NULL,start TEXT NOT NULL,finish TEXT NOT NULL,actor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS practitioner_time_off(id TEXT PRIMARY KEY,provider TEXT NOT NULL,start TEXT NOT NULL,finish TEXT NOT NULL,actor TEXT NOT NULL);
`;
export async function ensureCapacitySchema(db) {
  await db.exec(capacitySchema);
}
// Datetime-local inputs are clinic wall time (Asia/Muscat, UTC+04), never host time.
export function clinicInstant(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)?$/.test(
      value,
    )
  )
    throw Error('وقت غير صحيح');
  const day = value.slice(0, 10);
  if (
    new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59
  )
    throw Error('وقت غير صحيح');
  const n = Date.parse(
    value + (/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? '' : '+04:00'),
  );
  if (!Number.isFinite(n)) throw Error('وقت غير صحيح');
  return n;
}
function union(intervals) {
  const result = [];
  for (const [start, end] of intervals
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
function minutes(intervals) {
  return intervals.reduce((n, [s, e]) => n + (e - s) / 60000, 0);
}
function intersection(left, right) {
  return left.flatMap(([s, e]) =>
    right
      .map(([a, b]) => [Math.max(s, a), Math.min(e, b)])
      .filter(([a, b]) => b > a),
  );
}
function permission(actor) {
  if (
    !actor?.active ||
    actor.role !== 'owner' ||
    !actor.permissions.includes('users.edit')
  )
    throw Object.assign(Error('الإعدادات للمالك'), { status: 403 });
}
const tableFor = (kind) =>
  kind === 'working-hours'
    ? 'practitioner_working_hours'
    : kind === 'time-off'
      ? 'practitioner_time_off'
      : null;
export async function capacitySettings(db, kind, actor, body) {
  permission(actor);
  const table = tableFor(kind);
  if (!table) throw Error('غير متاح');
  await ensureCapacitySchema(db);
  if (!body)
    return db
      .prepare('SELECT * FROM ' + table + ' ORDER BY provider,start')
      .all();
  return transaction(db, async () => {
    const before = body.id
      ? await db
          .prepare('SELECT * FROM ' + table + ' WHERE id=?')
          .get(String(body.id))
      : null;
    if (body.id && !before) throw Error('السجل غير متاح');
    if (body.action === 'remove') {
      if (!before) throw Error('السجل غير متاح');
      await db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(before.id);
      await audit(
        actor.id,
        'capacity.' + kind + '.remove',
        before.id,
        before,
        null,
        db,
      );
      return { ok: true };
    }
    if (
      !(await db
        .prepare(
          "SELECT id FROM users WHERE id=? AND active=1 AND role IN ('doctor','physio','physio_lead')",
        )
        .get(body.provider))
    )
      throw Error('اختر ممارسًا نشطًا');
    const start = clinicInstant(body.start),
      finish = clinicInstant(body.finish);
    if (finish <= start) throw Error('نهاية الفترة يجب أن تكون بعد بدايتها');
    const id = before?.id || randomUUID(),
      row = {
        provider: body.provider,
        start: new Date(start).toISOString(),
        finish: new Date(finish).toISOString(),
      };
    await db
      .prepare(
        'INSERT INTO ' +
          table +
          '(id,provider,start,finish,actor) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,start=excluded.start,finish=excluded.finish,actor=excluded.actor',
      )
      .run(id, row.provider, row.start, row.finish, actor.id);
    await audit(actor.id, 'capacity.' + kind + '.save', id, before, row, db);
    return { ok: true, id };
  });
}
export async function capacityReport(db, filters, actor) {
  if (
    !actor?.active ||
    !['reports.view', 'appointments.view'].every((p) =>
      actor.permissions.includes(p),
    )
  )
    throw Object.assign(Error('غير مصرح'), { status: 403 });
  if (!filters.from || !filters.to)
    return {
      configured: false,
      needs_period: true,
      definition:
        'Owner-configured dated working intervals minus overlapping time off; no default hours',
      providers: [],
    };
  const from = clinicInstant(filters.from + 'T00:00'),
    last = clinicInstant(filters.to + 'T00:00'),
    to = last + 86400000;
  if (to <= from || to - from > 366 * 86400000)
    throw Error('اختر فترة صحيحة لا تتجاوز سنة');
  await ensureCapacitySchema(db);
  const scoped = await assignedScope(db, actor, 'appointments');
  let providers = await db
    .prepare(
      "SELECT id,name FROM users WHERE active=1 AND role IN ('doctor','physio','physio_lead') ORDER BY id",
    )
    .all();
  providers = providers.filter(
    (p) =>
      (!scoped || p.id === actor.id) &&
      (!filters.provider || p.id === filters.provider),
  );
  const work = await db
      .prepare('SELECT * FROM practitioner_working_hours')
      .all(),
    leave = await db.prepare('SELECT * FROM practitioner_time_off').all(),
    appointments = await db
      .prepare(
        "SELECT provider,start,\"end\",status FROM appointments WHERE status NOT IN ('Cancelled','No show')",
      )
      .all();
  const clip = (rows) =>
    union(
      rows.map((r) => [
        Math.max(from, clinicInstant(r.start)),
        Math.min(to, clinicInstant(r.finish)),
      ]),
    );
  const rows = providers.map((provider) => {
    const entries = work.filter((r) => r.provider === provider.id),
      working = clip(entries),
      timeOff = clip(leave.filter((r) => r.provider === provider.id)),
      workingMinutes = minutes(working),
      offMinutes = minutes(intersection(working, timeOff)),
      capacity = workingMinutes - offMinutes;
    let booked = 0,
      completed = 0;
    for (const row of appointments.filter((a) => a.provider === provider.id)) {
      if (!row.start || !row.end) continue;
      const duration = Math.max(
        0,
        (Math.min(to, clinicInstant(row.end)) -
          Math.max(from, clinicInstant(row.start))) /
          60000,
      );
      booked += duration;
      if (row.status === 'Completed') completed += duration;
    }
    // No interval overlapping this period means configuration is missing, not zero available hours.
    const configured = working.length > 0;
    return {
      provider: provider.id,
      name: provider.name,
      configured,
      working_minutes: configured ? workingMinutes : null,
      time_off_minutes: configured ? offMinutes : null,
      capacity_minutes: configured ? capacity : null,
      booked_minutes: booked,
      completed_minutes: completed,
      booked_capacity_utilization:
        configured && capacity > 0 ? booked / capacity : null,
      completed_capacity_utilization:
        configured && capacity > 0 ? completed / capacity : null,
      completed_booked_utilization: booked ? completed / booked : 0,
    };
  });
  const configured = rows.length > 0 && rows.every((r) => r.configured),
    total = (key) => rows.reduce((n, r) => n + (r[key] || 0), 0),
    capacity = configured ? total('capacity_minutes') : null,
    booked = total('booked_minutes'),
    completed = total('completed_minutes');
  return {
    configured,
    from: filters.from,
    to: filters.to,
    capacity_minutes: capacity,
    booked_minutes: booked,
    completed_minutes: completed,
    booked_capacity_utilization: capacity > 0 ? booked / capacity : null,
    completed_capacity_utilization: capacity > 0 ? completed / capacity : null,
    completed_booked_utilization: booked ? completed / booked : 0,
    providers: rows,
    definition:
      'Capacity = union of working intervals minus union of overlapping time off; booked/completed minutes include bookings outside configured hours and can exceed capacity. Missing configuration and zero capacity have null capacity ratios.',
  };
}
