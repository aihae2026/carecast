// 대시보드 방송 통계의 **칸 정의와 집계**가 한 곳에 있는가 (UX-34, 2026-09-10).
//
// ── 무엇을 막나 ────────────────────────────────────────────────────────
// 같은 질문("이 이력 줄은 어느 칸에 세나?")에 **두 라우트가 각자 답하고 있었고 답이 달랐다**:
//   · [FACT] `routes/status.js:118-123` 직독 — instant = `'즉시'` **하나만**
//   · [FACT] `routes/broadcasts.js:92`  직독 — instant = `'즉시','차임벨','즐겨찾기','AI'`
// 같은 달의 같은 이력을 두 화면이 다르게 센다. FP-0005 그대로다.
//
// 그리고 **아무도 안 쓰는 낱말을 세고 있었다** — `'즉시'`·`'즐겨찾기'`·`'AI'` 를 이력에
// 적는 자리가 코드에 **0건**이다([FACT] EV-003493). 즉시 TTS 는 `type: 'TTS'` 로 적히고
// (`routes/tts.js:132`), 마이크는 `'마이크'`(`routes/mic.js:44`), 차임은 `'차임벨'` 이다.
// 그래서 화면의 "즉시" 칸은 **구조적으로 언제나 0** 이었다.
//
// ── 기대값은 손으로 적는다 ──────────────────────────────────────────────
// 아래 칸 정의는 사용자 요구(UX-34: 즉시방송 / TTS / BGM(단독) / 자동방송 / 오류)를
// **이 파일에 손으로 옮긴 것**이다. 제품 상수를 가져오지 않는다 — 가져오면 상수를 바꾸는
// 변이가 기대값까지 데려간다(2026-09-10 교훈 3).
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '..')
const 소스 = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// ── 승인된 칸 정의 (손으로 적는다) ──────────────────────────────────────
const 기대칸 = {
  instant: ['즉시', '차임벨', '즐겨찾기', '마이크'],
  tts:     ['TTS', 'AI'],
  bgm:     ['BGM'],
  auto:    ['자동', '예약'],
}

