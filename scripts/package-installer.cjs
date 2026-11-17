'use strict'
// Inno Setup is a build-only tool: the recipient needs neither it nor Node/Python.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const release = path.join(root, 'release')
const stage = path.join(release, '_installer')
const run = (exe, args) => execFileSync(exe, args, { cwd: root, stdio: 'inherit' })
const psQuote = value => "'" + value.replaceAll("'", "''") + "'"
// ── **받는 사람 PC 에 갈 이유가 없는 것은 뺀다** (실측 2026-09-16) ────────────────
//
// 격리 폴더에 실제로 설치해 보고 잰 값: **4,956개 파일 · 270MB · 366초**. 설치가 6분
// 걸린다. 파일 하나하나가 압축 해제 → 디스크 쓰기 → 백신 검사를 지나므로, **개수가
// 곧 시간**이다. 그런데 그중 상당수는 우리 작업 자료다:
//
//     docs/audit   424개 12MB   검수 보고서·원장·리뷰 — 우리 작업 기록이다
//     src          179개 2.8MB  소스. 설치판은 이미 빌드된 dist 를 쓴다
//     tests         51개        시험 코드
//     review         2개        검토 산출물
//
// **속도보다 먼저인 이유가 하나 더 있다**: `docs/audit` 에는 내부 검수 판정과 실패
// 기록이 들어 있다. 다른 기관에 설치판을 주면 그것이 통째로 따라간다.
//
// **빼지 않는 것**: `docs/arch`(시스템 안내도를 서버가 읽는다, routes/archViews.js) ·
// `docs/MANUAL-*.md`(관리자 화면이 읽는다, routes/status.js) · `docs/flows`.
// 지우기 전에 서버가 읽는지 전부 확인했다.
//
// **`runtime/python` 의 pip 는 안 지운다**(13MB · 파일 수백 개). numpy 가 사라지면
// `services/audioPlayer.js` 가 `pip install` 로 되살린다 — 무음이 가장 비싼 시스템에서
// 자가 복구 경로를 용량 때문에 없애는 것은 나쁜 거래다.
const 뺄것 = [
  'docs/audit', 'docs/archive', 'docs/superpowers',
  'src', 'tests', 'review', '_loops',
  // **서버 시험도 뺀다** (2026-09-16). 사용자 질문 *"설치파일로 설치했는데, 왜 내 api 가
  // 들어가 있는거야?"* 를 계기로 압축 안을 전수로 훑었더니 `server/test/` 에 **Google 키
  // 모양 문자열 3건**이 있었다. 셋 다 시험용 가짜다(하나는 같은 글자 25번 연속) — 진짜 키는
  // 설치본에 없다. 그래도 **누가 설치본을 훑으면 그대로 오해를 산다.** 사용자 PC 에서 시험을
  // 돌릴 일도 없으니 뺀다. 서버 코드가 이 폴더를 안 읽는 것을 확인했다.
  'server/test',
  'package-lock.json', 'eslint.config.js', 'baseline.json',
  // **개발·검수·제출 작업 문서도 뺀다** (2026-09-17 제출 전 점검 B-3). 설치 폴더에 `CLAUDE.md`(61KB)·
  // `TASKS.md`(사용자 원문 인용)·`.claude/`·제출 서류 초안·결정 일지가 그대로 깔리고 있었다. 다른 기관 PC 에
  // 남을 자료가 아니다. 서버가 실행 중에 읽는지 `grep -rn` 으로 전부 확인했다 — 읽는 곳 0건
  // (`db/schema.js` 의 'CLAUDE.md / TASKS.md' 는 참고자료 이름 문자열일 뿐이다).
  '.claude', 'AGENTS.md', 'CLAUDE.md', 'TASKS.md', 'HANDOFF.md', 'REPORT.md', 'TECH_DEBT.md',
  'BASELINE.md', 'ROLLBACK.md', '.verify-harness.cjs', 'carecast-개발환경-설치.bat',
  'docs/submission', 'docs/journal', 'docs/HANDOFF_2026-08-24.md', 'docs/LOOP_TASK.md',
  // **개발자 개인 정보가 든 문서** (2026-09-18). `docs/SETUP_MACBOOK.md` 에는 개발자 기관
  // 이메일과 비공개 저장소 주소가 적혀 있다(`:9,12,13`). 맥북 개발 환경을 세팅하는 글이라
  // 설치한 기관이 읽을 일이 없고, 설치 파일은 공개 릴리스로 누구나 내려받는다.
  'docs/SETUP_MACBOOK.md',
  // **개발·설계 문서와 개발용 스크립트** (2026-09-18, Sandbox 9단계 검사로 확인). 설치한 기관이
  // 읽을 것은 `MANUAL-USER`·`MANUAL-ADMIN`·`ADOPT`·`BACKUP` 넷뿐이고, 그 넷은 **서로만 가리킨다**
  // (링크 검사로 확인). 아래는 우리가 개발하며 쓰는 글이라 남의 PC 에 깔릴 이유가 없다.
  // `build-coach-packet.cjs` 는 코칭 자료를 만드는 개발용 도구라 실행에는 안 쓴다(부르는 곳은 시험뿐).
  // **빼지 않는 것**은 위 주석 그대로다 — `docs/arch`(서버가 안내도를 읽는다) · `docs/MANUAL-*` · `docs/flows`.
  'docs/DEPLOY.md', 'docs/DEVELOPER.md', 'docs/PACKAGING.md',
  'docs/ui-ux-layout.md', 'docs/ui-ux-requirements.md', 'docs/td09-audiobus.md',
  'docs/big-file-split-design.md', 'docs/db-retention-design.md', 'docs/nl-learning-design.md',
  'scripts/build-coach-packet.cjs',
]

