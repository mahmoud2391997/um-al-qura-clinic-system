import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase,hashPassword,verifyPassword} from '../lib/db.js';
import {PostgresDatabase} from '../lib/postgres.js';
import {completePasswordReset} from '../lib/password-recovery.js';
const token='a'.repeat(64),digest=createHash('sha256').update(token).digest('hex');
test('failed password update rolls back the token claim and preserves old sessions',async()=>{
 const database=createDatabase(':memory:');
 database.prepare("INSERT INTO users(id,name,email,password,role) VALUES('u','Synthetic','u@example.test',?,'owner')").run(hashPassword('old-password-123'));
 database.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(digest,'u',Date.now()+60000);
 database.prepare("INSERT INTO sessions VALUES('old','u',9999999999999)").run();
 database.exec("CREATE TRIGGER fail_password BEFORE UPDATE OF password ON users BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await assert.rejects(completePasswordReset(database,token,'new-password-123',hashPassword));
 assert.equal(database.prepare('SELECT COUNT(*) n FROM password_resets').get().n,1);
 assert.equal(database.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
 database.exec('DROP TRIGGER fail_password');
 await completePasswordReset(database,token,'new-password-123',hashPassword);
 assert.equal(database.prepare('SELECT COUNT(*) n FROM password_resets').get().n,0);
 assert.equal(database.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
 database.close();
});
test('concurrent PostgreSQL reset attempts have exactly one successful token consumer',{skip:process.env.CLINIC_TEST_POSTGRES!=='1'},async()=>{
 const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname),'Disposable localhost PostgreSQL only');
 const schema='reset_test_'+randomUUID().replaceAll('-','');
 const admin=new pg.Client({connectionString:url.toString()});await admin.connect();const clients=[];
 try{
  await admin.query('CREATE SCHEMA '+schema);
  await admin.query('SET search_path TO '+schema);
  await admin.query('CREATE TABLE users(id TEXT PRIMARY KEY,password TEXT,active INTEGER);CREATE TABLE password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT,expires BIGINT);CREATE TABLE sessions(token TEXT,user_id TEXT,expires BIGINT)');
  await admin.query('INSERT INTO users VALUES($1,$2,1)',['u',hashPassword('old-password-123')]);
  await admin.query('INSERT INTO password_resets VALUES($1,$2,$3)',[digest,'u',Date.now()+60000]);
  await admin.query("INSERT INTO sessions VALUES('old','u',9999999999999)");
  for(let i=0;i<2;i++){const client=new pg.Client({connectionString:url.toString()});await client.connect();clients.push(client);await client.query('SET search_path TO '+schema);}
  const passwords=['first-password-123','second-password-123'];
  const results=await Promise.allSettled(clients.map(async(client,index)=>{
   await client.query('BEGIN');
   try{await completePasswordReset(new PostgresDatabase(client),token,passwords[index],hashPassword);await client.query('COMMIT');return index;}catch(error){await client.query('ROLLBACK');throw error;}
  }));
  const success=results.filter(r=>r.status==='fulfilled');assert.equal(success.length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const stored=(await admin.query("SELECT password FROM users WHERE id='u'")).rows[0].password;
  assert(verifyPassword(passwords[success[0].value],stored));assert(!verifyPassword(passwords[1-success[0].value],stored));
  assert.equal(Number((await admin.query('SELECT COUNT(*) n FROM sessions')).rows[0].n),0);
  assert.equal(Number((await admin.query('SELECT COUNT(*) n FROM password_resets')).rows[0].n),0);
 }finally{for(const client of clients)await client.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
