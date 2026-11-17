// 이 PC가 "현장 PC"인지 "개발·테스트 PC"인지 가르는 규칙(services/pcRole.js).
//
// 왜 필요했나(2026-08-30): 같은 코드가 현장 PC와 개발 PC 양쪽에서 도는데, 어떤 동작은
// 현장에서만 옳다. 대표적인 것이 audioDeviceWatcher다 — 이 감시는 2분마다 **Windows의
// 기본 출력장치를 설정값으로 강제로 되돌린다.** 현장 PC에서는 누가 실수로 장치를 바꿔도
// 방송이 스피커로 나가게 해 주는 안전장치지만, 개발 PC에서는 개발자가 고른 사운드 장치를
// 케어캐스트가 2분마다 뺏어가는 사고가 된다.
//
// 판정은 브랜치를 기본으로 한다(main = 현장). autoUpdate가 이미 같은 기준을 쓰고 있어
// 새 개념을 하나 더 만들지 않아도 되고, "main에 병합하면 현장 모드"가 저절로 맞는다.
// 다만 **모르는 상태로 떨어질 때의 방향이 autoUpdate와 반대**다 — 아래 테스트가 그 이유를
// 문장으로 고정한다.
'use strict'

// ── 이 시험은 **운영·개발 DB 를 열지 않는다** (2026-09-13, 사용자 지시) ────────────────
//
// 그전에는 `CARECAST_DB_PATH` 없이 `getDB()` 를 불러 **개발 PC 의 `server/db/database.db` 에
// 그대로 썼고**, `finally` 로 되돌리는 것에 기대고 있었다. 그 방식은 셋이 틀렸다:
//   ① 단언이 먼저 던지거나 러너가 죽으면 `auto_shutdown_time = '23:59'` 가 **남는다.**
//      누가 `pc_role=site` 로 바꾸는 순간 그 값이 **진짜 종료를 무장하는 재료**가 된다.
//   ② 되돌려도 **쓰기는 일어났다** — 파일 수정 시각이 바뀌고 WAL 이 자란다.
//   ③ 애초에 시험이 운영 자료를 만질 이유가 없다.
//
// 그래서 **임시 DB 경로를 먼저 정하고, 제품 모듈은 그다음에 로드한다.** 순서가 핵심이다 —
// `db/schema.js:7` 이 `DB_PATH` 를 **모듈 로드 시점에 한 번** 굳히므로, 아래 한 줄이
// 어떤 `require('../…')` 보다 먼저 와야 한다. 뒤로 가면 조용히 개발 DB 를 연다.
const path = require('node:path')
const os   = require('node:os')
const fs   = require('node:fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_pcrole_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

// 이 시험이 운영 DB 를 안 건드렸다는 것을 **나중에 실제로 확인**할 표식이다(맨 아래 시험).
const 표식키 = `pc_role_test_marker_${process.pid}_${Date.now()}`

const test   = require('node:test')
const assert = require('node:assert/strict')

// ↓ 여기서부터 제품 모듈. 위 줄 뒤여야 한다.
const { initDB, getDB } = require('../db/schema')
initDB()

const role = require('../services/pcRole')

// 자동종료 시험 셋이 읽을 값. 임시 DB 라 **되돌리지 않는다** — 되돌릴 것이 없다.
getDB().prepare("INSERT INTO settings (key, value) VALUES ('auto_shutdown_time','23:59')"
  + ' ON CONFLICT(key) DO UPDATE SET value=excluded.value').run()
getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?)'
  + ' ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(표식키, '1')

test.after(() => {
  try { getDB().close() } catch { /* 이미 닫혔으면 그만 */ }
  for (const 꼬리 of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + 꼬리) } catch { /* 안 만들어졌으면 그만 */ }
  }
})

// settings 표를 흉내내는 최소 이음새 — 이 모듈은 읽기 한 줄만 쓴다
function fakeDb(rows = {}) {
  return {
    prepare(sql) {
      return {
        get(key) {
          if (!/FROM\s+settings/i.test(sql)) throw new Error('예상 못 한 질의: ' + sql)
          return key in rows ? { value: rows[key] } : undefined
        },
      }
    },
  }
}

// .git/HEAD만 있는 임시 저장소를 만든다 — git 프로세스를 띄우지 않는 것이 이 모듈의 요점이다
function repoWithHead(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pcrole-'))
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  if (contents !== null) fs.writeFileSync(path.join(dir, '.git', 'HEAD'), contents, 'utf8')
  return dir
}

// ── 브랜치 읽기 ────────────────────────────────────────────────

test('.git/HEAD에서 브랜치 이름을 읽는다 — git 프로세스를 띄우지 않는다', () => {
  assert.equal(role.detectBranch(repoWithHead('ref: refs/heads/main\n')), 'main')
  assert.equal(role.detectBranch(repoWithHead('ref: refs/heads/dev\n')),  'dev')
  assert.equal(role.detectBranch(repoWithHead('ref: refs/heads/feature/audio-fix\n')),
    'feature/audio-fix', '슬래시가 들어간 브랜치 이름도 통째로 읽어야 한다')
})

