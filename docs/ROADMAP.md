# Roadmap

Status of the work, and what is queued. Kept short on purpose — see
`docs/MISTAKES.md` for the rules that govern how it gets done.

---

## Done

**P&L — industry standard**
- Backend statement engine (`services/pnl_statement.py`): contribution-margin
  income statement, revenue-anchored margins, always foots, reconciles to bank
  settlement.
- Full cost stack: COGS · Fulfilment · **Return cost** · Overhead.
- TCS/TDS as their own creditable lines.
- **Frozen cost snapshot** per report — closed periods no longer move when SKU
  pricing is edited. Old reports fall back to live pricing, flagged `estimated`.
- Statement and per-SKU table reconciled; a test fails if they ever disagree.
- Per-SKU math moved to the backend; every number carries a `calc` breakdown, so
  hovering any figure shows its formula and inputs.
- Period-aligned consolidation, with `excluded_platforms` disclosed.

**Hidden SKUs**
- `N SKUs hidden` is clickable → side panel scoped to that report.
- Quick-add takes the full cost stack (Vendor, Price, Package, Logistics, Addons,
  Misc, Return %/₹, Dmg %/₹) and re-matches the report in the same call.
- Fixed: SKUs already in the master were hidden when they had no platform alias.

**Companies**
- One `/companies` page: create, rename, colour, archive, **restore**, leave.
- Archive was previously one-way — three companies were stranded and are now
  recoverable.
- Removed the duplicate Settings entry in the sidebar.

**Consolidated ("All Companies") mode**
- `X-Company-Id: all` → `CompanyScope`; read services take `int | list[int]`.
- Master covers every feature: dashboard, P&L, SKUs, entries, ledger, billing,
  fraud. Each company still sees only its own data and modules.
- Writes stay per-company; group mode refuses non-GET.

**Editing from master mode**
- Edit/delete of an existing record works from All Companies — ledger, billing,
  SKUs, pricing, P&L reports. The record carries its own `company_id`, so it's
  unambiguous; `require_role_in_company` authorises against the role the caller
  holds in **that** company, not a global role or whichever company they're
  viewing. Non-members get 404, not 403 — existence isn't confirmed.
- Create still needs one company. Ledger and billing forms show a Company field
  in All Companies and send it for that one request. Pricing needs no picker —
  the SKU it's for already belongs to one company, so create derives the target
  from `currentSku.company_id`.
- Ledger and invoice rows carry `company_id/name/color` (SKU rows already did);
  a coloured left rail marks ownership everywhere rows can be mixed, and delete
  confirmations name the company.
- The SKU spreadsheet's inline-edit grid is the one surface still view-only in
  All Companies — it autosaves to `/entries/upsert-batch`, which targets one
  company per call, and a grid row's company can't be picked per-cell. A visible
  banner says so; it used to fail silently and retry forever (`docs/MISTAKES.md`
  #11's sibling bug).

---

## Next — agreed, not yet built

**1. UI density pass**
- Merge the stacked full-width banners into the page header.
- Merge `GLOBAL PROFIT % / DEFAULT MISC / PLATFORMS` and `COLUMNS` into one
  toolbar row (~150–200px of vertical space recovered).
- Company filter chips fold into that existing row — no new band.

---

## Later

- Re-modularise `Dashboard.jsx` (1,246 lines → the 12-component structure kept in
  the `main-legacy-snapshot` branch). Architecture, not a feature.
- Side-by-side line-by-line period comparison in the P&L statement.
- ShopDeck customer-fraud upload UI (the scoring library and route exist).
- Hard delete for companies (currently archive-only, by design).

---

## Environment notes

- Dev backend runs on **8767** (8766 is held by an orphaned socket on this machine
  that answers with a stale build). `run.ps1` reads the port from the Vite proxy,
  so the two stay in sync.
- Preview servers run from the **worktree**; changes made in the main tree appear
  only after committing and fast-forwarding the worktree.
- Migrations go through idempotent scripts in `backend/scripts/`, not Alembic —
  the worktree's Alembic chain is behind the live DB. Keep script output ASCII.
