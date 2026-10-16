import assert from 'node:assert/strict';
import {auditedReadPaths,auditedDownloadPaths} from '../../lib/api-audit-policy.js';
export async function verifyAuditMatrix({call,db,cookie}){
 let reads=0,exports=0;
 const last=()=>db.prepare('SELECT COALESCE(MAX(id),0) id FROM audit').get().id;
 for(const template of auditedReadPaths){
  const path=template.replace(':id','1'),before=last(),result=await call(path,null,cookie);
  assert.equal(result.status,200,'Sensitive GET '+path+' must execute successfully for the synthetic owner');
  const events=db.prepare("SELECT * FROM audit WHERE id>? AND action='data.read.success' AND entity=?").all(before,path);
  assert.equal(events.length,1,'GET '+path+' must emit one read audit');
  const metadata=JSON.parse(events[0].after_value);assert.equal(metadata.role,'owner');assert(metadata.scopes);assert.equal(metadata.count,Array.isArray(result.value)?result.value.length:1);reads++;
  const exportBefore=last(),exportResult=await call('reports/export',{path},cookie);
  assert([200,403].includes(exportResult.status),'Export '+path+' has explicit success or refusal');
  const action=exportResult.status===200?'data.export':'data.export.denied',entity=exportResult.status===200?path:'reports/export';
  const exportEvents=db.prepare('SELECT * FROM audit WHERE id>? AND action=? AND entity=?').all(exportBefore,action,entity);assert.equal(exportEvents.length,1,'Export '+path+' must be audited');exports++;
 }
 const actor=db.prepare("SELECT id FROM users WHERE role='owner'").get().id,payload=Buffer.from('%PDF-1.4\nsynthetic audit fixture').toString('base64');
 db.prepare("INSERT INTO licenses(id,title) VALUES(1,'Synthetic license')").run();
 db.prepare("INSERT INTO equipment(id,name) VALUES(1,'Synthetic device')").run();
 db.prepare("INSERT INTO maintenance(id,equipment_id,description) VALUES(1,1,'Synthetic maintenance')").run();
 db.prepare("INSERT INTO purchase_requests(id,title,creator,items) VALUES(1,'Synthetic purchasing',?,'[]')").run(actor);
 let downloads=0;
 for(const path of auditedDownloadPaths){
  const purchasing=path==='purchasing/attachments';let id;
  if(purchasing)id=db.prepare("INSERT INTO purchase_attachments(request_id,name,mime,size,data,actor) VALUES(1,'fixture.pdf','application/pdf',30,?,?)").run(payload,actor).lastInsertRowid;
  else id=db.prepare("INSERT INTO documents(path,target_id,name,mime,size,data,actor) VALUES(?,1,'fixture.pdf','application/pdf',30,?,?)").run(path,payload,actor).lastInsertRowid;
  const before=last(),result=await call(path,{action:'download',id},cookie);assert.equal(result.status,200,'Download '+path);assert.equal(result.value.file.data,payload);
  const events=db.prepare("SELECT after_value FROM audit WHERE id>? AND action='data.download.success' AND entity=?").all(before,path);assert.equal(events.length,1,'Download '+path+' audited');const metadata=JSON.parse(events[0].after_value);assert.equal(metadata.role,'owner');assert(metadata.scopes);assert(!events[0].after_value.includes(payload));downloads++;
 }
 console.log('PASS: generated download audit matrix '+downloads+' protected file paths; byte-identical downloads and metadata-only read audit.');
 console.log('PASS: generated audit matrix '+reads+' sensitive GET paths and '+exports+' export attempts; every successful read/export or denied export recorded.');
}
