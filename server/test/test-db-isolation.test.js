// **시험은 기본 경로의 DB 를 열지 않는다** (2026-09-14, 탐색적 시험에서 발견).
//
// ── 무엇이 있었나 ────────────────────────────────────────────────────────────
// 시험 파일 일곱이 `CARECAST_DB_PATH` 를 안 정한 채 제품 모듈을 불렀다. 그 모듈이
// 어딘가에서 `getDB()` 를 부르면 그 읽기가 **기본 경로**로 간다 —
//   · 개발 PC 에서는 **개발 DB** 를 연다(그 DB 에 시험이 남긴 흔적이 섞인다).
//   · **현장 PC 에서 `npm test` 를 돌리면 운영 DB** 를 연다.
//   · 없으면 **새로 만든다** — 빈 작업 트리에서 `server/db/database.db` 가 생기는 것을
//     이분탐색으로 확인했고, 그 탓에 외부 독립 검수가 두 번 멈췄다(WT_IGNORED_CHANGED).
//
// ── 왜 파일마다 고치는 것으로 끝내지 않았나 ──────────────────────────────────
// `services/autoShutdown.js` 가 같은 자리에 이미 적어 뒀다:
//   *"그 방법은 **그 시험 파일에만** 걸린다. 새 시험이 이 경로를 건드리면 또 뚫린다."*
// 그래서 일곱을 고치고 **부류로도** 막았다 — `db/schema.js` 의 `getDB()` 가 시험 중에
// 기본 경로를 열려고 하면 던진다. 판정 근거는 DB 나 설정이 아니라 **프로세스**다
// (`domain/testMode.js`, `autoShutdown` 과 **같은 판정**을 쓴다).
//
// 이 파일은 그 빗장이 **실제로 걸리는지**를 돌려서 본다.
'use strict'

process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_dbiso_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('node:path')
const fs     = require('node:fs')

const { 테스트중 } = require('../domain/testMode')

test('긍정 앵커 — 지금 이 프로세스는 시험으로 판정된다', () => {
  assert.equal(테스트중(), true,
    '시험 판정이 안 선다 — 아래 빗장이 통째로 안 걸린다(조용한 초록이 된다)')
})

test('**시험이 기본 경로를 열려 하면 막는다** — 현장에서는 운영 DB 다', () => {
  const 원래 = process.env.CARECAST_DB_PATH
  // 새 모듈 인스턴스를 만든다 — 이미 열린 연결을 재사용하면 빗장을 안 지난다.
  delete require.cache[require.resolve('../db/schema')]
  delete process.env.CARECAST_DB_PATH
  try {
    const schema = require('../db/schema')
    assert.throws(() => schema.getDB(), /기본 경로/,
      '시험이 기본 경로의 DB 를 그냥 연다 — 현장 PC 에서 npm test 가 운영 DB 를 만진다')
    // **무엇을 하면 되는지 말한다.** 막기만 하고 길을 안 알려주면 다음 사람이 우회한다.
    try { schema.getDB() } catch (e) {
      assert.match(e.message, /CARECAST_DB_PATH/, '고치는 법을 안 알려준다')
    }
  } finally {
    process.env.CARECAST_DB_PATH = 원래
    delete require.cache[require.resolve('../db/schema')]
  }
})

// ── V③ 지적(2026-09-14): **환경변수를 나중에 정하면 빗장이 안 걸렸다** ────────────
// 첫 판은 `process.env.CARECAST_DB_PATH` 가 있으면 통과시켰다. 그런데 `DB_PATH` 는
// **모듈을 불러오는 순간 굳는다.** 그래서 시험이 `require` 를 먼저 하고 그 뒤에 환경변수를
// 정하면 — 흔한 실수다 — **환경변수는 있는데 실제로 여는 것은 기본 경로**가 된다.
// 검수관이 그 순서를 실제로 돌려 "빗장 없이 운영 DB 를 열려고 했다"를 보여 줬다.
// 지금은 **지금 열려는 경로가 기본 경로인가**로 본다 — 순서에 안 속는다.
test('**require 뒤에 환경변수를 정해도** 막힌다 — 그때가 제일 위험하다', () => {
  const 원래 = process.env.CARECAST_DB_PATH
  delete require.cache[require.resolve('../db/schema')]
  delete process.env.CARECAST_DB_PATH
  try {
    const schema = require('../db/schema')          // ← 여기서 기본 경로로 굳는다
    process.env.CARECAST_DB_PATH = ':memory:'       // ← 늦었다. 안 먹는다
    assert.throws(() => schema.getDB(), /기본 경로/,
      '환경변수를 뒤늦게 정한 시험이 **운영 DB 를 연다** — 있는 줄 알고 통과시키면 안 된다')
  } finally {
    process.env.CARECAST_DB_PATH = 원래
    delete require.cache[require.resolve('../db/schema')]
  }
})

