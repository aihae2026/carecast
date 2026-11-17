// 단계 하나가 실패해도 나머지 방송은 나가는가.
//
// 왜 필요했나(2026-08-29 리뷰 CC-007): fire* 5개 함수의 for 루프 안에서 단계가 throw하면
// 그대로 루프를 뚫고 나가 시퀀스 전체가 끝났다. TTS는 옛 인터넷 합성 엔진(네트워크)를 타고 실패까지
// 60초×3+3초×2 = 186초가 걸리는데, 그 한 단계 때문에 **로컬 mp3만으로 나갈 수 있었던
// 뒤 단계들(녹음 음원, 식사 전 안내)까지 같이 죽었다.**
//
// 인터넷이 끊긴 날 6회 방송 중 몇 개가 살아남는지를 코드 경로로 세어 보면 0/6이었다.
// 첫 단계가 대개 TTS이기 때문이다. 단계 격리 하나로 그게 6/6이 된다.
//
// 가장 중요한 회귀 방지선은 세 번째 테스트다: **취소는 실패가 아니다.** try/catch를 잘못
// 씌우면 정지 버튼을 눌러도 흐름이 계속 도는 회귀가 나고, 그건 지금 문제보다 나쁘다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stepiso_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 스텁 (broadcastSequencer가 require하기 전에) ──────────────
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
    addClient: () => {}, clientCount: () => 1, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

// TTS는 네트워크를 타므로 스텁. ttsShouldFail을 켜면 인터넷 단절 상황을 흉내낸다.
let ttsShouldFail = false
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    generateTTS:          async () => { if (ttsShouldFail) throw new Error('TTS 생성 타임아웃 (60초 초과)'); return '/tmp/fake.mp3' },
    generateTTSWithRetry: async () => { if (ttsShouldFail) throw new Error('TTS 생성 타임아웃 (60초 초과)'); return '/tmp/fake.mp3' },
    readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
    deleteTmpFile: () => {}, rateToStr: () => '+0%', pitchToStr: () => '+0Hz', getPythonPath: () => null,
  },
}
const audioStorePath = require.resolve('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true, exports: {
    storeAudio: () => 'fake-id', consumeAudio: () => null,
  },
}
// 날씨·캘린더 조회를 타지 않게 (fireMorningBroadcast가 맨 앞에서 부른다)
const morningPath = require.resolve('../services/morning')
require.cache[morningPath] = {
  id: morningPath, filename: morningPath, loaded: true, exports: {
    getMorningData: async () => ({ info: {}, alerts: [] }),
    buildSegmentText: () => '',
    DEFAULT_SEGMENTS: [], QUOTES: [], pickQuote: () => '', buildMorningText: async () => '',
  },
}

const { initDB, getDB } = require('../db/schema')
const seq = require('../services/broadcastSequencer')

// 브라우저 대역 — 음원·영상 재생 지시가 나가면 곧바로 "다 틀었다"고 답한다.
// 이게 없으면 시퀀서가 상한(음원 300초)까지 기다려서 테스트가 몇 분씩 멈춘다.
// 현장에서는 화면이 /api/morning/audio-ended로 이 신호를 보낸다.
let responder = null
function startBrowserStub() {
  let seen = 0
  responder = setInterval(() => {
    for (; seen < sent.length; seen++) {
      const e = sent[seen]
      if (e.type === 'prayer_play' && e.payload?.token) seq.notifyAudioEnded(e.payload.token)
      if (e.type === 'video_play'  && e.payload?.token) seq.notifyVideoEnded(e.payload.token)
    }
  }, 20)
}

