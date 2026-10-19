import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../../lib/db.js';
import {PostgresDatabase} from '../../lib/postgres.js';
import {postgresSchema} from '../../lib/postgres-schema.js';
import {readinessSchema} from '../../lib/readiness-schema.js';
import {defaultRoles} from '../../lib/permissions.js';
export async function disposableDatabase(dialect,fn){
 let db,client;
 try{
  if(dialect==='postgres'){
   const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname),'Disposable database must be loopback');
   client=new pg.Client({connectionString:url.toString()});await client.connect();await client.query('BEGIN');
   const schema='hardening_'+randomUUID().replaceAll('-','');await client.query('CREATE SCHEMA '+schema);await client.query('SET LOCAL search_path TO '+schema);
   await client.query(postgresSchema);await client.query(readinessSchema);db=new PostgresDatabase(client);
   for(const [id,name,p]of defaultRoles)await db.prepare('INSERT INTO roles(id,name,permissions) VALUES(?,?,?)').run(id,name,JSON.stringify(p));
  }else db=createDatabase(':memory:');
  await fn(db);
 }finally{if(client){await client.query('ROLLBACK');await client.end();}else db?.close();}
}
export const databaseDialects=['sqlite','postgres'];
export const databaseOptions=dialect=>({skip:dialect==='postgres'&&process.env.CLINIC_TEST_POSTGRES!=='1'});
