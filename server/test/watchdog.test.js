// 예정된 방송이 안 나갔다는 것을 시스템이 스스로 말하는가.
//
// 왜 필요했나(2026-08-29 리뷰 CC-004): 6회 방송이 예정대로 나갔는지 확인하는 주체가 사람뿐이고,
// 그 사람은 로그를 보지 않는 요양원 직원이다. 금요일 저녁에 재생 창이 닫히면 토·일 12회가
// 전부 무음인데 이력에는 아무 흔적이 없다 — 발동 자체가 없었으면 broadcasts 행도 안 생긴다.
// 월요일에 어르신들이 "주말에 아침 방송이 없었다"고 말해서야 알게 된다.
//
// 그래서 예정 시각이 지났는데 발동 기록(*_last_fired)이 오늘이 아니면 경보를 남긴다.
// 판정은 scheduler.js가 쓰는 것과 **같은 설정키**로 한다 — 키가 어긋나면 감시가 조용히
// 쓸모없어진다(auto-broadcasts.test.js가 같은 이유로 scheduler.js 소스를 대조한다).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_watchdog_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// SSE를 가로채 경보가 화면으로 나가는지 본다
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (event, data) => { sent.push({ event, data }); return 1 },
    addClient: () => {}, clientCount: () => 1, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

const { initDB, getDB } = require('../db/schema')
const { AUTO_BROADCASTS } = require('../domain/autoBroadcasts')
const watchdog = require('../services/watchdog')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function put(key, value) {
  getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
function del(key) { getDB().prepare('DELETE FROM settings WHERE key = ?').run(key) }

function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 오늘 날짜의 특정 시각. watchdog은 now를 주입받아야 테스트가 실제 시각을 안 기다린다.
function todayAt(hh, mm) {
  const d = new Date()
  d.setHours(hh, mm, 0, 0)
  return d
}

function reset() {
  sent.length = 0
  for (const spec of AUTO_BROADCASTS) {
    del(spec.enabledKey); del(spec.timeKey); del(spec.firedKey); del(spec.startedKey)
    del(`watchdog_alerted_${spec.id}`)
  }
  del('watchdog_grace_min')
  del('watchdog_run_grace_min')
  getDB().prepare("DELETE FROM broadcasts WHERE type = '경보'").run()
}

function alertRows() {
  return getDB().prepare("SELECT * FROM broadcasts WHERE type = '경보' ORDER BY id").all()
}

// ── 스펙 자체 ──────────────────────────────────────────────────

test('발동부와 누락 감시가 같은 표의 firedKey를 본다', () => {
  // 2026-09-01(TD-02) 전에는 scheduler.js 소스에 그 키 문자열이 있는지를 셌다.
  // 이제 발동부도 이 표에서 키를 꺼내 쓰므로 **어긋날 두 벌이 없다.**
  // 확인할 것은 "정말 둘 다 이 표를 보는가"뿐이다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  assert.ok(src.includes("require('../domain/autoBroadcasts')"),
    '발동부가 이 표를 안 본다 — 감시가 아무도 안 쓰는 키를 지키게 된다')
  assert.ok(src.includes('autoSettings.get(spec.firedKey)'),
    '발동부가 표의 firedKey로 "오늘 이미 나갔다"를 판정하지 않는다')
  for (const spec of AUTO_BROADCASTS) {
    assert.ok(spec.firedKey, `${spec.id}에 firedKey가 없다`)
  }
})

// ── 누락 감지 ──────────────────────────────────────────────────

test('예정 시각 +5분이 지났는데 발동 기록이 없으면 경보가 뜬다', () => {
  reset()
  put('lunch_broadcast_enabled', 'true')
  put('lunch_broadcast_time', '11:15')

  // 11:19 — 아직 유예 안에 있다
  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(11, 19) }), [],
    '시퀀스가 아직 도는 중일 수 있다 — 너무 이르게 지르면 잔소리가 된다')
  assert.equal(alertRows().length, 0)

  // 11:20 — 유예를 넘겼다
  const missed = watchdog.checkMissed(getDB(), { now: todayAt(11, 20) })
  assert.equal(missed.length, 1)
  assert.equal(missed[0].id, 'lunch')

  const rows = alertRows()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].success, 0)
  assert.match(rows[0].content, /점심 식사 전 방송/)
  assert.match(rows[0].content, /11:15/)
  assert.equal(rows[0].date, localToday(), '로컬 날짜로 남아야 이력에서 같은 날 칸에 보인다')

  const ev = sent.find(s => s.event === 'broadcast_missed')
  assert.ok(ev, '화면이 지금 알아야 한다 — DB에만 남기면 직원은 영영 모른다')
  assert.equal(ev.data.id, 'lunch')
  assert.equal(ev.data.time, '11:15')
})

