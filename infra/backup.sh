#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${CONFIG_DIR:?}" "${BACKUP_RETENTION_DAYS:?Owner must select retention days}"
case "$BACKUP_RETENTION_DAYS" in ''|*[!0-9]*|0) echo 'Retention must be positive days' >&2;exit 1;; esac
mkdir .backup-lock 2>/dev/null || { echo "Backup already running" >&2; exit 1; }
umask 077
mkdir -p backups
snapshot=$(mktemp -d)
started=$(date +%s)
running=$(sh ./control.sh ps --status running --services | sed -n '/^factory$/p;/^clinic$/p;/^employees$/p;/^feed-site$/p')
cleanup(){ if [ -n "$running" ];then sh ./control.sh start $running >/dev/null || true;fi;rm -rf "$snapshot"; rmdir .backup-lock; }
trap cleanup EXIT HUP INT TERM
[ -z "$running" ] || sh ./control.sh stop $running
for db in factory clinic workforce;do
 sh ./control.sh exec -T postgres pg_dump -U postgres -d "$db" -Fc > "$snapshot/$db.dump"
 sh ./control.sh exec -T postgres psql -U postgres -d "$db" -At -c "SELECT format('SELECT %L, count(*) FROM %I.%I;',tablename,schemaname,tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename" > "$snapshot/$db-count.sql"
 sh ./control.sh exec -T postgres psql -U postgres -d "$db" -At < "$snapshot/$db-count.sql" > "$snapshot/$db-count.txt"
done
sh ./control.sh cp factory:/app/data "$snapshot/factory-files"
sh ./control.sh cp feed-site:/data "$snapshot/feed-data"
# All writers are stopped, including scheduler (systemd job checks deployment lock).
(cd "$snapshot" && find factory-files feed-data -type f -exec shasum -a 256 '{}' \; > files.sha256)
printf '%s\n' "$started" > "$snapshot/snapshot-epoch"
tar -czf "$snapshot/archive.tgz" -C "$snapshot" factory.dump clinic.dump workforce.dump factory-count.sql clinic-count.sql workforce-count.sql factory-count.txt clinic-count.txt workforce-count.txt factory-files feed-data files.sha256 snapshot-epoch
file="backups/snapshot-$(date -u +%Y%m%dT%H%M%SZ)-$$.enc"
node scripts/crypt.mjs encrypt "$snapshot/archive.tgz" "$file" "$CONFIG_DIR/backup.key"
if [ -n "${BACKUP_OFFSITE_HOOK:-}" ];then
 case "$BACKUP_OFFSITE_HOOK" in /*) ;; *) echo 'Offsite hook must be an absolute executable path' >&2;exit 1;;esac
 "$BACKUP_OFFSITE_HOOK" "$PWD/$file"
 # Prune only after confirmed offsite transfer; failure never removes previous snapshots.
 find backups -type f -name 'snapshot-*.enc' -mtime "+$BACKUP_RETENTION_DAYS" -delete
else echo 'Offsite transfer and retention pruning not activated: owner destination required.' >&2;fi
printf 'backup=%s snapshot_epoch=%s elapsed_seconds=%s\n' "$file" "$started" "$(( $(date +%s)-started ))"
