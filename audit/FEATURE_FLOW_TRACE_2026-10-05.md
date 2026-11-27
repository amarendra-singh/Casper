# Casper feature flow trace

Scope: every exposed route family, the main UI workflows, data ownership, side effects, refresh, failure/retry, and deletion. Source version: current working tree on 2026-10-05; no Git revision claimed because the checkout contains substantial uncommitted work.

Evidence levels: **source** means traced implementation, **copy probe** means executed on a disposable copy of real data, **pending** means an acceptance check still required. Source tracing is not a successful browser walkthrough.

Companion files:
- FEATURE_ENDPOINT_INDEX_2026-10-05.md: 116 endpoints, exact handler file and line.
- FEATURE_ENDPOINT_INVENTORY_2026-10-05.json: route methods, paths, handlers, dependencies and static calls.
- FEATURE_FLOW_PROBES_2026-10-05.json: executable integration results.
- FEATURE_CONNECTION_EVIDENCE_2026-10-05.json: read-only PKTY database evidence.
- FEATURE_CONNECTION_AUDIT_2026-10-05.md: prioritised cross-feature findings.

All endpoint names below omit /api/v1. No production code or live database records were changed during this trace. The probe uses a SQLite backup into a temporary directory, then deletes that copy after engine disposal.

## 1. Login, session restore, refresh, logout, password change

**Trace:** Login -> AuthContext.login -> client.login -> POST /auth/login -> password/active-user checks -> access and refresh tokens plus company list -> localStorage -> AuthContext user -> CompanyContext.

Reload -> access token present -> GET /auth/me -> protected route. A burst of 401 responses shares one refresh promise; POST /auth/refresh rotates the refresh token, blacklists its old identifier and retries failed requests. A network failure preserves tokens; rejected refresh clears session. Logout/password change increments token_version, invalidating all devices rather than just the current session.

**Boundary:** browser localStorage holds both tokens; this is not a cookie session. No bank/financial write occurs. UI restoration and company loading are distinct asynchronous stages.

**Checks:** expired-token burst, replay rejection, revoked member, offline restore, logout while a request is pending. Existing auth tests cover parts; browser timing checks remain pending.

**Source:** context/AuthContext.jsx, api/client.js, routes/auth.py, core/dependencies.py, models/token.py.

## 2. Registration and company provisioning

**Trace:** registration -> user creation -> company creation -> owner membership -> enabled CompanyModule rows -> standard platform records -> tokens -> first company selected. Company creation from the switcher adds the company to local context; selecting it is a separate step.

**Boundary:** seeded marketplace defaults are initial settings, not verified seller-specific fees. A new company does not gain inventory, purchase cost history or existing-company SKUs.

**Checks:** duplicate registration, rollback on provisioning failure, four company-owned standard platforms, no foreign-company references. Source traced; complete first-user browser journey pending.

**Source:** routes/auth.py, services/company.py:create_company/seed_platforms, CompanyContext.jsx.

## 3. Company selection, archive, restore and group mode

**Trace:** switcher -> store active_company_id -> window.location.assign('/') -> fresh screen requests carry X-Company-Id. Backend scope resolves memberships. Group reads use eligible company IDs; new writes need a concrete company, while ID-based edits validate the record's own company role.

Archive/leave -> membership/company state -> active company removed from storage and app reloads when necessary. Restore -> refresh company list. Company context supplies module switches and role separately from login identity.

**Gap:** switching companies intentionally discards the current page path. This differs from the repaired Ledger refresh behaviour. Module preferences are UI gates, not API module entitlements.

**Checks:** two users on one browser, archived active company, All Companies create with explicit destination, same-named products across companies. No claim of fresh exhaustive permission testing.

**Source:** CompanyContext.jsx, routes/companies.py, services/company.py, dependencies.py, App.jsx:RequireModule.

## 4. Team membership versus global users

**Trace:** company member form -> company member endpoints -> owner check -> reuse existing user by email or create user with temporary password -> membership and company role. Role changes/removal mutate membership. Users page uses /users endpoints and global user administration; these are different permissions.

