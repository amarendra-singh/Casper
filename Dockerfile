# ─────────────────────────────────────────────────────────────────────────────
# Casper — single-image full-stack build for Railway.
# Stage 1 builds the React frontend; stage 2 runs FastAPI and serves that build
# alongside the API, so the whole app is one service on one URL.
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: build the frontend ----
FROM node:24-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Same-origin in production: the API lives under /api/v1 on this very host,
# so the default relative baseURL is correct — no VITE_API_BASE needed.
RUN npm run build

# ---- Stage 2: backend + static serving ----
FROM python:3.12-slim AS app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_ENV=production \
    APP_DEBUG=false
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# Drop the built SPA where FastAPI looks for it (backend/static).
COPY --from=frontend /fe/dist ./static

# Railway injects $PORT. Run migrations + seed admin (idempotent) on every boot,
# then start the server bound to the platform port.
CMD ["sh", "-c", "python -m scripts.bootstrap_db && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
