// ISSUE-006 — 누락 감시가 예약 방송도 본다 + 서버가 꺼져 있던 시간은 빼고 본다
//
// 무엇이 문제였나: 감시(watchdog.js)가 자동방송 5종(AUTO_BROADCASTS)만 순회했다. 현장의 환기
// 방송처럼 `schedules` 표에 든 예약은 **아무도 안 봤다** — 같은 조건에서 자동방송은 경보가 나고
// 예약은 조용했다([FACT] EV-000475).
//
// 왜 server_boot 이 먼저인가: "예정 시각이 지났는데 안 나갔다"만으로 알리면 **PC 가 꺼져 있던
// 시간의 예약이 전부 누락**이 된다. 이 개발 PC 의 환기방송 09:10·09:20 이 정확히 그 경우다 —
// 이력이 한 건도 없고([FACT] EV-001004), 09시대 기록은 기동 직후 경보뿐이며 그 시각이
// 09:12·09:28·09:30·09:33 이다([FACT] EV-001005). 감시가 매일 오경보를 내면 사람이 안 본다.
//
// 이 파일은 실제 DB(임시 파일)와 실제 server_boot 행으로 돈다. 스텁은 SSE 하나뿐이다 —
// 판정의 핵심인 가동 구간 계산을 흉내로 대신하면 이 테스트가 지키려는 것을 못 지킨다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_schedwatch_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// SSE 는 스텁 — 화면이 없어도 감시는 돌아야 한다
const SSE_PATH = require.resolve('../services/sse')
require.cache[SSE_PATH] = {
  id: SSE_PATH, filename: SSE_PATH, loaded: true,
  exports: { broadcastSSE: () => 1, addClient: () => {}, clientCount: () => 0, localClientCount: () => 0, localAliveCount: () => 0 },
}

const { initDB, getDB } = require('../db/schema')
const { checkMissedSchedules } = require('../services/watchdog')
const boot = require('../services/serverBoot')

