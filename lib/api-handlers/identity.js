import { roleScopes } from '../data-scopes.js';
export async function handleIdentity(context, phase) {
  const {
    path,
    method,
    jar,
    isDemo,
    db,
    sessionToken,
    user,
    permissions,
    auditedResponse,
  } = context;
  if (phase === 'session') {
    if (path === 'me')
      return auditedResponse({
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
        },
        permissions,
        scopes: await roleScopes(db, user.role),
        demo: isDemo,
      });
    if (path === 'logout' && method === 'POST') {
      await db.prepare('DELETE FROM sessions WHERE token=?').run(sessionToken);
      if (isDemo) jar.delete('clinic_demo');
      else jar.delete('clinic_session');
      return auditedResponse({
        ok: true,
      });
    }
  }
}
