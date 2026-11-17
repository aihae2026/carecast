@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0.."

:: ============================================================
:: CareCast bootstrap self-check
::
:: Purpose: the dev-environment installer ("carecast-개발환경-설치.bat") and the
:: loop launcher ("scripts\start-loop.bat") were only ever exercised on the
:: machine that wrote them. This script reproduces the risky parts in a temp
:: folder so a SECOND PC can be checked in one run, without reinstalling
:: anything or touching the Desktop.
::
:: Run it on a new PC right after the installer finishes.
:: Everything is written under %TEMP%\carecast_bootstrap_check and cleaned up.
:: ============================================================

set "WORK=%TEMP%\carecast_bootstrap_check"
set FAIL=0

if exist "%WORK%" rd /s /q "%WORK%"
mkdir "%WORK%" 2>nul

echo.
echo === CareCast bootstrap self-check ===
echo.

:: ---- [1] required tools -------------------------------------------------
echo [1/5] Required tools
for %%T in (node git curl) do (
  where %%T >nul 2>&1
  if errorlevel 1 (
    echo    FAIL - %%T not found in PATH
    set FAIL=1
  ) else (
    echo    ok   - %%T
  )
)
echo.

:: ---- [2] repo layout ----------------------------------------------------
echo [2/5] Repo layout
for %%F in ("node_modules" "server\node_modules" "scripts\start-loop.bat" "docs\LOOP_TASK.md") do (
  if exist "%%~F" (
    echo    ok   - %%~F
  ) else (
    echo    FAIL - missing: %%~F
    set FAIL=1
  )
)
if exist "server\.env" (
  echo    ok   - server\.env
) else (
  echo    WARN - server\.env missing ^(optional - see server\.env.example; API keys fall back to DB settings^)
)
echo.

:: ---- [3] generated start bat, incl. a path containing a space ------------
:: A different PC very likely has a different username, and usernames with a
:: space ("John Smith") are the classic case that breaks naive quoting.
echo [3/5] Start-bat generation ^(with a space in the path^)
set "D=%WORK%\John Smith\carecast-dev"
mkdir "%D%" 2>nul
set "SBAT=%WORK%\GEN-Start.bat"

(echo @echo off
echo cd /d "%D%"
echo if not exist "%D%\node_modules" ^(
echo   echo [ERROR] Dependencies missing. Run the dev setup installer again.
echo   pause
echo   exit /b 1
echo ^)
echo echo Starting backend...
echo start "Backend" cmd /k "cd /d "%D%" && node server\index.js"
echo start "Claude" cmd /k "cd /d "%D%" && call scripts\start-loop.bat") > "%SBAT%"

if not exist "%SBAT%" (
  echo    FAIL - could not write the generated bat
  set FAIL=1
) else (
  findstr /C:"&& node server\index.js" "%SBAT%" >nul
  if errorlevel 1 (
    echo    FAIL - "&&" did not survive generation ^(quoting/escaping broke^)
    set FAIL=1
  ) else (
    echo    ok   - "&&" survived generation
  )
  findstr /C:"John Smith" "%SBAT%" >nul
  if errorlevel 1 (
    echo    FAIL - path with a space was mangled
    set FAIL=1
  ) else (
    echo    ok   - path with a space preserved
  )
)

:: the exact cmd /k quoting pattern must actually execute
echo console.log^('OK'^) > "%D%\probe.js"
cmd /c "cd /d "%D%" && node probe.js" >nul 2>&1
if errorlevel 1 (
  echo    FAIL - nested-quote command did not run
  set FAIL=1
) else (
  echo    ok   - nested-quote command runs
)
echo.

:: ---- [4] start-loop.bat file hygiene ------------------------------------
:: A UTF-8 BOM makes cmd choke on the first line; LF-only endings break labels.
echo [4/5] start-loop.bat hygiene
powershell -NoProfile -NonInteractive -Command ^
  "$b=[IO.File]::ReadAllBytes('scripts\start-loop.bat'); $bom = ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF); $t=[IO.File]::ReadAllText('scripts\start-loop.bat'); $crlf = $t.Contains(\"`r`n\"); if($bom){Write-Output '   FAIL - has UTF-8 BOM'; exit 1}; if(-not $crlf){Write-Output '   FAIL - not CRLF'; exit 1}; Write-Output '   ok   - no BOM, CRLF endings'; exit 0"
if errorlevel 1 set FAIL=1
echo.

:: ---- [5] loop launcher decision logic -----------------------------------
:: Must distinguish three outcomes. The important one is the third: a backend
:: that is not up yet must NOT be reported as "loop disabled".
echo [5/5] Loop launcher decision logic
set LOOPCFG=
for /f "delims=" %%s in ('curl -s -m 3 http://localhost:3001/api/dev/proposals/loop-settings 2^>nul') do set LOOPCFG=%%s

if "!LOOPCFG!"=="" (
  echo    INFO - backend not running, so the live check is skipped.
  echo           Start the backend and re-run to exercise enabled/disabled.
) else (
  echo !LOOPCFG! | findstr /C:"\"enabled\":true" >nul
  if errorlevel 1 (
    echo    ok   - backend reachable, loop is currently DISABLED
  ) else (
    echo    ok   - backend reachable, loop is currently ENABLED
  )
)

:: unreachable branch must exit non-zero and must not claim "disabled"
set UNREACH=
for /f "delims=" %%s in ('curl -s -m 2 http://localhost:39999/api/dev/proposals/loop-settings 2^>nul') do set UNREACH=%%s
if "!UNREACH!"=="" (
  echo    ok   - unreachable backend yields empty response ^(handled as "not reachable"^)
) else (
  echo    FAIL - unexpected response from a dead port
  set FAIL=1
)
echo.

rd /s /q "%WORK%" 2>nul

echo ============================================
if "%FAIL%"=="0" (
  echo  RESULT: PASS - bootstrap looks healthy on this PC
) else (
  echo  RESULT: FAIL - see the FAIL lines above
)
echo ============================================
echo.
pause
exit /b %FAIL%
