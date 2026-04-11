# CASPER — MEMORY FILE
> Read this at the start of every session. Never re-derive facts already here.
> Cross-ref: [DECISIONS](DECISIONS.md) · [PROGRESS](PROGRESS.md) · [ROADMAP](ROADMAP.md)
> Last updated: 2026-04-11 (verified against actual codebase)

---

## ENVIRONMENT

| Key | Value |
|-----|-------|
| Worktree (SERVERS RUN HERE) | `C:\WorkStation\Projects\Python\Casper\.claude\worktrees\hungry-kepler\` |
| Main project | `C:\WorkStation\Projects\Python\Casper\` |
| **Rule** | Always edit worktree, never main project dir |
| Backend URL | http://localhost:8000 |
| Frontend URL | http://localhost:5173 |
| Venv | `backend\env\Scripts\python.exe` |
| Login | admin@casper.com / Admin@1234 |
| GitHub | https://github.com/amarendra-singh/Casper |
| DB | SQLite — `backend/casper.db` |
| Launch config | `.claude/launch.json` |

---

## ARCHITECTURE

### Backend
```
backend/app/
  core/           database.py, config.py, security.py, dependencies.py
  models/         user.py, platform.py, sku.py, vendor.py, category.py,
                  misc_item.py, global_settings.py, hsn_code.py
  schemas/        entries.py (batch ops), sku.py, vendor.py, platform.py ...
  routes/         auth.py, users.py, platforms.py, vendors.py, categories.py,
                  misc_items.py, global_settings.py, hsn_codes.py, hsn_code.py,
                  skus.py, entries.py
  services/       entries.py (upsert_row, upsert_batch, get_all_entries)
                  pricing.py (resolve_pricing_inputs, calculate_pricing)
alembic/versions/ 8 migration files — see Migrations section
```

### Frontend
```
frontend/src/
  pages/          SKUs.jsx/.css         ← main daily page
                  SKUs_OLD.jsx/.css     ← archived, ignore
                  Dashboard.jsx/.css
                  Vendors.jsx/.css
                  Pricing.jsx/.css
                  Login.jsx/.css
  components/     Layout.jsx/.css
                  SmartCell.jsx/.css
                  AddVendorModal.jsx
                  AddCategoryModal.jsx
                  ManageCategoriesModal.jsx/.css
                  dashboard/ReportHeader.jsx
  api/client.js   All API calls — single source of truth
  App.jsx         Route definitions
  index.css       ALL CSS variables + global styles
```

### Actual Routes (App.jsx — verified)
| Path | Component | Status |
|------|-----------|--------|
| `/login` | Login | ✅ |
| `/` | Dashboard | ✅ |
| `/skus` | SKUs | ✅ |
| `/vendors` | Vendors | ✅ |
| `/pricing/:skuId?` | Pricing | ✅ |
| `/sku-analysis` | — | ❌ Not built |
| `/settings` | — | ❌ Not built |

---

## MODELS (verified against actual code)

### Sku (`skus` table)
```python
id, shringar_sku (unique, UPPERCASE), vendor_sku,
vendor_id (Optional FK), category_id (Optional FK),
hsn_code_id (Optional FK), series, description,
is_active, created_at, updated_at
```

### SkuPricing (`sku_pricing` table)
```python
id, sku_id (FK), platform_id (FK),
# Inputs
price, package, logistics, addons, misc_total, gst, profit_percentage,
cr_percentage, cr_cost, damage_percentage, damage_cost,
# Computed outputs (stored)
breakeven, net_profit_20, bs_wo_gst, bank_settlement,
# Relationship
platform_configs → [SkuPlatformConfig]
```

### SkuPlatformConfig (`sku_platform_config` table)
```python
id, sku_pricing_id (FK), platform_id (FK),
ad_pct (Optional float),        # None = inherit platform.default_ad_pct
profit_pct (Optional float),    # None = inherit platform.default_profit_pct
platform_sku_name (Optional str),
created_at
```

### Platform (`platforms` table)
```python
id, name, cr_charge (float), cr_percentage (float),
default_ad_pct (float, default=0.0),
default_profit_pct (float, default=20.0),
is_active, tiers → [PlatformTier]
```

### Other Models
```
User:          id, name, email, password_hash, role, is_active
PlatformTier:  id, platform_id, tier_name, fee
Vendor:        id, name, short_code (unique, e.g. VRI), is_active
Category:      id, name, is_active
MiscItem:      id, name, amount, is_active
GlobalSettings: id, key, value  ← CLASS NAME GlobalSettings (plural!)
HsnCode:       id, code, description, gst_rate, category, is_custom
```

---

## PRICING FORMULA (DO NOT DEVIATE)

```
cr_cost      = platform.cr_charge × (cr_percentage / 100)
damage_cost  = price × (damage_percentage / 100)
breakeven    = price + package + logistics + addons + misc + cr_cost + damage_cost
               ← NO AD in base breakeven (AD is per-platform)

