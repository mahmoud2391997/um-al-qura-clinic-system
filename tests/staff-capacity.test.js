import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disposableDatabase,
  databaseDialects,
  databaseOptions,
} from './helpers/disposable-db.js';
import {
  capacitySettings,
  capacityReport,
  clinicInstant,
} from '../lib/staff-capacity.js';
const owner = {
  id: 'o',
  role: 'owner',
  active: 1,
  permissions: ['users.edit', 'reports.view', 'appointments.view'],
};
for (const dialect of databaseDialects) {
  test(
    dialect +
      ': capacity unions work and time off, reconciles booking totals and keeps missing capacity null',
    databaseOptions(dialect),
    () =>
      disposableDatabase(dialect, async (db) => {
        await db
          .prepare(
            "INSERT INTO users(id,name,email,password,role) VALUES('p','Synthetic provider','p@example.test','disabled','physio')",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO users(id,name,email,password,role) VALUES('q','Other provider','q@example.test','disabled','physio')",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO patients(id,name,phone) VALUES(1,'Synthetic patient','TEST')",
          )
          .run();
        const save = (kind, start, finish) =>
          capacitySettings(db, kind, owner, {
            provider: 'p',
            start: '2026-10-19T' + start,
            finish: '2026-10-19T' + finish,
          });
        await save('working-hours', '09:00', '12:00');
        await save('working-hours', '11:00', '13:00');
        await save('time-off', '10:00', '11:00');
        await save('time-off', '10:30', '12:00');
        for (const [start, end, status] of [
          ['09:00', '10:00', 'Completed'],
          ['12:00', '13:00', 'Confirmed'],
          ['14:00', '15:00', 'Cancelled'],
        ])
          await db
            .prepare(
              'INSERT INTO appointments(patient_id,provider,start,"end",status) VALUES(1,?,?,?,?)',
            )
            .run('p', '2026-10-19T' + start, '2026-10-19T' + end, status);
        const filters = { from: '2026-10-19', to: '2026-10-19', provider: 'p' },
          report = await capacityReport(db, filters, owner),
          row = report.providers[0];
        assert.deepEqual(
          [
            row.working_minutes,
            row.time_off_minutes,
            row.capacity_minutes,
            row.booked_minutes,
            row.completed_minutes,
          ],
          [240, 120, 120, 120, 60],
        );
        assert.equal(report.booked_capacity_utilization, 1);
        assert.equal(report.completed_capacity_utilization, 0.5);
        assert.equal(report.completed_booked_utilization, 0.5);
        const all = await capacityReport(
          db,
          { ...filters, provider: '' },
          owner,
        );
        assert.equal(all.configured, false);
        assert.equal(all.capacity_minutes, null);
        assert.equal(all.booked_minutes, 120);
        const scoped = await capacityReport(
          db,
          { ...filters, provider: 'q' },
          { ...owner, id: 'p', role: 'physio' },
        );
        assert.deepEqual(scoped.providers, []);
        await assert.rejects(
          () =>
            capacitySettings(
              db,
              'working-hours',
              { ...owner, role: 'manager' },
              { provider: 'p' },
            ),
          /للمالك/,
        );
        await assert.rejects(
          () =>
            capacityReport(db, filters, {
              ...owner,
              permissions: ['reports.view'],
            }),
          /مصرح/,
        );
        const blank = await capacityReport(db, {}, owner);
        assert.equal(blank.needs_period, true);
      }),
  );
  test(
    dialect +
      ': capacity clips overnight intervals in Oman, zero capacity ratios are null and invalid updates roll back',
    databaseOptions(dialect),
    () =>
      disposableDatabase(dialect, async (db) => {
        await db
          .prepare(
            "INSERT INTO users(id,name,email,password,role) VALUES('p','Synthetic provider','p@example.test','disabled','physio')",
          )
          .run();
        const saved = await capacitySettings(db, 'working-hours', owner, {
          provider: 'p',
          start: '2026-10-18T22:00',
          finish: '2026-10-19T02:00',
        });
        await capacitySettings(db, 'time-off', owner, {
          provider: 'p',
          start: '2026-10-18T21:00',
          finish: '2026-10-19T03:00',
        });
        const r = await capacityReport(
          db,
          { from: '2026-10-19', to: '2026-10-19' },
          owner,
        );
        assert.equal(r.capacity_minutes, 0);
        assert.equal(r.booked_capacity_utilization, null);
        assert.equal(r.providers[0].working_minutes, 120);
        await assert.rejects(() =>
          capacitySettings(db, 'working-hours', owner, {
            id: saved.id,
            provider: 'p',
            start: 'invalid',
            finish: 'invalid',
          }),
        );
        assert.equal(
          (await capacitySettings(db, 'working-hours', owner)).length,
          1,
        );
        await capacitySettings(db, 'working-hours', owner, {
          id: saved.id,
          action: 'remove',
        });
        assert.equal(
          (await capacitySettings(db, 'working-hours', owner)).length,
          0,
        );
      }),
  );
}
test('clinic wall times are independent of host timezone and reject impossible dates', () => {
  assert.equal(
    clinicInstant('2026-10-19T09:00'),
    Date.parse('2026-10-19T05:00:00Z'),
  );
  assert.throws(() => clinicInstant('2026-02-30T09:00'));
  assert.throws(() => clinicInstant('2026-10-19T25:00'));
});
