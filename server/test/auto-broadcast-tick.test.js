// 일과방송 5종의 **발동부**를 실제로 돌려서 못박는다 — scheduler.js의 매분 tick.
//
// 왜 필요했나(2026-09-01 TD-02): 5종의 발동 조건이 scheduler.js 안에 25줄짜리 블록 5벌로
// 복사돼 있었고, 설정키 15개와 기본 시각 5개가 문자열로 다시 적혀 있었다. 같은 내용의
// 단일 정의표(domain/autoBroadcasts.js)가 이미 있는데도 발동부는 그것을 안 봤다.
// 그 둘이 갈라지면 **화면이 보여주는 시각과 실제로 나가는 시각이 달라진다.**
//
// 지금까지 그 드리프트를 막던 것은 소스 대조(정규식)뿐이었다. 발동부를 실제로 돌려 보는
// 검사가 없어서, 표를 쓰게 고치는 작업 자체가 위험했다. 이 파일이 그 안전망이다.
//
// **이 테스트는 RED로 시작하지 않는다.** 기능 추가가 아니라 동작을 바꾸지 않는 리팩터링의
// 안전망이라 고치기 전에도 후에도 GREEN이어야 정상이다(fire-broadcast-skeleton.test.js와 같은 성격).
//
// 무엇을 못박는가:
//   ① 켜져 있고 · 지금 시각과 같고 · 오늘 아직 안 나갔으면 → **그 방송 하나만** 발동한다
//      (레인이 남의 발사 함수를 부르는 복사 실수는 여기서 드러난다)
//   ② 꺼져 있으면 안 나간다 — 판정은 문자열 'true' 엄격 비교다('1'은 켜짐이 아니다)
//   ③ 오늘 이미 나갔으면(firedKey에 오늘 날짜) 다시 안 나간다
//   ④ 시각이 다르면 안 나간다
//   ⑤ 시각 설정이 비어 있으면 **정의표의 기본 시각**에 나간다
//      — AUTO_BROADCASTS.defaultTime이 실제 발동과 같은지를 실행으로 대조한다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bctick_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const { mock } = require('node:test')
const assert = require('node:assert/strict')

const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports } }

// ── 소리·네트워크 차단 (scheduler를 require하기 전에 심는다) ──
stub(require.resolve('../services/sse'), {
  broadcastSSE: () => 1,
  localClientCount: () => 1, localAliveCount: () => 1,
  clientCount: () => 1,
  addClient: () => {},
  soundOwner: () => null,
})
stub(require.resolve('../services/tts'), {
  generateTTS:          async () => '/tmp/fake.mp3',
  generateTTSWithRetry: async () => '/tmp/fake.mp3',
  readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
  deleteTmpFile: () => {},
  rateToStr:  () => '+0%',
  pitchToStr: () => '+0Hz',
  getPythonPath: () => null,
  ensurePythonPath: () => null,   // ISSUE-003 — 파이썬을 쓰는 경로가 이쪽을 쓴다
})
stub(require.resolve('../services/audioStore'), {
  storeAudio: () => 'fake-audio-id',
  consumeAudio: () => null,
})
stub(require.resolve('../services/chimePlayer'), {
  playChime: () => {},
  resolveChimeVolume: () => 0.8,
})
stub(require.resolve('../services/switchbot'), {
  sendCommand: async () => { throw new Error('테스트에서는 SwitchBot을 부르지 않는다') },
  getConfig: () => ({}),
})

// node-cron을 가짜로 — startScheduler()가 등록하는 매분 콜백을 붙잡아 손으로 돌린다
const cronTasks = []
stub(require.resolve('node-cron', { paths: [path.join(__dirname, '..', 'services')] }), {
  schedule: (expr, fn) => { cronTasks.push({ expr, fn }); return { stop() {}, start() {} } },
})

// 진짜 시퀀서를 먼저 불러 두고 **5개 발사 함수만** 기록용으로 갈아끼운다.
// 통째로 가짜를 넣으면 시퀀서를 함께 쓰는 다른 배관(bgmScheduler 등)이 조용히 죽는다.
const seqPath = require.resolve('../services/broadcastSequencer')
const realSeq = require(seqPath)
const fired = []
require.cache[seqPath].exports = {
  ...realSeq,
  fireMorningBroadcast:       async () => { fired.push('morning') },
  fireExerciseBroadcast:      async () => { fired.push('exercise') },
  fireLunchBroadcast:         async () => { fired.push('lunch') },
  fireDinnerBroadcast:        async () => { fired.push('dinner') },
  fireEveningPrayerBroadcast: async () => { fired.push('evening_prayer') },
}

const { initDB, getDB } = require('../db/schema')
const { AUTO_BROADCASTS } = require('../domain/autoBroadcasts')
const { startScheduler } = require('../services/scheduler')

// 자동방송 기본 시각·SwitchBot 기본 시각과 겹치지 않는 시각(수요일 14:23)
const BASE_DAY = [2026, 8, 2]          // 2026-09-02 (월 인덱스 8 = 9월)
const TODAY    = '2026-09-02'
const AT       = '14:23'

let db
let tick

test.before(() => {
  mock.timers.enable({ apis: ['Date'], now: new Date(...BASE_DAY, 14, 23, 0) })
  initDB()
  db = getDB()
  startScheduler()
  tick = cronTasks.find(t => t.expr === '* * * * *')?.fn
  assert.ok(tick, '매분 tick이 등록되지 않았다 — 스케줄러 배선이 바뀌었다')
})

