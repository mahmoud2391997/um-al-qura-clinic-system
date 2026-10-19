Task 2: router extraction
- Extracted authentication, identity, patients, appointments, clinical, finance, tasks, readiness, purchasing, assets/incident, attachments, reports and admin handlers. Registry-backed operation handling remains shared in the inventory adapter. The catch-all retains session/database serialization, shared authorization and response auditing.
- The source inventory now reads every handler file, preserving the reviewed path set and fingerprint gate; endpoint policy URLs did not change.
- Verified: PostgreSQL 17 full suite 140/140, zero skipped; synthetic HTTP denial/audit/read/export/download/security/reset suite passed after extraction; production build passed. One earlier HTTP run returned 400 on session-costs; a diagnostic rerun passed without a functional change, so concurrent/dev-start intermittency is not ruled out.
- Existing browser scripts and real services/devices not verified in this task.
