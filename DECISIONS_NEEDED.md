# Decisions needed before clinic launch

No prices, thresholds, providers, retention or working hours were selected by this hardening work. Application settings remain explicit; technical safeguards do not approve medical/financial policies.

| Owner decision | Configuration / closure |
|---|---|
| Email provider, sender identity and delivery support | Private email adapter settings, provider sandbox/deliverability and ambiguous-send reconciliation |
| Invitation lifetime | CLINIC_INVITATION_TTL_MINUTES; required, no default |
| Appointment reminders/review-request channel and consent | CLINIC_REMINDER_LEAD_MINUTES plus approved SMS/WhatsApp/email provider, scheduling/content/consent and stop rules |
| Payments and refunds | Provider, supported flows, reconciliation, webhook/authentication and sandbox approval |
| Data region, host and domains | Approved VPS/region, DNS, HTTPS and privacy text |
| Retention and deletion | Patient/document/audit/backup retention, legal basis, archive/deletion responsibilities |
| Prices, floors and financial approval limits | Owner-entered dated service prices, floors, refund/discount thresholds and cost/rate definitions |
| Stock, device and escalation thresholds | Inventory-adjustment limits, reorder/safety thresholds, expiry windows and escalation policy |
| Working hours/time off | Explicit practitioner intervals in users/working-hours and users/time-off; no default schedules |
| Utilization and finance definitions | Approve booked/completed capacity basis, outside-hours bookings, revenue attribution, cost centers and margin calculation |
| Clinical templates and governance | Qualified clinician approval of assessment/red flags/measures/consent/discharge and incident roles |
| Storage and scanning | Database versus future S3-compatible store, ClamAV host/signature updates and quarantined-file review |
| Backup destination, schedule and recovery objectives | Offsite hook, retention days, quiet window, RPO/RTO and periodic restore owner |
| Audit anchoring | Independently controlled append-only/WORM destination, checkpoint schedule and retention |
| Outbox retry policy | Transport module and explicit maximum attempts, base/max delay and batch size; ownership of Uncertain/Sending/DeadLetter reconciliation |
| Production access/security | Approved staff roles, invitation/revocation process, proxy topology, secret rotation and incident owner |
| Business/legal text and training | Approved clinic identity, hours, privacy/business text, final UAT and staff training/sign-off |
| Infrastructure copy ownership | Reconcile changed infra across candidate repositories or choose a single managed source; this branch does not overwrite other repos |

Technical prerequisites, rather than business defaults: matching private proxy tokens in gateway and clinic, loopback-only disposable test databases, reviewed row-lock rollout, staging, browser/device acceptance and measured recovery/load. No production deployment, credentials, real messages/payments or live integrations were used.
