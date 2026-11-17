// ISSUE-010 — 방송이 다른 방송에 밀려나면 이력에 흔적도 없이 사라진다
//
// 재현(2026-09-07, [FACT] EV-001144·EV-001151·EV-001152): 앞 레인이 도는 중에 새 방송이
// 시작하면 `newBroadcastToken()` 이 앞 방송을 취소한다. 앞 레인은 루프를 빠져나와
// `markStarted('')` 만 하고 **아무 기록도 안 남기고** 끝난다 — `broadcasts` 0건.
// 이미 스피커로 소리가 나가던 방송도 그렇다. 나중에 "그날 그 방송이 나갔나"를 물으면
// 이력에는 없고, 누락 감시는 서버가 안 떠 있던 것과 **똑같은 문구**로 알린다.
//
// 트리거는 셋이고 전부 흔하다:
//   ① 두 자동방송의 시각이 같은 분
//   ② 앞 레인이 아직 도는 중에 다음 레인이 발동(아침 6분 대기 → 09:00 체조)
//   ③ **수동재생 버튼** — `routes/morning.js:76,84,92,100,108` 이 맨몸
//      `cancelCurrentBroadcast()` 를 부른다. 현장에서 가장 흔한 조작이다.
//
// ── 사용자 결정 (2026-09-07, 안 (나)) ─────────────────────────
// **밀려난 방송은 `broadcasts` 에 실패(success=0)로 적는다. 배너는 띄우지 않는다.**
// 이력에 남아 나중에 추적할 수 있고, 화면은 조용하다. 그래서 이 파일은 두 가지를 함께
// 못박는다 — 행이 남는 것과, `system_alert`(배너) 가 안 나가는 것.
//
// **사람이 정지 버튼을 누른 것은 실패가 아니다.** 그건 종전대로 아무 기록도 안 남긴다.
// 두 경로가 같은 `cancelCurrentBroadcast()` 를 지나므로, 구분이 실제로 서는지가 이 파일의 핵심이다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_preempt_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 소리·외부호출 차단 (fire-broadcast-skeleton.test.js 와 같은 선점 패턴) ──
// broadcastSequencer 를 require 하기 **전에** require.cache 를 채워야 진짜 모듈이 안 뜬다.
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
    addClient: () => {}, clientCount: () => 1, localClientCount: () => 1, localAliveCount: () => 1,
  },
}
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    generateTTS:          async () => '/tmp/fake.mp3',
    generateTTSWithRetry: async () => '/tmp/fake.mp3',
    readCues: () => null,
    deleteTmpFile: () => {}, rateToStr: () => '+0%', pitchToStr: () => '+0Hz', getPythonPath: () => null,
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
    getMorningData: async () => ({ info: {}, alerts: [] }),
    buildSegmentText: () => '',
    DEFAULT_SEGMENTS: [], QUOTES: [], pickQuote: () => '', buildMorningText: async () => '',
  },
}

const { initDB, getDB } = require('../db/schema')
const seq = require('../services/broadcastSequencer')

// 점심 레인 하나로 본다 — 골격은 runBroadcastLane 하나라 레인마다 다르지 않다
// (그 사실 자체는 fire-broadcast-skeleton.test.js 가 5종 전부로 고정한다).
const TAB   = 'lunch'
const FIRE  = 'fireLunchBroadcast'
const STEP  = 'lunch_chime'          // 아래 test.before 에서 실제 id 로 바꾼다
const KEYS  = { fired: 'lunch_last_fired', started: 'lunch_last_started' }

let fastStep = STEP

test.before(() => {
  initDB()
  // 첫 단계 id 를 DEFAULT_STEPS 에서 그대로 꺼내 쓴다 — 기본 단계 이름이 바뀌어도 안 썩는다
  fastStep = seq.DEFAULT_STEPS[TAB][0].id
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 도구 ────────────────────────────────────────────────────

function setSetting(key, value) {
  getDB().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value))
}
function getSetting(key) {
  return getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null
}
function clearSetting(key) {
  getDB().prepare('DELETE FROM settings WHERE key = ?').run(key)
}
function configureSteps(enabledIds) {
  const rows = seq.DEFAULT_STEPS[TAB].map((s, i) => ({ id: s.id, enabled: enabledIds.includes(s.id), order: i }))
  setSetting(`${TAB}_steps`, JSON.stringify(rows))
}
function maxBroadcastId() {
  return getDB().prepare('SELECT COALESCE(MAX(id), 0) AS m FROM broadcasts').get().m
}
function rowsSince(id) {
  return getDB().prepare('SELECT * FROM broadcasts WHERE id > ? ORDER BY id').all(id)
}

// 방송을 띄우고 첫 단계 앞의 tokenDelay(800ms) 안에서 `kill()` 을 부른다.
// 시각(150ms)에 판정을 걸지 않는다 — "아직 첫 단계 전"이라는 여유일 뿐이다.
async function 밀어내기(kill) {
  configureSteps([fastStep])
  clearSetting(KEYS.fired)
  clearSetting(KEYS.started)
  const before   = sent.length
  const beforeId = maxBroadcastId()

  const running = seq[FIRE](getDB())
  await new Promise(r => setTimeout(r, 150))
  kill()
  await running

  return { rows: rowsSince(beforeId), types: sent.slice(before).map(e => e.type) }
}

