# Casper feature connection audit

Date: 2026-10-05. Scope: trace the exposed feature families and their persisted connections, beginning with the reported JDS PKTY failure. This is an audit, not a repair release. No production code or live business records changed for this audit.

## Conclusion

Casper has working individual modules but incomplete transitions between them. A supplier bill can be matched to an existing SKU while that same SKU remains excluded from P&L. The application conflates product identity with pricing availability. The earlier audits and create-from-bill implementation did not establish the complete workflow. Passing component/service tests did not establish that workflow either.

Source review covers the route families registered in app/main.py and frontend App.jsx. Live SQLite was queried read-only. Evidence is in FEATURE_CONNECTION_EVIDENCE_2026-10-05.json. The supplied screenshot supports the visible missing-cost state. No fresh browser walkthrough was performed; browser access remains blocked in this chat. Coverage below is a connection audit, not proof that every interaction or authorization edge case passes.

## PKTY: verified failure chain

1. Company 8 has SKU 162, `MBS-SS-3P-4IN- PKTY-1P`, vendor 2 (JDS Enterprise).
2. Five purchase lines link to SKU 162: one manual, four remembered aliases. Pack conversion is 1. Four bill rates are 270; one is 260.
3. There are ZERO sku_pricing rows for SKU 162.
4. Report 7, row 168 contains the EXACT SAME internal SKU string. It has 35 net units and projected settlement 12496.637. Both sku_pricing_id and snap_breakeven are NULL.
5. P&L lookup starts from SkuPricing, joining Sku. Therefore an existing SKU without pricing cannot match. This is not a typo, JDS naming problem, or missing product.
6. Report 7 has 24 rows: 10 with pricing, 14 without, with 63 net units on the unpriced rows. The screenshot's profit panel is partial coverage.

Evidence: app/services/pnl.py:826 (_build_pricing_lookup), app/services/purchase.py:416 (apply_cost), CreateBillSkuModal.jsx (creates identity and links only).

## Connection map

