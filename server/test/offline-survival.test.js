// 인터넷이 완전히 끊긴 날, 6회 방송 중 몇 개가 살아남는가.
//
// 2026-08-29 리뷰가 코드 경로를 추적해 낸 답은 **0/6**이었다. 자동방송 5종은 전부 첫 단계
// 근처에 TTS가 있고, TTS 실패가 for 루프를 뚫고 나가 시퀀스를 통째로 끝냈기 때문이다.
// 로컬 mp3만으로 나갈 수 있었던 녹음 음원·체조 영상까지 같이 죽었다.
//
// CC-007(단계 격리)과 CC-016(TTS 폴백 캐시)이 그 표를 바꿨는지 여기서 못박는다. 이 테스트가
// 빨간불이면 "인터넷 끊겨도 방송은 나간다"는 약속이 깨진 것이다.
//
// 재현 방식: 네트워크를 실제로 끊을 수 없으니 경계(옛 인터넷 합성 엔진 실행)를 실패시킨다. 그것이
// 인터넷 단절이 이 시스템에 닿는 지점이다 — 날씨·캘린더는 이미 allSettled로 흡수되고
// (morning.js:183), YouTube BGM은 키가 없으면 스킵된다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_offline_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH
const CACHE_DIR = path.join(os.tmpdir(), `carecast_test_offlinecache_${process.pid}_${Date.now()}`)

const test   = require('node:test')
const assert = require('node:assert/strict')

const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
    addClient: () => {}, clientCount: () => 1, localClientCount: () => 1, localAliveCount: () => 1,
  },
}

// 인터넷 단절 = 옛 인터넷 합성 엔진 실행 실패. 캐시 로직은 **진짜를 쓴다**(그게 검증 대상이다).
const realTts = require('../services/tts')
let offline = false
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    ...realTts,
    // 재시도 횟수는 1로 고정한다 — 3초 backoff를 세 번 기다리면 테스트가 느려지기만 하고,
    // 검증 대상은 재시도가 아니라 "다 실패한 뒤 캐시로 돌아가는가"다.
    generateTTSWithRetry: (params) => realTts.generateTTSWithRetry(params, 1, {
      cacheDir: CACHE_DIR,
      generate: async (p) => {
        if (offline) throw new Error('TTS 생성 타임아웃 (60초 초과)')
        const f = path.join(os.tmpdir(), `carecast_off_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`)
        // **크기를 실제 mp3에 가깝게 준다.** 2026-09-03부터 512바이트 미만은 잘린 결과로 보고
        // 캐시에 넣지 않는다(0바이트로 죽은 옛 인터넷 합성 엔진 결과가 캐시에 앉으면 매일 그 무음이 나간다).
        // 앞머리는 그대로 둬야 "그 음성이 맞는지"를 확인할 수 있다.
        fs.writeFileSync(f, 'MP3:' + p.text.slice(0, 20) + 'x'.repeat(4096))
        return f
      },
    }),
  },
}
const audioStorePath = require.resolve('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true, exports: {
    storeAudio: () => 'fake-id', consumeAudio: () => null,
  },
}
const morningPath = require.resolve('../services/morning')
require.cache[morningPath] = {
  id: morningPath, filename: morningPath, loaded: true, exports: {
    // 인터넷이 끊기면 날씨·캘린더는 전부 null이 된다(allSettled가 흡수) — 그 상태를 그대로 준다
    getMorningData: async () => ({ info: {}, alerts: [], weather: null, air: null, events: null }),
    buildSegmentText: () => '',
    DEFAULT_SEGMENTS: [], QUOTES: [], pickQuote: () => '', buildMorningText: async () => '',
  },
}

const { initDB, getDB } = require('../db/schema')
const seq = require('../services/broadcastSequencer')

// 브라우저 대역 — 재생 지시가 나가면 곧바로 끝났다고 답한다
let responder = null
test.before(() => {
  initDB()
  let seen = 0
  responder = setInterval(() => {
    for (; seen < sent.length; seen++) {
      const e = sent[seen]
      if (e.type === 'prayer_play' && e.payload?.token) seq.notifyAudioEnded(e.payload.token)
      if (e.type === 'video_play'  && e.payload?.token) seq.notifyVideoEnded(e.payload.token)
    }
  }, 20)
  // 로컬 음원 — 인터넷과 무관하게 나갈 수 있어야 하는 것들
  for (const cat of ['morning-prayer', 'breakfast-grace', 'lunch-prayer', 'dinner-prayer', 'evening-prayer']) {
    getDB().prepare(
      "INSERT INTO audio_files (category, filename, original_name) VALUES (?, ?, ?)"
    ).run(cat, `${cat}.mp3`, cat)
  }
})

test.after(() => {
  clearInterval(responder)
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }) } catch { /* 무시 */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// 아침 시퀀스를 "TTS 먼저 → 로컬 음원 나중"으로 좁힌다(현장 순서와 같다)
const MORNING_IDS = ['bgm', 'date_weather_schedule', 'morning_prayer_intro', 'morning_prayer',
                     'breakfast_prayer_tts', 'bgm_after', 'medication_tts', 'morning_video']
const KEEP = new Set(['morning_prayer_intro', 'morning_prayer'])

function narrowMorning() {
  getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('morning_steps', JSON.stringify(MORNING_IDS.map((id, i) => ({ id, enabled: KEEP.has(id), order: i }))))
}

function run(before) { return sent.slice(before).map(e => e.type) }

test('인터넷이 끊겨도 로컬 녹음 음원은 나간다 — 예전엔 TTS 실패가 이것까지 죽였다', async () => {
  narrowMorning()
  offline = true
  const before = sent.length
  await seq.fireMorningBroadcast(getDB())
  offline = false

  assert.ok(run(before).includes('prayer_play'),
    '실제 이벤트: ' + JSON.stringify(run(before)))
})

test('한 번이라도 성공한 뒤엔 인터넷이 끊겨도 그 안내 음성이 그대로 나간다', async () => {
  narrowMorning()

  // 어제: 정상적으로 나갔다 → 캐시가 쌓인다
  offline = false
  await seq.fireMorningBroadcast(getDB())

  // 오늘: 인터넷 단절
  offline = true
  const before = sent.length
  await seq.fireMorningBroadcast(getDB())
  offline = false

  const types = run(before)
  assert.ok(types.includes('scheduled_broadcast'),
    '캐시 폴백이 있으면 안내 음성도 나가야 한다. 실제: ' + JSON.stringify(types))
  assert.ok(types.includes('prayer_play'), '녹음 음원도 함께 나가야 한다')
})

test('단절 상태에서도 방송이 완료까지 도달한다 — 중간에 통째로 끊기지 않는다', async () => {
  narrowMorning()
  offline = true
  const before = sent.length
  await seq.fireMorningBroadcast(getDB())
  offline = false

  const types = run(before)
  assert.ok(types.includes('broadcast_started'))
  assert.ok(types.includes('broadcast_completed'), '실제: ' + JSON.stringify(types))
})
