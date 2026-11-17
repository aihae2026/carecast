'use strict'
// **내려받은 폴더(.git 없음)에서도 설치된다** (2026-09-16, 제출 패키지 준비).
//
// ── 무엇을 고치다 생긴 시험인가 ────────────────────────────────────────────
// 주최측 요구는 *"누구든지 다운받아 설치가 가능한 상태"* 다. 그런데 설치 bat 은
// `[1/5] git pull origin main` 으로 시작하고 실패하면 `exit /b 1` 로 끝났다. 압축을
// 푼 폴더에는 `.git` 이 없으니 **심사위원은 첫 단계에서 막힌다.**
//
// 그래서 `IS_GIT_CLONE` 을 세우고 두 자리(git 확인 · git pull)를 건너뛰게 했다.
// **현장 PC 는 `.git` 이 있어 지금과 같은 길을 지난다** — 그게 이 변경의 전제다.
//
// ── 왜 시험이 필요한가: 배치 파일은 조용히 죽는다 ──────────────────────────
// `goto :없는라벨` 은 **빌드에도 lint 에도 안 걸린다.** cmd 가 실행 중에
// *"지정한 레이블을 찾을 수 없습니다"* 를 내고 창이 닫힌다 — 설치하는 사람 눈앞에서.
// 그래서 **라벨과 goto 의 짝**을 여기서 맞춰 본다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const BAT = path.join(__dirname, '..', '..', 'CareCast-설치.bat')
const 원문 = fs.readFileSync(BAT, 'utf8')
const 줄들 = 원문.split(/\r?\n/)

test('**`.git` 이 있는지 먼저 판정한다** — 그 값으로 두 자리가 갈린다', () => {
  assert.match(원문, /set "IS_GIT_CLONE=0"/, '기본값을 0 으로 두지 않았다')
  assert.match(원문, /if exist "%PROJECT_DIR%\\\.git" set "IS_GIT_CLONE=1"/,
    '.git 폴더로 판정하는 줄이 없다')

  // **판정이 쓰이기 전에 서야 한다.** 뒤에 서면 언제나 0 이라 현장에서도 git pull 을
  // 건너뛰게 된다 — 현장 PC 가 조용히 업데이트를 멈춘다.
  const 판정 = 줄들.findIndex(l => /if exist "%PROJECT_DIR%\\\.git" set "IS_GIT_CLONE=1"/.test(l))
  const 첫사용 = 줄들.findIndex(l => /if "%IS_GIT_CLONE%"=="0" goto/.test(l))
  assert.ok(판정 >= 0 && 첫사용 >= 0, '판정 또는 사용처를 못 찾았다')
  assert.ok(판정 < 첫사용, `판정(${판정 + 1}행)이 첫 사용(${첫사용 + 1}행)보다 뒤에 있다`)
})

test('**git pull 을 건너뛸 수 있다** — 압축을 푼 폴더에서 첫 단계에 안 막힌다', () => {
  const pull = 줄들.findIndex(l => /^git pull origin main/.test(l.trim()))
  assert.ok(pull >= 0, 'git pull 줄을 못 찾았다 — 설치 bat 모양이 바뀌었다')

  // pull 앞에 건너뛰기 분기가 있어야 한다. 없으면 `.git` 없는 폴더에서 그대로 실행된다.
  const 앞 = 줄들.slice(0, pull).join('\n')
  assert.match(앞, /if "%IS_GIT_CLONE%"=="0" goto :SKIP_PULL/,
    'git pull 앞에 건너뛰기 분기가 없다')
  assert.match(원문, /:SKIP_PULL/, '건너뛰었을 때 갈 자리가 없다')
})

test('**git 이 없어도 설치가 진행된다** — 없는 PC 에 winget 으로 git 을 깔지 않는다', () => {
  const winget = 줄들.findIndex(l => /winget install --id Git\.Git/.test(l))
  assert.ok(winget >= 0, 'git 설치 줄을 못 찾았다')
  const 앞 = 줄들.slice(0, winget).join('\n')
  assert.match(앞, /if "%IS_GIT_CLONE%"=="0" goto :NO_GIT_NEEDED/,
    'git 확인 앞에 건너뛰기 분기가 없다 — .git 도 없는데 git 을 깔려 든다')
})

