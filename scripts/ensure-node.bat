@echo off
REM ====================================================================
REM  ENSURE-NODE - makes sure a usable Node.js is on PATH, installing
REM  one if needed. Called by all four double-click launchers.
REM
REM  Usage:  call "scripts\ensure-node.bat"           (detect only)
REM          call "scripts\ensure-node.bat" install   (may download Node)
REM
REM  Returns 0 when Node is usable, 1 when the operator must act.
REM  On success it prepends Node's folder to PATH for the CALLER.
REM
REM  !! DO NOT ADD setlocal TO THIS FILE !!
REM  Callers reach us via `call`, so we share their environment and the
REM  PATH we set below survives back into the launcher. A setlocal here
REM  would throw that away and portable Node would vanish on return.
REM  Delayed expansion is deliberately NOT used either - every captured
REM  value is read AFTER its for-loop ends, so plain expansion is fine.
REM  Internal variables are all EN_* and are cleared before we return.
REM ====================================================================

REM ============ SINGLE SOURCE OF TRUTH - edit these lines only ========
REM  Node version installed when we have to install one ourselves.
REM  Node 24 "Krypton" is LTS through April 30 2028 - the longest
REM  runway of any version Cypress can actually use today. (Was
REM  22.23.2, whose EOL is April 30 2027; re-pinned Aug 14 2026 after
REM  verifying 24 end to end - see :__en_gate for the evidence.)
set "NODE_PIN=24.19.0"
REM  Versions we ACCEPT if already present are decided by :__en_gate
REM  below - currently majors 24 and 22 only. That is DELIBERATELY
REM  narrower than Cypress's own engines range
REM      ^20.1.0 || ^22.0.0 || >=24.0.0
REM  because that range's open top end lets in Node 26, which is
REM  proven broken, and its bottom end lets in Node 20, which is EOL.
REM  See MAINTENANCE.md for the full reasoning and the procedure for
REM  changing any of this.
REM ===================================================================

REM --- Where things live ---------------------------------------------
for %%I in ("%~dp0..") do set "EN_ROOT=%%~fI"
set "EN_HOME=%EN_ROOT%\tools"
set "EN_ALT=%LOCALAPPDATA%\BestAccessDoorsTests\tools"
set "EN_INST=%EN_ROOT%\installers"
set "EN_TMP=%TEMP%\badqa-node-%NODE_PIN%"

