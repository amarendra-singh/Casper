from pathlib import Path
from decouple import config, Csv
from functools import lru_cache

# Resolve DB path relative to this file so it's stable regardless of uvicorn launch dir.
# backend/app/core/config.py → .parent×3 = backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_DB_PATH = (_BACKEND_DIR / "casper.db").as_posix()


class Settings:
    APP_NAME: str = config("APP_NAME", default="CasperV2")
    APP_ENV: str = config("APP_ENV", default="development")
    APP_DEBUG: bool = config("APP_DEBUG", default=False, cast=bool)
    APP_HOST: str = config("APP_HOST", default="0.0.0.0")
    APP_PORT: int = config("APP_PORT", default=8000, cast=int)

    # Read from the environment so production (Vercel + Postgres) can override.
    # Local/dev default is the bundled SQLite file. Use an async driver URL, e.g.
    #   postgresql+asyncpg://USER:PASS@HOST:5432/DBNAME
    DATABASE_URL: str = config("DATABASE_URL", default=f"sqlite+aiosqlite:///{_DB_PATH}")
    DATABASE_URL_SYNC: str = config("DATABASE_URL_SYNC", default=f"sqlite:///{_DB_PATH}")

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