| Feature | Actual inputs and writes | Downstream connection | Gap / boundary |
|---|---|---|---|
| Login/account | Authentication, user, company membership | Protected UI and scoped API dependencies | Existing guards are present; no new penetration/auth-session audit in this pass |
| Companies/users | Company context, roles, members, module preferences | Tenant filters and write roles | Module visibility gate is in App.jsx; dependencies do not enforce module switches as API entitlements |
| Vendors | Company-scoped Vendor; explicit vendor-name aliases | SKU.vendor_id and PurchaseBill.vendor_id | Vendor alias has no management workflow in Vendors UI; current JDS alias was registered by repair script |
| Categories / HSN | Reference metadata and tax-related fields | SKU and pricing entry forms | Reference changes do not globally recalculate stored costs or historical reports |
| Platforms / tiers | Platform settings and tier records | Pricing/default resolution and report selection | Configuration save does not propagate recalculation to all saved pricing |
| Misc costs / global settings | Company defaults | Used during pricing resolution/save | Existing saved costs remain stale until recalculated; no impact preview or propagation workflow |
| SKU catalogue | Product code, supplier, category, description | Bills, invoices, pricing | SKU creation alone does not create costs; no explicit readiness state across screens |
| Unit Economics | SKU + canonical base SkuPricing + platform configs | Pricing lookup and report snapshots | Canonical base is chosen by lowest platform ID; existence here is not the same as pricing readiness on every channel |
| Dedicated Pricing | Per-platform SkuPricing, cost stack | New report imports | Pricing edits do not re-match existing unmatched reports |
| Profit Calculator | Scenario inputs and calculation | User decision support | A calculation is not a persisted bill/report reconciliation or cost approval |
| Inventory | SKUs component in inventory display mode | Catalogue/cost data | No stock movement, on-hand quantity, receipt/dispatch or valuation model found; this is a catalogue view |
| Bill import | Parsed supplier bills and lines | PurchaseBill -> LedgerEntry | Posts bill total as inventory expense; no stock receipt or supplier payment/allocation workflow |
| Bill matching | Supplier item alias -> SKU + pack conversion | Repeated bill lines auto-match | Matching does not create pricing, choose a cost policy, or re-match marketplace reports |
| Create SKU from bill | Creates SKU, links line, remembers mapping | Catalogue and later bill imports | Newly implemented flow stops before pricing; this is how PKTY became matched but not costed |
| Apply bill cost | Confirmed line rate / pack conversion | Updates all existing pricing rows for that SKU | Requires pricing already exists; no setup path for new SKU; writes across all platforms without platform selection |
| Ledger | Manual cash/expense entries plus generated purchase entries | Ledger reports | Ledger entries are not consumed by P&L consolidation; a ledger expense is not automatically a P&L operating expense |
| Billing / invoices | Invoice and lines, status, cumulative paid amount | Billing summary | Invoice/payment actions do not post ledger receipts or stock movements |
| Marketplace import | Parsed report + platform SKU name | Pricing lookup -> PnlSkuRow + cost snapshot | Product identity and cost readiness represented by one nullable pricing foreign key |
| Missing-cost recovery | Enter cost and platform name | Upsert cost, rematch selected report | Does not offer confirmed purchase costs with bill/date provenance; requires re-entry and a cost decision |
| P&L rematch | Explicit backend rematch endpoint | Previously unpriced rows get pricing + snapshot | No frontend rematch call found; ordinary pricing saves leave older unmatched rows unresolved |
| Report P&L / operating P&L | Settlement rows and cost snapshots | Statement/row calculations | Frozen costs should remain stable; newly resolved rows need explicit historical cost policy |
| Business P&L | Aligned marketplace reports | Consolidated marketplace statement | Does not incorporate ledger expenses or direct invoices; cannot be treated as complete company accounts |
| Dashboard / SKU intelligence | Reports, pricing, risk profiles | Metrics and decision prompts | Costed subset feeds SKU profitability; absent pricing affects rankings and coverage, not only one report panel |
| Settlement reconciliation | Marketplace settlement summaries vs targets | Variance watch list | No bank statement matching or proven recovery entitlement; target variance is not an underpayment claim |
| Returns/fraud | Separate order/customer imports, risk aggregates | Risk views and dashboard | Order upload is a separate flow; supplier matching does not establish marketplace order identity |
| Action queue | Risk profiles -> computed investigate/watch list | Read-only prioritisation | No persisted owner, status, evidence attachment, claim filing or recovery workflow found |
| Financial history | Transactional history hooks | Reviewable changes for configured models | Change history is not purchase costing policy, stock valuation, or a closed-period restatement workflow |

## Prioritised findings

### F01 — P1: Product matching depends on cost existence
`app/services/pnl.py:826` builds a lookup of pricing records, not product identities. `PnlSkuRow` has a pricing link but no independent master-SKU link. PKTY proves that a correct identity is lost in the P&L state model. Proposed repair: store/return identity resolution separately from pricing readiness; distinguish unknown SKU, known SKU without cost, and priced SKU.

### F02 — P1: Bill -> pricing handoff is incomplete
`CreateBillSkuModal.jsx` explicitly defers pricing. `purchase.apply_cost` rejects a SKU without pricing. `BillDiscrepancies.jsx` disables applying cost when cost_diff is null; a missing recorded cost makes it null. Proposed repair: a finish-cost-setup action using the confirmed bill unit cost and explicit platform/cost stack, followed by affected-report recovery. Do not fill unknown overheads with invented values.

### F03 — P1: No purchase cost selection policy
PKTY has verified bill unit costs of both 270 and 260. No effective-dated acquisition-cost history/valuation policy connects those purchases to sold units. Choosing latest, weighted average, or a reviewed standard cost produces different answers. Proposed repair: select and disclose a policy and source bill(s); do not silently pick the newest price for September sales.

### F04 — P1: Existing reports are not recovered by ordinary pricing saves
`routes/pnl.py:388` exposes rematch, but no frontend rematch invocation was found. `entries.upsert_row` and SKU pricing writes do not invoke it. Only hidden-SKU quick-add combines cost saving and selected-report rematch. Proposed repair: explicit recover-unpriced-rows action after cost setup, with affected report list; preserve existing frozen snapshots.

