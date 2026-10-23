Current report/marketing/scanner release: [23 October candidate and operational limits](RELEASE-2026-10-23.md). Older unchecked items below are historical reconciliation; clinical/UAT approval remains open.

# Current development checklist

Reviewed 2026-10-19 against baseline commit `475a9ae`; subsequent hardening is recorded in [HARDENING-SUMMARY.md](../HARDENING-SUMMARY.md). This is the current reconciliation index; older readiness/audit notes are historical. Implemented means code exists, not clinic approval or production certification.

## Source and evidence limits

Reference: Um_Al_Qura_Clinic_System_Master_Requirements_FINAL.pdf, version 1.0, 27 pages (local Downloads copy). Reviewed the existing page-marked extraction at `Documents/ChatGPT/New project/tmp/clinic-master-requirements.txt`, alongside source and tests. This is a module/UAT-level reconciliation; individual fields and clinical policy still need clinic review. Existing uncommitted readiness notes were preserved.

Fresh verification: `npm test`: 138 tests, 122 passed, 16 skipped, zero failed. Skipped optional database/configuration checks are not passes. PostgreSQL, load, physical-device and production acceptance were not rerun. HTTP acceptance results are recorded below separately.

## Requirements reconciliation

| Reference | Current implementation/evidence | Remaining closure |
|---|---|---|
| pp4–5 roles and clinical separation | permissions/data-scopes/clinical tests; server authorization | All-role, all-operation denial matrix and approved role policy |
| pp6–9 patient journey/profile | patient-profile, patient-tasks, quick-booking, clinical tests; unified scoped profile | Staff acceptance of complete journey, field-by-field demographics and consent review |
| p9 calendar/reception | daily/weekly calendar, provider/service filters, conflicts, waiting list and timestamps | Verify room filtering, configurable cancellation/no-show reasons and authorized package visibility against each requirement |
| pp9–11 clinical/rehab | episodes, templates, red flags, measures, approval lock/addenda, home program and discharge | Qualified clinician review of templates, measures, exception alerts and referral/discharge output |
| p12 tasks/automation | recurring tasks, escalation, scheduler runner and policies | Confirm all trigger/recurrence variants and activate reliable deployed scheduler |
| pp12–14 assets/maintenance/inventory | assets, vendors, maintenance schedule, counters, FEFO batches, atomic session consumption, approved adjustments | Verify all master fields, automatic service-resource defaults, reorder suggestions and operational acceptance |
| pp14–16 finance/costs | dated prices/floors, independent approvals, payments/refunds/packages/cashbox, frozen session cost and allocated collections | Reconcile period/service/provider/department financial reports, expense category/cost-center reports and margin definitions |
| p16 compliance | license versions, recurring obligations, payments and alerts | Configure actual records and renewal policy; staff acceptance |
| pp16–17 CRM | lead-to-booking/attendance transitions, campaign attribution and collected revenue | Validate source/campaign reporting end to end; external review delivery remains later integration work |
| p17 quality | complaints, satisfaction, restricted incidents and CAPA approval | Review configurable survey, repeated-complaint/cancellation/outcome reporting and clinical governance |
| pp18–19 dashboards/reports | scoped dashboard, basic summaries, appointment period/service/provider/department filters, CSV/PDF/XLSX exports | Full report catalog below; reconcile totals, permissions and export parity |
| pp19–20 audit/security | route inventory gate, metadata read/export/download audits, secure-session and authorization tests | Runtime matrix plus all-role mutations/denials; normal-user audit immutability acceptance |
| p20 Arabic/core English | core English and RTL/LTR documented in ENGLISH-UI.md | Core English clinic acceptance; specialized administration translation is optional scope extension unless requested |
| pp20–21 nonfunctional | responsive UI, application security headers, database support, backup tools and infra | Large-data pagination/performance, deployed HTTPS, backup schedule/offsite restore, staging and physical devices |
| pp23–27 delivery | phased modules, guides generator, infrastructure runbook and tests | Approved ERD/role matrix, staging, defect tracker, training, ownership handover and signed UAT |

## Prioritized development backlog

- [ ] R1 (Must): implement/reconcile financial reports by period, service, provider and department; include expense category/cost center and service profitability. Define billed versus collected revenue, refunds, allocation dates, unallocated collections and rounding. Current `filteredReport` returns appointment metrics only; `operations.js` reports are mostly lifetime summaries. Acceptance: deterministic fixtures reconcile totals to source transactions, no duplicate allocated revenue, permission-safe API/UI/export parity, SQLite and PostgreSQL.
- [ ] R2 (Should): complete and verify the p18–19 report catalog: clinical outcomes/adherence/discharge, cancellations/no-show, downtime/maintenance cost, inventory usage/variance, renewal due dates, task completion/overdue and satisfaction/complaints. Raw module tables do not establish complete report coverage.
- [ ] R3 (Definition first): agree utilization denominator. Current completed scheduled minutes / noncancelled scheduled minutes is explicitly labelled and tested. Staffing-capacity utilization needs agreed working hours, breaks, leave and overlapping schedules; the PDF says utilization without defining that denominator. Do not invent a staffing model as a mandatory requirement.
- [x] P1 (Must): rerun generated HTTP read/export/download audit inventory and security acceptance. Passed on 2026-10-19: 79 sensitive GET paths, 79 export attempts and 5 download paths. Owner success coverage is different from denial coverage across roles.
- [ ] P2 (Must): extend role/action scope acceptance for every sensitive read, write, export and download: anonymous, no permission, assigned versus unassigned record, inactive user and changed role/session; verify no data leakage or unauthorized state change, appropriate audit, and transaction rollback.
- [ ] F1 (Must review): close the detailed functional review items in the table with evidence rather than assuming existing screens satisfy every field/rule.
- [ ] L1 (Must): approve core English/Arabic daily workflows with clinic staff. Broader English translation is a separate enhancement.