test('HEAD를 못 읽으면 빈 문자열 — 던지지 않는다', () => {
  assert.equal(role.detectBranch(repoWithHead(null)), '')
  assert.equal(role.detectBranch(path.join(os.tmpdir(), 'cc-없는경로-' + Date.now())), '')
})

test('detached HEAD(커밋 해시)는 브랜치 이름이 아니다', () => {
  assert.equal(role.detectBranch(repoWithHead('9f77fefabc1234567890abcdef1234567890abcd\n')), '')
})

// ── 역할 판정 ──────────────────────────────────────────────────

test('main이면 현장 PC, dev면 개발 PC', () => {
  assert.equal(role.getRole(fakeDb(), { branch: 'main' }), role.SITE)
  assert.equal(role.getRole(fakeDb(), { branch: 'dev'  }), role.DEV)
})

test('브랜치를 모르면 현장 PC로 본다 — autoUpdate와 방향이 반대인 이유', () => {
  // autoUpdate는 모를 때 "비활성"으로 떨어진다(모르는데 코드를 당겨오면 위험하니까).
  // 여기는 반대다: 모르는데 개발 모드로 떨어지면 현장 PC가 조용히 안전장치를 잃는다.
  // .git이 없는 배포본에서도 방송이 계속 스피커로 나가는 쪽이 맞다.
  assert.equal(role.getRole(fakeDb(), { branch: '' }), role.SITE)
})

test('설정(pc_role)이 브랜치보다 우선한다 — 화면에서 덮어쓸 수 있다', () => {
  assert.equal(role.getRole(fakeDb({ pc_role: 'dev'  }), { branch: 'main' }), role.DEV)
  assert.equal(role.getRole(fakeDb({ pc_role: 'site' }), { branch: 'dev'  }), role.SITE)
})

test("pc_role이 'auto'거나 비어 있거나 이상하면 브랜치로 돌아간다", () => {
  for (const v of ['auto', '', '   ', '현장', 'SITE!!']) {
    assert.equal(role.getRole(fakeDb({ pc_role: v }), { branch: 'dev' }), role.DEV,
      `pc_role=${JSON.stringify(v)}는 무시하고 브랜치를 따라야 한다`)
  }
})

test('DB를 못 읽어도 던지지 않고 브랜치 판정으로 간다', () => {
  const brokenDb = { prepare() { throw new Error('DB 닫힘') } }
  assert.equal(role.getRole(brokenDb, { branch: 'main' }), role.SITE)
})

test('isSite/isDev는 getRole과 항상 일치한다', () => {
  const db = fakeDb({ pc_role: 'dev' })
  assert.equal(role.isSite(db, { branch: 'main' }), false)
  assert.equal(role.isDev(db,  { branch: 'main' }), true)
})

// ── 역할이 실제로 무엇을 바꾸는가 ──────────────────────────────
//
// 규칙 하나만 고정한다: **Windows 기본 출력장치를 강제로 되돌리는 감시는 현장 PC에서만 돈다.**
// 개발 PC에서 이게 돌면 개발자가 고른 사운드 장치를 2분마다 뺏어간다.
// (재생할 장치를 고르는 것 자체는 개발 PC에서도 그대로 된다 — 그건 MCI 장치 번호를
//  지정하는 별개 경로라 Windows 기본 장치를 안 건드린다.)

const watcher = require('../services/audioDeviceWatcher')

test('출력장치 강제 복원 감시는 개발 PC에서 뜨지 않는다', () => {
  assert.equal(watcher.startWatcher(fakeDb({ pc_role: 'dev' })), 'not-site')
  watcher.stopWatcher()
})

test('감시는 테스트 중에도 뜨지 않는다 — PowerShell을 띄우면 verify가 느려지고 장치를 만진다', () => {
  // NODE_TEST_CONTEXT가 켜져 있는 지금이 그 상황이다. 현장 PC로 위장해도 떠선 안 된다.
  assert.equal(watcher.startWatcher(fakeDb({ pc_role: 'site' })), 'no-hardware')
  watcher.stopWatcher()
})

