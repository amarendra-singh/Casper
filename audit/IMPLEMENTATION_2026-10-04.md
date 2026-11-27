# Casper audit implementation — 4 October 2026

## Scope and approach

Implemented the security, financial correctness, persistence, deployment and interaction fixes identified in the two audit reports. Preserved the existing uncommitted work. Followed the project's Karpathy principles: stated cost/data assumptions, used existing service and UI patterns, avoided a broad architectural rewrite, and verified observable behavior rather than relying on build success.

After the follow-up authorization, the local database was migrated to `e5f0audit0005` and the 95 invalid platform links were repaired. The rollout was rehearsed on a copy first, with backups of the database and original uploads. No deployment or commit was performed.

## Verification

- Backend: **348 passed**, without warnings; Ruff checks pass.
- Frontend: **111 passed**; production build passes.
- Frontend lint: **0 errors, 0 warnings**. The old warning allowances are cleared; CI rejects every new warning. Fixed braces, unused code, modern label associations and keyboard interactions. Removed the deprecated duplicate label rule and corrected native table-cell false positives while retaining checks on their controls.
- Declared backend production dependencies and the frontend lockfile: dependency scans report no known vulnerabilities at verification time.
- Clean Python environment: production-only requirements install, initial production bootstrap, repeated bootstrap and application import all pass. See `clean-bootstrap-check.json`.
- Migration chain creates the model schema on an empty SQLite database. The local database is now at head; `local-rollout-check.json` records the successful application and unchanged financial snapshots. Migration on a disposable copy of the existing database passes. All 2,658 order observations are retained; 851 older duplicate observations become prior observations. See `migration-copy-check.json`.
- Browser checks on synthetic API fixtures verify mobile navigation/company switching at 390px, pricing percentage/status display, automatic override fields, pricing/invoice dialog Escape and focus restoration, invoice company identity, and a retry message for a synthetic report outage. Writes to real APIs were blocked.
- Regression tests cover delayed autosave acknowledgements, spreadsheet export invocation, destructive Cancel/Enter behavior, autocomplete Tab/read-only behavior, tenant/role guards, batch isolation, historical costs, signed reconciliation, invoice invariants, session revocation/replay, failed replacement rollback, order reuploads and financial history rollback/immutability.
- Docker execution and a real PostgreSQL migration were not run. Cross-platform drivers/configuration are declared, but those environments still need deployment validation.

## Original project findings

| Finding | Implemented behavior |
|---|---|
| 1. Foreign report download | Resolve report within authorized company scope before reading the original file. |
| 2. Foreign fraud backfill | Company scope is required in the service; owning company admin/owner permission is checked. |
| 3. Mixed write roles | Financial/catalog mutations use company membership roles; shared HSN administration requires a platform super administrator. |
| 4. Signup/user enumeration | Public signup gets a platform viewer role and a company owner membership. Global user directory is super administrator only. |
| 5. Foreign references | Service/API validation rejects foreign vendor, category, SKU and platform references. Invalid legacy platform relationships are guarded, and the local legacy references have been repaired as described below. |
| 6. GST as currency | Apply GST as a percentage of the frozen breakeven. |
| 7–8. Purchase costs | Require confirmed matches and positive finite units; update/recalculate every pricing row for the SKU. |
| 9. Historical costs | Prefer frozen cost/target/profit snapshots in report and dashboard calculations. Legacy unknown cost components stay unknown instead of borrowing current values. |
| 10. Report replacement | Stage source files and replace report records in one outer transaction; failures roll back the original report and source. |
| 11. Supplier identity | Company/supplier/reference identity includes a normalized party key when vendor resolution is unavailable. Unknown suppliers no longer share a NULL vendor namespace or learned aliases. |
| 12. Batch failures | Isolate each row with a savepoint, commit the successful batch before acknowledging it. |
| 13. Autosave revisions | A response acknowledges its submitted revision; later edits remain dirty and are saved separately. |
| 14. Bulk undo | Hold bulk edits for explicit save; undo restores the prior rows. |
| 15–16. Deployment secrets | Production seeding requires an explicit password; Docker excludes environment files, databases, originals and audit artifacts. |
| 17. Pricing formulas | Batch/direct pricing share the same calculation and whole-rupee target rounding. |
| 18. Override clearing | Persist manual intent in nullable override fields; clearing removes it and resumes automatic calculation. |
| 19. SKU identity/delete | Send stable server IDs on renames; preserve rows and show an error after failed deletes. |
| 20. Invoices | Atomic per-company/year sequences, company/number uniqueness, finite nonnegative values, payment/status invariants and useful duplicate-number conflicts. |
| 21–22. Reconciliation/fraud | Preserve signed reconciliation adjustments; compare actual settlement with expected per-unit settlement multiplied by units. |
| 23. Consolidation | Consolidate supported reads across authorized companies; reject ambiguous single-company operations explicitly. Carry company/SKU identity in intelligence results. The batch catalog is read-only in All Companies. |
| 24. Runtime configuration | Derive migration URLs from the application URL; declare PDF, spreadsheet and database drivers; support a durable originals directory and console logging. |
| 25. Sessions | Logout/password change revoke prior token versions; refresh tokens rotate and reject replay. New password hashes use Argon2 while existing bcrypt hashes remain verifiable. |