test.before(() => { initDB() })
test.after(() => {
  delete require.cache[SSE_PATH]
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────────
const 오늘 = new Date()
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const 오늘문자 = ymd(오늘)
const at = (hh, mm) => { const d = new Date(오늘); d.setHours(hh, mm, 0, 0); return d }

let seq = 0
function 예약만들기({ time = '09:10', weekdays = [0, 1, 2, 3, 4, 5, 6], active = 1, lastFired = null, startDate = 오늘문자, endDate = null, type = 'text', flowId = null } = {}) {
  const title = `감시시험${++seq}`
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_end_date, repeat_weekdays, broadcast_type, flow_sequence_id, last_fired)
    VALUES (?, '내용', '전체', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, time, active, startDate, endDate, JSON.stringify(weekdays), type, flowId, lastFired).lastInsertRowid
  return { id: Number(id), title }
}

// 가동 구간 한 줄. stopped 를 안 주면 비정상 종료(stopped_at NULL) 를 흉내낸다.
function 가동구간(fromDate, seenDate, stoppedDate = null) {
  getDB().prepare('INSERT INTO server_boot (started_at, last_seen_at, stopped_at) VALUES (?, ?, ?)')
    .run(boot.nowISO(fromDate), boot.nowISO(seenDate), stoppedDate ? boot.nowISO(stoppedDate) : null)
}
const 가동기록비우기 = () => getDB().prepare('DELETE FROM server_boot').run()
const 경보비우기 = () => getDB().prepare("DELETE FROM broadcasts WHERE type = '경보'").run()
const 경보들 = () => getDB().prepare("SELECT content FROM broadcasts WHERE type = '경보' ORDER BY id DESC").all().map((r) => r.content)

// 테스트끼리 새지 않게 매번 비운다. 앞 테스트가 만든 예약이 남으면 뒤 테스트의 개수 단언이
// 조용히 틀린 이유로 통과하거나 실패한다 — 실제로 한 번 그렇게 실패했다(EV-001030).
function 초기화() {
  가동기록비우기()
  경보비우기()
  getDB().prepare('DELETE FROM schedules').run()
  getDB().prepare("DELETE FROM settings WHERE key LIKE 'watchdog_alerted_schedule_%'").run()
}

// ── 1. 가동 구간 판정 (server_boot) ───────────────────────────────────────

test('ISSUE-006: 가동 기록이 없으면 "모른다"(null) — 없는 것을 안 떠 있었다고 읽지 않는다', () => {
  가동기록비우기()
  assert.equal(boot.wasUpAt(getDB(), at(9, 10).getTime()), null,
    '기록이 없을 때 false 를 주면, 감시가 "서버가 꺼져 있었다"로 오해해 진짜 누락을 놓친다')
})

test('ISSUE-006: 구간 안이면 true, 밖이면 false', () => {
  가동기록비우기()
  가동구간(at(8, 0), at(23, 0), at(23, 0))
  const db = getDB()
  assert.equal(boot.wasUpAt(db, at(9, 10).getTime()), true, '구간 안인데 false')
  assert.equal(boot.wasUpAt(db, at(7, 0).getTime()), false, '기동 전인데 true')
  assert.equal(boot.wasUpAt(db, at(23, 30).getTime()), false, '종료 후인데 true')
})

test('ISSUE-006: 비정상 종료 구간은 마지막 생존 표식까지만이다 — 꺼져 있던 밤이 가동으로 잡히면 안 된다', () => {
  가동기록비우기()
  const 어제 = new Date(오늘); 어제.setDate(어제.getDate() - 1)
  const 어제밤 = new Date(어제); 어제밤.setHours(22, 0, 0, 0)
  const 어제저녁 = new Date(어제); 어제저녁.setHours(20, 0, 0, 0)
  가동구간(어제저녁, 어제밤)              // stopped_at 없음 = PC 를 그냥 껐다
  가동구간(at(9, 34), at(12, 0))          // 오늘 아침에 다시 켰다

  const db = getDB()
  assert.equal(boot.wasUpAt(db, at(9, 10).getTime()), false,
    '어제 구간의 끝을 "다음 기동"으로 잡으면 밤새 꺼져 있던 시간이 가동으로 잡힌다 — 그러면 09:10 예약이 매일 오경보다')
  assert.equal(boot.wasUpAt(db, at(10, 0).getTime()), true, '오늘 구간 안인데 false')
})

// ── 2. 예약 감시 ──────────────────────────────────────────────────────────

test('ISSUE-006: 예정 시각이 지났고 안 나갔으면 경보를 낸다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  const s = 예약만들기({ time: '09:10' })
  const found = checkMissedSchedules(getDB(), { now: at(9, 30) })
  assert.equal(found.length, 1, `경보가 안 났다: ${JSON.stringify(found)}`)
  assert.equal(found[0].id, s.id)
  assert.ok(경보들().some((c) => c.includes(s.title)), `이력에 경보가 안 남았다: ${JSON.stringify(경보들())}`)
})

test('ISSUE-006: 유예(5분) 안이면 아직 알리지 않는다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  예약만들기({ time: '09:10' })
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 14) }).length, 0, '유예 안인데 벌써 알렸다')
})

test('ISSUE-006: 서버가 그 시각에 안 떠 있었으면 알리지 않는다 — 환기방송 09:10 의 실제 사례', () => {
  초기화()
  가동구간(at(9, 34), at(12, 0))          // 09:34 에 켰다 — 09:10 은 지나간 뒤다
  예약만들기({ time: '09:10' })
  assert.equal(checkMissedSchedules(getDB(), { now: at(10, 0) }).length, 0,
    'PC 가 꺼져 있던 시간의 예약을 누락으로 알리면 개발 PC 는 매일 오경보 2건을 낸다')
})

test('ISSUE-006: 가동 기록이 아예 없으면 알리지 않는다 — 모르는 것으로 경보를 내지 않는다', () => {
  초기화()
  예약만들기({ time: '09:10' })
  assert.equal(checkMissedSchedules(getDB(), { now: at(10, 0) }).length, 0)
})

test('ISSUE-006: 이미 나갔으면(last_fired 가 오늘) 알리지 않는다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  예약만들기({ time: '09:10', lastFired: 오늘문자 })
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 0)
})

test('ISSUE-006: 사람이 수동으로 튼 예약은 알리지 않는다 — last_fired 는 안 찍히지만 이력에는 남는다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  const s = 예약만들기({ time: '09:10' })          // last_fired 는 NULL 그대로(수동 실행의 특징)
  getDB().prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success, run_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(오늘문자, '09:12', '예약', s.title, '자동', '전체', 1, `예약${s.id}-7`)
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 0,
    '사람이 튼 방송을 누락으로 알리면 잔소리가 된다')
})

