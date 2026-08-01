# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Casper is a marketplace P&L / pricing / fraud-intelligence tool for an Indian jewellery seller (Shringar). It ingests platform settlement exports (Flipkart, Meesho, Snapdeal, ShopDeck), reconciles them against a per-SKU cost model, and surfaces profitability, settlement leakage, and return-fraud signals on a dashboard.

- **Backend** (`backend/`): FastAPI + async SQLAlchemy 2.0 over SQLite (aiosqlite), Alembic migrations, JWT auth (python-jose + passlib/bcrypt), Pydantic v2, openpyxl for Excel parsing.
- **Frontend** (`frontend/`): React + Vite, axios, react-router-dom, recharts, react-simple-maps, Tailwind.

## Commands

The Python interpreter / venv lives in the **main** project, not the worktree:
`C:\WorkStation\Projects\Python\Casper\backend\env\Scripts\python.exe`

**Backend** (run from `backend/`):
```bash
# Run dev server — SECRET_KEY is a required env var or the app aborts on boot
SECRET_KEY=dev-key python -m uvicorn app.main:app --reload --port 8765

# Tests (SECRET_KEY required here too)
SECRET_KEY=test-key python -m pytest -q
SECRET_KEY=test-key python -m pytest tests/test_operations.py -q          # one file
SECRET_KEY=test-key python -m pytest tests/test_operations.py::test_empty # one test

# Migrations
alembic upgrade head
alembic revision -m "add column x"
```

**Frontend** (run from `frontend/`):
```bash
npm run dev                       # Vite dev server on :5173
npm run build
npm run test                      # vitest run (one-shot)
npx vitest run src/tests/X.test.jsx          # one file
npx vitest run -t "renders ribbon"           # by test name
```

## Wiring that bites if you don't know it

- **API prefix is `/api/v1`** — every router is mounted under it in `app/main.py`. The frontend axios client (`frontend/src/api/client.js`) sets `baseURL: '/api/v1'`, and `vite.config.js` proxies `/api` → the backend port. A bare `/api/...` path returns 404; always include `/v1`.
- The Vite proxy target port and the running backend port must match. Default login: `admin@casper.com` / `Admin@1234`.
- Backend run **without `--reload`** will not pick up new routes/code — restart it.

## Architecture

### Dashboard intelligence: pure-function + DB-wrapper pattern

Each dashboard service in `backend/app/services/` is two layers:
- `build_X(rows: list[dict]) -> dict` — **pure, no DB, fully unit-tested**. Holds all the math.
- `compute_X(db) -> dict` — async wrapper that runs the SQLAlchemy aggregates and feeds the pure function.

The six dashboard endpoints (`routes/dashboard.py`, all under `/dashboard/`) follow this: `metrics`, `sku-intelligence` (`profitability.py`), `reconciliation`, `action-pipeline`, `operations`, plus `insights`. When adding a dashboard feature, follow this split and add tests against the pure function (see `tests/test_operations.py`, `test_reconciliation.py`, etc.).

### Margin is return-on-COST — one definition, everywhere

`real_margin = (actual_payout − breakeven_cost) / breakeven_cost × 100`, where `breakeven` is the frozen per-SKU cost floor in `sku_pricing.breakeven` and payout is `bank_settlement_projected`. The single source of truth is `compute_sku_intelligence().summary.blended_margin_pct`. **Do not write a second, divergent margin query** — the ribbon's "Avg net margin" cell (`a05`) reuses this value precisely because an independent query once produced a 455% bug by mixing per-unit cost with per-row total payout.

### Data model

- `PnlReport` — one row per uploaded settlement file (platform-level summary: gross_sales, total_expenses, bank_settlement, fee components).
- `PnlSkuRow` — per-SKU line within a report (`report_id` FK → PnlReport; **no `platform_id`**, join through the report for platform). `sku_pricing_id` is nullable — it's the match to the cost model; many dashboard queries filter on `sku_pricing_id IS NOT NULL` to use only matched rows.
- `SkuPricing` → `Sku` → `Platform` — the target/cost world. Fraud: `ActorRiskProfile`, `ReturnReasonCluster`.

### P&L parsing

`services/pnl.py::parse_and_store()` dispatches by lowercased platform name (`meesho` / `snapdeal` / `flipkart` / `shopdeck`). Snapdeal has a CPR-format variant detected by `_is_snapdeal_cpr()`. ShopDeck uses a **custom OOXML reader** (`services/shopdeck.py`) because openpyxl fails on its malformed `styles.xml`.

### Frontend dashboard

`frontend/src/pages/Dashboard.jsx` fetches all dashboard endpoints in one `Promise.all`, each with `.catch(() => null)` so a single failing endpoint degrades gracefully instead of blanking the page. Sections render real data or empty states; there should be no hardcoded demo data in any data section.