### F05 — P1: Business P&L is only marketplace P&L
`pnl_statement.compute_pnl_consolidated` loads PnlReport/PnlSkuRow, not LedgerEntry/Invoice. Salaries, rent and direct invoice activity are disconnected. Proposed repair: disclose current scope; introduce an explicit operating-expense/other-sales reconciliation policy with duplicate protection. Never sum inventory purchases and sold-unit COGS indiscriminately.

### F06 — P2: Supplier candidates ignore vendor scope
`purchase._matching_data` loads every active SKU in the company and `bills_view` passes that list to `sku_candidates`; vendor_id is not a matching input. Remembered item aliases are supplier-scoped, but candidate suggestions are not. Proposed repair: rank/filter by known supplier first and make any cross-supplier search explicit.

### F07 — P2: Cost application has a wider scope than the UI explains
`purchase.apply_cost` updates all SkuPricing rows for the SKU. The comparison displays one canonical price. Proposed repair: preview affected platforms and preserve explicit overrides or require an explicit propagation choice.

### F08 — P2: Defaults and stored results can diverge
Global settings, misc cost and platform mutations commit their own records without recalculating dependent stored prices. New saves use current defaults while older rows keep previous results. Proposed repair: expose default version/override state and offer a scoped recalculation preview; do not rewrite historical snapshots.

### F09 — P2: Billing and cash ledger are separate systems
Invoice create/update only persist invoices and lines. Updating amount_paid does not create a receipt ledger entry. Proposed repair: payment records with idempotent ledger postings, reversals, and reconciliation; keep invoices and cash distinct.

### F10 — P2: Inventory has no inventory lifecycle
`pages/Product/Inventory.jsx` wraps SKUs. No stock movement/on-hand/warehouse model was found. Bills and sales do not change stock. Proposed repair: label the present view as catalogue, or design receipts, dispatches, returns, adjustments and valuation before promising inventory control.

### F11 — P2: Marketplace alias and supplier alias are independent
VendorItemAlias resolves supplier descriptions; SkuPlatformConfig resolves marketplace labels. There is no general UI to select an existing internal SKU for an arbitrary missing marketplace label in the shown recovery form. Proposed repair: separate 'link marketplace label to existing SKU' from 'create product' and 'add missing cost'; enforce unambiguous company/platform aliases.

### F12 — P2: Module switches are UI visibility, not API enforcement
`App.jsx` RequireModule gates pages. CompanyModule is not consulted by API dependencies reviewed. This is a product contract issue if 'disabled' is intended to deny API access; it is not evidence of a tenant-isolation bypass. Define the contract and enforce it consistently.

## Corrected end-to-end acceptance criteria

1. Create a product from a bill -> supplier and product identity retained -> explicit pack conversion -> readiness says 'matched, costing incomplete'.
2. Complete costing from a selected, dated purchase source -> choose marketplace and required cost components -> show exact affected records.
3. Upload a report with the identical SKU -> identity resolves even if costs are missing; no duplicate SKU creation.
4. Existing marketplace alias -> resolves to the same SKU; ambiguous aliases require resolution, never arbitrary overwrite.
5. Complete missing costs after upload -> rematch eligible unpriced rows -> P&L coverage and dashboard update; repeat action is idempotent.
6. Later bill cost changes -> future pricing can change; frozen reports stay stable unless explicitly restated with history.
7. Multi-platform and multi-company fixtures -> no cross-company mappings, no silent cross-platform cost overwrite.
8. Invoice payment and expense flows -> explicitly defined ledger/P&L inclusion with no duplicate cash or COGS.
9. Settings edit -> visible recalculation scope and override handling.
10. Failed create/link/cost/rematch stages -> recoverable status and retry without duplicate SKUs, bills or expenses.

## Implementation order (proposal, not implemented)

First fix identity vs pricing state, finish-cost-setup and report recovery together. Then add marketplace alias linking and supplier-scoped candidate selection. Next formalise purchase costing and snapshot policy. Treat full inventory, invoice-payment posting and business accounting as separate larger workflows with explicit acceptance tests.

Baseline verification: `python -m pytest tests -q -p no:cacheprovider` completed with 390 passing backend tests in 13.40 seconds. Existing tests were rerun to establish baseline health, not to claim these missing integrations work. Fresh visual verification and real browser input remain outstanding. This audit does not certify the application as production-ready or a complete accounting system.
