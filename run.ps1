# run.ps1 - start Casper for local development (Windows / PowerShell)
#
# Usage:
#   .\run.ps1          Start backend + frontend, open the browser
#   .\run.ps1 -Setup   First-time: install backend + frontend deps, then start
#
# The backend port is read from the Vite proxy in frontend/vite.config.js, so
# the frontend can always reach the API regardless of which port is configured.

param([switch]$Setup)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- resolve tools & config --------------------------------------------------

# Python: prefer the project venv, fall back to python on PATH.
$py = Join-Path $root 'backend\env\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }

# Backend port = whatever the Vite dev proxy forwards /api to (default 8766).
$viteConfig = Join-Path $root 'frontend\vite.config.js'
$backendPort = 8766
if (Test-Path $viteConfig) {
  $raw = Get-Content $viteConfig -Raw
  if ($raw -match "target:\s*'http://localhost:(\d+)'") { $backendPort = $Matches[1] }
}

# --- first-run setup ---------------------------------------------------------

# Create backend/.env with a real SECRET_KEY if it does not exist yet.
$envFile = Join-Path $root 'backend\.env'
if (-not (Test-Path $envFile)) {
  $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 50 | ForEach-Object { [char]$_ })
  $exampleFile = Join-Path $root 'backend\.env.example'
  if (Test-Path $exampleFile) {
    $envText = (Get-Content $exampleFile -Raw) -replace 'SECRET_KEY=.*', "SECRET_KEY=$secret"
  } else {
    $envText = "SECRET_KEY=$secret`r`n"
  }
  # Write WITHOUT a BOM. PowerShell 5.1's `-Encoding utf8` prepends a UTF-8 BOM,
  # which python-decouple does not strip, so the first key becomes "﻿SECRET_KEY"
  # and the backend aborts on boot for a missing SECRET_KEY.
  [System.IO.File]::WriteAllText($envFile, $envText, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Created backend\.env with a generated SECRET_KEY." -ForegroundColor Yellow
}

if ($Setup) {
  Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
  & $py -m pip install -r (Join-Path $root 'backend\requirements.txt')
}
if ($Setup -or -not (Test-Path (Join-Path $root 'frontend\node_modules'))) {
  Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
  Push-Location (Join-Path $root 'frontend'); npm install; Pop-Location
}

# --- launch both servers, each in its own window -----------------------------

$backendCmd  = "Set-Location '$root\backend'; & '$py' -m uvicorn app.main:app --reload --port $backendPort"
$frontendCmd = "Set-Location '$root\frontend'; npm run dev"

Write-Host "Starting backend on http://localhost:$backendPort ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd

Write-Host "Starting frontend on http://localhost:5173 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCmd

Start-Sleep -Seconds 4
Start-Process 'http://localhost:5173'

Write-Host ""
Write-Host "Casper is starting up:" -ForegroundColor Green
Write-Host "  Frontend   http://localhost:5173" -ForegroundColor Green
Write-Host "  Backend    http://localhost:$backendPort  (docs at /docs)" -ForegroundColor Green
Write-Host "  Login      admin@casper.com / Admin@1234" -ForegroundColor Green
Write-Host ""
Write-Host "Close the two spawned PowerShell windows to stop the servers." -ForegroundColor DarkGray
