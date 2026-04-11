# CASPER — MEMORY FILE
> Read this at the start of every session. Never re-derive facts already here.
> Cross-ref: [DECISIONS](DECISIONS.md) · [PROGRESS](PROGRESS.md) · [ROADMAP](ROADMAP.md)
> Last updated: 2026-04-11

---

## ENVIRONMENT

| Key | Value |
|-----|-------|
| Backend path | `C:\WorkStation\Projects\Python\Casper\backend\` |
| Frontend path | `C:\WorkStation\Projects\Python\Casper\frontend\` |
| Worktree path | `C:\WorkStation\Projects\Python\Casper\.claude\worktrees\hungry-kepler\` |
| **Worktree is what runs** — always edit worktree files, not main project files |
| Backend URL | http://localhost:8000 |
| Frontend URL | http://localhost:5173 |
| Venv | `backend\env\Scripts\python.exe` |
| Default login | admin@casper.com / Admin@1234 |
| GitHub | https://github.com/amarendra-singh/Casper |
| DB | SQLite — `backend/casper.db` |
| Launch config | `.claude/launch.json` (absolute paths) |

---

## ARCHITECTURE

### Backend (FastAPI + SQLAlchemy + Alembic + SQLite)
```
backend/app/
  models/         # SQLAlchemy ORM models
  schemas/        # Pydantic request/response schemas
  routes/         # FastAPI routers (entries, skus, vendors, platforms, etc.)
  services/       # Business logic (entries.py, pricing.py)
  core/           # database.py, config.py, auth.py
alembic/versions/ # Migration files — run in order
```

### Frontend (React + Vite)
```
frontend/src/
  pages/          # SKUs.jsx, Dashboard.jsx, Vendors.jsx, Pricing.jsx
  components/     # SmartCell, Layout, modals
  api/client.js   # Axios wrapper — all API calls here
```

### Key Models
| Model | Table | Notes |
|-------|-------|-------|
| Platform | platforms | `default_ad_pct`, `default_profit_pct`, `cr_charge`, `tiers` (JSON) |
| SkuPlatformConfig | sku_platform_configs | Per-SKU per-platform AD override — `ad_pct`, `profit_pct`, `platform_sku_name` |
| SkuPricing | sku_pricings | Main pricing row per SKU |
| GlobalSettings | global_settings | `misc_total`, `profit_pct` defaults |

---

## PRICING FORMULA (DO NOT DEVIATE)

```
breakeven     = price + package + logistics + addons + misc + cr_cost + damage_cost
cr_cost       = platform.cr_charge × (cr_percentage / 100)
damage_cost   = price × (damage_percentage / 100)
ad_amt        = price × (ad_pct / 100)          ← per-platform, inherits platform.default_ad_pct
plat_be       = breakeven + ad_amt
profit_amt    = plat_be × (profit_pct / 100)
bs_no_gst     = round(plat_be + profit_amt)
gst_amt       = round(bs_no_gst × gst_rate / 100)
bank_settle   = bs_no_gst + gst_amt + tier.fee
```

**AD inheritance order:** SKU override (adAmt) → SKU override (adPct) → platform.default_ad_pct

---

## GST RULES
- `apparel` → 5% if price ≤ 2500, else 18%
- `footwear` → same as apparel
- All others → numeric value stored (0, 3, 5, 18, 40)

---

## FRONTEND PATTERNS (DO NOT RE-INVENT)

### Dynamic column sizing (sizer pattern)
```jsx
// Column width = widest text across all rows. Never use CSS min-width for text cols.
<td className="ec w-sku">
  <div className="ec-sizer-wrap">
    <span className="ec-sizer mono">{row.sku || 'placeholder'}</span>
    <input className="ec-input mono" size={1} value={row.sku} ... />
  </div>