test('ISSUE-006: 미뤄진 예약은 알리지 않는다 — "안 나갔다"가 아니라 "아직 안 나갔다"', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  const s = 예약만들기({ time: '09:10' })

  // 스케줄러가 자동방송과 겹쳐 미뤄 둔 상태를 그대로 만든다(키 형식은 scheduler.js:591).
  const { deferred } = require('../services/scheduler')._defer
  const key = `${s.id}|${오늘문자}|09:10`
  deferred.set(key, { schedule: s, since: Date.now() })
  try {
    assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 0,
      '미룸 상한은 10분인데 감시 유예는 5분이라, 이 검사가 없으면 아직 나갈 방송에 누락 경보가 난다')
  } finally {
    deferred.delete(key)
  }

  // 미룸이 풀리면 다시 감시 대상이다
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 1, '미룸이 풀렸는데도 안 잡는다')
})

test('ISSUE-006: 오늘 요일이 아니면 알리지 않는다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  const 다른요일 = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== 오늘.getDay())
  예약만들기({ time: '09:10', weekdays: 다른요일 })
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 0)
})

test('ISSUE-006: 종료일이 지난 예약은 알리지 않는다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  const 어제 = new Date(오늘); 어제.setDate(어제.getDate() - 1)
  예약만들기({ time: '09:10', startDate: '2026-01-01', endDate: ymd(어제) })
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 0)
})

test('ISSUE-006: 꺼진 예약(active=0)은 감시 대상이 아니다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  예약만들기({ time: '09:10', active: 0 })
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 0)
})

test('ISSUE-006: 1회성 누락은 배너에 뜨는 종류로, 반복 누락은 기존 종류로 낸다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  const 일회성 = 예약만들기({ time: '09:10', weekdays: [] })        // repeat_weekdays 빈 배열 = 1회성
  const 반복   = 예약만들기({ time: '09:20' })

  const found = checkMissedSchedules(getDB(), { now: at(9, 40) })
  assert.equal(found.length, 2, `둘 다 잡혀야 한다: ${JSON.stringify(found)}`)
  assert.equal(found.find((f) => f.id === 일회성.id).once, true)
  assert.equal(found.find((f) => f.id === 반복.id).once, false)

  const 목록 = 경보들()
  // alert.js 가 이력 내용을 `[종류] 문구` 로 적는다. 1회성은 화면에서 가려지면 안 되는 종류다.
  assert.ok(목록.some((c) => c.startsWith('[예약누락]') && c.includes(일회성.title)),
    `1회성이 '예약누락' 으로 안 났다: ${JSON.stringify(목록)}`)
  assert.ok(목록.some((c) => c.startsWith('[방송누락]') && c.includes(반복.title)),
    `반복이 '방송누락' 으로 안 났다: ${JSON.stringify(목록)}`)
})

test('ISSUE-006: 같은 예약을 하루에 두 번 알리지 않는다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  예약만들기({ time: '09:10' })
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 30) }).length, 1, '첫 번째는 알려야 한다')
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 31) }).length, 0, '매분 반복하면 이력이 경보로 뒤덮인다')
})

// ── 3. 배선 (소스 대조) ───────────────────────────────────────────────────
//
// 위 테스트들은 checkMissedSchedules 를 **직접** 부른다. 그래서 매분 도는 자리에 배선이
// 빠져도 전부 초록이다 — 감시가 조용히 안 도는 것이 이 이슈의 원래 증상이라, 그 상태를
// 다시 만들지 않으려면 배선 자체를 봐야 한다. 부정이 아니라 긍정 단언이라 대상이 사라지면 빨간불이다.

const 소스 = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

test('ISSUE-006 배선: startWatchdog 이 예약 감시를 매분 함께 부른다', () => {
  const src = 소스('services/watchdog.js')
  const i = src.indexOf('function startWatchdog')
  assert.ok(i >= 0, '전제: startWatchdog 이 있어야 한다')
  const 본문 = src.slice(i, i + 600)
  assert.match(본문, /checkMissed\(db\)/, 'startWatchdog 이 자동방송 감시를 안 부른다')
  assert.match(본문, /checkMissedSchedules\(db\)/,
    'startWatchdog 이 예약 감시를 안 부른다 — 여기가 빠지면 ISSUE-006 이 그대로 돌아온다')
})

