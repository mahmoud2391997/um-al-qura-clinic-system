export const qualitySchema=`CREATE TABLE IF NOT EXISTS quality_incidents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,occurred TEXT NOT NULL,owner TEXT NOT NULL REFERENCES users(id),due TEXT NOT NULL,status TEXT NOT NULL,corrective TEXT NOT NULL,preventive TEXT NOT NULL,closure_evidence TEXT NOT NULL,creator TEXT NOT NULL REFERENCES users(id),closed_by TEXT,closed_at TEXT,version BIGINT NOT NULL DEFAULT 1);`;
// One-time additive grant for the existing owner role; never grant restricted incidents to broad quality roles.
// A persisted marker ensures later owner changes are not overwritten at startup.
const grantKey='incident-owner-permissions-v1';
const incidentPermissions=['incidents.view','incidents.create','incidents.edit','incidents.approve','incidents.archive','incidents.export'];
function upgraded(value){const before=JSON.parse(value);if(!Array.isArray(before))throw Error('Invalid owner permissions');return JSON.stringify([...new Set([...before,...incidentPermissions])]);}
export function migrateQualitySqlite(db){
 db.exec(qualitySchema+'CREATE TABLE IF NOT EXISTS clinic_quality_migrations(name TEXT PRIMARY KEY);');
 if(db.prepare('SELECT name FROM clinic_quality_migrations WHERE name=?').get(grantKey))return;
 db.exec('SAVEPOINT quality_owner_upgrade');try{
 const owner=db.prepare("SELECT permissions FROM roles WHERE id='owner'").get();if(owner)db.prepare("UPDATE roles SET permissions=? WHERE id='owner'").run(upgraded(owner.permissions));
 db.prepare('INSERT INTO clinic_quality_migrations(name) VALUES(?)').run(grantKey);db.exec('RELEASE SAVEPOINT quality_owner_upgrade');
 }catch(error){db.exec('ROLLBACK TO SAVEPOINT quality_owner_upgrade');db.exec('RELEASE SAVEPOINT quality_owner_upgrade');throw error;}
}
export async function migrateQualityPostgres(client){
 await client.query(qualitySchema+'CREATE TABLE IF NOT EXISTS clinic_quality_migrations(name TEXT PRIMARY KEY);');
 if((await client.query('SELECT name FROM clinic_quality_migrations WHERE name=$1',[grantKey])).rowCount)return;
 const owner=(await client.query("SELECT permissions FROM roles WHERE id='owner' FOR UPDATE")).rows[0];if(owner)await client.query("UPDATE roles SET permissions=$1 WHERE id='owner'",[upgraded(owner.permissions)]);
 await client.query('INSERT INTO clinic_quality_migrations(name) VALUES($1)',[grantKey]);
}
