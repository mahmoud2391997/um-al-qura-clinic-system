#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ ! -d .deployment-lock ] && [ ! -d .backup-lock ] || exit 0
for app in factory employees;do
 sh ./control.sh exec -T "$app" node --input-type=module -e 'const key=process.env.NOTIFICATION_OUTBOX_SECRET;if(!key||key.length<32)throw Error("Outbox worker key missing");const response=await fetch("http://127.0.0.1:3000/api/internal/outbox",{method:"POST",headers:{Authorization:"Bearer "+key}});if(!response.ok)throw Error("Outbox processing failed: "+response.status)'
done
