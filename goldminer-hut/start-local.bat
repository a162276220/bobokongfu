@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [start-local] Node.js not found in PATH. Install it first: https://nodejs.org/
  pause
  exit /b 1
)

if /i "%~1"=="--no-build" (
  echo [start-local] skip build, serving existing dist/
) else (
  echo [start-local] building dist...
  node tools\build-dist.mjs
  if errorlevel 1 (
    echo [start-local] build failed
    pause
    exit /b 1
  )
)

echo [start-local] starting local server, local SQLite DB at .wrangler\dev.sqlite
echo [start-local] opening http://127.0.0.1:8788/index.html   (Ctrl+C to stop)
set OPEN_BROWSER=1
node tools\devserver.mjs
if errorlevel 1 (
  echo [start-local] server exited with an error
  pause
)
endlocal
