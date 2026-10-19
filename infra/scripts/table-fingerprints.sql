-- Counts plus order-independent row-content fingerprints. Archive authentication
-- provides the cryptographic tamper barrier; MD5 here detects restoration drift.
SELECT format(
 'SELECT %L, count(*), md5(COALESCE(string_agg(md5(row_to_json(t)::text), %L ORDER BY md5(row_to_json(t)::text)), %L)) FROM %I.%I t;',
 tablename, '', '', schemaname, tablename
)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
