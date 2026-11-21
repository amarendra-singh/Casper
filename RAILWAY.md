# Deploy Casper on Railway (single service)

One Railway service runs the whole app: the `Dockerfile` builds the React
frontend and the FastAPI backend serves it **and** the API under `/api/v1` on
the same URL. No CORS, no second service.

## 1. Push these files to GitHub

The repo now contains: `Dockerfile`, `.dockerignore`, `railway.toml`,
`.env.example`, and `.github/workflows/keepalive.yml`.

## 2. Create the Railway service

1. Railway → **New Project → Deploy from GitHub repo** → pick `Casper`.
2. Railway auto-detects `railway.toml` and builds with the Dockerfile.
3. Add service **Variables** (Settings → Variables):

   | Name | Value |
   |---|---|
   | `SECRET_KEY` | a long random string (`openssl rand -hex 32`) |
   | `APP_ENV` | `production` |
   | `APP_DEBUG` | `false` |

## 3. Make the database persist

Railway's container disk is wiped on every redeploy. Pick one:

**A. SQLite on a Volume (simplest)**
1. Service → **Volumes → New Volume**, mount path `/data`.
2. Add variables:
   - `DATABASE_URL` = `sqlite+aiosqlite:////data/casper.db`
   - `UPLOADS_DIR` = `/data/uploads/pnl`

   `DATABASE_URL_SYNC` is derived automatically from `DATABASE_URL`.

   (Four slashes = absolute path `/data/casper.db`.)

**B. Postgres**
1. Project → **New → Database → PostgreSQL**.
2. `DATABASE_URL` = `postgresql+asyncpg://USER:PASS@HOST:5432/DBNAME`
   (from the Postgres service's connection details, scheme swapped to
   `postgresql+asyncpg://`).

For PostgreSQL, also mount durable storage for original reports and set
`UPLOADS_DIR` to that mounted directory. A database volume alone does not preserve files.

On first boot the container runs `scripts.bootstrap_db` automatically — it
runs Alembic migrations and seeds the configured administrator. Set a unique
`SEED_ADMIN_PASSWORD` before the first production boot; production refuses to
create an administrator without it. Existing accounts are preserved.

## 4. Generate a domain

Service → **Settings → Networking → Generate Domain**. You get something like
`https://casper-production.up.railway.app`. Visiting it shows the login page;
the API is under `…/api/v1`; health check is `…/health`.

## 5. Keep-alive cron (every 4 min)

`.github/workflows/keepalive.yml` pings the app on a schedule.

1. GitHub repo → **Settings → Secrets and variables → Actions → New secret**.
2. Name `KEEPALIVE_URL`, value your Railway URL (e.g.
   `https://casper-production.up.railway.app/`).

The workflow then GETs that URL every ~4 minutes.

> **Two caveats:**
> - GitHub's cron is best-effort (can lag a few minutes) and pauses after 60
>   days of no repo commits. For a hard guarantee, also/instead point
>   **cron-job.org** or **UptimeRobot** (both free) at the same URL every 4 min.
> - Railway (unlike Render) does **not** sleep services by default — it bills by
>   usage. A keep-alive only matters if you turn on **App Sleeping**; otherwise
>   it just burns a little usage. Enable App Sleeping *and* the ping together, or
>   neither.

## Local dev is unchanged

No `DATABASE_URL` set → bundled SQLite. Run backend and frontend as before.
