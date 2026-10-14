import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { roleScopes, saveRoleScopes, scopeRows, patientVisible } from '../lib/data-scopes.js';
import { exportRows } from '../lib/exports.js';
test('role scopes filter patients appointments and exports and owner scope remains protected', async () => {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('p','Demo','p@invalid','disabled','physio');INSERT INTO patients(id,name,phone) VALUES(1,'Assigned','DEMO1'),(2,'Other','DEMO2');INSERT INTO appointments(id,patient_id,provider) VALUES(1,1,'p'),(2,2,'other')");
  const actor = {
    id: 'p',
    role: 'physio',
    active: 1,
    permissions: ['patients.view', 'patients.export']
  };
  assert.equal((await roleScopes(db, 'physio')).patients, 'assigned');
  assert.equal(await patientVisible(db, 1, actor), true);
  assert.equal(await patientVisible(db, 2, actor), false);
  assert.equal((await exportRows(db, 'patients', actor)).length, 1);
  assert.equal((await scopeRows(db, 'appointments', await db.prepare('SELECT * FROM appointments').all(), actor)).length, 1);
  await saveRoleScopes(db, 'physio', {
    patients: 'all',
    appointments: 'all',
    clinical: 'all'
  });
  assert.equal((await exportRows(db, 'patients', actor)).length, 2);
  await assert.rejects(async () => await saveRoleScopes(db, 'owner', {
    patients: 'assigned',
    appointments: 'all',
    clinical: 'all'
  }));
  db.close();
});
