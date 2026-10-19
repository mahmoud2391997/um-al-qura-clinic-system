import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from '../lib/postgres.js';
import {postgresSchema} from '../lib/postgres-schema.js';
import {readinessSchema} from '../lib/readiness-schema.js';
import {resourceLockSchema} from '../lib/row-locks.js';
import {initializeAuditChain} from '../lib/audit-chain.js';
import {defaultRoles} from '../lib/permissions.js';
import {saveServicePrice} from '../lib/readiness-workflows.js';
import {quickBook} from '../lib/quick-booking.js';
import {consumePackage} from '../lib/packages.js';
import {stockMovement} from '../lib/operations.js';
import {recordPayment} from '../lib/finance.js';
import {closeCashDay,clinicDay} from '../lib/cashbox.js';
const enabled=process.env.CLINIC_TEST_POSTGRES==='1';
const actor={id:'o',role:'owner',active:1,permissions:defaultRoles.find(r=>r[0]==='owner')[2]};
async function concurrentFixture(fn){
 const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname));
 const schema='concurrency_'+randomUUID().replaceAll('-',''),admin=new pg.Client({connectionString:url.toString()});await admin.connect();
 try{
  await admin.query('CREATE SCHEMA '+schema);await admin.query('SET search_path TO '+schema);await admin.query(postgresSchema);await admin.query(readinessSchema);await admin.query(resourceLockSchema);
  const db=new PostgresDatabase(admin);await admin.query('BEGIN');await initializeAuditChain(db);
  for(const [id,name,p]of defaultRoles)await db.prepare('INSERT INTO roles(id,name,permissions) VALUES(?,?,?)').run(id,name,JSON.stringify(p));
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('o','Synthetic owner','o@example.test','disabled','owner'),('p','Synthetic provider','p@example.test','disabled','physio');INSERT INTO patients(id,name,phone) VALUES(1,'Synthetic patient','TEST')");
  await saveServicePrice(db,{name:'Synthetic service',department:'Synthetic department',effective_date:'2026-01-01',amount:100,floor:10},actor);await admin.query('COMMIT');
  const run=async work=>{
   const client=new pg.Client({connectionString:url.toString()});await client.connect();
   try{await client.query('BEGIN');await client.query('SET LOCAL search_path TO '+schema);await client.query("SET LOCAL lock_timeout='5s'");const result=await work(new PostgresDatabase(client));await client.query('COMMIT');return result;}
   catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
  };
  await fn(db,run);
 }finally{await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
}
test('PostgreSQL parallel bookings serialize shared provider/room and preserve request idempotency without clinic lock',{skip:!enabled},()=>concurrentFixture(async(db,run)=>{
 const body={patient_id:1,provider:'p',service:'Synthetic service',start:'2026-10-20T09:00',end:'2026-10-20T09:30',room:'Synthetic room'};
 const results=await Promise.allSettled([1,2].map(()=>run(d=>quickBook(d,{...body,request_id:randomUUID()},actor))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/تعارض/);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM appointments').get()).n,1);
 const retry={...body,start:'2026-10-20T10:00',end:'2026-10-20T10:30',request_id:randomUUID()};
 const duplicate=await Promise.all([run(d=>quickBook(d,retry,actor)),run(d=>quickBook(d,retry,actor))]);assert.equal(duplicate[0].appointment_id,duplicate[1].appointment_id);
}));
test('PostgreSQL parallel package consumption, FEFO issue and invoice collections cannot overspend without clinic lock',{skip:!enabled},()=>concurrentFixture(async(db,run)=>{
 await db.exec("INSERT INTO appointments(id,patient_id,provider,start,\"end\",service) VALUES(11,1,'p','2026-10-20T09:00','2026-10-20T09:30','Synthetic service'),(12,1,'p','2026-10-20T10:00','2026-10-20T10:30','Synthetic service');INSERT INTO packages(id,patient_id,service,total,expiry) VALUES(1,1,'Synthetic service',1,'2027-01-01');INSERT INTO appointment_packages(appointment_id,package_id) VALUES(11,1),(12,1);INSERT INTO inventory(id,name,quantity,average_cost,expiry) VALUES(1,'Synthetic stock',10,2,'');INSERT INTO stock_batches(item_id,number,expiry,quantity,cost) VALUES(1,'SYNTHETIC','',10,2);INSERT INTO invoices(id,patient_id,service,amount,paid) VALUES(1,1,'Synthetic service',100,0)");
 const packages=await Promise.allSettled([11,12].map(id=>run(d=>consumePackage(d,id))));assert.equal(packages.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.prepare('SELECT COUNT(*) n FROM package_usage').get()).n,1);
 const stock=await Promise.allSettled([1,2].map(()=>run(d=>stockMovement(d,{item_id:1,kind:'Issue',quantity:7,reason:'Synthetic issue'},'o'))));assert.equal(stock.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.prepare('SELECT quantity FROM inventory WHERE id=1').get()).quantity,3);assert.equal((await db.prepare('SELECT SUM(quantity) n FROM stock_batches WHERE item_id=1').get()).n,3);
 const payments=await Promise.allSettled([1,2].map(()=>run(d=>recordPayment(d,{id:1,payment:60,method:'Card'},'o'))));assert.equal(payments.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.prepare('SELECT paid FROM invoices WHERE id=1').get()).paid,60);
}));
test('PostgreSQL cash close and parallel cash collection reconcile using the cash-day resource lock',{skip:!enabled},()=>concurrentFixture(async(db,run)=>{
 await db.exec("INSERT INTO invoices(id,patient_id,service,amount,paid) VALUES(1,1,'Synthetic service',100,0)");
 const date=clinicDay(),future=new Date(Date.now()+2*86400000);
 const results=await Promise.allSettled([run(d=>recordPayment(d,{id:1,payment:40,method:'Cash'},'o')),run(d=>closeCashDay(d,{date,opening:0,counted:0,reason:'Synthetic count'},'o',future))]);
 assert.equal(results[1].status,'fulfilled');const closure=await db.prepare('SELECT * FROM cash_closures WHERE date=?').get(date),paid=(await db.prepare('SELECT paid FROM invoices WHERE id=1').get()).paid;
 assert.equal(closure.collections,paid);assert([0,40].includes(paid));
}));
