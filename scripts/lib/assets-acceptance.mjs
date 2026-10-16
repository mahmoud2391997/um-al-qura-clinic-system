import assert from 'node:assert/strict';
// Runs only inside the existing disposable loopback acceptance harness.
export async function verifyAssets({call,db,ownerCookie,deniedCookie}){
 const body={name:'Synthetic vendor acceptance',registration:'ACCEPTANCE-VENDOR',phone:'',email:'',address:'',status:'Active'};
 assert.equal((await call('purchasing/vendors',body,deniedCookie)).status,403);
 assert.equal((await call('purchasing/vendors',null,deniedCookie)).status,403);
 assert.equal((await call('reports/export',{path:'purchasing/vendors'},deniedCookie)).status,403);
 assert.equal((await call('purchasing/vendors',body,ownerCookie)).status,200);
 const vendors=await call('purchasing/vendors',null,ownerCookie);assert.equal(vendors.status,200);
 const vendor=vendors.value.find(v=>v.registration===body.registration);assert(vendor);
 const asset={name:'Synthetic asset acceptance',model:'TEST',serial:'TEST',location:'Test room',status:'Under Maintenance',capacity:10,replacement_cost:0,component:'',warranty:'',purchase_date:'2026-01-01',purchase_cost:123,vendor_id:vendor.id,maintenance_interval_days:30,last_maintenance:'',next_maintenance:''};
 assert.equal((await call('equipment',asset,deniedCookie)).status,403);
 assert.equal((await call('equipment',asset,ownerCookie)).status,200);
 const row=db.prepare('SELECT * FROM equipment WHERE name=?').get(asset.name);assert.equal(row.vendor_id,vendor.id);assert.equal(row.purchase_cost,123);
 assert.equal((await call('equipment',{...asset,id:row.id,purchase_date:'2026-02-30'},ownerCookie)).status,400);
 assert.equal(db.prepare('SELECT purchase_date FROM equipment WHERE id=?').get(row.id).purchase_date,'2026-01-01');
 assert.equal((await call('equipment',{id:row.id,action:'consume',quantity:1,reference:'SYNTHETIC'},ownerCookie)).status,400);
 const audit=db.prepare("SELECT after_value FROM audit WHERE action='equipment.save' AND entity=?").get(String(row.id));assert(audit);assert.equal(JSON.parse(audit.after_value).vendor_id,vendor.id);
 console.log('PASS: actual asset/vendor HTTP create/read/export permissions, validation rollback, persistence, blocked equipment use and save audit.');
}
