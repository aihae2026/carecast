@echo off
chcp 65001 > nul
title CareCast AI - 설치
cls

echo.
echo  ==========================================
echo   CareCast AI 설치 프로그램
echo  ==========================================
echo.

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

:: ── 함께 담아 온 Node 를 먼저 쓴다 (2026-09-16) ──────────────────────────────
:: 설치판에는 `runtime\node\node.exe` 가 들어 있다. 그러면 이 PC 에 Node 가 없어도
:: 설치가 끝까지 간다 — 새로 산 PC 에 무엇을 먼저 깔아야 하는지 사람이 알 필요가 없다.
:: **판본이 고정이라는 것도 값어치다**: 우리가 시험을 통과시킨 그 실행기가 그대로 돈다.
:: 소스로 받았거나 현장 PC 처럼 없으면 예전과 똑같이 시스템 Node 를 찾는다.
set "NODE_BIN=node"
if exist "%PROJECT_DIR%\runtime\node\node.exe" set "NODE_BIN=%PROJECT_DIR%\runtime\node\node.exe"

"%NODE_BIN%" --version > nul 2>&1
if errorlevel 1 (
  echo  [오류] Node.js가 설치되어 있지 않습니다.
  echo.
  echo  CMD 창에서 아래 명령어를 실행하세요:
  echo    winget install OpenJS.NodeJS.LTS --version 24.20.0
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('"%NODE_BIN%" --version') do set NODE_VER=%%v
if /i not "%NODE_BIN%"=="node" (
  echo  Node.js %NODE_VER% ^(함께 들어 있는 것을 씁니다^)
) else (
  echo  Node.js %NODE_VER% 확인됨
)

:: 내려받은 폴더(.git 없음)에서도 설치되게 한다(2026-09-16).
:: 현장 PC 는 .git 이 있어 IS_GIT_CLONE=1 이 되고 아래 길이 그대로 유지된다.
set "IS_GIT_CLONE=0"
if exist "%PROJECT_DIR%\.git" set "IS_GIT_CLONE=1"

:: ── 이미 다 만들어진 「설치판」인가 (2026-09-16) ─────────────────────────────
:: 설치판에는 화면(dist)과 서버 꾸러미(server\node_modules)가 **이미 들어 있다.**
:: 그러면 npm install(5~15분)과 빌드를 할 이유가 없다 — 인터넷도 필요 없다.
:: 소스로 받은 폴더나 현장 PC(git)에는 둘이 없으므로 예전과 똑같이 만든다.
set "PREBUILT=0"
if exist "%PROJECT_DIR%\dist\index.html" if exist "%PROJECT_DIR%\server\node_modules" set "PREBUILT=1"

if "%IS_GIT_CLONE%"=="0" goto :NO_GIT_NEEDED
git --version > nul 2>&1
if errorlevel 1 (
  echo  Git이 없습니다. 설치 중... ^(1-2분 소요^)
  winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements > nul 2>&1
  if errorlevel 1 (
    echo  [오류] Git 설치 실패. 수동으로 https://git-scm.com 에서 설치하세요.
    pause
    exit /b 1
  )
  echo  Git 설치 완료
  set "PATH=%PATH%;C:\Program Files\Git\cmd"
) else (
  for /f "tokens=*" %%v in ('git --version') do echo  %%v 확인됨
)
goto :GIT_CHECK_DONE

:NO_GIT_NEEDED
echo  Git 저장소가 아닙니다 - 내려받은 파일로 설치합니다.

:GIT_CHECK_DONE
echo.

echo  [1/5] 실행 중인 CareCast 종료...
:: 감시 루프(시작 bat)가 떠 있으면 node를 죽여도 7초 안에 다시 띄운다 — 그 node가
:: node_modules를 여는 순간 rmdir이 실패하고 반쯤 남는다. 그래서 루프부터 내린다.
:: 서버가 켜져 있으면 자동 업데이트가 같은 폴더에서 git·npm을 돌려 서로 물린다 —
:: 그래서 git pull보다 앞이다(2026-09-04 실측).
schtasks /end /tn "CareCast AI" > nul 2>&1
taskkill /f /fi "WINDOWTITLE eq CareCast AI" /im cmd.exe > nul 2>&1
:: 다른 폴더에 깔린 CareCast(예: EXE 설치본)는 창 없이 돌아 위 제목 검사로는 못 찾는다 — 그 재시작 창이 옛 서버를
:: 되살려 새 판 대신 옛 판이 떴다(2026-09-22). 그 설치본의 재시작 창·서버를 끄고 로그인 자동 시작을 멈춘다.
if exist "%PROJECT_DIR%\scripts\other-install-guard.cjs" "%NODE_BIN%" "%PROJECT_DIR%\scripts\other-install-guard.cjs" "%PROJECT_DIR%"
:: node는 이름이 아니라 3001 포트를 잡은 PID로 죽인다 — 다른 node 프로그램은 건드리지 않는다.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /f /pid %%p > nul 2>&1
timeout /t 2 /nobreak > nul

cd /d "%PROJECT_DIR%"
if "%IS_GIT_CLONE%"=="0" goto :SKIP_PULL
echo  [1/5] 최신 코드 받는 중... (git pull)
:: 수동 업데이트(routes/update.js)와 같은 순서 — 현장에 남은 임시 변경은 버리고 받는다.
git checkout -- . > nul 2>&1
git pull origin main 2>&1
if errorlevel 1 (
  echo  [오류] 코드 받기 실패. 인터넷 연결과 위 메시지를 확인하세요.
  pause
  exit /b 1
)
goto :PULL_DONE

:SKIP_PULL
echo  [1/5] 내려받은 파일을 그대로 씁니다. (건너뜀)

:PULL_DONE
echo.

if "%PREBUILT%"=="1" goto :SKIP_NPM
echo  [2/5] 패키지 설치 중... (5-15분 소요, 창을 닫지 마세요)
:: node_modules를 지우고 새로 깐다. 반쯤 남은 것을 고치려 들면 매번 더 오래 걸리고,
:: 수동 업데이트의 5분 제한에 걸려 또 반쯤 남는 고리에 들어간다(2026-09-04 현장).
if exist "node_modules" rmdir /s /q "node_modules"
if exist "node_modules" (
  echo  [오류] node_modules 삭제 실패. 열려 있는 탐색기·편집기를 닫고 다시 실행하세요.
  pause
  exit /b 1
)
:: --no-audit --no-fund: 설치 끝에 registry로 나가는 부가 요청을 뺀다.
:: 네트워크가 막히면 여기서 멈춘 것처럼 보인다 — 설치에 필요한 단계가 아니다.
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo  [오류] 패키지 설치 실패.
  pause
  exit /b 1
)
echo  [2/5] 패키지 설치 완료
goto :NPM_DONE

