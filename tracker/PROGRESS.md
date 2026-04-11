# CASPER — PROGRESS LOG
> Updated after every work session. Read before starting. Never re-do completed work.
> Format: [date] — what was done, files changed, result

---

## STATUS SNAPSHOT — 2026-04-11

```
Backend   ████████████░░░░░░░░  55%
Frontend  ███████████░░░░░░░░░  50%
Overall   ██████████░░░░░░░░░░  48%
```

---

## ✅ COMPLETED

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
| Platform Settings UI | Partially done | Page exists but missing `default_ad_pct` and `default_profit_pct` input fields |
| Dashboard lower sections | Not started | Platform list, donut chart, sales table |

---

## ⏭ NEXT UP (in priority order)

1. **Platform Settings UI** — add `default_ad_pct` and `default_profit_pct` editable fields to Platforms page (`/settings` or `/pricing`)
2. **Dashboard lower sections** — platform performance list, donut chart, sales table
3. **Test persist flow** — save a row with per-platform AD override → reload page → verify it loads back correctly
4. **SKU alias display** — show platform alias name in the Tier column or somewhere visible
5. **Multi-platform BS export** — update export to include AD ₹, Tier, BS per platform (currently only exports BS)

---

## 🐛 BUGS FIXED LOG

| Date | Bug | Fix | Files |
|------|-----|-----|-------|
| 2026-04-11 | Scientific notation `1.5e-9` in dmgPct cell | `numStr()` helper + applied everywhere | `SKUs.jsx` |
| 2026-04-11 | `w-plat-bs` clipping large BS values | Removed `max-width:86px` | `SKUs.css` |
| 2026-04-11 | Tier dropdown lost after split | Moved to own `<td>` | `SKUs.jsx` |
| 2026-04-10 | Inputs unclickable after sizer added | `pointer-events:none` on wrappers | `SKUs.css`, `SmartCell.css` |
| 2026-04-10 | Vendor SmartCell blocked by TD gaps | `sc-wrap` sizer inside it, `width:100%` | `SmartCell.jsx`, `SmartCell.css` |
| 2026-04-10 | Column inflation from browser default size | `size={1}` on all inputs | `SKUs.jsx` |
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