test('정상 발동한 방송에는 경보가 안 뜬다', () => {
  reset()
  put('lunch_broadcast_enabled', 'true')
  put('lunch_broadcast_time', '11:15')
  put('lunch_last_fired', localToday())

  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(11, 30) }), [])
  assert.equal(alertRows().length, 0)
})

test('꺼져 있는 방송은 감시 대상이 아니다', () => {
  reset()
  put('lunch_broadcast_enabled', 'false')
  put('lunch_broadcast_time', '11:15')

  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(11, 30) }), [],
    '안 나가기로 한 방송을 안 나갔다고 알리면 안 된다')
})

test('어제 발동한 기록은 오늘 것으로 쳐 주지 않는다', () => {
  reset()
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  put('lunch_broadcast_enabled', 'true')
  put('lunch_broadcast_time', '11:15')
  put('lunch_last_fired', localToday(yesterday))

  assert.equal(watchdog.checkMissed(getDB(), { now: todayAt(11, 30) }).length, 1)
})

// ── 반복 방지 ──────────────────────────────────────────────────

test('같은 방송에 대해 경보는 하루 한 번만 — 매분 반복되면 이력이 경보로 뒤덮인다', () => {
  reset()
  put('lunch_broadcast_enabled', 'true')
  put('lunch_broadcast_time', '11:15')

  assert.equal(watchdog.checkMissed(getDB(), { now: todayAt(11, 20) }).length, 1)
  for (const m of [21, 22, 30, 45]) {
    assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(11, m) }), [], `11:${m}에 또 울렸다`)
  }
  assert.equal(alertRows().length, 1)
})

test('유예 시간은 설정으로 조정할 수 있다 — 시퀀스 길이는 현장마다 다르다', () => {
  reset()
  put('watchdog_grace_min', '15')
  put('lunch_broadcast_enabled', 'true')
  put('lunch_broadcast_time', '11:15')

  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(11, 25) }), [], '15분 유예 안이다')
  assert.equal(watchdog.checkMissed(getDB(), { now: todayAt(11, 31) }).length, 1)
})

test('여러 방송이 함께 누락되면 각각 알린다', () => {
  reset()
  put('morning_enabled', 'true');            put('morning_time', '07:50')
  put('exercise_broadcast_enabled', 'true'); put('exercise_broadcast_time', '09:00')

  const missed = watchdog.checkMissed(getDB(), { now: todayAt(10, 0) })
  assert.deepEqual(missed.map(m => m.id).sort(), ['exercise', 'morning'])
  assert.equal(alertRows().length, 2)
})

test('아직 예정 시각이 오지 않은 방송은 건드리지 않는다', () => {
  reset()
  put('evening_prayer_enabled', 'true')
  put('evening_prayer_time', '18:00')

  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(9, 0) }), [])
})

test('DB가 죽어도 checkMissed는 던지지 않는다 — 감시가 서버를 멈추면 안 된다', () => {
  const broken = { prepare() { throw new Error('database is locked') } }
  assert.doesNotThrow(() => watchdog.checkMissed(broken, { now: todayAt(12, 0) }))
})

// ── 나가는 중인 방송을 누락이라고 부르지 않는다 (2026-09-01) ────────────
//
// 실제로 겪은 일: 저녁 마무리가 매일 정상으로 나가는데 이력에는 매일 "[방송누락] 저녁 마무리(18:00)"가
// 남았다. 완료 표시(*_last_fired)는 시퀀스 **끝**에 찍히는데 유예는 5분 고정이었고,
// 저녁 마무리는 이 시스템 자신의 추정기로도 5.6분(18:06 종료)짜리다. 아침 종합 방송은 투약 안내
// 대기만 6분이라 아예 구조적으로 못 지킨다.
//
// 그래서 판정을 둘로 나눈다. "시작조차 안 했나"(진짜 누락)와 "시작은 했는데 안 끝나나"
// (중간에 멈춤)는 사람이 해야 할 일이 다르다 — 앞은 서버·창을 보고, 뒤는 멈춘 방송을 본다.

test('시작 표시가 오늘이면 아직 안 끝났어도 누락이 아니다', () => {
  reset()
  put('evening_prayer_enabled', 'true')
  put('evening_prayer_time', '18:00')
  put('evening_prayer_last_started', localToday())

  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(18, 6) }), [],
    '나가는 중인 방송을 누락이라고 부르면 매일 거짓 경보가 남는다')
  assert.equal(alertRows().length, 0)
})

