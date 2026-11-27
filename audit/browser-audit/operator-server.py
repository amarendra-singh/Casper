"""Disposable operator audit server. Never uses the application's default database."""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
work = Path(__file__).resolve().parent / 'operator'
work.mkdir(exist_ok=True)
database = work / 'operator.sqlite'
os.environ.update(
    DATABASE_URL=f'sqlite+aiosqlite:///{database.as_posix()}',
    DATABASE_URL_SYNC=f'sqlite:///{database.as_posix()}',
    UPLOADS_DIR=str(work / 'uploads'),
    SECRET_KEY='disposable-operator-audit-secret-key-2026-10-04',
    ALLOWED_ORIGINS='http://localhost:5174',
    APP_ENV='audit',
)
assert database.resolve().is_relative_to(work.resolve())
subprocess.run([sys.executable, '-m', 'alembic', '-c', str(root/'backend/alembic.ini'), 'upgrade', 'head'], cwd=root/'backend', check=True)
sys.path.insert(0, str(root/'backend'))
os.chdir(work)
import uvicorn
uvicorn.run('app.main:app', host='127.0.0.1', port=8766)
