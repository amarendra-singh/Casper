from sqlalchemy import event
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

def configure_sqlite_transactions(target_engine):
    """Enforce foreign keys and make savepoints participate in outer rollback."""
    # SQLite ignores foreign keys unless each connection opts in, so every
    # ondelete="CASCADE"/"SET NULL" in the models was decorative: deleting a
    # company or vendor silently orphaned its children instead of cascading.
    # Postgres enforces them natively, which is why this is SQLite-only.
    @event.listens_for(target_engine.sync_engine, "connect")
    def _sqlite_enforce_foreign_keys(dbapi_connection, _record):
        # Disable sqlite3's legacy implicit-BEGIN behavior. Otherwise a first
        # SAVEPOINT can be released permanently before the outer transaction
        # ever begins, defeating rollback of multi-step financial operations.
        dbapi_connection.isolation_level = None
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    @event.listens_for(target_engine.sync_engine, "begin")
    def _sqlite_begin(connection):
        connection.exec_driver_sql("BEGIN")


if _is_sqlite:
    configure_sqlite_transactions(engine)

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
