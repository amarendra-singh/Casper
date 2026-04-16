# CASPER — DECISIONS & AGREEMENTS
> Edited live during sessions when we agree on something.
> Every decision links to affected files. No discussion fluff — only what was decided and why.
> Cross-ref: [MEMORY](MEMORY.md) · [PROGRESS](PROGRESS.md) · [ROADMAP](ROADMAP.md)

---

## HOW TO USE
- **During session:** When we agree → add entry immediately under correct section
- **Format:** `[DATE] WHAT — WHY — FILES`
- **Never remove entries** — mark superseded with `~~strikethrough~~ → new decision`
- **Link everything** — file paths, line refs, section refs

---

## ARCHITECTURE DECISIONS

| # | Date | Decision | Why | Files |
|---|------|----------|-----|-------|
| A1 | 2026-04-02 | AD is per-platform, not global | Each platform charges different AD rates | `models/sku.py`, `schemas/entries.py`, `services/entries.py` |
| A2 | 2026-04-02 | `SkuPlatformConfig` as separate table, not JSON column | Queryable, indexable, cleaner migrations | `models/sku.py` → `sku_platform_configs` |
| A3 | 2026-04-02 | AD inheritance: SKU adAmt → SKU adPct → platform.default_ad_pct | Override granularity without breaking defaults | `SKUs.jsx` → `computePlatform()` |
| A4 | 2026-04-10 | Hidden span sizer pattern for column widths | Only way to get true content-driven widths in `table-layout:auto` | `SKUs.css` → `.ec-sizer-wrap` |
| A5 | 2026-04-10 | `size={1}` on all number inputs | Browser default `size=20` inflates columns ~170px regardless of value | All inputs in `SKUs.jsx` |
| A6 | 2026-04-10 | `table-layout:auto` + `width:max-content`, no `min-width:100%` | `min-width:100%` causes table to stretch to viewport, defeating content sizing | `SKUs.css` → `.e-tbl` |
| A7 | 2026-04-11 | 3 columns per platform: AD inputs \| Tier \| BS | User wants each section separately visible and independently sized | `SKUs.jsx` → platform cols, `colSpan={3}` |
| A8 | 2026-04-11 | `numStr()` for all number→string conversions | `String()` on floats produces `1.5e-9` sci notation; `toFixed(6)` never does | `SKUs.jsx` → `numStr()`, `backendRowToFrontend()` |
| A9 | 2026-04-11 | No `max-width` on `w-plat-bs` | Large BS values were clipping (test data ₹1984500000087 was 29px over) | `SKUs.css` → `.w-plat-bs` |
| A10 | 2026-04-16 | `/pnl/flipkart/:reportId` as separate route | Each report is a resource — refresh-safe, bookmarkable, shareable URL | `App.jsx`, `FlipkartReport.jsx` |
| A11 | 2026-04-16 | `?view=fk/pnl/insights` search param for active tab | Tab state survives refresh without extra DB query | `FlipkartReport.jsx` → `useSearchParams` |
| A12 | 2026-04-16 | Save original Excel to `backend/uploads/pnl/{id}.xlsx` | Needed for debugging parser issues; auto-deleted on report delete | `routes/pnl.py` → `UPLOADS_DIR` |

---

## UI / UX DECISIONS

| # | Date | Decision | Why | Files |
|---|------|----------|-----|-------|
| U1 | 2026-04-10 | Columns toggle (SKU Details, Cost Breakdown, Calculations) persisted in localStorage | Survive page refresh | `SKUs.jsx` → `LS_KEY`, `loadVisibility()` |
| U2 | 2026-04-10 | Series groups collapsible | Long SKU lists need grouping | `SKUs.jsx` → `collapsedSeries`, `toggleSeries()` |
| U3 | 2026-04-10 | Sticky first two columns (Vendor, SKU) | Must stay visible when scrolling right on wide tables | `SKUs.css` → `.sticky-col` |
| U4 | 2026-04-10 | Platform chips (toggle active platforms) | Don't show all platforms always — user picks relevant ones | `SKUs.jsx` → `activePlats` state |
| U5 | 2026-04-11 | Tier in own column (not inside AD cell) | More scannable; each data point in its own cell | `SKUs.jsx` → platform `<td>` split |

---

## FORMULA DECISIONS

| # | Date | Decision | Why |
|---|------|----------|-----|
| F1 | 2026-04-02 | `breakeven` excludes AD | AD is platform-specific; base breakeven must be platform-agnostic |
| F2 | 2026-04-02 | Profit % applied to `plat_be` (not base be) | Profit must cover AD cost too |
| F3 | 2026-04-02 | `bs_no_gst = round(plat_be + profit_amt)` | Round before adding GST to avoid compounding decimals |
| F4 | 2026-04-02 | Apparel/footwear GST: ≤2500 → 5%, >2500 → 18% | Indian GST slab rules |
| F5 | 2026-04-16 | FK BS/unit = `bank_settlement_projected / net_units` | BSP includes ITC (real deposit); FK's `earnings_per_unit` excludes ITC |
| F6 | 2026-04-16 | Margin % = `(FK BS/unit − Target BS) / Target BS × 100` | Variance as % of our own target — measures how far we are from goal |
| F7 | 2026-04-16 | FK Fees/unit = `(commission + collection + fixed + gst + tcs + tds − rewards) / net_units` | All FK charges; reverse_shipping is separate (return drag, not a platform fee) |
| F8 | 2026-04-16 | Return Drag/unit = `|reverse_shipping_fee| / net_units` | Spreads return cost over delivered units — true unit-level drag |

---

## BACKEND DECISIONS

| # | Date | Decision | Why | Files |
|---|------|----------|-----|-------|
| B1 | 2026-04-02 | `vendor_id`, `category_id` → `Optional[int] = None` in Pydantic schema | Non-optional caused 500 when omitted in new rows | `schemas/sku.py` |
| B2 | 2026-04-02 | Alembic for all schema changes | Reproducible migrations; never alter prod DB manually | `alembic/versions/` |
| B3 | 2026-04-02 | `adAmt` always blank on load (`''`), computed on render | Don't persist computed value — always recompute from `adPct` | `services/entries.py`, `SKUs.jsx` → `backendRowToFrontend()` |

---

## WORKFLOW DECISIONS

| # | Date | Decision | Why |
|---|------|----------|-----|
| W1 | 2026-04-02 | Always edit worktree (`hungry-kepler`), never main project dir | Servers run from worktree; edits to main dir don't reflect in browser |
| W2 | 2026-04-11 | Push via `git push origin claude/hungry-kepler:main --force-with-lease` | Worktree branch diverges from main; this is the clean push path |
| W3 | 2026-04-11 | `tracker/` folder in repo root, updated every session | Single source of truth; no token waste re-discovering context |

---

## OPEN QUESTIONS (not yet decided)

| # | Question | Options | Blocking |
|---|----------|---------|---------|
| Q1 | Platform Settings UI — separate page or inside existing Settings? | A) Add to `/settings` tab B) New `/platforms` page | Dashboard M3 |
| Q2 | Export format for per-platform data — one sheet or multiple? | A) One sheet, columns per platform B) One sheet per platform | Export feature |
| Q3 | SQLite → Postgres — when? | A) Before first real user B) Phase 4 | Hosting decision |
