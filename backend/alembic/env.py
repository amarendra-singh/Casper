from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

from app.core.config import settings
import app.models  # noqa

config = context.config

# A url set programmatically (tests, scripts) wins; otherwise fall back to the
# app settings. Overriding unconditionally meant a caller could point alembic at
# a throwaway database and silently have it migrate the real one instead,
# because settings is read once at import.
_PLACEHOLDER = "driver://user:pass@localhost/dbname"
if config.get_main_option("sqlalchemy.url", None) in (None, "", _PLACEHOLDER):
    config.set_main_option("sqlalchemy.url", settings.DATABASE_URL_SYNC)
DB_URL = config.get_main_option("sqlalchemy.url")

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from app.core.database import Base
target_metadata = Base.metadata

# SQLite cannot ALTER a column or add a constraint in place. Without batch mode
# alembic emits DDL sqlite rejects, so every NOT NULL / UNIQUE change has to be
# hand-written as a table rebuild. render_as_batch makes alembic do that for us.
# compare_type lets autogenerate see a column's type change, not just its name.
_OPTS = dict(render_as_batch=True, compare_type=True)


def run_migrations_offline():
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **_OPTS,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, **_OPTS)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()