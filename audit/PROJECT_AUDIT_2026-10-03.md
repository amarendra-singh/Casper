# Casper project audit — 3 October 2026

## Assessment

Casper has useful service boundaries, pure calculation functions, a migration guard, and a sizeable passing test suite. Its principal weakness is that these safeguards are applied inconsistently across routes and write paths. Tenant isolation, company authorization, historical cost accounting, and persistence feedback need attention before this is dependable as a financial application for multiple companies.

Reviewed the current working tree, including existing uncommitted changes. No application code was changed. Added this report and isolated evidence tests. No live company records were edited.

Verification:

- Existing backend suite: **309 passed**.
- Existing frontend suite: **103 passed**.
- Frontend production build: **passed**.
- New audit evidence suite: **16 passed**. These assertions deliberately demonstrate existing defects; passing them means the defect was reproduced, not fixed.
- Initial sandbox execution blocked frontend temporary-file operations and stalled backend async execution. Both suites completed outside the sandbox.
- HTTP reproductions ran through the real FastAPI ASGI app with authentication and an overridden database dependency. Data lived in a foreign-key-enforced in-memory SQLite database; uploaded-file fixtures used temporary directories.
- No live browser walkthrough, deployed-environment test, clean Docker build, PostgreSQL execution, load test, or external dependency vulnerability scan was performed. Frontend interaction findings below come from code tracing, not observed browser input.

Severity: **P0** = cross-tenant access requiring immediate attention; **P1** = authorization, data loss, financial correctness, or production exposure; **P2** = important reliability and workflow defects.

## Priority findings

### 1. P0 — Original report downloads bypass report ownership

**Source:** `backend/app/routes/pnl.py:596–613`.

The dependency verifies membership in the selected company, but the handler only looks for a file named after the supplied report ID. It never queries the report or verifies its company. A member of company A can request company B's sequential report ID and receive its original export, potentially including order/customer data.

**Evidence:** an authenticated request returned HTTP 200 and the synthetic file contents even though the report ID did not exist in the caller's database. **Fix:** load the report within the caller's authorized company scope before resolving its file; use the same ownership check as report detail.

### 2. P0 — Fraud backfill can rewrite another company's report data

**Source:** `backend/app/routes/fraud.py:181–194`; `backend/app/services/fraud.py:1547–1609`.

The route obtains an active company but does not pass it to the service. The service loads a report by ID alone, then deletes its events and rebuilds fraud scores and profiles under the report's own company. Membership in any company therefore permits reprocessing a foreign report when its original file is available.

**Evidence:** company A's member successfully reprocessed a synthetic company B report through HTTP. Extraction and derived-score functions were replaced with safe stubs; report lookup, ownership bypass, and service invocation remained real. **Fix:** fetch the report within authorized scope, require an admin/owner role in its owning company, and make company scope a required service argument.

### 3. P1 — Write authorization mixes global roles and company roles

**Source:** `backend/app/routes/entries.py:12–20`; `backend/app/routes/billing.py:70–80,157–180,223–230`; `backend/app/routes/ledger.py:83–90`; `backend/app/core/dependencies.py:174–235`.

Batch SKU writes and purchase-bill cost/link writes allow `require_any`, so viewers can change financial data. Other create routes use a global admin guard plus membership, allowing a global admin who is only a viewer in the target company to create records there. Conversely, a company owner whose global role is viewer can be blocked from legitimate creates. Existing patch/delete routes already demonstrate the correct per-company pattern.

**Evidence:** a user holding only company-viewer membership changed a product cost from 100 to 999 through the batch endpoint. **Fix:** use company-role guards for every create/write and record-owner company guards for existing records; reserve global roles for platform administration. Test the complete route/role matrix, not just the dependency helper.

### 4. P1 — Public signup grants access to the global user directory

**Source:** `backend/app/routes/auth.py:79–91`; `backend/app/routes/users.py:18–24`.

Self-registration grants global `admin`. Listing users allows global admins and selects all users without membership filtering. A newly registered company owner can therefore enumerate names, emails, roles, and account state for unrelated companies.

**Evidence:** the admin user for company A received company B's email through HTTP. **Fix:** restrict the platform directory to super administrators; company teams should use membership-scoped endpoints.

### 5. P1 — Foreign keys validate existence, not tenant ownership

**Source:** `backend/app/routes/skus.py:113–116,243–287`; `backend/app/services/pricing.py:22–29,127`; `backend/app/services/entries.py:97–125,227–266`; `backend/app/services/purchase.py:240`; `backend/app/routes/billing.py:239–240`.

