import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
export async function verifyFinancialReport({ call, db, cookie, base }) {
  const service = 'Synthetic financial acceptance';
  assert.equal(
    (
      await call(
        'finance/service-prices',
        {
          name: service,
          department: 'Synthetic department',
          effective_date: '2020-01-01',
          amount: 50,
          floor: 0,
        },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call('finance', { patient_id: 1, service, amount: 50 }, cookie))
      .status,
    200,
  );
  const invoice = db
    .prepare('SELECT * FROM invoices WHERE service=?')
    .get(service);
  const fact = db
    .prepare('SELECT * FROM invoice_report_facts WHERE invoice_id=?')
    .get(invoice.id);
  assert(fact.issued_day);
  assert.equal(fact.department, 'Synthetic department');
  assert.equal(
    (
      await call(
        'finance',
        { id: invoice.id, payment: 30, method: 'Card' },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        'finance',
        {
          id: invoice.id,
          action: 'refund',
          payment: 5,
          method: 'Card',
          reason: 'Synthetic refund',
        },
        cookie,
      )
    ).status,
    200,
  );
  const filters = {
    service,
    from: fact.issued_day,
    to: fact.issued_day,
    group_by: 'service',
  };
  const result = await call(
    'reports/financial?' + new URLSearchParams(filters),
    null,
    cookie,
  );
  assert.equal(result.status, 200);
  assert.equal(result.value.rows.length, 1);
  assert.equal(result.value.rows[0].net_collections, 25);
  assert.equal(result.value.rows[0].billed_net, 50);
  const csv = await call(
    'reports/export',
    { path: 'reports/financial', filters },
    cookie,
  );
  assert.equal(csv.status, 200);
  assert(csv.value.csv.includes(service));
  assert(csv.value.csv.includes('report_definition'));
  assert(!csv.value.csv.includes('PRIVATE_SYNTHETIC'));
  for (const format of ['pdf', 'xlsx']) {
    const response = await fetch(base + '/api/reports/export', {
      method: 'POST',
      headers: { origin: base, 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ path: 'reports/financial', format, filters }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (format === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    else {
      const sheet = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
      assert(sheet.includes(service));
      assert(!sheet.includes('PRIVATE_SYNTHETIC'));
    }
  }
  for (const missing of [
    'finance.view',
    'reports.view',
    'finance.export',
    'reports.export',
  ]) {
    const id = 'report-missing-' + missing,
      permissions = [
        'finance.view',
        'reports.view',
        'finance.export',
        'reports.export',
      ].filter((p) => p !== missing);
    db.prepare('INSERT INTO roles(id,name,permissions) VALUES(?,?,?)').run(
      id,
      id,
      JSON.stringify(permissions),
    );
    db.prepare(
      'INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)',
    ).run(id, id, id + '@example.test', 'disabled', id);
    db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(
      id,
      id,
      Date.now() + 60000,
    );
    const deniedCookie = 'clinic_session=' + id;
    if (missing.endsWith('.view'))
      assert.equal(
        (await call('reports/financial', null, deniedCookie)).status,
        403,
      );
    assert.equal(
      (
        await call(
          'reports/export',
          { path: 'reports/financial', filters },
          deniedCookie,
        )
      ).status,
      403,
    );
  }
  console.log(
    'PASS: financial HTTP invoice facts, collections/refunds, filtered CSV/PDF/XLSX parity and all four independent financial/report grants.',
  );
}