function trimPayload(payload) {
  let 지운파일 = 0
  for (const rel of 뺄것) {
    const p = path.join(payload, rel)
    // **payload 밖을 지우지 않는다.** rel 에 `..` 이 섞이면 저장소를 지울 수도 있다.
    if (!path.resolve(p).startsWith(path.resolve(payload) + path.sep)) throw new Error(`payload 밖: ${rel}`)
    if (!fs.existsSync(p)) continue
    지운파일 += countFiles(p)
    fs.rmSync(p, { recursive: true, force: true })
  }
  console.log(`설치 payload 에서 ${지운파일}개 파일을 뺐습니다(검수 기록·소스·시험).`)
  // 화면(dist)과 서버가 남아 있는지 확인한다 — 잘못 지우면 설치는 되는데 안 뜬다.
  for (const 필수 of ['dist/index.html', 'server/index.js', 'docs/arch', 'docs/MANUAL-USER.md']) {
    if (!fs.existsSync(path.join(payload, 필수))) throw new Error(`필수인데 없어졌다: ${필수}`)
  }
}

function countFiles(p) {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return 1
  return fs.readdirSync(p).reduce((n, name) => n + countFiles(path.join(p, name)), 0)
}

function main() {
  if (process.platform !== 'win32') throw new Error('Windows에서 설치파일을 빌드하세요.')
  const compiler = process.env.ISCC_PATH || path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Inno Setup 6', 'ISCC.exe')
  if (!fs.existsSync(compiler)) throw new Error('Inno Setup 6의 ISCC.exe 위치를 ISCC_PATH에 지정하세요. https://jrsoftware.org/isdl.php')
  // 아이콘을 **먼저** 만든다. `.iss` 의 `SetupIconFile` 이 이 파일을 찾으므로, 없으면
  // 컴파일이 실패하거나(좋은 경우) 옛 파일이 그대로 쓰인다(나쁜 경우).
  // 만드는 법과 왜 다시 그리는지는 `scripts/make-icon.cjs` 머리말에 있다.
  require('./make-icon.cjs').만들기()
  // package-release refuses dirty source and excludes DB/secrets/site defaults.
  run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'])
  run(process.execPath, [path.join(__dirname, 'package-release.cjs')])
  // Check the exact absolute target before recursive cleanup on Windows.
  if (path.dirname(stage) !== release || path.basename(stage) !== '_installer') throw new Error('잘못된 임시 경로')
  fs.rmSync(stage, { recursive: true, force: true })
  fs.mkdirSync(stage, { recursive: true })
  try {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(' +
      psQuote(path.join(release, 'carecast.zip')) + ', ' + psQuote(stage) + ')'])
    trimPayload(path.join(stage, 'carecast'))
    const commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    run(compiler, ['/DPayloadDir=' + path.join(stage, 'carecast'), '/DOutputDir=' + release,
      '/DBuildVersion=' + new Date().toISOString().slice(0, 10) + '-' + commit,
      path.join(__dirname, 'installer', 'CareCast.iss')])
    const result = path.join(release, 'CareCast-Setup.exe')
    if (!fs.existsSync(result) || fs.statSync(result).size < 1000000) throw new Error('설치파일 생성 확인 실패')
    // 아이콘이 실제로 박혔는지 본다. 크기만 보면 **아이콘 없이도 통과**한다 —
    // 2026-09-16 에 아이콘 없는 EXE 가 그대로 사용자에게 갔다.
    if (!fs.existsSync(path.join(__dirname, 'installer', 'carecast.ico'))) throw new Error('아이콘 파일이 없다')
    console.log('Windows 설치파일: ' + result)
  } finally { fs.rmSync(stage, { recursive: true, force: true }) }
}
try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
