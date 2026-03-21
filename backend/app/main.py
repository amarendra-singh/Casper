from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine
from app.routes import entries,auth, users, platforms, vendors, categories, misc_items, global_settings, hsn_codes
from app.routes.skus import sku_router, pricing_router


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        debug=settings.APP_DEBUG,
        docs_url="/docs" if settings.APP_DEBUG else None,
        redoc_url="/redoc" if settings.APP_DEBUG else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def startup():
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        print("✅ Database connected successfully")

    prefix = "/api/v1"

    app.include_router(auth.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(platforms.router, prefix=prefix)
    app.include_router(vendors.router, prefix=prefix)
    app.include_router(categories.router, prefix=prefix)
    app.include_router(misc_items.router, prefix=prefix)
    app.include_router(global_settings.router, prefix=prefix)
    app.include_router(sku_router, prefix=prefix)
    app.include_router(pricing_router, prefix=prefix)
    app.include_router(hsn_codes.router, prefix=prefix)
    app.include_router(entries.router, prefix=prefix)

    @app.get("/health", tags=["Health"])
    async def health_check():
        return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}

    return app


app = create_app()