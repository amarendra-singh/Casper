# P&L Integrity + Statement Fidelity — Design

**Date:** 2026-08-05
**Scope:** Track B — frozen cost snapshot, TCS/TDS statement lines, period-aligned consolidation.

## Problem

Three defects found reviewing the P&L engine as a domain expert:

1. **Past reports are not immutable.** `pnl_statement.py` reads COGS / fulfillment / return
   cost / overhead **live** from `row.sku_pricing`. Editing a SKU's pricing today silently
   changes every past report's Operating Profit and margins. Closed periods must not move.
2. **TCS and TDS are invisible.** Both fall into the generic "Other Marketplace Fees" plug.
   TCS is credited against GST liability, TDS against income tax — they are separate,
   recoverable line items and must be reported separately.
3. **Consolidated P&L blends different periods.** It takes the latest report *per platform*,
   so a Flipkart May report can be summed with a Meesho June report as if simultaneous.

## 1. Frozen cost snapshot

**Schema** — six nullable columns on `PnlSkuRow`, captured at upload:

| Column | Source | Purpose |
|---|---|---|
| `snap_cogs_per_unit` | `sku_pricing.price` | product cost |
| `snap_fulfillment_per_unit` | `package + logistics + addons` | fulfillment |
| `snap_return_per_unit` | `cr_cost + damage_cost` | return cost |
| `snap_overhead_per_unit` | `misc_total` | overhead allocation |
| `snap_breakeven` | `breakeven` | full cost floor |
| `snap_gst` | `gst` | after-GST margin |

Nullable is deliberate: `NULL` means "uploaded before this feature existed" and drives the
`estimated` badge. Migration via idempotent script in `backend/scripts/` (worktree Alembic
chain is behind the live DB).

**Write path** — `services/pnl.py::_build_sku_row()` stamps the six values from the matched
`SkuPricing`. Written once, never updated.

**Read path** — one helper, `pnl_statement._cost_basis(row) -> (costs, is_frozen)`. Both
`_rows_and_report()` and `compute_pnl_rows()` call it, so frozen-vs-live is decided in exactly
one place. `is_frozen` surfaces in the API as `cost_basis: "frozen" | "estimated"`.

**Backfill decision** — none. Old reports fall back to live pricing and are labelled
`estimated` in the UI. No data loss, no re-upload, no fabricated history.

## 2. TCS / TDS as statement lines

`build_pnl_statement` gains two explicit expense lines between GST-on-fees and marketing:

- `tcs` — "TCS (Tax Collected at Source)", from `sum(taxes_tcs)` per row, falling back to
  `report.tcs_amount`.
- `tds` — "TDS (Tax Deducted at Source)", same pattern with `report.tds_amount`.

Both join the `identified` fee total so the "Other Marketplace Fees" balancing plug shrinks
accordingly. The statement must still foot: `net_sales − total_platform_fees == net_payout`.

## 3. Period-aligned consolidation

`compute_pnl_consolidated` changes from "latest report per platform" to:

1. Build `{platform_id: {period: report}}` for the company.
2. Choose the **latest period present for every platform that has any report**.
3. Blend only that period's reports.
4. Return `period` (the aligned month) and `excluded_platforms` (any platform with reports but
   none in that period) so the UI can state what was included.

If no common period exists, fall back to the latest period overall and report every platform
missing from it as excluded — degrade with disclosure, never silently mismatch.

## Testing

Pure-function tests (no DB):

- frozen snapshot wins over live pricing
- missing snapshot falls back to live, flagged `estimated`
- mixed report (some rows frozen) reports `estimated`
- **regression:** changing live pricing does not move a frozen report's numbers
- TCS/TDS appear as own lines and reduce the Other-fees plug; statement still foots
- consolidation picks the latest common period and lists excluded platforms
- consolidation with no common period degrades and discloses

## Out of scope

Side-by-side line-by-line period comparison table (deferred; separate feature).
