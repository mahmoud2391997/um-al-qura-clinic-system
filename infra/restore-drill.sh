#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${CONFIG_DIR:?}"
umask 077
archive=${1:-$(ls -t backups/snapshot-*.enc 2>/dev/null | head -1)}
[ -n "$archive" ] || { echo 'No snapshot' >&2;exit 1; }
tmp=$(mktemp -d);container="vps-restore-drill-$$";start=$(date +%s)
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true;rm -rf "$tmp"; }
trap cleanup EXIT HUP INT TERM
node scripts/crypt.mjs decrypt "$archive" "$tmp/archive.tgz" "$CONFIG_DIR/backup.key"
# Reject unsafe paths before extraction.
tar -tzf "$tmp/archive.tgz" | awk '/^\// || /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}'
tar -xzf "$tmp/archive.tgz" -C "$tmp"
(cd "$tmp" && shasum -a 256 -c files.sha256)
docker run -d --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -v "$tmp:/restore:ro" postgres:16-alpine >/dev/null
ready=0
for i in $(seq 1 60);do if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1;then ready=1;break;fi;sleep 1;done
[ "$ready" = 1 ] || exit 1
for db in factory clinic workforce;do
 docker exec "$container" createdb -U postgres "$db"
 docker exec "$container" pg_restore --exit-on-error --no-owner --no-acl -U postgres -d "$db" "/restore/$db.dump"
 docker exec -i "$container" psql -U postgres -d "$db" -At < "$tmp/$db-count.sql" > "$tmp/$db-restored.txt"
 diff "$tmp/$db-count.txt" "$tmp/$db-restored.txt"
done
now=$(date +%s);snapshot=$(cat "$tmp/snapshot-epoch")
printf 'PASS restore databases and attachment checksums; recovery_seconds=%s snapshot_age_seconds=%s\n' "$((now-start))" "$((now-snapshot))"
echo 'Application health against restored data still requires isolated app acceptance; no production data changed.'
