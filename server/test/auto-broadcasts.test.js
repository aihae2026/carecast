// 하루 일과 자동방송 정의(server/domain/autoBroadcasts.js).
//
// 이 파일은 **정의만** 갖고 실행은 scheduler.js가 그대로 맡는다(일과방송 로직은 손대지 않는다).
// 그래서 가장 중요한 검증은 "정의가 scheduler.js가 실제로 보는 설정키와 같은가"이다 —
// 어긋나면 겹침 경고가 엉뚱한 시각을 보고 조용히 쓸모없어진다.
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_autobc_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { AUTO_BROADCASTS, readEnabledAutoTimes } = require('../domain/autoBroadcasts')

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
function clearAll() {
  for (const spec of AUTO_BROADCASTS) {
    getDB().prepare('DELETE FROM settings WHERE key IN (?, ?)').run(spec.timeKey, spec.enabledKey)
  }
}

test('꺼져 있는 일과방송은 겹침 대상이 아니다', () => {
  clearAll()
  assert.deepEqual(readEnabledAutoTimes(getDB()), [], '설정이 없으면 꺼진 것으로 본다')

  put('lunch_broadcast_enabled', 'false')
  put('lunch_broadcast_time', '11:15')
  assert.deepEqual(readEnabledAutoTimes(getDB()), [], "'false'는 꺼진 것이다")
})

test('scheduler와 같은 규칙으로 켜짐을 판정한다(=== true 엄격 비교)', () => {
  clearAll()
  put('lunch_broadcast_enabled', '1')       // scheduler는 'true'만 인정한다
  put('lunch_broadcast_time', '11:15')
  assert.deepEqual(readEnabledAutoTimes(getDB()), [],
    "느슨하게 보면 실제로는 안 나가는 방송까지 겹침 경고가 떠서 잔소리가 된다")

  put('lunch_broadcast_enabled', 'true')
  assert.deepEqual(readEnabledAutoTimes(getDB()), [{ id: 'lunch', label: '점심 식사 전 방송', time: '11:15' }])
})

test('시각 설정이 없으면 기본값을 쓴다', () => {
  clearAll()
  put('morning_enabled', 'true')
  assert.equal(readEnabledAutoTimes(getDB())[0].time, '07:50')
})

// 요구사항(사용자 결정 2026-09-08 · AP-0012): **시각을 비우는 것은 "이 방송은 쓰지 않는다"는
// 의사표시다.** 관리자가 지운 시각에 기본값으로 방송이 나가는 것이 더 큰 사고이고, 요양시설에서는
// "안 나감"보다 "안 나가야 할 것이 나감"이 되돌리기 어렵다.
//
// 이 테스트는 2026-09-08 전까지 빈 값만 예외로 두어 `'' → 07:50` 을 기대했다. 그 기대가
// 발동부(`?? defaultTime`, 빈 값은 안 나감)와 정반대였고, 그래서 사람이 끄려고 비운 방송이
// **안 나가면서 쉬운 화면에 빨간 '누락'으로** 떴다(P-35, EV-001351·EV-001357).
// 지금은 빈 값도 다른 못 쓰는 값과 같은 자리에 둔다 — 예외가 없는 것이 요구사항이다.
test('시각이 비었거나 형식이 깨지면 그 방송은 목록에서 뺀다 — 빈 값은 사람이 끈 것이다', () => {
  clearAll()
  put('morning_enabled', 'true')
  for (const bad of ['25:00', '7:50', 'abc', '', '   ']) {
    put('morning_time', bad)
    assert.deepEqual(readEnabledAutoTimes(getDB()), [],
      `"${bad}" 로 저장된 방송이 목록에 남았다 — 기본 시각으로 되살아나면 사람이 끄려던 방송이 07:50에 나간다`)
  }
})

test('하루 흐름 순서대로 돌려준다', () => {
  clearAll()
  for (const spec of AUTO_BROADCASTS) put(spec.enabledKey, 'true')
  assert.deepEqual(
    readEnabledAutoTimes(getDB()).map(a => a.id),
    ['morning', 'exercise', 'lunch', 'dinner', 'evening_prayer'],
  )
})