**Boundary:** adding an existing user is a direct membership operation, not a tracked invitation acceptance/email workflow. Company permissions must not be inferred from global role displayed elsewhere.

**Checks:** last-owner protection, existing email, member removal with an active token, global-admin vs company-owner cases. Source paths indexed; full role matrix still pending.

## 5. Vendors and supplier identity

**Trace:** Vendors or AddVendorModal -> /vendors -> company-scoped name/short code -> catalogue references vendor_id. Bill import separately normalises supplier names and checks explicit VendorNameAlias -> PurchaseBill.vendor_id.

**Boundary:** vendor short code, vendor product code and internal SKU are different identifiers. Renaming the vendor does not rename existing SKU strings. JDS alias is durable but has no user-facing alias maintenance screen. Hard deletion is constrained by dependencies; deactivation is preferable for used vendors.

**Checks:** same supplier in another company, ambiguous normalised names, alias rename, imported named supplier later registered, re-import avoiding duplicate expenses. The last path has existing backend regressions.

**Source:** routes/vendors.py, services/vendor_identity.py, models/vendor.py, services/purchase.py.

## 6. Categories and HSN

**Trace:** reference CRUD/search -> company-scoped records -> SKU category_id/hsn_code_id -> grid display and entry payload. Entry writes validate reference ownership. HSN selection and a stored pricing GST value are distinct state.

**Boundary:** editing a tax/reference record does not automatically recompute every existing price/report. Deleting referenced metadata must handle integrity constraints visibly.

**Checks:** referenced delete, inactive reference, company isolation, tax metadata change versus existing pricing. Source reviewed; full CRUD UI pending.

## 7. Platform settings and tiers

**Trace:** Settings -> /platforms and tier actions -> company platform defaults -> pricing resolver/platform calculations -> entry grid and dedicated pricing. P&L upload selects a company-owned platform and parser.

**Gap:** saving defaults changes their source, but does not recalculate every existing SkuPricing row. A platform config pointing to canonical pricing is different from a dedicated pricing row on that platform.

**Checks:** deactivation with saved prices, duplicate platform names, referenced delete, tier boundaries, changed return fee impact. Existing platform-delete regression is not full tier verification.

## 8. Miscellaneous costs and global defaults

**Trace:** /misc-items CRUD and /settings/{key} -> stored defaults -> pricing input resolution on later save. Explicit overrides take precedence. Financial snapshots retain earlier costs.

**Gap:** no propagation preview/job or default-version marker. Two products saved at different times can use different effective defaults without an obvious explanation.

**Checks:** zero vs omitted override, deactivate misc cost, change damage percent, recalculate selected rows without rewriting snapshots.

## 9. SKU catalogue: create, edit, delete

**Trace:** /skus POST creates identity only; /entries/upsert-batch can create identity plus pricing. Entry upsert with sku_id updates that identity; otherwise exact company SKU code determines reuse. SKU code normalisation trims ends and uppercases; it does not remove internal spaces or reconcile arbitrary seller titles.

**Deletion:** /skus/{id} performs a hard delete. Pricing relationship cascades; PnlSkuRow references pricing without an on-delete policy. A SKU used by priced reports may encounter integrity errors. This is a source-identified deletion risk, not a reproduced live deletion.

**Checks:** duplicate code, internal spaces, rename after uploads, deactivate/reactivate, priced-report delete, linked-bill delete. Do not destructive-test live products.

## 10. Unit Economics grid and autosave

**Trace:** grid loads getEntries and reference data -> local rows/drafts -> debounce (~2 seconds) -> upsertBatch -> per-row savepoint -> SKU identity -> resolved costs -> canonical SkuPricing -> platform configs -> saved/error result per row -> UI reconciles current drafts. Pending changes use beforeunload protection.

**Boundary:** a row needs SKU and price to autosave. Partial batches can succeed; a failed row must retain its draft. Canonical pricing is the lowest platform ID/pricing ID already present, not necessarily the marketplace being examined elsewhere.

**Gap:** saving this grid does not rematch prior unpriced P&L rows. Hidden SKU '+ Add' prepares a draft; removing it from the local hidden list is not proof it was costed and connected.

