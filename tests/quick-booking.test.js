import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {createDatabase} from '../lib/db.js';import {quickBook} from '../lib/quick-booking.js';import {appointmentEnd,nextVisibleSlot} from '../lib/booking-time.js';
import {saveServicePrice} from '../lib/readiness-workflows.js';import {defaultRoles} from '../lib/permissions.js';import {PostgresDatabase} from '../lib/postgres.js';import {postgresSchema} from '../lib/postgres-schema.js';import {readinessSchema} from '../lib/readiness-schema.js';
const actor=(id,role)=>({id,role,active:1,permissions:defaultRoles.find(r=>r[0]===role)[2]});
async function fixture(dialect,fn){let db,client;try{
 if(dialect==='postgres'){const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname));client=new pg.Client({connectionString:url.toString()});await client.connect();await client.query('BEGIN');const schema='booking_'+randomUUID().replaceAll('-','');await client.query('CREATE SCHEMA '+schema);await client.query('SET LOCAL search_path TO '+schema);await client.query(postgresSchema);await client.query(readinessSchema);db=new PostgresDatabase(client);for(const [id,name,p]of defaultRoles)await db.prepare('INSERT INTO roles VALUES(?,?,?)').run(id,name,JSON.stringify(p));}else db=createDatabase(':memory:');
 await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('o','Synthetic owner','o@example.test','disabled','owner'),('r','Synthetic reception','r@example.test','disabled','reception'),('p','Synthetic provider','p@example.test','disabled','physio');INSERT INTO patients(id,name,phone,creator) VALUES(1,'Synthetic existing','TEST-OLD','o')");
 if(dialect==='postgres')await db.exec("SELECT setval(pg_get_serial_sequence('patients','id'),1,true)");
 await saveServicePrice(db,{name:'Synthetic service',department:'Synthetic department',effective_date:'2026-01-01',amount:10,floor:8,duration_minutes:45},actor('o','owner'));
 await fn(db);
 }finally{if(client){await client.query('ROLLBACK');await client.end()}else db?.close()}}
const body=()=>({request_id:randomUUID(),patient:{name:'Synthetic new',phone:'TEST-NEW',birth:'1990-01-01'},provider:'p',service:'Synthetic service',start:'2026-10-17T09:00',end:'2026-10-17T09:01'});
for(const dialect of ['sqlite','postgres']){
 const options={skip:dialect==='postgres'&&process.env.CLINIC_TEST_POSTGRES!=='1'};
 test(dialect+': patient and booking commit atomically with approved duration, price, audit and safe replay',options,()=>fixture(dialect,async db=>{
  const request=body(),result=await quickBook(db,request,actor('r','reception'));assert(result.patient_id>1);const row=await db.prepare('SELECT * FROM appointments WHERE id=?').get(result.appointment_id);assert.equal(row.end,'2026-10-17T09:45');assert.equal(row.patient_id,result.patient_id);assert.equal((await db.prepare('SELECT * FROM record_prices WHERE record_id=?').get(row.id)).amount,10);
  assert.deepEqual(await quickBook(db,request,actor('r','reception')),result);assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM appointments').get()).n),1);await assert.rejects(()=>quickBook(db,{...request,room:'changed'},actor('r','reception')),/مرجع/);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) n FROM audit WHERE action='appointments.create'").get()).n),1);
 }));
 test(dialect+': failed conflicts and duplicate phones leave no orphan patient, booking or request',options,()=>fixture(dialect,async db=>{
  await quickBook(db,{...body(),patient:undefined,patient_id:1},actor('r','reception'));
  await assert.rejects(()=>quickBook(db,body(),actor('r','reception')),/تعارض/);assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM patients').get()).n),1);
  await assert.rejects(()=>quickBook(db,{...body(),patient:{name:'Synthetic duplicate',phone:'TEST-OLD'},start:'2026-10-17T11:00'},actor('r','reception')),/الهاتف/);assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM booking_requests').get()).n),1);
 }));
 test(dialect+': role, patient scope and provider checks remain authoritative',options,()=>fixture(dialect,async db=>{
  await assert.rejects(()=>quickBook(db,body(),actor('p','physio')),/الصلاحية/);
  await assert.rejects(()=>quickBook(db,{...body(),provider:'r'},actor('r','reception')),/ممارس/);
  const scoped={...actor('r','reception'),id:'p',role:'physio'};await assert.rejects(()=>quickBook(db,{...body(),patient:undefined,patient_id:1},scoped),/ملف المريض/);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM appointments').get()).n),0);
 }));
 test(dialect+': unset service duration needs explicit end; no invented clinical default',options,()=>fixture(dialect,async db=>{
  await db.exec('DELETE FROM service_booking_policy');await assert.rejects(()=>quickBook(db,{...body(),end:undefined},actor('r','reception')),/وقت/);
  const result=await quickBook(db,{...body(),end:'2026-10-17T10:10'},actor('r','reception'));assert.equal((await db.prepare('SELECT end FROM appointments WHERE id=?').get(result.appointment_id)).end,'2026-10-17T10:10');
 }));
}
test('only owner can change or clear a service duration without changing its price history',()=>fixture('sqlite',async db=>{
 const service=await db.prepare('SELECT id FROM service_catalog').get();
 await assert.rejects(()=>saveServicePrice(db,{action:'booking-duration',service_id:service.id,duration_minutes:60},actor('r','reception')),/للمالك/);
 await assert.rejects(()=>saveServicePrice(db,{action:'booking-duration',service_id:service.id,duration_minutes:0},actor('o','owner')),/مدة/);
 await saveServicePrice(db,{action:'booking-duration',service_id:service.id,duration_minutes:60},actor('o','owner'));
 assert.equal((await db.prepare('SELECT duration_minutes FROM service_booking_policy').get()).duration_minutes,60);
 assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM service_prices').get()).n),1);
 await saveServicePrice(db,{action:'booking-duration',service_id:service.id,duration_minutes:null},actor('o','owner'));assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM service_booking_policy').get()).n),0);
}));
test('booking time validates dates, crosses midnight and skips overlapping visible slots',()=>{
 assert.equal(appointmentEnd('2026-10-17T23:45',45),'2026-10-18T00:30');assert.throws(()=>appointmentEnd('2026-02-30T09:00',45));assert.throws(()=>appointmentEnd('2026-10-17T09:00',0));
 assert.equal(nextVisibleSlot('2026-10-17T09:00',45,'p',[{provider:'p',status:'Confirmed',start:'2026-10-17T09:30',end:'2026-10-17T10:00'},{provider:'p',status:'Cancelled',start:'2026-10-17T10:00',end:'2026-10-17T11:00'}]),'2026-10-17T10:00');
});
