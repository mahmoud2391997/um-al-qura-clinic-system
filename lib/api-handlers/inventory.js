import { scopeRows } from '../data-scopes.js';
import { operationPages } from '../operations-config.js';
import { listOperations, saveOperation } from '../operations.js';
export async function handleInventory(context) {
  const {
    path,
    method,
    body,
    db,
    audit,
    user,
    permissions,
    auditedResponse,
    privateResponse,
    action,
  } = context;

  if (operationPages[path]) {
    if (method === 'GET') {
      const rows = await listOperations(db, path, permissions, user);
      return privateResponse(
        ['clinical/progress', 'clinical/home-followup'].includes(path)
          ? await scopeRows(db, 'clinical', rows, user)
          : path === 'appointments/waiting'
            ? await scopeRows(db, 'appointments', rows, user)
            : rows,
      );
    }
    if (path === 'inventory/movements' && body.kind === 'Adjustment')
      return auditedResponse(
        {
          error: 'تسوية المخزون تحتاج صلاحية اعتماد',
        },
        403,
      );
    try {
      const result = await saveOperation(db, path, body, user.id);
      await audit(
        user.id,
        path + '.' + (body.action || 'save'),
        String(result.after.id || body.id || 'new'),
        result.before,
        result.after,
      );
      return auditedResponse({
        ok: true,
      });
    } catch (e) {
      return auditedResponse(
        {
          error: e.message,
        },
        400,
      );
    }
  }
}
