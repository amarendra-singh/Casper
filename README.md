# Casper

Marketplace **P&L, pricing, and fraud-intelligence** tool for an Indian jewellery
seller (Shringar). It ingests platform settlement exports (Flipkart, Meesho,
Snapdeal, ShopDeck), reconciles them against a per-SKU cost model, and surfaces
profitability, settlement leakage, and return-fraud signals on a dashboard.

- **Backend** — FastAPI + async SQLAlchemy 2.0 over SQLite, Alembic, JWT auth, Pydantic v2.
- **Frontend** — React + Vite, axios, react-router-dom, recharts, Tailwind.

---

## Prerequisites

| Tool    | Version           | Notes                        |
|---------|-------------------|------------------------------|
| Python  | 3.12+             | Backend runtime              |
| Node.js | 18+ (20/22 fine)  | Frontend dev server & build  |
| npm     | ships with Node   | Dependency install           |

---

## Quick start (Windows / PowerShell)

From the project root:

```powershell
.\run.ps1 -Setup
```

`-Setup` (first run only) installs backend + frontend dependencies and creates
`backend/.env` with a generated `SECRET_KEY`. After that, just:

```powershell
.\run.ps1
```

This launches the backend and frontend, each in its own window, and opens the
app in your browser. The backend port is read automatically from the Vite proxy
in `frontend/vite.config.js`, so the two always match.

Default login: **admin@casper.com** / **Admin@1234**

---

## Manual start

### 1. Backend (run from `backend/`)

```powershell
# One-time: create venv + install deps
python -m venv env
env\Scripts\Activate.ps1
pip install -r requirements.txt

# One-time: create backend/.env with a SECRET_KEY (the app aborts on boot without it)
"SECRET_KEY=your-long-random-secret" | Set-Content .env

# Run — use the SAME port the Vite proxy targets (see vite.config.js)
python -m uvicorn app.main:app --reload --port 8766
```

Backend serves the API at `http://localhost:<port>/api/v1` and interactive docs
at `http://localhost:<port>/docs`.

> **The backend port must match the Vite proxy.** Open
> `frontend/vite.config.js` and look at the `proxy` target
> (`http://localhost:<port>`) — run uvicorn on that exact port, or the frontend
> can't reach the API. `run.ps1` reads this for you automatically.

### 2. Frontend (run from `frontend/`)

```powershell
npm install        # one-time
npm run dev        # Vite dev server on http://localhost:5173
```

Open **http://localhost:5173**.

---

## Tests

```powershell
# Backend (from backend/) — SECRET_KEY is required for tests too
$env:SECRET_KEY = "test-key"; python -m pytest -q

# Frontend (from frontend/)
npm run test
```

---

## Database & migrations

Local dev uses the bundled SQLite file `backend/casper.db` — no setup needed.
For production (Postgres on Neon / Vercel), see [DEPLOYMENT.md](DEPLOYMENT.md).

```powershell
# from backend/
alembic upgrade head                    # apply migrations
alembic revision -m "add column x"      # create a new migration
```

---

## Project layout

```
backend/          FastAPI app
  app/
    routes/       API endpoints (all mounted under /api/v1)
    services/     business logic — dashboard, pnl parsers, pricing, fraud
    models/       SQLAlchemy models
    core/         config, database, security
  tests/          pytest suite
  requirements.txt
frontend/         React + Vite app
  src/
    pages/        Dashboard, SKUs, Pricing, Ledger, Billing, Fraud, ...
    api/client.js axios client (baseURL /api/v1)
run.ps1           local dev launcher
DEPLOYMENT.md     production deploy guide (Neon + Vercel + Cloudflare)
```

---

## Common gotchas

- **API prefix is `/api/v1`** — a bare `/api/...` path returns 404.
- **Backend without `--reload`** won't pick up new routes — restart it.
- The **backend port and the Vite proxy port must match** (`run.ps1` handles this).
- `SECRET_KEY` is **required** — the backend aborts on boot without it.