**Checks:** edit during save, partial failure, leave before debounce, canonical row on inactive platform, repeated import, explicit override preservation.

**Source:** pages/SKUs.jsx, routes/entries.py, services/entries.py:upsert_row/upsert_batch/get_all_entries.

## 11. Dedicated pricing and calculator

**Trace:** Pricing selects SKU -> fetch per-platform pricing -> create/update/delete -> validate references -> resolve defaults -> calculate cost stack -> save. Calculator performs local scenarios without establishing bill or report links.

**Copy probe:** creating Flipkart pricing for PKTY succeeds, but report row 168 stays unmatched until rematch is explicitly invoked.

**Checks:** two platforms for one product, missing pricing, zero overrides, positive finite inputs, whether delete is blocked by reports. Calculator output must not be presented as actual realised profit.

## 12. Marketplace aliases

**Trace:** grid platform alias -> EntryRowInput.platform_overrides -> SkuPlatformConfig -> P&L lookup. Lookup first uses internal SKU codes for the report platform, then lets explicit platform aliases override names.

**Gap:** alias collision detection is not present in this lookup; dictionary assignment can replace another candidate. Supplier item aliases do not participate here. The missing-cost panel is not a general link-to-existing-product alias editor.

**Checks:** same alias on two internal products, alias identical to another product's internal code, alias changed after upload, alias on a different company/platform. Collision behaviour needs a dedicated reproduction before a repair.

## 13. Inventory

**Trace:** Product/Inventory -> same SKUs component with different visible columns -> same entries API and catalogue/pricing records.

**Missing transitions:** purchase receipt, sale dispatch, returned stock, damage/write-off, transfer and on-hand reconciliation. No stock movement model found. 'Inventory' cannot currently establish stock availability or inventory valuation.

## 14. Supplier statement import and re-import

**Trace:** Ledger / Bill Discrepancies -> CSV/PDF multipart -> parser/detect_supplier -> resolve vendor -> save_bills -> upsert by company + supplier_key + reference -> replace parsed lines preserving confirmed mappings -> post/update linked inventory expense -> stored bill response -> refresh Ledger.

**Boundary:** purchase statements and marketplace sales lists do not inherently share transaction identity. Unsupported payment/credit rows are skipped and disclosed. Generated ledger total comes from the bill total, not an inferred SKU cost.

**Checks:** overlapping statements, corrected rate/quantity, duplicate ref across suppliers, supplier alias later registered, parser error, multiline invoice, ignored transactions, total/line discrepancy.

## 15. Bill matching, clearing and saved aliases

**Trace:** SmartCell selection + explicit pack -> link endpoint -> validate tenant SKU -> manual match -> VendorItemAlias -> rematch pending same-supplier bill lines -> update ledger SKU only if the complete bill resolves to one SKU -> refresh.

Clear match -> unlink line and remove remembered alias for that item; it is not intended to rewrite every historically confirmed line. Suggestions remain unconfirmed. Candidate generation currently searches company SKUs without vendor restriction.

**Checks:** repeated item across bills, supplier collision, pending pack edit, clear then reload, multi-SKU bill, inactive mapped SKU, no negative/nonfinite conversion.

## 16. Create SKU from bill and apply cost

**Trace:** Create SKU option -> modal -> identity POST -> line link -> remembered alias. If link fails, modal retains created ID for retry. Description copies bill item text; vendor_id comes from bill. Pricing is deliberately deferred in current implementation.

Apply cost -> confirmed rate / pack -> all existing SKU pricing rows -> recalculate each -> commit. It does not create first pricing, rematch reports or alter frozen snapshots.

**Copy probe:** PKTY apply-cost returns 'no pricing row yet'. The UI disables applying when cost_diff is null, so the user cannot finish setup from the comparison.

**Checks:** create fails, create succeeds/link fails, retry after closing modal, bill has no registered vendor, varying purchase costs, per-platform propagation scope.

## 17. Ledger manual entries and reports

**Trace:** filters -> list/summary endpoints -> company/dates/direction/category -> totals. Manual create/edit/delete validates ownership and references. Generated purchase entries are protected from independent edit/delete. SKU is optional; supplier can be free text.