// ── 드리프트 방어 ─────────────────────────────────────────────
//
// 2026-09-01(TD-02)까지 이 자리에는 "scheduler.js 소스에 이 설정키 문자열이 있는가"를
// 세는 검사가 있었고, 마지막에는 **"일과방송 실행 로직은 이 모듈을 쓰지 않는다"**는
// 금지 규칙까지 있었다. 사용자 결정으로 그 금지를 풀고 발동부가 이 표를 보게 바꿨다.
// 그러면 "두 벌이 서로 같은가"라는 셈 자체가 성립하지 않는다 — 두 벌이 없어졌기 때문이다.
//
// **지키려는 것은 그대로다: 표와 실제로 나가는 방송이 어긋나면 안 된다.**
// 확인 방법만 소스 대조에서 (1) 구조 + (2) 실행으로 바꾼다.
// 실제로 제때 발동하는지는 server/test/auto-broadcast-tick.test.js가 tick을 돌려 본다.

const SCHEDULER_SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')

test('발동부(scheduler.js)가 이 표를 실제로 쓴다', () => {
  assert.ok(SCHEDULER_SRC.includes("require('../domain/autoBroadcasts')"),
    '발동부가 정의표를 안 본다 — 시각·설정키가 다시 두 벌이 되고, 갈라지면 화면과 실제가 달라진다')
  assert.ok(SCHEDULER_SRC.includes('for (const spec of AUTO_BROADCASTS)'),
    '발동부가 표를 돌지 않는다 — 표에 줄을 더해도 그 방송은 안 나간다')
})

test('발동부에 5종의 설정키·기본 시각이 문자열로 다시 적혀 있지 않다', () => {
  for (const spec of AUTO_BROADCASTS) {
    assert.ok(!SCHEDULER_SRC.includes(`'${spec.enabledKey}'`),
      `${spec.id}: 켜짐 설정키가 발동부에 또 적혀 있다 — 갈라질 두 벌이 다시 생겼다`)
    assert.ok(!SCHEDULER_SRC.includes(`'${spec.firedKey}'`),
      `${spec.id}: 발동 표시 키가 발동부에 또 적혀 있다`)
    assert.ok(!SCHEDULER_SRC.includes(`'${spec.defaultTime}'`),
      `${spec.id}: 기본 시각이 발동부에 또 적혀 있다 — 표를 고쳐도 안 따라온다`)
  }

  // 시각 설정키는 morning_time 하나만 예외다 — 기상특보의 "근무시간 시작"이 같은 키를 읽는다.
  // 그 자리의 기본값도 이 표를 따르므로(morningSpec.defaultTime) 갈라지지 않는다.
  for (const spec of AUTO_BROADCASTS) {
    if (spec.timeKey === 'morning_time') continue
    assert.ok(!SCHEDULER_SRC.includes(`'${spec.timeKey}'`),
      `${spec.id}: 시각 설정키가 발동부에 또 적혀 있다`)
  }
})

test('표의 모든 방송에 발사 함수가 짝지어져 있다 — 짝이 없으면 그 방송은 영영 안 나간다', () => {
  const at = SCHEDULER_SRC.indexOf('const AUTO_FIRE = {')
  assert.ok(at > 0, '발동부에 발사 함수 짝표(AUTO_FIRE)가 없다')
  const block = SCHEDULER_SRC.slice(at, SCHEDULER_SRC.indexOf('}', at))
  for (const spec of AUTO_BROADCASTS) {
    assert.ok(block.includes(spec.id + ':'),
      `${spec.id}에 짝지어진 발사 함수가 없다 — 표에 있는데 아무도 안 부른다`)
  }
  assert.ok(SCHEDULER_SRC.includes('짝지어진 발사 함수가 없다'),
    '서버가 뜰 때 짝을 검사하는 가드가 사라졌다 — 빠뜨려도 아무도 모른다')
})