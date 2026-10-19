import {saveAutomation} from '../automation.js';
import {allowed} from '../permissions.js';
export async function handleTasks(context,phase){
const {path,method,body,db,audit,user,permissions,auditedResponse,mod}=context;
if(phase==='session'){
if (['tasks/alerts', 'tasks/recurring', 'tasks/policy', 'tasks/escalations', 'tasks/staff'].includes(path)) {
      if (!allowed(user, permissions, 'tasks', 'view')) return auditedResponse({
        error: 'صلاحية المهام مطلوبة'
      }, 403);
      if (method === 'POST') {
        if (!['tasks/recurring', 'tasks/policy'].includes(path)) return auditedResponse({
          error: 'للقراءة فقط'
        }, 403);
        try {
          return auditedResponse(await saveAutomation(db, path, body, user));
        } catch (e) {
          return auditedResponse({
            error: e.message
          }, 400);
        }
      }
      if (path === 'tasks/alerts') return auditedResponse((await db.prepare('SELECT * FROM alerts ORDER BY id DESC').all()).filter(a => permissions.includes(a.module + '.view') && (user.role === 'owner' || a.owner === user.id)));
      if (path === 'tasks/staff') return auditedResponse(await db.prepare('SELECT id,name FROM users WHERE active=1').all());
      if (path === 'tasks/escalations') return auditedResponse(await db.prepare('SELECT e.*,t.title FROM task_escalations e JOIN tasks t ON t.id=e.task_id WHERE e.owner=? OR t.owner=?').all(user.id, user.id));
      if (user.role !== 'owner') return auditedResponse({
        error: 'الإعدادات للمالك'
      }, 403);
      return auditedResponse(await db.prepare('SELECT * FROM ' + (path === 'tasks/policy' ? 'automation_policy' : 'recurring_tasks') + ' ORDER BY id DESC').all());
    }
}
if(phase==='records'){
if (mod === 'tasks') {
      if (method === 'GET') return auditedResponse(await db.prepare('SELECT t.*,u.name owner_name,CASE WHEN e.task_id IS NULL THEN 0 ELSE 1 END escalated FROM tasks t LEFT JOIN users u ON u.id=t.owner LEFT JOIN task_escalations e ON e.task_id=t.id WHERE ? OR t.owner=? OR e.owner=? ORDER BY due').all(Number(user.role === 'owner' || permissions.includes('tasks.approve')), user.id, user.id));
      if (body.id) {
        const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(body.id);
        if (!task || task.owner !== user.id && user.role !== 'owner' && !permissions.includes('tasks.approve')) return auditedResponse({
          error: 'المهمة غير متاحة للتعديل'
        }, 403);
        if (body.status === 'Completed' && !body.evidence) return auditedResponse({
          error: 'دليل الإتمام مطلوب'
        }, 400);
        if (!['Open', 'In Progress', 'Waiting', 'Completed', 'Cancelled'].includes(body.status)) return auditedResponse({
          error: 'حالة غير صحيحة'
        }, 400);
        await db.prepare('UPDATE tasks SET status=?,evidence=? WHERE id=?').run(body.status, body.evidence || '', body.id);
      } else {
        if (!body.title || !(await db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(body.owner)) || !body.due) return auditedResponse({
          error: 'العنوان والمسؤول والاستحقاق مطلوبون'
        }, 400);
        await db.prepare('INSERT INTO tasks(title,owner,due,priority) VALUES(?,?,?,?)').run(body.title, body.owner, body.due, body.priority || 'Normal');
      }
      await audit(user.id, 'tasks.save', String(body.id || 'new'), null, body);
      return auditedResponse({
        ok: true
      });
    }
}
}
