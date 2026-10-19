import test from 'node:test';
import assert from 'node:assert/strict';
import {disposableDatabase,databaseDialects,databaseOptions} from './helpers/disposable-db.js';
import {transaction} from '../lib/operations.js';
import {queueIntegration} from '../lib/integrations.js';
import {processOutbox} from '../lib/outbox-worker.js';
import {runScheduledAutomation,automationHealth} from '../lib/automation-runner.js';
for(const dialect of databaseDialects){
 test(dialect+': outbox retries definite failures with backoff, delivers once, and dead-letters exhausted jobs',databaseOptions(dialect),()=>disposableDatabase(dialect,async db=>{
  const tx=fn=>transaction(db,()=>fn(db));let calls=0;
  await queueIntegration(db,{kind:'appointment_reminder',reference:'synthetic',payload:{appointment_id:1},idempotencyKey:'synthetic-retry'});
  const policy={maxAttempts:2,baseDelayMs:1000,maxDelayMs:4000,batchSize:10};
  const deliver=async job=>{assert.equal(job.idempotencyKey,'synthetic-retry');calls++;if(calls===1)throw Object.assign(Error('synthetic failure'),{definitelyNotSent:true});};
  await processOutbox({transaction:tx,deliver,policy,now:1000});assert.equal(calls,1);
  await processOutbox({transaction:tx,deliver,policy,now:1500});assert.equal(calls,1);
  assert.equal((await processOutbox({transaction:tx,deliver,policy,now:2000})).delivered,1);
  await processOutbox({transaction:tx,deliver,policy,now:3000});assert.equal(calls,2);
  await queueIntegration(db,{kind:'review_request',reference:'synthetic',payload:{},idempotencyKey:'synthetic-dead'});
  const fail=async()=>{throw Object.assign(Error('not stored'),{definitelyNotSent:true});};
  await processOutbox({transaction:tx,deliver:fail,policy,now:4000});assert.equal((await processOutbox({transaction:tx,deliver:fail,policy,now:5000})).deadLetter,1);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM integration_delivery WHERE state='DeadLetter'").get()).n,1);
 }));
 test(dialect+': missing provider stays queued, ambiguous delivery is not retried, scheduler health records success',databaseOptions(dialect),()=>disposableDatabase(dialect,async db=>{
  await queueIntegration(db,{kind:'review_request',reference:'synthetic',payload:{},idempotencyKey:'synthetic-uncertain'});
  const tx=fn=>transaction(db,()=>fn(db));assert.deepEqual(await processOutbox({transaction:tx}),{configured:false,processed:0});
  let calls=0;const deliver=async()=>{calls++;throw Error('provider response might contain private data');};
  const policy={maxAttempts:3,baseDelayMs:100,maxDelayMs:1000,batchSize:5};
  assert.equal((await processOutbox({transaction:tx,deliver,policy,now:1000})).uncertain,1);await processOutbox({transaction:tx,deliver,policy,now:100000});assert.equal(calls,1);
  assert.equal((await db.prepare('SELECT last_code FROM integration_delivery').get()).last_code,'delivery_outcome_unknown');
  await assert.rejects(()=>processOutbox({transaction:tx,deliver,policy:{}}),/explicitly/);
  await db.prepare('INSERT INTO automation_policy(id) VALUES(1) ON CONFLICT(id) DO NOTHING').run();
  const secret='synthetic-scheduler-secret-'.repeat(2),now=new Date('2026-10-19T00:00:00Z');
  await runScheduledAutomation(db,'Bearer '+secret,secret,true,now);await runScheduledAutomation(db,'Bearer '+secret,secret,true,now);
  assert.equal((await automationHealth(db,'Bearer '+secret,secret)).last_success,now.toISOString());
  await assert.rejects(()=>automationHealth(db,'Bearer wrong',secret));
 }));
}
