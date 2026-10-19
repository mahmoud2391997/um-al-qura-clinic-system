import { createHash, timingSafeEqual } from 'node:crypto';
import { tickAutomation } from './automation.js';
export function automationRunAuthorized(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const hash = s => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(header.slice(7)), hash(secret));
}
export async function runScheduledAutomation(db, header, secret, storageReady, now = new Date()) {
  if (!automationRunAuthorized(header, secret)) throw Error('غير مصرح');
  if (!storageReady) throw Error('الجدولة تحتاج تخزينًا دائمًا؛ الديمو المؤقت غير مناسب');
  await db.exec('CREATE TABLE IF NOT EXISTS automation_health(id BIGINT PRIMARY KEY CHECK(id=1),last_success TEXT,last_attempt TEXT,last_code TEXT)');
  try{
    const result=await tickAutomation(db,now);
    await db.prepare("INSERT INTO automation_health(id,last_success,last_attempt,last_code) VALUES(1,?,?,NULL) ON CONFLICT(id) DO UPDATE SET last_success=excluded.last_success,last_attempt=excluded.last_attempt,last_code=NULL").run(now.toISOString(),now.toISOString());
    console.info('clinic_automation_success',now.toISOString());return result;
  }catch(error){
    await db.prepare("INSERT INTO automation_health(id,last_attempt,last_code) VALUES(1,?,'automation_failed') ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt,last_code=excluded.last_code").run(now.toISOString());
    throw error;
  }
}

export async function automationHealth(db,header,secret){
 if(!automationRunAuthorized(header,secret))throw Error('غير مصرح');
 await db.exec('CREATE TABLE IF NOT EXISTS automation_health(id BIGINT PRIMARY KEY CHECK(id=1),last_success TEXT,last_attempt TEXT,last_code TEXT)');
 return (await db.prepare('SELECT last_success,last_attempt,last_code FROM automation_health WHERE id=1').get())||{last_success:null,last_attempt:null,last_code:null};
}