</td>
```
- `size={1}` on ALL inputs — removes browser's default size=20 (~170px inflation)
- `ec-sizer-wrap`: `position:relative; display:inline-block; width:100%`
- `ec-sizer`: `visibility:hidden; white-space:pre; position absolute` — drives width
- `ec-input`: `position:absolute; inset:0`
- `pointer-events:none` on wrappers, `pointer-events:auto` on inputs

### Number formatting — ALWAYS use `numStr()`
```js
function numStr(v) {
  if (v == null || v === '') return ''
  const n = parseFloat(v)
  if (isNaN(n)) return ''
  return n.toFixed(6).replace(/\.?0+$/, '') || '0'
}
```
- Prevents scientific notation (e.g. `1.5e-9` → `0`)
- Use in `backendRowToFrontend()` for all numeric fields
- Use in sizer spans instead of `String(c.xxx)`

### Table layout strategy
```css
.e-tbl { border-collapse: collapse; width: max-content; }  /* no min-width:100% */
.e-scroll { flex:1; min-height:0; overflow-x:auto; overflow-y:auto; }
.entries-page { flex:1; display:flex; flex-direction:column; min-height:0; }
```

### Platform columns — 3 cols per platform
| Sub-col | Class | Width | Content |
|---------|-------|-------|---------|
| AD inputs | `w-plat-ad` | 180px fixed | % input + ₹ input + alias btn |
| Tier | `w-plat-tier` | 72px | Tier dropdown |
| BS | `w-plat-bs` | min 62px, no max | Computed BS (gold) |
- Group header: `colSpan={3}`
- `totalCols` uses `activePlats.length * 3`

---

## ALEMBIC MIGRATIONS (in order)
1. `911d6ab0f0f3` — base
2. `b8f3a91c2e54` — add sku_platform_config (default_ad_pct, default_profit_pct, SkuPlatformConfig table)
3. `c3f7a8e1d924` — add platform_sku_name to sku_platform_configs

---

## KNOWN GOTCHAS / TRAPS
1. **Always edit the WORKTREE**, not `C:\WorkStation\Projects\Python\Casper\` — the servers run from worktree
2. **`vendor_id` / `category_id` in sku.py schema must be `Optional[int] = None`** — caused 500 errors when non-optional
3. **`ec-sizer-wrap` needs `pointer-events:none`** — otherwise blocks click events on inputs underneath
4. **SmartCell (`sc-wrap`) also needs `pointer-events:none`** — same issue
5. **Group header sub-headers sticky offset = `top:24px`** (not 27px) — measured from actual DOM
6. **`w-plat-bs` must NOT have `max-width`** — clips large BS values
7. **Never use `String()` on computed floats in sizer spans** — use `numStr()` to prevent `1.5e-9` etc.
8. **`size={1}` on all number inputs** — critical, removes 170px browser default size inflation

---

## CSS VARIABLES (complete — from index.css)
```css
--bg: #ECEAE4          --surface: #FFFFFF       --surface-2: #F7F6F3
--surface-3: #F0EEEA   --border: #EBEBEB         --border-2: #E0DDD6
--accent: #E8365D      --accent-dim: rgba(232,54,93,0.08)
--black-btn: #1A1917   --text: #111110           --text-2: #6B6866
--text-3: #A8A59F      --green: #16A34A          --red: #DC2626
--amber: #D97706       --gold: (warm yellow)
--font-ui: Plus Jakarta Sans    --font-mono: JetBrains Mono
```

## LAYOUT STRUCTURE
```
.layout (flex row, 100vh, bg #ECEAE4, padding 10px)
  aside.sidebar (240px, same bg — no separator)
    .ic-strip (42px, icon buttons)
    .nav-text (text nav, company switcher, sections)
  .right-col (flex col)
    .topbar (ON GRAY bg, outside white box, pill search)
    .main-wrap (WHITE rounded box, border-radius:14px, shadow)
      main.page-content (flex col, padding 24px 28px, height:100%, overflow:hidden)
        → children use flex:1 to fill remaining height
```

## KEY DESIGN DECISIONS (permanent — do not revisit)
| Decision | Value | Why |
|----------|-------|-----|
| CR meaning | Customer Return COST (not Commission Rate) | Business terminology |
| Accent color | `#E8365D` red-pink | Not gold — too jewelry-specific |
| Font | Plus Jakarta Sans (UI) + JetBrains Mono (numbers) | Neutral SaaS feel |
| Sidebar bg | Same as outer `#ECEAE4` — no separator | Seamless look |
| Topbar | Outside white box, on gray bg | Search visible on gray |
| Dark mode timing | Add AFTER all pages done in light | Avoid double work |
| Page renamed | Entries → SKUs (main page), SKUs → SKU Analysis (insights) | Clearer naming |

## SEED DATA (platforms)
| Platform | CR Charge | Tiers |
|----------|-----------|-------|
| Meesho | ₹160 | Gold ₹20, Silver ₹15, Bronze ₹10 |
| Flipkart | ₹170 | Gold ₹25, Silver ₹18, Bronze ₹12 |
| Amazon | ₹180 | Gold ₹30, Silver ₹22, Bronze ₹15 |
| Snapdeal | ₹150 | Gold ₹18, Silver ₹12 |
| Myntra | ₹175 | Gold ₹22, Silver ₹16 |

Vendors: Varni Sales (VRI), Vesu Imitation (VIC)
HSN: 46 codes, 5 categories → run `python casper_hsn_import.py`
SKU naming: `SHJ-{category_code}-{vendor_code}-{product_code}` e.g. `SHJ-JS-VRI-N5-GREEN`

## AUTH DETAILS
- Access token: 60 min | Refresh token: 7 days | Algorithm: HS256
- Auto-refresh: Axios interceptor catches 401 → `/auth/refresh` → retries
- Roles: `super_admin` (full), `admin` (manage data), `viewer` (read-only)
- localStorage: `access_token`, `refresh_token`, `casper_col_visibility`, `casper-theme`

## ALEMBIC NOTES
- Always use `batch_alter_table()` for ALTER TABLE (SQLite limitation)
- Multiple heads: `alembic merge heads` → `alembic upgrade heads`
- Current head: `c3f7a8e1d924`

## REACT COMPONENT QUICK REF
| Component | File | Purpose |
|-----------|------|---------|
| SKUs | `pages/SKUs.jsx` | Main SKU pricing table |
| SmartCell | `components/SmartCell.jsx` | Autocomplete dropdown input (vendor, category) |
| Layout | `components/Layout.css` | `page-content` flex column, height propagation |
| AddVendorModal | `components/AddVendorModal.jsx` | Add new vendor inline |
| ManageCategoriesModal | `components/ManageCategoriesModal.jsx` | Category CRUD |
