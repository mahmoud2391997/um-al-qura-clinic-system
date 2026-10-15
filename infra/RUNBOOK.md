# Five-projects VPS runbook

No live environment has been changed. Owner approval of business content, domains, region, retention, providers and user acceptance remains mandatory. Current blockers and verified commands are in each project's docs/PRODUCTION-READINESS.md.

## First setup

Use Node 22, Docker Engine and Compose v2 on a Linux VPS. Set PROJECTS_DIR to the absolute directory containing checkouts named factory, clinic, employees, feed-site and medical-site. Identical infra copies are delivered in all five repositories; operate only one stack, with one private CONFIG_DIR. Do not copy local `.env`, databases, credentials PDFs or test artifacts onto the server or into Git.

Set `CONFIG_DIR` to an absolute private directory outside this repository, typically `/etc/five-projects`. Run `node scripts/configure.mjs` once. It creates private 0600 files and a backup key without displaying credentials and preserves existing files. Complete the generated gateway hostnames, clinic HTTPS base URL, company identity/admin email, site origin and approved communication settings. These values intentionally have no business defaults. Keep a copy of the backup key separate from encrypted backups. Database ports have no host mapping and are on an internal-only network.

Set FEED_CONTACT_JSON and MEDICAL_CONTACT_JSON to public, owner-approved contact JSON. Required keys: phone, whatsapp (968 plus eight digits), email, addressAr/addressEn, hoursAr/hoursEn, siteUrl (HTTPS), privacyText, contentApproved:true, privacyApproved:true; medical additionally needs mapQuery as coordinates `latitude,longitude` or `place_id:...`. Do not use the synthetic testing fixture on live. Build arguments contain public contact text only, never private credentials.

Review `docker compose config --quiet`, build with `sh ./control.sh build`, then run `sh ./control.sh up -d --no-build` for the FIRST setup (without --wait until factory bootstrap is complete). After protected account setup, run `sh ./control.sh up -d --no-build --wait` for health acceptance. The real apps default to demo off, and startup validates required private configuration. Factory and clinic owners use setup tokens to create their own account. Employees provision only the explicitly configured company administrator. No synthetic users should be present in real databases.

## Predeployment and rollback

Use reviewed, immutable source checkouts and take a backup first. `deploy.sh` does not pull Git branches automatically (no implicit branch/identity choice). Set distinct RELEASE_TAG and PREVIOUS_RELEASE_TAG to immutable image tags. Certify `MIGRATIONS_BACKWARD_COMPATIBLE=true` only after reviewing every migration. Deploy runs each system's local predeploy checks, validates Compose, backs up, pulls base images during build, starts and waits for health. Failure reuses the previous application image tag. This does not roll back data or reverse schema changes. Non-additive migrations require a separately reviewed maintenance procedure, not automatic deployment.

Factory health before bootstrap may be degraded; complete the protected setup before final acceptance. Check all five HTTPS origins through the gateway and perform authenticated user journeys before allowing real data. Uptime checks cannot replace business-flow acceptance.

## Backup and restore

The owner sets BACKUP_RETENTION_DAYS, daily schedule, acceptable recovery time/data-loss window, and BACKUP_OFFSITE_HOOK (absolute executable; accepts one encrypted archive path). Keep the offsite destination and authentication in private operator settings. The hook must return nonzero on failure. Retention pruning happens only after confirmed offsite transfer. Without a hook, backups remain local and pruning is disabled with an explicit warning.

`sh ./backup.sh` briefly stops writers for a consistent three-database and file snapshot, authenticates encryption with AES-256-GCM, records table counts and file checksums, then restarts services. The clinic stores document bytes inside its database; its dump covers them. Factory attachments and feed request files are separately included. Do not schedule overlapping deployments/backups. Both use local lock directories; investigate stale locks before removing them after a crash.

`sh ./restore-drill.sh [archive]` decrypts and validates the snapshot, restores into an isolated temporary PostgreSQL container with no network, compares every public table's row count, and checks attachment hashes. Corrupt ciphertext must fail authentication. It prints recovery_seconds and snapshot_age_seconds; the latter is the measured age of the tested snapshot, not an owner-approved loss window. Perform a separate isolated application-health and authenticated-file drill against restored data before certifying recovery. Never point the drill at production.

Activate the supplied systemd backup timer only after changing its suggested time to the approved Oman-time schedule. Install the automation timer to continue clinic processing without a logged-in user. It queues reminder/review work; no SMS or payment provider has been activated. Put CONFIG_DIR and approved backup settings in the private operator.env used by the service units. Timers are shipped, not installed on this machine or live.

