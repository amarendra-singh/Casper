# Casper — Project Ledger
> Last Updated: 22 March 2026  
> Maintained by: Amarendra Singh  
> Single source of truth for the Casper project.

---

## TABLE OF CONTENTS
1. [Project Overview](#1-project-overview)
2. [Product Vision](#2-product-vision)
3. [Repository Structure](#3-repository-structure)
4. [BACKEND — Full Details](#4-backend--full-details)
5. [FRONTEND — Full Details](#5-frontend--full-details)
6. [Pricing Formula](#6-pricing-formula)
7. [Design System](#7-design-system)
8. [Navigation Structure](#8-navigation-structure)
9. [Completed Features](#9-completed-features)
10. [In Progress](#10-in-progress)
11. [Pending / Backlog](#11-pending--backlog)
12. [Ideas Parking Lot](#12-ideas-parking-lot)
13. [Design Decisions Log](#13-design-decisions-log)
14. [Known Issues & Workarounds](#14-known-issues--workarounds)
15. [Setup Instructions](#15-setup-instructions)
16. [Git Workflow](#16-git-workflow)
17. [Next Immediate Steps](#17-next-immediate-steps)

---

## 1. PROJECT OVERVIEW

**Casper** is a pricing intelligence and profitability management platform for ecommerce sellers.

| Field | Detail |
|-------|--------|
| App Name | Casper |
| Tagline | Pricing intelligence for ecommerce sellers |
| Status | Active Development |
| Testing With | Shringar House Jewellery (SHJ) |
| Owner | Amarendra Singh |
| Repo | https://github.com/amarendra-singh/Casper |
| Local Path | C:\WorkStation\Projects\Python\Casper |
| Backend URL | http://localhost:8000 |
| Frontend URL | http://localhost:5173 |
| API Docs | http://localhost:8000/docs (debug mode only) |

---

## 2. PRODUCT VISION

### Problem
Ecommerce sellers manually calculate pricing in Excel — error-prone, slow, not scalable across multiple platforms.

### Solution
A web SaaS that auto-calculates breakeven, profit, bank settlement per SKU across all platforms.

### Target Users
- Small to medium ecommerce sellers
- Any product category (jewellery, clothing, electronics, accessories)
- Solo operators to small teams
- Sellers on Meesho, Amazon, Flipkart, Snapdeal, Myntra, own website

### Multi-Tenant Plan
One Casper account → multiple companies/brands (planned, not yet implemented)

---

## 3. REPOSITORY STRUCTURE

```
C:\WorkStation\Projects\Python\Casper\
├── backend\                    ← FastAPI Python app
├── frontend\                   ← React + Vite app
├── casper_ledger.md            ← this file
└── casper_context.json         ← AI-readable context
```

---

## 4. BACKEND — Full Details

### 4.1 Stack
```
Language:     Python 3.13
Framework:    FastAPI 0.111
Database:     SQLite (aiosqlite) — local dev
              MySQL — planned for production
ORM:          SQLAlchemy 2.0 async
Migrations:   Alembic
Auth:         JWT Bearer tokens (python-jose)
Passwords:    bcrypt hashing
Config:       python-decouple (.env file)
OS:           Windows local development
```

### 4.2 Folder Structure
```
backend/
├── .env                          ← sensitive config (never commit)
├── .env.example                  ← safe template to commit
├── .gitignore
├── requirements.txt
├── casperv2_seed_data.json       ← platforms, vendors, categories seed
├── casperv2_import.py            ← run once to seed DB
├── casper_hsn_seed.json          ← 46 HSN codes seed
├── casper_hsn_import.py          ← run once to seed HSN codes
├── casper_db.db                  ← SQLite database file
├── alembic.ini
├── alembic/
│   └── versions/                 ← migration files
└── app/
    ├── __init__.py
    ├── main.py                   ← FastAPI app, registers all routers
    ├── core/
    │   ├── config.py             ← reads .env via python-decouple, Settings class
    │   ├── database.py           ← async SQLAlchemy engine + session + Base
    │   ├── security.py           ← bcrypt + JWT create/decode
    │   └── dependencies.py       ← auth guards: get_current_user, require_roles
    ├── models/
    │   ├── __init__.py           ← imports all models (Alembic detection)
    │   ├── user.py
    │   ├── platform.py           ← Platform + PlatformTier
    │   ├── vendor.py
    │   ├── category.py
    │   ├── misc_item.py
    │   ├── global_settings.py    ← class name: GlobalSettings (plural)
    │   ├── hsn_code.py
    │   └── sku.py                ← Sku + SkuPricing
    ├── schemas/
    │   ├── auth.py               ← LoginRequest, TokenResponse, RefreshRequest
    │   ├── user.py               ← UserCreate, UserUpdate, UserResponse
    │   ├── platform.py           ← PlatformCreate/Update/Response, TierCreate/Response
    │   ├── vendor.py
    │   ├── category.py
    │   ├── misc_item.py          ← MiscItemCreate/Update/Response, MiscTotalResponse
    │   ├── global_settings.py    ← GlobalSettingUpdate, GlobalSettingResponse
    │   ├── hsn_code.py           ← HsnCodeCreate, HsnCodeResponse
    │   ├── sku.py                ← SkuCreate/Update/Response, PricingCreate/Update/Response
    │   └── entries.py            ← EntryRowInput, EntryRowResult, UpsertBatchRequest/Response, EntryRowResponse
    ├── routes/
    │   ├── auth.py
    │   ├── users.py
    │   ├── platforms.py
    │   ├── vendors.py
    │   ├── categories.py
    │   ├── misc_items.py
    │   ├── global_settings.py
    │   ├── hsn_codes.py
    │   ├── skus.py               ← exports: sku_router, pricing_router
    │   └── entries.py            ← GET /entries/, POST /entries/upsert-batch
    ├── services/
    │   ├── pricing.py            ← resolve_pricing_inputs, calculate_pricing
    │   └── entries.py            ← upsert_row, upsert_batch, get_all_entries
    └── utils/
        ├── seed.py               ← creates super admin + default settings
        └── import_data.py        ← reads casperv2_seed_data.json
```

### 4.3 Database Models

```python
# User
id, name, email, password_hash
role: enum(super_admin, admin, viewer)
is_active: bool

# Platform
id, name, cr_charge: float, cr_percentage: float, is_active: bool

# PlatformTier
id, platform_id(FK→Platform), tier_name, fee: float

# Vendor
id, name, short_code, is_active: bool

# Category
id, name, is_active: bool

# MiscItem
id, name, amount: float, is_active: bool

# GlobalSettings
id, key: str, value: str, description: str
# Keys: damage_percent (default: "15.0")

# HsnCode
id, code: str, description: str
gst_rate: float, category: str, is_custom: bool

# Sku
id, shringar_sku: str (UPPERCASE, unique)
vendor_id(FK→Vendor), category_id(FK→Category)
hsn_code_id(FK→HsnCode), description: str
is_active: bool

# SkuPricing
id, sku_id(FK→Sku), platform_id(FK→Platform)
price, package, logistics, addons, misc_total
cr_percentage, cr_cost
damage_percentage, damage_cost
gst, breakeven, net_profit_20, bs_wo_gst, bank_settlement
is_active: bool
```

### 4.4 API Routes

All routes prefixed with `/api/v1`

```
AUTH
  POST /auth/login               {email, password} → {access_token, refresh_token, role, name}
  POST /auth/refresh             {refresh_token} → new token pair
  GET  /auth/me                  → current user info
  POST /auth/change-password     {current_password, new_password}

USERS (super_admin only for write)
  GET    /users/
  POST   /users/
  PATCH  /users/{id}
  DELETE /users/{id}             cannot delete self

PLATFORMS
  GET    /platforms/             returns platforms with tiers
  POST   /platforms/
  PATCH  /platforms/{id}
  DELETE /platforms/{id}
  POST   /platforms/{id}/tiers
  PATCH  /platforms/{id}/tiers/{tier_id}
  DELETE /platforms/{id}/tiers/{tier_id}

VENDORS
  GET/POST/PATCH/DELETE /vendors/

CATEGORIES
  GET/POST/PATCH/DELETE /categories/

MISC ITEMS
  GET/POST/PATCH/DELETE /misc-items/
  GET /misc-items/total          → {total: float} sum of active items

GLOBAL SETTINGS
  GET    /settings/              → list all settings
  GET    /settings/{key}         → get one setting
  PATCH  /settings/{key}         {value, description}

HSN CODES
  GET  /hsn-codes/               → all HSN codes
  GET  /hsn-codes/search?q=      → search by code or description
  POST /hsn-codes/               → create custom HSN code
  GET  /hsn-codes/{code}         → get by code string

SKUS
  GET    /skus/
  POST   /skus/
  PATCH  /skus/{id}
  DELETE /skus/{id}

PRICING
  POST   /pricing/               → create + auto-calculate all fields
  PATCH  /pricing/{id}           → update + recalculate everything
  GET    /pricing/sku/{sku_id}   → all platform pricing for a SKU
  DELETE /pricing/{id}

ENTRIES (batch operations)
  GET  /entries/                 → load all SKUs with latest pricing (for SKU page)
  POST /entries/upsert-batch     → {rows: [...]} create/update multiple rows
```

### 4.5 Auth Details
```
Access token:   expires in 60 minutes
Refresh token:  expires in 7 days
Algorithm:      HS256
Header:         Authorization: Bearer {token}
Roles:
  super_admin → full access
  admin       → manage data, cannot manage users
  viewer      → read only
```

### 4.6 Seed Data

```
Default User:
  email:    admin@casperv2.com
  password: Admin@1234  ← CHANGE AFTER FIRST LOGIN
  role:     super_admin

Platforms:
  Meesho:   CR ₹160, 10% | Gold₹20, Silver₹15, Bronze₹10
  Flipkart: CR ₹170, 10% | Gold₹25, Silver₹18, Bronze₹12
  Amazon:   CR ₹180, 10% | Gold₹30, Silver₹22, Bronze₹15
  Snapdeal: CR ₹150, 10% | Gold₹18, Silver₹12
  Myntra:   CR ₹175, 10% | Gold₹22, Silver₹16

Vendors:
  Varni Sales    → VRI (active)
  Vesu Imitation → VIC (active)

Categories:
  Jewellery (active), Shapewear, Clothing, Glass, Saare (all inactive)

Misc Items:
  Rent ₹4, Electricity ₹4, Internet ₹4 → Total ₹12/SKU

Global Settings:
  damage_percent = 15.0

HSN Codes: 46 codes
  Jewellery:   3%
  Clothing:    5-12%
  Accessories: 3-28%
  Glassware:   12-28%
  Sarees:      5-12%
```

### 4.7 .env Template
```
APP_NAME=CasperV2
APP_ENV=development
APP_DEBUG=True
APP_HOST=0.0.0.0
APP_PORT=8000
DATABASE_URL=sqlite+aiosqlite:///./casperv2.db
DATABASE_URL_SYNC=sqlite:///./casperv2.db
SECRET_KEY=CHANGE-THIS-TO-A-RANDOM-32-CHAR-STRING
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
DEFAULT_DAMAGE_PERCENT=15.0
```

### 4.8 Backend Architecture Principles
```
- Thin routes, fat services
  → Business logic in services/pricing.py and services/entries.py
  → Routes only handle HTTP, validation, auth
  → Makes logic testable and reusable

- Async throughout
  → All DB operations are async (aiosqlite + SQLAlchemy async)
  → FastAPI async endpoints

- Settings singleton
  → python-decouple reads .env
  → Settings class with lru_cache → parsed once at startup

- Migration pattern (SQLite)
  → Always use batch_alter_table() for ALTER TABLE
  → SQLite doesn't support inline ALTER COLUMN
```

### 4.9 Alembic Status
```
Current head:  69a98e6c92d7
Models added:  User, Platform, PlatformTier, Vendor, Category,
               MiscItem, GlobalSettings, HsnCode, Sku, SkuPricing
```

### 4.10 Backend Run Command
```bash
cd backend
venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

---

## 5. FRONTEND — Full Details

### 5.1 Stack
```
Framework:    React 18
Build Tool:   Vite
Routing:      React Router v6
HTTP Client:  Axios
Fonts:        Plus Jakarta Sans, JetBrains Mono (Google Fonts)
Styling:      Plain CSS + CSS Variables (no Tailwind, no CSS-in-JS)
State:        useState, useContext (no Redux, no Zustand)
Auth State:   React Context (AuthContext)
```

### 5.2 Folder Structure
```
frontend/
├── index.html                    ← Vite entry, loads Google Fonts
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx                  ← React root, wraps with BrowserRouter + AuthProvider
    ├── App.jsx                   ← Route definitions
    ├── index.css                 ← ALL CSS variables + global styles + utility classes
    ├── api/
    │   └── client.js             ← Axios instance + all API call functions
    ├── context/
    │   └── AuthContext.jsx       ← JWT auth state, login/logout, token refresh
    ├── components/
    │   ├── Layout.jsx            ← sidebar + topbar shell
    │   ├── Layout.css
    │   ├── SmartCell.jsx         ← autocomplete input for vendor/category
    │   ├── SmartCell.css
    │   ├── AddVendorModal.jsx    ← create vendor in backend + auto short_code
    │   └── AddCategoryModal.jsx  ← create category in backend
    └── pages/
        ├── Login.jsx / Login.css
        ├── Dashboard.jsx / Dashboard.css
        ├── SKUs.jsx / SKUs.css         ← main daily page (was Entries)
        ├── SKUAnalysis.jsx             ← insights page (was SKUs) — not yet built
        └── Pricing.jsx / Pricing.css
```

### 5.3 App.jsx — Route Structure
```jsx
<BrowserRouter>
  <AuthProvider>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/"            element={<Dashboard />} />
        <Route path="/skus"        element={<SKUs />} />
        <Route path="/sku-analysis" element={<SKUAnalysis />} />
        <Route path="/pricing/:skuId?" element={<Pricing />} />
        <Route path="/settings"    element={<Settings />} />
      </Route>
    </Routes>
  </AuthProvider>
</BrowserRouter>
```

### 5.4 AuthContext — Details
```javascript
// Provides: user, login(), logout(), loading
// Stores: access_token, refresh_token in localStorage
// On mount: reads token → calls /auth/me → sets user
// login(email, password): calls /auth/login → stores tokens
// logout(): clears localStorage + redirects to /login
// Auto-refresh: Axios interceptor catches 401 → calls /auth/refresh → retries
// localStorage keys:
//   access_token
//   refresh_token
```

### 5.5 client.js — All API Functions
```javascript
// Auth
login(email, password)
getMe()
changePassword(currentPassword, newPassword)

// Vendors
getVendors()
createVendor(data)        // {name, short_code}
updateVendor(id, data)
deleteVendor(id)

// Categories
getCategories()
createCategory(data)      // {name}
updateCategory(id, data)
deleteCategory(id)

// Platforms
getPlatforms()            // includes tiers array
createPlatform(data)
updatePlatform(id, data)
deletePlatform(id)
createTier(platformId, data)
updateTier(platformId, tierId, data)

// Misc Items
getMiscItems()
createMiscItem(data)
updateMiscItem(id, data)
deleteMiscItem(id)
getMiscTotal()            // returns {total: float}

// Settings
getSettings()             // returns array of {key, value, description}
updateSetting(key, data)  // {value, description}

// HSN Codes
getHsnCodes()
searchHsnCodes(query)     // GET /hsn-codes/search?q=query
createHsnCode(data)

// SKUs
getSkus()
createSku(data)
updateSku(id, data)
deleteSku(id)

// Pricing
getPricingForSku(skuId)
createPricing(data)
updatePricing(id, data)
deletePricing(id)

// Entries (batch)
getEntries()              // GET /entries/ — loads all for SKU page
upsertBatch(rows)         // POST /entries/upsert-batch
```

### 5.6 Layout Component — Details
```
File: src/components/Layout.jsx + Layout.css

Structure:
  .layout (flex row, 100vh, bg: #ECEAE4, padding: 10px)
    ├── aside.sidebar (240px, same bg as outer — no visual separation)
    │   ├── .ic-strip (42px icon column)
    │   │   ├── .ic-logo (C logo — black rounded square)
    │   │   ├── .ic-nav (icon buttons for each section)
    │   │   └── .ic-bottom (notifications, settings, avatar)
    │   └── .nav-text (text navigation)
    │       ├── .nav-brand (Casper + chevron)
    │       ├── .co-wrap (company switcher dropdown)
    │       ├── .nav-scroll (scrollable nav sections)
    │       │   ├── WORKSPACE section (collapsible)
    │       │   ├── ANALYTICS section (collapsible, Coming Soon items)
    │       │   ├── REPORTS section (collapsible, badge, tree groups)
    │       │   └── SETTINGS section (collapsible)
    │       └── .nav-footer (user info + logout)
    └── .right-col (flex column, flex:1)
        ├── .topbar (on gray bg — OUTSIDE white box)
        │   ├── .topbar-search-wrap (pill search + dropdown)
        │   └── .topbar-right (menu + gradient avatar + red plus)
        └── .main-wrap (WHITE rounded box, border-radius:14px)
            └── main.page-content (scrollable page area)

Key behavior:
  - Sidebar sections collapse/expand (useState open{})
  - Tree groups in Reports collapse/expand (useState treeOpen{})
  - Company switcher dropdown (useState showCo)
  - Search filters ALL_SEARCH array → shows dropdown results
  - Outside click closes dropdowns (useEffect + useRef)
  - NavLink active class: 'nav-item active'
```

### 5.7 SmartCell Component
```
File: src/components/SmartCell.jsx

Props:
  value       current value string
  options     [{label, sublabel?}] array for autocomplete
  placeholder input placeholder
  onChange    called on every keystroke
  onSelect    called when option selected from dropdown
  onAddNew    called when user clicks "+ Add as new X"
  addNewLabel label for the add new option

Behavior:
  - Shows dropdown when typing (filters options by label)
  - Keyboard: Tab/Enter to select, Escape to close
  - Shows "+ Add as new vendor/category" at bottom of list
  - onAddNew passes the typed text to parent
  - Parent opens AddVendorModal or AddCategoryModal
```

### 5.8 SKUs Page — Full Details
```
File: src/pages/SKUs.jsx (renamed from Entries.jsx)
Route: /skus

State variables:
  vendors       []    loaded from API
  categories    []    loaded from API
  platforms     []    loaded from API
  activePlats   []    currently shown platform columns
  miscDef       12    default misc total
  profDef       20    default profit %
  rows          []    all spreadsheet rows
  colVis        {}    column group visibility
  vendorModal   null  vendor name if modal open
  categoryModal null  category name if modal open
  pendingRowId  null  which row triggered modal
  loading       bool

Row object shape:
  id          local ID (++_id counter)
  skuId       backend SKU id (null if new)
  status      'new' | 'dirty' | 'saving' | 'saved' | 'error'
  errorMsg    error string if status=error
  vendor      string
  vendorId    int | null
  vshort      string
  vsku        string
  sku         string (UPPERCASE)
  category    string
  categoryId  int | null
  price       string
  pkg         string
  log         string
  ad          string
  addons      string
  misc        string
  crPct       string
  crAmt       string
  dmgPct      string
  dmgAmt      string
  profPct     string
  profAmt     string
  gst         string
  tiers       {platformId: tierIndex}

Column groups (COL_GROUPS):
  skuDetails:    vshort, vsku, category
  costBreakdown: pkg, log, ad, addons, misc
  calculations:  crpct, cramt, dmgpct, dmgamt, profpct, profamt, bsnogst, gst

Always visible columns:
  vendor, sku (SKU group)
  price (Unit Economics)
  breakeven (Profitability)
  finalBS (Bank Settlement)
  all active platform columns

Save logic:
  saveRows(rowsToSave)  → marks saving → calls upsertBatch → marks saved/error
  saveAll()             → filters dirty rows with sku+price → calls saveRows
  Auto-save:            setInterval 30s → finds dirty rows → calls saveRows
  Page close:           beforeunload event → warns if dirty rows exist

Load on mount:
  Promise.all([getVendors, getCategories, getPlatforms,
               getMiscTotal, getSettings, getEntries])
  → if entries.length > 0: load them
  → else: show 3 empty rows

Compute function:
  compute(row, miscDef, profDef, platforms)
  → returns {crPct, crAmt, dmgPct, dmgAmt, be, profPct, profAmt, bsNoGst, finalBS}
  → bidirectional: if crAmt set → compute crPct, else use crPct
  → same for damage and profit

platBS function:
  platBS(row, platform, miscDef, profDef, platforms)
  → returns {bs, tierIdx} for a specific platform
  → uses platform's own cr_charge
```

### 5.9 CSS Architecture
```
index.css
  → ALL CSS custom properties (variables)
  → Global reset
  → Utility classes: .btn, .btn-primary, .btn-accent, .btn-ghost, .btn-danger
  → .input, .input-group
  → .card, .badge (badge-green, badge-red, badge-accent, badge-gray, badge-amber)
  → table/th/td base styles
  → .modal, .overlay
  → .page-header, .page-title, .page-subtitle
  → .toast, .loader, .loader-page
  → .form-grid, .form-actions, .divider
  → Animations: fadeIn, slideUp, spin

Component CSS files:
  Layout.css    → sidebar, topbar, nav, search
  Login.css     → login page only
  Dashboard.css → dashboard page only
  SKUs.css      → SKU spreadsheet table (large file)
  Pricing.css   → pricing page only
  SmartCell.css → autocomplete component
  Entries.css   → (to be renamed SKUs.css)

Rule:
  index.css = shared/global
  *.css = page or component specific only
```

### 5.10 CSS Variables Reference
```css
/* Backgrounds */
--bg:          #ECEAE4   /* warm greige outer */
--surface:     #FFFFFF   /* white content area */
--surface-2:   #F7F6F3   /* subtle backgrounds */
--surface-3:   #F0EEEA

/* Borders */
--border:      #EBEBEB
--border-2:    #E0DDD6

/* Brand */
--accent:      #E8365D   /* red-pink */
--accent-hover:#D42E52
--accent-dim:  rgba(232,54,93,0.08)
--black-btn:   #1A1917   /* primary button */

/* Text */
--text:        #111110
--text-2:      #6B6866
--text-3:      #A8A59F

/* Semantic */
--green:       #16A34A   /* profit */
--green-dim:   #DCFCE7
--green-text:  #166534
--red:         #DC2626   /* loss */
--red-dim:     #FEE2E2
--red-text:    #991B1B
--amber:       #D97706   /* warning */
--amber-dim:   #FEF3C7
--amber-text:  #92400E

/* Typography */
--font-ui:     'Plus Jakarta Sans', system-ui, sans-serif
--font-mono:   'JetBrains Mono', monospace

/* Spacing */
--radius:      12px
--radius-sm:   8px
--radius-xs:   6px
--radius-pill: 99px

/* Shadows */
--shadow-sm:   0 1px 2px rgba(0,0,0,0.04), 0 1px 6px rgba(0,0,0,0.04)
--shadow:      0 2px 8px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)
--shadow-lg:   0 4px 24px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.04)
```

### 5.11 localStorage Keys
```
access_token           JWT access token
refresh_token          JWT refresh token
casper_col_visibility  column toggle state on SKU page (JSON)
casper-theme           light/dark preference (future)
```

### 5.12 Frontend Run Command
```bash
cd frontend
npm install   # first time only
npm run dev   # → http://localhost:5173
```

---

## 6. PRICING FORMULA

Core business logic — verified by reverse-engineering original Excel sheet.

```
Step 1: CR Cost
  cr_cost = platform.cr_charge × (cr_percentage / 100)

Step 2: Damage Cost
  damage_cost = price × (damage_percentage / 100)

Step 3: Misc Total
  misc_total = SUM of all active MiscItem.amount
  Default = ₹12 (Rent₹4 + Electricity₹4 + Internet₹4)

Step 4: Breakeven
  breakeven = price + package + logistics + ad + addons
              + misc_total + cr_cost + damage_cost

Step 5: Net Profit
  net_profit = breakeven × (profit_percentage / 100)
  Default profit_percentage = 20%

Step 6: BS w/o GST
  bs_wo_gst = Math.round(breakeven + net_profit)  ← integer

Step 7: GST Amount
  gst_amt = bs_wo_gst × (gst_rate / 100)
  gst_rate comes from HsnCode.gst_rate

Step 8: Bank Settlement
  bank_settlement = bs_wo_gst + gst_amt

Step 9: Platform Bank Settlement
  platform_bs = bank_settlement + tier.fee
```

### Verified Example
```
Price=64, Package=7, Logistics=5, Ad=0, Addons=6,
Misc=12, CR=35, Damage=9.6, GST=5

Breakeven   = 64+7+5+0+6+12+35+9.6 = 138.6 ✅
Net Profit  = 138.6 × 0.20 = 27.72 ✅
BS w/o GST  = round(166.32) = 166 ✅
Final BS    = 166 + 5 = 171 ✅
```

### Bidirectional Fields
```
CR%  ↔ CR₹        change one → other auto-calculates
Dmg% ↔ Dmg₹
Profit% ↔ Profit₹
```

### Override Priority
```
Manually entered value > auto-calculated default
```

### SKU Naming Convention
```
Format:  SHJ-{category_code}-{vendor_code}-{product_code}
Example: SHJ-JS-VRI-N5-GREEN
  SHJ       = company prefix (Shringar House Jewellery)
  JS        = Jewellery Set (category code)
  VRI       = Varni Sales (vendor short_code)
  N5-GREEN  = product + variant
Rule: always stored UPPERCASE
```

---

## 7. DESIGN SYSTEM

### Layout Structure
```
Outer shell:   bg #ECEAE4, padding 10px
Sidebar:       240px, SAME bg as outer (#ECEAE4) — blends naturally
  Icon strip:  42px left edge of sidebar
  Text nav:    198px right of icons
Topbar:        Sits on gray OUTSIDE white box. White pill search bar.
Main wrap:     WHITE rounded box, border-radius:14px, box-shadow
Page content:  padding 24px 28px, overflow-y auto
```

### Key Design Decisions
```
1. Sidebar same bg as outer — no visual separator line
2. Topbar outside white box — search visible on gray
3. No dark icon strip — everything on warm gray
4. Red-pink accent #E8365D — not gold (too jewelry-specific)
5. Plus Jakarta Sans — neutral SaaS (not Cormorant Garamond = luxury)
6. White pill search — visible against gray topbar
7. JetBrains Mono — all numeric values in table
```

---

## 8. NAVIGATION STRUCTURE

```
[C] Casper logo
[Company Switcher Dropdown]
  Shringar House Jewellery ●
  My Fashion Brand
  Electronics Store
  + Add new company

WORKSPACE
  Dashboard     /
  SKUs          /skus       ← main daily page (was Entries)
  Pricing       /pricing

ANALYTICS (all Coming Soon)
  Overview
  Revenue
  Platform Performance
  SKU Analysis

REPORTS  [badge = ready report count]
  My Reports ▶
    Sales Report
    Profitability
    Platform Compare
  Shared with me ▶
    Weekly Summary
    Deal Duration

SETTINGS
  Settings      /settings
  Users

[Footer: Avatar · Name · Role · 🔔 · logout]
```

---

## 9. COMPLETED FEATURES ✅

### Backend
- [x] Full project structure (FastAPI + SQLite + Alembic)
- [x] All 10 database models with migrations
- [x] JWT auth with role-based access (3 roles)
- [x] Full CRUD for Platform (with tiers), Vendor, Category, MiscItem, GlobalSettings
- [x] SKU CRUD with HSN code field
- [x] Pricing CRUD with full auto-calculation engine
- [x] Bidirectional field calculation
- [x] HSN codes seeded (46 codes, 5 categories)
- [x] Batch upsert endpoint POST /entries/upsert-batch
- [x] GET all entries endpoint GET /entries/

### Frontend
- [x] Login page
- [x] Auth context with token refresh
- [x] Layout — sidebar with tree nav, company switcher, collapsible sections
- [x] Topbar with pill search bar (SVG icon, dropdown results)
- [x] Dashboard page (basic)
- [x] SKU page (Excel-style spreadsheet)
  - [x] Column groups with visibility toggle (localStorage)
  - [x] Bidirectional fields
  - [x] SmartCell autocomplete (vendor, category)
  - [x] Add/Delete rows
  - [x] Per-platform columns with tier selector
  - [x] Save All + Auto-save (30s) + page close warning
  - [x] Row status indicators
  - [x] Load saved entries on mount
  - [x] Global Profit% and Misc₹ settings bar
  - [x] Platform toggle chips
  - [x] Mobile card view

---

## 10. IN PROGRESS 🔄

- [ ] Rename Entries → SKUs in all files/routes
- [ ] Dashboard redesign with new theme + real data
- [ ] Tree connector lines in sidebar (horizontal lines)
- [ ] Add HSN + Description columns to SKU page
- [ ] Filter bar on SKU page

---

## 11. PENDING / BACKLOG 📋

### High Priority
- [ ] SKU Analysis page (overview list + insight placeholder cards)
- [ ] Dashboard redesign
- [ ] Import Excel → parse → save to backend
- [ ] Export Excel → download all SKUs + pricing
- [ ] Flush/Reset buttons per section (with confirm dialog)
- [ ] Filter bar: vendor, category, search, status
- [ ] Row color coding: green/amber/red by margin health
- [ ] HSN auto-fill GST when selected

### Medium Priority
- [ ] Bulk actions (select rows → delete/assign)
- [ ] Duplicate row
- [ ] Freeze first columns on scroll
- [ ] Settings page (manage platforms, vendors, misc)
- [ ] Users management page

### Low Priority / Future
- [ ] Dark mode theme toggle
- [ ] Mobile responsive
- [ ] Analytics charts
- [ ] Reports (Excel/PDF + badge notifications)
- [ ] Pricing Insight Simulator
- [ ] Multi-tenant company management
- [ ] SKU performance tracking (needs sales data)

---

## 12. IDEAS PARKING LOT 💡

### Pricing Insight Simulator
```
What-if calculator:
"If I reduce price by ₹10 on Meesho →
 breakeven drops from ₹138 to ₹130 →
 I can offer 8% discount and still make 15% profit"
Status: Idea — needs sales data eventually
```

### SKU Analysis Page
```
Two sections:
1. Overview list — all SKUs, filter/search, edit/delete
2. Performance insights:
   - High return rate SKUs (CR cost %)
   - Best platform per SKU
   - Margin ranking
   - SKUs below breakeven (warning)
   - Category/platform profitability
Status: Planned — not built
```

### Reports with Badge
```
User requests report →
Backend generates Excel/PDF →
Badge on sidebar shows ready count →
User downloads from Reports section
Status: Idea only
```

### Dark Mode
```
Approach: CSS variables + html class toggle
Dark bg: #0C0C0C, surface: #161616
Accent: #E8365D (unchanged)
Add AFTER all pages complete in light theme
Status: Planned — after light theme complete
```

---

## 13. DESIGN DECISIONS LOG

| Decision | Choice | Reason |
|----------|--------|--------|
| Database | SQLite → MySQL later | MySQL failed on Windows local |
| Frontend | React + Vite | Better than Jinja2 templates |
| Auth | JWT access+refresh | 60min access, 7day refresh |
| CR meaning | Customer Return COST | Not Commission Rate |
| CR formula | cr_charge × cr% / 100 | Matches Excel |
| Damage | price × dmg% / 100 | Price-proportional |
| BS rounding | Math.round() | Matches original Excel |
| Accent color | #E8365D red-pink | Not gold — too jewelry-specific |
| Font | Plus Jakarta Sans | Neutral SaaS, not luxury |
| Sidebar bg | Same as outer #ECEAE4 | Matches reference design |
| Topbar | Outside white box | Search visible on gray bg |
| SKU naming | Plural for all routes/files | REST API convention |
| Entries page | Renamed → SKUs | More intuitive for sellers |
| Old SKUs page | Renamed → SKU Analysis | Insights/analytics focus |
| Dark mode | Add after light theme complete | Avoid double-testing |
| Architecture | Thin routes, fat services | Testable, reusable logic |

---

## 14. KNOWN ISSUES & WORKAROUNDS

| Issue | Workaround |
|-------|------------|
| SQLite ALTER TABLE | Use batch_alter_table() in Alembic |
| Multiple Alembic heads | alembic merge heads → alembic upgrade heads |
| Windows filename (comma vs dot) | Check carefully: main.jsx not main,jsx |
| Vite CSS cache | Ctrl+Shift+R or delete node_modules/.vite |
| React Router v7 warnings | Non-breaking, fix later |
| GlobalSettings model | Class is GlobalSettings (plural), not GlobalSetting |

---

## 15. SETUP INSTRUCTIONS

### Fresh Backend Setup
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
pip install aiosqlite --break-system-packages
# Create .env file (see section 4.7)
alembic upgrade head
python casperv2_import.py      # seed platforms, vendors, categories, users
python casper_hsn_import.py    # seed 46 HSN codes
uvicorn app.main:app --reload --port 8000
# Visit: http://localhost:8000/docs
# Login: admin@casperv2.com / Admin@1234
```

### Fresh Frontend Setup
```bash
cd frontend
npm install
npm run dev
# Visit: http://localhost:5173
```

---

## 16. GIT WORKFLOW

```bash
# Pull latest
git pull origin main --rebase

# Push changes
git add .
git commit -m "feat: description of change"
git push origin main

Branch: main (solo project)
```

---

## 17. NEXT IMMEDIATE STEPS

```
1. Rename Entries → SKUs (routes, nav, files, CSS)
2. Fix tree connector lines in sidebar
3. Dashboard redesign (new theme + real data cards)
4. Add HSN + Description + filter bar to SKU page
5. Row color coding for margin health
6. SKU Analysis page (overview list + placeholder insights)
7. Import / Export Excel
8. Settings page
9. Dark mode (after all pages done)
```

---

*Update this ledger after every significant change, feature addition, or design decision.*
*Companion file: casper_context.json — paste to any AI for instant project context.*