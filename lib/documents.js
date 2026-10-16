import { asyncFilter } from "./async-collections.js";
import { patientVisible, assignedScope } from './data-scopes.js';
import { transaction } from './operations.js';
import { audit } from './db.js';
export const documentPaths = ['patients/attachments', 'clinical/attachments', 'compliance/attachments','equipment/attachments'];
const clinician = a => ['doctor', 'physio', 'physio_lead'].includes(a.role);
function permission(actor, module, action) {
  if (!actor.active || !actor.permissions.includes(module + '.' + action)) throw Error('صلاحية المرفقات مطلوبة');
}
export async function documentTargets(db, path, actor) {
  const module = path.split('/')[0];
  permission(actor, module, 'view');
  if(module==='equipment')return db.prepare('SELECT id,description name FROM maintenance ORDER BY id DESC').all();
  if (module === 'compliance') return await db.prepare('SELECT id,title name FROM licenses ORDER BY title').all();
  if (await assignedScope(db, actor, module)) return await asyncFilter(await db.prepare('SELECT id,name FROM patients WHERE active=1 ORDER BY name').all(), async r => await patientVisible(db, r.id, actor, module));
  return await db.prepare('SELECT id,name FROM patients WHERE active=1 ORDER BY name').all();
}
async function target(db, path, id, actor) {
  if (!(await documentTargets(db, path, actor)).some(r => r.id === Number(id))) throw Error('الملف غير متاح لهذا الحساب');
}
export async function listDocuments(db, path, actor) {
  permission(actor, path.split('/')[0], 'view');
  const ids = new Set((await documentTargets(db, path, actor)).map(r => r.id));
  return (await db.prepare('SELECT id,path,target_id,name,mime,size,actor,time FROM documents WHERE path=? ORDER BY id DESC').all(path)).filter(r => ids.has(r.target_id));
}
export async function saveDocument(db, path, body, actor) {
  return await transaction(db, async () => {
    const module = path.split('/')[0];
    permission(actor, module, body.action === 'download' ? 'view' : 'create');
    if (body.action === 'download') {
      const row = await db.prepare('SELECT * FROM documents WHERE id=? AND path=?').get(body.id, path);
      if (!row) throw Error('المرفق غير موجود');
      await target(db, path, row.target_id, actor);
      await audit(actor.id, module + '.document.download', String(row.id), null, {
        size: row.size, mime: row.mime
      }, db);
      return {
        file: {
          name: row.name,
          mime: row.mime,
          data: row.data
        }
      };
    }
    await target(db, path, body.target_id, actor);
    const name = String(body.name || '').trim().replace(/[\\/\x00-\x1f]/g, '_').slice(0, 120),
      mime = String(body.mime),
      data = String(body.data || '');
    if (!name || !['application/pdf', 'image/png', 'image/jpeg'].includes(mime) || !data || data.length > 2800000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw Error('المسموح PDF أو PNG أو JPEG حتى 2 ميجابايت');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length < 1 || bytes.length > 2 * 1024 * 1024) throw Error('حجم الملف غير مسموح');
    const valid = mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
    if (!valid) throw Error('نوع الملف لا يطابق محتواه');
    if ((await db.prepare('SELECT COUNT(*) n FROM documents WHERE path=? AND target_id=?').get(path, body.target_id)).n >= 10 || (await db.prepare('SELECT COALESCE(SUM(size),0) n FROM documents').get()).n + bytes.length > 30 * 1024 * 1024) throw Error('حد تخزين المرفقات ممتلئ');
    const id = Number((await db.prepare('INSERT INTO documents(path,target_id,name,mime,size,data,actor) VALUES(?,?,?,?,?,?,?)').run(path, body.target_id, name, mime, bytes.length, data, actor.id)).lastInsertRowid);
    await audit(actor.id, module + '.document.upload', String(id), null, {
      target_id: body.target_id,
      name,
      mime,
      size: bytes.length
    }, db);
    return {
      ok: true
    };
  });
}
