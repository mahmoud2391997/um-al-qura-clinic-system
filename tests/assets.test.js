import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../lib/db.js';
import {saveOperation,listOperations,consumeEquipment} from '../lib/operations.js';
import {exportRows} from '../lib/exports.js';
import {defaultRoles,allowed} from '../lib/permissions.js';
import {postgresSchema} from '../lib/postgres-schema.js';
import {PostgresDatabase} from '../lib/postgres.js';
import {migrateAssetsPostgres,migrateAssetsSqlite} from '../lib/asset-schema.js';
import {omanDate} from '../lib/stock-batches.js';
const asset={name:'Synthetic asset',model:'TEST',serial:'TEST',location:'Test',status:'Active',capacity:100,replacement_cost:0,component:'',warranty:''};
const vendor={name:'Synthetic vendor',registration:'TEST-1',phone:'+968 0000 0000',email:'vendor@example.invalid',address:'Synthetic',status:'Active'};
async function journey(db){
 const v=(await saveOperation(db,'purchasing/vendors',{...vendor},'o')).after;
 const a=(await saveOperation(db,'equipment',{...asset,purchase_date:'2026-01-01',purchase_cost:125.5,vendor_id:v.id,maintenance_interval_days:30,last_maintenance:'2026-02-01',next_maintenance:'2026-03-03'},'o')).after;
 assert.equal(a.purchase_cost,125.5);assert.equal(a.vendor_id,v.id);
 await saveOperation(db,'equipment',{...asset,id:a.id,location:'New room',status:'Under Maintenance'},'o');
 assert.equal((await db.prepare('SELECT * FROM equipment WHERE id=?').get(a.id)).purchase_date,'2026-01-01');
 const ticket=(await saveOperation(db,'equipment/maintenance',{equipment_id:a.id,kind:'Preventive',description:'Synthetic service',priority:'Normal',owner:'o',due:omanDate(),cost:0,parts:''},'o')).after;
 const result=await saveOperation(db,'equipment/maintenance',{id:ticket.id,action:'complete'},'o');
 assert.equal(result.after.equipment.last_maintenance,omanDate());assert.equal(result.after.equipment.status,'Under Maintenance');assert(Number.isFinite(result.after.downtime_hours));
 const next=new Date(Date.parse(omanDate()+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);
 assert.equal(result.after.equipment.next_maintenance,next);
 await saveOperation(db,'equipment/maintenance',{id:ticket.id,action:'complete'},'o');
 assert.equal((await db.prepare('SELECT next_maintenance FROM equipment WHERE id=?').get(a.id)).next_maintenance,next);
 for(const status of ['Under Maintenance','Retired','Out of Service']){
  await saveOperation(db,'equipment',{...asset,id:a.id,status},'o');
  await assert.rejects(()=>consumeEquipment(db,{id:a.id,quantity:1,reference:'Synthetic'},'o'),/خارج الخدمة/);
 }
 assert.equal((await listOperations(db,'purchasing/vendors')).length,1);
}
test('assets persist purchase/vendor/schedule data; maintenance closes atomically and unsafe statuses block use',async()=>{const db=createDatabase(':memory:');try{await journey(db);}finally{db.close();}});
test('asset validation rejects invalid dates, costs, schedules and nonexistent/inactive vendors',async()=>{
 const db=createDatabase(':memory:');try{
 for(const extra of [{purchase_date:'2026-02-30'},{purchase_cost:-1},{purchase_cost:'NaN'},{maintenance_interval_days:0},{maintenance_interval_days:1.5},{last_maintenance:'2026-03-02',next_maintenance:'2026-03-01'},{purchase_date:'2026-02-01',last_maintenance:'2026-01-01'},{vendor_id:'missing'}])await assert.rejects(()=>saveOperation(db,'equipment',{...asset,...extra},'o'));
 const v=(await saveOperation(db,'purchasing/vendors',{...vendor,status:'Inactive'},'o')).after;
 await assert.rejects(()=>saveOperation(db,'equipment',{...asset,vendor_id:v.id},'o'));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM equipment').get()).n,0);
 }finally{db.close();}
});
test('maintenance completion rolls back when its start timestamp is invalid',async()=>{
 const db=createDatabase(':memory:');try{
 const a=(await saveOperation(db,'equipment',{...asset,maintenance_interval_days:30},'o')).after;
 const id=(await db.prepare("INSERT INTO maintenance(equipment_id,status,opened,due) VALUES(?,'Open','bad','bad')").run(a.id)).lastInsertRowid;
 await assert.rejects(()=>saveOperation(db,'equipment/maintenance',{id,action:'complete'},'o'),/تاريخ بدء/);
 assert.equal((await db.prepare('SELECT status FROM maintenance WHERE id=?').get(id)).status,'Open');
 assert.equal((await db.prepare('SELECT last_maintenance FROM equipment WHERE id=?').get(a.id)).last_maintenance,'');
 }finally{db.close();}
});
test('vendor master validates unique references, contact values and required fields',async()=>{
 const db=createDatabase(':memory:');try{
 const v=(await saveOperation(db,'purchasing/vendors',{...vendor},'o')).after;
 for(const extra of [{},{registration:''},{registration:'TEST-2',email:'bad'},{registration:'TEST-2',phone:'unsafe<script>'},{registration:'TEST-2',status:'Unknown'}])await assert.rejects(()=>saveOperation(db,'purchasing/vendors',{...vendor,...extra},'o'));
 const result=await saveOperation(db,'purchasing/vendors',{...vendor,id:v.id,name:'Updated'},'o');assert.equal(result.before.name,v.name);assert.equal(result.after.name,'Updated');
 }finally{db.close();}
});
test('purchasing access and export remain permission-bound; vendor export is audited',async()=>{
 const db=createDatabase(':memory:');try{
 for(const[id,name,permissions]of defaultRoles)await db.prepare('INSERT OR IGNORE INTO roles VALUES(?,?,?)').run(id,name,JSON.stringify(permissions));
 await db.prepare("INSERT INTO users(id,name,email,password,role) VALUES('o','Owner','o@example.invalid','disabled','owner')").run();
 await saveOperation(db,'purchasing/vendors',{...vendor},'o');
 const maintenance=defaultRoles.find(r=>r[0]==='maintenance')[2];assert.equal(allowed({active:1},maintenance,'purchasing','view'),false);
 await assert.rejects(()=>exportRows(db,'purchasing/vendors',{id:'o',role:'owner',active:1,permissions:['purchasing.view']}));
 const rows=await exportRows(db,'purchasing/vendors',{id:'o',role:'owner',active:1,permissions:['purchasing.view','purchasing.export']});assert.equal(rows.length,1);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit WHERE action='data.export' AND entity='purchasing/vendors'").get()).n,1);
 }finally{db.close();}
});
test('additive SQLite migration preserves existing records and persists across reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clinic-assets-')),path=join(dir,'test.sqlite');const legacy=new DatabaseSync(path);legacy.exec("CREATE TABLE equipment(id INTEGER PRIMARY KEY,name TEXT NOT NULL,model TEXT,serial TEXT,location TEXT,status TEXT DEFAULT 'Active',warranty TEXT,component TEXT,capacity INTEGER DEFAULT 0,used INTEGER DEFAULT 0,replacement_cost REAL DEFAULT 0);INSERT INTO equipment(name) VALUES('Legacy')");legacy.close();let db=createDatabase(path);
 try{migrateAssetsSqlite(db);await saveOperation(db,'purchasing/vendors',{...vendor},'o');db.close();db=createDatabase(path);assert.equal((await db.prepare('SELECT * FROM equipment').get()).name,'Legacy');assert.equal((await db.prepare('SELECT * FROM equipment').get()).purchase_cost,null);assert.equal((await listOperations(db,'purchasing/vendors')).length,1);}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('asset/vendor journey and idempotent additive migrations work in PostgreSQL',{skip:process.env.CLINIC_TEST_POSTGRES!=='1'},async()=>{
 const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname));const client=new pg.Client({connectionString:url.toString()});await client.connect();
 try{await client.query('BEGIN');const schema='asset_test_'+randomUUID().replaceAll('-','');await client.query('CREATE SCHEMA '+schema);await client.query('SET LOCAL search_path TO '+schema);await client.query(postgresSchema);await client.query("INSERT INTO equipment(name) VALUES('Legacy asset')");await migrateAssetsPostgres(client);await migrateAssetsPostgres(client);assert.equal((await client.query("SELECT purchase_cost FROM equipment WHERE name='Legacy asset'")).rows[0].purchase_cost,null);await journey(new PostgresDatabase(client));}finally{await client.query('ROLLBACK');await client.end();}
});
