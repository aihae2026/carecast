// 무인 운영 경로의 외부 호출은 반드시 끝나야 한다.
//
// 왜 필요했나(2026-08-29 리뷰 CC-005·CC-006): SwitchBot·YouTube 호출에 타임아웃이 없었다.
// 이 둘은 사람이 누른 요청이 아니라 **매분 도는 cron과 자동방송 시퀀스 안에서 await된다.**
//   · switchbot.sendCommand/getDeviceStatus — checkSwitchBotSchedule이 매분 await한다.
//     응답이 없으면 그 분의 예약 점검·일과방송 판정이 통째로 밀린다.
//   · scheduler.resolveBGM의 YouTube 검색 — fireSchedule은 due 루프에서 순차로 도므로,
//     한 건이 매달리면 같은 분에 예정된 다른 예약까지 함께 밀린다.
// 사람이 누른 요청은 실패하면 다시 누르면 되지만, 이 경로에는 다시 누를 사람이 없다.
//
// 새 fetch가 타임아웃 없이 들어오면 조용히 같은 함정이 생기므로 파일 단위로 개수를 대조한다
// (auto-broadcasts.test.js·date-timezone.test.js와 같은 소스 대조 방식).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_fetchto_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// 자동으로 도는 경로의 파일들. 사람이 누른 요청만 하는 라우트(ai)는 제외한다 —
// 그쪽은 실패하면 사람이 다시 누를 수 있어 위험도가 다르다.
//
// calendar 는 2026-09-06 까지 "사람이 누른 요청만"이라며 여기서 빠져 있었다(ISSUE-004). 전제가
// 틀렸다 — 아침 종합 방송(07:50)이 morning.js 에서 무인으로 getTodayEvents 를 부르고, 그 안의
// 토큰 갱신 fetch 에 signal 이 없어 구글 무응답에 방송이 멈췄다. 이 테스트는 초록이었다 —
// 가드가 못 잡은 게 아니라 가드의 전제가 틀려서 안 본 것이다. 그래서 목록에 넣는다.
const UNATTENDED_FILES = [
  ['services', 'calendar.js'],
  ['services', 'switchbot.js'],
  ['services', 'scheduler.js'],
  ['services', 'broadcastSequencer.js'],
  // 2026-09-01: 시퀀서의 단계 실행은 이 파일로 옮겼다(외부 동영상 호출은 2026-09-21 걷어냈다).
  // 목록이 안 따라가면 무인 경로의 fetch가 가드 밖으로 빠져나간다.
  ['services', 'broadcastSteps.js'],
  ['services', 'weather.js'],
  ['routes',   'weather.js'],
  ['routes',   'weatherAlert.js'],
  // 2026-09-05: services/weather.js에서 순수 변환 규칙을 domain/weatherCodes.js로 내렸다.
  // 그 파일 머리말은 "여기에 fetch를 들이지 않는다"고 적어 뒀는데, **적어 두는 것만으로는
  // 아무도 안 막는다.** 지금은 fetch가 0건이라 이 줄은 0 === 0으로 통과하고, 누가 거기에
  // 외부 호출을 넣는 날부터 제한시간 규칙이 자동으로 걸린다.
  ['domain',   'weatherCodes.js'],
  // 2026-09-08(P-19): 무인 경로가 부르는데 목록에 없었다 — `scheduler.js:23`·`flowRunner.js:13`
  // 이 이 파일을 부르고, 그 안에서 유튜브 검색 fetch 가 나간다.
  // **지금은 그 fetch 에 자체 제한시간(`YOUTUBE_TIMEOUT_MS`)이 있어 이 줄은 1 === 1 로 통과한다.**
  // 넣는 이유는 ISSUE-004 와 같다 — 그때도 `calendar.js` 는 "사람이 누른 요청만"이라며 빠져
  // 있었고, 가드가 못 잡은 게 아니라 **가드의 전제가 틀려서 안 본 것**이었다.
  // 목록에 있어야 다음 fetch 가 제한시간 없이 들어오는 날 빨간불이 난다.
  ['services', 'broadcastConfig.js'],
]

// 주석 안의 'fetch(' 언급이 개수에 섞이지 않게 줄 주석을 걷어낸다
function stripLineComments(src) {
  return src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n')
}

test('무인 경로의 모든 fetch에 타임아웃이 걸려 있다', () => {
  for (const parts of UNATTENDED_FILES) {
    const src   = stripLineComments(fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8'))
    const calls = (src.match(/\bfetch\(/g) || []).length
    const timed = (src.match(/AbortSignal\.timeout\(/g) || []).length
    assert.equal(timed, calls,
      `${parts.join('/')}: fetch ${calls}건 중 타임아웃이 걸린 것은 ${timed}건 — 새로 넣은 fetch에 signal이 빠졌다`)
  }
})

test('SwitchBot 호출에 실제로 AbortSignal이 실려 나간다', async () => {
  const db = getDB()
  for (const [k, v] of [['switchbot_token', 't'], ['switchbot_secret', 's'], ['switchbot_device_id', 'd']]) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
  }

  const seen = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), signal: opts.signal })
    return { json: async () => ({ statusCode: 100, body: { power: 'on' } }) }
  }
  try {
    const { sendCommand, getDeviceStatus } = require('../services/switchbot')
    await sendCommand('press')
    await getDeviceStatus()
  } finally {
    globalThis.fetch = realFetch
  }

  assert.equal(seen.length, 2, 'fetch가 두 번 불리지 않았다')
  for (const call of seen) {
    assert.ok(call.signal instanceof AbortSignal, `${call.url}에 signal이 실리지 않았다`)
    assert.equal(call.signal.aborted, false, '호출 시점에 이미 중단된 signal이면 안 된다')
  }
})

// 여기에 "5초가 지나면 sendCommand가 reject된다"는 종단 테스트를 두려다 뺐다 —
// 확인되는 것이 우리 코드가 아니라 Node의 AbortSignal 동작이고, verify마다 5초를 쓴다.
// 회귀(새 fetch에 signal 누락)는 위 두 테스트가 잡는다.
