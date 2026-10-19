import test from 'node:test';import assert from 'node:assert/strict';
import {disposableDatabase,databaseDialects,databaseOptions} from './helpers/disposable-db.js';
import {inviteUser,acceptInvitation,listInvitations} from '../lib/invitations.js';
import {requestPasswordReset,completePasswordReset} from '../lib/password-recovery.js';
import {hashPassword} from '../lib/db.js';
const owner={id:'o',role:'owner',active:1,permissions:['users.create']};
for(const dialect of databaseDialects)test(dialect+': invitations require configured expiry, hash tokens, activate once and reject expiry/disabled-account reactivation',databaseOptions(dialect),()=>disposableDatabase(dialect,async db=>{
 let token;const deliver=async data=>{token=data.token;assert.equal(data.kind,'invite');};const body={name:'Synthetic invitee',email:'invitee@example.test',role:'reception'};
 await assert.rejects(()=>inviteUser(db,body,owner,deliver),/صلاحية/);
 await assert.rejects(()=>inviteUser(db,body,{...owner,role:'technical'},deliver,{ttlMinutes:5}),/مصرح/);
 await inviteUser(db,body,owner,deliver,{ttlMinutes:5,now:1000});assert.notEqual((await db.prepare('SELECT token_hash FROM account_invitations').get()).token_hash,token);
 assert.equal((await listInvitations(db,owner)).length,1);
 await assert.rejects(()=>acceptInvitation(db,token,'synthetic-password-123',{now:301001}),/انتهى/);
 await acceptInvitation(db,token,'synthetic-password-123',{now:1001});await assert.rejects(()=>acceptInvitation(db,token,'synthetic-password-123',{now:1002}));
 assert.equal((await db.prepare('SELECT active FROM users WHERE email=?').get(body.email)).active,1);
 await db.prepare('UPDATE users SET active=0 WHERE email=?').run(body.email);await assert.rejects(()=>inviteUser(db,body,owner,deliver,{ttlMinutes:5}),/متاح/);
}));
for(const dialect of databaseDialects)test(dialect+': reset unknown accounts return the same success and expired/single-use tokens stay protected',databaseOptions(dialect),()=>disposableDatabase(dialect,async db=>{
 await db.prepare("INSERT INTO users(id,name,email,password,role) VALUES('o','Synthetic','o@example.test','disabled','owner')").run();let token,sent=0;
 const deliver=async data=>{token=data.token;sent++;};assert.deepEqual(await requestPasswordReset(db,'unknown@example.test',deliver,1000),{ok:true});assert.equal(sent,0);
 assert.deepEqual(await requestPasswordReset(db,'o@example.test',deliver,1000),{ok:true});assert.equal(sent,1);
 await assert.rejects(()=>completePasswordReset(db,token,'synthetic-password-123',hashPassword,1801001));
 await completePasswordReset(db,token,'synthetic-password-123',hashPassword,1001);await assert.rejects(()=>completePasswordReset(db,token,'synthetic-password-123',hashPassword,1002));
}));
