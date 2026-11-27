# Connection repair verification — 7 October 2026

## Implemented and verified

- Undo of pricing and manual ledger updates, through Settings financial history. Company write authorization, latest-change checks, current-state comparisons and reference validation protect restoration. The inverse is a new history entry. Generated supplier-bill ledger records, creation/deletion and identity changes require their original workflow; this is not universal undo. Frozen report costs are not restated.
- Bill-to-cost setup for confirmed SKU matches with no pricing. The user selects a platform and explicitly supplies allowances/tax/markup, including zero. Confirmed billed-unit conversion supplies the purchase cost.
- Pricing create/update, unit-economics batch saves, and bill cost application recover eligible unpriced report rows in the same company. Existing frozen rows remain unchanged. The missing-cost panel also exposes Connect existing costs for older records.
- One shared pricing snapshot implementation now supplies costs, targets and variance for both uploads and later recovery. Removed the duplicate cost snapshot builder. This also fixes absent target fields after rematching.
- Bill cost application no longer silently overwrites every platform's pricing. The UI confirms the specific displayed pricing record; the backend rejects an unspecified target when multiple pricing records exist.
- Known-supplier candidate suggestions are vendor-scoped. Explicit catalogue selection remains available.
- Conflicting marketplace aliases cannot silently choose a different SKU's costs.
- Report deletion rebuilds risk aggregates and current alerts from surviving sources. Empty source data clears stale SKU risk scores.
- Consolidated P&L identifies its marketplace-only scope. The former inventory view is titled Product catalogue; it does not implement stock accounting.

## Evidence

- Backend: 403 tests passed; foreign-key-enforced synthetic database fixtures.
- Frontend: 131 tests passed; lint zero errors/warnings; production build passed.
- New regressions: `backend/tests/test_connection_recovery.py`, `frontend/src/tests/connection.recovery.test.jsx`.
- Disposable-copy proof: `audit/verify_connection_repairs.py`, output `audit/FEATURE_FLOW_PROBES_2026-10-07.json`.
- Current live database read-only observation: SKU 162 now has pricing 273 (platform 22, purchase cost 270), while report row 168 still lacks its pricing link. This supersedes the earlier no-pricing observation.
- Copy-only recovery connected one row and was idempotent, preserving previously frozen snapshots. Copy-only report 7 deletion removed 107 source events and rebuilt company risk scores from 26 rows to 5.
- No live financial records were changed by these probes. Backend health and frontend HTTP checks passed after startup. No new interactive browser verification was performed.

## Remaining gaps — not represented as fixed

The original twelve-finding audit is not fully closed. These are material unfinished workflows:

1. Marketplace identity is still primarily linked through pricing; no independent persisted product-resolution state. General UI linking an arbitrary marketplace label to an existing SKU remains incomplete.
2. Defaults changes still need an explicit impact preview and recalculation workflow with override handling.
3. Direct-invoice payments, ledger receipts and marketplace P&L are not a unified accounting ledger. Adding totals together would double-count some purchases, costs and settlements; proper allocation/reversal rules and payment records are required.
4. Stock receipts, dispatches, returns, adjustments and valuation do not exist. Renaming a catalogue view is disclosure, not inventory implementation.
5. Undo does not reverse creation/deletion, invoice payments, supplier matching or an entire multi-record user action. Current history is per-record, with no operation-level grouping.
6. Module switches remain visibility controls; they are not API entitlements. Supplier-name alias administration has no general UI.
7. Broader browser/visual, concurrent-write and every-feature interaction coverage remains outstanding. Passing tests cannot establish that all bugs have been found.

The safe boundary is shared product identity and explicit financial transitions. Bidirectional navigation and updates should not automatically turn a sales price into a purchase cost, a bill into a payment, or a later pricing edit into a restatement of a closed report.