// ── autoShutdown 이 역할 판정에 걸려 있는가 (2026-09-06) ──────────────────
//
// 왜 이 테스트가 있나: PC 자동종료가 **DB 값과 플랫폼에만** 의존하던 때가 있었다.
// 그 상태에서는 개발 PC에서 값을 한 번 넣어 보는 것만으로 진짜 종료 타이머가 걸린다 —
// 2026-09-06 검증 중에 실제로 그 사고가 날 뻔했다.
//
// 이 테스트는 **절대 실제 종료를 걸면 안 된다.** 그래서 pcRole 을 주입해 개발 PC로 고정한다.
// (주입하지 않으면 main 브랜치에서 테스트를 돌릴 때 진짜 예약이 걸린다.)
test('autoShutdown: 개발·테스트 PC에서는 시각이 있어도 예약하지 않는다', () => {
  const rolePath = require.resolve('../services/pcRole')
  const 원래 = require.cache[rolePath]
  const 진짜 = require('../services/pcRole')

  require.cache[rolePath] = {
    id: rolePath, filename: rolePath, loaded: true,
    exports: { ...진짜, getRole: () => 진짜.DEV },
  }
  delete require.cache[require.resolve('../services/autoShutdown')]

  const 찍힌줄 = []
  const 원래log = console.log
  console.log = (...a) => 찍힌줄.push(a.join(' '))
  // 시각은 **임시 DB** 에 머리말에서 미리 심어 뒀다(`23:59`). 되돌리지 않는다 — 되돌릴
  // 운영 자료가 없다. 예전에는 여기서 개발 DB 에 직접 심고 `finally` 로 지웠는데,
  // 단언이 먼저 던지면 그 값이 남아 **진짜 종료를 무장하는 재료**가 됐다.
  try {
    require('../services/autoShutdown').scheduleAutoShutdown()
  } finally {
    console.log = 원래log
    if (원래) require.cache[rolePath] = 원래; else delete require.cache[rolePath]
    delete require.cache[require.resolve('../services/autoShutdown')]
  }

  const 합친것 = 찍힌줄.join('\n')
  assert.match(합친것, /예약하지 않습니다/, `개발 PC에서 예약을 걸었다: ${합친것}`)
  assert.doesNotMatch(합친것, /PC 종료 예약됨/, '개발 PC에 종료 타이머가 걸렸다')
})

test('autoShutdown: 취소 방법이 로그에 있다 — 30초 안에 쳐야 하는 것을 문서에서 찾을 수는 없다', () => {
  const fs = require('fs')
  const src = fs.readFileSync(require.resolve('../services/autoShutdown'), 'utf8')
  // 사람에게 보여 주는 문구에 든 것만 센다 — 맨 아래 exec 의 shutdown /a 는 취소 실행이지 안내가 아니다
  const 안내 = (src.match(/취소: shutdown \/a/g) || []).length
  assert.ok(안내 >= 2, `예약 로그와 경고 양쪽에 취소 안내가 있어야 한다 (지금 ${안내}곳)`)
})

test('autoShutdown: 진행 중 검사를 일부러 안 넣었다는 근거가 남아 있다', () => {
  const fs = require('fs')
  const src = fs.readFileSync(require.resolve('../services/autoShutdown'), 'utf8')
  // 이 주석이 사라지면 누군가 "안전장치가 빠졌다"고 다시 넣는다 — 그건 사용자 결정과 반대다
  assert.match(src, /의도적으로 넣지 않았다/)
  assert.doesNotMatch(src, /restartWhenIdle\s*\(/, 'autoShutdown 이 재시작 유예 검사를 쓰기 시작했다 — 사용자 결정과 반대다')
})

// ── 3) 로컬 AI 진단 화면 (2026-09-06) ────────────────────────────────────
//
// 화면은 서버 모듈이 아니라 브라우저에서 돈다. 그래서 여기서는 **소스를 글자로 읽어**
// 규칙을 고정한다. 렌더링까지 보는 것은 MT 의 몫이다.
// (CLAUDE.md "파일을 가를 때" — 부정 단언 앞에 긍정 앵커를 먼저 세운다)

test('pcRole 머리말에 로컬 AI 진단이 등록돼 있다 — 목록이 비면 다음 사람이 판단을 새로 만든다', () => {
  const fs  = require('fs')
  const src = fs.readFileSync(require.resolve('../services/pcRole'), 'utf8')
  assert.match(src, /3\) 로컬 AI 진단 화면/,
    '역할에 새 동작을 걸었으면 이 파일 머리말에 한 줄 적는다(머리말 규칙)')
  assert.match(src, /LocalAiSetup/, '어느 화면인지 짚어야 다음 사람이 찾는다')
})

test('로컬 AI 진단: 현장 PC 에는 4GB 내려받기 버튼을 띄우지 않는다', () => {
  const fs   = require('fs')
  const path = require('path')
  const p    = path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'LocalAiSetup.jsx')
  const src  = fs.readFileSync(p, 'utf8')

  // 긍정 앵커 — 감시할 대상이 이 파일에 실제로 있다
  assert.match(src, /getPcRole/, '역할을 서버에 묻지 않는다 — 새 판단을 따로 만든 것이다')
  assert.match(src, /내려받기 \(약 4GB\)/, '내려받기 버튼이 이 파일에 없다 — 감시 대상이 사라졌다')

  // 현장이면 그 자리에서 돌려보내는 갈림길이 있어야 한다
  assert.match(src, /role === 'site'/, '현장 PC 를 가르는 분기가 없다')
  assert.match(src, /방송용 PC — 사용 안 함/, '현장 PC 에 무엇을 보여 주는지가 없다')

  // 못 읽으면 현장으로 본다 — pcRole.js 의 "모르면 현장"과 같은 방향
  assert.match(src, /catch\(\(\) => setRole\('site'\)\)/,
    "역할을 못 읽었을 때 개발 PC 로 떨어진다 — 그러면 현장 화면에 4GB 버튼이 뜬다")
})

