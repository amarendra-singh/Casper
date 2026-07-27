# Deployment — Frontend on Cloudflare Pages, Backend on Vercel

Both free tiers. Architecture:

```
Browser ──> Cloudflare Pages (static React build)
                │  VITE_API_BASE
                ▼
        Vercel (FastAPI serverless) ──> Postgres (Neon / Supabase free tier)
```

> **Why Postgres and not the bundled SQLite?** Vercel functions are serverless
> with an ephemeral filesystem — a SQLite file is wiped on every cold start, so
> data would not persist. You need a managed Postgres. Neon and Supabase both
> have a free tier that works with the async driver already in `requirements.txt`
> (`asyncpg`). The app auto-detects the driver from `DATABASE_URL`.

---

## 1. Provision a Postgres database (once)

Recommended: **Neon** (https://neon.tech) free tier.

1. Create a project → copy the **connection string**.
2. Convert it to the async driver URL the app expects:
   ```
   postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME
   ```
   (Neon gives `postgresql://…` — just change the scheme to `postgresql+asyncpg://`
   and drop any `?sslmode=require` query — asyncpg negotiates SSL automatically.
   Use Neon's **pooled** connection host for serverless.)

---

## 2. Deploy the backend to Vercel

Config already in the repo: `backend/vercel.json`, `backend/api/index.py`,
`asyncpg` in `backend/requirements.txt`.

1. In Vercel → **New Project** → import this repo.
2. Set **Root Directory = `backend`**.
3. Add **Environment Variables**:

   | Name | Value |
   |---|---|
   | `SECRET_KEY` | a long random string (e.g. `openssl rand -hex 32`) |
   | `DATABASE_URL` | `postgresql+asyncpg://USER:PASS@HOST/DBNAME` (from step 1) |
   | `APP_ENV` | `production` |
   | `APP_DEBUG` | `false` |
   | `ALLOWED_ORIGINS` | your Cloudflare Pages URL, e.g. `https://casper.pages.dev` (comma-separate if several) |

4. **Deploy.** Your API will be at `https://<project>.vercel.app` (routes under `/api/v1`).
5. **Seed the database once** (creates all tables + the first super-admin +
   company + platforms). Locally, with the same env vars pointing at Postgres:
   ```bash
   cd backend
   SECRET_KEY=... DATABASE_URL=postgresql+asyncpg://... python -m scripts.bootstrap_db
   ```
   Optional overrides: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_COMPANY_NAME`.
   Default login is `admin@casper.com` / `Admin@1234` — **change it immediately**
   via the in-app Account page after first login.

Sanity check: `GET https://<project>.vercel.app/health` → `{"status":"ok"...}`.

---

## 3. Deploy the frontend to Cloudflare Pages

Config already in the repo: `frontend/public/_redirects` (SPA fallback),
`VITE_API_BASE` support in `frontend/src/api/client.js`.

1. Cloudflare Pages → **Create project** → connect this repo.
2. Build settings:
   - **Root directory:** `frontend`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Add **Environment Variable**:

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | `https://<project>.vercel.app/api/v1` (your Vercel URL + `/api/v1`) |

4. **Deploy.** App is live at `https://<project>.pages.dev`.

---

## 4. Close the loop (CORS)

Set the backend's `ALLOWED_ORIGINS` (Vercel env, step 2) to your final Cloudflare
Pages URL, then redeploy the backend. Add any custom domains here too.

---

## Notes / limitations

- **Cold starts:** the first request after idle is slow (serverless spin-up) — normal on free tiers.
- **Connections:** use the **pooled** Postgres connection string; the engine caps its pool
  (`pool_size=5, max_overflow=0`) to stay within free-tier connection limits.
- **File uploads (P&L / ad reports):** parsed in-memory and written to Postgres — no disk needed.
  Uploaded raw files are not persisted on serverless (no writable disk); the parsed data is.
- **Migrations:** schema is created by `scripts/bootstrap_db.py` (idempotent `create_all`).
  For future schema changes, re-run it or wire Alembic against `DATABASE_URL`.
- **Local dev is unchanged:** no `DATABASE_URL` set → falls back to the bundled SQLite file.