**Navigation:** section now lives in URL tab parameter. Page refresh restores section; current date/direction filter state is component state and not equivalent to durable tab state.

**Gap:** manual expenses do not feed marketplace P&L. Bill totals represent purchase expenses, not a stock valuation or invoice settlement ledger. Do not merge both without an accounting inclusion policy.

## 18. Customer invoices and payments

**Trace:** Billing -> invoice CRUD -> company-scoped number allocation -> line totals/tax/balance -> statuses -> billing summary. Drafts are excluded from invoiced/outstanding totals; issued/paid invoices restrict rewriting. Allowed cumulative payment update changes amount_paid/status.

**Gap:** no payment allocation record/ledger receipt or stock movement is generated. Payment state is not bank reconciliation. Invoice quantities do not decrement inventory.

**Checks:** duplicate number, draft->sent->partial->paid, overdue derivation, cancelled invoice, paid delete/rewrite, failed write rollback. Payment reversal/credit-note lifecycle remains incomplete.

## 19. Marketplace report upload / replace

**Trace:** platform + dates + file -> duplicate-period check -> stage original -> platform parser -> report totals -> pricing lookup -> PnlSkuRow costs frozen where matched -> optional order events -> optional risk generation in savepoints -> processing warnings -> rename file -> database commit -> UI detail.

**Boundary:** optional fraud failure should produce a warning rather than discard financial import. 'Matched' currently means pricing link exists. Partial matches persist instead of disappearing from storage.

**Checks:** each parser with actual platform fixtures, duplicate replacement, overlapping date range, file failure/DB rollback, optional fraud failure, missing master SKU vs missing cost. Parser equivalence across every marketplace is not established by this trace.

## 20. P&L costing recovery and snapshots

**Trace:** missing-cost panel -> existing entries/reference lists -> cost form -> hidden-skus/add -> upsert cost/alias -> rematch selected report -> refresh rows and coverage. Independent /pnl/rematch/{id} exists but has no client wrapper/caller.

**Copy probes:** explicit rematch recovers PKTY once; second call recovers zero; existing priced snapshots stay unchanged. Synthetic test price 270 is not an approved costing choice. Live bills also contain 260.

**Gap:** no bill-derived cost choices/provenance, no recovery across all affected reports after standard cost save. Missing identity and missing costs need separate visible states.

## 21. Report views, consolidated P&L, trends

**Trace:** report -> stored settlements and frozen cost fields -> resolve_row_costs (snapshot preferred, live fallback for legacy rows) -> statement and profitability rows. Consolidation aligns report periods and excludes ambiguous overlapping coverage. Trends group eligible reports over time.

**Boundary:** P&L is marketplace scope; invoice/ledger/stock models are not consumed. Partial cost coverage is not full-company profit. Snapshot and live-estimate rows need visibly different provenance.

**Checks:** zero net units with deductions, negative settlement, legacy snapshots, missing-price coverage, overlapping/replaced/deleted reports, aligned multi-company periods.

## 22. Report deletion and download

**Trace:** report ID -> scope and company write-role check -> delete report and cascaded rows -> commit -> remove original file. Download validates report scope before returning saved original.

**NEW confirmed gap, copy probe:** deleting report 7 removes 107 order events; all 26 company SKU-risk rows remain byte-for-byte unchanged. delete_report does not rebuild derived risk aggregates. Dashboard/fraud can therefore keep stale results after source removal.

**Checks:** original file missing, file deletion error after DB commit, delete/re-upload, all dependent risk/alert/cluster counters. Filesystem and database deletion are not a single transaction.

## 23. Fraud / returns / customer imports and alert resolution

**Trace:** marketplace extraction or dedicated orders/customer upload -> OrderEvent -> SKU/actor/state/reason aggregates -> alerts -> fraud pages/dashboard. Some marketplace uploads cannot supply all actor fields; dedicated uploads are separate inputs.

Resolve alert -> company owner/admin -> FraudAlert.is_resolved = true -> commit. It does not file a claim, record recovered money or resolve a durable investigation case. Alert generation deletes unresolved platform alerts before regenerating; resolved alerts are retained, but repeated-generation suppression by business identity needs testing.

