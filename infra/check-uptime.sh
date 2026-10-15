#!/bin/sh
set -eu
cd "$(dirname "$0")"
sh ./control.sh ps --format json | node scripts/check-health.mjs
used=$(df -P . | awk 'NR==2 {gsub(/%/,"",$5);print $5}')
[ "$used" -lt "${DISK_ALERT_PERCENT:-85}" ] || { echo 'Disk usage threshold exceeded' >&2;exit 1; }
