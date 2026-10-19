import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {processOutbox} from '../lib/outbox-worker.js';
import {db} from '../lib/db.js';
import {transaction as atomic} from '../lib/operations.js';
import {postgresConfigured,withPostgres,closePostgres} from '../lib/postgres.js';
try{
 let deliver;
 if(process.env.CLINIC_OUTBOX_TRANSPORT){
  if(!isAbsolute(process.env.CLINIC_OUTBOX_TRANSPORT))throw Error('Transport module must be an absolute operator-controlled path');
  ({deliver}=await import(pathToFileURL(process.env.CLINIC_OUTBOX_TRANSPORT).href));if(typeof deliver!=='function')throw Error('Transport must export deliver');
 }
 const policy=Object.fromEntries([['maxAttempts','CLINIC_OUTBOX_MAX_ATTEMPTS'],['baseDelayMs','CLINIC_OUTBOX_BASE_DELAY_MS'],['maxDelayMs','CLINIC_OUTBOX_MAX_DELAY_MS'],['batchSize','CLINIC_OUTBOX_BATCH_SIZE']].map(([key,env])=>[key,process.env[env]?Number(process.env[env]):undefined]));
 const transaction=postgresConfigured()?withPostgres:fn=>atomic(db,()=>fn(db));
 const result=await processOutbox({transaction,deliver,policy});console.log('clinic_outbox_run',JSON.stringify(result));
}finally{await closePostgres();db.close();}
