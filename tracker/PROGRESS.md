# CASPER — PROGRESS LOG
> Updated after every work session. Read before starting. Never re-do completed work.
> Cross-ref: [DECISIONS](DECISIONS.md) · [MEMORY](MEMORY.md) · [ROADMAP](ROADMAP.md)
> Format: [date] — what was done, files changed, result

---

## Session 2026-11-27 — publish remaining project material

- User approved public release of business files. Remaining audit, design, workbook, and historical materials were prepared for `origin/main`; database backups are represented by credential-disabled public copies.
- Release inventory and verification: [public-data push log](../audit/runtime/2026-11-27-public-data-push.md).

---

## Session 2026-11-22 — Casper startup and repository push

- Casper runs locally at `http://127.0.0.1:5174` with its API on port 8766; port 8765 belongs to the Wedding project.
- Backend 434 tests, frontend 149 tests, both lint checks, and frontend build passed.
- Pushed the checked source and seven earlier local commits to `origin/main` at `b649cd7`. Full GST correction and run evidence: [2026-10-28 catalogue GST progress](../audit/runtime/2026-10-28-catalogue-gst-progress.md).

---

## STATUS SNAPSHOT — 2026-09-28

```
Backend   ██████████████████░░  90%   294 tests passing
Frontend  ████████████████░░░░  82%   103 tests passing
Overall   █████████████████░░░  85%
```

Since the April snapshot the app grew well past the original single-seller scope:
multi-company (tenancy, switcher, per-company modules), Expense Ledger, Billing &
Invoices, Profit Calculator, P&L for all four platforms, Fraud intelligence, and
the Product area (Unit Economics / Inventory / Categories). It is now Railway
deploy-ready (single-service Dockerfile). The older tables below are kept for
history — cross-check against the live app, not these notes.

---

## ✅ COMPLETED

### Session 2026-09-28 (Deploy-readiness + audit + hardening)
- **Railway single-service deploy** — `Dockerfile` (builds React, FastAPI serves it + API on one URL), `railway.toml`, `.dockerignore`, `.env.example`, `RAILWAY.md`; `app/main.py` serves the built SPA with deep-link fallback; `.github/workflows/keepalive.yml` pings every 4 min.
- **Product restructure** — SKUs page split into Product → Unit Economics / Inventory / Categories via a `viewMode` prop on the shared grid (no duplication). Routes + sidebar wired; `/skus` redirects to `/product/unit-economics`.
- **Profit Calculator** — wired into routes + sidebar (channel-aware unit economics, client-side).
- **Dashboard de-faked** — removed hardcoded demo insights, fake "Pulled from Flipkart Seller API" footer, and fabricated revenue chart fallback; all now use real endpoints or honest empty states (CLAUDE.md "no hardcoded demo data").
- **Auth hardening** — single-flight refresh in `api/client.js`: a burst of parallel 401s (e.g. a company switch reloads the app) now shares ONE refresh instead of racing into a spurious logout.
- **Tech debt** — migrated `schemas/entries.py` + `schemas/hsn_code.py` to Pydantic v2 (`ConfigDict` / `field_validator`); 0 deprecation warnings. Fixed dev-proxy port mismatch (vite → 8765).
- Result: backend 294/294, frontend 103/103.


### Session 2026-04-16 (P&L Routing + Parser Audit)
- **Separate route for report detail** — `/pnl/flipkart/:reportId` owns its own page
  - `FlipkartReport.jsx` — new file, fetches by ID on mount, tabs in `?view=fk/pnl/insights`
  - `Flipkart.jsx` — stripped to list-only page (Reports, All Time P&L, By SKU)
  - `App.jsx` — added `<Route path="pnl/flipkart/:reportId" element={<FlipkartReport />} />`
  - Refresh on Real P&L stays on same report + same tab — refresh-safe by design
- **Removed `Sell Price/unit` column** — `accounted_net_sales / net_units` was meaningless; not visible in FK report
- **Removed `Platform BS/unit` column** — was identical to Target BS/unit (no override set)
- **Removed gross units from table** — only net units shown
- **Full parser audit against real Excel** — 3 bugs found and fixed:
  1. `cancelled_units` was reading col 3 (total 40) instead of col 6 (actual 4). Fixed keyword: `"cancellations"`
  2. `fixed_fee` (Fixed Fee = ₹-210 for N65-WHITE) was never captured — added new field + col + alembic migration
  3. `net_margin_pct` was wrongly multiplied ×100 (69.88 → 6988%). Fixed `_safe_pct` threshold: `<= 1.0`