// ── 1) 밀려난 방송은 이력에 실패로 남는다 ────────────────────

test('ISSUE-010: 다른 방송이 시작해 밀려나면 broadcasts 에 실패로 남는다', async () => {
  // 실제 밀림 경로 그대로 — 새 방송의 첫 동작이 newBroadcastToken() 이고,
  // 그 안에서 cancelCurrentBroadcast() 가 앞 방송을 끊는다.
  const { rows } = await 밀어내기(() => seq.__test__.newBroadcastToken())

  assert.equal(rows.length, 1,
    `밀려난 방송이 이력에 없다 — 나중에 "그날 그 방송이 나갔나"를 물으면 답할 근거가 사라진다. 실제 ${rows.length}건`)
  assert.equal(rows[0].success, 0, '밀려난 방송을 성공으로 적으면 안 된다')
  assert.equal(rows[0].type, '자동')
  assert.match(rows[0].content, /밀려/,
    `이력 문구가 "왜 안 나갔는지"를 말해야 한다 — 서버가 안 떠 있던 것과 구별돼야 한다. 실제: ${rows[0].content}`)
})

test('ISSUE-010: 수동재생 버튼 경로(맨몸 cancelCurrentBroadcast)도 똑같이 남는다', async () => {
  // routes/morning.js:76,84,92,100,108 이 부르는 그 호출이다. 현장에서 가장 흔한 트리거다.
  const { rows } = await 밀어내기(() => seq.cancelCurrentBroadcast())

  assert.equal(rows.length, 1, `수동재생에 밀린 방송이 이력에 없다. 실제 ${rows.length}건`)
  assert.equal(rows[0].success, 0)
})

// ── 2) 배너는 띄우지 않는다 (사용자 결정 (나)) ────────────────

test('ISSUE-010: 밀림은 배너를 띄우지 않는다 — system_alert 가 나가지 않는다', async () => {
  const { types } = await 밀어내기(() => seq.__test__.newBroadcastToken())

  assert.ok(!types.includes('system_alert'),
    `밀림은 이력에만 남기기로 했다(사용자 결정 (나)). 배너까지 띄우면 정시 방송을 수동재생으로 앞당길 때마다 경보가 뜬다. 실제: ${JSON.stringify(types)}`)
})

// ── 3) 사람이 정지한 것은 종전대로 아무것도 안 남는다 ─────────

test('ISSUE-010: 사람이 정지 버튼을 누른 것은 실패가 아니다 — 이력에 안 남는다', async () => {
  const { rows } = await 밀어내기(() => seq.stopCurrentBroadcast())

  assert.deepEqual(rows, [],
    '정지 버튼은 사람의 뜻대로 된 것이다. 실패로 적으면 이력이 사람의 정상 조작으로 오염된다')
})

// ── 4) 성격을 모르게 됐을 때 어느 쪽으로 넘어지는가 ──────────
//
// 취소 성격은 최근 32세대만 남는다. 밀려난 레인이 늦게 깨어나는 사이(예: 옛 인터넷 합성 엔진 가
// 60초를 끄는 단계 안에서 밀린 경우) 취소가 그보다 많이 들어오면 제 기록이 밀려난다.
// [FACT] EV-001229 — 독립 검수자가 이 경로를 찾았다. 그때 "사람이 껐다"로 넘겨짚으면
// 밀려난 방송이 **또 조용히 사라진다** — 고치려던 그 결함이다.
// 그래서 wasHumanStopSince 는 확실히 사람일 때만 참이다.

test('ISSUE-010: 취소 기록이 밀려나 성격을 모르게 되면 "사람이 껐다"로 넘겨짚지 않는다', () => {
  const gate = require('../services/broadcastGate')

  gate.newBroadcastToken()
  const gen = gate.cancelGeneration()
  for (let i = 0; i < 40; i++) gate.newBroadcastToken()   // 취소 40번 — 32칸을 넘긴다

  assert.equal(gate.cancelKindSince(gen), null,
    '전제: 32칸을 넘기면 그 세대의 취소 성격이 Map 에서 밀려난다')
  assert.equal(gate.wasHumanStopSince(gen), false,
    '모르는 것을 "사람이 껐다"로 넘겨짚으면 밀려난 방송이 또 조용히 사라진다. '
    + '반대로 틀리면 이력에 줄 하나가 더 남을 뿐이고 사람이 보고 판단할 수 있다')
})

test('ISSUE-010: 사람이 끈 것은 확실히 알 때만 참이다', () => {
  const gate = require('../services/broadcastGate')

  gate.newBroadcastToken()
  const gen = gate.cancelGeneration()
  gate.stopCurrentBroadcast()

  assert.equal(gate.wasHumanStopSince(gen), true)
})

// ── 5) 밀려도 발동·시작 표시는 종전대로 안 남는다 ─────────────

test('ISSUE-010: 밀린 방송은 이력만 남기고 발동·시작 표시는 그대로 비운다', async () => {
  await 밀어내기(() => seq.__test__.newBroadcastToken())

  assert.equal(getSetting(KEYS.fired), null,
    '밀린 방송이 발동 기록을 남기면 그날 그 방송이 다시 나가지 않는다')
  assert.ok(!getSetting(KEYS.started),
    '밀린 방송이 "나가는 중" 표시를 남기면 감시가 60분 뒤에 "안 끝났다"고 헛경보를 낸다')
})
