// PostgreSQL resource/record locks. Call inside the caller's existing transaction.
const tables=new Set(['appointments','packages','inventory','invoices','clinical','equipment','waiting_list','package_returns']);
export async function lockRecord(db,table,id){
 if(db.dialect!=='postgres')return;
 if(!tables.has(table))throw Error('Unreviewed lock table');
 await db.prepare('SELECT id FROM '+table+' WHERE id=? FOR UPDATE').get(id);
}
export const resourceLockSchema='CREATE TABLE IF NOT EXISTS clinic_resource_locks(resource TEXT PRIMARY KEY)';
export async function lockResources(db,resources){
 if(db.dialect!=='postgres')return;
 await db.exec(resourceLockSchema);
 for(const resource of [...new Set(resources.filter(Boolean))].sort()){
  await db.prepare('INSERT INTO clinic_resource_locks(resource) VALUES(?) ON CONFLICT(resource) DO NOTHING').run(resource);
  await db.prepare('SELECT resource FROM clinic_resource_locks WHERE resource=? FOR UPDATE').get(resource);
 }
}
export async function lockAppointmentResources(db,{provider,room}){
 await lockResources(db,[provider?'appointment-provider:'+provider:null,room?'appointment-room:'+room:null]);
}
