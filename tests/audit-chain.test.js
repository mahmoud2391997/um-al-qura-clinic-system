import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase,audit} from '../lib/db.js';
import {PostgresDatabase} from '../lib/postgres.js';
import {postgresSchema} from '../lib/postgres-schema.js';
import {verifyAuditChain,initializeAuditChain} from '../lib/audit-chain.js';
async function fixture(dialect,fn){
 let db,client;
 try{
  if(dialect==='postgres'){
   const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname));
   client=new pg.Client({connectionString:url.toString()});await client.connect();await client.query('BEGIN');
   const schema='chain_'+randomUUID().replaceAll('-','');await client.query('CREATE SCHEMA '+schema);
   await client.query('SET LOCAL search_path TO '+schema);await client.query(postgresSchema);db=new PostgresDatabase(client);
  }else db=createDatabase(':memory:');
  await fn(db);
 }finally{if(client){await client.query('ROLLBACK');await client.end();}else db?.close();}
}
for(const dialect of ['sqlite','postgres']){
 const options={skip:dialect==='postgres'&&process.env.CLINIC_TEST_POSTGRES!=='1'};
 test(dialect+': audit chain detects content modification, middle deletion and external head mismatch',options,()=>fixture(dialect,async db=>{
  await audit('synthetic','one','fixture',null,{value:1},db);await audit('synthetic','two','fixture',null,{value:2},db);await audit('synthetic','three','fixture',null,null,db);
  const original=await verifyAuditChain(db);assert.equal(original.ok,true);assert.equal(original.count,3);
  await db.prepare("UPDATE audit SET action='tampered' WHERE id=2").run();
  assert.deepEqual(await verifyAuditChain(db),{ok:false,firstBrokenId:2,reason:'content_hash'});
  await db.prepare("UPDATE audit SET action='two' WHERE id=2").run();
  assert.equal((await verifyAuditChain(db,{expectedHead:'f'.repeat(64)})).reason,'external_head');
  await db.prepare('DELETE FROM audit WHERE id=2').run();assert.equal((await verifyAuditChain(db)).firstBrokenId,3);
 }));
 test(dialect+': legacy baseline is explicit; tail deletion blocks appends and rolled-back writes keep chain valid',options,()=>fixture(dialect,async db=>{
  await db.prepare("INSERT INTO audit(actor,action,entity) VALUES('synthetic','legacy','fixture')").run();
  await initializeAuditChain(db);assert.equal((await verifyAuditChain(db)).legacyCount,1);
  await db.exec('SAVEPOINT fixture');await audit('synthetic','rollback','fixture',null,null,db);await db.exec('ROLLBACK TO SAVEPOINT fixture');await db.exec('RELEASE SAVEPOINT fixture');
  assert.equal((await verifyAuditChain(db)).count,1);
  await db.prepare('DELETE FROM audit').run();assert.equal((await verifyAuditChain(db)).reason,'head_or_count');
  await assert.rejects(()=>audit('synthetic','new','fixture',null,null,db),/integrity/);
 }));
}