- **Backend saves uploaded Excel files** — `backend/uploads/pnl/{report_id}.xlsx`, auto-deleted on report delete
- **Download endpoint** — `GET /pnl/reports/{report_id}/file` returns original Excel
- **Full cross-check PASSED** — 107 SKU rows × all fields, totals match Summary sheet exactly:
  - gross_units: 813 ✅ · net_units: 412 ✅ · bank_settlement: ₹89,480.52 ✅ · net_earnings: ₹95,764.19 ✅
  - fixed_fee total: -2525 ✅ · reverse_shipping total: -20823 ✅
- **Summary sheet parser — all 13 fields PASS**
- **Alembic migration** `b7d959691938` — adds `fixed_fee` column to `pnl_sku_rows`
- Files: `FlipkartReport.jsx` (new), `Flipkart.jsx`, `App.jsx`, `models/pnl.py`, `schemas/pnl.py`, `services/pnl.py`, `routes/pnl.py`

### Session 2026-04-11
- **Platform AD columns split into 3** — each platform now has: AD inputs | Tier | BS
  - `colSpan={3}` on group headers
  - Sub-headers: "AD% / ₹" | "Tier" | "BS"
  - Tier moved from inside AD cell to its own `<td>`
  - `totalCols` updated to `activePlats.length * 3`
  - Files: `SKUs.jsx`, `SKUs.css`
- **`numStr()` helper added** — prevents scientific notation (`1.5e-9` → `0`)
  - Applied to all `backendRowToFrontend()` numeric fields
  - Applied to all sizer spans (replaced `String(c.xxx)` with `numStr(c.xxx)`)
  - Files: `SKUs.jsx`
- **`w-plat-bs` max-width removed** — BS column now grows freely with content
  - Files: `SKUs.css`
- **Quality check passed** — 0 clipped, 0 sci-notation, 0 th/td mismatch at 1920 and 1280
- **Pushed to GitHub main**

### Session 2026-04-10 / 04-02
- **Per-platform AD feature** — full build
  - `Platform` model: `default_ad_pct`, `default_profit_pct`
  - `SkuPlatformConfig` model: per-SKU-per-platform AD/profit override
  - `SkuPricing`: removed global `ad` field, added `platform_configs` relationship
  - Alembic migrations: `b8f3a91c2e54`, `c3f7a8e1d924`
  - Backend schemas, services, routes all updated
  - Files: `models/sku.py`, `schemas/entries.py`, `services/entries.py`, `routes/entries.py`
- **SKU table full responsive overhaul**
  - Hidden span sizer pattern on all input columns
  - `size={1}` on all inputs (removes browser 170px inflation)
  - `table-layout:auto` + `width:max-content` — no fixed table widths
  - `pointer-events:none` on sizer wrappers, `pointer-events:auto` on inputs
  - Platform BS split into own column (then Tier also split — 3 cols per platform)
  - Full height: `page-content → flex col`, `entries-page → flex:1`, `e-scroll → flex:1 min-height:0`
  - Files: `SKUs.jsx`, `SKUs.css`, `SmartCell.jsx`, `SmartCell.css`, `Layout.css`
- **Bug fixed**: `vendor_id: int` / `category_id: int` → `Optional[int] = None` in `sku.py` schema (was causing 500 on `/api/v1/skus/`)

### Earlier Sessions
- Dashboard responsive layout + Tailwind
- Vendors page + category modal
- Excel import for SKUs
- SKU delete functionality
- vendor_sku field save/load fix
- Export dropdown (xlsx + csv)
- Series grouping in SKU table
- JWT auth + user CRUD
- All DB models (User, Platform, PlatformTier, Vendor, Category, MiscItem, GlobalSettings, Sku, SkuPricing)
- Project structure, config (.env), seed script

---

## 🔄 IN PROGRESS / PARTIALLY DONE

