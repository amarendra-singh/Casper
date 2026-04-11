# CASPER — PRODUCT ROADMAP
> Vision → Milestones → Features. Updated per major release.
> Last updated: 2026-04-11

---

## VISION

**Casper** — Pricing intelligence for ecommerce sellers.

Replace Excel-based pricing with a live, multi-platform, profitability-first web app.
Every SKU → every platform → breakeven, profit, bank settlement — in real time.

---

## PHASES

### PHASE 1 — CORE ENGINE ✅ ~70% Done
**Goal:** Single seller can manage all their SKU pricing across platforms.

| Feature | Status |
|---------|--------|
| Auth (JWT login/logout) | ✅ Done |
| Vendor + Category CRUD | ✅ Done |
| Platform + Tier management | ✅ Done |
| SKU table with pricing inputs | ✅ Done |
| Breakeven / Profit / BS formula | ✅ Done |
| Per-platform AD % override | ✅ Done |
| Per-platform Tier selection | ✅ Done |
| Platform SKU alias | ✅ Done |
| Excel import / export | ✅ Done |
| Series grouping + collapse | ✅ Done |
| Responsive table (sizer pattern) | ✅ Done |
| Platform Settings (default AD %) | 🔄 50% — UI missing |
| Dashboard — upper metrics | ✅ Done |
| Dashboard — lower (platform list, chart, table) | ❌ Not started |

---

### PHASE 2 — POLISH & POWER FEATURES 🔜 Next
**Goal:** App feels production-grade. Power users can do everything fast.

| Feature | Priority | Notes |
|---------|----------|-------|
| Platform Settings UI (default_ad_pct, default_profit_pct) | 🔴 High | Backend ready, UI missing |
| Dashboard lower sections | 🔴 High | Platform list, donut chart, sales table |
| Persist test (save → reload → verify) | 🔴 High | End-to-end QA needed |
| Multi-platform export (AD, Tier, BS per platform) | 🟡 Medium | Currently only BS in export |
| SKU alias display (visible in table) | 🟡 Medium | Currently only in input |
| Bulk edit / multi-select rows | 🟡 Medium | — |
| Platform comparison view | 🟡 Medium | Side-by-side all platforms for 1 SKU |
| CSV import validation + error report | 🟡 Medium | Currently no error feedback |
| Dark mode | 🟢 Low | Design system already uses CSS vars |
| Profit heatmap on table | 🟢 Low | Color rows by margin % |

---

### PHASE 3 — MULTI-TENANT / TEAM
**Goal:** Multiple sellers, multiple users per seller, role-based access.

| Feature | Priority |
|---------|----------|
| User roles (view-only, editor, admin) | 🟡 Medium |
| Workspace switcher (already in UI shell) | 🟡 Medium |
| Audit log (who changed what, when) | 🟢 Low |
| Invite team members via email | 🟢 Low |

---

### PHASE 4 — INTEGRATIONS
**Goal:** Live data from platforms. No more manual entry.

| Feature | Priority |
|---------|----------|
| Meesho API price sync | 🟢 Low |
| Flipkart API price sync | 🟢 Low |
| Amazon API price sync | 🟢 Low |
| Webhook for platform fee changes | 🟢 Low |
| Auto-recalculate on platform fee update | 🟢 Low |

---

## MILESTONE TRACKER

| Milestone | Target | Status |
|-----------|--------|--------|
| M1 — Core pricing engine live | Done | ✅ |
| M2 — Per-platform AD + responsive table | Done | ✅ |
| M3 — Platform Settings UI + Dashboard complete | Next | 🔄 |
| M4 — Full QA + first real user (SHJ) | TBD | ❌ |
| M5 — Multi-tenant + user roles | TBD | ❌ |
| M6 — Platform integrations (1 platform) | TBD | ❌ |

---

## TECH DEBT TO RESOLVE

| Item | Impact | Effort |
|------|--------|--------|
| `node_modules` tracked in git | High — bloats repo | Low — add to .gitignore |
| `casper.db` tracked in git | High — data leaks | Low — add to .gitignore |
| Worktree vs main project confusion | High — edits go to wrong place | Medium — document clearly |
| No `.env` validation on startup | Medium | Low |
| No automated tests | High | High |
| SQLite → Postgres for production | Medium | High |