test.after(() => {
  mock.timers.reset()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일이 없으면 지울 것도 없다 */ }
  }
})

function put(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
function drop(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}
// 5종을 전부 끄고 흔적을 지운다 — 앞 케이스가 다음 케이스에 새지 않게
function resetAll(at = new Date(...BASE_DAY, 14, 23, 0)) {
  mock.timers.setTime(at.getTime())
  fired.length = 0
  for (const spec of AUTO_BROADCASTS) {
    drop(spec.enabledKey); drop(spec.timeKey); drop(spec.firedKey)
  }
}

// ① 켜짐 + 시각 일치 + 오늘 미발동 → 그 방송 하나만
for (const spec of AUTO_BROADCASTS) {
  test(`${spec.label}: 켜져 있고 지금 시각이면 그 방송만 발동한다`, async () => {
    resetAll()
    put(spec.enabledKey, 'true')
    put(spec.timeKey, AT)

    await tick()

    assert.deepEqual(fired, [spec.id],
      `${spec.id}만 나가야 하는데 실제로 나간 것은 [${fired.join(', ')}] — 레인이 남의 발사 함수를 부르고 있다`)
  })
}

// ② 꺼져 있으면 안 나간다 (판정은 'true' 엄격 비교)
test('꺼져 있으면 안 나간다 — 판정은 문자열 true 엄격 비교다', async () => {
  for (const spec of AUTO_BROADCASTS) {
    resetAll()
    put(spec.timeKey, AT)

    put(spec.enabledKey, 'false')
    await tick()
    assert.deepEqual(fired, [], `${spec.id}: 'false'인데 나갔다`)

    put(spec.enabledKey, '1')
    await tick()
    assert.deepEqual(fired, [], `${spec.id}: '1'은 켜짐이 아니다 — 느슨하게 보면 끈 방송이 나간다`)
  }
})

// ③ 오늘 이미 나갔으면 다시 안 나간다
test('오늘 이미 나간 방송은 같은 날 다시 안 나간다', async () => {
  for (const spec of AUTO_BROADCASTS) {
    resetAll()
    put(spec.enabledKey, 'true')
    put(spec.timeKey, AT)
    put(spec.firedKey, TODAY)

    await tick()

    assert.deepEqual(fired, [],
      `${spec.id}: 오늘 표시(${spec.firedKey})가 있는데 또 나갔다 — 어르신이 같은 방송을 두 번 듣는다`)
  }
})

// ③-b 어제 나갔으면 오늘은 나간다 (중복을 막다가 영구 봉인하지 않는다)
test('어제 나간 방송은 오늘 다시 나간다 — 중복을 막다가 봉인하면 안 된다', async () => {
  for (const spec of AUTO_BROADCASTS) {
    resetAll()
    put(spec.enabledKey, 'true')
    put(spec.timeKey, AT)
    put(spec.firedKey, '2026-09-01')

    await tick()

    assert.deepEqual(fired, [spec.id], `${spec.id}: 어제 나갔다고 오늘 안 나갔다`)
  }
})

// ④ 시각이 다르면 안 나간다
test('시각이 다르면 안 나간다', async () => {
  for (const spec of AUTO_BROADCASTS) {
    resetAll()
    put(spec.enabledKey, 'true')
    put(spec.timeKey, '09:41')      // 지금(14:23)이 아닌 시각

    await tick()

    assert.deepEqual(fired, [], `${spec.id}: 시각이 다른데 나갔다`)
  }
})

// ⑤ 시각 설정이 비어 있으면 정의표의 기본 시각에 나간다
test('시각 설정이 없으면 AUTO_BROADCASTS의 기본 시각에 나간다', async () => {
  for (const spec of AUTO_BROADCASTS) {
    const [h, m] = spec.defaultTime.split(':').map(Number)
    resetAll(new Date(...BASE_DAY, h, m, 0))
    put(spec.enabledKey, 'true')     // timeKey는 일부러 비워 둔다

    await tick()

    assert.deepEqual(fired, [spec.id],
      `${spec.id}: 정의표의 기본 시각 ${spec.defaultTime}에 안 나갔다 — 표와 발동부의 기본값이 갈라졌다`)
  }
})

// ⑥ 시각을 **빈 값으로 저장한** 방송은 안 나간다 (설정이 아예 없는 것과 뜻이 다르다)
test('시각을 빈 값으로 저장한 방송은 안 나간다 — 설정이 없는 것과 뜻이 다르다', async () => {
  // 사람이 편집기에서 시각 칸을 비우면 빈 문자열이 저장된다. 예전부터 그 방송은 안 나갔다
  // ('' 는 현재 시각과 절대 안 맞는다). 기본 시각으로 대신 채워 주면 **사람이 일부러 비워 둔
  // 방송이 07:50에 나가 버린다** — 요양원에서는 "안 나감"보다 나쁜 쪽이다.
  for (const spec of AUTO_BROADCASTS) {
    const [h, m] = spec.defaultTime.split(":").map(Number)
    resetAll(new Date(...BASE_DAY, h, m, 0))
    put(spec.enabledKey, 'true')
    put(spec.timeKey, '')          // 비워서 저장한 상태

    await tick()

    assert.deepEqual(fired, [],
      `${spec.id}: 시각을 비워 뒀는데 기본 시각에 나갔다 — 사람이 끄려던 방송이 나간 것이다`)
  }
})