test('ISSUE-006 배선: 기동 때 가동 기록을 남기고, tick 이 생존 표식을 갱신한다', () => {
  const idx = 소스('index.js')
  assert.match(idx, /serverBoot/, 'index.js 가 serverBoot 을 안 부른다 — 가동 구간 기록이 통째로 없어진다')
  assert.match(idx, /recordBoot\(/, 'index.js 가 recordBoot 을 안 부른다')
  assert.match(idx, /recordStop\(/, 'index.js 가 정상 종료를 기록하지 않는다')

  const sch = 소스('services/scheduler.js')
  assert.match(sch, /require\('\.\/serverBoot'\)\.heartbeat\(/,
    "스케줄러 tick 이 생존 표식을 안 갱신한다 — 비정상 종료 구간의 끝을 잃어 '꺼져 있던 밤'이 가동으로 잡힌다")
})

test('ISSUE-006: 1회성 누락 문구는 "오늘이 지나면 다시 안 나간다"를 말한다', () => {
  초기화()
  가동구간(at(8, 0), at(23, 0))
  const s = 예약만들기({ time: '09:10', weekdays: [] })
  checkMissedSchedules(getDB(), { now: at(9, 30) })
  const 줄 = 경보들().find((c) => c.includes(s.title))
  assert.ok(줄, '경보가 없다')
  assert.match(줄, /다시 나가지 않습니다/, `1회성인데 복구 불가라는 사실을 안 말한다: ${줄}`)
})

// ── 흐름(flow) 예약도 감시 대상인가 (P-93, 2026-09-10) ────────────────────
//
// P-5 의 나머지 절반이었다. 예약(`schedules`)을 본다는 것은 확인돼 있었는데
// ([FACT] EV-003037), **그 안에 흐름이 포함되는지는 아무도 확인 안 했다.**
// `checkMissedSchedules` 는 `SELECT * FROM schedules WHERE active = 1` 로 유형을 안 가리므로
// 코드상으로는 포함된다 — 그러나 "코드를 읽으니 그렇다"는 [INFER] 다. 실제로 돌려 본다.
//
// 흐름은 이 저장소에서 **가장 긴 방송**이고(여러 단계), 안 나가면 그날 일과가 통째로
// 빈다. 여기가 비어 있으면 감시가 있다는 사실 자체가 사람을 안심시키는 거짓이 된다.

test('P-93: 흐름 예약이 안 나가면 감시가 알린다 — 유형을 안 가린다', () => {
  초기화()
  가동구간(at(0, 0), at(23, 59))     // 그 시각에 서버는 떠 있었다
  const { title } = 예약만들기({ time: '09:10', type: 'flow', flowId: 7 })

  const found = checkMissedSchedules(getDB(), { now: at(9, 20) })

  assert.equal(found.length, 1,
    `흐름 예약이 감시에서 빠졌다: ${JSON.stringify(found)} — 가장 긴 방송이 감시 밖이면 감시가 있다는 사실이 거짓 안심이 된다`)
  assert.equal(found[0].title, title)
  assert.ok(경보들().some((c) => c.includes(title)), '경보 문구에 그 예약이 안 나온다')
})

test('P-93: 나간 흐름 예약은 안 알린다 — 잔소리로 바꾸지 않는다', () => {
  초기화()
  가동구간(at(0, 0), at(23, 59))
  예약만들기({ time: '09:10', type: 'flow', flowId: 7, lastFired: 오늘문자 })

  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 20) }).length, 0,
    '정상 발사된 흐름을 누락으로 알린다')
})

test('P-93: 흐름과 일반 예약이 같은 잣대를 쓴다 — 한쪽만 유예가 다르면 안 된다', () => {
  초기화()
  가동구간(at(0, 0), at(23, 59))
  예약만들기({ time: '09:10', type: 'flow', flowId: 7 })
  예약만들기({ time: '09:10', type: 'text' })

  // 유예(기본 5분) 안 — 둘 다 아직 아니다
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 12) }).length, 0, '유예 안인데 알렸다')
  // 유예 밖 — 둘 다 걸린다
  assert.equal(checkMissedSchedules(getDB(), { now: at(9, 20) }).length, 2,
    '흐름과 일반 예약의 잣대가 다르다')
})