Several routes accept vendor/category/SKU/platform IDs and attach them to a company-scoped record without checking that the referenced record belongs to that company. Independent foreign keys permit such inconsistent relationships. Pricing resolution also reads platforms by bare ID. This can expose foreign metadata through relationships and build costs or fraud events from the wrong company.

**Evidence:** company A created a SKU referencing company B's vendor with foreign-key enforcement enabled. A separate HTTP reproduction showed the FK orders upload for company B stored events against company A's Flipkart platform, because `pnl.py:673` selects the first global Flipkart. **Fix:** scope every referenced-ID lookup, including upload platform selection. Consider composite tenant foreign keys as a database safeguard after repairing existing inconsistent rows.

### 6. P1 — GST percentage is added as currency in P&L rows

**Source:** `backend/app/services/pnl_statement.py:542`.

`breakeven_gst = breakeven + cb['gst']` adds the percentage number directly to the cost. The model and snapshot store a rate. ₹200 at 18% becomes ₹218 instead of ₹236, overstating the after-GST profit and margin. This disagrees with the rate calculation in report detail.

**Evidence:** reproduced through `compute_pnl_rows` using a frozen synthetic row. **Fix:** apply the rate consistently as `breakeven * (1 + gst / 100)` and test values where the cost is not 100, which otherwise masks the bug.

### 7. P1 — Applying purchase cost leaves derived pricing stale

**Source:** `backend/app/services/purchase.py:268–299`.

`apply_cost` writes only `pricing.price`. Breakeven, damage reserve, profit amount, and settlement targets retain their old values. It also selects the first pricing row without a defined ordering or policy, although multiple platform rows may exist.

**Evidence:** applying 200 changed a product cost previously at 100, while breakeven remained 100 and settlement remained 120. **Fix:** route cost changes through one pricing mutation service that recalculates the full stack; define whether product cost is shared across platforms or belongs to one explicitly selected row.

### 8. P1 — Unconfirmed suggested matches can drive cost changes

**Source:** `backend/app/services/purchase.py:112–123,268–299`.

Fuzzy matching assigns a `sku_id` with `match_source='suggested'`. `apply_cost` accepts any populated SKU ID and never requires a confirmed alias/manual match. The UI or a direct API caller can therefore apply a guessed bill line to financial pricing, despite the service's stated trust rule. Pack multiples also lack positive finite validation.

**Evidence:** the stale-cost reproduction applied an explicitly unconfirmed suggested line successfully. **Fix:** require a confirmed match and a positive finite pack multiplier before updating costs; validate the linked SKU's company.

### 9. P1 — Historical profitability uses inconsistent frozen/live cost bases

**Source:** `backend/app/routes/pnl.py:430–449`; `backend/app/services/profitability.py:131–155`; `backend/app/services/pnl_statement.py:277–306,570–571`.

The statement engine prefers upload snapshots. Report detail and dashboard SKU intelligence use current pricing instead. Editing today's costs therefore changes historical dashboard/report-detail profitability while the statement remains frozen. Report detail also combines live expected settlement with stored variance calculated against the old expectation. The rows engine mixes frozen breakeven with live profit targets.

**Evidence:** a frozen cost of 100 remained 100 in the statement cost resolver but appeared as 200 in report detail after pricing changed. **Fix:** use one shared cost-basis resolver for historical metrics, retain snapshot targets consistently, and offer an explicitly labelled current-cost scenario separately if needed.

### 10. P1 — Failed force replacement can permanently delete the old report

**Source:** `backend/app/routes/pnl.py:137–165`; `backend/app/services/pnl.py:1033–1047,1082–1089`.

Force replacement removes the old file and calls `delete_report`, which commits, before the new workbook is fully parsed. If parsing, database storage, fraud processing, or the subsequent file write fails, the old report is already gone. New report storage also commits before the original file is saved, permitting a failed response with a persisted report and missing source file.

**Evidence:** traced committed transaction boundaries; no destructive replacement was attempted on live records. **Fix:** parse and validate first, replace database records within one outer transaction, stage the source file, and coordinate file finalization with explicit failure recovery.

### 11. P1 — Unregistered suppliers sharing a reference overwrite each other

**Source:** `backend/app/services/purchase.py:76–99`; `backend/app/models/purchase.py:35–38`.

Bill identity uses company/vendor/reference. When supplier detection finds no registered vendor, `vendor_id` is NULL. Different suppliers with the same bill reference then share the lookup key. The second upload replaces the first bill's total and lines while keeping its original party name. Nullable vendor keys also weaken database uniqueness for concurrent uploads.