function 임시DB() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-stats-')), 'test.db')
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, time TEXT, type TEXT, content TEXT,
    user TEXT, target TEXT, success INTEGER, fail_reason TEXT
  )`)
  return db
}

const 넣기 = (db, date, type, success = 1, fail_reason = null, content = '내용') =>
  db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success, fail_reason)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(date, '09:00', type, content, '자동', '전체', success, fail_reason)

test('종류별 집계가 정본에 있다 — 라우트가 각자 세지 않는다', () => {
  const 정본 = 소스('domain/broadcastRecord.js')
  assert.match(정본, /function 종류별집계\(/,
    '방송 종류 칸을 세는 자리가 정본에 없다 — 두 라우트가 또 각자 세게 된다(FP-0005)')
})

test('칸 정의가 승인된 그대로다 — 즉시방송·TTS·BGM·자동방송', () => {
  const { 종류칸 } = require('../domain/broadcastRecord')
  for (const [칸, 낱말들] of Object.entries(기대칸)) {
    assert.deepEqual([...(종류칸[칸] || [])].sort(), [...낱말들].sort(),
      `'${칸}' 칸이 세는 방송 종류가 승인된 목록과 다르다`)
  }
  assert.deepEqual(Object.keys(종류칸).sort(), Object.keys(기대칸).sort(),
    '칸의 개수나 이름이 승인된 것과 다르다')
})

test("'경보'·'시스템'·'특보'는 방송 종류 칸에 안 들어간다 — 소리가 아니다", () => {
  const { 종류칸 } = require('../domain/broadcastRecord')
  const 전부 = Object.values(종류칸).flat()
  for (const 낱말 of ['경보', '시스템']) {
    assert.ok(!전부.includes(낱말),
      `'${낱말}' 은 방송이 아니라 기록이다 — 통계 칸에 세면 총계가 부풀어 오른다`)
  }
})

test('실제 DB 로 세어 본다 — 칸마다 제 것만 센다', () => {
  const { 종류별집계 } = require('../domain/broadcastRecord')
  const db = 임시DB()
  넣기(db, '2026-09-01', 'TTS')          // tts
  넣기(db, '2026-09-02', 'AI')           // tts
  넣기(db, '2026-09-03', '마이크')        // instant
  넣기(db, '2026-09-04', '차임벨')        // instant
  넣기(db, '2026-09-05', 'BGM')          // bgm
  넣기(db, '2026-09-06', '자동')          // auto
  넣기(db, '2026-09-07', '예약')          // auto
  넣기(db, '2026-09-08', '경보', 0)       // 어느 칸도 아니다
  넣기(db, '2026-09-09', '시스템')        // 어느 칸도 아니다
  넣기(db, '2026-08-31', 'TTS')          // 지난달 — 안 센다

  const r = 종류별집계(db, '2026-09')
  assert.equal(r.tts, 2, 'TTS 칸')
  assert.equal(r.instant, 2, '즉시방송 칸')
  assert.equal(r.bgm, 1, 'BGM 단독 칸')
  assert.equal(r.auto, 2, '자동방송 칸')
  db.close()
})

test('실패한 줄은 종류 칸에 안 센다 — 안 나간 방송을 실적으로 세지 않는다', () => {
  const { 종류별집계 } = require('../domain/broadcastRecord')
  const db = 임시DB()
  넣기(db, '2026-09-01', 'TTS', 1)
  넣기(db, '2026-09-02', 'TTS', 0, 'error')
  assert.equal(종류별집계(db, '2026-09').tts, 1)
  db.close()
})

test('월접두를 안 주면 전체 기간을 센다 — 화면의 "전체" 보기가 같은 함수를 쓴다', () => {
  const { 종류별집계 } = require('../domain/broadcastRecord')
  const db = 임시DB()
  넣기(db, '2026-08-01', 'TTS')
  넣기(db, '2026-09-01', 'TTS')
  assert.equal(종류별집계(db, '2026-09').tts, 1, '이번 달만')
  assert.equal(종류별집계(db, null).tts, 2, '전체 기간')
  db.close()
})

test('자동방송 칸은 자동과 예약을 나눠서도 알려준다 — 합쳐 놓고 못 가르면 안 된다', () => {
  const { 종류별집계 } = require('../domain/broadcastRecord')
  const db = 임시DB()
  넣기(db, '2026-09-01', '자동')
  넣기(db, '2026-09-02', '자동')
  넣기(db, '2026-09-03', '예약')
  const r = 종류별집계(db, '2026-09')
  assert.equal(r.auto, 3)
  assert.equal(r.autoOnly, 2, '자동방송 5종만')
  assert.equal(r.scheduledOnly, 1, '일반 예약만')
  db.close()
})

// ── BGM 단독이 이력에 남는가 ────────────────────────────────────────────
// 이 검사를 만든 이유: 화면에 "BGM(단독)" 칸을 만들어 놓고 **아무도 그 줄을 안 적으면**
// 그 칸은 영원히 0 이다 — 옛 "즉시" 칸이 정확히 그랬다. 칸을 만들 때 기록도 같이 만든다.
//
// **여기는 배선만 본다.** 실제로 몇 줄이 남는지는 `bgm-history.test.js` 가 라우트를
// 진짜 불러서 확인한다 — 이 파일이 글자만 보다가 결함을 놓쳤고 독립 검수가 잡았다(2026-09-11).
test('BGM 단독 재생이 이력에 남는다 — 칸만 만들고 기록을 안 만들지 않는다', () => {
  // 2026-09-21: 사람이 트는 BGM 은 이 PC 음원 하나의 길(POST /api/audio/bgm/now)이다.
  const s = 소스('routes/audio.js')
  assert.match(s, /router\.post\('\/bgm\/now'/, '긍정 앵커 — 이 파일이 BGM 을 지금 트는 자리다')
  assert.match(s, /broadcastRecord|시작기록/,
    'BGM 단독 재생을 이력에 남기지 않는다 — 통계의 BGM 칸이 구조적으로 0 이 된다')
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'bgm-now-route.test.js')),
    '그 길의 이력을 보는 검사가 사라졌다 — 글자 대조만 남으면 또 놓친다')
})

test('두 라우트가 종류별집계를 쓴다 — 질의도 목록도 베껴 적지 않는다', () => {
  // 부정 단언을 **표현 하나가 아니라 낱말로** 본다. 예전엔 `type IN (` 만 봐서
  // `type IN(`·`type = 'TTS'` 같은 변형을 놓쳤다(2026-09-11 독립 검수 지적).
  const 낱말들 = ['즉시', '차임벨', '즐겨찾기', '마이크', '자동', '예약']
  for (const rel of ['routes/status.js', 'routes/broadcasts.js']) {
    const s = 소스(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    assert.match(s, /종류별집계\(/, `${rel} 이 종류별집계를 안 쓴다`)
    for (const w of 낱말들) {
      assert.ok(!s.includes(`'${w}'`),
        `${rel} 이 방송 종류 낱말 '${w}' 를 직접 들고 있다 — 정본과 갈린다(FP-0005)`)
    }
  }
})

// ── 화면 어휘가 정본을 따라오는가 ────────────────────────────────────────
// 독립 검수 지적(2026-09-11): 서버에 정본을 세우면서 **프런트에 사본을 늘렸다.**
// `Badge.jsx` 의 뱃지 표와 `BroadcastLog.jsx` 의 거르기 목록은 서버 `종류칸` 에서
// 파생되지 않는다. 프런트는 서버 코드를 가져올 수 없으므로(빌드가 다르다) **가져오게
// 만드는 대신, 갈리면 빨간불이 뜨게** 한다 — 이 저장소가 쓰는 방식이다.
test('화면이 아는 방송 종류가 정본을 덮는다 — 새 종류가 생기면 회색 뱃지로 떨어지지 않게', () => {
  const { 종류칸 } = require('../domain/broadcastRecord')
  const 정본낱말 = [...new Set(Object.values(종류칸).flat())]
  const badge = fs.readFileSync(
    path.join(ROOT, '..', 'src', 'components', 'shared', 'Badge.jsx'), 'utf8')
  const log = fs.readFileSync(
    path.join(ROOT, '..', 'src', 'components', 'admin', 'sections', 'BroadcastLog.jsx'), 'utf8')

  assert.match(badge, /TypeBadge/, '긍정 앵커 — 이 파일이 방송 종류 뱃지를 그린다')
  assert.match(log, /const types = \[/, '긍정 앵커 — 이 파일이 종류 거르기 목록을 든다')

  // ── 뱃지는 **낱말**을 안다 ─────────────────────────────────────────────
  // 이력 한 줄의 `type` 은 원시 낱말('차임벨'·'AI' …)이라, 그리는 쪽이 그 낱말을 모르면
  // 통계는 세는데 화면에서는 회색 "기타"로 보인다.
  for (const w of 정본낱말) {
    assert.ok(badge.includes(`'${w}'`),
      `Badge.jsx 에 '${w}' 가 없다 — 통계는 세는데 이력 화면에서는 회색 "기타"로 보인다`)
  }

  // ── 거르기는 **묶음**을 안다 (2026-09-13 정정) ──────────────────────────
  // 여기 있던 검사는 거르기 목록에도 **원시 낱말**이 있기를 요구했다. 그런데 커밋
  // `33d3a26`("방송 로그 필터를 통계와 같은 축으로")의 요점이 정확히 그 반대다 —
  // 낱말 여섯을 늘어놓던 것을 **통계와 같은 묶음 넷**으로 줄였고, 서버 `buildFilter` 가
  // 묶음 이름을 받아 `종류칸` 으로 펴 준다. 낱말을 요구하는 검사는 **고쳐진 것을
  // 되돌리라고 말하는 검사**가 되어 그 커밋 뒤로 빨간불이었다.
  //
  // 그래서 지키는 것을 바꾼다: *"거르기 축이 통계 축과 같은가"*.
  // 묶음이 늘거나 이름이 바뀌면 여기서 빨간불이 뜬다 — 원래 이 시험이 막으려던 것이다.
  for (const 묶음 of Object.keys(종류칸)) {
    assert.ok(log.includes(`id: '${묶음}'`),
      `BroadcastLog.jsx 거르기에 묶음 '${묶음}' 이 없다 — 통계에는 있는데 걸러 볼 수가 없다`)
  }
  // 낱말을 **다시 늘어놓지 않는다** — 그러면 축이 둘이 되어 같은 이력이 두 갈래로 보인다.
  for (const w of 정본낱말) {
    assert.ok(!log.includes(`id: '${w}'`),
      `BroadcastLog.jsx 거르기에 낱말 '${w}' 가 되살아났다 — 통계와 축이 갈린다`)
  }
})