test('로컬 AI: 1차는 "허용"과 "가능"이 **둘 다** 참일 때만 돈다', () => {
  const fs   = require('fs')
  const path = require('path')
  const src  = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'localModel.js'), 'utf8')
  assert.match(src, /export function localFirstEnabled/, '1차를 켜는 판단 자리가 없다')
  // 가능 — 이 브라우저에 모델이 있나(PC 마다 다르다)
  assert.match(src, /status === 'available'/, '진단 결과를 안 본다')
  // 허용 — 사람이 설정에서 켰나. 이것이 빠지면 승인한 적 없는데 모델이 돈다
  assert.match(src, /allowed === true/, '사람의 허용 스위치를 안 본다')
  assert.match(src, /LOCAL_TIMEOUT_MS = 8000/, '로컬 제한시간이 설계값(8초)과 다르다')
})

test('로컬 AI 허용 스위치는 기본이 꺼짐이고 서버 설정에 산다', () => {
  const fs  = require('fs')
  const src = fs.readFileSync(require.resolve('../routes/settings'), 'utf8')
  assert.match(src, /'local_ai_enabled'/, '허용 스위치를 저장하는 자리가 없다')
  // 값이 없으면 꺼짐 — 기본값을 '1'로 두면 아무도 승인 안 한 채 켜진다
  assert.match(src, /getSetting\(getDB\(\), 'local_ai_enabled', ''\) === '1'/,
    "설정이 비었을 때 켜진 것으로 읽는다")
})

// 1차 로컬은 **브라우저**에서 돌아서 routes/ai.js 의 403 가드를 안 지난다.
// 그래서 이 창구가 대신 막아야 한다 — 안 막으면 사람이 기능을 껐는데 문구가 계속 만들어지고,
// 끈 사람은 껐다고 믿고 있다. 조용히 도는 쪽이 훨씬 나쁘다.
test('로컬 1차는 "AI 방송 도우미"를 끄면 함께 멈춘다 — 서버 403 을 안 지나기 때문', () => {
  const fs  = require('fs')
  const src = fs.readFileSync(require.resolve('../routes/settings'), 'utf8')
  const at  = src.indexOf("router.get('/local-ai'")
  assert.ok(at > 0, 'local-ai 조회 라우트가 없다')
  const body = src.slice(at, at + 900)
  assert.match(body, /isFeatureEnabled\('ai'\)/,
    '기능 스위치를 안 본다 — 꺼도 브라우저 1차가 계속 돈다')
  assert.match(body, /허용 && isFeatureEnabled\('ai'\)/,
    'enabled 가 둘의 곱이 아니다 — 하나만 참이어도 돈다')
})

// ── P-74 — autoShutdown 만 pc_role 설정을 못 읽는다 ──────────────────────
//
// [FACT] EV-002710 — autoShutdown.js 가 `getRole()` 을 **인자 없이** 불렀다.
// pcRole 의 readOverride(db) 는 db 가 falsy 면 '' 를 돌려주고, getRole 은 그러면
// **브랜치 판정으로 폴백**한다 → pc_role 오버라이드가 이 기능에만 안 걸렸다.
//
// 위험: 현장 PC(main)에서 유지보수하려고 pc_role=dev 로 바꾸면 다른 안전장치는 개발
// 모드로 꺼지는데 **자동종료만 그대로 걸려 작업 중 PC 가 꺼진다.**
//
// **왜 지금까지 안 잡혔나(P-75)**: 위 테스트가 `getRole: () => 진짜.DEV` 로 모듈을 통째
// 대체한다 — 인자를 몇 개 넘기든 무조건 DEV 라 "인자를 안 넘긴다"를 구조적으로 못 본다.
// 그 파일은 19/19 pass 였다(EV-002709). **P-10 을 닫은 근거가 바로 그 테스트다.**
// 그래서 아래 셋은 스텁이 **인자를 기록**하고, 넘어온 것이 **진짜 핸들인지**까지 본다.
// truthy 만 보면 `getRole({})`·`getRole(true)` 가 결함을 복원해도 초록이다(EV-002742).
test('autoShutdown: getRole 에 넘긴 것이 진짜 db 다 — truthy 아무거나가 아니다', () => {
  const rolePath = require.resolve('../services/pcRole')
  const 원래 = require.cache[rolePath]
  const 진짜 = require('../services/pcRole')
  const 받은인자 = []
  require.cache[rolePath] = {
    id: rolePath, filename: rolePath, loaded: true,
    // 2026-09-13: 예약 판단이 `getRole` → **`roleWithSource`** 로 옮겨 갔다(출처까지 봐야
    // 해서). 지키는 사실은 그대로다 — *"진짜 db 핸들을 넘기는가"*. 가드를 따라 옮긴다.
    exports: { ...진짜,
      roleWithSource: (...args) => { 받은인자.push(args); return { role: 진짜.DEV, source: 진짜.출처.브랜치, branch: 'dev' } } },
  }
  delete require.cache[require.resolve('../services/autoShutdown')]
  const db = getDB()               // 머리말에서 임시 DB 로 고정해 둔 핸들이다
  const 원래log = console.log
  console.log = () => {}
  try {
    require('../services/autoShutdown').scheduleAutoShutdown()
  } finally {
    console.log = 원래log
    if (원래) require.cache[rolePath] = 원래; else delete require.cache[rolePath]
    delete require.cache[require.resolve('../services/autoShutdown')]
  }
  assert.equal(받은인자.length, 1)
  assert.equal(받은인자[0][0], db,
    'getRole 에 넘긴 것이 실제 db 핸들이 아니다 — {} 나 true 를 넘겨도 결함은 그대로다(EV-002742)')
})

