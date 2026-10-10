export function linkPackage(db,appointmentId,packageId){
 if(!packageId)return;
 const appointment=db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
 const pack=db.prepare('SELECT * FROM packages WHERE id=?').get(packageId);
 if(!appointment||!pack||pack.patient_id!==appointment.patient_id||pack.service!==appointment.service)throw Error('الباقة لا تطابق المريض والخدمة');
 if(appointment.status==='Completed')throw Error('اربط الباقة قبل إتمام الموعد');
 db.prepare('INSERT INTO appointment_packages(appointment_id,package_id) VALUES(?,?) ON CONFLICT(appointment_id) DO UPDATE SET package_id=excluded.package_id').run(appointmentId,packageId);
}
export function consumePackage(db,appointmentId){
 const pack=db.prepare('SELECT p.* FROM appointment_packages a JOIN packages p ON p.id=a.package_id WHERE a.appointment_id=?').get(appointmentId);
 if(!pack)return;
 if(db.prepare('SELECT appointment_id FROM package_usage WHERE appointment_id=?').get(appointmentId))return;
 const appointment=db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
 if(!appointment||pack.patient_id!==appointment.patient_id||pack.service!==appointment.service)throw Error('الباقة لا تطابق الموعد');
 const date=appointment.start.slice(0,10);
 if(date>pack.expiry)throw Error('الباقة منتهية في تاريخ الموعد');
 const used=db.prepare('SELECT COUNT(*) n FROM package_usage WHERE package_id=?').get(pack.id).n;
 if(used>=pack.total)throw Error('لا توجد جلسات متبقية في الباقة');
 db.prepare('INSERT INTO package_usage(package_id,appointment_id) VALUES(?,?)').run(pack.id,appointmentId);
}
