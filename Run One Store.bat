@echo off
REM ====================================================================
REM  RUN ONE STORE - pick a store from the menu, tests it in Chrome.
REM  Just double-click it.
REM ====================================================================
title Best Access Doors Tests - Run One Store
REM  pushd, not cd /d: cd /d cannot enter a UNC path (\\server\share).
pushd "%~dp0"
if errorlevel 1 (
  echo  [X] Could not open the tests folder.
  pause
  exit /b 1
)

REM --- Make sure Node.js is usable (before the node_modules check,
REM      because First Time Setup itself needs Node.js) -------------
call "%~dp0scripts\ensure-node.bat"
if errorlevel 1 (
  popd
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo  [!] It looks like setup hasn't run yet.
  echo      Running "First Time Setup" for you now...
  echo.
  call "First Time Setup.bat"
  if errorlevel 1 (
    popd
    exit /b 1
  )
)

:menu
cls
echo.
echo  ============================================================
echo   PICK A STORE TO TEST  (type the number, then press Enter)
echo  ============================================================
echo.
echo    1.  BESTUS  - Best Access Doors USA
echo    2.  BESTCA  - Best Access Doors Canada
echo    3.  ADAP    - Access Doors and Panels
echo    4.  ADC     - Access Doors Canada
echo    5.  AAP     - Acudor Access Panels
echo    6.  FSE     - Fire Safety Equipment
echo    7.  BRH     - Best Roof Hatches
echo    8.  CAD     - California Access Doors
echo    9.  PDA     - Puertas de Acceso
echo.
echo    0.  Quit
echo.
set "store="
set /p choice=  Your choice:

if "%choice%"=="1" set store=bestus
if "%choice%"=="2" set store=bestca
if "%choice%"=="3" set store=adap
if "%choice%"=="4" set store=adc
if "%choice%"=="5" set store=aap
if "%choice%"=="6" set store=fse
if "%choice%"=="7" set store=brh
if "%choice%"=="8" set store=cad
if "%choice%"=="9" set store=pda
if "%choice%"=="0" popd & exit /b 0

if not defined store (
  echo.
  echo  That wasn't one of the numbers. Try again.
  echo.
  pause
  goto menu
)

echo.
echo  ============================================================
echo   RUNNING %store% IN CHROME
echo   Leave it alone until it finishes.
echo  ============================================================
echo.

call npm run test:store -- %store%

echo.
echo  ============================================================
echo   FINISHED with %store%. Scroll up to see results.
echo   Results were also saved in:  results\test-results.log
echo  ============================================================
echo.
pause
goto menu
