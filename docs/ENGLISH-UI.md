# Core English interface

Arabic remains the default. The language button is available before and after sign-in. English uses a left-to-right layout; the preference persists in this browser only. Switching languages does not change account permissions, API enum values, records, or unfinished form data.

Translated core interfaces:
- Sign-in, owner setup, password recovery controls and common errors.
- Navigation titles, shared table/search/sort/pagination/add/edit controls.
- Patient registration, demographics and unified profile headings.
- Appointment booking, statuses, calendar and rescheduling controls.
- Clinical assessment/plan/session/discharge forms, structured fields, template picker and home-program editor.
- Invoice creation, payments/discount/refund controls.
- Task creation, priority and completion controls.
- CSV/PDF/Excel download buttons; PDF and Excel use the existing scoped audited server export route.

Translations apply explicitly to interface labels. Patient names, clinical narratives, service names, practitioner names, custom role names and other business data retain their original language. The font, direction and numeric presentation change with the selected language; stored values do not.

This is a core English interface, not complete translation of every administrative workspace. Specialized purchasing, readiness/filtered-report workspaces and file-attachment forms retain Arabic details where not translated. Some advanced configuration fields and server validation messages also retain Arabic fallback. The approved home-program text download and PDF report headings remain Arabic. Official clinic identity, address and business hours remain the supplied business text.

Verification:
- `npm test`
- `npm run build`
- `npm run test:ui-language`

The browser acceptance runs only against a disposable synthetic SQLite file on loopback, at390px. It verifies Arabic default, English login, language persistence, live form preservation when toggling, English patient/booking/clinical/invoice-payment/task-completion writes, unchanged Arabic record values/internal enums, PDF/Excel button downloads, no horizontal page overflow, no browser exceptions, and restoring Arabic. It does not claim deployment or production database acceptance. Screenshots are local and ignored by Git.
