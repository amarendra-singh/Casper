We are building CasperV2 — a FastAPI + SQLite + React admin app for jewelry pricing management.

Current state:
- Backend: FastAPI, SQLite (aiosqlite), SQLAlchemy async, Alembic, JWT auth
- Folder: C:\WorkStation\Projects\Python\CasperV1\backend
- Completed: project structure, config (.env + decouple), all DB models, JWT auth, user CRUD, seed script
- Models: User, Platform, PlatformTier, Vendor, Category, MiscItem, GlobalSettings, Sku, SkuPricing
- Next step: Step 4 — Platform, Vendor, Category, MiscItem CRUD routes

Key business rules:
- Breakeven = price + package + logistics + addons + misc_total + cr_cost + damage_cost
- Net Profit 20% = breakeven × 0.20
- BS w/o GST = breakeven + net_profit_20 (rounded)
- Bank Settlement = bs_wo_gst + gst
- CR cost = platform.cr_charge × cr_percentage (overridable)
- Damage cost = price × damage_percentage (overridable)


app/schemas/sku.py