| Item | Status | Notes |
|------|--------|-------|
| Platform Settings UI | ✅ Done | Per-platform default AD%/Profit% shown and editable on Settings |
| Dashboard lower sections | ✅ Done | Reconciliation, operations, action-pipeline, insights all render real data |
| PnL re-upload needed | Action required | Re-upload Excel after parser fix for correct `cancelled_units`, `fixed_fee`, `net_margin_pct` |
| Deployed DB persistence | Decision needed | Railway SQLite volume vs Postgres — see RAILWAY.md |

---

## ⏭ NEXT UP (in priority order)

1. **Re-upload FK report** — parser was wrong before fix; old data has bad `cancelled_units` and missing `fixed_fee`
2. **Platform Settings UI** — add `default_ad_pct` and `default_profit_pct` editable fields
3. **Parser upload validation** — warn if critical fields (BSP, net_units) are null for >50% SKUs after parse
4. **Dashboard lower sections** — platform performance list, donut chart, sales table
5. **Test persist flow** — save a row with per-platform AD override → reload → verify

---

## 🐛 BUGS FIXED LOG

| Date | Bug | Fix | Files |
|------|-----|-----|-------|
| 2026-09-28 | Switching company logged the user out | Single-flight refresh — parallel 401s share one refresh instead of racing into logout | `api/client.js` |
| 2026-09-28 | Per-platform BS rendered with float noise (`₹174.26000000000002`) | Round `bs` with `+bs.toFixed(2)` like sibling fields | `pages/SKUs.jsx` |
| 2026-09-28 | Dashboard showed fabricated demo insights/revenue as real data | Wired to real `/dashboard/insights` + honest empty states; removed fake API footer | `pages/Dashboard.jsx` |
| 2026-09-28 | Pydantic v2 deprecation warnings (7) | Migrated to `ConfigDict` / `field_validator` | `schemas/entries.py`, `schemas/hsn_code.py` |
| 2026-04-11 | Scientific notation `1.5e-9` in dmgPct cell | `numStr()` helper + applied everywhere | `SKUs.jsx` |
| 2026-04-11 | `w-plat-bs` clipping large BS values | Removed `max-width:86px` | `SKUs.css` |
| 2026-04-11 | Tier dropdown lost after split | Moved to own `<td>` | `SKUs.jsx` |
| 2026-04-10 | Inputs unclickable after sizer added | `pointer-events:none` on wrappers | `SKUs.css`, `SmartCell.css` |
| 2026-04-10 | Vendor SmartCell blocked by TD gaps | `sc-wrap` sizer inside it, `width:100%` | `SmartCell.jsx`, `SmartCell.css` |
| 2026-04-10 | Column inflation from browser default size | `size={1}` on all inputs | `SKUs.jsx` |
| 2026-04-16 | `cancelled_units` reading 40 (total) instead of 4 (actual) | Changed keyword from `"cancell"` to `"cancellations"` (col 6) | `services/pnl.py` |
| 2026-04-16 | `fixed_fee` never captured — FK Fees/unit understated | Added `fixed_fee` field + column keyword + migration | `models/pnl.py`, `schemas/pnl.py`, `services/pnl.py`, `routes/pnl.py` |
| 2026-04-16 | `net_margin_pct` multiplied ×100 (6988% instead of 69.88%) | Fixed `_safe_pct` threshold from `≤1.5` to `≤1.0` | `services/pnl.py` |
| 2026-04-16 | `bank_settlement` keyword also matched duplicate col 45 | Removed generic `"bank settlement"` fallback; now requires `"[projected]"` | `services/pnl.py` |
| 2026-04-02 | 500 on `/api/v1/skus/` | `vendor_id`/`category_id` → `Optional[int]` | `schemas/sku.py` |
| 2026-04-02 | Group header sticky offset wrong | `top:24px` (was 27px) | `SKUs.css` |

---

## 📋 BACKLOG (nice to have)

- Dark mode support
- Bulk edit / multi-row select
- Platform comparison view (side-by-side all platforms for one SKU)
- Profit margin heatmap on SKU table
- Per-category default pricing rules
- Mobile app (React Native)
- Webhook for platform price sync
- User roles (view-only, editor, admin)
- Audit log (who changed what, when)
- CSV import validation with error report