## Rotation

Keep operator credentials in a private password manager. Change one application database password at a time using a privileged local PostgreSQL session, update the matching private app file and restart that app. Changing bootstrap tokens only affects setup authorization. Rotating JWT keys signs users out. Rotating the backup key applies to new snapshots only: preserve previous keys with their archive generations and test restore before retiring them. Never print secrets in logs, shell history or issue/PR bodies.

## If a service is down

Run `sh ./control.sh ps`, then service-specific logs with a bounded tail; redact any sensitive content before sharing. For PostgreSQL check volume space and readiness first; do not recreate/delete its named volume. For an app check required environment names, migrations and dependent database readiness. For gateway check DNS/ports and upstream health; do not weaken TLS to mask a routing failure. For a failed notification verify configuration and the outbox state; do not resend an ambiguous SMTP delivery without reconciliation. For disk alerts stop large imports, preserve a verified offsite backup, and prune only per approved retention. Never run `down -v` on a real stack.

## VPS hardening checklist (operator)

- SSH key authentication; disable password login and direct root login only after validating a second working session.
- Firewall permits SSH from approved management sources and public TCP 80/443 (UDP443 only if HTTP/3 is used). No PostgreSQL exposure.
- Install automatic security updates with an agreed reboot/maintenance window.
- Private configuration directory mode0700, files0600; least-privilege operator membership in the Docker group.
- Monitor disk, uptime, backup/offsite failures and certificate expiry; assign a named responder.
- Verify owner-approved region, retention, privacy/content and restoration procedures before real patient data.

## Notification delivery guarantees

Factory notifications are persisted with the ERP state; a worker claims each delivery in a separate committed write before SMTP. Employees persist notifications atomically with task changes and claim them using a conditional database update. Stable delivery IDs and SMTP Message-IDs suppress application retry duplicates. The system preserves PENDING when SMTP is not configured. SENDING after a crash and UNCERTAIN after an SMTP ambiguity must be reconciled by an operator; they are not blindly resent. Generic SMTP cannot guarantee recipient-level exactly-once delivery after acceptance plus a lost acknowledgement. Do not describe that as solved. Retrying those states requires confirming non-delivery with the provider, then a reviewed operator procedure; provider-specific reconciliation remains blocked on provider selection.

Install the notification-outbox timer after assigning a responsible operator. It calls each app over localhost inside its own container with a separate NOTIFICATION_OUTBOX_SECRET. No email provider is selected or contacted by the supplied private settings.

## Optional clinic SMTP adapter
Enable only after provider approval. Create a mode-0600 file outside git at `$CONFIG_DIR/mail-adapter.env` containing NODE_ENV=production, CLINIC_EMAIL_KEY (random >=32 characters), SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and SMTP_FROM. Set the same key in clinic.env and CLINIC_EMAIL_ENDPOINT=https://<clinic-domain>/internal-mail/send. Run `sh ./control.sh --profile mail build mail-adapter` and `sh ./control.sh --profile mail up -d mail-adapter gateway`. The gateway terminates HTTPS; the adapter is private on the compose network. No public adapter port is published. Choosing a provider and testing real delivery remain owner/operator actions.

## Restored application rehearsal (separate from the database-only drill)
Create a NEW compose project with separate private configuration, unused localhost test ports and distinct named volumes. Start only its PostgreSQL service. Restore each dump into the matching empty database using `pg_restore --exit-on-error --no-owner --no-acl --role=<app-role> -U postgres -d <database>`; the factory, clinic and workforce roles must already exist from init.sh. Restoring all tables as postgres without `--role` breaks application migration/read permissions. Never drop/recreate a database outside this explicitly disposable project.

Create stopped factory/feed containers, copy snapshot factory-files contents to /app/data and feed-data contents to /data, then set volume ownership to UID/GID1000 and private directory permissions before starting the nonroot apps. Do not copy file snapshots while writers are active. Run `up -d --no-build --wait`, verify every proxy health route, log in using synthetic restored users, download protected factory and clinic attachments and compare bytes, then verify feed SQLite integrity. This rehearsal was executed locally on 2026-10-15; all five proxy routes returned200 and both protected attachment downloads and workforce login passed. The database-only restore script is still not a substitute for this application rehearsal; repeat after schema/storage changes.

Shell tools are invoked with `sh` so browser-uploaded checkouts also work when executable bits are not preserved. Docker explicitly enables its required static-site entrypoint.
