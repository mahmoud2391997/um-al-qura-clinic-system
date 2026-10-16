import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.env.PROJECTS_DIR;
if(!root||!root.startsWith('/'))throw Error('PROJECTS_DIR must be the absolute path containing the checkouts');
// M deliberately excluded: owner requires medical-site infrastructure to remain local.
const projects=['factory','clinic','employees','feed-site'];
function manifest(dir,prefix=''){
 const result={};
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(entry.name==='node_modules'||entry.name==='backups'||entry.name.startsWith('.')&&entry.name!=='.env.example')continue;
  const relative=prefix+entry.name,full=join(dir,entry.name);
  if(entry.isDirectory())Object.assign(result,manifest(full,relative+'/'));
  else if(entry.isFile())result[relative]=createHash('sha256').update(readFileSync(full)).digest('hex');
  else throw Error('Unexpected non-file infrastructure entry: '+relative);
 }
 return result;
}
const snapshots=projects.map(name=>{const dir=resolve(root,name,'infra');if(!existsSync(dir))throw Error('Missing infra copy: '+name);return {name,files:manifest(dir)}});
const baseline=snapshots[0];let failed=false;
for(const snapshot of snapshots.slice(1))for(const file of new Set([...Object.keys(baseline.files),...Object.keys(snapshot.files)]))if(baseline.files[file]!==snapshot.files[file]){console.error('Infrastructure mismatch: '+baseline.name+' / '+snapshot.name+' : '+file);failed=true}
if(failed)process.exitCode=1;else console.log('PASS: identical infrastructure in '+projects.join(', '));
