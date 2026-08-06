@echo off
REM ====================================================================
REM  TEST DASHBOARD - opens a friendly test runner in your web browser.
REM  Just double-click it. Your browser opens; click "Run".
REM  Leave this window open while you use the dashboard; closing it stops it.
REM ====================================================================
title Best Access Doors Tests - Dashboard
cd /d "%~dp0"

REM --- Make sure setup was done first -------------------------------
if not exist "node_modules" (
  echo.
  echo  [!] It looks like setup hasn't run yet.
  echo      Running "First Time Setup" for you now...
  echo.
  call "First Time Setup.bat"
)

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed. Run "First Time Setup.bat" first.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   STARTING THE TEST DASHBOARD
echo   Your browser will open at:  http://localhost:8420
echo   Leave THIS window open. Close it to stop the dashboard.
echo  ============================================================
echo.

REM Open the browser after a short delay so the server is listening.
start "" cmd /c "timeout /t 2 >nul & start chrome http://localhost:8420"

node scripts/dashboard/server.js

REM Clean shutdown (Exit button in the dashboard) -> close this window.
REM Anything else (crash, port in use) -> keep it open so the error is readable.
if %errorlevel% equ 0 exit

echo.
echo  ============================================================
echo   The dashboard has stopped unexpectedly. See the error above.
echo  ============================================================
echo.
pause