**Evidence:** Supplier B's reference 1 updated Supplier A's reference 1; the surviving record showed Supplier A with Supplier B's amount. **Fix:** resolve a stable supplier identity before persistence, or include a normalized supplier identity in the key. Do not let an unknown supplier collapse into one shared NULL namespace.

### 12. P1 — Batch errors leave the transaction unusable

**Source:** `backend/app/services/entries.py:275–305,309–342`; `backend/app/core/database.py:53–62`.

`upsert_row` catches database exceptions and returns an error, but does not roll back or use a savepoint. A failed flush puts the session into a failed transaction state. Earlier rows are still reported as saved even though the final dependency commit cannot succeed; later rows can also fail due to the poisoned session rather than their input.

**Evidence:** a valid row followed by an invalid vendor reference produced one saved result and one error, then `PendingRollbackError` on commit. **Fix:** choose atomic batch semantics or isolate each row with `begin_nested`; report saved rows only after successful commit.

### 13. P1 — Autosave acknowledges newer edits that were never sent

**Source:** `frontend/src/pages/SKUs.jsx:409–413,522–604`.

While request A is saving, the user can edit the same row, creating newer state B. When A finishes, the response handler finds the row by local ID/SKU and sets its current state to SAVED without checking a revision. B can lose its dirty flag and never get sent. Overlapping saves can also complete out of order.

**Evidence:** state-transition code tracing; no real-browser race reproduction. **Fix:** attach a revision to each sent snapshot, acknowledge only that revision, serialize writes per row, and retain DIRTY when the row has newer edits. Add a delayed-response integration test.

### 14. P1 — Bulk edit's advertised manual-save/undo behavior contradicts autosave

**Source:** `frontend/src/pages/SKUs.jsx:441–464,617–626,1876–1889`.

Bulk category assignment marks rows DIRTY, so the normal two-second autosave persists them. The dialog promises nothing is written until Save All, and the undo banner continues saying “not saved yet.” Undo restores the old SAVED status from its snapshot, so undoing after autosave changes local state without persisting the reversal.

**Evidence:** code tracing of bulk snapshot, autosave, and undo. **Fix:** either hold bulk edits in a draft excluded from autosave, or implement undo as a persisted reverse mutation and describe autosave accurately.

### 15. P1 — Default production super-admin password is predictable

**Source:** `backend/scripts/bootstrap_db.py:26–27,54–63`; `Dockerfile:34`.

A fresh deployment automatically seeds a super administrator using a publicly documented default password unless operators supply seed overrides. The app becomes reachable before any enforced password change, leaving a deployment-time takeover window.

**Evidence:** bootstrap/Docker code review; no login against a deployed service. **Fix:** require a seed secret in production or a one-time setup process; do not silently fall back to a known production administrator password.

### 16. P1 — Docker build includes the local backend environment file

**Source:** `.dockerignore`; `Dockerfile:28`.

`backend/.env` exists locally, the ignore file does not exclude environment files, and `COPY backend/ ./` includes it in the runtime image. This can embed local secrets and fallback configuration into image layers or deployments. Contents were not read or printed for this audit.

**Evidence:** file existence and build-context rules; an image was not built. **Fix:** exclude `.env` and environment-file variants while permitting examples, inject runtime configuration, and assess secret rotation if an image containing those values has already been distributed.

### 17. P2 — Two pricing engines calculate different settlement targets

**Source:** `backend/app/services/pricing.py:84–91`; `backend/app/services/entries.py:79–83`.

Direct pricing rounds pre-GST settlement to a whole rupee; batch pricing retains paise. The same input saved on different screens produces different persisted outputs, which subsequently affect reconciliation and snapshots.

**Evidence:** a cost of 90.50, 20% profit, and 5% GST produced 114.45 through direct pricing and 114.03 through batch pricing. **Fix:** consolidate calculations and adopt one explicit rounding policy.

### 18. P2 — Clearing overrides does not clear stored overrides

**Source:** `frontend/src/pages/SKUs.jsx:546–564`; `backend/app/services/entries.py:236–240`.

The frontend omits blank aliases/AD overrides. The service skips an all-empty override instead of clearing an existing record. Removing an alias or returning an AD override to inheritance appears effective locally but the old value returns after reload and can still influence matching.

**Evidence:** an explicit empty override left stored AD 10% and the old alias intact. **Fix:** distinguish an omitted patch from an explicit clear; delete/reset an existing config on clear.

