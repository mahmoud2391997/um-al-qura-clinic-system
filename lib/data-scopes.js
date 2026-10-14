import { asyncFilter } from "./async-collections.js";
export const scopeModules = ['patients', 'appointments', 'clinical'];
const clinician = role => ['doctor', 'physio', 'physio_lead'].includes(role);
export async function roleScopes(db, role) {
  const row = await db.prepare('SELECT * FROM role_scopes WHERE role_id=?').get(role);
  return Object.fromEntries(scopeModules.map(m => [m, role === 'owner' ? 'all' : row?.[m] || (clinician(role) ? 'assigned' : 'all')]));
}
export async function assignedScope(db, actor, module) {
  return (await roleScopes(db, actor.role))[module] === 'assigned';
}
export async function patientVisible(db, id, actor, module = 'patients') {
  if (!(await assignedScope(db, actor, module))) return !!(await db.prepare('SELECT id FROM patients WHERE id=?').get(id));
  return !!(await db.prepare('SELECT p.id FROM patients p WHERE p.id=? AND (p.creator=? OR EXISTS(SELECT 1 FROM clinical c WHERE c.patient_id=p.id AND c.provider=?) OR EXISTS(SELECT 1 FROM appointments a WHERE a.patient_id=p.id AND a.provider=?))').get(id, actor.id, actor.id, actor.id));
}
export async function scopeRows(db, module, rows, actor) {
  if (!(await assignedScope(db, actor, module))) return rows;
  if (module === 'patients') return await asyncFilter(rows, async r => await patientVisible(db, r.id, actor));
  return rows.filter(r => r.provider === actor.id);
}
export async function saveRoleScopes(db, role, scopes) {
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes) || Object.keys(scopes).some(k => !scopeModules.includes(k)) || scopeModules.some(m => !['all', 'assigned'].includes(scopes[m]))) throw Error('نطاق البيانات غير صحيح');
  if (role === 'owner' && scopeModules.some(m => scopes[m] !== 'all')) throw Error('المالك يحتفظ بنطاق جميع البيانات');
  await db.prepare('INSERT INTO role_scopes VALUES(?,?,?,?) ON CONFLICT(role_id) DO UPDATE SET patients=excluded.patients,appointments=excluded.appointments,clinical=excluded.clinical').run(role, scopes.patients, scopes.appointments, scopes.clinical);
}