test('**goto 가 가리키는 라벨이 전부 있다** — 없으면 실행 중에 창이 닫힌다', () => {
  const 라벨 = new Set(
    줄들.map(l => l.trim())
      .filter(l => /^:[A-Za-z_][A-Za-z0-9_]*$/.test(l))
      .map(l => l.slice(1).toUpperCase())
  )
  // 긍정 앵커 — 라벨이 하나도 없으면 아래 반복문이 조용히 지나간다.
  assert.ok(라벨.size >= 3, `라벨이 ${라벨.size}개뿐이다 — 훑기가 헛돌고 있다`)

  const 가는곳 = 줄들
    .map(l => l.trim().match(/\bgoto\s+:?([A-Za-z_][A-Za-z0-9_]*)/i))
    .filter(Boolean)
    .map(m => m[1].toUpperCase())
  assert.ok(가는곳.length >= 3, `goto 가 ${가는곳.length}개뿐이다 — 훑기가 헛돌고 있다`)

  for (const 이름 of 가는곳) {
    // `goto :EOF` 는 cmd 가 늘 아는 자리라 라벨이 없어도 된다.
    if (이름 === 'EOF') continue
    assert.ok(라벨.has(이름),
      `goto :${이름} 가 가리키는 라벨이 없다 — 설치 도중 "지정한 레이블을 찾을 수 없습니다"로 죽는다`)
  }
})

test('**압축에서 뺄 것이 `.gitattributes` 한 곳에 적혀 있다**', () => {
  // 포장 스크립트가 목록을 따로 들고 있으면 두 벌이 되고, 한쪽만 고쳐진다.
  const attrs = fs.readFileSync(path.join(__dirname, '..', '..', '.gitattributes'), 'utf8')
  assert.match(attrs, /server\/config\/site-baseline\.json\s+export-ignore/,
    '운영 현장 기초값이 압축에서 안 빠진다 — 남의 PC 에 환기방송 예약이 심긴다')
  assert.match(attrs, /docs\/audit\/sandbox\/\s+export-ignore/,
    '검수 임시 출력이 압축에 따라간다')
})

// ── **압축 이름은 바뀌지 않는다** (사용자 지적 2026-09-16) ────────────────────────
//
// *"내가 dev 파일을 패키지 만들고 나서도 수정하면 그게 패키지에 반영할 수 있도록 할 수 있어?"*
//
// 앞 판은 `carecast-20260916-605e7f05.zip` 처럼 **날짜와 커밋을 이름에 박았다.** 그러면
// 고칠 때마다 이름이 바뀌고 **README 에 적어 둔 링크가 죽는다.** 제출한 뒤 한 줄만 고쳐도
// 링크를 다시 고쳐야 한다는 뜻이고, 한 번 빠뜨리면 **심사위원이 옛 판을 받는다.**
//
// 이름을 고정하면 그 위험이 통째로 사라진다 — 같은 이름으로 덮어 올리면 링크가 산다.
// **대신 판본을 말해 줄 것이 필요하다**: 받은 사람이 «내가 받은 것이 어느 판인가» 를
// 알 길이 없으면, 고쳤는지 아닌지를 아무도 못 가린다. 그래서 둘은 한 세트다.
test('**압축 이름에 날짜·커밋을 박지 않는다** — 박으면 README 링크가 죽는다', () => {
  const pkg = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts/package-release.cjs'), 'utf8')
  assert.match(pkg, /path\.join\(나가는곳, 'carecast\.zip'\)/,
    '압축 이름이 고정이 아니다 — 다시 만들 때마다 링크를 고쳐야 한다')
  // 옛 모양이 되살아나지 않았는지도 본다.
  assert.ok(!/carecast-\$\{날짜\}-\$\{sha\}/.test(pkg), '이름에 날짜·커밋이 되살아났다')
})

