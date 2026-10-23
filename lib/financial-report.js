import { clinicDay } from './cashbox.js';
import { patientVisible, assignedScope } from './data-scopes.js';

const units = (value) => Math.round(Number(value || 0) * 1000);
const money = (value) => value / 1000;
const groups = new Set([
  'day',
  'week',
  'month',
  'service',
  'provider',
  'department',
  'expense_category',
  'cost_center',
]);
export const financialMetrics = [
  'billed_gross',
  'discounts',
  'billed_net',
  'collections',
  'refunds',
  'net_collections',
  'session_cost',
  'expenses',
  'receivables',
  'unallocated_collections',
  'unrecorded_balance',
];
const unknown = 'غير محدد';
export function reportFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('مرشح التقرير غير صحيح');
  const result = {};
  for (const key of ['from', 'to']) {
    const value = input[key];
    if (value === undefined || value === '') continue;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
    )
      throw Error('فترة التقرير غير صحيحة');
    result[key] = value;
  }
  if (result.from && result.to && result.from > result.to)
    throw Error('فترة التقرير غير صحيحة');
  result.group_by = input.group_by || 'month';
  if (!groups.has(result.group_by)) throw Error('تجميع التقرير غير متاح');
  for (const key of [
    'service',
    'provider',
    'department',
    'expense_category',
    'cost_center',
  ]) {
    if (input[key] === undefined || input[key] === '') continue;
    if (typeof input[key] !== 'string' || input[key].length > 200)
      throw Error('مرشح التقرير غير صحيح');
    result[key] = input[key];
  }
  return result;
}
export async function captureInvoiceFacts(db, invoiceId, serviceName) {
  const invoice = await db
    .prepare('SELECT service FROM invoices WHERE id=?')
    .get(invoiceId);
  if (!invoice) throw Error('الفاتورة غير موجودة');
  const service = serviceName || invoice.service;
  const catalog = await db
    .prepare('SELECT department FROM service_catalog WHERE name=?')
    .get(service);
  await db
    .prepare(
      'INSERT INTO invoice_report_facts(invoice_id,issued_day,service,department) VALUES(?,?,?,?) ON CONFLICT(invoice_id) DO NOTHING',
    )
    .run(invoiceId, clinicDay(), service, catalog?.department || null);
}
// Every payment/refund is apportioned in integer baisa. The final baisa is never
// independently rounded into two services/providers; residual amounts stay unallocated.
function allocate(amount, parts) {
  const total = parts.reduce((n, p) => n + p.weight, 0);
  if (!total) return parts.map(() => 0);
  const sign = Math.sign(amount),
    absolute = Math.abs(amount);
  const rows = parts.map((p, i) => {
    const exact = (absolute * p.weight) / total;
    return { i, value: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = absolute - rows.reduce((n, p) => n + p.value, 0);
  for (const row of [...rows].sort(
    (a, b) => b.fraction - a.fraction || a.i - b.i,
  )) {
    if (remainder-- <= 0) break;
    row.value++;
  }
  return rows.map((row) => sign * row.value);
}
function timestampDay(value) {
  if (!value) return null;
  const date = new Date(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(' ', 'T') + 'Z',
  );
  return Number.isFinite(date.getTime()) ? clinicDay(date) : null;
}
function period(day, grouping) {
  if (!day) return 'غير مؤرخ';
  if (grouping === 'month') return day.slice(0, 7);
  if (grouping === 'week') {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}
export async function financialReport(db, input, actor) {
  if (
    !actor?.active ||
    !actor.permissions.includes('finance.view') ||
    !actor.permissions.includes('reports.view')
  )
    throw Error('صلاحية المالية والتقارير مطلوبة');
  const filters = reportFilters(input);
  const scoped = await assignedScope(db, actor, 'clinical');
  const invoices = await db
    .prepare(
      'SELECT i.*,f.issued_day,f.service report_service,f.department FROM invoices i LEFT JOIN invoice_report_facts f ON f.invoice_id=i.id ORDER BY i.id',
    )
    .all();
  const links = await db
    .prepare(
      'SELECT b.*,c.provider FROM session_billing b JOIN clinical c ON c.id=b.clinical_id ORDER BY b.id',
    )
    .all();
  const payments = await db.prepare('SELECT * FROM payments ORDER BY id').all();
  const discounts = await db
    .prepare('SELECT invoice_id,amount FROM discounts')
    .all();
  const costs = await db
    .prepare(
      "SELECT k.*,c.provider,c.patient_id,f.approved_day FROM clinical_costs k JOIN clinical c ON c.id=k.clinical_id LEFT JOIN session_report_facts f ON f.clinical_id=c.id WHERE c.approved=1 AND c.kind='Session'",
    )
    .all();
  const facts = new Map(),
    partsByInvoice = new Map(),
    visible = new Set(),
    buckets = new Map();
  const byInvoice = (rows) => {
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.invoice_id)) grouped.set(row.invoice_id, []);
      grouped.get(row.invoice_id).push(row);
    }
    return grouped;
  };
  const invoiceLinksById = byInvoice(links),
    paymentsById = byInvoice(payments),
    discountsById = byInvoice(discounts),
    linksByClinical = new Map(links.map((r) => [r.clinical_id, r]));
  const coverage = {
    undated_invoices: 0,
    undated_sessions: 0,
    incomplete_costs: 0,
    unrecorded_balance: 0,
  };
  const add = (day, dimensions, values) => {
    if (
      (filters.from && (!day || day < filters.from)) ||
      (filters.to && (!day || day > filters.to))
    )
      return;
    if (
      Object.entries(filters).some(
        ([k, v]) =>
          !['from', 'to', 'group_by'].includes(k) && dimensions[k] !== v,
      )
    )
      return;
    if (scoped && dimensions.provider !== actor.id) return;
    const key = ['day', 'week', 'month'].includes(filters.group_by)
      ? period(day, filters.group_by)
      : dimensions[filters.group_by] || unknown;
    if (!buckets.has(key))
      buckets.set(key, {
        group: key,
        ...Object.fromEntries(financialMetrics.map((k) => [k, 0])),
        incomplete_costs: 0,
      });
    const row = buckets.get(key);
    for (const [metric, value] of Object.entries(values)) row[metric] += value;
  };
  for (const invoice of invoices) {
    if (!(await patientVisible(db, invoice.patient_id, actor))) continue;
    visible.add(invoice.id);
    const dimensions = {
      service: invoice.report_service || invoice.service || unknown,
      department: invoice.department || unknown,
      provider: unknown,
    };
    facts.set(invoice.id, dimensions);
    const invoiceLinks = invoiceLinksById.get(invoice.id) || [];
    const weights = invoiceLinks.map((r) => ({
      weight: Math.max(0, units(r.amount)),
      provider: r.provider,
      clinical_id: r.clinical_id,
    }));
    const sum = weights.reduce((n, p) => n + p.weight, 0),
      denominator = Math.max(units(invoice.amount), sum);
    weights.push({ weight: Math.max(0, denominator - sum), provider: unknown });
    if (!denominator) weights[weights.length - 1].weight = 1;
    partsByInvoice.set(invoice.id, weights);
    const discount = (discountsById.get(invoice.id) || []).reduce(
      (n, r) => n + units(r.amount),
      0,
    );
    if (
      !invoice.issued_day &&
      (!scoped || weights.some((p) => p.provider === actor.id))
    )
      coverage.undated_invoices++;
    const metrics = {
      billed_gross: units(invoice.amount) + discount,
      discounts: discount,
      billed_net: units(invoice.amount),
      receivables: units(invoice.amount) - units(invoice.paid),
    };
    for (const [metric, value] of Object.entries(metrics))
      allocate(value, weights).forEach((portion, i) =>
        add(
          invoice.issued_day,
          { ...dimensions, provider: weights[i].provider },
          { [metric]: portion },
        ),
      );
    const recorded = (paymentsById.get(invoice.id) || []).reduce(
      (n, r) => n + (r.kind === 'Refund' ? -1 : 1) * units(r.amount),
      0,
    );
    const discrepancy = units(invoice.paid) - recorded;
    coverage.unrecorded_balance += scoped
      ? allocate(discrepancy, weights).reduce(
          (n, p, i) => n + (weights[i].provider === actor.id ? p : 0),
          0,
        )
      : discrepancy;
    allocate(discrepancy, weights).forEach((portion, i) =>
      add(
        null,
        { ...dimensions, provider: weights[i].provider },
        { unrecorded_balance: portion },
      ),
    );
  }
  for (const payment of payments) {
    if (!visible.has(payment.invoice_id)) continue;
    const weights = partsByInvoice.get(payment.invoice_id),
      refund = payment.kind === 'Refund';
    allocate(units(payment.amount), weights).forEach((portion, i) =>
      add(
        timestampDay(payment.time),
        { ...facts.get(payment.invoice_id), provider: weights[i].provider },
        {
          collections: refund ? 0 : portion,
          refunds: refund ? portion : 0,
          net_collections: refund ? -portion : portion,
          unallocated_collections:
            weights[i].provider === unknown ? (refund ? -portion : portion) : 0,
        },
      ),
    );
  }
  for (const cost of costs) {
    if (scoped && cost.provider !== actor.id) continue;
    const link = linksByClinical.get(cost.clinical_id);
    if (link && !visible.has(link.invoice_id)) continue;
    if (!(await patientVisible(db, cost.patient_id, actor))) continue;
    if (!cost.approved_day) coverage.undated_sessions++;
    if (!cost.complete) coverage.incomplete_costs++;
    add(
      cost.approved_day,
      {
        ...(facts.get(link?.invoice_id) || {
          service: unknown,
          department: unknown,
        }),
        provider: cost.provider,
      },
      {
        session_cost: units(cost.total),
        incomplete_costs: cost.complete ? 0 : 1,
      },
    );
  }
  // Expense category/cost center are explicit source fields. No invented allocation
  // of general expenses to a practitioner/service and no double counting overhead.
  if (!scoped)
    for (const expense of await db
      .prepare('SELECT * FROM expenses ORDER BY id')
      .all())
      add(
        expense.date || null,
        {
          service: unknown,
          provider: unknown,
          department: unknown,
          expense_category: expense.category || unknown,
          cost_center: expense.cost_center || unknown,
        },
        { expenses: units(expense.amount) },
      );
  const rows = [...buckets.values()]
    .sort((a, b) => a.group.localeCompare(b.group))
    .map((row) => ({
      ...row,
      ...Object.fromEntries(financialMetrics.map((k) => [k, money(row[k])])),
      collection_less_session_cost: money(
        row.net_collections - row.session_cost,
      ),
      from: filters.from || '',
      to: filters.to || '',
      group_by: filters.group_by,
    }));
  return {
    filters,
    rows,
    coverage: {
      ...coverage,
      unrecorded_balance: money(coverage.unrecorded_balance),
    },
    definition:
      'OMR, 3 decimals. Collections/refunds by transaction day in Oman; invoices/current balance by recorded issue day; frozen costs by approval day. Undated legacy records excluded from dated periods. Allocation uses current session links and invoice values, not historical as-of accounting. Collection less session cost is not net accounting profit. Expenses remain separate; missing cost components are flagged.',
  };
}