test.before(() => { initDB(); startBrowserStub(); makePrayerAudio() })
test.after(() => {
  clearInterval(responder)
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

function setSetting(key, value) {
  getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}

// 아침 시퀀스를 두 단계로 좁힌다: 안내 TTS(실패 대상) → 녹음 음원(로컬 파일)
//
// **나머지를 명시적으로 꺼야 한다.** mergeStepsWithDefaults는 DEFAULT_STEPS를 기준으로
// 병합하므로, 저장 목록에 두 개만 적으면 나머지 기본 스텝이 기본 enabled 상태로 전부 남는다.
// 실제로 그 때문에 medication_tts의 6분 대기까지 돌아 테스트가 멈췄다.
const MORNING_STEP_IDS = [
  'bgm', 'date_weather_schedule', 'morning_prayer_intro', 'morning_prayer',
  'breakfast_prayer_tts', 'bgm_after', 'medication_tts', 'morning_video',
]
const KEEP = new Set(['morning_prayer_intro', 'morning_prayer'])

function useTwoStepMorning() {
  setSetting('morning_steps', JSON.stringify(
    MORNING_STEP_IDS.map((id, i) => ({ id, enabled: KEEP.has(id), order: i }))
  ))
}

function makePrayerAudio() {
  getDB().prepare(
    "INSERT INTO audio_files (category, filename, original_name) VALUES ('morning-prayer', 'prayer.mp3', '아침 방송 음원')"
  ).run()
}

function since(n) { return sent.slice(n) }
function failedLogs() {
  return getDB().prepare("SELECT * FROM broadcasts WHERE success = 0 ORDER BY id DESC").all()
}

// ── 1) 한 단계 실패가 뒤 단계를 죽이지 않는다 ──────────────────

test('TTS 단계가 실패해도 뒤의 로컬 음원 단계는 실행된다', async () => {
  useTwoStepMorning()
  ttsShouldFail = true
  const before = sent.length

  await seq.fireMorningBroadcast(getDB())
  ttsShouldFail = false

  const events = since(before)
  assert.ok(
    events.some(e => e.type === 'prayer_play'),
    '인터넷이 끊겨도 로컬 mp3는 나갈 수 있어야 한다. 실제 이벤트: ' + JSON.stringify(events.map(e => e.type))
  )
})

test('실패한 단계는 이력에 success=0으로 남는다 — 조용히 건너뛰지 않는다', async () => {
  useTwoStepMorning()
  ttsShouldFail = true
  const before = failedLogs().length

  await seq.fireMorningBroadcast(getDB())
  ttsShouldFail = false

  const rows = failedLogs()
  assert.ok(rows.length > before, '실패를 건너뛰기만 하면 예전의 침묵으로 되돌아간다')
  assert.match(rows[0].content, /morning_prayer_intro/, '어느 단계가 실패했는지 이력만 보고 알 수 있어야 한다')
})

test('모든 단계가 성공하면 방송이 완료로 기록된다 — 격리가 정상 경로를 바꾸지 않는다', async () => {
  useTwoStepMorning()
  ttsShouldFail = false
  const before = sent.length

  await seq.fireMorningBroadcast(getDB())

  const events = since(before)
  // broadcast_completed는 실패 경로(catch)에서도 나가므로 판정 근거로 쓰지 않는다.
  // 두 단계가 모두 실제로 실행됐는지를 본다.
  assert.ok(events.some(e => e.type === 'scheduled_broadcast'), 'TTS 단계가 나가야 한다')
  assert.ok(events.some(e => e.type === 'prayer_play'), '음원 단계가 나가야 한다')
  const ok = getDB().prepare("SELECT * FROM broadcasts WHERE success = 1 ORDER BY id DESC LIMIT 1").get()
  assert.match(ok.content, /아침/)
})

// ── 2) 취소는 실패가 아니다 (가장 중요한 회귀 방지선) ──────────

test('취소되면 남은 단계를 진행하지 않는다 — try/catch가 정지를 삼키면 안 된다', async () => {
  useTwoStepMorning()
  ttsShouldFail = false
  const before = sent.length

  const running = seq.fireMorningBroadcast(getDB())
  // 시퀀스가 첫 단계에 들어간 직후 정지 버튼을 누른 상황
  await new Promise(r => setTimeout(r, 50))
  seq.cancelCurrentBroadcast()
  await running

  const events = since(before)
  assert.ok(
    !events.some(e => e.type === 'broadcast_completed'),
    '취소된 방송을 완료로 기록하면 안 된다. 실제: ' + JSON.stringify(events.map(e => e.type))
  )
})

test('취소로 인한 중단은 실패 이력을 남기지 않는다 — 사람이 끈 것을 장애로 적으면 안 된다', async () => {
  useTwoStepMorning()
  ttsShouldFail = false
  const before = failedLogs().length

  const running = seq.fireMorningBroadcast(getDB())
  await new Promise(r => setTimeout(r, 50))
  // 제목이 말하는 "사람이 끈 것"의 실제 경로로 끊는다(routes/morning.js의 POST /stop).
  // ISSUE-010(2026-09-07)까지 여기는 맨몸 cancelCurrentBroadcast()였는데, 그것은
  // "새 방송이 앞 방송을 밀어냈다"의 경로다. 두 경로가 구별되지 않던 시절의 호출이라
  // 이 단언이 밀려 사라진 방송까지 정상으로 덮고 있었다.
  seq.stopCurrentBroadcast()
  await running

  assert.equal(failedLogs().length, before,
    '정지 버튼을 누를 때마다 실패 경보가 뜨면 사람이 경보를 무시하기 시작한다')
})