test('autoShutdown: db 를 못 읽어도 부팅은 계속된다 — 예약만 건너뛰고 경고를 남긴다', () => {
  // 사용자 지시 2026-09-10 — 부팅 실패보다 기능 하나 꺼지는 게 낫다.
  //
  // **핸들을 한 번만 얻는 구조라 첫 호출부터 던지게 한다.** 예전엔 "두 번째부터 던져라"였는데
  // 그 스텁이 곧 `getDB()` 를 두 번 부르는 구조를 규약으로 굳히고 있었다(독립 검수 2회차 지적).
  //
  // **이 경로는 운영에서 도달하지 않는다** — 3회차 검수가 짚었다:
  //   · getDB 는 모듈에서 memoize 된다(db/schema.js:10-34)
  //   · index.js:139 의 initDB() → getDB() 가 먼저 돈다. 거기서 던졌으면 부팅이 이미 죽어
  //     :299 의 scheduleAutoShutdown 에 닿지 않는다
  //   · 같은 try 안의 rawSetting 도 안 던진다(settingsRead.js:40-49 가 null 을 낸다)
  // 그러니 이 테스트가 증명하는 것은 "실제로 밟힌다"가 아니라 **"밟히면 부팅을 안 막는다"** 다.
  // 부팅 진입점의 값싼 방어로 남긴다 — 사용자 지시 2026-09-10.
  const schemaPath = require.resolve('../db/schema')
  const 원래schema = require.cache[schemaPath]
  const 진짜schema = require('../db/schema')

  require.cache[schemaPath] = {
    id: schemaPath, filename: schemaPath, loaded: true,
    exports: { ...진짜schema, getDB: () => { throw new Error('DB 안 열림') } },
  }
  delete require.cache[require.resolve('../services/autoShutdown')]

  const 찍힌줄 = []
  const 원래log = console.log, 원래warn = console.warn
  console.log = (...a) => 찍힌줄.push(a.join(' '))
  console.warn = (...a) => 찍힌줄.push(a.join(' '))
  let 던졌나 = null
  try {
    require('../services/autoShutdown').scheduleAutoShutdown()
  } catch (e) {
    던졌나 = e
  } finally {
    console.log = 원래log; console.warn = 원래warn
    if (원래schema) require.cache[schemaPath] = 원래schema; else delete require.cache[schemaPath]
    delete require.cache[require.resolve('../services/autoShutdown')]
  }

  assert.equal(던졌나, null,
    `밖으로 던졌다 — index.js:299 가 try 없이 부르므로 부팅이 막힌다: ${던졌나 && 던졌나.message}`)
  const 합친것 = 찍힌줄.join('\n')
  assert.match(합친것, /WARN/, `조용히 건너뛰었다 — 왜 안 걸었는지 남아야 한다: ${합친것}`)
  assert.doesNotMatch(합친것, /PC 종료 예약됨/, '역할을 모르는데 종료를 걸었다')
})

test('getRole 을 인자 없이 부르는 곳이 서버에 없다 — 부류로 막는다(G2)', () => {
  // P-74 는 이 부류의 한 사례였다. 새 호출자가 같은 실수를 하면 여기서 걸린다.
  const fs = require('fs'), path = require('path')
  const 훑기 = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'test') 훑기(p, out) }
      else if (e.name.endsWith('.js')) out.push(p)
    }
    return out
  }
  const 파일 = 훑기(path.join(__dirname, '..'))
  const 호출 = []
  for (const f of 파일) {
    const src = fs.readFileSync(f, 'utf8')
    if (path.basename(f) === 'pcRole.js') continue        // 정의부는 제외
    if (/\bgetRole\s*\(\s*\)/.test(src)) 호출.push(path.relative(path.join(__dirname, '..'), f))
  }
  // 긍정 앵커 — 감시할 대상이 실재하는지 먼저 본다(CLAUDE.md "파일을 가를 때" 규칙 2)
  const 전체호출 = 파일.filter((f) => path.basename(f) !== 'pcRole.js')
    .reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(/\bgetRole\s*\(/g) || []).length, 0)
  assert.ok(전체호출 >= 3, `getRole 호출을 ${전체호출}개만 찾았다 — 훑기가 깨졌다`)
  assert.deepEqual(호출, [],
    `getRole() 을 인자 없이 부르는 곳이 있다 — readOverride(db) 가 빈 값을 내고 pc_role 이 무시된다: ${호출.join(', ')}`)
})

