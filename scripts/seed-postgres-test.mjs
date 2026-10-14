import {withPostgres,closePostgres} from '../lib/postgres.js';
import {hashPassword} from '../lib/db.js';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const url=new URL(process.env.DATABASE_URL);if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Synthetic test accounts are localhost only');
const password=randomBytes(24).toString('hex');
const accounts={};await withPostgres(async db=>{if((await db.prepare('SELECT COUNT(*) n FROM patients').get()).n)throw Error('Only seed an empty local test database');for(const role of ['owner','physio','finance','assistant']){const email=role+'@postgres-test.invalid';await db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET password=excluded.password').run('demo-'+role,'Synthetic '+role,email,hashPassword(password),role);accounts[role]={email,password};}});
writeFileSync('.local/postgres-test-accounts.json',JSON.stringify(accounts),{mode:0o600});console.log('Synthetic local accounts ready; credentials saved to excluded local file.');await closePostgres();
