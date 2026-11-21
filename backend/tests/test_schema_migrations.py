"""
The migration chain must build the schema the models describe.

This is the test whose absence let the database drift nine tables and
twenty-three columns ahead of its own migrations: the tenancy, ledger, billing
and purchase schema was applied by ad-hoc create_all scripts, two migration
files were deleted while the database stayed stamped past them, and nothing
ever checked. `alembic current` failed outright and a deploy from an empty
database was impossible.

Everything here runs against a throwaway SQLite file, never the real database.
"""
import os
import tempfile
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.core.database import Base

BACKEND = Path(__file__).resolve().parents[1]


def _config(db_path: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


@pytest.fixture(scope="module")
def migrated_db():
    """An empty database taken to head by the real migration chain."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.unlink(path)  # alembic/sqlite creates it
    # env.py reads the URL from settings, so point those at the temp file too.
    for var in ("DATABASE_URL_SYNC", "DATABASE_URL"):
        os.environ.pop(var, None)
    os.environ["DATABASE_URL_SYNC"] = f"sqlite:///{path}"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{path}"
    try:
        command.upgrade(_config(path), "head")
        yield path
    finally:
        os.environ.pop("DATABASE_URL_SYNC", None)
        os.environ.pop("DATABASE_URL", None)
        try:
            os.unlink(path)
        except OSError:
            pass


def test_chain_has_a_single_head():
    """A deleted or forked revision file shows up here first."""
    heads = ScriptDirectory.from_config(_config(":memory:")).get_heads()
    assert len(heads) == 1, f"expected one head, found {heads}"


def test_every_revision_resolves():
    """Walking the chain proves no down_revision points at a missing file."""
    script = ScriptDirectory.from_config(_config(":memory:"))
    revisions = list(script.walk_revisions())
    assert revisions, "no revisions found"
    known = {r.revision for r in revisions}
    for rev in revisions:
        for parent in (rev.down_revision or ()) if isinstance(rev.down_revision, tuple) \
                else ([rev.down_revision] if rev.down_revision else []):
            assert parent in known, f"{rev.revision} points at missing revision {parent}"


def test_migrations_produce_the_model_schema(migrated_db):
    """
    The check that matters: upgrade head on an empty database, then diff it
    against the models. Anything non-empty means a model changed without a
    migration, and a fresh deploy would come up with the wrong schema.
    """
    with create_engine(f"sqlite:///{migrated_db}").connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        diffs = compare_metadata(ctx, Base.metadata)

    flat = [d for group in diffs for d in (group if isinstance(group, list) else [group])]
    assert not flat, "migrations and models disagree:\n" + "\n".join(
        f"  {d[0]} {getattr(d[1], 'name', d[1:3])}" for d in flat
    )


def test_tenant_tables_require_an_owning_company(migrated_db):
    """
    company_id NOT NULL on every tenant table. A nullable tenant key lets a row
    exist belonging to nobody, invisible to every company-scoped query.
    """
    import sqlite3

    conn = sqlite3.connect(migrated_db)
    nullable = []
    for (table,) in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ):
        for _cid, name, _type, notnull, _dflt, _pk in conn.execute(f"PRAGMA table_info({table})"):
            if name == "company_id" and not notnull:
                nullable.append(table)
    assert not nullable, f"company_id is nullable on: {nullable}"


@pytest.mark.parametrize("table,columns", [
    ("skus", ["company_id", "shringar_sku"]),
    ("global_settings", ["company_id", "key"]),
    ("vendors", ["company_id", "short_code"]),
    ("categories", ["company_id", "name"]),
    ("platforms", ["company_id", "name"]),
    ("sku_pricing", ["company_id", "sku_id", "platform_id"]),
])
def test_business_keys_are_unique_per_company(migrated_db, table, columns):
    """
    These were globally unique or unconstrained. Globally unique meant the
    second company could not reuse a SKU code, a vendor code, a category name
    or even store its own damage_percent.
    """
    from sqlalchemy import inspect

    insp = inspect(create_engine(f"sqlite:///{migrated_db}"))
    found = [set(c["column_names"]) for c in insp.get_unique_constraints(table)]
    found += [set(i["column_names"]) for i in insp.get_indexes(table) if i["unique"]]
    assert set(columns) in found, (
        f"{table} has no unique constraint on {columns}; found {found}"
    )


def test_no_business_key_is_unique_without_the_company(migrated_db):
    """
    The inverse guard: a unique key on a tenant table that leaves company_id out
    is the bug this suite exists for. Only genuinely global tables are exempt.
    """
    from sqlalchemy import inspect

    GLOBAL_TABLES = {"users", "companies", "hsn_codes", "alembic_version"}
    insp = inspect(create_engine(f"sqlite:///{migrated_db}"))
    offenders = []
    for table in insp.get_table_names():
        if table in GLOBAL_TABLES:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "company_id" not in cols:
            continue
        keys = [set(c["column_names"]) for c in insp.get_unique_constraints(table)]
        keys += [set(i["column_names"]) for i in insp.get_indexes(table) if i["unique"]]
        for key in keys:
            if "company_id" not in key:
                offenders.append(f"{table}{sorted(key)}")
    assert not offenders, f"tenant-table unique keys missing company_id: {offenders}"