test('어제 시작한 기록은 오늘 것으로 쳐 주지 않는다', () => {
  reset()
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  put('evening_prayer_enabled', 'true')
  put('evening_prayer_time', '18:00')
  put('evening_prayer_last_started', localToday(yesterday))

  assert.equal(watchdog.checkMissed(getDB(), { now: todayAt(18, 6) }).length, 1)
})

test('시작만 하고 오래도록 안 끝나면 다른 문구로 알린다 — 방송이 중간에 멈춘 것이다', () => {
  reset()
  put('evening_prayer_enabled', 'true')
  put('evening_prayer_time', '18:00')
  put('evening_prayer_last_started', localToday())

  // 기본 60분 안에는 지켜본다 — 아침 종합 방송은 40분을 넘기기도 한다
  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(18, 59) }), [])

  const stuck = watchdog.checkMissed(getDB(), { now: todayAt(19, 1) })
  assert.equal(stuck.length, 1)
  assert.equal(stuck[0].id, 'evening_prayer')

  const rows = alertRows()
  assert.equal(rows.length, 1)
  assert.match(rows[0].content, /끝나지 않았습니다/,
    '"안 나갔다"와 "안 끝났다"는 사람이 할 일이 다르다 — 문구가 같으면 안 된다')
  assert.doesNotMatch(rows[0].content, /나가지 않았습니다/)
})

test('멈춤 판정 유예도 설정으로 조정할 수 있다', () => {
  reset()
  put('watchdog_run_grace_min', '20')
  put('evening_prayer_enabled', 'true')
  put('evening_prayer_time', '18:00')
  put('evening_prayer_last_started', localToday())

  assert.deepEqual(watchdog.checkMissed(getDB(), { now: todayAt(18, 19) }), [])
  assert.equal(watchdog.checkMissed(getDB(), { now: todayAt(18, 21) }).length, 1)
})

test('시작도 완료도 없으면 예전 그대로 "나가지 않았습니다"로 알린다', () => {
  reset()
  put('evening_prayer_enabled', 'true')
  put('evening_prayer_time', '18:00')

  const missed = watchdog.checkMissed(getDB(), { now: todayAt(18, 6) })
  assert.equal(missed.length, 1)
  assert.match(alertRows()[0].content, /나가지 않았습니다/)
})

test('표에 startedKey가 다 있고 firedKey와 다르다', () => {
  for (const spec of AUTO_BROADCASTS) {
    assert.ok(spec.startedKey, `${spec.id}에 startedKey가 없다`)
    assert.notEqual(spec.startedKey, spec.firedKey)
  }
})

// 문구를 두 곳에서 지으면 갈라진다 (2026-09-01)
//
// 경보 id는 `날짜|종류|문구`(src/lib/alertStore.js)다. 그래서 이력에 남는 문구와 화면으로
// 가는 문구가 다르면 **같은 사건이 배너에 두 줄**로 뜬다. 게다가 화면이 문구를 스스로
// 지으면 "시작은 했는데 안 끝났다"가 "안 나갔다"로 둔갑한다 — 사람이 할 일이 정반대다.
test('이력 문구와 화면으로 보내는 문구가 같다 — 둘 다 서버가 한 번 지은 것이다', () => {
  for (const started of [false, true]) {
    reset()
    put('evening_prayer_enabled', 'true')
    put('evening_prayer_time', '18:00')
    if (started) put('evening_prayer_last_started', localToday())

    watchdog.checkMissed(getDB(), { now: todayAt(started ? 19 : 18, 30) })

    const row = alertRows()[0]
    assert.ok(row, `${started ? '멈춤' : '누락'} 경보가 안 남았다`)
    const ev = sent.find(s => s.event === 'broadcast_missed')
    assert.ok(ev.data.message, '화면이 문구를 다시 짓지 않도록 서버가 실어 보내야 한다')
    const kind = started ? '방송멈춤' : '방송누락'
    assert.equal(ev.data.kind, kind, '종류도 서버가 정한다 — 배너가 무엇을 가릴지 이걸로 갈린다')
    assert.equal(row.content, `[${kind}] ${ev.data.message}`,
      '이력과 화면의 문구가 다르면 같은 사건이 배너에 두 줄로 뜬다')
    assert.equal(ev.data.started, started)
  }
})

test('[화면] 배너는 서버가 보낸 문구를 그대로 쓴다 — 다시 짓지 않는다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'SystemAlertBanner.jsx'), 'utf8')
  const handler = src.slice(src.indexOf("addEventListener('broadcast_missed'"))
  assert.ok(handler.includes('d.message'), '화면이 서버 문구를 안 쓴다')
  assert.ok(!/나가지 않았습니다/.test(handler.slice(0, handler.indexOf('})'))),
    '화면이 문구를 다시 짓고 있다 — 서버가 문구를 바꿔도 화면은 옛 문장을 계속 보여준다')
})