ad_amt       = price × (ad_pct / 100)
               ad_pct priority: SKU adAmt override → SKU adPct override → platform.default_ad_pct

plat_be      = breakeven + ad_amt
profit_amt   = plat_be × (profit_pct / 100)
bs_no_gst    = round(plat_be + profit_amt)
gst_amt      = round(bs_no_gst × gst_rate / 100)
bank_settle  = bs_no_gst + gst_amt + tier.fee
```

**GST special cases:** `apparel`/`footwear` → ≤₹2500 = 5%, >₹2500 = 18%

---

## API CLIENT (client.js — all exports, verified)
```js
// Auth
login, getMe, changePassword

// Platforms / Tiers
getPlatforms, createPlatform, updatePlatform, deletePlatform

// Vendors
getVendors, createVendor, updateVendor, deleteVendor

// Categories
getCategories, createCategory, updateCategory, deleteCategory

// Misc Items
getMiscItems, getMiscTotal, createMiscItem, updateMiscItem, deleteMiscItem

// Settings
getSettings, updateSetting

// SKUs
getSkus, getSku, createSku, updateSku, deleteSku

// Pricing
getPricingForSku, createPricing, updatePricing, deletePricing

// Users
getUsers, createUser, updateUser, deleteUser

// Entries (batch ops for SKU page)
getEntries, upsertBatch

// HSN
searchHsn, getHsnList, createHsnCode
```

---

## FRONTEND PATTERNS (DO NOT RE-INVENT)

### Dynamic column sizing (sizer pattern)
```jsx
<td className="ec w-sku">
  <div className="ec-sizer-wrap">
    <span className="ec-sizer mono">{row.sku || 'placeholder'}</span>
    <input className="ec-input mono" size={1} value={row.sku} ... />
  </div>
