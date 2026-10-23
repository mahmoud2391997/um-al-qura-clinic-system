import { httpsAttachmentScan } from './attachment-scanner.js';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
const tables = new Set(['documents', 'purchase_attachments']);
const scanners = new WeakMap(),
  stores = new WeakMap();
const tableName = (table) => {
  if (!tables.has(table)) throw Error('Unsupported attachment store');
  return table;
};
export const scanSchema =
  'CREATE TABLE IF NOT EXISTS attachment_scans(store_table TEXT NOT NULL,attachment_id BIGINT NOT NULL,state TEXT NOT NULL,digest TEXT NOT NULL,scanned_at TEXT,PRIMARY KEY(store_table,attachment_id))';
export class DatabaseAttachmentStorage {
  constructor(db) {
    this.db = db;
  }
  async read(table, id) {
    const row = await this.db
      .prepare('SELECT data FROM ' + tableName(table) + ' WHERE id=?')
      .get(id);
    if (!row) throw Error('المرفق غير موجود');
    return Buffer.from(row.data || '', 'base64');
  }
  async write(table, id, bytes) {
    await this.db
      .prepare('UPDATE ' + tableName(table) + ' SET data=? WHERE id=?')
      .run(bytes.toString('base64'), id);
  }
}
export function setAttachmentStorage(db, store) {
  if (typeof store?.read !== 'function' || typeof store?.write !== 'function')
    throw Error('Storage must implement read and write');
  stores.set(db, store);
}
export function attachmentStorage(db) {
  return stores.get(db) || new DatabaseAttachmentStorage(db);
}
// In-process injection is for an application-configured adapter or synthetic tests,
// never selected by request data. Production socket scanning is disabled by default.
export function setAttachmentScanner(db, scanner) {
  if (typeof scanner !== 'function') throw Error('Scanner must be a function');
  scanners.set(db, scanner);
}
export async function clamAvScan(
  bytes,
  socketPath = process.env.CLINIC_CLAMAV_SOCKET,
) {
  if (!socketPath) return 'Unscanned';
  if (!socketPath.startsWith('/'))
    throw Error('Scanner requires a local absolute socket path');
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let answer = '';
    socket.setTimeout(5000, () => socket.destroy(Error('Scanner timeout')));
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      answer += chunk.toString('utf8');
      if (answer.length > 4096)
        socket.destroy(Error('Invalid scanner response'));
    });
    socket.once('end', () => {
      const result = answer.replace(/\0$/, '').trim();
      if (result === 'stream: OK') resolve('Clean');
      else if (/^stream: .+ FOUND$/.test(result)) resolve('Infected');
      else reject(Error('Scanner did not certify content'));
    });
    socket.once('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < bytes.length; i += 65536) {
        const chunk = bytes.subarray(i, i + 65536),
          length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
export async function scanAttachment(db, table, id, bytes) {
  tableName(table);
  await db.exec(scanSchema);
  let state = 'Unscanned';
  try {
    state = await (
      scanners.get(db) ||
      (process.env.CLINIC_SCAN_ENDPOINT ? httpsAttachmentScan : clamAvScan)
    )(bytes);
    if (!['Clean', 'Infected'].includes(state)) state = 'Unscanned';
  } catch {
    state = 'Unscanned';
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  await db
    .prepare(
      'INSERT INTO attachment_scans(store_table,attachment_id,state,digest,scanned_at) VALUES(?,?,?,?,?) ON CONFLICT(store_table,attachment_id) DO UPDATE SET state=excluded.state,digest=excluded.digest,scanned_at=excluded.scanned_at',
    )
    .run(
      table,
      id,
      state,
      digest,
      state === 'Unscanned' ? null : new Date().toISOString(),
    );
  return state;
}
export async function storeAttachment(db, table, id, bytes) {
  await attachmentStorage(db).write(table, id, bytes);
  return scanAttachment(db, table, id, bytes);
}
export async function readCleanAttachment(db, table, id) {
  tableName(table);
  await db.exec(scanSchema);
  const scan = await db
    .prepare(
      'SELECT state,digest FROM attachment_scans WHERE store_table=? AND attachment_id=?',
    )
    .get(table, id);
  if (scan?.state !== 'Clean')
    throw Error('المرفق محجوز حتى اكتمال فحص الأمان');
  const bytes = await attachmentStorage(db).read(table, id);
  if (createHash('sha256').update(bytes).digest('hex') !== scan.digest)
    throw Error('تعذر التحقق من سلامة المرفق');
  return bytes.toString('base64');
}