### 19. P2 — SKU identity and deletion feedback are unreliable

**Source:** `frontend/src/pages/SKUs.jsx:482–487,568,590–598,1111`; `backend/app/services/entries.py:97`.

Saving a new row never copies the returned `sku_id` into `skuId`, so deleting that row later only removes it locally. Editing an existing SKU code upserts by its new name instead of renaming by stable ID, leaving the old SKU behind or modifying a different existing SKU. Delete failures are logged but the row is still removed locally, creating false success.

**Evidence:** code tracing. **Fix:** reconcile returned IDs, separate create/update identity from editable SKU code, and remove rows only after a successful delete. Preserve failed rows with a visible error.

### 20. P2 — Invoice numbering and payment state permit inconsistent records

**Source:** `backend/app/services/billing.py:13–18,47,78–85`; `backend/app/models/billing.py:21`; `backend/app/schemas/billing.py:12–16,46–59`.

Number generation uses row count, so deleting an earlier invoice reuses an existing number; concurrent creates can also collide. There is no company/number uniqueness constraint. Separately, paid status is accepted independently of amount paid, and the summary excludes paid records from outstanding even when the balance is positive. The update schema lacks create's status validation; the nominal nonnegative validator only rounds values and permits negatives.

**Evidence:** surviving invoice numbers 1 and 3 generated number 3 again; a paid invoice with total 100 and payment 0 produced outstanding 0. **Fix:** allocate numbers atomically with company-scoped uniqueness, derive or validate payment state from balances, and enforce finite nonnegative amounts and valid update statuses.

### 21. P2 — P&L statement fails to reconcile when identified fees exceed the gap

**Source:** `backend/app/services/pnl_statement.py:96–103,139–151`.

When identified fees exceed net sales minus payout, the engine removes the negative balancing adjustment and sets total fees to the identified amount without changing the authoritative payout. Displayed lines no longer add up. Rewards or reimbursement scenarios need an explicit adjustment rather than discarding the discrepancy.

**Evidence:** sales 100, commission 10, and payout 95 display 100 minus 10 followed by payout 95. **Fix:** keep signed balancing adjustments visible and flag unexplained differences; test both positive and negative reconciliation gaps.

### 22. P2 — Fraud settlement gap percentage mixes per-unit and total values

**Source:** `backend/app/services/fraud.py:1626–1651`; `backend/app/services/pnl.py:934–938`.

`casper_expected_bs` is a per-unit target, while actual payout and stored variance are totals. The fraud summary sums per-unit expectations without multiplying by net units, then divides a total gap by that sum to classify severity. For ten units at target 100 and payout 900, the true gap is 100 against expected 1,000, but this denominator yields 100% instead of 10%.

**Evidence:** dimensional analysis of storage and aggregation; not a standalone DB reproduction. **Fix:** sum expected settlement times net units and keep the matched population consistent across all totals.

### 23. P2 — “All Companies” silently uses the first company in several screens

**Source:** `backend/app/core/dependencies.py:109–119`; `backend/app/routes/platforms.py:17–29`; `backend/app/routes/pnl.py:246–267,381–389`; `frontend/src/pages/Pricing.jsx:88–90,136–139`.

Single-company GET dependencies silently fall back to the first company for an `all` header. Other endpoints correctly consolidate. Consequently, the active label can say All Companies while P&L lists/settings/platform options show one company's data. Pricing combines all companies' SKUs with the first company's platforms, then targets the selected SKU's company on create. With the current missing foreign-reference check this can create a wrong-company pricing relation.

**Evidence:** route/client code tracing. **Fix:** define explicit consolidated behavior for each read; return owning-company metadata; fetch selectable platforms from the chosen SKU's company. Where consolidation is unsupported, require a company instead of silently substituting one.

### 24. P2 — Deployment dependency and database configuration gaps

**Source:** `backend/requirements.txt`; `backend/app/routes/billing.py:108`; `backend/app/services/shopdeck.py:381`; `backend/app/core/config.py:21–22`; `backend/alembic/env.py:15–16`; `RAILWAY.md:36–40`.

PDF parsing imports `pypdf`, which is absent from declared production requirements. A clean image cannot reliably execute supplier PDF parsing or ShopDeck cashflow parsing. The documented PostgreSQL setup configures only `DATABASE_URL`, whereas bootstrap migrations independently use `DATABASE_URL_SYNC`, defaulting to SQLite. Following those instructions can migrate SQLite and then start the app against unmigrated PostgreSQL. The synchronous PostgreSQL driver is also undeclared.