**Checks:** duplicate orders/customer import, replacement, failed backfill, deletion rebuild, repeated resolved signal, incomplete source warnings, tenant ownership.

## 24. Dashboard, SKU intelligence, operations and reconciliation

**Trace:** dashboard hooks -> independent metrics/insights/operations/reconciliation/intelligence APIs -> report aggregates and risk tables -> cards/tables. SKU profitability joins pricing and report rows; incomplete pricing affects which products enter intelligence.

**Boundary:** operations metrics are analytics, not dispatch/return execution. Reconciliation compares marketplace summaries/targets; it does not import bank transactions or prove an enforceable claim. Action pipeline builds investigate/watch lists from scores; it is not a tracked owner/status/deadline workflow.

**Checks:** period/channel/company filters propagated to every API, missing cost denominator, stale risk after delete, overlap exclusions, independent fetch errors, no fabricated zero where data is unavailable. Fresh visual checks pending.

## 25. Financial history, exports and source files

**Trace:** tracked ORM flush -> before/after fields -> FinancialChange in same transaction -> history read endpoint -> UI. Tracks pricing/platform configs, bills/lines, invoices/lines and ledger. Source report files are downloaded separately. CSV exports serialise displayed data.

**Boundary:** SKU identity, supplier aliases, defaults and P&L snapshot mutations are not in the tracked table list. Bulk SQL/external writes bypass these hooks. Therefore this is partial financial history, not complete lineage for every derived result.

**Checks:** rollback removes history, actor ID, cross-company scope, sensitive fields excluded, snapshot rematch lineage, CSV escaping and export coverage.

## Handoff matrix

| Change | Immediate persisted result | Automatic downstream effect | Missing or explicit next step |
|---|---|---|---|
| Create SKU | Sku | Search/catalogue availability | Pricing setup |
| Match purchase line | Line + item alias | Matching pending supplier lines, possible ledger SKU | Cost policy and pricing |
| Apply bill cost | Existing pricing rows | Recalculated future cost stack | Existing report recovery; frozen rows unchanged |
| Save pricing | SkuPricing | New imports can use it | Existing unmatched reports require rematch |
| Set platform alias | SkuPlatformConfig | New lookup uses alias | Existing rows and collision resolution |
| Change defaults | Settings/reference record | Later cost resolution uses defaults | Recalculate affected saved pricing |
| Upload report | Report, rows, snapshots | Optional events/risk/alerts | Review warnings and missing costs |
| Delete report | Report/rows/events removed | Report queries lose source | Risk rebuild absent (reproduced) |
| Mark invoice paid | Invoice balance/status | Billing summary | Ledger receipt absent |
| Enter ledger expense | LedgerEntry | Ledger summary | Business P&L inclusion absent |
| Resolve alert | is_resolved | Alert list filters | No claim/case/recovery lifecycle |

## What has and has not been verified

- 116 API endpoint handlers statically inventoried, including exact source positions and direct calls.
- 25 feature-flow records traced; broad modules may contain multiple UI actions.
- Six PKTY/deletion assertions exercised on a real-data copy (see probe JSON); no live mutations.
- Prior baseline: 390 backend tests passing. This pass does not equate that baseline with end-to-end coverage.
- Browser interaction, every parser variant, every role permutation, alias collision execution and all deletion constraints remain pending where stated.

## Next work, in dependency order

1. Separate SKU identity, supplier mapping, platform alias, cost readiness and snapshot provenance.
2. Join bill matching -> explicit cost setup -> eligible report rematch into one recoverable flow.
3. Enforce alias uniqueness and supplier-scoped suggestions; preserve explicit pack conversions.
4. Rebuild/invalidate fraud aggregates after source replacement and deletion.
5. Add impact preview for defaults and cross-platform cost changes.
6. Define invoice/cash/operating-expense and inventory lifecycles before connecting them to business profit.
7. Add end-to-end acceptance checks per numbered flow, including negative paths and retries, then run a permitted browser walkthrough.
