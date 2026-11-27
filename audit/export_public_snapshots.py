"""Export business-data snapshots without usable accounts or session history.

The source databases stay local. Run from the repository root.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "audit" / "public-data"
BACKEND = ROOT / "backend"
ARCHIVE = ROOT / "audit" / "backups" / "casper-before-majnu-delete-20261024-004059.zip"


def export_database(source: Path, target: Path) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    with closing(sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(target)) as public:
            original.backup(public)
            source_users = original.execute(
                "SELECT id, name, email, password_hash FROM users"
            ).fetchall()
            public.execute(
                "UPDATE users SET name = 'Public User ' || id, "
                "email = 'public-user-' || id || '@example.invalid', "
                "password_hash = '!disabled-public-export!', is_active = 0"
            )
            tables = {
                row[0]
                for row in public.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if "token_blacklist" in tables:
                public.execute("DELETE FROM token_blacklist")
            public.commit()
            public.execute("VACUUM")
            assert public.execute("PRAGMA quick_check").fetchone()[0] == "ok"
            assert not public.execute("PRAGMA foreign_key_check").fetchall()
            assert public.execute("SELECT COUNT(*) FROM users").fetchone()[0] == len(source_users)
            assert all(
                row[0] == "!disabled-public-export!" and row[1] == 0
                for row in public.execute("SELECT password_hash, is_active FROM users")
            )
            if "token_blacklist" in tables:
                assert public.execute("SELECT COUNT(*) FROM token_blacklist").fetchone()[0] == 0
            for table in tables - {"users", "token_blacklist", "sqlite_sequence"}:
                if table.startswith("sqlite_"):
                    continue
                quoted = '"' + table.replace('"', '""') + '"'
                assert original.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone() == public.execute(
                    f"SELECT COUNT(*) FROM {quoted}"
                ).fetchone(), table
    blob = target.read_bytes()
    for _, name, email, password_hash in source_users:
        for value in (name, email, password_hash):
            if value:
                assert str(value).encode("utf-8") not in blob
    return {"source": str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else source.name,
            "public": str(target.relative_to(ROOT)), "users_disabled": len(source_users),
            "bytes": len(blob)}


def main() -> None:
    sources = [BACKEND / "casper.db", *sorted(BACKEND.glob("casper.db.bak-*"))]
    manifest = [
        export_database(source, OUTPUT / f"{source.name}.sqlite")
        for source in sources
    ]
    with ZipFile(ARCHIVE) as original_zip, tempfile.TemporaryDirectory(dir=OUTPUT) as temp:
        private_db = Path(temp) / "casper.db"
        private_db.write_bytes(original_zip.read("casper.db"))
        public_db = Path(temp) / "public.db"
        entry = export_database(private_db, public_db)
        target = OUTPUT / "casper-before-majnu-delete-20261024-004059-public.zip"
        with ZipFile(target, "w", ZIP_DEFLATED) as public_zip:
            for name in original_zip.namelist():
                public_zip.writestr(name, public_db.read_bytes() if name == "casper.db" else original_zip.read(name))
        entry.update(source=str(ARCHIVE.relative_to(ROOT)), public=str(target.relative_to(ROOT)),
                     bytes=target.stat().st_size)
        manifest.append(entry)
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(manifest)} credential-disabled database snapshots")


if __name__ == "__main__":
    main()
