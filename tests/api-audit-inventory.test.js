import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {routeInventory} from '../scripts/lib/audit-inventory.mjs';
import {auditExemptions,auditedReadPaths,auditedExportPaths,reviewedDispatchPrefixes,auditedDownloadPaths,reviewedRouteSourceSha256} from '../lib/api-audit-policy.js';
import {operationPages} from '../lib/operations-config.js';import {extraPaths} from '../lib/purchasing-extras.js';import {documentPaths} from '../lib/documents.js';
const source=readFileSync(new URL('../app/api/[...path]/route.js',import.meta.url),'utf8');
function classify(source){const inventory=routeInventory(source);const reads=new Set(auditedReadPaths),classified=new Set([...reads,...auditedExportPaths,...Object.keys(auditExemptions)]);
 const paths=[...inventory.paths,...Object.keys(operationPages),...extraPaths,...documentPaths.flatMap(path=>[path,path+'/targets'])];
 for(const path of paths)assert(classified.has(path),'Unclassified API path: '+path);
 assert.deepEqual(inventory.prefixes,[...reviewedDispatchPrefixes].sort());
 for(const [path,reason]of Object.entries(auditExemptions))assert(reason.length>30,'Reviewed exemption needs rationale: '+path);
 assert.deepEqual([...auditedDownloadPaths].sort(),[...documentPaths,'purchasing/attachments'].sort());
 assert.equal(createHash('sha256').update(source).digest('hex'),reviewedRouteSourceSha256,'API dispatch changed: review endpoint classification and run generated runtime audit matrix');
 return reads.size;
}
test('every concrete API path and module registry has explicit read/export audit classification or reviewed exemption',()=>assert(classify(source)>60));
test('adding a new endpoint or dynamic dispatch requires explicit audit review',()=>{
 assert.throws(()=>classify(source+"\nif(path==='new-sensitive-records'){}"),/Unclassified API path/);
 assert.throws(()=>classify(source+"\nif(['new-array-path'].includes(path)){}"),/Unclassified API path/);
 assert.throws(()=>classify(source+"\nif(path.match(new RegExp('new'))){ }"),/Unreviewed path dispatch/);
});
