import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { validateClinical } from '../lib/clinical.js';
import { templateDefaults, followupProgram } from '../lib/clinical-programs.js';
import { approveClinicalSession } from '../lib/session-resources.js';
const program = {
  instructions: 'Demo',
  duration: 'Demo',
  review: '2026-10-12',
  exercises: [{
    name: 'Demo',
    dose: 'Demo',
    frequency: 'Demo',
    instructions: 'Demo',
    url: 'https://example.com'
  }]
};
test('home programs require structured dose frequency instructions and safe educational links', () => {
  assert.deepEqual(validateClinical({
    kind: 'Home Program',
    structured: program
  }), program);
  assert.throws(() => validateClinical({
    kind: 'Home Program',
    structured: {
      ...program,
      exercises: []
    }
  }));
  assert.throws(() => validateClinical({
    kind: 'Home Program',
    structured: {
      ...program,
      exercises: [{
        ...program.exercises[0],
        url: 'javascript:alert(1)'
      }]
    }
  }));
  assert.throws(() => templateDefaults('{"__proto__":{}}'));
});
test('only the owning clinician can track an approved program and same-day correction does not duplicate', async () => {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('p','Demo','p@invalid','disabled','physio');INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO clinical(id,patient_id,provider,kind,episode,content) VALUES(1,1,'p','Home Program','Demo','Demo')");
  const actor = {
      id: 'p',
      active: 1,
      role: 'physio',
      permissions: ['clinical.edit']
    },
    body = {
      program_id: 1,
      date: '2026-10-12',
      completed: 0,
      planned: 4,
      note: 'Demo'
    };
  await assert.rejects(async () => await followupProgram(db, body, actor));
  await assert.rejects(async () => await approveClinicalSession(db, 1, 'p'));
  await db.prepare('INSERT INTO clinical_details(clinical_id,structured) VALUES(?,?)').run(1, JSON.stringify(program));
  await approveClinicalSession(db, 1, 'p');
  await assert.rejects(async () => await followupProgram(db, body, {
    ...actor,
    id: 'other'
  }));
  await followupProgram(db, body, actor);
  await followupProgram(db, {
    ...body,
    completed: 2
  }, actor);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM program_followups').get()).n, 1);
  assert.equal((await db.prepare('SELECT completed FROM program_followups').get()).completed, 2);
  await assert.rejects(async () => await followupProgram(db, {
    ...body,
    completed: 5
  }, actor));
  db.close();
});
