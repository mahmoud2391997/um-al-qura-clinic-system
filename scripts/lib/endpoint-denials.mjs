import assert from 'node:assert/strict';
import {endpointPolicy} from '../../lib/api-audit-policy.js';
export async function verifyEndpointDenials({call,db}) {
 await db.prepare('INSERT INTO roles(id,name,permissions) VALUES(?,?,?)').run('no-grants','Synthetic no grants','[]');
 await db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run('denial-user','DENIAL_SYNTHETIC','denial@example.test','disabled','no-grants');
 await db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run('synthetic-denial-session','denial-user',Date.now()+60000);
 const cookie='clinic_session=synthetic-denial-session';let checks=0;
 for(const entry of endpointPolicy.filter(e=>e.authentication==='session')) {
  const path=entry.path.replace(':id','1'),body=entry.method==='POST'?{}:null;
  const anonymous=await call(path,body);assert.equal(anonymous.status,401,'Anonymous '+entry.method+' '+path);
  assert.deepEqual(Object.keys(anonymous.value),['error']);
  if(entry.permission||entry.anyPermissions||entry.exportPermission){
   const denied=await call(path,body,cookie);assert.equal(denied.status,403,'No-grant '+entry.method+' '+path);
   assert.deepEqual(denied.value,{error:'غير مصرح'},'Uniform no-data denial '+path);checks++;
  }
 }
 for(const path of ['patients/unregistered','clinical/unregistered','finance/unregistered','users/unregistered']){
  assert.equal((await call(path,null,cookie)).status,404,'Unknown aliases must not dispatch');
 }
 console.log('PASS: method/path denial inventory '+checks+' no-grant routes; anonymous session routes denied, uniform bodies and unknown aliases refused.');
}
