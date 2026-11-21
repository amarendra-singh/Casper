from pathlib import Path
from decouple import config, Csv
from functools import lru_cache
from sqlalchemy.engine import make_url

# Resolve DB path relative to this file so it's stable regardless of uvicorn launch dir.
# backend/app/core/config.py → .parent×3 = backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_DB_PATH = (_BACKEND_DIR / "casper.db").as_posix()


def normalize_database_url(value: str) -> str:
    """Resolve configured relative SQLite paths from backend, not the launch directory."""
    url = make_url(value)
    database = url.database
    if (
        url.get_backend_name() == "sqlite"
        and database
        and database != ":memory:"
        and not database.startswith("file:")
    ):
        path = Path(database)
        if not path.is_absolute():
            url = url.set(database=(_BACKEND_DIR / path).resolve().as_posix())
            return url.render_as_string(hide_password=False)
    return value


class Settings:
    APP_NAME: str = config("APP_NAME", default="CasperV2")
    APP_ENV: str = config("APP_ENV", default="development")
    APP_DEBUG: bool = config("APP_DEBUG", default=False, cast=bool)
    APP_HOST: str = config("APP_HOST", default="0.0.0.0")
    APP_PORT: int = config("APP_PORT", default=8000, cast=int)

    # Read from the environment so production (Vercel + Postgres) can override.
    # Local/dev default is the bundled SQLite file. Use an async driver URL, e.g.
    #   postgresql+asyncpg://USER:PASS@HOST:5432/DBNAME
    DATABASE_URL: str = normalize_database_url(
        config("DATABASE_URL", default=f"sqlite+aiosqlite:///{_DB_PATH}")
    )
    DATABASE_URL_SYNC: str = normalize_database_url(
        config(
            "DATABASE_URL_SYNC",
            default=DATABASE_URL.replace("sqlite+aiosqlite:", "sqlite:").replace(
                "postgresql+asyncpg:", "postgresql+psycopg:"
            ),
        )
    )
    UPLOADS_DIR: str = config("UPLOADS_DIR", default=str(_BACKEND_DIR / "uploads" / "pnl"))
    PRODUCT_MEDIA_DIR: str = config("PRODUCT_MEDIA_DIR", default=str(_BACKEND_DIR / "uploads" / "products"))

    SECRET_KEY: str = config("SECRET_KEY")
    ALGORITHM: str = config("ALGORITHM", default="HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = config("ACCESS_TOKEN_EXPIRE_MINUTES", default=60, cast=int)
    REFRESH_TOKEN_EXPIRE_DAYS: int = config("REFRESH_TOKEN_EXPIRE_DAYS", default=7, cast=int)

    ALLOWED_ORIGINS: list[str] = config(
        "ALLOWED_ORIGINS",
        default="http://localhost:5173",
        cast=Csv(),
    )

    DEFAULT_DAMAGE_PERCENT: float = config("DEFAULT_DAMAGE_PERCENT", default=15.0, cast=float)


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
