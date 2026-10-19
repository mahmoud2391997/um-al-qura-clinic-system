import { createHash } from 'node:crypto';
export const auditGenesis = '0'.repeat(64);
let sequence = 0;
export function auditDigest(row, previousHash) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        previousHash,
        Number(row.id),
        row.actor ?? null,
        row.action ?? null,
        row.entity ?? null,
        row.before_value ?? null,
        row.after_value ?? null,
        row.time ?? null,
      ]),
    )
    .digest('hex');
}
async function atomic(db, fn) {
  const name = 'audit_chain_' + ++sequence;
  await db.exec('SAVEPOINT ' + name);
  try {
    if (db.dialect === 'postgres')
      await db.exec('SELECT pg_advisory_xact_lock(740015)');
    const result = await fn();
    await db.exec('RELEASE SAVEPOINT ' + name);
    return result;
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT ' + name);
    await db.exec('RELEASE SAVEPOINT ' + name);
    throw error;
  }
}
// Existing audit history is baselined once at migration, not retrospectively certified.
export async function initializeAuditChain(db) {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS audit_chain (audit_id BIGINT PRIMARY KEY,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL)',
  );
  await db.exec(
    'CREATE TABLE IF NOT EXISTS audit_chain_state (id BIGINT PRIMARY KEY CHECK(id=1),head_id BIGINT,head_hash TEXT NOT NULL,entry_count BIGINT NOT NULL,legacy_count BIGINT NOT NULL)',
  );
  if (await db.prepare('SELECT id FROM audit_chain_state WHERE id=1').get())
    return;
  let previous = auditGenesis,
    last = null,
    count = 0;
  for (const row of await db.prepare('SELECT * FROM audit ORDER BY id').all()) {
    const hash = auditDigest(row, previous);
    await db
      .prepare(
        'INSERT INTO audit_chain(audit_id,previous_hash,entry_hash) VALUES(?,?,?)',
      )
      .run(row.id, previous, hash);
    previous = hash;
    last = row.id;
    count++;
  }
  await db
    .prepare(
      'INSERT INTO audit_chain_state(id,head_id,head_hash,entry_count,legacy_count) VALUES(1,?,?,?,?)',
    )
    .run(last, previous, count, count);
}
export async function appendAudit(
  db,
  actor,
  action,
  entity,
  before,
  after,
  time,
) {
  return atomic(db, async () => {
    await initializeAuditChain(db);
    const state = await db
      .prepare('SELECT * FROM audit_chain_state WHERE id=1')
      .get();
    const tail = await db
      .prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 1')
      .get();
    const tailLink = tail
      ? await db
          .prepare('SELECT * FROM audit_chain WHERE audit_id=?')
          .get(tail.id)
      : null;
    if (
      (tail?.id ?? null) !== state.head_id ||
      (tail &&
        (!tailLink ||
          tailLink.entry_hash !== state.head_hash ||
          auditDigest(tail, tailLink.previous_hash) !== tailLink.entry_hash))
    )
      throw Error('Audit chain integrity failure');
    const result = await db
      .prepare(
        'INSERT INTO audit(actor,action,entity,before_value,after_value,time) VALUES(?,?,?,?,?,?)',
      )
      .run(
        actor,
        action,
        String(entity),
        JSON.stringify(before ?? null),
        JSON.stringify(after ?? null),
        time ?? new Date().toISOString(),
      );
    const row = await db
      .prepare('SELECT * FROM audit WHERE id=?')
      .get(result.lastInsertRowid);
    const hash = auditDigest(row, state.head_hash);
    await db
      .prepare(
        'INSERT INTO audit_chain(audit_id,previous_hash,entry_hash) VALUES(?,?,?)',
      )
      .run(row.id, state.head_hash, hash);
    await db
      .prepare(
        'UPDATE audit_chain_state SET head_id=?,head_hash=?,entry_count=entry_count+1 WHERE id=1',
      )
      .run(row.id, hash);
    return { id: row.id, hash };
  });
}
export async function verifyAuditChain(db, { expectedHead } = {}) {
  return atomic(db, async () => {
    // Verification never baselines an uninitialized history as trusted.
    await db.exec(
      'CREATE TABLE IF NOT EXISTS audit_chain_state (id BIGINT PRIMARY KEY CHECK(id=1),head_id BIGINT,head_hash TEXT NOT NULL,entry_count BIGINT NOT NULL,legacy_count BIGINT NOT NULL)',
    );
    const state = await db
      .prepare('SELECT * FROM audit_chain_state WHERE id=1')
      .get();
    if (!state)
      return { ok: false, firstBrokenId: null, reason: 'not_initialized' };
    const rows = await db
      .prepare(
        'SELECT a.*,c.previous_hash,c.entry_hash FROM audit a LEFT JOIN audit_chain c ON c.audit_id=a.id ORDER BY a.id',
      )
      .all();
    let previous = auditGenesis;
    for (const row of rows) {
      if (row.previous_hash !== previous)
        return { ok: false, firstBrokenId: row.id, reason: 'previous_hash' };
      if (auditDigest(row, previous) !== row.entry_hash)
        return { ok: false, firstBrokenId: row.id, reason: 'content_hash' };
      previous = row.entry_hash;
    }
    const linkCount = (
      await db.prepare('SELECT COUNT(*) n FROM audit_chain').get()
    ).n;
    if (
      rows.length !== Number(state.entry_count) ||
      Number(linkCount) !== rows.length ||
      previous !== state.head_hash ||
      (rows.at(-1)?.id ?? null) !== state.head_id
    )
      return {
        ok: false,
        firstBrokenId: state.head_id,
        reason: 'head_or_count',
      };
    if (expectedHead && expectedHead !== previous)
      return {
        ok: false,
        firstBrokenId: state.head_id,
        reason: 'external_head',
      };
    return {
      ok: true,
      count: rows.length,
      headId: state.head_id,
      headHash: previous,
      legacyCount: Number(state.legacy_count),
    };
  });
}
