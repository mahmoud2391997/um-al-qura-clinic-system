Task 1: method/path gate and denial coverage
- Found before fixing: unknown subpaths fell through to top-level module handlers; helper permission failures could return 400.
- Added explicit method/path inventory, authenticated gate before domain validation, uniform no-grant denials, generic metadata-only successful/denied write events while preserving domain audits and scope checks.
- Passed: 124 unit tests (16 optional skipped); HTTP anonymous/no-grant matrix (140 restricted method/path entries), 79 read/export attempts, five downloads, PDF/XLSX, reset and security boundaries.
- Not exhaustive: action variants and every custom scope combination still require further coverage. Public bootstrap/token/scheduler routes intentionally use their own authentication contracts. No production services contacted.

Follow-up: exact action-specific grant requirements now cover create/edit/approve/reject/download/pay and special multi-module operations. Generated unit cases remove each required grant while retaining an unrelated mutation grant and require denial. Authentication login success/denial, demo-session creation and recovery requests also emit metadata-only audit events. Audit POST aliases are explicitly refused. Assignment-scope and all custom business-role combinations still require clinic review; the matrix is not a blanket security certification.
