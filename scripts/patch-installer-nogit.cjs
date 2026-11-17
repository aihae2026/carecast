'use strict'
// **설치 bat 이 내려받은 폴더에서도 돌게 한다** (2026-09-16, 제출 패키지 준비).
//
// 왜: 지금 설치 bat 은 [1/5] 에서 `git pull origin main` 을 하고 실패하면 종료한다.
// 압축을 푼 폴더에는 `.git` 이 없으므로 **심사위원은 첫 단계에서 막힌다.**
// 이 파일은 그 자리 두 곳만 고친다 — git 확인, git pull.
//
// **현장 동작은 안 바뀐다.** 현장 PC 에는 `.git` 이 있어서 `IS_GIT_CLONE=1` 이 되고
// 지금과 글자 그대로 같은 길을 지난다.
//
// 이 저장소는 셸을 거친 치환으로 세 번 조용히 실패한 적이 있다(CLAUDE.md). 그래서
// 스크립트 파일로 두고, 바꾼 뒤 결과를 다시 읽어 확인한다. **CRLF 를 유지한다.**
const fs = require('node:fs')
const path = require('node:path')

const BAT = path.join(__dirname, '..', 'CareCast-설치.bat')
let src = fs.readFileSync(BAT, 'utf8')
const 처음 = src

const CRLF = '\r\n'
const 줄 = (...xs) => xs.join(CRLF)

// ── 1) git 확인을 조건부로 ────────────────────────────────────────────────
// `.git` 이 없으면 git 자체가 필요 없다. 없는 PC 에 winget 으로 git 을 깔지 않는다.
const 옛git확인 = 'git --version > nul 2>&1'
if (!src.includes(옛git확인)) throw new Error('git 확인 줄을 못 찾았다 — 설치 bat 모양이 바뀌었다')

const 새git머리 = 줄(
  ':: 내려받은 폴더(.git 없음)에서도 설치되게 한다(2026-09-16).',
  ':: 현장 PC 는 .git 이 있어 IS_GIT_CLONE=1 이 되고 아래 길이 그대로 유지된다.',
  'set "IS_GIT_CLONE=0"',
  'if exist "%PROJECT_DIR%\\.git" set "IS_GIT_CLONE=1"',
  '',
  'if "%IS_GIT_CLONE%"=="0" goto :NO_GIT_NEEDED',
  옛git확인,
)
src = src.replace(옛git확인, 새git머리)

// git 확인 블록이 끝나는 자리(`)` 다음의 빈 줄) 뒤에 라벨을 세운다.
// 블록의 끝은 `  for /f "tokens=*" %%v in ('git --version') do echo  %%v 확인됨` 다음 `)` 다.
const 옛git끝 = 줄(
  `  for /f "tokens=*" %%v in ('git --version') do echo  %%v 확인됨`,
  ')',
)
if (!src.includes(옛git끝)) throw new Error('git 확인 블록의 끝을 못 찾았다')
src = src.replace(옛git끝, 줄(
  옛git끝,
  'goto :GIT_CHECK_DONE',
  '',
  ':NO_GIT_NEEDED',
  'echo  Git 저장소가 아닙니다 - 내려받은 파일로 설치합니다.',
  '',
  ':GIT_CHECK_DONE',
))

// ── 2) [1/5] git pull 을 건너뛴다 ─────────────────────────────────────────
const 옛pull = 줄(
  'echo  [1/5] 최신 코드 받는 중... (git pull)',
  'cd /d "%PROJECT_DIR%"',
  ':: 수동 업데이트(routes/update.js)와 같은 순서 — 현장에 남은 임시 변경은 버리고 받는다.',
  'git checkout -- . > nul 2>&1',
  'git pull origin main 2>&1',
  'if errorlevel 1 (',
  '  echo  [오류] 코드 받기 실패. 인터넷 연결과 위 메시지를 확인하세요.',
  '  pause',
  '  exit /b 1',
  ')',
)
if (!src.includes(옛pull)) throw new Error('[1/5] git pull 블록을 못 찾았다')

const 새pull = 줄(
  'cd /d "%PROJECT_DIR%"',
  'if "%IS_GIT_CLONE%"=="0" goto :SKIP_PULL',
  'echo  [1/5] 최신 코드 받는 중... (git pull)',
  ':: 수동 업데이트(routes/update.js)와 같은 순서 — 현장에 남은 임시 변경은 버리고 받는다.',
  'git checkout -- . > nul 2>&1',
  'git pull origin main 2>&1',
  'if errorlevel 1 (',
  '  echo  [오류] 코드 받기 실패. 인터넷 연결과 위 메시지를 확인하세요.',
  '  pause',
  '  exit /b 1',
  ')',
  'goto :PULL_DONE',
  '',
  ':SKIP_PULL',
  'echo  [1/5] 내려받은 파일을 그대로 씁니다. (건너뜀)',
  '',
  ':PULL_DONE',
)
src = src.replace(옛pull, 새pull)

if (src === 처음) throw new Error('아무것도 안 바뀌었다')
fs.writeFileSync(BAT, src)

// **바꾼 뒤 다시 읽어 확인한다** — "몇 건 바꿨다"는 보고를 믿지 않는다(CLAUDE.md).
const 결과 = fs.readFileSync(BAT, 'utf8')
const 확인 = [
  ['IS_GIT_CLONE 판정', 'if exist "%PROJECT_DIR%\\.git" set "IS_GIT_CLONE=1"'],
  ['git 확인 건너뛰기', 'if "%IS_GIT_CLONE%"=="0" goto :NO_GIT_NEEDED'],
  ['git 없을 때 라벨', ':NO_GIT_NEEDED'],
  ['pull 건너뛰기', 'if "%IS_GIT_CLONE%"=="0" goto :SKIP_PULL'],
  ['pull 건너뛴 뒤 라벨', ':PULL_DONE'],
]
let 탈 = false
for (const [이름, 조각] of 확인) {
  const 있나 = 결과.includes(조각)
  if (!있나) 탈 = true
  console.log(`${있나 ? 'OK  ' : 'FAIL'} ${이름}`)
}
// 줄바꿈이 LF 로 바뀌면 cmd 가 배치를 잘못 읽는다 — 반드시 확인한다.
const lf단독 = (결과.match(/(^|[^\r])\n/g) || []).length
console.log(`${lf단독 === 0 ? 'OK  ' : 'FAIL'} CRLF 유지 (단독 LF ${lf단독}개)`)
if (탈 || lf단독 !== 0) process.exit(1)
console.log('\n설치 bat 수정 완료.')
