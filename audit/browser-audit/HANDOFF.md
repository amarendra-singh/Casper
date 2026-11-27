# Casper audit handoff — 2026-10-04

**Update after operator walkthrough:** Read `C:\WorkStation\Projects\Python\Casper\audit\browser-audit\OPERATOR_UX_REPORT_2026-10-04.md` alongside the initial report. Registration, logout/login, company create/rename/archive/restore, modules, platform/tier setup, vendor/category creation, CSV/XLSX product imports and exports, grid/pricing save, desktop/mobile invoices and payment, expense save/edit, supplier PDF/order CSV upload, SKU/pack confirmation and cost application, Meesho upload/missing-cost recovery/duplicate/replacement were now exercised through real browser controls on a separate migrated database. Persistence was verified. Native printing, role/credential changes and other marketplace write lifecycles remain unverified.

Six further defects: **P1** import fraud pipeline commits within a nested transaction and remains incomplete; **P1** missing-cost recovery resets existing GST5% to0. **P2** UTF-8 CSV currency headers lose costs, platform blank CR fields silently block creation, supplier upload leaves ledger totals stale, upload timestamps render naiveUTC as local. Operator report includes exact source paths, reproductions, receipts, three additional screenshots and fixes/checks. Navigation is reasonably easy; setup is moderately difficult, products/pricing require training, and financial analytics remain hard to trust. Audit-only helpers, synthetic fixtures, database and exported files were created; no application fixes or real finance writes.

The following original handoff describes the first pass and should be read with this update.

Detailed report: `C:\WorkStation\Projects\Python\Casper\audit\browser-audit\REPORT_2026-10-04.md`.

Main screens, existing platform reports, consolidated scope, mobile navigation, selected dialogs/filters and isolated API writes were examined with Tabbit's installed CLI. This is not a complete end-to-end audit: registration, real imports, supplier bill persistence, invoice/expense saves, native printing, membership changes and deployment remain untested. The final live recheck was blocked by frontend `ERR_CONNECTION_REFUSED`; services were not restarted. No application code, credentials, permissions or real financial records were intentionally changed.

Highest-priority confirmed findings:

| Severity | Reproduction / actual versus expected | Absolute source reference |
|---|---|---|
| P1 | Dashboard BLOCK targets are state/reason cohorts, not identified customers; five returns without values generate ₹3,000 recovery. Require verified identity/eligible losses. | `C:\WorkStation\Projects\Python\Casper\backend\app\services\fraud.py:769`; `C:\WorkStation\Projects\Python\Casper\backend\app\services\action_pipeline.py:26` |
| P1 | Two events with same state/reason and different signals trigger actor-key UNIQUE failure in disposable DB. Align key and grouping. | `C:\WorkStation\Projects\Python\Casper\backend\app\services\fraud.py:808` |
| P1 | Target₹120×10 versus payout₹1,000 generates ₹200 “recoverable” without contractual debt. Separate target variance from claims. | `C:\WorkStation\Projects\Python\Casper\backend\app\services\reconciliation.py:64` |
| P1 | Dashboard calls earnings/gross31.8% contribution margin before SKU costs. Use cost-aware contribution and disclose scope/coverage. | `C:\WorkStation\Projects\Python\Casper\frontend\src\pages\Dashboard.jsx:314` |
| P1 | January₹900 and Jan–Feb₹1,350 pass overlap guard and aggregate₹2,250. Reject/partition overlapping financial coverage. | `C:\WorkStation\Projects\Python\Casper\backend\app\services\pnl.py:794` |
| P1 | Owner/admin PATCH accepts CR150% and negative ad%; schemas also accept negative fees/blank names. Validate domain bounds. | `C:\WorkStation\Projects\Python\Casper\backend\app\schemas\platform.py:5` |
| P1 | Fraud SKU Risk returns500 for single/all scopes; UI claims no data. Use list-aware company filtering and visible errors. | `C:\WorkStation\Projects\Python\Casper\backend\app\routes\fraud.py:162`; `C:\WorkStation\Projects\Python\Casper\backend\app\services\fraud.py:1829` |
| P1 for issued records | Disposable paid invoice can be edited200/deleted204. Define immutable issuance and auditable corrections; tax preview metadata incomplete. | `C:\WorkStation\Projects\Python\Casper\backend\app\routes\billing.py:263` |

P2 findings: Platform Fraud stuck Loading (missing props/fetch); no-op dashboard date/company controls and hardcoded freshness; return-only denominators; alias marketplace misattribution; unbalanced waterfall and omitted consolidated cost rows; zero-unit monetary losses marked OK; impossible calculator rates accepted with break-even₹0; enabled viewer/consolidated writes despite API403/400; modules disabled only in UI; settings503 presented as empty; inaccessible toggle state; no explicit default/recalculation contract. Detailed report provides individual reproduction, source lines and acceptance checks.

Evidence directory: `C:\WorkStation\Projects\Python\Casper\audit\browser-audit\`.

- Screenshots: `dashboard-desktop.png`, `dashboard-actions.png`, `fraud-platform-loading.png`, `mobile-navigation.png`, `invoice-synthetic-preview.png` (synthetic unsaved invoice). Each filename is relative to the absolute evidence directory above.
- Service/API reproductions: `isolated_checks.py`, `isolated-checks.json`, `isolated-checks.log`, `current-business-evidence.json`.
- Browser evidence: `audit-*.receipt.json`, `products.json`; report explains superseded/transient receipts.

Earlier architecture A01–A10 confirmed; A02 now has an actual DB failure. S01/S03 and U01/U02/U04 confirmed; S02's update path does not recalculate, broader policy remains undefined. Mobile navigation defect is disproved at the tested390px viewport; selected pricing/dialog/issuer repairs work. Report-error handling improved, settings/analytics error handling still broken. Remaining original UX/security findings are not all independently closed; passing tests establish only their tested assertions.

Validation: selected backend63 passed; frontend111 passed across8 files; frontend lint passed; narrow backend Ruff checks passed. Tests miss the reproduced business/runtime defects. Add targeted identity, overlap, financial definition, scope, probability, zero-unit loss, invoice lifecycle and failure-state regressions before declaring fixes.

Created audit-only helper programs, receipts, report/handoff, five PNGs and synthetic outputs. Test records existed only in an in-memory foreign-key-enforced SQLite database; no persistent test company/database. Existing dirty work was preserved; runtime logs may have appended. Final continuation task was finished successfully; the earlier browser task/session could not be rechecked after runtime state was lost.