// ── V③ R8 지적: **경로 표기를 바꾸면 빗장이 뚫렸다** ────────────────────────────
// 문자열로 비교했더니 `server/db/database.db`(상대경로)나 슬래시를 바꾼 표기가
// **같은 파일인데 글자가 달라서** 그냥 지났다. 검수관이 그 경로로 실제 기본 DB 에 닿는
// 것을 보여 줬다. 이제 절대경로로 펴고 구분자를 맞추고 윈도우는 대소문자를 안 가린다.
test('**같은 파일을 다른 표기로** 가리켜도 막힌다', () => {
  const 원래 = process.env.CARECAST_DB_PATH
  // ── 표기를 **실제 기본 경로에서** 만든다 ─────────────────────────────────────
  // 앞 판은 `'server/db/database.db'` 를 글자로 박았다. 상대경로는 **`cwd` 기준**이라
  // `npm test`(cwd = `server/`)에서는 `server/server/db/...` 가 되어 **다른 파일**을
  // 가리켰다 — 저장소 뿌리에서 돌리면 통과하고 `server/` 에서 돌리면 빨간불이었다.
  // **시험이 `cwd` 를 가정하면 안 된다.** 지금 자리에서 같은 파일을 가리키는 표기를 만든다.
  // 역슬래시는 소스에 **두 번** 적어야 JS 문자열에 하나 남는다(이 저장소의 단골 함정).
  const 기본 = path.join(__dirname, '..', 'db', 'database.db')
  const 상대 = path.relative(process.cwd(), 기본)
  const 슬래시 = 상대.split(path.sep).join('/')
  // **윈도우 확장 경로**(`\\?\C:\...`)도 같은 파일이다(V③ R10). `path.resolve` 가 그
  // 접두사를 안 걷어서, 정규화를 거기까지 안 밀면 그냥 지난다 — 검수관이 그것으로 닿았다.
  for (const 표기 of [기본, 상대, 슬래시, './' + 슬래시, path.toNamespacedPath(기본)]) {
    delete require.cache[require.resolve('../db/schema')]
    process.env.CARECAST_DB_PATH = 표기
    try {
      const schema = require('../db/schema')
      assert.throws(() => schema.getDB(), /기본 경로/,
        `「${표기}」 로 쓰면 빗장을 지나 **운영 DB 를 연다** — 같은 파일이다`)
    } finally {
      process.env.CARECAST_DB_PATH = 원래
      delete require.cache[require.resolve('../db/schema')]
    }
  }
})

test('`:memory:` 는 **파일이 아니다** — 특수 이름을 경로로 펴면 안 된다', () => {
  const 원래 = process.env.CARECAST_DB_PATH
  delete require.cache[require.resolve('../db/schema')]
  process.env.CARECAST_DB_PATH = ':memory:'
  try {
    const schema = require('../db/schema')
    assert.doesNotThrow(() => schema.getDB(), '메모리 DB 를 기본 경로로 오해해 막는다')
  } finally {
    process.env.CARECAST_DB_PATH = 원래
    delete require.cache[require.resolve('../db/schema')]
  }
})

test('제 임시 DB 를 쓰면 **그냥 열린다** — 빗장이 멀쩡한 시험을 막지 않는다', () => {
  const schema = require('../db/schema')
  assert.doesNotThrow(() => schema.initDB(), '임시 DB 경로를 줬는데도 막힌다')
  assert.ok(fs.existsSync(process.env.CARECAST_DB_PATH), '임시 DB 가 안 만들어졌다')
})

test('**판정이 한 곳에 있다** — 사본을 두면 두 안전장치가 갈린다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'autoShutdown.js'), 'utf8')
  assert.match(src, /require\('\.\.\/domain\/testMode'\)/,
    '자동종료가 제 사본으로 돌아갔다 — 한쪽만 고치면 조용히 갈린다')
  assert.doesNotMatch(src, /function 테스트중\(\)/, '자동종료에 판정 사본이 다시 생겼다')
  const 스키마 = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.js'), 'utf8')
  assert.match(스키마, /domain\/testMode/, 'DB 쪽이 같은 판정을 안 본다')
})
