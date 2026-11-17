:: carecast-loop v1 -- starts the server and restarts it when it dies.
::
:: THIS FILE MUST STAY PURE ASCII. Not a style rule -- a measured one.
:: On 2026-09-04 the site console printed "'  ' is not recognized as an internal
:: or external command," 2932 times in 3h56m, once every 4.83s, which is exactly
:: this loop's timeout /t 5 period. Reproduced it: cmd tracks its position in a
:: batch file by BYTE offset, so with UTF-8 Korean text it lands mid-character
:: after a goto and runs the fragment as a command. Measured side by side, same
:: loop, same conditions: Korean 1672 errors / banner never printed, ASCII 0 errors.
:: server/test/installer-health-check.test.js fails the build if non-ASCII returns.
:: The Korean explanation lives in docs/ADOPT.md (mine 09) and in that test.
::
:: Rules:
::  1. ASCII only. See above.
::  2. No chcp here. The shell (carecast-start.bat) sets the code page, then calls this.
::  3. No absolute paths. The shell already did cd, so every path is relative --
::     that is what lets this one file be identical at every site and be updated by git.
::  4. No caret escapes. This is a real file, not something printed by echo.
::  5. Nobody overwrites this file while it runs. The shell swaps it at the next boot.
::
:: The site screen is not optional. Scheduled TTS, prayer audio, BGM and video are
:: played by the BROWSER on this PC, and only by a window opened on localhost
:: (src/lib/isLocal.js). A window opened on the LAN address draws the screen but
:: stays silent. On 2026-09-14 the evening prayer went out with no sound because
:: this window had been closed: the loop opened it once and never again, so the
:: server kept broadcasting to nobody while /api/health reported localClients 0.
:: That is why the loop now reopens the window when no local screen is connected.
:: NEVER "pause" HERE (user report 2026-09-16). The installed launcher runs this
:: with the console HIDDEN (CareCast-Start.vbs, window style 0), so a pause waits
:: for a key nobody can press: the window never appears and cmd.exe lives forever.
:: A bounded timeout still lets a person read it when the window IS visible.
if not exist "dist\index.html" (
  echo [CareCast] Build output is missing - dist\index.html not found.
  echo [CareCast] Reinstall CareCast, or run "npm run build" in a source checkout.
  timeout /t 20 /nobreak > nul
  exit /b 1
)
set "CC_EDGE=%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%CC_EDGE%" set "CC_EDGE=%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe"
:: ANOTHER INSTALL MUST NOT OWN PORT 3001 (user report 2026-09-22).
:: A new package kept showing the OLD version. The 09-18 EXE install at another path
:: starts HIDDEN at logon (CareCast-Start.vbs), and its hidden loop restarted the old
:: server 6 seconds after the new installer killed it. The check below then read
:: "port 3001 is up" as "already running" and opened the OLD screen.
:: So first stop loops, hidden launchers and servers of OTHER install folders, and
:: disable their logon shortcut (renamed, not deleted). This folder is never touched.
:: The guard never blocks the start: on any error it prints a line and exits 0.
set "CC_NODE=node"
if exist "runtime\node\node.exe" set "CC_NODE=runtime\node\node.exe"
if exist "scripts\other-install-guard.cjs" "%CC_NODE%" scripts\other-install-guard.cjs
:: ALREADY RUNNING: open the screen, do not start a second server.
:: (user report 2026-09-16) The log said "Already running - use the existing window"
:: and exited. But the launcher runs HIDDEN, so nobody read that, and no window
:: opened either. Double clicking the icon did NOTHING, over and over:
::     ===== CareCast start 22:23:13 =====
::     [CareCast] Already running on port 3001 - use the existing window.
::     ===== CareCast loop exited (code 0) =====
:: "The existing window" assumed one was open. The server keeps running after the
:: person closes the window, so most of the time there is none.
::
:: Opening a second window is safe: the server picks ONE sound owner and keeps it
:: ("the first window to attach stays the owner", services/sse.js), so a second
:: window draws the screen but never doubles the sound.
netstat -an 2>nul | findstr ":3001" | findstr "LISTEN" > nul
if %errorlevel% == 0 (
  echo [CareCast] Already running on port 3001 - opening the screen.
  call :openwin
  exit /b 0
)
:: Node: prefer the copy shipped inside the package (runtime\node\node.exe).
:: A packaged install has it, so the PC does not need Node installed at all, and the
:: exact build we tested is the one that runs. A source checkout or the site PC has
:: no runtime folder, so we fall back to whatever Node is on PATH - same as before.
set "CC_NODE=node"
if exist "runtime\node\node.exe" set "CC_NODE=runtime\node\node.exe"
:restart
echo.
echo  CareCast AI - starting
echo  Close this window to stop.
echo.
start /b "" "%CC_NODE%" server\index.js
set WAIT=0
:waitport
timeout /t 1 /nobreak > nul
set /a WAIT=WAIT+1
if %WAIT% GTR 30 goto open_browser
netstat -an 2>nul | findstr ":3001" | findstr "LISTEN" > nul
if errorlevel 1 goto waitport
:open_browser
if not defined CC_OPENED (
  set CC_OPENED=1
  call :openwin
)
set HFAIL=0
set SFAIL=0
set SCOOL=0
set REOPEN=0
:waitstop
timeout /t 5 /nobreak > nul
:: An open port does not mean it is alive - CC-012. /api/health returns 503 when the
:: last scheduler tick is older than 3 minutes, which catches a stalled event loop
:: or a dead cron. One miss does not kill it: three in a row, about 15 seconds.
:: A PC without curl falls back to the old port-only check - a new rule must not
:: make things worse than the one it replaces.
::
:: HEALTH FIRST, netstat only on failure (measured 2026-09-16).
:: "netstat -an" takes about 90ms on a desktop and enumerates every socket on the
:: machine; this loop ran it - plus two findstr - every 5 seconds forever, on top of
:: the curl it was going to run anyway. A successful health call already proves the
:: port is open, so the netstat was answering a question curl had just answered.
:: It still runs when curl FAILS, to tell "process gone" (restart now) from
:: "process sick" (three strikes). Fast restart is preserved; the idle cost is not.
::
:: 127.0.0.1, not localhost: on Windows localhost resolves to ::1 first, and if the
:: server ever falls back to IPv4-only binding that costs ~200ms per call.
where curl > nul 2>&1
if errorlevel 1 goto portonly
:: -o keeps the body so the same request answers a second question below.
:: Do not add a second curl here - one health call, with -f, is the liveness rule.
curl -s -f -m 5 -o cc-health.tmp http://127.0.0.1:3001/api/health
if errorlevel 1 goto curlfail
set HFAIL=0
:: Is a site screen connected? localClientsAlive counts loopback SSE clients only,
:: so 0 means nothing on this PC can make a sound. The regex dot stands for the
:: quote character - batch cannot pass a quote inside findstr /c without pain.
if %SCOOL% GTR 0 goto cooldown
findstr /r /c:"localClientsAlive.:0" cc-health.tmp > nul
if errorlevel 1 goto screenok
set /a SFAIL=SFAIL+1
echo [CareCast] no site screen %SFAIL%/3 - scheduled sound cannot play
if %SFAIL% LSS 3 goto waitstop
set SFAIL=0
:: INSTALLED BUILD: do not reopen by itself (user decision 2026-09-17).
:: carecast-start.bat of the Windows installer sets CC_AUTO_REOPEN=0. There the loop
:: runs hidden, so a person who closed the screen could not find what kept reopening
:: it ("zombie window"). The desktop icon opens the screen on demand instead
:: ("Already running - opening the screen"). Site source installs leave it unset and
:: keep reopening - that guards the 2026-09-14 silent evening prayer.
if "%CC_AUTO_REOPEN%"=="0" (
  echo [CareCast] site screen closed - open it from the desktop icon
  set SCOOL=12
  goto waitstop
)
:: Wait a minute before trying again. If the window opens but cannot connect,
:: retrying every 15s would pile up windows on the site PC.
:: BACK OFF when a person keeps closing it (user report 2026-09-17, "zombie window"):
:: the 2nd reopen in a row waits 10 min, the 3rd and later 30 min. A connected
:: screen resets the count (see screenok), so a crash still reopens within a minute.
set /a REOPEN=REOPEN+1
set SCOOL=12
if %REOPEN% GEQ 2 set SCOOL=120
if %REOPEN% GEQ 3 set SCOOL=360
echo [CareCast] reopening the site screen
call :openwin
goto waitstop
:cooldown
set /a SCOOL=SCOOL-1
goto waitstop
:screenok
set SFAIL=0
set REOPEN=0
goto waitstop
:: curl failed. Is the process gone, or just unhealthy? netstat answers that, and
:: only here - not on every quiet cycle.
:curlfail
netstat -an 2>nul | findstr ":3001" | findstr "LISTEN" > nul
if errorlevel 1 goto ccdown
goto ccsick
:: No curl on this PC: fall back to the old port-only rule.
:portonly
netstat -an 2>nul | findstr ":3001" | findstr "LISTEN" > nul
if errorlevel 1 goto ccdown
goto waitstop
:ccsick
set /a HFAIL=HFAIL+1
echo [CareCast] health check failed %HFAIL%/3 - scheduler may be stuck
if %HFAIL% GEQ 3 goto ccdown
goto waitstop
:ccdown
timeout /t 2 /nobreak > nul
goto restart

