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

---

## Next — agreed, not yet built

**1. Editing from master mode** *(design agreed, blocked on 2)*
- Allow edit/delete of an existing record while in All Companies — the record
  carries its own `company_id`, so there is no ambiguity.
- Create still picks a company (form gets a Company selector that sets the header
  for that request).
- **Authorisation:** check the caller's role in the **record's own** company. This
  also closes a current gap where a global admin role can write to a company they
  are only a viewer in.

**2. Show record ownership** *(prerequisite for 1)*
- Expose `company_id` / `company_name` / `company_color` on read responses — they
  are not returned today, so master lists cannot show ownership at all.
- Coloured left rail per row (zero extra width) + company named in edit forms and
  delete confirmations.

**3. UI density pass**
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