## UX and standards findings

| Finding | Change |
|---|---|
| UX-01 | Destructive dialogs focus Cancel; Enter activates the focused native button. |
| UX-02 | Mobile navigation includes company selection, workspace pages and P&L/fraud links. |
| UX-03 | Spreadsheet exports load the XLSX module explicitly and have a regression test. |
| UX-04 | Autocomplete permits natural Tab navigation, guards read-only input and exposes combobox/listbox semantics. |
| UX-05–06 | Pricing shows GST percentages and correct active status; editing automatic costs preserves automatic intent. |
| UX-07–08 | Distinguish not-found from outages; show load/write/module errors and retry options. Invoice actions prevent duplicate in-flight operations. |
| UX-09 | Ignore stale pricing-selection responses. |
| UX-10–12 | Escape CSV quotes/newlines; use the invoice's owning company for printing; initialize financial dates from local calendar dates. |
| UX-13 | Label targeted financial/grid controls and show invoice line labels on mobile. Corrected remaining linted label associations; keyboard activation and label-to-input focus were checked in the browser. |
| UX-14 | Shared portal dialogs provide focus containment, background isolation, Escape and focus restoration for pricing, supplier/category/tier forms, ad reports, import preview and invoice preview. |
| UX-15–16 | Align module controls/navigation; expose sorting and financial explanations to keyboard/touch. |
| UX-17–18 | Improve muted text contrast and focus visibility; replace exposed fatal stacks with a recovery screen. |

Added CI, ESLint with zero warning allowances, scoped formatting and Ruff checks. Aligned account/registration password validation with the backend minimum of eight characters and fixed relative SQLite URL resolution so launching from another directory cannot create a second empty database. Replaced deprecated UTC timestamp calls while preserving the existing naive UTC database convention.

## Design choices and missing flows

- **Base costs:** catalog reads/writes consistently use the lowest platform ID, then pricing ID, including when that platform is deactivated. The API carries the base return charge to the grid. Dedicated Pricing remains per-platform. Supplier cost application updates all rows. A new SKU cannot acknowledge pricing without a platform.
- **Financial history:** committed ORM changes to pricing, platform configurations, supplier bills/lines, invoices/lines and ledger records retain company, actor, source ID and before/after values. They roll back with failed transactions and are available to company administrators in Settings. Existing history cannot be reconstructed retroactively. Direct SQL/external database writes need their own controls; this is not a database-level tamper-proof ledger.
- **Ingestion:** optional fraud errors are logged, stored on the report and shown with a retry instruction. Successful backfill clears the warning. Identified standalone orders update the same order/SKU; legacy duplicate observations are preserved but excluded from current counts. Rows lacking external order identity cannot be deduplicated reliably.
- **Inventory:** remains a product catalog. Stock movements, reservations, valuation and on-hand balances need explicit business rules before adding accounting logic.

## Existing-data review and rollout

**Repaired all 95 cross-company TestPlatform references.** They belonged to company 8 and pointed to company 1’s platform 1. Created company 8’s platform 26 as an exact settings copy, then changed only the owning references. Preserved pricing IDs, every stored financial value, report links and historical snapshots. All 95 changes have transactional financial history. `LEGACY_PRICING_REVIEW.json` now records completed mappings.

The local rollout passes SQLite integrity and foreign-key checks, with zero cross-company pricing/platform links. Derived SKU, return-reason, state and actor intelligence and applicable unresolved alerts were refreshed from the existing current order observations. All 2,658 observations remain stored; 851 prior observations are excluded from current counts.

Backup: `backend/backups/audit-20261004-115148/` contains `casper.before.db`, `original-uploads.zip` and the rehearsal database. Backups are excluded from Git and Docker. The receipt is `local-rollout-check.json`. Read-only calls through the actual app against the upgraded local database return 200 for health, catalog, platforms and change history; all 95 catalog rows have valid base references and all 95 repairs are recorded. See `local-api-check.json`.

Browser verification with synthetic APIs passed Settings Enter activation, Settings label focus, mobile Space activation, mobile autocomplete label focus and dialog Escape/focus restoration, with no page errors.

The checked SKU/vendor/category and invoice/purchase-line/SKU relationships had zero cross-company mismatches in the copied database. Composite tenant foreign keys would provide stronger storage-level enforcement after historical inconsistencies are repaired.

The local rollout above is complete. For a different deployment/database:

1. Back up the database and original report files.
2. Apply Alembic `upgrade head` to the intended database. New migrations are `d4e0audit0004` and `e5f0audit0005`; they have been applied to the local database and verified on disposable databases.
3. Review any foreign platform links. The administrative repair script defaults to a read-only preview and refuses an ambiguous existing platform name; use explicit company/source IDs after review.
4. Review legacy overrides: the migration preserves existing calculated amounts as explicit overrides, since historical manual intent cannot be inferred. Clear the override to choose Automatic.
5. Refresh cached intelligence after order deduplication with `python -m scripts.refresh_fraud_after_deduplication`. This has already been completed locally.
6. Set a unique production seed password and point `UPLOADS_DIR` at durable storage. Validate PostgreSQL/container behavior before release.

The original evidence suite deliberately asserts defects and is retained as historical evidence. Run the normal backend/frontend suites for the corrected behavior.