REM --- Windows' own tools, by ABSOLUTE path --------------------------
REM  Never call these bare. Git for Windows ships GNU tar as tar.exe,
REM  which CANNOT read .zip at all ("This does not look like a tar
REM  archive") and shadows Windows' bsdtar whenever its usr\bin is
REM  earlier on PATH. Same defensive reasoning for curl and certutil.
set "EN_CURL=%SystemRoot%\System32\curl.exe"
set "EN_TAR=%SystemRoot%\System32\tar.exe"
set "EN_CERT=%SystemRoot%\System32\certutil.exe"
set "EN_FIND=%SystemRoot%\System32\findstr.exe"

REM --- Architecture --------------------------------------------------
REM  We deliberately install the x64 build even on ARM64 Windows:
REM  Cypress publishes no Windows arm64 binary, so a native arm64 Node
REM  would report process.arch=arm64 and Cypress's own download would
REM  fail. x64 Node runs fine under the ARM64 emulator.
set "EN_OSARCH=%PROCESSOR_ARCHITECTURE%"
if defined PROCESSOR_ARCHITEW6432 set "EN_OSARCH=%PROCESSOR_ARCHITEW6432%"
set "EN_ARCH=x64"

REM  Hoisted here on purpose: the value contains parentheses, and
REM  expanding it inside an if(...) block closes the block early
REM  ("`)` was unexpected at this time").
set "EN_PF86=%ProgramFiles(x86)%"

set "EN_PKG=node-v%NODE_PIN%-win-%EN_ARCH%"
set "EN_BASE=https://nodejs.org/dist/v%NODE_PIN%"
set "EN_MODE=%~1"

REM ===================================================================
REM  RUNG 1 - portable Node we installed on a previous run
REM ===================================================================
call :__en_probe_portable
if errorlevel 1 goto :__en_rung2
call :__en_detect
if not errorlevel 1 goto :__en_success

REM ===================================================================
REM  RUNG 2 - a system Node that is new enough
REM ===================================================================
:__en_rung2
call :__en_detect
if not errorlevel 1 goto :__en_success

REM  Nothing usable. Detect-only callers stop here.
if /i not "%EN_MODE%"=="install" goto :__en_need_setup

echo.
REM  Deliberately not "too old" - it may equally be too NEW (see the
REM  Node 26 note on :__en_gate), and the operator cannot tell which.
if defined EN_VER echo  [!] Node.js %EN_VER% is not a version these tests can use.
if not defined EN_VER echo  [!] Node.js is not installed yet.
echo      Setting up Node.js %NODE_PIN% for you - nothing for you to do.
echo.

REM ===================================================================
REM  RUNG 3 - an installer someone dropped into installers\
REM ===================================================================
if exist "%EN_INST%\%EN_PKG%.zip" (
  echo  [i] Using the bundled copy in "installers\%EN_PKG%.zip"
  set "EN_ZIP=%EN_INST%\%EN_PKG%.zip"
  goto :__en_unpack
)

REM ===================================================================
REM  RUNG 4 - machine-wide install. OPT-IN ONLY.
REM  Needs an administrator prompt, so it is not the default: the
REM  portable route below needs no permission at all and behaves the
REM  same on every machine. Set SETUP_MACHINE_NODE=1 to try it.
REM ===================================================================
if "%SETUP_MACHINE_NODE%"=="1" call :__en_machine_install
if "%SETUP_MACHINE_NODE%"=="1" if "%EN_OK%"=="1" goto :__en_success

REM ===================================================================
REM  RUNG 5 - portable Node, downloaded. The default path.
REM ===================================================================
if not exist "%EN_TMP%" md "%EN_TMP%" 2>nul
if not exist "%EN_TMP%" goto :__en_tmp_fail

echo  Downloading Node.js %NODE_PIN% (about 34 MB)...
set "EN_URL=%EN_BASE%/%EN_PKG%.zip"
set "EN_OUT=%EN_TMP%\%EN_PKG%.zip"
call :__en_fetch
if errorlevel 1 goto :__en_dl_fail

set "EN_URL=%EN_BASE%/SHASUMS256.txt"
set "EN_OUT=%EN_TMP%\SHASUMS256.txt"
call :__en_fetch
if errorlevel 1 goto :__en_dl_fail

echo  Checking the download is genuine...
set "EN_FILE=%EN_TMP%\%EN_PKG%.zip"
set "EN_FNAME=%EN_PKG%.zip"
set "EN_SHAFILE=%EN_TMP%\SHASUMS256.txt"
call :__en_verify
if errorlevel 1 goto :__en_hash_fail
echo  [OK] Download verified.

set "EN_ZIP=%EN_TMP%\%EN_PKG%.zip"

REM ===================================================================
REM  Unpack a .zip (downloaded or bundled) into the tools folder
REM ===================================================================
:__en_unpack
if not exist "%EN_HOME%" md "%EN_HOME%" 2>nul
if not exist "%EN_HOME%" set "EN_HOME=%EN_ALT%"
if not exist "%EN_HOME%" md "%EN_HOME%" 2>nul
if not exist "%EN_HOME%" goto :__en_home_fail

echo  Unpacking...
if exist "%EN_HOME%\%EN_PKG%" rd /s /q "%EN_HOME%\%EN_PKG%" 2>nul
"%EN_TAR%" -xf "%EN_ZIP%" -C "%EN_HOME%"
if errorlevel 1 goto :__en_unzip_fail
if not exist "%EN_HOME%\%EN_PKG%\node.exe" goto :__en_unzip_fail

REM  Remove any older pinned version left behind by a version bump.
for /d %%D in ("%EN_HOME%\node-v*-win-%EN_ARCH%") do if /i not "%%~nxD"=="%EN_PKG%" rd /s /q "%%D" 2>nul

call :__en_probe_portable
if errorlevel 1 goto :__en_unzip_fail
call :__en_detect
if errorlevel 1 goto :__en_unzip_fail

if exist "%EN_TMP%" rd /s /q "%EN_TMP%" 2>nul
echo  [OK] Node.js %EN_VER% is ready (installed inside this folder, no
echo       changes were made to the rest of your computer).
goto :__en_success


REM ===================================================================
REM  SUCCESS / FAILURE EXITS
REM ===================================================================
:__en_success
set "EN_RC=0"
echo  [OK] Node.js %EN_VER%
goto :__en_return

:__en_need_setup
echo.
if defined EN_VER echo  [X] Node.js %EN_VER% is not a version these tests can use.
if not defined EN_VER echo  [X] Node.js is not installed.
echo      Please double-click "First Time Setup.bat" first - it will
echo      set up the right version of Node.js for you.
echo.
set "EN_RC=1"
goto :__en_return

:__en_tmp_fail
echo  [X] Could not create a temporary folder to download into.
goto :__en_manual

:__en_home_fail
echo  [X] Could not create a "tools" folder to install Node.js into.
echo      This folder may be read-only.
goto :__en_manual

:__en_dl_fail
echo.
echo  [X] Could not download Node.js from nodejs.org.
echo      This is usually no internet, or a company firewall/proxy.
goto :__en_manual

:__en_hash_fail
echo.
echo  [X] The downloaded Node.js file did not match its official
echo      checksum, so it was NOT installed. This usually means the
echo      download was interrupted - try again.
if exist "%EN_TMP%" rd /s /q "%EN_TMP%" 2>nul
goto :__en_manual

:__en_unzip_fail
echo.
echo  [X] Could not unpack Node.js.
goto :__en_manual

:__en_manual
echo.
echo      You can install Node.js by hand instead:
echo        1. Go to   https://nodejs.org
echo        2. Click the big green "LTS" button.
echo        3. Run the downloaded installer, click Next until done.
echo        4. Double-click "First Time Setup.bat" again.
echo.
set "EN_RC=1"
goto :__en_return

:__en_return
call :__en_cleanup
if "%EN_RC%"=="0" set "EN_RC=" & exit /b 0
set "EN_RC=" & exit /b 1


REM ===================================================================
REM  SUBROUTINES
REM ===================================================================

REM --- Is `node` on PATH, and is it new enough? ----------------------
:__en_detect
set "EN_OK="
set "EN_VER="
for /f "delims=" %%v in ('node --version 2^>nul') do if not defined EN_VER set "EN_VER=%%v"
if not defined EN_VER exit /b 1
REM  Strip the leading v with ~1, NOT :v= - the latter deletes every v
REM  and would corrupt a string like 24.0.0-v8-canary.
if /i "%EN_VER:~0,1%"=="v" set "EN_VER=%EN_VER:~1%"
set "EN_MAJ="
set "EN_MIN="
for /f "tokens=1,2 delims=." %%a in ("%EN_VER%") do set "EN_MAJ=%%a" & set "EN_MIN=%%b"
set "EN_N=%EN_MAJ%"
call :__en_norm
if errorlevel 1 exit /b 1
set "EN_MAJ=%EN_N%"
set "EN_N=%EN_MIN%"
call :__en_norm
if errorlevel 1 exit /b 1
set "EN_MIN=%EN_N%"
call :__en_gate
if errorlevel 1 exit /b 1
set "EN_OK=1"
exit /b 0

REM --- Normalise EN_N to a bare decimal integer ---------------------
REM  Do NOT delete this as dead weight - leading zeros really do break
REM  the gate. `if %EN_MAJ%==24` is a STRING comparison, so a version
REM  reported as "024.19.0" would not match "24" and a working Node
REM  would be rejected. (Until Aug 2026 the gate also used `if GEQ`,
REM  which parses C-style literals and made "020 GEQ 20" false because
REM  020 is octal 16 - that arm is gone, the stripping still matters.)
REM  It doubles as input validation: anything not all-digits is
REM  rejected outright rather than fed to `if` as a comparison operand.
:__en_norm
if not defined EN_N exit /b 1
echo %EN_N%|"%EN_FIND%" /r /c:"^[0-9][0-9]*$" >nul
if errorlevel 1 set "EN_N=" & exit /b 1
:__en_norm_loop
if "%EN_N%"=="0" exit /b 0
if not "%EN_N:~0,1%"=="0" exit /b 0
set "EN_N=%EN_N:~1%"
goto :__en_norm_loop

REM --- Accept/reject a parsed major.minor ---------------------------
REM  ACCEPTED: majors 24 and 22. Everything else is rejected, which
REM  costs only a portable Node installed beside the tests - whereas
REM  wrongly accepting hands the operator a broken Cypress.
REM
REM  Verified with an isolated CYPRESS_CACHE_FOLDER on a real machine:
REM
REM    Node 24.19.0 - `cypress install` downloads AND unzips to
REM                  completion, `cypress verify` passes, and a real
REM                  spec runs green (13/13). Verified Aug 14 2026.
REM    Node 22.23.2 - same, verified Aug 12 2026.
REM    Node 26.7.0 - prints "Unzipping Cypress" and then stops. The
REM                  install process EXITS 0 while leaving no
REM                  Cypress.exe behind, so nothing looks wrong until
REM                  `cypress verify` fails (exit 1). Re-verified
REM                  Aug 14 2026. Cause: Cypress 15.15.0 unzips via
REM                  extract-zip 2.0.1 -> yauzl 2.10.0, a 2017
REM                  unmaintained package declaring only
REM                  engines ">= 10.17.0".
REM
REM  Node 20 is NOT accepted even though Cypress's engines range allows
REM  it: Node 20 went end-of-life April 30 2026, so it receives no
REM  further security patches.
REM
REM  TO ACCEPT A NEW MAJOR (e.g. 26): Cypress >= 15.16.0 replaced the
REM  extract-zip/yauzl@2 stack with yauzl ^3.3.1, so bump Cypress
REM  FIRST, then re-run the verification procedure in MAINTENANCE.md,
REM  then add the major both here AND in scripts/nodeGate.js (the two
REM  are deliberate mirrors of each other).
REM  Odd majors (21, 23, 25) are non-LTS and fall through to reject.
:__en_gate
if not defined EN_MAJ exit /b 1
REM  EN_MIN is not consulted by the rules below, but a version string
REM  that produced no minor at all (a bare "v24") is malformed input
REM  and is rejected here rather than trusted.
if not defined EN_MIN exit /b 1
if %EN_MAJ%==24 exit /b 0
if %EN_MAJ%==22 exit /b 0
exit /b 1

REM --- Portable Node from a previous run ----------------------------
REM  Two passes, and the second one matters more than it looks:
REM
REM   1. the exact pinned build, in either home.
REM   2. ANY other portable build we installed on a previous run that
REM      still passes the version gate.
REM
REM  Without pass 2, the day NODE_PIN changes every existing deployment
REM  goes dark: the old tools\node-vOLD-win-x64 stops matching, so the
REM  three DETECT-ONLY launchers (Run All Tests / Run One Store / Test
REM  Dashboard) report "run First Time Setup first" even though a
REM  perfectly usable Node is sitting right there in the folder. With
REM  pass 2 a pin bump degrades to "keeps working on the old accepted
REM  version", and First Time Setup still upgrades to the new pin (the
REM  stale-version sweep in :__en_unpack then deletes the old folder).
REM
REM  First gate-passing match wins; `for /d` order is not guaranteed,
REM  which is fine because every match is by definition acceptable.
REM
REM  Every candidate goes through ONE subroutine reached from `for`
REM  bodies only. That shape is deliberate on two counts:
REM   - a for body is parsed as a single unit, so a %PATH% read inside
REM     one would expand before the loop ever ran; inside a called
REM     subroutine each line is parsed as it executes.
REM   - an earlier draft used two helpers calling each other and cmd
REM     intermittently printed "The system cannot find the batch label
REM     specified" for the inner one, purely as a function of where the
REM     label landed in the file (inserting unrelated lines nearby made
REM     it come and go). One helper, called one way, avoids that.
REM     If you add a label here, re-run the A2/A3 checks and confirm no
REM     "cannot find the batch label" line appears.
:__en_probe_portable
set "EN_PPOK="
for %%C in ("%EN_HOME%\%EN_PKG%" "%EN_ALT%\%EN_PKG%") do call :__en_pp_cand "%%~C"
if defined EN_PPOK exit /b 0
for /d %%D in ("%EN_HOME%\node-v*-win-%EN_ARCH%") do call :__en_pp_cand "%%~fD"
if defined EN_PPOK exit /b 0
for /d %%D in ("%EN_ALT%\node-v*-win-%EN_ARCH%") do call :__en_pp_cand "%%~fD"
if defined EN_PPOK exit /b 0
exit /b 1

