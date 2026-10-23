import { financialReport } from './financial-report.js';
import {listIncidents} from './quality-incidents.js';
import { audit } from './db.js';
import { asyncFilter } from "./async-collections.js";
import { scopeRows, assignedScope, roleScopes } from './data-scopes.js';
import { operationPages } from './operations-config.js';
import { listOperations } from './operations.js';
import { listPurchasing } from './purchasing.js';
import { extraPaths, listExtras } from './purchasing-extras.js';
export async function exportRows(db, path, actor, options = {}) {
  const module = path === 'quality/incidents' ? 'incidents' : path === 'purchasing/invoices' ? 'finance' : path.split('/')[0];
  if (!actor.active || !actor.permissions.includes(module + '.view') || !actor.permissions.includes(module + '.export')) throw Error('صلاحية العرض والتصدير مطلوبة');
  if (operationPages[path]?.ownerOnly && actor.role !== 'owner') throw Error('الإعدادات للمالك');
  let rows;
  if(path==='reports/financial') {
    if (!actor.permissions.includes('finance.export')) throw Error('صلاحية تصدير المالية مطلوبة');
    const report=await financialReport(db,options.filters || {},actor);
    rows=[{record_type:'report_definition',filters:report.filters,coverage:report.coverage,definition:report.definition},...report.rows.map(row=>({record_type:'data',...row}))];
  } else if(path==='quality/incidents') rows=await listIncidents(db,actor);else if (extraPaths.includes(path)) rows = await listExtras(db, path, actor);else if (['purchasing/requests', 'purchasing/orders', 'purchasing/receipts'].includes(path)) rows = await listPurchasing(db, path, actor);else if (path === 'clinical') rows = await asyncFilter(await db.prepare('SELECT c.*,d.structured FROM clinical c LEFT JOIN clinical_details d ON d.clinical_id=c.id').all(), async r => !(await assignedScope(db, actor, 'clinical')) || r.provider === actor.id);else if (path === 'tasks') rows = (await db.prepare('SELECT * FROM tasks').all()).filter(r => actor.role === 'owner' || actor.permissions.includes('tasks.approve') || r.owner === actor.id);else if (path === 'patients') rows = await db.prepare('SELECT * FROM patients').all();else if (path === 'appointments') rows = await db.prepare('SELECT * FROM appointments').all();else if (path === 'finance') rows = await db.prepare('SELECT * FROM invoices').all();else if (path === 'users') rows = await db.prepare('SELECT id,name,email,role,active FROM users').all();else if (path === 'roles') rows = await db.prepare('SELECT id,name,permissions FROM roles').all();else if (path === 'audit') rows = await db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 10000').all();else if (operationPages[path]) {
    rows = await listOperations(db, path, actor.permissions, actor);
    if (['clinical/progress', 'clinical/home-followup'].includes(path) && (await assignedScope(db, actor, 'clinical'))) rows = rows.filter(r => r.provider === actor.id);
    if (path === 'tasks/alerts') rows = rows.filter(r => actor.permissions.includes(r.module + '.view') && (actor.role === 'owner' || r.owner === actor.id));
    if (path === 'appointments/waiting') rows = await scopeRows(db, 'appointments', rows, actor);
    if (['finance/approvals', 'finance/package-returns', 'finance/corrections'].includes(path) && actor.role !== 'owner' && !actor.permissions.includes('finance.approve')) rows = rows.filter(r => r.creator === actor.id);
    if (path === 'tasks/escalations') rows = rows.filter(r => r.owner === actor.id);
  } else throw Error('التصدير غير متاح لهذا المسار');
  if (path === 'finance/corrections') rows = rows.map(({
    snapshot,
    ...r
  }) => r);
  if (['patients', 'appointments'].includes(path)) rows = await scopeRows(db, path, rows, actor);
  const result = options.render ? await options.render(rows) : rows;
  await audit(actor.id ?? null, "data.export", path, null, { count: rows.length, role:actor.role, scopes:await roleScopes(db,actor.role), format:options.format || "csv" }, db);
  return result;
}
export function toCsv(rows) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  function cell(v) {
    let s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
    if (typeof v !== 'number' && /^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\r\n');
}
