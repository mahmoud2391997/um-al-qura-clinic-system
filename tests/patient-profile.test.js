import test from 'node:test';import assert from 'node:assert/strict';
import {createDatabase} from '../lib/db.js';import {patientProfile} from '../lib/patient-profile.js';
test('patient profile hides forbidden departments and out-of-scope patients, and audits reads',async()=>{
 const db=createDatabase(':memory:');
 try {
  db.exec("INSERT INTO users(id,name,email,password,role) VALUES('p','Test','test@invalid','disabled','physio');INSERT INTO patients(id,name,phone) VALUES(1,'Assigned','TEST1'),(2,'Other','TEST2');INSERT INTO appointments(id,patient_id,provider) VALUES(1,1,'p');INSERT INTO clinical(id,patient_id,provider,content) VALUES(1,1,'p','clinical-only');INSERT INTO invoices(id,patient_id,service,amount) VALUES(1,1,'Test',5)");
  const actor={id:'p',role:'physio',active:1,permissions:['patients.view','appointments.view']};
  const profile=await patientProfile(db,1,actor);
  assert.equal(profile.patient.id,1);assert.equal(profile.appointments.length,1);
  assert.equal('clinical' in profile,false);assert.equal('invoices' in profile,false);assert.equal('tasks' in profile,false);
  await assert.rejects(()=>patientProfile(db,2,actor));
  const event=db.prepare("SELECT * FROM audit WHERE action='patient.profile.read'").get();
  assert.equal(event.actor,'p');assert.ok(!event.after_value.includes('clinical-only'));
  const clinician=await patientProfile(db,1,{...actor,permissions:[...actor.permissions,'clinical.view']});assert.equal(clinician.clinical.length,1);
 } finally {db.close();}
});
