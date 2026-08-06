@echo off
REM ====================================================================
REM  FIRST TIME SETUP - run this once before running any tests.
REM  Double-click it. It installs everything the tests need.
REM ====================================================================
title Best Access Doors Tests - First Time Setup
cd /d "%~dp0"

echo.
echo  ============================================================
echo   FIRST TIME SETUP
echo  ============================================================
echo.

REM --- Check Node.js is installed -----------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is NOT installed.
  echo.
  echo      Please install it first from:  https://nodejs.org
  echo      Pick the big green "LTS" button, run the installer,
  echo      click Next until it finishes, then run this file again.
  echo.
  pause
  exit /b 1
)

echo  [OK] Node.js found:
node --version
echo.
echo  Installing test tools... this can take a few minutes.
echo  (You only have to do this once.)
echo.

call npm install
if errorlevel 1 (
  echo.
  echo  [X] Something went wrong installing. Take a screenshot of the
  echo      red text above and send it to whoever set this up.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   ALL SET! You can now double-click:
echo     - "Run All Tests.bat"   (tests every store)
echo     - "Run One Store.bat"   (pick a single store)
echo  ============================================================
echo.
pause
