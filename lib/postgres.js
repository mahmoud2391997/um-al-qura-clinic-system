import {qualitySchema} from './quality-schema.js';
import {readinessSchema} from './readiness-schema.js';
import pg from 'pg';
import {postgresSchema} from './postgres-schema.js';
import {defaultRoles} from './permissions.js';
import {initialTemplates} from './clinical-programs.js';
pg.types.setTypeParser(20,Number);
let pool,ready;
export function postgresConfigured(){return Boolean(process.env.DATABASE_URL);}
export function postgresPool(){
 if(!pool){if(!postgresConfigured())throw Error('قاعدة البيانات الدائمة غير مهيأة');const url=new URL(process.env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('نوع اتصال قاعدة البيانات غير صحيح');const schema=process.env.CLINIC_POSTGRES_SCHEMA;if(schema&&!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('Invalid schema');pool=new pg.Pool({connectionString:url.toString(),...(schema?{options:'-c search_path='+schema}:{}),max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,query_timeout:15000});}
 return pool;
}
// Keep placeholders inside strings unchanged. Existing domain queries are parameterized.
export function translateQuery(input){
 let sql=input.replace(/date\(time,'\+4 hours'\)/g,"to_char(time::timestamp + interval '4 hours','YYYY-MM-DD')")
 .replace(/MAX\(0,\(julianday\('now'\)-julianday\(COALESCE\(opened,due\)\)\)\)\*24\)/g,"GREATEST(0,EXTRACT(EPOCH FROM (now()-COALESCE(NULLIF(opened,''),due)::timestamp))/3600)")
 .replace(/\bGROUP_CONCAT\(/gi,'STRING_AGG(')
 .replace(/\bINSERT OR IGNORE INTO\b/gi,'INSERT INTO');
 const ignore=/\bINSERT OR IGNORE INTO\b/i.test(input);let out='',quote=null,n=0;
 for(let i=0;i<sql.length;i++){const ch=sql[i];if(quote){out+=ch;if(ch===quote){if(sql[i+1]===quote)out+=sql[++i];else quote=null;}}else if(ch==="'"||ch==='"'){quote=ch;out+=ch;}else if(ch==='?')out+='$'+(++n);else if(/[a-zA-Z_]/.test(ch)){let token=ch;while(i+1<sql.length&&/[a-zA-Z0-9_]/.test(sql[i+1]))token+=sql[++i];out+=token==='end'?'"end"':token==='CURRENT_TIMESTAMP'?"to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')":token;}else out+=ch;}
 out=out.replace(/(WHERE\s+|\()\$(\d+)\s+OR\b/g,'$1($$$2::bigint <> 0) OR');
 if(ignore)out+=' ON CONFLICT DO NOTHING';
 return out;
}
export class PostgresDatabase {
 constructor(client){this.client=client;this.dialect='postgres';this.lastInsertRowid=0;}
 prepare(input){const db=this;return {
 async all(...values){if(input==='SELECT last_insert_rowid() id')return [{id:db.lastInsertRowid}];return (await db.client.query(translateQuery(input),values)).rows;},
 async get(...values){return (await this.all(...values))[0];},
 async run(...values){let sql=translateQuery(input);const table=input.match(/^INSERT(?: OR IGNORE)? INTO\s+(\w+)/i)?.[1];if(table&&/\bid\b/.test(postgresSchema.match(new RegExp('CREATE TABLE "'+table+'" \\(([\\s\\S]*?)\\n\\);'))?.[1]||''))sql+=' RETURNING id';const result=await db.client.query(sql,values);if(result.rows[0]?.id!==undefined)db.lastInsertRowid=result.rows[0].id;return {changes:result.rowCount,lastInsertRowid:result.rows[0]?.id||0};}
 };}
 async exec(sql){return this.client.query(sql);}
}
export async function initializePostgres(){
 if(!ready)ready=(async()=>{const client=await postgresPool().connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(740013)');await client.query('CREATE TABLE IF NOT EXISTS clinic_postgres_migrations(name TEXT PRIMARY KEY)');const exists=await client.query("SELECT name FROM clinic_postgres_migrations WHERE name='initial'");if(!exists.rowCount){await client.query(postgresSchema);const db=new PostgresDatabase(client);for(const [id,name,permissions]of defaultRoles)await db.prepare('INSERT INTO roles(id,name,permissions) VALUES(?,?,?)').run(id,name,JSON.stringify(permissions));for(const template of initialTemplates)await db.prepare('INSERT INTO clinical_templates(name,specialty,kind,defaults) VALUES(?,?,?,?)').run(template.name,template.specialty,template.kind,JSON.stringify(template.defaults));await client.query('INSERT INTO purchasing_policy(id) VALUES(1)');await client.query('INSERT INTO automation_policy(id) VALUES(1)');await client.query('INSERT INTO finance_policy(id,discount_limit,refund_limit) VALUES(1,0,0)');await client.query("INSERT INTO clinic_postgres_migrations VALUES('initial')");}await client.query(readinessSchema);await client.query(qualitySchema);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}})().catch(e=>{ready=null;throw e;});
 return ready;
}
export async function withPostgres(fn){await initializePostgres();const client=await postgresPool().connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(740014)');const result=await fn(new PostgresDatabase(client));await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
export async function closePostgres(){if(pool)await pool.end();pool=null;ready=null;}
