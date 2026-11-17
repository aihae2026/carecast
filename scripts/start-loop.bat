@echo off
chcp 65001 > nul
cd /d "%~dp0.."

:: Only start a session if loop_enabled is on -- otherwise every Dev-Start.bat
:: run would pop up an extra window even when the loop isn't wanted.
::
:: The backend is launched only a few seconds before this script by
:: CareCast-Dev-Start.bat. On a fresh/slow PC (cold npm cache, slow disk, python
:: probing) it is often NOT listening yet. The old version treated "no response"
:: the same as "loop disabled" and printed a misleading message telling the user
:: to enable it in admin -- while the loop was actually on and just never started.
:: So: retry for up to 60s, and report "backend unreachable" distinctly.

set RETRIES=30
set LOOPCFG=

:waitloop
for /f "delims=" %%s in ('curl -s -m 3 http://localhost:3001/api/dev/proposals/loop-settings 2^>nul') do set LOOPCFG=%%s
if not "%LOOPCFG%"=="" goto gotcfg
set /a RETRIES-=1
if %RETRIES% LEQ 0 goto unreachable
echo [loop] waiting for backend... (%RETRIES% tries left)
:: ping 대신 timeout을 쓰면 stdin이 리다이렉트된 환경(스케줄러/CI/일부 런처)에서
:: "Input redirection is not supported"로 즉시 죽는다 — 실제로 테스트 중 발생함.
ping -n 3 127.0.0.1 > nul
goto waitloop

:unreachable
echo.
echo [loop] BACKEND NOT REACHABLE at http://localhost:3001 after 60s.
echo The self-check loop was NOT started.
echo This is not the same as the loop being turned off -- the backend just
echo never came up. Check the "Backend" window for errors, then run:
echo   scripts\start-loop.bat
echo.
pause
exit /b 1

:gotcfg
echo %LOOPCFG% | findstr /C:"\"enabled\":true" > nul
if errorlevel 1 (
  echo [loop] disabled - not starting a session.
  echo Turn it on from CareCast admin - "Improvement Proposals" tab.
  exit /b 0
)

echo [loop] enabled - starting a Claude session.
claude "/loop 2h docs\LOOP_TASK.md 파일의 지침을 그대로 따라 CareCast 로컬 자율 점검 루프를 수행해줘."
