import assert from 'node:assert/strict';
export async function verifyIncidents({call,db,ownerCookie,deniedCookie}){
 const summary=await call('dashboard',null,ownerCookie);assert.equal(summary.status,200);assert(summary.value.sections.finance);assert(summary.value.sections.equipment);
 const scoped=await call('dashboard',null,deniedCookie);assert.equal(scoped.status,200);assert(!('finance' in scoped.value.sections));assert(!('inventory' in scoped.value.sections));assert(!('equipment' in scoped.value.sections));assert.deepEqual(Object.keys(scoped.value.sections),['patients','appointments','tasks']);
 assert.equal((await call('dashboard',{},ownerCookie)).status,405);
 const list=await call('quality/incidents/staff',null,ownerCookie);assert.equal(list.status,200);assert(list.value.length);assert(list.value.every(r=>Object.keys(r).every(k=>['id','name'].includes(k))));
 assert.equal((await call('quality/incidents/staff',null,deniedCookie)).status,403);
 const body={kind:'Near Miss',title:'SYNTHETIC integration incident',description:'SYNTHETIC restricted narrative',category:'Acceptance only',occurred:'2026-10-15',due:'2026-10-16',owner:list.value[0].id};
 assert.equal((await call('quality/incidents',body,deniedCookie)).status,403);
 const created=await call('quality/incidents',body,ownerCookie);assert.equal(created.status,200);const row=db.prepare('SELECT * FROM quality_incidents WHERE id=?').get(created.value.id);assert.equal(row.status,'Open');
 assert.equal((await call('quality/incidents',{...row,status:'Closed'},ownerCookie)).status,400);
 const oldRole=db.prepare("SELECT permissions FROM roles WHERE id='physio'").get().permissions;
 try{db.prepare("UPDATE roles SET permissions=? WHERE id='physio'").run(JSON.stringify([...JSON.parse(oldRole),'incidents.view','incidents.edit']));assert.equal((await call('quality/incidents',{...row,status:'Closed',corrective:'SYNTHETIC',preventive:'SYNTHETIC',closure_evidence:'SYNTHETIC'},deniedCookie)).status,403);assert.equal(db.prepare('SELECT status FROM quality_incidents WHERE id=?').get(row.id).status,'Open');}finally{db.prepare("UPDATE roles SET permissions=? WHERE id='physio'").run(oldRole);}

 assert.equal((await call('quality/incidents',{...row,status:'Closed',corrective:'SYNTHETIC corrective',preventive:'SYNTHETIC preventive',closure_evidence:'SYNTHETIC evidence'},ownerCookie)).status,200);
 assert.equal((await call('quality/incidents',{...row,title:'stale edit'},ownerCookie)).status,400);
 for(const format of ['pdf','xlsx'])assert.equal((await call('reports/export',{path:'quality/incidents',format},deniedCookie)).status,403);
 const audit=db.prepare("SELECT after_value FROM audit WHERE action LIKE 'quality.incident.%'").all();assert(!JSON.stringify(audit).includes('restricted narrative'));
 console.log('PASS: restricted incident assignee lookup, denied creation/export, CAPA closure and immutable record verified over HTTP.');
}
