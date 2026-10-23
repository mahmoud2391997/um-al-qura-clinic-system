import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disposableDatabase,
  databaseDialects,
  databaseOptions,
} from './helpers/disposable-db.js';
import {
  financialReport,
  captureInvoiceFacts,
} from '../lib/financial-report.js';
import { exportRows } from '../lib/exports.js';
import { marketingMetrics } from '../lib/marketing-metrics.js';
import { listOperations } from '../lib/operations.js';
const actor = {
  id: 'o',
  role: 'owner',
  active: 1,
  permissions: [
    'finance.view',
    'finance.export',
    'reports.view',
    'reports.export',
    'marketing.view',
  ],
};
const sum = (report, key) =>
  Math.round(report.rows.reduce((n, r) => n + r[key], 0) * 1000) / 1000;
async function seed(db) {
  await db.exec(
    "INSERT INTO users(id,name,email,password,role) VALUES('o','Owner','o@test','disabled','owner'),('p1','P1','p1@test','disabled','physio'),('p2','P2','p2@test','disabled','physio'); INSERT INTO patients(id,name,phone,creator) VALUES(1,'Synthetic','TEST','o'); INSERT INTO invoices(id,patient_id,service,amount,paid) VALUES(1,1,'Therapy',90,60),(2,1,'Consult',50,20),(3,1,'Legacy',10,3),(4,1,'Tiny',0.001,0.001); INSERT INTO invoice_report_facts VALUES(1,'2026-01-01','Therapy','Rehab'),(2,'2026-01-02','Consult','Medical'),(4,'2026-01-02','Tiny','Rehab'); INSERT INTO discounts(invoice_id,amount) VALUES(1,10); INSERT INTO payments(invoice_id,kind,amount,time) VALUES(1,'Payment',100,'2026-01-01 21:00:00'),(1,'Refund',40,'2026-01-03 00:00:00'),(2,'Payment',20,'2026-01-02 19:59:59'),(4,'Payment',0.001,'2026-01-02 00:00:00'); INSERT INTO clinical(id,patient_id,provider,kind,approved) VALUES(1,1,'p1','Session',1),(2,1,'p2','Session',1),(3,1,'p1','Session',1),(4,1,'p2','Session',1),(5,1,'p2','Session',1); INSERT INTO clinical_costs VALUES(1,30,12,0,0,0,12,1),(2,30,8,0,0,0,8,0); INSERT INTO session_report_facts VALUES(1,'2026-01-02'),(2,'2026-01-03'); INSERT INTO session_billing(clinical_id,invoice_id,amount) VALUES(1,1,60),(2,1,40),(3,4,0.001),(4,4,0.001),(5,4,0.001); INSERT INTO expenses(title,category,amount,date,cost_center) VALUES('Synthetic expense','Supplies',7,'2026-01-02','Rehab center');",
  );
}
for (const dialect of databaseDialects) {
  test(
    dialect +
      ': financial source totals, period boundaries, baisa allocation and explicit legacy gaps',
    databaseOptions(dialect),
    () =>
      disposableDatabase(dialect, async (db) => {
        await seed(db);
        const all = await financialReport(db, { group_by: 'service' }, actor);
        assert.equal(sum(all, 'billed_gross'), 150.001 + 10);
        assert.equal(sum(all, 'discounts'), 10);
        assert.equal(sum(all, 'billed_net'), 150.001);
        assert.equal(sum(all, 'net_collections'), 80.001);
        assert.equal(sum(all, 'refunds'), 40);
        assert.equal(sum(all, 'session_cost'), 20);
        assert.equal(sum(all, 'expenses'), 7);
        assert.equal(sum(all, 'unrecorded_balance'), 3);
        assert.equal(all.coverage.undated_invoices, 1);
        assert.equal(all.coverage.incomplete_costs, 1);
        const day = await financialReport(
          db,
          { from: '2026-01-02', to: '2026-01-02', group_by: 'provider' },
          actor,
        );
        assert.equal(sum(day, 'collections'), 120.001);
        assert.equal(sum(day, 'refunds'), 0);
        assert.equal(sum(day, 'session_cost'), 12);
        assert.equal(sum(day, 'unrecorded_balance'), 0);
        assert.equal(sum(day, 'unallocated_collections'), 20);
        assert.equal(
          day.rows.find((r) => r.group === 'p1').collections,
          60.001,
        );
        assert.equal(day.rows.find((r) => r.group === 'p2').collections, 40);
        const refund = await financialReport(
          db,
          {
            from: '2026-01-03',
            to: '2026-01-03',
            provider: 'p1',
            group_by: 'provider',
          },
          actor,
        );
        assert.equal(sum(refund, 'net_collections'), -24);
        const expenses = await financialReport(
          db,
          { group_by: 'cost_center' },
          actor,
        );
        assert.equal(
          expenses.rows.find((r) => r.group === 'Rehab center').expenses,
          7,
        );
        const dept = await financialReport(
          db,
          { department: 'Medical', group_by: 'department' },
          actor,
        );
        assert.equal(sum(dept, 'net_collections'), 20);
        assert.equal(sum(dept, 'session_cost'), 0);
        const weekly = await financialReport(db, { group_by: 'week' }, actor);
        assert(weekly.rows.some((r) => r.group === '2025-12-29'));
        const scoped = await financialReport(
          db,
          { group_by: 'provider' },
          { ...actor, id: 'p1', role: 'physio' },
        );
        assert(scoped.rows.every((r) => r.group === 'p1'));
        assert.equal(sum(scoped, 'net_collections'), 36.001);
        assert.equal(scoped.coverage.incomplete_costs, 0);
        const widened = await financialReport(
          db,
          { provider: 'p2' },
          { ...actor, id: 'p1', role: 'physio' },
        );
        assert.deepEqual(widened.rows, []);
        const exported = await exportRows(db, 'reports/financial', actor, {
          filters: {
            from: '2026-01-02',
            to: '2026-01-02',
            group_by: 'provider',
          },
        });
        assert.equal(exported[0].record_type, 'report_definition');
        assert.deepEqual(
          exported.slice(1).map(({ record_type, ...r }) => r),
          day.rows,
        );
        for (const permission of [
          'finance.view',
          'reports.view',
          'finance.export',
          'reports.export',
        ])
          await assert.rejects(() =>
            exportRows(db, 'reports/financial', {
              ...actor,
              permissions: actor.permissions.filter((p) => p !== permission),
            }),
          );
        for (const filters of [
          { from: '2026-02-30' },
          { from: '2026-02-01', to: '2026-01-01' },
          { group_by: 'sql' },
          { provider: ['p1'] },
        ])
          await assert.rejects(() => financialReport(db, filters, actor));
        await db.exec(
          "INSERT INTO service_catalog(id,name,department) VALUES('new','New','Original'); INSERT INTO invoices(id,patient_id,service,amount) VALUES(10,1,'New',10)",
        );
        await captureInvoiceFacts(db, 10);
        await db
          .prepare("UPDATE service_catalog SET department='Changed'")
          .run();
        await captureInvoiceFacts(db, 10);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT department FROM invoice_report_facts WHERE invoice_id=10',
              )
              .get()
          ).department,
          'Original',
        );
      }),
  );
  test(
    dialect +
      ': linked marketing journey and legacy conversion reconcile summary/campaign without double counting',
    databaseOptions(dialect),
    () =>
      disposableDatabase(dialect, async (db) => {
        await db.exec(
          "INSERT INTO patients(id,name,phone) VALUES(1,'Synthetic','TEST');INSERT INTO appointments(id,patient_id) VALUES(1,1);INSERT INTO campaigns(id,name,budget) VALUES(1,'Synthetic',10);INSERT INTO leads(id,name,status,campaign_id) VALUES(1,'Linked','Attended',1),(2,'Legacy','Converted',1),(3,'Open','New',1);INSERT INTO lead_visits VALUES(1,1,1,'Attended')",
        );
        const metrics = await marketingMetrics(db);
        assert.deepEqual(
          [
            metrics.booked,
            metrics.attended,
            metrics.legacy_converted,
            metrics.converted,
          ],
          [1, 1, 1, 2],
        );
        const summary = await listOperations(
          db,
          'reports',
          actor.permissions,
          actor,
        );
        assert.equal(
          summary.find((r) => r.metric === 'تحويل الاستفسارات').value,
          2,
        );
        const campaign = (
          await listOperations(
            db,
            'marketing/campaigns',
            actor.permissions,
            actor,
          )
        )[0];
        assert.equal(campaign.converted, 2);
        await db.exec("UPDATE leads SET status='Converted' WHERE id=1");
        assert.equal((await marketingMetrics(db)).converted, 2);
      }),
  );
}
