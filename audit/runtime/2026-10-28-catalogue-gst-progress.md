# Catalogue GST correction — progress and verification log

This log records observable work on the Majnu Bhai Sales GST issue. It is not a reconstruction of every earlier chat action. The working tree already contains unrelated uncommitted changes; this entry names only the current GST slice.

## 2026-10-24 — diagnosis and initial implementation

- User corrected the intended rate to **18%** and required Unit Economics to read it from Catalogue.
- Confirmed failure: 110 Majnu Bhai Sales SKUs had no `sku_pricing` rows, the `skus` table had no GST column, and Unit Economics displayed a hardcoded 5% fallback.
- Created a SQLite backup at `audit/backups/casper-before-catalogue-gst-20261024-030610.db` (1,523,712 bytes) before any schema migration.
- Added a nullable SKU-level `gst_rate` model column and Alembic revision `p6catalog0016`; added Catalogue profile editing, bulk-import GST handling, and Unit Economics read-through. Removed the hardcoded 5% grid defaults. These code changes were **not yet tested, migrated, deployed, or used to update Majnu records** in that turn.

## 2026-10-28 — resumed audit

- Confirmed local database Alembic revision remains `o5catalog0015`; `skus.gst_rate` is absent. Majnu Bhai Sales remains company ID 8. Therefore the live data is **not corrected yet**.
- Current work: finish GST validation and regression tests, migrate/restart, update the 110 Majnu SKUs through the supported frontend bulk-upload flow, then verify Catalogue and Unit Economics after reload.
- Success criteria: all 110 Majnu SKUs persist 18% in Catalogue, Unit Economics shows 18% after reload, a SKU with unknown GST stays visibly unset, and no product price/cost or stock is invented.

## Verification results

- 2026-10-28: `tests/test_catalogue.py` and `tests/test_schema_migrations.py` initially returned **29 passed, 3 failed**. The three failures were existing synthetic pricing fixtures with no GST; the new validation correctly rejected them instead of silently assuming 0%. The fixtures now specify 18% explicitly.
- 2026-10-28: Focused backend rerun returned **33 passed**. The new test covers GST-only bulk create, inactive SKU read-through to Unit Economics, profile edit, and persisted reload. Warnings concern the short test JWT key.
- 2026-10-28: Full backend run initially returned **429 passed, 5 failed**. Five legacy entry flows omitted GST. The code now preserves their existing behavior and leaves the Catalogue rate unset rather than showing an invented rate. Full backend rerun returned **434 passed**.
- 2026-10-28: Focused frontend test initially could not collect because the sandbox Temp path rejected a rename (`EPERM`). Repeated with `TEMP` and `TMP` under the workspace: **9 passed**. Full frontend suite: **149 passed**. Production Vite build passed.
- Applied Alembic revision `p6catalog0016` to the local database after backing it up at `audit/backups/casper-before-catalogue-gst-live-20261028-002031.db` (1,523,712 bytes).
- Rebuilt the Majnu catalogue spreadsheets with GST 18%. The GST-only update workbook contained exactly the 110 existing Majnu SKU codes, with no price or stock values.
- Uploaded the GST-only workbook through the Catalogue frontend. Preview showed 110 valid updates, zero creates and deactivations. The completed action reported 110 updated.
- Database readback: all 110 Majnu SKUs have `gst_rate = 18`; no Majnu pricing or stock-cost rows were created; SQLite quick check returned `ok`.
- Reloaded Catalogue and Unit Economics in a real browser. Catalogue showed persisted GST 18% on product `MBG-WG-AMR-325-P1`; Unit Economics showed 18% on all 110 rows and no 5% values. Screenshot: `audit/runtime/2026-10-28-unit-economics-gst18.png`.
- Full regression suites: 434 backend tests and 149 frontend tests passed; production frontend build passed. The added cross-platform GST synchronization test passed after fixing test-session expiry handling.
- Remaining business data gap: all 110 products still await a verified cost/price; no cost or stock figures were inferred.

## 2026-11-22 — run and push preparation

- User requested the project to run and the repository to be pushed. The working tree contains seven commits ahead of `origin/main` plus extensive prior uncommitted source and audit work. This log is the current session's trace; earlier audit artifacts remain local unless explicitly selected for Git.
- A first local background launch ended with its command session. A persistent launch then found port 8765 occupied by `C:\WorkStation\Projects\Wedding\server.py`, so Casper's backend could not bind there. The other project was left running.
- Moved the Vite API proxy to port 8766, started Casper backend on `127.0.0.1:8766` and frontend on `127.0.0.1:5174`. Verified backend OpenAPI returned HTTP 200 with title `Casper`; frontend's `/api/v1/auth/me` returned the expected unauthenticated HTTP 401 through its proxy. Frontend `/login` returned HTTP 200.
- Current service logs: `backend/logs/run-2026-11-22.out.log`, `backend/logs/run-2026-11-22.err.log`, `frontend/run-2026-11-22.out.log`, and `frontend/run-2026-11-22.err.log`. The backend error log contains the failed 8765 bind followed by successful 8766 startup.
- Current local checks: backend 434 passed; frontend 149 passed; frontend lint passed; backend Ruff passed; frontend production build passed. Git staging and remote push are the next steps.
