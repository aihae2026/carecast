// 실패가 직원 화면까지 도달하는 유일한 통로.
//
// 왜 필요했나: 지금까지 방송 실패는 console.error 한 줄이나 broadcasts 행 하나로만 남았다.
// 그런데 콘솔은 cmd 창이 닫히면 사라지고, broadcasts 테이블은 관리자 화면 '방송 이력'
// 메뉴에 들어가야만 보인다 — 요양원 직원이 그 메뉴를 열 이유가 없다. 결과적으로
// "무언가 잘못됐다"는 사실 자체가 아무에게도 전달되지 않았다.
//
// 이 모듈은 실패 하나를 세 곳에 동시에 남긴다: DB(사후 추적) + SSE(지금 보는 화면) + 콘솔(로그 파일).
// 호출부가 이걸 안 쓰고 console.error만 하면 다시 침묵으로 돌아가므로, 통로를 하나로 둔다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_alert_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// SSE를 스텁해서 실제로 무엇이 발행됐는지 들여다본다
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (event, data) => { sent.push({ event, data }); return 1 },
    addClient: () => {}, clientCount: () => 1,
  },
}

const { initDB, getDB } = require('../db/schema')
const alert = require('../services/alert')

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('raise()가 broadcasts에 success=0으로 남긴다', () => {
  sent.length = 0
  alert.raise('아침방송', 'TTS 생성 실패 (60초 초과)')

  const row = getDB()
    .prepare("SELECT * FROM broadcasts WHERE type = '경보' ORDER BY id DESC LIMIT 1")
    .get()

  assert.ok(row, '경보가 방송 이력에 남아야 사후 추적이 가능하다')
  assert.equal(row.success, 0, '실패는 실패로 기록돼야 한다 — 이 시스템의 최대 문제가 무음을 성공으로 적는 것이다')
  assert.match(row.content, /아침방송/)
  assert.match(row.content, /TTS 생성 실패/)
  assert.equal(row.user, '자동')
})

test('날짜를 로컬(KST) 기준으로 적는다 — toISOString은 09시 이전에 전날이 된다', () => {
  alert.raise('테스트', '날짜 확인용')
  const row = getDB()
    .prepare("SELECT date FROM broadcasts WHERE type = '경보' ORDER BY id DESC LIMIT 1")
    .get()
  assert.equal(
    row.date, localToday(),
    '아침 방송(07:50)·국민체조(08:40) 시간대의 경보가 전날로 기록되면 원인 추적이 하루씩 어긋난다'
  )
})

test('raise()가 system_alert SSE를 발행한다 — 화면이 지금 알 수 있어야 한다', () => {
  sent.length = 0
  alert.raise('저녁 마무리', '음원 파일을 찾을 수 없습니다', { scheduleId: 12 })

  const ev = sent.find(s => s.event === 'system_alert')
  assert.ok(ev, 'DB에만 남기면 직원은 영영 모른다')
  assert.equal(ev.data.kind, '저녁 마무리')
  assert.match(ev.data.message, /음원 파일/)
  assert.equal(ev.data.scheduleId, 12, '추가 정보(detail)가 그대로 실려야 화면이 무엇에 대한 경보인지 안다')
  assert.ok(ev.data.at, '언제 났는지가 있어야 한다')
})

test('DB가 죽어 있어도 raise()는 던지지 않는다 — 경보를 남기려다 방송을 막으면 본말전도', () => {
  const broken = {
    prepare() { throw new Error('database is locked') },
  }
  assert.doesNotThrow(() => alert.raise('테스트', '디비 고장 상황', {}, broken))

  // DB에 못 남겼어도 화면 알림은 나가야 한다
  const ev = sent.filter(s => s.event === 'system_alert').pop()
  assert.match(ev.data.message, /디비 고장 상황/)
})

test('메시지가 아무리 길어도 300자로 자른다 — 이력 화면이 깨지지 않게', () => {
  alert.raise('테스트', 'x'.repeat(5000))
  const row = getDB()
    .prepare("SELECT content FROM broadcasts WHERE type = '경보' ORDER BY id DESC LIMIT 1")
    .get()
  assert.ok(row.content.length <= 320, `너무 김: ${row.content.length}자`)
})