:SKIP_NPM
echo  [2/5] 필요한 꾸러미가 이미 들어 있습니다. (건너뜀)

:NPM_DONE
echo.

if "%PREBUILT%"=="1" goto :SKIP_BUILD
echo  [3/5] 프론트엔드 빌드 중... (약 10-30초 소요)
call npm run build --loglevel=error
if errorlevel 1 (
  echo  [오류] 빌드 실패.
  pause
  exit /b 1
)
echo  [3/5] 빌드 완료
goto :BUILD_DONE

:SKIP_BUILD
echo  [3/5] 화면이 이미 만들어져 있습니다. (건너뜀)

:BUILD_DONE
echo.

echo  [4/5] 바탕화면 실행 파일 생성 중...

set "DESKTOP=%USERPROFILE%\Desktop"
set "START_BAT=%DESKTOP%\CareCast 시작.bat"

(
  echo @echo off
  echo chcp 65001 ^> nul
  echo title CareCast AI
  echo set "CC_HOME=%PROJECT_DIR%"
  echo cd /d "%%CC_HOME%%"
  echo :: ASCII only on purpose. See scripts/carecast-loop.template.bat for why.
  echo :: This shell never changes; the watchdog lives in carecast-loop.bat, updated by git.
  echo if exist "%%CC_HOME%%\carecast-loop.next.bat" move /y "%%CC_HOME%%\carecast-loop.next.bat" "%%CC_HOME%%\carecast-loop.bat" ^> nul
  echo if not exist "%%CC_HOME%%\carecast-loop.bat" copy /y "%%CC_HOME%%\scripts\carecast-loop.template.bat" "%%CC_HOME%%\carecast-loop.bat" ^> nul
  echo call "%%CC_HOME%%\carecast-loop.bat"
) > "%START_BAT%"

copy /y "%PROJECT_DIR%\scripts\carecast-loop.template.bat" "%PROJECT_DIR%\carecast-loop.bat" > nul
echo  감시 루프 carecast-loop.bat 설치됨 ^(이후로는 코드를 받을 때 함께 갱신됩니다 - 자동 업데이트는 기본 꺼짐, README 참고^)
echo  바탕화면에 "CareCast 시작.bat" 생성됨
echo.

