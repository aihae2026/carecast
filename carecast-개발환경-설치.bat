@echo off
chcp 65001 > nul
title CareCast Dev Setup
cls

echo.
echo  === CareCast Dev Environment Setup ===
echo.

set "IDIR=%USERPROFILE%\carecast-dev"

:: Node.js
node --version > nul 2>&1
if errorlevel 1 (
  echo [1/6] Installing Node.js...
  winget install OpenJS.NodeJS.LTS --version 24.20.0 --accept-source-agreements --accept-package-agreements -e
  echo [1/6] Done. Restart CMD and run again.
  pause
  exit /b
) else (
  echo [1/6] Node.js already installed
)
echo.

:: Git
git --version > nul 2>&1
if errorlevel 1 (
  echo [2/6] Installing Git...
  winget install Git.Git --accept-source-agreements --accept-package-agreements -e
  echo [2/6] Done. Restart CMD and run again.
  pause
  exit /b
) else (
  echo [2/6] Git already installed
)
echo.

:: VS Code
code --version > nul 2>&1
if errorlevel 1 (
  echo [3/6] Installing VS Code...
  winget install Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements -e
  code --version > nul 2>&1
  if errorlevel 1 (
    echo [WARNING] VS Code install failed. Install manually: https://code.visualstudio.com
  ) else (
    echo [3/6] VS Code installed
  )
) else (
  echo [3/6] VS Code already installed
)
echo.

:: Claude Code
claude --version > nul 2>&1
if errorlevel 1 (
  echo [4/6] Installing Claude Code...
  call npm install -g @anthropic-ai/claude-code
  claude --version > nul 2>&1
  if errorlevel 1 (
    echo [WARNING] Claude Code install failed. Try manually: npm install -g @anthropic-ai/claude-code
  ) else (
    echo [4/6] Done
  )
) else (
  echo [4/6] Claude Code already installed
)
echo.

:: Clone or pull
:: The public repo publishes only "main", so code is pulled from origin/main.
:: But this PC must NOT sit on a local branch named "main": the server treats
:: branch "main" as a live site PC (server/services/pcRole.js) and then turns on
:: 10-minute auto-update (git checkout -- . wipes uncommitted work, then the
:: server exits), audio-device resets and scheduled shutdown. So the working
:: branch here is a local "dev" branch that follows origin/main.
if exist "%IDIR%\.git" (
  echo [5/6] Updating code...
  cd /d "%IDIR%"
  rem Accept the public repo and any fork of it - a repo named "carecast", any owner.
  rem Only an unrelated repo in the same folder is refused.
  call :cc_origin_is_carecast
  if errorlevel 1 (
    echo [ERROR] %IDIR% is a clone of a different repository ^(origin is not a "carecast" repo^).
    echo If it is your renamed fork, set its origin URL or rename the fork to "carecast".
    echo Otherwise move or rename that folder, then run this installer again.
    pause
    exit /b 1
  )
  git checkout dev 2> nul || git checkout -b dev
  if errorlevel 1 (
    echo [ERROR] Could not switch to the local dev branch.
    echo Check for uncommitted changes or conflicts in %IDIR%
    pause
    exit /b 1
  )
  git pull origin main
  if errorlevel 1 (
    echo [ERROR] git pull failed - most likely uncommitted local changes are
    echo conflicting with the update, so this PC still has an old version.
    echo   1. cd /d "%IDIR%"
    echo   2. git status   ^(see what's uncommitted^)
    echo   3. commit/push it, or "git stash" it, then run this installer again
    pause
    exit /b 1
  )
) else (
  echo [5/6] Cloning repo...
  git clone -b main https://github.com/jung-svg/carecast.git "%IDIR%"
  if errorlevel 1 (
    echo [ERROR] git clone failed. Check your internet connection and GitHub access.
    pause
    exit /b 1
  )
  cd /d "%IDIR%"
  git checkout -b dev
  if errorlevel 1 (
    echo [ERROR] Could not create the local dev branch.
    pause
    exit /b 1
  )
)
echo.

:: npm install
echo [6/6] Installing packages...
cd /d "%IDIR%"
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed in root folder.
  pause
  exit /b 1
)
cd server
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed in server folder.
  cd ..
  pause
  exit /b 1
)
cd ..
echo [6/6] Done
echo.

:: .env check
if not exist "%IDIR%\server\.env" (
  echo [OPTIONAL] To pre-fill API keys, copy server\.env.example to server\.env and fill it in.
  echo Keys can also be entered later in the admin screen.
  echo Location: %IDIR%\server\.env
  echo.
)

:: VS Code extension - Claude
echo Installing Claude extension for VS Code...
code --install-extension anthropic.claude-code > nul 2>&1
echo Done
echo.

:: Create start bat
:: NOTE: the Claude window is launched last, but it does NOT rely on the timeouts
:: above being long enough -- scripts\start-loop.bat waits for the backend on its
:: own (up to 60s) and reports "backend not reachable" instead of silently
:: pretending the loop is disabled. On a fresh PC the backend often needs more
:: than the few seconds these timeouts allow.
:: To sanity-check a new PC after install, run: scripts\verify-bootstrap.bat
set "SBAT=%USERPROFILE%\Desktop\CareCast-Dev-Start.bat"
set "D=%IDIR%"

(echo @echo off
echo cd /d "%D%"
echo if not exist "%D%\node_modules" ^(
echo   echo [ERROR] Dependencies missing. Run the dev setup installer again.
echo   pause
echo   exit /b 1
echo ^)
echo if not exist "%D%\server\.env" ^(
echo   echo [INFO] server\.env is missing - optional. See server\.env.example.
echo ^)
echo echo Starting backend...
echo start "Backend" cmd /k "cd /d "%D%" && node server\index.js"
echo timeout /t 3 /nobreak ^> nul
echo echo Starting Vite...
echo start "Vite" cmd /k "cd /d "%D%" && npm run dev"
echo timeout /t 5 /nobreak ^> nul
echo start "" "https://localhost:5173"
echo code "%D%"
echo start "Claude" cmd /k "cd /d "%D%" && call scripts\start-loop.bat"
echo echo Done! Open: https://localhost:5173) > "%SBAT%"

echo.
echo === Setup Complete! ===
echo Run: %SBAT%
echo.
echo TIP: Sign in VS Code with GitHub to sync extensions and settings
echo.
pause
exit /b 0

:cc_origin_is_carecast
rem errorlevel 0 when origin ends with "/carecast" or "/carecast.git" (any owner).
rem Checked by string slicing, not by findstr "$": git prints LF-only line ends and
rem findstr's "$" anchor is not guaranteed to match before a bare LF.
set "CC_ORIGIN="
for /f "delims=" %%U in ('git remote get-url origin 2^>nul') do set "CC_ORIGIN=%%U"
if not defined CC_ORIGIN exit /b 1
if /i "%CC_ORIGIN:~-9%"=="/carecast" exit /b 0
if /i "%CC_ORIGIN:~-13%"=="/carecast.git" exit /b 0
exit /b 1
