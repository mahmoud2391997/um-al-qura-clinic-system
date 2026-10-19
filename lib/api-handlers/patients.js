import { patientProfile, linkPatientTask } from '../patient-profile.js';
import { asyncFilter } from '../async-collections.js';
import { scopeRows, patientVisible } from '../data-scopes.js';
export async function handlePatients(context, phase) {
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
    mod,
  } = context;
  if (phase === 'early') {
    if (path === 'patients/task-link' && method === 'POST') {
      try {
        return auditedResponse(
          await linkPatientTask(
            db,
            Number(body.patient_id),
            Number(body.task_id),
            { ...user, permissions },
          ),
        );
      } catch {
        return auditedResponse({ error: 'ربط المهمة غير متاح' }, 403);
      }
    }
    if (path.startsWith('patients/profile/') && method === 'GET') {
      try {
        return auditedResponse(
          await patientProfile(db, Number(path.split('/')[2]), {
            ...user,
            permissions,
          }),
        );
      } catch {
        return auditedResponse({ error: 'ملف المريض غير متاح' }, 403);
      }
    }
  }
  if (phase === 'records') {
    if (mod === 'patients') {
      if (method === 'GET')
        return privateResponse(
          await scopeRows(
            db,
            'patients',
            await db
              .prepare('SELECT * FROM patients WHERE active=1 ORDER BY id DESC')
              .all(),
            user,
          ),
        );
      if (!body.name?.trim() || !body.phone?.trim())
        return auditedResponse(
          {
            error: 'الاسم والهاتف مطلوبان',
          },
          400,
        );
      if (body.id && !(await patientVisible(db, body.id, user)))
        return auditedResponse(
          {
            error: 'ملف المريض غير متاح',
          },
          403,
        );
      const dup = await db
        .prepare('SELECT id,name FROM patients WHERE phone=? AND active=1')
        .all(body.phone.trim());
      if (dup.length && !body.confirmDuplicate && !body.id)
        return auditedResponse(
          {
            error: 'يوجد ملف بنفس الهاتف، راجع التكرار أو أكد تسجيل فرد آخر',
            duplicates: await asyncFilter(
              dup,
              async (r) => await patientVisible(db, r.id, user),
            ),
          },
          409,
        );
      if (body.id)
        await db
          .prepare(
            'UPDATE patients SET name=?,phone=?,source=?,birth=?,gender=? WHERE id=?',
          )
          .run(
            body.name,
            body.phone,
            body.source || '',
            body.birth || '',
            body.gender || '',
            body.id,
          );
      else
        await db
          .prepare(
            'INSERT INTO patients(name,phone,source,birth,gender,creator) VALUES(?,?,?,?,?,?)',
          )
          .run(
            body.name.trim(),
            body.phone.trim(),
            body.source || '',
            body.birth || '',
            body.gender || '',
            user.id,
          );
      await audit(
        user.id,
        'patients.save',
        String(body.id || 'new'),
        null,
        body,
      );
      return auditedResponse({
        ok: true,
      });
    }
  }
}
