import {assignedScope,patientVisible} from '../data-scopes.js';
import {followupProgram} from '../clinical-programs.js';
import {approveClinicalSession} from '../session-resources.js';
import {validateClinical,saveClinicalDetails} from '../clinical.js';
import {transaction} from '../operations.js';
export async function handleClinical(context,phase){
const {path,method,body,db,audit,user,permissions,auditedResponse,privateResponse,mod,action}=context;
if(phase==='domain'){
if (path === 'clinical/templates' && method === 'POST' && user.role !== 'owner' && !['doctor', 'physio', 'physio_lead'].includes(user.role)) return auditedResponse({
      error: 'إعداد القالب للمالك أو الممارس المؤهل'
    }, 403);
if (path === 'clinical/home-followup' && method === 'POST') {
      try {
        await followupProgram(db, body, {
          ...user,
          permissions
        });
        await audit(user.id, 'clinical.home-followup', String(body.program_id), null, body);
        return auditedResponse({
          ok: true
        });
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
}
if(phase==='records'){
if (mod === 'clinical') {
      const clinician = ['doctor', 'physio', 'physio_lead'].includes(user.role);
      if (method === 'GET') return privateResponse((await assignedScope(db, user, 'clinical')) ? await db.prepare('SELECT c.*,p.name patient,d.structured,d.episode_id FROM clinical c JOIN patients p ON p.id=c.patient_id LEFT JOIN clinical_details d ON d.clinical_id=c.id WHERE c.provider=? ORDER BY c.id DESC').all(user.id) : await db.prepare('SELECT c.*,p.name patient,d.structured,d.episode_id FROM clinical c JOIN patients p ON p.id=c.patient_id LEFT JOIN clinical_details d ON d.clinical_id=c.id ORDER BY c.id DESC').all());
      if (!clinician) return auditedResponse({
        error: 'التوثيق السريري للممارس المؤهل فقط'
      }, 403);
      if (body.id) {
        const before = await db.prepare('SELECT * FROM clinical WHERE id=? AND provider=?').get(body.id, user.id);
        if (!before) return auditedResponse({
          error: 'السجل غير متاح'
        }, 404);
        if (before.approved) return auditedResponse({
          error: 'السجل معتمد؛ استخدم إضافة موثقة'
        }, 409);
        if (body.action === 'approve') await approveClinicalSession(db, body.id, user.id);else await transaction(db, async () => {
          validateClinical({
            ...body,
            kind: before.kind
          });
          await db.prepare('UPDATE clinical SET content=? WHERE id=?').run(body.content || '', body.id);
          await saveClinicalDetails(db, body.id, {
            ...body,
            kind: before.kind
          }, user.id);
        });
        await audit(user.id, 'clinical.update', String(body.id), before, body);
        return auditedResponse({
          ok: true
        });
      }
      if (body.patient_id && !(await patientVisible(db, body.patient_id, user, 'clinical'))) return auditedResponse({
        error: 'المريض خارج نطاق حسابك'
      }, 403);
      if (!body.patient_id || !body.content || !body.episode) return auditedResponse({
        error: 'المريض والحالة والمحتوى مطلوبون'
      }, 400);
      if (body.kind === 'Addendum' && !body.parent_id) return auditedResponse({
        error: 'الإضافة الموثقة تحتاج مرجعًا معتمدًا'
      }, 400);
      if (body.parent_id && !(await db.prepare('SELECT id FROM clinical WHERE id=? AND provider=? AND patient_id=? AND episode=? AND approved=1').get(body.parent_id, user.id, body.patient_id, body.episode))) return auditedResponse({
        error: 'الإضافة تحتاج سجلًا معتمدًا يخصك'
      }, 400);
      await transaction(db, async () => {
        validateClinical(body);
        const result = await db.prepare('INSERT INTO clinical(patient_id,provider,kind,episode,content,parent_id) VALUES(?,?,?,?,?,?)').run(body.patient_id, user.id, body.kind, body.episode, body.content, body.parent_id || null);
        await saveClinicalDetails(db, Number(result.lastInsertRowid), body, user.id);
      });
      await audit(user.id, 'clinical.create', 'new', null, {
        kind: body.kind,
        patient_id: body.patient_id
      });
      return auditedResponse({
        ok: true
      });
    }
}
}
