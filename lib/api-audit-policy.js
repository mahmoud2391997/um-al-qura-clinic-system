// Explicit reviewed inventory. Adding a route requires classification and runtime coverage.
export const auditExemptions = {
 environment: 'Public feature flags only; contains no account or patient records.',
 setup: 'Unauthenticated bootstrap availability; POST bootstrap has its own setup audit.',
 login: 'Unauthenticated credential exchange; failures are throttled, no data/export response.',
 demo: 'Creates an isolated synthetic session; never reads operating records.',
 'password/request-reset': 'Unauthenticated recovery with uniform success; no account/token disclosed.',
 'password/reset': 'Unauthenticated single-use token exchange; successful reset writes users.password.reset.',
 'automation/run': 'Secret-authenticated scheduler mutation, not a user data read or export.',
 logout: 'Session deletion only; no record read/export.',
 me: 'Current-session identity and permissions only, required to initialize the client.',
 'patients/task-link': 'POST-only mutation with patient.task.link audit; not a read/export.',
 'users/revoke': 'POST-only session revocation, separately audited mutation.',
 'finance/cash-corrections': 'POST mutation; GET is covered by the operation registry.',
};
export const auditedReadPaths = [
 'patients','appointments','clinical','finance','tasks','roles','users','audit',
 'patients/profile/:id','appointments/staff','finance/staff','tasks/alerts','tasks/recurring','tasks/policy','tasks/escalations','tasks/staff',
 'finance/service-prices','finance/below-cost','inventory/adjustment-policy','inventory/adjustment-requests','equipment/parts-issue','marketing/visits','reports/filtered',
 'finance/corrections','finance/package-returns','finance/session-billing','finance/approvals','finance/policy','finance/cashbox','finance/cash-corrections','finance/payments','finance/discounts','finance/packages','finance/expenses','finance/costing','finance/rates','finance/session-costs',
 'clinical/templates','clinical/progress','clinical/home-followup','appointments/waiting',
 'equipment','equipment/components','equipment/maintenance','inventory','inventory/batches','inventory/movements',
 'compliance','compliance/history','compliance/payments','compliance/obligations',
 'quality/incidents','marketing','marketing/campaigns','quality','quality/preventive','quality/satisfaction','reports','reports/integrations',
 'patients/attachments','patients/attachments/targets','clinical/attachments','clinical/attachments/targets','compliance/attachments','compliance/attachments/targets','equipment/attachments','equipment/attachments/targets',
 'purchasing/vendors','purchasing/requests','purchasing/orders','purchasing/receipts','purchasing/catalog','purchasing/quotes','purchasing/policy','purchasing/attachments','purchasing/invoices','purchasing/invoice-orders',
];
export const auditedExportPaths = ['reports/export'];
export const reviewedDispatchPrefixes = ['patients/profile/','finance/','inventory/','purchasing/'];

export const auditedDownloadPaths = ['patients/attachments','clinical/attachments','compliance/attachments','equipment/attachments','purchasing/attachments'];

// Conservative review gate also catches future dispatch syntaxes the extractor cannot infer.
export const reviewedRouteSourceSha256 = '6baa1c076f7624dd7835a7cd73a60bacb808566807e7771e566d2e12c7fe6aa8';