// ── 빈 시각 (P-35, 사용자 결정 2026-09-08 · AP-0012) ───────────────────────
test('시각을 비운 방송은 경보를 내지 않는다 — 꺼진 것이지 빠뜨린 것이 아니다', () => {
  // 감시가 `|| defaultTime` 으로 읽던 때는 빈 시각이 기본시각(11:15)으로 되살아나
  // **안 나가기로 한 방송에 매일 누락 경보**가 붙었다(EV-001351). 발동부는 그 방송을
  // 내보내지 않으므로 경보만 남는 상태였다.
  reset()
  put('lunch_broadcast_enabled', 'true')
  put('lunch_broadcast_time', '')          // 사람이 편집기에서 칸을 비웠다
  watchdog.checkMissed(getDB(), { now: todayAt(23, 59) })
  assert.deepEqual(alertRows(), [],
    '시각을 비운 방송에 경보가 났다 — 사람이 끈 방송을 안 나갔다고 알리면 잔소리가 된다')
})

// ── 자정 경계 (P-37) ───────────────────────────────────────────────────────
test('자정 가까운 시각도 그날 안에 판정한다 — 마감이 하루를 넘으면 영영 안 걸린다', () => {
  // nowMin 의 최대값은 1439(23:59)인데 마감은 `예정 + 유예`다. 그래서 23:55 예정 + 유예 5분
  // = 1440 은 **어떤 분에도 도달하지 못해** 경보가 영원히 안 났다. 시작 후 멈춤은 유예가
  // 60분이라 22:59 이후 전부 안 걸렸다.
  reset()
  put('lunch_broadcast_enabled', 'true'); put('lunch_broadcast_time', '23:55')
  watchdog.checkMissed(getDB(), { now: todayAt(23, 59) })
  assert.match(alertRows()[0]?.content ?? '', /^\[방송누락\]/,
    '23:55 예정분이 하루가 끝나도록 경보가 안 났다 — 마감이 1440분이라 닿지 못한다')

  reset()
  put('lunch_broadcast_enabled', 'true'); put('lunch_broadcast_time', '23:00')
  put('lunch_last_started', localToday())   // 시작은 했는데 안 끝났다(유예 60분)
  watchdog.checkMissed(getDB(), { now: todayAt(23, 59) })
  assert.match(alertRows()[0]?.content ?? '', /^\[방송멈춤\]/,
    '23:00 에 시작해 멈춘 방송이 하루가 끝나도록 경보가 안 났다')
})

test('마감을 자르더라도 예정 시각과 같은 분에는 경보하지 않는다 — 유예가 0이 되면 안 된다', () => {
  // P-37 의 마감 자르기가 만들 뻔한 새 거짓 경보(독립 검수 2026-09-08 지적).
  // 23:59 예정 + 유예 5분을 그냥 1439 로 자르면 **23:59 그 분에 바로** 누락 경보가 붙는다.
  // 스케줄러의 같은 분 tick 이 아직 안 돌았으면 **나가는 중인 방송에** 경보가 붙는 것이다.
  reset()
  put('lunch_broadcast_enabled', 'true'); put('lunch_broadcast_time', '23:59')
  watchdog.checkMissed(getDB(), { now: todayAt(23, 59) })
  assert.deepEqual(alertRows(), [],
    '예정 시각과 같은 분에 누락 경보가 났다 — 유예를 한 번도 안 준 것이다')
})

test('시작조차 안 한 것과 시작해 놓고 멈춘 것은 경보 종류가 다르다', () => {
  // 배너에서 가리는 것은 '방송누락'뿐이다(src/lib/alertStore.js의 HIDDEN_KINDS).
  // 멈춘 방송까지 같은 종류로 묶으면, 사람이 지금 가 봐야 하는 일이 조용히 묻힌다.
  reset()
  put('lunch_broadcast_enabled', 'true'); put('lunch_broadcast_time', '11:15')
  watchdog.checkMissed(getDB(), { now: todayAt(11, 30) })
  assert.match(alertRows()[0].content, /^\[방송누락\]/)

  reset()
  put('lunch_broadcast_enabled', 'true'); put('lunch_broadcast_time', '11:15')
  put('lunch_last_started', localToday())
  watchdog.checkMissed(getDB(), { now: todayAt(12, 30) })
  assert.match(alertRows()[0].content, /^\[방송멈춤\]/)
})
