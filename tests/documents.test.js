import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db.js';
import { saveDocument, listDocuments } from '../lib/documents.js';
test('clinical attachments enforce owning clinician scope on listing upload and download', async () => {
  const db = createDatabase(':memory:');
  await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('p','Demo','p@invalid','disabled','physio'),('q','Demo','q@invalid','disabled','physio');INSERT INTO patients(id,name,phone) VALUES(1,'Demo','DEMO');INSERT INTO clinical(patient_id,provider,kind,episode,content) VALUES(1,'p','Assessment','Demo','Demo')");
  const p = {
      id: 'p',
      role: 'physio',
      active: 1,
      permissions: ['clinical.view', 'clinical.create']
    },
    q = {
      ...p,
      id: 'q'
    },
    body = {
      target_id: 1,
      name: 'demo.pdf',
      mime: 'application/pdf',
      data: Buffer.from('%PDF-1.4\n%%EOF').toString('base64')
    };
  await saveDocument(db, 'clinical/attachments', body, p);
  assert.equal((await listDocuments(db, 'clinical/attachments', q)).length, 0);
  await assert.rejects(async () => await saveDocument(db, 'clinical/attachments', {
    id: 1,
    action: 'download'
  }, q));
  await assert.rejects(async () => await saveDocument(db, 'clinical/attachments', body, q));
  assert.equal((await listDocuments(db, 'clinical/attachments', p))[0].data, undefined);
  assert.ok((await saveDocument(db, 'clinical/attachments', {
    id: 1,
    action: 'download'
  }, p)).file.data);
  await assert.rejects(async () => await saveDocument(db, 'clinical/attachments', {
    ...body,
    mime: 'image/png'
  }, p));
  db.close();
});