:: -- open the site screen. Edge in app mode, on localhost, autoplay allowed. --
:: Called on first start and again whenever no local screen is connected.
::
:: WHY --user-data-dir (site incident 2026-09-15).
:: --autoplay-policy is a STARTUP flag: Edge reads it only when a browser process
:: is actually created. Edge keeps one process per user-data-dir, so if a staff
:: member already has Edge open -- or Edge startup boost left one running in the
:: background -- this command does NOT start a browser. It hands the URL to the
:: process already there, and the autoplay flag is dropped WITHOUT ANY ERROR.
:: The window then opens with sound locked, and every scheduled broadcast is
:: silent while the history still says success.
:: On 2026-09-15 the 07:50 morning broadcast was logged as a success with no
:: sound, and 09:00 exercise never finished. Pressing F5 fixed it, which is what
:: a locked AudioContext looks like from the outside.
:: Giving the site screen its own profile folder means it is ALWAYS its own
:: process, so the flag always applies. It does not touch the staff member's
:: own Edge: separate profile, separate bookmarks, separate windows.
:: Relative path on purpose (rule 3) -- %CD% is CC_HOME, set by the shell.
:openwin
if not exist "%CC_EDGE%" goto :eof
start "" "%CC_EDGE%" --app=http://localhost:3001 --new-window --no-restore-last-session --autoplay-policy=no-user-gesture-required --user-data-dir="%CD%\browser-profile"
goto :eof