## UAT traceability (PDF pp24–25)

| UAT | Implementation evidence | Closure still needed |
|---|---|---|
| 01 patient/duplicates | quick-booking and patient profile tests | Clinic duplicate/field policy acceptance |
| 02 booking/move/cancel/no-show | quick-booking, workflow-cost-export and calendar code | Reason-list policy and browser acceptance |
| 03 reception timestamps | appointment workflow and filtered wait metrics | Staff workflow acceptance |
| 04 clinical lifecycle | clinical and clinical-programs tests | Qualified clinician approval |
| 05 assistant restrictions | permissions, clinical and scope tests | Full API denial matrix |
| 06 lock/addendum | clinical tests | Staff acceptance |
| 07 device counters | session-resources, operations tests | Threshold configuration acceptance |
| 08 inventory/maintenance links | stock-batches, readiness-workflows tests | Operational acceptance |
| 09 billing/payment/discount | finance, approval, corrections and cashbox tests | Finance acceptance |
| 10 cost/margin | workflow-cost-export, session-billing tests | R1 reconciled financial reporting |
| 11 renewal tasks | automation-renewals/runner tests | Deployed schedule and policy acceptance |
| 12 lead to revenue | readiness-workflows and campaign code | Unified conversion/revenue acceptance |
| 13 dashboard consistency | dashboard tests and existing browser suite | Fresh deployed/UI verification |
| 14 sensitive audit | API inventory unit gate; fresh HTTP matrix: 79 reads/79 exports/5 downloads | P2 and mutation completeness |
| 15 filters/exports | readiness-workflows, report-files tests | R1/R2 filter/export coverage |
| 16 mobile/tablet | existing browser scripts at mobile/desktop widths | Physical phone/tablet and staff trial |
| 17 backup/restore | existing tests/runbook and historical local restore record | Offsite schedule, periodic restore and production-scale recovery |

## Deployment and owner decisions (separate from coding)

- [ ] Select/confirm hosting, domains, data region, retention and recovery objectives.
- [ ] Configure PostgreSQL, HTTPS, scheduler, offsite backup and staging; rehearse upgrade/rollback and restore.
- [ ] Approve prices/floors, inventory limits, staff roles, clinical templates, financial definitions and privacy/business text.
- [ ] Select email/reminder/payment providers before implementing and validating live integration. PDF p23 places external integrations in phase 4 (Later); in-app notifications and future integration capability are already present.
- [ ] Decide hosting-appropriate attachment scanning/storage. External storage itself is not an explicit universal PDF requirement.
- [ ] Run clinic UAT, track defects, train users and approve launch.

## Verification log

- 2026-10-19: unit suite passed as recorded above. No production data or external message provider used.
- 2026-10-19: `CLINIC_SECURITY_ACCEPTANCE=1 npm run test:audit` passed using disposable synthetic SQLite and loopback SMTP/HTTPS servers: 79 reads, 79 export attempts, 5 protected download paths; PDF/XLSX response/permission checks; recovery token/session invalidation; scoped patient denials; origin/header/throttle/scheduler boundaries. Log: `/tmp/clinic-current-audit-retry.log` (temporary local evidence). Initial attempt could not become ready while the interactive dev server held the project lock; retry after stopping it passed. This does not certify every role/action or PostgreSQL.

## Hardening follow-up

The hardening branch adds method/path and exact-action policies, generated denials, modular handlers, audit chaining, owner-configured capacity, scoped PostgreSQL row concurrency with a global-lock rollback flag, scheduled reminder/outbox groundwork, quarantined attachments, a PostgreSQL restore drill, invitation/reset/security work and expanded browser acceptance. See the task table in HARDENING-SUMMARY.md for evidence and limits.

The older R3 staffing-capacity implementation gap is now addressed by explicit dated work/time-off settings and separate capacity ratios; clinic approval of the definition and actual schedules remains open. P1 passed the expanded 148 restricted-entry / 84-read / 84-export / five-download HTTP matrix. Broader financial report aggregation (R1/R2), independent scope review, clinic UAT and production activation remain distinct work; this hardening does not claim full master-requirements completion.
