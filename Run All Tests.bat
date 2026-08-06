@echo off
REM ====================================================================
REM  RUN ALL TESTS - tests every store in Chrome, one after another.
REM  Just double-click it.
REM ====================================================================
title Best Access Doors Tests - Run All Stores
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
echo   RUNNING ALL STORES IN CHROME
echo   This takes a while. Leave it alone until it finishes.
echo  ============================================================
echo.

call npm run test:all

echo.
echo  ============================================================
echo   FINISHED. Scroll up to see the PASS / FAIL summary.
echo   Results were also saved in:  results\test-results.log
echo  ============================================================
echo.
pause
