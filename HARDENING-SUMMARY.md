# Clinic hardening handover — 2026-10-19

Branch: `hardening/finish-open-items`. Baseline: `475a9ae`. Changes are local commits only. Main was not changed, nothing was pushed/deployed, no production credentials were used and no real email/payment/reminder service was contacted. All executed fixtures were synthetic. The pre-existing uncommitted edit to `docs/PRODUCTION-READINESS.md` is preserved and excluded from these commits.

“Done” below means implemented and locally verified for the stated scope, not approved medical/financial operation or production certification. One initial commit was made per task, plus a focused follow-up after parallel HTTP and accessibility review exposed additional gaps.

| Task | Status | Added verification / result | Remaining risk or boundary |
|---|---|---|---|
| 1. Endpoint audit/denials | Done | Explicit method/path registry, source-inventory gate, 148 restricted method/path denial checks, exact-action missing-grant cases, 84 read and export attempts, five download paths, authentication/write metadata audits | Custom role/scope combinations and independent security review remain; generated coverage is not a blanket security certification |
| 2. Router split | Done | Extracted module handlers behind the same URLs; shared operation adapter; full unit/API/UI regression | Shared domain/operation helpers remain intentionally reused |
| 3. Audit chain | Done | SHA-256 links, head/count state, owner verification endpoint/script; dual-database tamper/deletion/rollback/legacy-baseline tests | Database administrators can replace history; independent anchoring and production-scale migration remain unverified |
| 4. Capacity/utilization | Done | Owner-entered dated work/time-off, union/clipping, scope, missing/zero-capacity and reconciliation tests on both databases | Actual schedules and clinic approval of definitions are not selected; recurrence-roster editing is not implemented |
| 5. PostgreSQL concurrency | Done | Record/resource locks; shared/exclusive rollout barrier; global-lock rollback flag; independent-connection and real parallel HTTP booking/package/stock/payment/cash-close tests | Unconverted handlers intentionally retain exclusive serialization; multi-host/load/failover behavior unverified |
| 6. Scheduled automation/outbox | Done | Timer command runs scheduler/outbox independently of user traffic; explicit reminder window and retry policy, backoff/dead-letter/uncertain states, health; dual-database idempotency tests; ShellCheck clean | Timers were not installed/executed by Linux systemd here; no provider enabled; Sending/Uncertain requires operator reconciliation |
| 7. Attachments | Done | Database/pluggable storage, optional ClamAV socket, fake-scanner tests, quarantine and digest checks for both attachment families; original limits preserved | Real ClamAV/signature updates, S3 and cross-store recovery unverified; unscanned legacy files cannot download |
| 8. PostgreSQL backup/restore | Done | Actual shell scripts exercised in a synthetic fixture: corrupt archive rejected, separate restore, table counts/content fingerprints and attachment checksums matched; recovery about 3 seconds on tiny fixtures | Offsite transfer, installed schedule, realistic outage/RPO/RTO and restored application acceptance remain unverified |
| 9. Invitations/reset | Done | Local HTTPS adapter/SMTP catcher -> invitation/reset -> activation/login; expiry/single-use/session invalidation; unknown and failed-delivery reset responses uniform; account/IP limits | Real provider/deliverability and exactly-once external delivery not verified |
| 10. Security | Done | Same-origin scheme checks, authenticated proxy identity, secure cookie flags, baseline CSP/headers, static public errors, malformed-hash denial; npm audit zero known vulnerabilities | CSP permits inline hydration/styles; live TLS, real proxy topology and penetration/load testing unverified |
| 11. Quality/CI/docs | Partial | Full PostgreSQL 17 PR job configured, scoped ESLint/Prettier, English README, secret-free environment template, decisions register; copy checker executed and correctly detects drift | Other local repositories' infra copies differ. They were not overwritten. Hosted Actions execution/billing is unverified |
| 12. Mobile/accessibility | Done | Complete Playwright runner passed: 24 role/language/viewports, 84 daily-page checks, six booking scenarios, three full write journeys and 42 language/form axe checks; zero serious/critical findings in tested views | Physical devices, Safari/Firefox, assistive-technology users and all administrative screens remain unverified |

## Final executed checks

- `npm test`: 176 total; **144 passed, 32 optional checks skipped, zero failures**.
- `CLINIC_TEST_POSTGRES=1 DATABASE_URL=<disposable loopback PostgreSQL 17> npm test`: **176 passed, zero skipped, zero failures**.
- `CLINIC_SECURITY_ACCEPTANCE=1 npm run test:audit`: passed, including generated denial/read/export/download checks, PDF/XLSX and invitation/reset SMTP journeys; simulated delivery failure does not enumerate accounts.
- `DATABASE_URL=<disposable loopback PostgreSQL 17> npm run test:concurrency-http`: passed in shared/row mode.
- `CLINIC_DB=:memory: DATABASE_URL= VERCEL= npm run build`: passed.
- `npm run lint` and `npm run format:check`: passed for the explicit new-file quality scope.
- ShellCheck: passed `infra/*.sh` and `infra/postgres/*.sh` in a disposable container with source mounted read-only.
- `npm audit --json`: zero known advisory vulnerabilities; snapshot in `docs/hardening/DEPENDENCY-AUDIT.json`.
- `npm run test:backup-postgres`: passed using isolated containers/temporary key; final repeated drill measured `recovery_seconds=3`, `synthetic_drill_recovery_ms=2902`.
- `npm run test:ui-matrix`: complete final run passed. Screenshots/JSON live in git-ignored `.local/hardening-browser/`; no browser artifacts or fixture credentials are committed.
- `PROJECTS_DIR=<local sibling checkouts> sh infra/check-copies.sh`: **failed as expected on real copy drift**. This is outstanding release work, not a passing equality check.

## Decisions and release work

See [DECISIONS_NEEDED.md](DECISIONS_NEEDED.md). No business prices/floors/thresholds, working hours, retry/reminder settings, invitation lifetime, retention, providers, storage or backup destination were chosen. New settings have no business defaults. Configure matching private gateway/application proxy tokens before relying on per-client IP buckets; otherwise unresolved direct callers share a conservative bucket.

Reconcile the infra copies (or select a single managed source), then run independent scope/security and clinic UAT, enable only approved integrations and schedules, verify staging/live TLS/offsite recovery and measure realistic load/outage. The separate financial-report aggregation backlog R1/R2 remains in [the development checklist](docs/DEVELOPMENT-CHECKLIST.md); these hardening tasks do not certify completion of the full 27-page master requirements.

## Explicitly not verified

Physical devices, real email/reminder/payment providers, ClamAV/S3 services, production or multi-host load, live TLS/DNS, hosted CI execution, installed systemd timers, external audit anchoring, off-server backups, realistic recovery objectives and clinical/legal approval. No production readiness claim is made.
