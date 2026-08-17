@echo off
REM ====================================================================
REM  FIRST TIME SETUP - run this once before running any tests.
REM  Double-click it. It installs everything the tests need,
REM  including Node.js itself if you don't already have it.
REM ====================================================================
title Best Access Doors Tests - First Time Setup
REM  pushd, not cd /d: cd /d cannot enter a UNC path (\\server\share)
REM  and would silently leave us running in C:\Windows\System32.
pushd "%~dp0"
if errorlevel 1 (
  echo  [X] Could not open the tests folder.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   FIRST TIME SETUP
echo  ============================================================
echo.
echo  This sets up everything the tests need. It can take
echo  10-20 minutes the first time, mostly downloading.
echo  You only have to do this once. Leave it alone until it
echo  says ALL SET.
echo.

REM --- Make sure a usable Node.js is available -----------------------
REM  "install" lets the helper download Node.js if it has to.
call "%~dp0scripts\ensure-node.bat" install
if errorlevel 1 (
  popd
  pause
  exit /b 1
)

echo.
echo  Installing test tools... this can take a few minutes.
echo.

call npm install
if errorlevel 1 (
  echo.
  echo  [X] Something went wrong installing. Take a screenshot of the
  echo      red text above and send it to whoever set this up.
  echo.
  popd
  pause
  exit /b 1
)

REM --- Fetch the Cypress browser binary -----------------------------
REM  npm does NOT do this for us: this npm version skips install
REM  scripts, so Cypress's own postinstall never runs and `npm install`
REM  alone leaves no test browser at all. Without these two steps
REM  setup would say ALL SET and then every single test run would fail.
echo.
echo  Downloading the test browser (about 200 MB, please wait)...
echo.
node "%~dp0node_modules\cypress\bin\cypress" install
if errorlevel 1 (
  echo.
  echo  [X] Could not download the test browser. Take a screenshot of
  echo      the red text above and send it to whoever set this up.
  echo.
  popd
  pause
  exit /b 1
)

node "%~dp0node_modules\cypress\bin\cypress" verify
if errorlevel 1 (
  echo.
  echo  [X] The test browser downloaded but did not pass its self-check.
  echo      Take a screenshot of the red text above and send it to
  echo      whoever set this up.
  echo.
  popd
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   ALL SET! You can now double-click:
echo     - "Test Dashboard.bat"  (easiest - buttons in your browser)
echo     - "Run All Tests.bat"   (tests every store)
echo     - "Run One Store.bat"   (pick a single store)
echo  ============================================================
echo.
popd
pause
