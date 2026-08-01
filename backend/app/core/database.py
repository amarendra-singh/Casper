from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# DB-agnostic engine setup: SQLite locally, Postgres in production (e.g. Vercel).
_url = settings.DATABASE_URL
_is_sqlite = _url.startswith("sqlite")
_engine_kwargs: dict = {"echo": settings.APP_DEBUG}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}  # required for SQLite
else:
    # Serverless/Postgres: verify connections (they can be dropped between cold
    # starts) and don't hold a large pool per function instance.
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_size"] = 5
    _engine_kwargs["max_overflow"] = 0

engine = create_async_engine(_url, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    session = AsyncSessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
