import {db} from '../lib/db.js';
import {attachmentStorage,scanAttachment} from '../lib/attachment-storage.js';
import {postgresConfigured,withPostgres,closePostgres} from '../lib/postgres.js';
async function scan(database){
 const counts={Clean:0,Infected:0,Unscanned:0};
 for(const table of ['documents','purchase_attachments'])for(const row of await database.prepare('SELECT id FROM '+table+' ORDER BY id').all()){
  const state=await scanAttachment(database,table,row.id,await attachmentStorage(database).read(table,row.id));counts[state]++;
 }return counts;
}
try{if(!process.env.CLINIC_CLAMAV_SOCKET)throw Error('Configure CLINIC_CLAMAV_SOCKET before scanning');console.log(JSON.stringify(postgresConfigured()?await withPostgres(scan):await scan(db)));}finally{await closePostgres();db.close();}