**Evidence:** dependency/configuration tracing; clean installation and PostgreSQL were not run. **Fix:** declare runtime PDF dependencies, use one database configuration source with a supported migration driver, and test fresh-container bootstrap. Persist original uploads separately: the `/data` database volume described in the guide does not cover the current `/app/uploads/pnl` source-file path.

### 25. P2 — Logout/password change do not invalidate issued sessions

**Source:** `backend/app/routes/auth.py:107–132,140–162`; `backend/app/core/security.py:29–49`.

Logout only acknowledges the request. Password change updates the hash, but neither action revokes issued access or refresh tokens. A copied refresh token can continue minting access tokens until its configured expiry even after a password change. Refresh also issues tokens without tracking a session or consuming the old refresh token.

**Evidence:** token/auth control-flow review, not a deployed-session test. **Fix:** add a tracked session or token-version mechanism and revoke/rotate refresh sessions when changing credentials or logging out.

## Design and missing-flow assessment

- **Product cost ownership is ambiguous.** The grid writes one base pricing row attached to the first active platform, the dedicated Pricing screen supports multiple platform rows, `get_all_entries` selects the highest-ID pricing row, and purchase-cost application selects the first row. These screens can read and write different cost records for the same SKU. Establish a shared product cost basis plus platform-specific settings, or consistently expose platform-specific economics everywhere.
- **Inventory is a catalog view.** The Inventory page wraps the SKU grid with different columns. There is no demonstrated stock movement, receipt, return-to-stock, adjustment, reservation, opening balance, or on-hand model. If stock accounting is intended, this is missing business logic, not merely a missing column.
- **Auditability is weak for mutable money records.** Pricing, bills, invoices, and ledger rows can be updated/deleted without an append-only business change history. Request logs do not explain old/new amounts or reversal reasons. Prioritize actor, timestamp, before/after, and source links on financial changes.
- **Ingestion needs explicit lifecycle and retry semantics.** Optional fraud failures are swallowed, order uploads insert events without an external-order uniqueness key, and recomputation can leave derived data stale. Expose processing state and failure reasons, make reuploads idempotent, and isolate optional recomputation from the core transaction.
- **Scope and identity must be part of service contracts.** Required `company_id` arguments are helpful but insufficient when a route fetches a foreign ID first or uses unscoped references. Reject mismatched relationships at the service boundary and enforce tenant-aware invariants at storage level.
- **Frontend persistence needs one state machine.** Revision-aware autosave, explicit draft/dirty/saving/error states, navigation handling, and server ID reconciliation should be shared across editing flows. A visual saved badge must represent a committed revision.
- **Cross-company SKU intelligence merges names.** `build_sku_intelligence` groups by SKU code alone and retains the first target percentage. In consolidated mode independent same-code SKUs can become one item and show an arbitrary target. Carry company/SKU identity and choose explicitly whether the product view is consolidated or company-separated.
- **Coverage is strongest for pure math, weakest at boundaries.** Passing helper tests do not cover authenticated routes, role combinations, ownership of referenced objects, failed writes, delayed saves, or clean deployment. There is no test workflow in the inspected `.github/workflows` directory; its only workflow is keepalive.

## Recommended implementation order

1. Close download/backfill ownership bypasses, company-role gaps, global user enumeration, and foreign-reference writes. Add negative HTTP tests with two companies and mixed roles.
2. Fix GST, cost recalculation, snapshot consistency, unit-aware reconciliation, and the shared pricing formula. Verify financial invariants across every view.
3. Make report replacement and batch persistence transactional; repair supplier identity and invoice numbering/state invariants.
4. Fix frontend save revisions, bulk undo, server IDs, failed-delete feedback, and scope-dependent choices. Verify with delayed-response tests and a real browser walkthrough on synthetic data.
5. Validate clean production bootstrap, dependencies, secret exclusion, durable original files, and session revocation.

Inspect existing records for cross-company references, duplicate invoice numbers, merged unknown-supplier bills, and prices whose derived totals are stale **before** adding stronger constraints. Use a backed-up copy for any repair dry run.

## Reproduce the evidence

From `backend/`:

```powershell
$env:SECRET_KEY = 'audit-test-key'
.\env\Scripts\python.exe -m pytest ..\audit\test_audit_evidence.py -q
```

The evidence suite documents the current buggy behavior. When fixing a finding, convert the relevant assertion to the intended secure/correct result and move it into the normal regression suite.