test('**판본은 압축 안에서 말한다** — 이름이 같으니 열어 봐야 안다', () => {
  const pkg = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts/package-release.cjs'), 'utf8')
  // 만들어 넣는다. **2026-09-16 에 방식이 바뀌었다** — `--add-file` 로 붙이던 것을,
  // 런타임을 함께 담게 되면서 「한 번 펴고 다시 압축」으로 바꿨다(폴더는 `--add-file`
  // 로 못 넣는다). 그래서 이 시험도 **넣는 방법이 아니라 결과**를 본다.
  assert.match(pkg, /릴리스정보\.txt/, '판본을 적은 파일을 안 넣는다')

  // **필수 목록이 진짜 검사다** — 포장이 끝난 뒤 압축을 다시 열어 이 목록을 맞춰 보고,
  // 하나라도 없으면 압축을 지우고 실패한다. 넣는 코드가 있어도 실제로 안 들어갈 수 있다.
  const m = /const 필수 = \[([\s\S]*?)\n\]/.exec(pkg)
  assert.ok(m, '필수 목록을 못 찾았다')
  for (const 있어야 of ['릴리스정보.txt', 'runtime/node/node.exe', 'runtime/python/python.exe']) {
    assert.ok(m[1].includes(있어야),
      `「${있어야}」 가 필수 목록에 없다 — 빠져도 포장이 통과한다`)
  }
  // 커밋과 날짜가 그 안에 실제로 들어가야 한다.
  assert.match(pkg, /대응 커밋: \$\{sha\}/, '어느 커밋인지 안 적는다')
  assert.match(pkg, /함께 담긴 것: Node\.js/, '어느 실행기를 담았는지 안 적는다')
})

// 2026-09-26(Codex 통합 검수 SOLO-0916A Medium): 앞 판은 저장소에 **있던** `dist` 를 그대로 담았다.
// 옛 커밋에서 빌드한 화면이 남아 있으면 새 서버 코드 + 옛 화면이 새 커밋 번호를 달고 나가고,
// 설치 bat 은 동봉된 화면이 있으면 빌드를 건너뛴다 — API 가 바뀐 판이면 설치본 화면이 깨진다.
// 그래서 **담기 직전에 그 자리에서 빌드한다.** 미커밋이 있으면 위에서 멈추므로 빌드 = 담는 커밋이다.
// 2026-09-26 Codex 교차검수: ① 앞 판 시험은 `화면빌드()` 를 파일 전체에서 찾아 **함수 선언**에 먼저 걸렸다 — 호출을
// 지워도 통과했다(Low). 그래서 main() 본문 안의 **호출**만 본다. ② 작업 트리를 빌드하면 `--dirty` 때 미커밋 화면이
// HEAD 서버와 섞였다(Medium). 그래서 git archive 로 풀어 둔 사본(뿌리) 안에서 빌드하고, 작업 트리 dist 는 담지 않는다.
test('**화면은 담는 커밋 그 사본에서 빌드한다** — 옛 dist 도, 미커밋 화면(--dirty)도 섞이지 않는다', () => {
  const pkg = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts/package-release.cjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const 본문 = pkg.slice(pkg.indexOf('function main()'))
  assert.ok(본문.length > 100, 'main() 을 못 찾았다 — 대상 앵커')
  const 펴기자리 = 본문.indexOf('펴기(임시zip, 짐터)')
  const 빌드자리 = 본문.search(/화면빌드\(뿌리\)/)
  assert.ok(펴기자리 > 0, 'HEAD 를 풀어 두는 줄을 못 찾았다 — 대상 앵커')
  assert.ok(빌드자리 > 펴기자리, '풀어 둔 사본을 빌드하지 않는다 — 작업 트리 화면이 담긴다')
  assert.doesNotMatch(본문, /복사\(path\.join\(ROOT, 'dist'\)/, '작업 트리의 dist 를 담는다 — 옛 화면·미커밋 화면이 섞인다')
  assert.match(pkg, /function 화면빌드\(폴더\)[\s\S]*?vite[\s\S]*?build[\s\S]*?cwd: 폴더/, '빌드 함수가 그 폴더에서 vite build 를 부르지 않는다')
  // 2026-09-26 Codex 교차검수 2회차 High: 사본 안 빌드가 사본 맨 위에 node_modules/.vite/basic-ssl/_cert.pem 을 만든다
  // (vite.config 의 basicSsl 이 build 에서도 돈다 — 실측 release/_trial_0926). 그것이 금지 항목 「맨 위 node_modules」에
  // 걸려 ZIP 이 지워졌다. 압축 전에 걷는다 — git archive 사본에는 원래 맨 위 node_modules 가 없다.
  const 걷기자리 = 본문.search(/fs\.rmSync\(path\.join\(뿌리, 'node_modules'\)/)
  const 압축자리 = 본문.indexOf('압축(뿌리, 파일)')
  assert.ok(압축자리 > 0, '압축하는 줄을 못 찾았다 — 대상 앵커')
  assert.ok(걷기자리 > 빌드자리 && 걷기자리 < 압축자리, '빌드가 만든 맨 위 node_modules 를 압축 전에 안 걷는다 — ZIP 이 금지 항목으로 지워진다')
})