// ── 재시작 창에 걸린 진짜 누락 (P-25, 2026-09-10) ─────────────────────────
//
// 가동 구간은 `[started_at, last_seen_at]` 이고 생존 표식이 **분 단위**다. 그래서 **예정된
// 그 분에 서버가 재시작하면** 그 시각이 두 구간 사이 틈에 떨어지고, `wasUpAt` 이 `false` 를
// 낸다 — 감시는 "PC 가 꺼져 있었다"로 보고 **조용히 넘어간다.**
//
// 그런데 그 방송은 **진짜로 안 나갔다.** 재시작은 예약이 못 나가는 흔한 원인이고,
// main 브랜치는 10분마다 자동 업데이트를 돈다 — 하필 그 분에 걸릴 수 있다.
//
// 그래서 "꺼져 있던 밤"과 "잠깐 껐다 켠 틈"을 갈랐다. **밤은 그대로 조용하다** —
// 그 조용함이 사라지면 개발 PC 가 매일 오경보를 내던 자리로 되돌아간다.

test('P-25: 예정된 그 분에 재시작했으면 알린다 — 진짜 누락이 조용히 제외됐다', () => {
  초기화()
  가동구간(at(8, 0), at(9, 9))     // 09:09 까지 살아 있었다
  가동구간(at(9, 11), at(12, 0))   // 09:11 에 다시 떴다 — 09:10 이 틈에 빠진다
  const s = 예약만들기({ time: '09:10' })

  const found = checkMissedSchedules(getDB(), { now: at(9, 30) })
  assert.equal(found.length, 1,
    '재시작 틈의 예약이 감시에서 빠졌다 — 예약이 못 나가는 흔한 원인 하나가 통째로 안 잡힌다')
  assert.equal(found[0].id, s.id)
})

test('P-25: 밤새 꺼져 있던 시간은 그대로 조용하다 — 오경보로 바뀌지 않았다', () => {
  초기화()
  const 어제 = new Date(오늘); 어제.setDate(어제.getDate() - 1)
  const 어제밤 = new Date(어제); 어제밤.setHours(22, 0, 0, 0)
  const 어제저녁 = new Date(어제); 어제저녁.setHours(20, 0, 0, 0)
  가동구간(어제저녁, 어제밤)          // 어젯밤에 껐다
  가동구간(at(9, 34), at(12, 0))     // 오늘 09:34 에 켰다
  예약만들기({ time: '09:10' })

  assert.equal(checkMissedSchedules(getDB(), { now: at(10, 0) }).length, 0,
    '꺼져 있던 밤을 재시작 틈으로 읽었다 — 개발 PC 가 매일 오경보 2건을 낸다')
})

test('P-25: 틈 판정은 상한(10분)을 넘으면 안 잡는다 — 경계를 손으로 확인한다', () => {
  const db = getDB()
  가동기록비우기()
  가동구간(at(8, 0), at(9, 0))
  가동구간(at(9, 9), at(12, 0))      // 9분 틈
  assert.equal(boot.inRestartGap(db, at(9, 5).getTime()), true, '9분 틈을 재시작으로 안 본다')

  가동기록비우기()
  가동구간(at(8, 0), at(9, 0))
  가동구간(at(9, 20), at(12, 0))     // 20분 틈
  assert.equal(boot.inRestartGap(db, at(9, 5).getTime()), false, '20분 틈을 재시작으로 봤다')
})

test('P-25: 구간 안이면 틈이 아니다 — 멀쩡히 돌던 시각을 재시작으로 읽지 않는다', () => {
  가동기록비우기()
  가동구간(at(8, 0), at(9, 0))
  가동구간(at(9, 5), at(12, 0))
  assert.equal(boot.inRestartGap(getDB(), at(10, 0).getTime()), false)
})

test('P-25: 가동 구간이 하나뿐이면 틈이 없다', () => {
  가동기록비우기()
  가동구간(at(8, 0), at(12, 0))
  assert.equal(boot.inRestartGap(getDB(), at(13, 0).getTime()), false,
    '뒤가 없는데 틈이라고 한다 — 지금 꺼져 있는 것을 재시작으로 읽는다')
})
