import {
  listIncidents,
  saveIncident,
  incidentPermission,
} from '../quality-incidents.js';
export async function handleAssets(context, phase) {
  const { path, method, body, db, user, permissions, auditedResponse } =
    context;
  if (phase === 'session') {
    if (path === 'quality/incidents/staff') {
      try {
        incidentPermission({ ...user, permissions }, 'view');
      } catch {
        return auditedResponse({ error: 'Permission denied' }, 403);
      }
      if (method !== 'GET') return auditedResponse({ error: 'Read only' }, 405);
      return auditedResponse(
        await db
          .prepare('SELECT id,name FROM users WHERE active=1 ORDER BY name')
          .all(),
      );
    }
    if (path === 'quality/incidents') {
      const actor = { ...user, permissions };
      try {
        incidentPermission(
          actor,
          method === 'GET' ? 'view' : body.id ? 'edit' : 'create',
        );
        if (method === 'POST' && body.status === 'Closed')
          incidentPermission(actor, 'approve');
      } catch {
        return auditedResponse({ error: 'غير مصرح' }, 403);
      }
      try {
        return auditedResponse(
          method === 'GET'
            ? await listIncidents(db, actor)
            : await saveIncident(db, body, actor),
        );
      } catch (e) {
        return auditedResponse({ error: e.message }, 400);
      }
    }
  }
}
