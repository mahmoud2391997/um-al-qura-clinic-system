import {lockRecord} from './row-locks.js';
import { usedPackageSessions } from './package-returns.js';
export async function linkPackage(db, appointmentId, packageId) {
  if (!packageId) return;
  await lockRecord(db,'appointments',appointmentId);
  const appointment = await db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
  await lockRecord(db,'packages',packageId);
  const pack = await db.prepare('SELECT * FROM packages WHERE id=?').get(packageId);
  if (!appointment || !pack || pack.patient_id !== appointment.patient_id || pack.service !== appointment.service) throw Error('الباقة لا تطابق المريض والخدمة');
  if (appointment.status === 'Completed') throw Error('اربط الباقة قبل إتمام الموعد');
  await db.prepare('INSERT INTO appointment_packages(appointment_id,package_id) VALUES(?,?) ON CONFLICT(appointment_id) DO UPDATE SET package_id=excluded.package_id').run(appointmentId, packageId);
}
export async function consumePackage(db, appointmentId) {
  await lockRecord(db,'appointments',appointmentId);
  const pack = await db.prepare('SELECT p.* FROM appointment_packages a JOIN packages p ON p.id=a.package_id WHERE a.appointment_id=?').get(appointmentId);
  if (!pack) return;
  await lockRecord(db,'packages',pack.id);
  if (await db.prepare("SELECT id FROM package_returns WHERE appointment_id=? AND status='Approved'").get(appointmentId)) throw Error('جلسة هذا الموعد رُدت؛ أنشئ موعدًا جديدًا بدل خصمها ثانية');
  if (await db.prepare('SELECT appointment_id FROM package_usage WHERE appointment_id=?').get(appointmentId)) return;
  const appointment = await db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
  if (!appointment || pack.patient_id !== appointment.patient_id || pack.service !== appointment.service) throw Error('الباقة لا تطابق الموعد');
  const date = appointment.start.slice(0, 10);
  if (date > pack.expiry) throw Error('الباقة منتهية في تاريخ الموعد');
  const used = await usedPackageSessions(db, pack.id);
  if (used >= pack.total) throw Error('لا توجد جلسات متبقية في الباقة');
  await db.prepare('INSERT INTO package_usage(package_id,appointment_id) VALUES(?,?)').run(pack.id, appointmentId);
}
