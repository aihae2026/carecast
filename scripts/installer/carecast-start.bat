@echo off
:: CareCast launcher shell. PURE ASCII on purpose - see carecast-loop.bat header.
::
:: WHY THIS FILE LOGS (user report 2026-09-16).
:: CareCast-Start.vbs runs this with window style 0, so the console is INVISIBLE.
:: Every echo the loop prints - "no site screen", "health check failed", "Build
:: output is missing" - went nowhere. When the user said the app was slow and
:: broadcasts were late there was nothing to read. A hidden window with no log is
:: a program that cannot be debugged.
::
:: The log lands next to the server's own log so one folder holds everything:
::   server\logs\launcher.log   (this file)
::   server\logs\server_*.log   (the Node process)
:: fileLog.js prunes only names matching server_YYYYMMDD.log, so it leaves this one
:: alone. Keep it that way if either side changes.
setlocal
title CareCast AI
cd /d "%~dp0"
if not exist "server\logs" mkdir "server\logs" 2>nul
set "CC_LOG=server\logs\launcher.log"
:: Roll at about 2 MB. One file, one backup - enough to see the last two runs and
:: small enough that a full disk never stops broadcast records from being written.
for %%F in ("%CC_LOG%") do if %%~zF GTR 2000000 move /y "%CC_LOG%" "%CC_LOG%.1" > nul 2>&1
:: A LOCKED LOG MUST NEVER STOP THE START (sandbox install test 2026-09-17).
:: The site screen (Edge) is started from inside the loop, and it INHERITS this file's
:: redirect handle. "CareCast Stop" ends node and the loop but leaves that window open,
:: so the window keeps launcher.log open. On the next start every ">> launcher.log"
:: failed with "being used by another process", and cmd SKIPS a command whose
:: redirect fails - including the "call carecast-loop.bat" below. The icon did
:: nothing until the window was closed or the PC rebooted. Reproduced on a dev PC.
:: So probe the log first; if it is locked use a spare name; if all are locked, no log.
(>> "%CC_LOG%" echo.) 2>nul || set "CC_LOG=server\logs\launcher-2.log"
(>> "%CC_LOG%" echo.) 2>nul || set "CC_LOG=server\logs\launcher-3.log"
(>> "%CC_LOG%" echo.) 2>nul || set "CC_LOG=nul"
>> "%CC_LOG%" echo ===== CareCast start %DATE% %TIME% =====
if exist "carecast-loop.next.bat" move /y "carecast-loop.next.bat" "carecast-loop.bat" > nul
:: The window is HIDDEN. If the loop file is missing, cmd prints "not recognized as an
:: internal or external command" into the log and exits - and the person who double
:: clicked sees NOTHING AT ALL. That happened in a sandbox install on 2026-09-16 and
:: only the new log showed it. Say it out loud instead.
:: The message is Korean, but this file must stay pure ASCII (see carecast-loop.bat
:: header), so the text travels as a base64 UTF-16LE PowerShell command.
if not exist "carecast-loop.bat" (
  >> "%CC_LOG%" echo [CareCast] carecast-loop.bat is missing - cannot start. Reinstall.
  powershell -NoProfile -NonInteractive -EncodedCommand QQBkAGQALQBUAHkAcABlACAALQBBAHMAcwBlAG0AYgBsAHkATgBhAG0AZQAgAFMAeQBzAHQAZQBtAC4AVwBpAG4AZABvAHcAcwAuAEYAbwByAG0AcwA7ACAAWwBTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBGAG8AcgBtAHMALgBNAGUAcwBzAGEAZwBlAEIAbwB4AF0AOgA6AFMAaABvAHcAKAAiAEMAYQByAGUAQwBhAHMAdAAgAHy5IADcwpHHWNXAySAAu7qI1bXCyLLksi4AYABuAGAAbgBE1ZTGXNUgAAzTfMd0xyAAxsW1wsiy5LI6ACAAYwBhAHIAZQBjAGEAcwB0AC0AbABvAG8AcAAuAGIAYQB0AGAAbgAE1Vy4+K2ot0THIADkstzCIAAkwVjOdNUgAPzIOMGUxi4AYABuAGAAbgCQxzjBXNUgALSwqcZAxyAARMWYtyAADNN8x9DFIACIx7XCyLLksjoAYABuAHMAZQByAHYAZQByAFwAbABvAGcAcwBcAGwAYQB1AG4AYwBoAGUAcgAuAGwAbwBnACIALAAgACIAQwBhAHIAZQBDAGEAcwB0ACIALAAgADAALAAgADEANgApACAAfAAgAE8AdQB0AC0ATgB1AGwAbAA=
  exit /b 1
)
:: Installed build: the screen opens from the desktop icon, not by itself (see loop).
set "CC_AUTO_REOPEN=0"
call "carecast-loop.bat" >> "%CC_LOG%" 2>&1
>> "%CC_LOG%" echo ===== CareCast loop exited %DATE% %TIME% (code %errorlevel%) =====
