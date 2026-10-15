#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${PROJECTS_DIR:?Set absolute root of reviewed checkouts}"
: "${RELEASE_TAG:?Use an immutable release tag}" "${PREVIOUS_RELEASE_TAG:?Set the previous verified tag for rollback}"
: "${MIGRATIONS_BACKWARD_COMPATIBLE:?Explicitly certify additive, rollback-compatible migrations before deploy}"
[ "$MIGRATIONS_BACKWARD_COMPATIBLE" = true ] || exit 1
[ "$RELEASE_TAG" != "$PREVIOUS_RELEASE_TAG" ] || exit 1
mkdir .deployment-lock 2>/dev/null || { echo 'Deployment/backup already in progress';exit 1; }
trap 'rmdir .deployment-lock' EXIT HUP INT TERM
# No automatic git changes: operator supplies reviewed checkouts on explicit branches.
for app in factory clinic employees;do
 (cd "$PROJECTS_DIR/$app" && if [ -f scripts/predeploy.sh ];then sh scripts/predeploy.sh;else pnpm check && pnpm build;fi)
done
sh ./control.sh config --quiet
sh ./backup.sh
sh ./control.sh build --pull
rollback(){ echo 'Deployment failed: restoring previous application image tags. Database migrations are NOT automatically reversed.' >&2;RELEASE_TAG="$PREVIOUS_RELEASE_TAG" sh ./control.sh up -d --no-build; }
if ! sh ./control.sh up -d --no-build --wait --wait-timeout 240;then rollback;exit 1;fi
if ! sh ./check-uptime.sh;then rollback;exit 1;fi
