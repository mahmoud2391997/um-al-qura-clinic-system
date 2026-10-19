import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disposableDatabase,
  databaseDialects,
  databaseOptions,
} from './helpers/disposable-db.js';
import {
  scanAttachment,
  setAttachmentScanner,
  readCleanAttachment,
  setAttachmentStorage,
  storeAttachment,
  clamAvScan,
} from '../lib/attachment-storage.js';
import { saveDocument } from '../lib/documents.js';
import { saveExtras } from '../lib/purchasing-extras.js';
const bytes = Buffer.from('%PDF-1.4\nsynthetic scanner fixture'),
  actor = {
    id: 'o',
    role: 'owner',
    active: 1,
    permissions: [
      'patients.view',
      'patients.create',
      'purchasing.view',
      'purchasing.edit',
      'purchasing.approve',
    ],
  };
for (const dialect of databaseDialects) {
  test(
    dialect +
      ': database and purchasing files are quarantined until clean; infected, unavailable and changed bytes cannot download',
    databaseOptions(dialect),
    () =>
      disposableDatabase(dialect, async (db) => {
        await db
          .prepare(
            "INSERT INTO users(id,name,email,password,role) VALUES('o','Synthetic owner','o@example.test','disabled','owner')",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO patients(id,name,phone) VALUES(1,'Synthetic','TEST')",
          )
          .run();
        await saveDocument(
          db,
          'patients/attachments',
          {
            target_id: 1,
            name: 'fixture.pdf',
            mime: 'application/pdf',
            data: bytes.toString('base64'),
          },
          actor,
        );
        await assert.rejects(
          () =>
            saveDocument(
              db,
              'patients/attachments',
              { id: 1, action: 'download' },
              actor,
            ),
          /محجوز/,
        );
        setAttachmentScanner(db, async () => 'Infected');
        assert.equal(
          await scanAttachment(db, 'documents', 1, bytes),
          'Infected',
        );
        await assert.rejects(
          () => readCleanAttachment(db, 'documents', 1),
          /محجوز/,
        );
        setAttachmentScanner(db, async () => {
          throw Error('Synthetic unavailable scanner');
        });
        assert.equal(
          await scanAttachment(db, 'documents', 1, bytes),
          'Unscanned',
        );
        setAttachmentScanner(db, async () => 'Clean');
        await scanAttachment(db, 'documents', 1, bytes);
        assert.equal(
          (
            await saveDocument(
              db,
              'patients/attachments',
              { id: 1, action: 'download' },
              actor,
            )
          ).file.data,
          bytes.toString('base64'),
        );
        await db
          .prepare('UPDATE documents SET data=? WHERE id=1')
          .run(Buffer.from('%PDF-changed').toString('base64'));
        await assert.rejects(
          () => readCleanAttachment(db, 'documents', 1),
          /سلامة/,
        );
        await db
          .prepare(
            "INSERT INTO purchase_requests(id,title,creator,items) VALUES(1,'Synthetic','o','[]')",
          )
          .run();
        setAttachmentScanner(db, async () => 'Unscanned');
        await saveExtras(
          db,
          'purchasing/attachments',
          {
            request_id: 1,
            name: 'fixture.pdf',
            mime: 'application/pdf',
            data: bytes.toString('base64'),
          },
          actor,
        );
        await assert.rejects(
          () =>
            saveExtras(
              db,
              'purchasing/attachments',
              { id: 1, action: 'download' },
              actor,
            ),
          /محجوز/,
        );
        setAttachmentScanner(db, async () => 'Clean');
        await scanAttachment(db, 'purchase_attachments', 1, bytes);
        assert.equal(
          (
            await saveExtras(
              db,
              'purchasing/attachments',
              { id: 1, action: 'download' },
              actor,
            )
          ).file.data,
          bytes.toString('base64'),
        );
      }),
  );
  test(
    dialect +
      ': storage adapters must serve the scanned bytes and existing type/size/count limits remain',
    databaseOptions(dialect),
    () =>
      disposableDatabase(dialect, async (db) => {
        const objects = new Map();
        setAttachmentStorage(db, {
          write: async (table, id, data) =>
            objects.set(table + id, Buffer.from(data)),
          read: async (table, id) => objects.get(table + id),
        });
        setAttachmentScanner(db, async () => 'Clean');
        await storeAttachment(db, 'documents', 42, bytes);
        assert.equal(
          await readCleanAttachment(db, 'documents', 42),
          bytes.toString('base64'),
        );
        objects.set('documents42', Buffer.from('changed'));
        await assert.rejects(() => readCleanAttachment(db, 'documents', 42));
        await db
          .prepare(
            "INSERT INTO users(id,name,email,password,role) VALUES('o','Synthetic owner','o@example.test','disabled','owner')",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO patients(id,name,phone) VALUES(1,'Synthetic','TEST')",
          )
          .run();
        const body = {
          target_id: 1,
          name: 'fixture.pdf',
          mime: 'application/pdf',
          data: bytes.toString('base64'),
        };
        await assert.rejects(() =>
          saveDocument(
            db,
            'patients/attachments',
            { ...body, mime: 'image/png' },
            actor,
          ),
        );
        await assert.rejects(() =>
          saveDocument(
            db,
            'patients/attachments',
            {
              ...body,
              data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
            },
            actor,
          ),
        );
        for (let i = 0; i < 10; i++)
          await saveDocument(db, 'patients/attachments', body, actor);
        await assert.rejects(
          () => saveDocument(db, 'patients/attachments', body, actor),
          /ممتلئ/,
        );
      }),
  );
}
test('scanner is disabled without an explicitly configured socket', async () => {
  assert.equal(await clamAvScan(bytes, ''), 'Unscanned');
});
