"""Launching outside backend must not silently create a second empty database."""

from pathlib import Path
from sqlalchemy.engine import make_url
from app.core.config import normalize_database_url


def test_relative_sqlite_database_is_independent_of_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    url = make_url(normalize_database_url("sqlite+aiosqlite:///./casper.db"))
    backend = Path(__file__).resolve().parents[1]
    assert Path(url.database).resolve() == backend / "casper.db"


def test_absolute_sqlite_url_is_preserved(tmp_path):
    original = "sqlite:///" + (tmp_path / "target.db").as_posix()
    assert normalize_database_url(original) == original


def test_memory_and_uri_sqlite_urls_are_preserved():
    for original in (
        "sqlite:///:memory:",
        "sqlite+aiosqlite://",
        "sqlite:///file:fixture.db?mode=ro&uri=true",
    ):
        assert normalize_database_url(original) == original


def test_postgres_credentials_and_query_are_preserved():
    original = "postgresql+asyncpg://synthetic:fake%40password@localhost/example?ssl=require"
    assert normalize_database_url(original) == original
