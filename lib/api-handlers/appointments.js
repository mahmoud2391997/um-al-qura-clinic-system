import {quickBook} from '../quick-booking.js';
import {priceForRecord,snapshotPrice} from '../readiness-workflows.js';
import {scopeRows,assignedScope,patientVisible} from '../data-scopes.js';
import {rescheduleAppointment} from '../appointment-workflow.js';
import {linkPackage,consumePackage} from '../packages.js';
import {transaction} from '../operations.js';
import {allowed} from '../permissions.js';
export async function handleAppointments(context,phase){
const {path,method,body,db,audit,user,permissions,auditedResponse,privateResponse,mod,action}=context;
if(phase==='early'){
if(path==='appointments/book'){if(method!=='POST')return auditedResponse({error:'غير متاح'},405);try{return auditedResponse(await quickBook(db,body,{...user,permissions}));}catch(e){return auditedResponse({error:e.message},e.status||400);}}
}
if(phase==='session'){
if (path === 'appointments/staff' && method === 'GET') {
      if (!allowed(user, permissions, 'appointments', 'view')) return auditedResponse({error:'صلاحية المواعيد مطلوبة'},403);
      return auditedResponse(await db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('doctor','physio','physio_lead') ORDER BY name").all());
    }
}
if(phase==='domain'){
if (path === 'appointments/waiting' && method === 'POST') {
      const waiting = body.id ? await db.prepare('SELECT * FROM waiting_list WHERE id=?').get(body.id) : null;
      if (body.id && !waiting) return auditedResponse({
        error: 'سجل الانتظار غير موجود'
      }, 404);
      if ((await assignedScope(db, user, 'appointments')) && (waiting?.provider || body.provider) !== user.id) return auditedResponse({
        error: 'سجل الانتظار خارج نطاق حسابك'
      }, 403);
      if (!(await patientVisible(db, waiting?.patient_id || body.patient_id, user, 'patients'))) return auditedResponse({
        error: 'المريض خارج نطاق حسابك'
      }, 403);
    }
}
if(phase==='records'){
if (mod === 'appointments') {
      if (method === 'GET') return privateResponse(await scopeRows(db, 'appointments', await db.prepare('SELECT a.*,p.name patient FROM appointments a JOIN patients p ON p.id=a.patient_id ORDER BY start').all(), user));
      if (body.id && (await assignedScope(db, user, 'appointments')) && !(await db.prepare('SELECT id FROM appointments WHERE id=? AND provider=?').get(body.id, user.id))) return auditedResponse({
        error: 'الموعد غير متاح'
      }, 403);
      if (!body.id && (await assignedScope(db, user, 'appointments')) && body.provider !== user.id) return auditedResponse({
        error: 'الموعد خارج نطاق حسابك'
      }, 403);
      if (body.patient_id && !(await patientVisible(db, body.patient_id, user, 'patients'))) return auditedResponse({
        error: 'المريض خارج نطاق حسابك'
      }, 403);
      if (body.id && body.action === 'reschedule') {
        try {
          await rescheduleAppointment(db, body, user.id);
          return auditedResponse({
            ok: true
          });
        } catch (e) {
          return auditedResponse({
            error: e.message
          }, 400);
        }
      }
      if (body.id) {
        const before = await db.prepare('SELECT * FROM appointments WHERE id=?').get(body.id);
        if (!before) return auditedResponse({
          error: 'الموعد غير موجود'
        }, 404);
        if (!['Pending', 'Confirmed', 'Arrived', 'Waiting', 'In Service', 'Completed', 'Cancelled', 'No show'].includes(body.status)) return auditedResponse({
          error: 'حالة غير صحيحة'
        }, 400);
        if (['Cancelled', 'No show'].includes(body.status) && !body.reason) return auditedResponse({
          error: 'سبب الإلغاء أو عدم الحضور مطلوب'
        }, 400);
        await transaction(db, async () => {
          if (body.package_id) await linkPackage(db, body.id, body.package_id);
          if (body.status === 'Completed') await consumePackage(db, body.id);
          await db.prepare(`UPDATE appointments SET status=?,reason=?,arrived=CASE WHEN ?='Arrived' THEN CURRENT_TIMESTAMP ELSE arrived END,started=CASE WHEN ?='In Service' THEN CURRENT_TIMESTAMP ELSE started END,completed=CASE WHEN ?='Completed' THEN CURRENT_TIMESTAMP ELSE completed END WHERE id=?`).run(body.status, body.reason || '', body.status, body.status, body.status, body.id);
        });
        await audit(user.id, 'appointments.status', String(body.id), before, body);
        return auditedResponse({
          ok: true
        });
      }
      if (!body.patient_id || !body.provider || !body.start || !body.end || Date.parse(body.end) <= Date.parse(body.start)) return auditedResponse({
        error: 'راجع المريض والممارس ووقت البداية والنهاية'
      }, 400);
      const conflict = await db.prepare(`SELECT id FROM appointments WHERE status NOT IN ('Cancelled','No show') AND start<? AND end>? AND (provider=? OR (room<>'' AND room=?))`).get(body.end, body.start, body.provider, body.room || '');
      if (conflict) return auditedResponse({
        error: 'تعارض في الممارس أو الغرفة'
      }, 409);
      await transaction(db, async () => {
        const price=await priceForRecord(db,body.service||'',body.start.slice(0,10));
        const result = await db.prepare('INSERT INTO appointments(patient_id,provider,start,end,room,service) VALUES(?,?,?,?,?,?)').run(body.patient_id, body.provider, body.start, body.end, body.room || '', body.service || '');
        if(price)await snapshotPrice(db,'appointment',Number(result.lastInsertRowid),price,price.amount);
        if (body.package_id) await linkPackage(db, Number(result.lastInsertRowid), body.package_id);
      });
      await audit(user.id, 'appointments.create', 'new', null, body);
      return auditedResponse({
        ok: true
      });
    }
}
}
