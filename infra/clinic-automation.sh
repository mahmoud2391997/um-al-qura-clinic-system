#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ ! -d .deployment-lock ] && [ ! -d .backup-lock ] || exit 0
sh ./control.sh exec -T clinic node --input-type=module -e 'const r=await fetch("http://127.0.0.1:3000/api/automation/run",{method:"POST",headers:{Authorization:"Bearer "+process.env.CLINIC_AUTOMATION_SECRET}});if(!r.ok)throw Error("Clinic scheduled automation failed: "+r.status)'
