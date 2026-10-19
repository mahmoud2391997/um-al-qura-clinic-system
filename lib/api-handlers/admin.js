import {asyncMap} from '../async-collections.js';
import {roleScopes,saveRoleScopes} from '../data-scopes.js';
import {revokeSessions} from '../auth-security.js';
import {randomUUID} from 'node:crypto';
import {hashPassword} from '../db.js';
import {transaction} from '../operations.js';
import {validPermissions} from '../permissions.js';
export async function handleAdmin(context,phase){
const {path,method,body,db,audit,user,permissions,auditedResponse,mod}=context;
if(phase==='records'){
if (mod === 'roles') {
      if (method === 'GET') return auditedResponse(await asyncMap(await db.prepare('SELECT * FROM roles').all(), async r => ({
        ...r,
        permissions: JSON.parse(r.permissions),
        scopes: await roleScopes(db, r.id)
      })));
      if (user.role !== 'owner') return auditedResponse({
        error: 'إدارة الصلاحيات لمالك المجمع'
      }, 403);
      if (!body.name || !validPermissions(body.permissions)) return auditedResponse({
        error: 'الصلاحيات غير صحيحة'
      }, 400);
      if (body.id === 'owner' && !['roles.view', 'roles.edit', 'users.view', 'users.edit'].every(p => body.permissions.includes(p))) return auditedResponse({
        error: 'احتفظ بصلاحيات إدارة المستخدمين والأدوار لمنع فقدان التحكم'
      }, 400);
      const id = body.id || randomUUID();
      await transaction(db, async () => {
        const before = await db.prepare('SELECT * FROM roles WHERE id=?').get(id);
        await db.prepare('INSERT INTO roles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions').run(id, body.name, JSON.stringify(body.permissions));
        if (body.scopes) await saveRoleScopes(db, id, body.scopes);
        await audit(user.id, 'roles.save', id, before, body);
      });
      return auditedResponse({
        ok: true
      });
    }
if (path === 'users/revoke' && method === 'POST') {
      if (user.role !== 'owner') return auditedResponse({
        error: 'إبطال الجلسات للمالك'
      }, 403);
      const count = await revokeSessions(db, String(body.id));
      await audit(user.id, 'users.sessions.revoke', String(body.id), null, {
        count
      });
      return auditedResponse({
        ok: true
      });
    }
if (mod === 'users') {
      if (method === 'GET') return auditedResponse(await db.prepare('SELECT id,name,email,role,active FROM users').all());
      if (user.role !== 'owner') return auditedResponse({
        error: 'إدارة حسابات الموظفين وإسناد الأدوار لمالك المجمع'
      }, 403);
      if (!body.name || !body.email || !body.role || !body.id && String(body.password || '').length < 12) return auditedResponse({
        error: 'راجع البيانات وكلمة المرور'
      }, 400);
      if (body.role === 'owner' && user.role !== 'owner') return auditedResponse({
        error: 'إسناد المالك يتطلب صلاحية المالك'
      }, 403);
      const id = body.id || randomUUID();
      const before = await db.prepare('SELECT id,name,email,role,active FROM users WHERE id=?').get(id);
      if (before?.role === 'owner' && user.role !== 'owner') return auditedResponse({
        error: 'حساب المالك محمي'
      }, 403);
      if (before && body.password && String(body.password).length < 12) return auditedResponse({
        error: 'كلمة المرور الجديدة 12 حرفًا على الأقل'
      }, 400);
      if (before) {
        if (before.role === 'owner' && (body.role !== 'owner' || body.active === false)) return auditedResponse({
          error: 'حساب المالك لا يمكن تعطيله من هذه الشاشة'
        }, 400);
        await db.prepare('UPDATE users SET name=?,email=?,role=?,active=? WHERE id=?').run(body.name, body.email.toLowerCase(), body.role, body.active === false ? 0 : 1, id);
        if (body.password) await db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(String(body.password)), id);
        if (body.password || body.role !== before.role || body.active === false) await revokeSessions(db, id);
      } else await db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(id, body.name, body.email.toLowerCase(), hashPassword(body.password), body.role);
      await audit(user.id, 'users.save', id, before, {
        name: body.name,
        email: body.email,
        role: body.role
      });
      return auditedResponse({
        ok: true
      });
    }
}
}