// ── P-77 · P-78 · P-79 — 변이가 살아남은 자리를 막는다 (2026-09-10) ─────
// 독립 검수가 변이 넷을 살려 보냈다([FACT] EV-002817·EV-002819). 전부 "구조를 주장했는데
// 그 구조를 지키는 것이 없다" 는 종류다. 아래 셋이 그 자리를 문다.

const LF = String.fromCharCode(10);
const AS_SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoShutdown.js'), 'utf8');

// scheduleAutoShutdown 본문만 떼어 낸다 — 파일 어딘가에 있는 것으로는 증명이 안 된다.
function 예약함수본문() {
  // 2026-09-13: 시그니처에 테스트 이음새가 붙었다(`opts = {}`) — 이름으로 찾는다.
  const i = AS_SRC.indexOf('function scheduleAutoShutdown(');
  assert.ok(i >= 0, 'scheduleAutoShutdown 이 사라졌다 — 이 검사의 앵커가 무너졌다');
  const j = AS_SRC.indexOf('\nfunction ', i + 10);
  return AS_SRC.slice(i, j > i ? j : AS_SRC.length);
}

test('P-77: DB 핸들을 한 번만 얻는다 — getDB() 를 다시 넣으면 빨간불이 난다', () => {
  // [FACT] EV-002817 — 변이 M7(`getRole(require('../db/schema').getDB())`)·
  // M8(`rawSetting(getDB(), …)`)이 살아남았다. getDB 가 memoize 라 두 번째 호출도
  // **같은 핸들**을 돌려주므로 동일성 단언(`:290`)이 안 문다.
  // 그래서 **글자로** 센다 — 이 함수의 주장이 "한 번만 얻는다"이기 때문이다.
  // **주석은 뺀다** — 머리말이 getDB() 를 설명하느라 언급하는 것까지 세면 늘 빨간불이다.
  const 본문 = 예약함수본문().split(LF).filter((l) => !/^[ ]*(\/\/|[*])/.test(l)).join(LF);
  const 호출 = 본문.match(/\bgetDB\s*\(/g) || [];
  assert.equal(호출.length, 1,
    `scheduleAutoShutdown 안의 getDB() 호출이 ${호출.length}개다 — 한 번만 얻어 아래로 넘기는 구조다.`
    + ' getDB 는 memoize 라 두 번째 호출도 같은 핸들을 주므로 동일성 단언으로는 안 잡힌다(EV-002817).');
  // 긍정 앵커 — 얻은 핸들을 실제로 넘겨 쓴다(부정 단언만 두면 함수가 비어도 통과한다).
  assert.ok(/rawSetting\(\s*db\s*,/.test(본문), 'rawSetting 에 db 를 안 넘긴다');
  // 2026-09-13: 부르는 이름이 `getRole` → `roleWithSource` 로 바뀌었다(출처까지 봐야 해서).
  // 지키는 사실은 그대로다 — **얻은 핸들을 역할 판정에 넘겨 쓰는가.**
  assert.ok(/roleWithSource\(\s*db\s*,/.test(본문), '역할 판정에 db 를 안 넘긴다');
  // 발동 직전 재확인도 **같은 핸들**을 쓴다 — 거기서 `getDB()` 를 다시 부르면 위 개수 검사가
  // 빨간불이 되고, 그것이 맞다(한 번만 얻어 아래로 넘기는 구조).
  assert.ok(/지금 = roleWithSource\(\s*db\s*,/.test(본문), '발동 직전 재확인이 그 핸들을 안 쓴다');
});

test('P-78: 겹침 경고가 db 를 넘겨 읽는다 — 깨지면 경고가 조용히 사라진다', () => {
  // [FACT] EV-002817 변이 M6(`getSetting(db,…)` → `getSetting(undefined,…)`)이 살아남았다.
  // [FACT] `autoShutdown.js:121-124` — 그 블록은 통째로 try/catch 안이라 db 가 깨지면
  // catch 로 조용히 빠지고 **"저녁 마무리와 종료 시각이 붙었다"는 경고가 영영 안 나온다.**
  // 현장은 저녁 마무리 18:00 / 종료 18:21 로 21분 차이다.
  const 본문 = 예약함수본문();
  assert.ok(/watchdog_grace_min/.test(본문), '겹침 경고 블록이 사라졌다 — 앵커가 무너졌다');
  const 나쁜호출 = 본문.match(/getSetting\(\s*(?!db\b)/g) || [];
  assert.deepEqual(나쁜호출, [],
    'getSetting 에 db 가 아닌 것을 넘긴다 — 그 블록은 try/catch 안이라 조용히 사라진다(EV-002817)');
});

test('P-79: 부류 가드를 넓힌다 — 인자 모양·별칭까지 본다', () => {
  // [FACT] EV-002819 — 옛 정규식 `\bgetRole\s*\(\s*\)` 는 **무인자 형태만** 잡았다.
  // `getRole(undefined)`·`getRole(null)`·`getRole({})` 와 별칭 `isSite()`/`isDev()` 는 못 물었다.
  const dir = path.join(__dirname, '..');
  const 훑기 = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return (e.name === 'node_modules' || e.name === 'test') ? [] : 훑기(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
  const 파일 = 훑기(dir);
  const 나쁨 = [];
  let 전체 = 0;
  for (const f of 파일) {
    const src = fs.readFileSync(f, 'utf8');
    전체 += (src.match(/\bgetRole\s*\(/g) || []).length;
    // 빈 인자 · undefined · null · 객체 리터럴 — 전부 readOverride 가 빈 값을 낸다
    if (/\bgetRole\s*\(\s*(\)|undefined|null|\{\s*\})/.test(src)) 나쁨.push(path.relative(dir, f) + ':getRole');
    // 별칭도 db 를 받아야 한다
    if (/\bis(Site|Dev)\s*\(\s*\)/.test(src)) 나쁨.push(path.relative(dir, f) + ':isSite/isDev');
  }
  assert.ok(전체 >= 3, `getRole 호출을 ${전체}개만 찾았다 — 훑기가 깨졌다`);
  assert.deepEqual(나쁨, [],
    `db 없이 부르는 곳이 있다 — pc_role 설정이 무시되고 브랜치만 보게 된다: ${나쁨.join(', ')}`);
});

// ── git worktree — `.git` 이 **폴더가 아니라 파일**이다 (2026-09-13) ────────────────
//
// 이 구멍이 실제로 사고를 냈다. 워크트리에서 `.git/HEAD` 를 읽으면 ENOENT 라 브랜치가
// 빈 값이 되고, "모르면 현장으로 본다" 규칙이 걸려 **개발 워크트리가 현장 PC 로 판정**됐다.
// 그래서 이 판정에 걸린 안전장치가 통째로 꺼졌고, 자동종료가 개발 PC 에 진짜 종료
// 타이머(22.8시간)를 걸어 `npm test` 가 209번째 시험에서 영영 멎었다.
//
// **폴백의 방향은 안 바꿨다** — 아래 마지막에서 두 번째 항목이 그것을 지킨다.
function worktreeAt(headContents, { 깨진포인터 = false } = {}) {
  const 진짜 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pcrole-git-'))
  const wt   = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pcrole-wt-'))
  if (headContents !== null) fs.writeFileSync(path.join(진짜, 'HEAD'), headContents, 'utf8')
  const 가리킬곳 = 깨진포인터 ? path.join(진짜, '없는하위폴더') : 진짜
  // git 이 쓰는 모양 그대로 — 경로 구분자도 git 이 쓰는 `/` 로 적는다
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ' + 가리킬곳.split(path.sep).join('/') + '\n', 'utf8')
  return wt
}

test('worktree 에서도 브랜치를 읽는다 — `.git` 이 파일이어도', () => {
  assert.equal(role.detectBranch(worktreeAt('ref: refs/heads/design-c\n')), 'design-c')
  assert.equal(role.detectBranch(worktreeAt('ref: refs/heads/main\n')), 'main',
    '워크트리가 main 이면 현장이다 — 읽을 수 있게 됐다고 판정이 뒤집히면 안 된다')
})

test('worktree 의 브랜치가 판정까지 이어진다 — 개발 워크트리는 개발 PC 다', () => {
  // 이것이 사고의 핵심이다. 브랜치를 읽는 것만으로는 부족하고 **역할까지** 와야 한다.
  assert.equal(role.roleFromBranch(role.detectBranch(worktreeAt('ref: refs/heads/design-c\n'))),
    role.DEV, '개발 워크트리가 현장으로 판정되면 자동종료·장치복원 가드가 통째로 꺼진다')
  assert.equal(role.roleFromBranch(role.detectBranch(worktreeAt('ref: refs/heads/main\n'))),
    role.SITE)
})

test('그래도 "모르면 현장" 이다 — 포인터가 깨졌거나 HEAD 가 없으면', () => {
  // 폴백의 **방향**은 안 바꿨다. 고친 것은 *알 수 있는데 못 읽던 것*이다.
  assert.equal(role.detectBranch(worktreeAt(null)), '', 'HEAD 가 없으면 빈 값')
  assert.equal(role.detectBranch(worktreeAt('ref: refs/heads/dev\n', { 깨진포인터: true })), '',
    'gitdir 이 없는 곳을 가리키면 빈 값')
  // 빈 값 → 현장. 이 줄이 뒤집히면 현장 PC 가 조용히 안전장치를 잃는다.
  assert.equal(role.roleFromBranch(''), role.SITE)
})

test('이 저장소에서 실제로 판정이 나온다 — 워크트리든 평범한 체크아웃이든', () => {
  // 인자 없이 부르면 이 파일이 사는 저장소를 본다. **빈 값이면 안 된다** —
  // 빈 값은 곧 "현장으로 본다" 이고, 그것이 이 사고의 모양이었다.
  const 브랜치 = role.detectBranch()
  assert.ok(브랜치.length > 0,
    '이 저장소의 브랜치를 못 읽었다 — 개발 PC 가 현장으로 판정되어 안전장치가 꺼진다')
})

// ── 이 시험 자신이 개발·운영 DB 를 안 건드렸는가 (2026-09-13) ──────────────────────
//
// 위 셋은 `scheduleAutoShutdown()` 을 **진짜로 부른다.** 그 함수는 settings 를 읽고,
// 예전 판에서는 그 읽기가 개발 DB 로 갔다. 아래 둘이 그 구멍을 **두 방향**에서 막는다 —
// 하나는 순서(구조)를, 하나는 결과(사실)를 본다. 순서만 보면 "썼는지"를 모르고,
// 결과만 보면 다음 사람이 순서를 뒤집었을 때 **왜** 깨졌는지 모른다.

test('임시 DB 경로를 제품 모듈보다 **먼저** 정한다 — 순서가 뒤집히면 개발 DB 를 연다', () => {
  // **주석은 지운다** — 이 머리말이 `require('../…')` 를 설명하느라 언급하고 있어서,
  // 날것으로 훑으면 그 설명이 "첫 제품 모듈" 로 잡힌다(2026-09-13 실측으로 빨간불).
  // 길이는 그대로 두고 글자만 지워서 아래 위치 비교가 원본 좌표를 유지하게 한다.
  const 날것 = fs.readFileSync(__filename, 'utf8')
  const 나 = 날것.split('\n').map((l) => (/^\s*\/\//.test(l) ? ' '.repeat(l.length) : l)).join('\n')

  const 지정 = 나.indexOf('process.env.CARECAST_DB_PATH =')
  assert.ok(지정 > 0, 'CARECAST_DB_PATH 지정이 사라졌다 — 이 시험이 운영 DB 를 연다')

  // 제품 모듈을 처음 부르는 자리. `node:` 내장과 자기 자신은 세지 않는다.
  const 첫제품 = 나.search(/require\(\s*'\.\.\//)
  assert.ok(첫제품 > 0, "require('../…') 를 못 찾았다 — 이 검사의 앵커가 무너졌다")
  assert.ok(지정 < 첫제품,
    'CARECAST_DB_PATH 지정이 제품 모듈 로드보다 뒤에 있다. db/schema.js:7 은 DB_PATH 를'
    + ' **모듈 로드 시점에 한 번** 굳히므로, 뒤로 가면 조용히 개발 DB 를 연다.')

  // `finally` 로 되돌리는 방식에 **기대지 않는다**(사용자 지시 2026-09-13).
  assert.doesNotMatch(날것, /UPDATE settings SET value=\?\s*WHERE key='auto_shutdown_time'/,
    '심은 값을 되돌리는 코드가 남아 있다 — 단언이 먼저 던지면 그 값이 그대로 남는다')
})

test('운영·개발 DB 에 이 시험의 흔적이 없다 — 읽기 전용으로 열어 확인한다', () => {
  // 임시 DB 에는 표식이 **있다**(긍정 앵커). 이게 없으면 아래 부정 단언은 아무것도 증명 못 한다.
  assert.equal(getDB().prepare('SELECT value FROM settings WHERE key = ?').get(표식키)?.value, '1',
    '임시 DB 에 표식이 없다 — 이 검사가 헛돈다')

  const 운영 = path.join(__dirname, '..', 'db', 'database.db')
  if (!fs.existsSync(운영)) return   // 새 PC·CI 에는 아직 없다. 없으면 건드릴 수도 없다.

  const { DatabaseSync } = require('node:sqlite')
  const 사본 = new DatabaseSync(운영, { readOnly: true })   // **읽기 전용** — 확인이 값을 바꾸면 안 된다
  try {
    const 표식 = 사본.prepare('SELECT value FROM settings WHERE key = ?').get(표식키)
    assert.equal(표식, undefined,
      `이 시험이 운영 DB 에 썼다 (${표식키}) — CARECAST_DB_PATH 가 안 먹었다`)
  } finally { 사본.close() }
})
