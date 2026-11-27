"""Production requirements/bootstrap smoke test in a disposable environment."""
import json, os, subprocess, tempfile, venv
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='casper-clean-bootstrap-') as folder:
    target = Path(folder)
    venv.EnvBuilder(with_pip=True).create(target/'env')
    python = target/'env/Scripts/python.exe'
    variables = dict(os.environ, DATABASE_URL='sqlite+aiosqlite:///' + (target/'fresh.db').as_posix(),
        DATABASE_URL_SYNC='sqlite:///' + (target/'fresh.db').as_posix(), APP_ENV='production', APP_DEBUG='false',
        SECRET_KEY='synthetic-bootstrap-key-32-characters-long', SEED_ADMIN_PASSWORD='Synthetic-Bootstrap-Password',
        SEED_ADMIN_EMAIL='bootstrap@example.test', UPLOADS_DIR=str(target/'uploads'))
    steps = [([str(python),'-m','pip','install','-r','requirements.txt'], 'production_install'),
             ([str(python),'-m','scripts.bootstrap_db'], 'bootstrap'),
             ([str(python),'-m','scripts.bootstrap_db'], 'idempotent_bootstrap'),
             ([str(python),'-c',"from app.main import app; from app.core.security import hash_password,verify_password; assert verify_password('Synthetic-Password',hash_password('Synthetic-Password')); assert '/api/v1/auth/login' in app.openapi()['paths']"], 'application_import')]
    summary = {'disposable_environment_only': True, 'checks': {}}
    for command, name in steps:
        result = subprocess.run(command,cwd=ROOT/'backend',env=variables,capture_output=True,text=True)
        summary['checks'][name] = {'exit_code': result.returncode}
        if result.returncode:
            summary['checks'][name]['diagnostic'] = result.stderr[-3000:]
            break
    (ROOT/'audit/clean-bootstrap-check.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary))
