Task 1: method/path gate and denial coverage
- Found before fixing: unknown subpaths fell through to top-level module handlers; helper permission failures could return 400.
- Added explicit method/path inventory, authenticated gate before domain validation, uniform no-grant denials, generic metadata-only successful/denied write events while preserving domain audits and scope checks.
- Passed: 124 unit tests (16 optional skipped); HTTP anonymous/no-grant matrix (140 restricted method/path entries), 79 read/export attempts, five downloads, PDF/XLSX, reset and security boundaries.
- Not exhaustive: action variants and every custom scope combination still require further coverage. Public bootstrap/token/scheduler routes intentionally use their own authentication contracts. No production services contacted.