REM  Does %1 hold a node.exe that passes the gate? Prepend it and keep
REM  it if so, otherwise put PATH back exactly as it was. Prepend, never
REM  append: a stale system Node earlier on PATH would otherwise win.
REM  Returns 0 always - the caller reads EN_PPOK, not the exit code, so
REM  that a later candidate can still be tried after a rejected one.
REM  Note the deliberate absence of if(...) blocks: PATH routinely
REM  contains "Program Files (x86)", and a literal ")" arriving via
REM  plain expansion inside a block would close it early.
:__en_pp_cand
if defined EN_PPOK exit /b 0
if not exist "%~1\node.exe" exit /b 0
set "EN_PATHSAVE=%PATH%"
set "PATH=%~1;%PATH%"
call :__en_detect
if errorlevel 1 goto :__en_pp_undo
set "NODE_BIN_DIR=%~1"
set "EN_PPOK=1"
set "EN_PATHSAVE="
exit /b 0
:__en_pp_undo
set "PATH=%EN_PATHSAVE%"
set "EN_PATHSAVE="
exit /b 0

REM --- Node installed machine-wide but not yet on our PATH ----------
REM  A fresh MSI install updates the registry and broadcasts
REM  WM_SETTINGCHANGE, but THIS cmd copied its environment at startup
REM  and will never see it. Probing known locations is instant and
REM  avoids parsing REG_EXPAND_SZ out of the registry.
:__en_probe_installed
set "EN_CAND="
if exist "%ProgramFiles%\nodejs\node.exe" set "EN_CAND=%ProgramFiles%\nodejs"
if not defined EN_CAND if defined ProgramW6432 if exist "%ProgramW6432%\nodejs\node.exe" set "EN_CAND=%ProgramW6432%\nodejs"
if not defined EN_CAND if defined EN_PF86 if exist "%EN_PF86%\nodejs\node.exe" set "EN_CAND=%EN_PF86%\nodejs"
if not defined EN_CAND if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "EN_CAND=%LOCALAPPDATA%\Programs\nodejs"
if not defined EN_CAND exit /b 1
set "PATH=%EN_CAND%;%PATH%"
set "NODE_BIN_DIR=%EN_CAND%"
set "EN_CAND="
exit /b 0