</td>
```
- `size={1}` on ALL inputs — removes browser default size=20 (~170px inflation)
- `ec-sizer-wrap`: `position:relative; display:inline-block; width:100%; pointer-events:none`
- `ec-sizer`: `visibility:hidden; white-space:pre` — drives column width
- `ec-input`: `position:absolute; inset:0; pointer-events:auto`
- SmartCell `sc-wrap` also needs `pointer-events:none`

### Number formatting — ALWAYS use `numStr()`
```js
function numStr(v) {
  if (v == null || v === '') return ''
  const n = parseFloat(v)
  if (isNaN(n)) return ''
  return n.toFixed(6).replace(/\.?0+$/, '') || '0'
}
```
Prevents `1.5e-9` → shows `0`. Use in `backendRowToFrontend()` + all sizer spans.

### Table layout
```css
.e-tbl      { border-collapse:collapse; width:max-content; }   /* NO min-width:100% */
.e-scroll   { flex:1; min-height:0; overflow-x:auto; overflow-y:auto; }
.entries-page { flex:1; display:flex; flex-direction:column; min-height:0; }
```

### Platform columns (3 per platform)
| Sub-col | Class | Width | Content |
|---------|-------|-------|---------|
| AD inputs | `w-plat-ad` | 180px fixed | % input + ₹ input + alias btn |
| Tier | `w-plat-tier` | 72px | Tier dropdown |
| BS | `w-plat-bs` | min 62px, NO max-width | Computed BS (gold) |
- Group header: `colSpan={3}`, `totalCols` uses `activePlats.length * 3`

### Autosave
- Debounced: 1.5s after last keystroke
- Hard fallback: `setInterval` every 30s
- Only saves rows with `status === DIRTY || NEW` AND has `sku` AND `price`

---

## MIGRATIONS (all 8 files, verified)
```
620b24754aaf — initial_tables
d334cae979e4 — add_all_tables
fca2ca12d777 — sku_and_pricing_tables
a413eb320126 — add_hsn_codes_table_and_link_to_skus
70964a6904fb — add_series_to_skus
69a98e6c92d7 — merge_heads
b8f3a91c2e54 — add_sku_platform_config (default_ad_pct, default_profit_pct)
c3f7a8e1d924 — add_platform_sku_name  ← CURRENT HEAD
```
- Always use `batch_alter_table()` for ALTER TABLE (SQLite limitation)
- Multiple heads: `alembic merge heads` → `alembic upgrade heads`

---

## CSS VARIABLES (complete, verified from index.css)
```css
--bg:#ECEAE4        --surface:#FFFFFF      --surface-2:#F7F6F3   --surface-3:#F0EEEA
--border:#EBEBEB    --border-2:#E0DDD6
--accent:#E8365D    --accent-hover:#D42E52  --accent-dim:rgba(232,54,93,0.08)
--gold:#C9A96E      --gold-dim:rgba(201,169,110,0.12)  --gold-glow:rgba(201,169,110,0.08)
--black-btn:#1A1917
--text:#111110      --text-2:#6B6866        --text-3:#A8A59F
--green:#16A34A     --green-dim:#DCFCE7     --green-text:#166534
--red:#DC2626       --red-dim:#FEE2E2       --red-text:#991B1B
--amber:#D97706     --amber-dim:#FEF3C7     --amber-text:#92400E
--font-ui:'Plus Jakarta Sans'   --font-display:'Plus Jakarta Sans'   --font-mono:'JetBrains Mono'
--radius:12px       --radius-sm:8px         --radius-xs:6px        --radius-pill:99px
--shadow-sm:0 1px 2px rgba(0,0,0,0.04)...
--shadow:0 2px 8px rgba(0,0,0,0.06)...
--shadow-lg:0 4px 24px rgba(0,0,0,0.08)...
```

---

## KEY DESIGN DECISIONS (permanent)
| Decision | Value |
|----------|-------|
| CR meaning | Customer Return COST (not Commission Rate) |
| Accent | `#E8365D` red-pink (not gold — too jewelry-specific) |
| Gold | `#C9A96E` — used for BS values, highlights |
| Font | Plus Jakarta Sans + JetBrains Mono |
| Sidebar bg | Same as outer `#ECEAE4` — no separator |
| Dark mode | Add AFTER all pages complete in light |
| Page naming | Entries → SKUs (main), SKUs → SKU Analysis (insights, not built) |

---

## SEED DATA
| Platform | CR Charge | Tiers |
|----------|-----------|-------|
| Meesho | ₹160 | Gold ₹20, Silver ₹15, Bronze ₹10 |
| Flipkart | ₹170 | Gold ₹25, Silver ₹18, Bronze ₹12 |
| Amazon | ₹180 | Gold ₹30, Silver ₹22, Bronze ₹15 |
| Snapdeal | ₹150 | Gold ₹18, Silver ₹12 |
| Myntra | ₹175 | Gold ₹22, Silver ₹16 |

Vendors: Varni Sales (VRI), Vesu Imitation (VIC)
SKU format: `SHJ-{category_code}-{vendor_code}-{product_code}` e.g. `SHJ-JS-VRI-N5-GREEN`

---

## KNOWN GOTCHAS / TRAPS
1. Always edit **WORKTREE**, not main project dir
2. `vendor_id`/`category_id` schema → must be `Optional[int] = None`
3. `ec-sizer-wrap` → `pointer-events:none`, inputs inside → `pointer-events:auto`
4. SmartCell `sc-wrap` → same pointer-events rule
5. Group header sub-headers sticky offset = `top:24px` (not 27px)
6. `w-plat-bs` must NOT have `max-width`
7. Never `String()` on floats in sizer spans → use `numStr()`
8. `size={1}` on all number inputs — removes 170px browser inflation
9. `GlobalSettings` class name is plural (not `GlobalSetting`)
10. `SKUs_OLD.jsx` exists — do not edit or import it
