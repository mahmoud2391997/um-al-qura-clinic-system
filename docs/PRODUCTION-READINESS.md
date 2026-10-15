# Clinic system — readiness review

Date: 2026-10-15. Branch: `prod-readiness/clinic-runtime`. Status: development candidate, NOT approved production.

## Implemented and evidence
- C1: unified patient profile, scoped appointments/episodes/clinical/finance/documents/tasks; linking tasks respects patient scope and task ownership. Role changes reset the workspace.
- C2/C3: dated service prices, immutable historical record prices, explicit floor and independent below-floor approval with reason/idempotency. Real PostgreSQL requires a configured service catalog for new invoices/appointments; no default price is chosen.
- C4/C5: maintenance parts reference issued inventory batches and documents; owner-configured inventory-adjustment thresholds with separate approval and stale-balance checks. Direct adjustment bypass blocked.
- C6: lead/patient/appointment relationship, Booked/Attended/ReviewRequested history and unique review-request job. Local scheduling code and systemd timer supplied. External transport remains AwaitingProvider.
- C7: scoped period/service/provider/department reporting, waiting time and reconciled totals. Utilization means completed scheduled minutes divided by noncancelled scheduled minutes, NOT staffing capacity. Finance breakdown and real capacity definition still require review.
- C8: authenticated reads and exports record metadata, role scope and row counts without personal/file contents. End-to-end audit endpoint coverage still needs manual review; module tests alone are not exhaustive.
- C9/C10: additive PostgreSQL/SQLite schema, attachment bytes stored in database TEXT/base64, enforced existing PDF/PNG/JPEG size/count limits, scoped maintenance access. No destructive migrations.
- C11: generic SMTP HTTP adapter, Bearer contract, HTTPS gateway route and contract tests supplied in infra/mail-adapter. No provider chosen or real messages sent.
- C12/C13: PostgreSQL-only real production guard, strong setup/automation secrets, demo-only rejected, HTTPS base required; nonroot Docker and local predeploy tests/build.
- Initial observed suite 75 pass +2 skipped. Latest normal run 82 pass +7 skipped; latest CLINIC_TEST_POSTGRES=1 run 89/89 pass, zero skips. Production build succeeded. Tests exercise both database dialects, independent approval, historical prices, stock, maintenance attachments, scheduled transitions, reports and scoped tasks.

## Not complete / limits
C7 staff-capacity utilization and finance aggregation are not certified against the master requirements. C8 exhaustive endpoint audit/denial acceptance is pending. C10 protected attachment download passed after restart and from the separately restored PostgreSQL stack. C11 local SMTP-catcher password-reset journey still pending. No claim of complete medical/operational acceptance.

## Blocked on owner
C14: payment provider, reminders channel, region, retention and remaining master-requirement decisions (asset/vendor detail, medical approvals, incidents, English UI, PDF/Excel). Set service prices/floors, inventory thresholds and clinical/report definitions. Decide virus scanning and external file storage. Approve legal text and all clinic requirements before launch.

## Reproduce
Node 22: `npm test`; `npm run build`; `CLINIC_TEST_POSTGRES=1 DATABASE_URL=<disposable-local-postgres> npm test`. `npm run acceptance` requires synthetic local user credentials and local URL (see scripts/acceptance.mjs). Never use production credentials for tests.

## Shared VPS delivery
`infra/` is copied identically into each existing repository at the owner's request; run ONE copy only. Set PROJECTS_DIR to the absolute directory containing checkouts named factory, clinic, employees, feed-site and medical-site. Private environment files and backup keys belong outside all repositories. One internal PostgreSQL service contains separate factory, clinic and workforce databases/users. Caddy routes five hostnames. Containers run without root, with persistent volumes and health checks.

No production deployment, DNS, production database, real messages, payments, merges to main, or GitHub settings changes were performed. Local fixtures are synthetic. Production demo defaults OFF, following the latest written instruction. HTTPS issuance cannot be verified without approved domains. See infra/RUNBOOK.md for setup, backup, scheduling, rollback and hardening.

## Blocked on owner — shared
Choose domains, VPS size/region, off-server backup destination, retention, acceptable loss/recovery time, email provider and whether a public demo is approved. Confirm repository visibility and business/privacy content. These decisions are not inferred from old documents.

## Remaining verification — shared
A successful build or unit test is not operational acceptance. The final local-stack evidence below distinguishes executed checks from pending checks. No real-user trial has been performed. Automatic application rollback, SMTP-catcher invitation/password-reset journeys and physical-device acceptance must not be assumed passed unless explicitly recorded below.

## Executed local stack / recovery evidence
2026-10-15: all five images built successfully. One PostgreSQL16 service, three databases and distinct roles; inspect showed {"5432/tcp":null}, no published database port. A temporary loopback-only test forwarder was used for database acceptance, never added to production compose. All five apps returned200 through placeholder hostnames on the local Caddy proxy. Factory bootstrap created only its supplied synthetic administrator; clinic owner and synthetic roles were created through protected setup/user APIs; workforce used the explicit synthetic administrator configuration.

Encrypted backup restored all three databases with table-count comparison and file checksum validation; recovery_seconds=6 and snapshot_age_seconds=20 for the small synthetic snapshot. Corrupted ciphertext was rejected. Separate restored-app project reached healthy status, all five proxy routes returned200; restored workforce login and protected factory/clinic attachment byte checks passed. Database restoration needed --role=<app-role> and copied volumes needed UID/GID1000; see infra/RUNBOOK.md. Live TLS, offsite transfer, real backup schedule and production-scale recovery time remain unverified.
