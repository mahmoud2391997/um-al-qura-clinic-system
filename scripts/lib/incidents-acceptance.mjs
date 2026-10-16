import assert from 'node:assert/strict';
export async function verifyIncidents({call,db,ownerCookie,deniedCookie}){
 const list=await call('quality/incidents/staff',null,ownerCookie);assert.equal(list.status,200);assert(list.value.length);assert(list.value.every(r=>Object.keys(r).every(k=>['id','name'].includes(k))));
 assert.equal((await call('quality/incidents/staff',null,deniedCookie)).status,403);
 const body={kind:'Near Miss',title:'SYNTHETIC integration incident',description:'SYNTHETIC restricted narrative',category:'Acceptance only',occurred:'2026-10-15',due:'2026-10-16',owner:list.value[0].id};
 assert.equal((await call('quality/incidents',body,deniedCookie)).status,403);
 const created=await call('quality/incidents',body,ownerCookie);assert.equal(created.status,200);const row=db.prepare('SELECT * FROM quality_incidents WHERE id=?').get(created.value.id);assert.equal(row.status,'Open');
 assert.equal((await call('quality/incidents',{...row,status:'Closed'},ownerCookie)).status,400);
 assert.equal((await call('quality/incidents',{...row,status:'Closed',corrective:'SYNTHETIC corrective',preventive:'SYNTHETIC preventive',closure_evidence:'SYNTHETIC evidence'},ownerCookie)).status,200);
 assert.equal((await call('quality/incidents',{...row,title:'stale edit'},ownerCookie)).status,400);
 for(const format of ['pdf','xlsx'])assert.equal((await call('reports/export',{path:'quality/incidents',format},deniedCookie)).status,403);
 const audit=db.prepare("SELECT after_value FROM audit WHERE action LIKE 'quality.incident.%'").all();assert(!JSON.stringify(audit).includes('restricted narrative'));
 console.log('PASS: restricted incident assignee lookup, denied creation/export, CAPA closure and immutable record verified over HTTP.');
}
