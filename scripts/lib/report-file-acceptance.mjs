import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
export async function verifyReportFiles({base,db,owner,clinician}) {
 for(const format of ['pdf','xlsx']) {
  const request=async(path,cookie)=>fetch(base+'/api/reports/export',{method:'POST',headers:{origin:base,'content-type':'application/json',cookie},body:JSON.stringify({path,format})});
  const before=db.prepare('SELECT COALESCE(MAX(id),0) id FROM audit').get().id;
  const result=await request('patients',clinician);
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.match(result.headers.get('content-disposition'),new RegExp('clinic-report\\.'+format));
  const data=Buffer.from(await result.arrayBuffer());
  if(format==='pdf'){assert.equal(result.headers.get('content-type'),'application/pdf');assert.equal(data.subarray(0,5).toString(),'%PDF-');assert.match(data.toString('latin1'),/\/FontFile2/);}
  else {assert.equal(result.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');const sheet=strFromU8(unzipSync(data)['xl/worksheets/sheet1.xml']);assert.match(sheet,/VISIBLE_SYNTHETIC/);assert.doesNotMatch(sheet,/PRIVATE_SYNTHETIC/);}
  const event=db.prepare("SELECT after_value FROM audit WHERE id>? AND action='data.export'").get(before);
  const metadata=JSON.parse(event.after_value);assert.equal(metadata.format,format);assert.equal(metadata.count,1);assert.equal(metadata.scopes.patients,'assigned');
  const denied=await request('users',clinician);assert.equal(denied.status,403);
  assert(db.prepare("SELECT id FROM audit WHERE id>? AND action='data.export.denied'").get(before));
  const all=await request('patients',owner);assert.equal(all.status,200);await all.arrayBuffer();
 }
 console.log('PASS: binary PDF/XLSX HTTP downloads, MIME/no-store, embedded Arabic font, scoped XLSX content, permission denials and format/count audits.');
}