REM --- Download EN_URL to EN_OUT ------------------------------------
:__en_fetch
if not exist "%EN_CURL%" goto :__en_fetch_ps
REM  -f is mandatory: without it a 404 or proxy block page is written
REM  into the output file and only surfaces later as a corrupt archive.
"%EN_CURL%" -fL --retry 3 --connect-timeout 20 --max-time 1800 --progress-bar -o "%EN_OUT%" "%EN_URL%"
if not errorlevel 1 exit /b 0
:__en_fetch_ps
REM  Fallback for an authenticating corporate proxy: curl honours
REM  HTTP(S)_PROXY but not the system proxy or integrated Windows auth,
REM  whereas .NET's WebClient can use both.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $w=New-Object Net.WebClient; $w.Proxy=[Net.WebRequest]::GetSystemWebProxy(); $w.Proxy.Credentials=[Net.CredentialCache]::DefaultNetworkCredentials; $w.DownloadFile($env:EN_URL,$env:EN_OUT)" >nul 2>nul
if errorlevel 1 exit /b 1
if not exist "%EN_OUT%" exit /b 1
exit /b 0

REM --- Verify EN_FILE against EN_SHAFILE ----------------------------
:__en_verify
REM  The tool paths below are deliberately UNQUOTED. Inside
REM  for /f ('...') a leading quote makes cmd mis-parse the whole
REM  command line ("The filename, directory name, or volume label
REM  syntax is incorrect"). Safe here because these live under
REM  %SystemRoot%\System32, which cannot contain spaces. The FILE
REM  arguments stay quoted - those really can contain spaces.
set "EN_WANT="
for /f "tokens=1" %%A in ('%EN_FIND% /i /c:"%EN_FNAME%" "%EN_SHAFILE%"') do if not defined EN_WANT set "EN_WANT=%%A"
REM  certutil prints the bare hash on line 2, lowercase and unspaced.
REM  Lines 1 and 3 are LOCALISED, so never match on their text - skip=1
REM  and take the first line only, which is locale-independent.
set "EN_GOT="
for /f "skip=1 delims=" %%H in ('%EN_CERT% -hashfile "%EN_FILE%" SHA256') do if not defined EN_GOT set "EN_GOT=%%H"
REM  Older certutil builds emitted space-separated byte pairs.
if defined EN_GOT set "EN_GOT=%EN_GOT: =%"
if not defined EN_WANT exit /b 1
if not defined EN_GOT exit /b 1
if /i not "%EN_GOT%"=="%EN_WANT%" exit /b 1
exit /b 0

REM --- Machine-wide install (opt-in) --------------------------------
:__en_machine_install
echo  Trying a normal Windows install of Node.js...
echo      (Windows may ask for permission. Clicking No is fine - we
echo       will fall back to a method that needs no permission.)
set "EN_OK="
where winget >nul 2>nul
if errorlevel 1 goto :__en_mi_msi
REM  `where` only proves the App Execution Alias exists; --version
REM  proves App Installer is actually registered for this user.
winget --version >nul 2>nul
if not "%ERRORLEVEL%"=="0" goto :__en_mi_msi
winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity
REM  NOT `if errorlevel 1`: winget returns HRESULTs like 0x8A15010C,
REM  which cmd sees as NEGATIVE, so `errorlevel 1` silently misses
REM  every failure. And we do not branch on the code at all - the
REM  table shifts between winget versions. We just probe for node.
if not "%ERRORLEVEL%"=="0" echo  [i] winget exit code: %ERRORLEVEL%
call :__en_probe_installed
if errorlevel 1 goto :__en_mi_msi
call :__en_detect
if not errorlevel 1 exit /b 0

:__en_mi_msi
if not exist "%EN_TMP%" md "%EN_TMP%" 2>nul
if not exist "%EN_TMP%" exit /b 1
REM  Note the filename asymmetry: the zip is node-vX-win-x64.zip but
REM  the MSI is node-vX-x64.msi with NO "win-".
set "EN_URL=%EN_BASE%/node-v%NODE_PIN%-%EN_ARCH%.msi"
set "EN_OUT=%EN_TMP%\node-v%NODE_PIN%-%EN_ARCH%.msi"
call :__en_fetch
if errorlevel 1 exit /b 1
set "EN_URL=%EN_BASE%/SHASUMS256.txt"
set "EN_OUT=%EN_TMP%\SHASUMS256.txt"
call :__en_fetch
if errorlevel 1 exit /b 1
set "EN_FILE=%EN_TMP%\node-v%NODE_PIN%-%EN_ARCH%.msi"
set "EN_FNAME=node-v%NODE_PIN%-%EN_ARCH%.msi"
set "EN_SHAFILE=%EN_TMP%\SHASUMS256.txt"
call :__en_verify
if errorlevel 1 exit /b 1
REM  /passive, never /qn: with UI level None the installer cannot show
REM  the elevation consent dialog and just fails with 1603. Launching
REM  via Start-Process -Verb RunAs makes the prompt deterministic, and
REM  its throw-on-dismiss becomes a clean 1223 = user said No.
set "EN_MSI=%EN_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; try { $p=Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i',($q+$env:EN_MSI+$q),'/passive','/norestart') -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }"
set "EN_MSIRC=%ERRORLEVEL%"
if "%EN_MSIRC%"=="1223" echo  [i] You clicked No on the Windows permission prompt.
if "%EN_MSIRC%"=="1602" echo  [i] The installer was cancelled.
if "%EN_MSIRC%"=="1603" echo  [i] The installer failed - usually no administrator rights.
if "%EN_MSIRC%"=="1618" echo  [i] Another installation is already running.
call :__en_probe_installed
if errorlevel 1 exit /b 1
call :__en_detect
if not errorlevel 1 exit /b 0
exit /b 1

REM --- Clear our scratch variables, keep the intentional outputs ----
REM  (PATH and NODE_BIN_DIR are deliberately left set.)
:__en_cleanup
set "EN_ROOT=" & set "EN_HOME=" & set "EN_ALT=" & set "EN_INST=" & set "EN_TMP="
set "EN_CURL=" & set "EN_TAR=" & set "EN_CERT=" & set "EN_FIND="
set "EN_OSARCH=" & set "EN_ARCH=" & set "EN_PF86=" & set "EN_PKG=" & set "EN_BASE="
set "EN_MODE=" & set "EN_MAJ=" & set "EN_MIN=" & set "EN_N=" & set "EN_OK="
set "EN_CAND=" & set "EN_URL=" & set "EN_OUT=" & set "EN_FILE=" & set "EN_FNAME="
set "EN_SHAFILE=" & set "EN_WANT=" & set "EN_GOT=" & set "EN_ZIP="
set "EN_MSI=" & set "EN_MSIRC="
set "EN_PPOK=" & set "EN_PATHSAVE=" & set "EN_VER="
exit /b 0
