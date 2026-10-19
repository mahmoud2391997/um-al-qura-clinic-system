// Read-only verification; application infrastructure may initialize an empty database.
import { verifyAuditChain } from '../lib/audit-chain.js';
import { db } from '../lib/db.js';
import {
  postgresConfigured,
  withPostgres,
  closePostgres,
} from '../lib/postgres.js';
try {
  const options = { expectedHead: process.env.CLINIC_AUDIT_EXPECTED_HEAD };
  const result = postgresConfigured()
    ? await withPostgres((database) => verifyAuditChain(database, options))
    : await verifyAuditChain(db, options);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} finally {
  await closePostgres();
  db.close();
}
