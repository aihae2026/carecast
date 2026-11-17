// ISSUE-008 — 로그가 실패보다 먼저 "완료"라고 말하지 않는다
//
// 실물(2026-09-06, server_20260906.log, EV-000448):
//   04:31:00.027 [info]  [스케줄러] "…" 차임벨 완료 (13:31)
//   04:31:00.031 [error] [차임벨] 재생 실패 (종료코드 3221225794)
// 4ms 뒤에 실패한 것을 먼저 "완료"라고 적었다. scheduler 의 chime 분기가 playChime 을 **발사한
// 직후 동기적으로** "완료"를 찍었기 때문이다 — 재생 결과는 콜백으로 나중에 온다.
// 이력(broadcasts)은 RUNNING → 정정으로 정직하다(ISSUE-002). 거짓말하는 것은 로그뿐인데,
// 현장에서 무슨 일이 있었는지 되짚는 사람은 로그를 본다.
//
// 고친 규칙: 발사 시점 로그는 "발사"라고만 말하고, "재생 완료/실패"는 콜백 안에서 결과를 보고 적는다.
// 실제 스피커는 울리지 않는다 — chimePlayer 를 스텁으로 갈아 끼우고 콜백만 잡는다. DB 는 임시 파일.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_chime_log_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const CHIME_PATH = require.resolve('../services/chimePlayer')
let chimeOnDone = null
require.cache[CHIME_PATH] = {
  id: CHIME_PATH, filename: CHIME_PATH, loaded: true,
  exports: {
    playChime: (type, volumePct, onDone) => { chimeOnDone = onDone },
    resolveChimeVolume: () => 0.8,
  },
}

const { initDB, getDB } = require('../db/schema')
const { fireSchedule }  = require('../services/scheduler')

test.before(() => { initDB() })
test.after(() => {
  delete require.cache[CHIME_PATH]
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

let seq = 0
function makeChimeSchedule() {
  const title = `차임로그테스트${++seq}`
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES (?, '', '전체', '10:00', 1, '2026-08-28', '[]', 'chime')
  `).run(title).lastInsertRowid
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

// console.log 를 잠시 가로채 이 예약 제목이 들어간 줄만 모은다
async function captureLogs(title, fn) {
  const lines = []
  const orig = console.log
  console.log = (...args) => { const s = args.map(String).join(' '); if (s.includes(title)) lines.push(s); orig(...args) }
  try { await fn() } finally { console.log = orig }
  return lines
}

test('ISSUE-008: 발사 시점 로그는 "완료"라고 말하지 않는다 — 결과를 아직 모른다', async () => {
  chimeOnDone = null
  const s = makeChimeSchedule()
  const lines = await captureLogs(s.title, () => fireSchedule(s, getDB()))

  assert.ok(chimeOnDone, '전제: scheduler 가 playChime 에 콜백을 넘겨야 한다(ISSUE-002)')
  const fired = lines.filter((l) => l.includes('차임벨'))
  assert.ok(fired.length >= 1, `발사 로그가 한 줄은 있어야 한다. 실제: ${JSON.stringify(lines)}`)
  for (const l of fired) {
    assert.doesNotMatch(l, /완료/, `결과가 오기 전에 "완료"라고 적었다: ${l}`)
  }

  // **`차임벨` 이 든 줄만 보면 새는 것이 있다** (Codex 소급 검수 RB-01, [FACT] EV-004290).
  // 1회성 예약은 `finishScheduleFire` 가 `"… 1회 방송 완료 → 자동 비활성화"` 를 찍는데,
  // 그 줄에는 `차임벨` 이 없어서 위 걸러내기를 **통째로 빠져나갔다.** 재생을 시작하기도
  // 전이다 — 로그를 되짚는 사람은 그 방송이 끝났다고 읽는다.
  // 이 회차의 **모든 줄**에서, 결과가 오기 전 완료 표현이 없는지 본다.
  for (const l of lines) {
    assert.doesNotMatch(l, /방송 완료/,
      `결과가 오기 전에 "방송 완료"라고 적었다(차임벨이라는 낱말이 없어 위 검사가 못 봤다): ${l}`)
  }
})

test('ISSUE-008: 재생 결과는 콜백에서 로그로 남는다 — 실패는 실패라고, 성공은 완료라고', async () => {
  chimeOnDone = null
  const s1 = makeChimeSchedule()
  await fireSchedule(s1, getDB())
  const failLines = await captureLogs(s1.title, async () => { chimeOnDone(false) })
  assert.ok(failLines.some((l) => /재생 실패/.test(l)), `실패 결과가 로그에 없다. 실제: ${JSON.stringify(failLines)}`)

  chimeOnDone = null
  const s2 = makeChimeSchedule()
  await fireSchedule(s2, getDB())
  const okLines = await captureLogs(s2.title, async () => { chimeOnDone(true) })
  assert.ok(okLines.some((l) => /완료/.test(l)), `성공 결과가 로그에 없다. 실제: ${JSON.stringify(okLines)}`)
})

test('ISSUE-008: 소스 대조 — chime 분기의 동기 로그에 "완료"가 없다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  const start = src.indexOf("if (broadcastType === 'chime')")
  assert.ok(start >= 0, '전제: scheduler.js 에 chime 분기가 있어야 한다')
  const end = src.indexOf('return', start)
  const block = src.slice(start, end)
  // 콜백(화살표 함수) 안은 결과를 아는 자리라 제외한다 — 그 밖의 console.log 가 대상이다
  const outsideCallback = block.replace(/playChime\([\s\S]*?\n\s*\}\)/, '')
  const syncLogs = outsideCallback.split('\n').filter((l) => l.includes('console.log'))
  assert.ok(syncLogs.length >= 1, '전제: 발사 시점 로그 한 줄이 있어야 한다')
  for (const l of syncLogs) assert.doesNotMatch(l, /완료/, `발사 시점 로그가 "완료"를 말한다: ${l.trim()}`)
})