:: 작업 스케줄러용 ASCII 파일명 bat (한글 파일명은 schtasks 경로 파싱 오류)
set "SCHED_BAT=%PROJECT_DIR%\carecast-start.bat"
(
  echo @echo off
  echo chcp 65001 ^> nul
  echo title CareCast AI
  echo set "CC_HOME=%PROJECT_DIR%"
  echo cd /d "%%CC_HOME%%"
  echo :: ASCII only on purpose. See scripts/carecast-loop.template.bat for why.
  echo :: This shell never changes; the watchdog lives in carecast-loop.bat, updated by git.
  echo if exist "%%CC_HOME%%\carecast-loop.next.bat" move /y "%%CC_HOME%%\carecast-loop.next.bat" "%%CC_HOME%%\carecast-loop.bat" ^> nul
  echo if not exist "%%CC_HOME%%\carecast-loop.bat" copy /y "%%CC_HOME%%\scripts\carecast-loop.template.bat" "%%CC_HOME%%\carecast-loop.bat" ^> nul
  echo call "%%CC_HOME%%\carecast-loop.bat"
) > "%SCHED_BAT%"

echo  [4/5] 작업 스케줄러 등록 중...
schtasks /delete /tn "CareCast AI" /f > nul 2>&1
schtasks /create /tn "CareCast AI" /tr "\"%SCHED_BAT%\"" /sc onlogon /rl highest /f > nul 2>&1
if errorlevel 1 (
  echo  [경고] 작업 스케줄러 등록 실패. 수동으로 등록하세요.
) else (
  echo  [4/5] 작업 스케줄러 등록 완료 ^(로그인 시 자동 시작^)
)
echo.
echo  [5/5] 자막 받아쓰기 준비 확인 중...
:: ── 왜 여기서 하나 (사용자 지시 2026-09-15) ────────────────────────────────────
:: 음원 자막의 「자동으로 만들기」는 파이썬의 faster-whisper 로 돈다. 없으면 그 단추가
:: 실패하는데, 현장에서는 **"자막 생성이 안 돌아간다"** 로 보였다(실제로는 없어서 못 돈 것).
:: 서버 부팅 때 자동 설치하지 않는 이유: 이 패키지는 가벼운 파이썬 모듈과 달리 **무겁다**
:: (의존성 200MB+, 모델 464MB). 부팅마다 그 비용을 내면 방송이 밀린다.
:: 그래서 **설치할 때 한 번** 준비한다. 사람이 기다리고 있는 자리라 여기가 맞다.
::
:: **실패해도 설치를 멈추지 않는다.** 자막은 방송의 부가 기능이라, 이것 때문에
:: 방송 시스템 자체를 못 쓰게 만들면 안 된다 — 경고만 남기고 넘어간다.
where python > nul 2>&1
if errorlevel 1 (
  echo  [건너뜀] 파이썬이 없어 자막 받아쓰기를 준비하지 못했습니다.
  echo           음성 안내^(TTS^)도 파이썬이 필요합니다 - 설치를 권합니다:
  echo             winget install Python.Python.3.12
  goto :done
)
python -c "import faster_whisper" > nul 2>&1
if errorlevel 1 (
  echo  자막 받아쓰기 프로그램 설치 중... ^(3-10분, 창을 닫지 마세요^)
  python -m pip install faster-whisper --quiet
  if errorlevel 1 (
    echo  [경고] 자막 받아쓰기 설치 실패. 방송에는 지장이 없습니다.
    echo         나중에 CMD 에서: python -m pip install faster-whisper
    goto :done
  )
)
echo  자막 받아쓰기 프로그램 확인됨
:: 모델은 **처음 쓸 때** 내려받는다(약 460MB). 그때 받으면 사람이 자막 단추를 누르고
:: 10분을 기다리게 되므로, 여기서 미리 받아 둔다. 이미 있으면 그냥 지나간다.
echo  자막 모델 확인 중... ^(처음이면 약 460MB 내려받습니다^)
python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')" > nul 2>&1
if errorlevel 1 (
  echo  [경고] 자막 모델을 받지 못했습니다. 인터넷을 확인하세요.
  echo         자막을 처음 만들 때 다시 시도합니다 - 방송에는 지장이 없습니다.
) else (
  echo  [5/5] 자막 받아쓰기 준비 완료
)
:done
"%NODE_BIN%" "%PROJECT_DIR%\scripts\connection-guide.cjs"
echo.
echo  ==========================================
echo   설치 완료! PC 재시작 후 자동으로 실행됩니다.
echo  ==========================================
echo.
echo  [이용 조건 안내]
echo   - CareCast 는 Apache-2.0 으로 공개된 프로그램입니다 (LICENSE, NOTICE).
echo   - 안내 방송 목소리는 오픈소스 합성 음성 모델(Supertonic 3)로 만듭니다.
echo     이 모델은 Open RAIL-M 라이선스를 따르며 이용 제한이 있습니다 (LICENSES.md).
echo   - 합성 음성이라는 것을 어르신과 보호자께 알려야 합니다.
echo     처음 설정의 「이용 조건」에서 동의하고, 메뉴 - 라이선스 · 고지 에서
echo     게시문을 인쇄해 방송 스피커 근처에 붙여 주세요.
echo.
pause
