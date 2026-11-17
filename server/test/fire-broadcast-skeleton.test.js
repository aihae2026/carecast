// 자동방송 5종(아침·체조·점심·저녁·저녁 마무리)의 **실행 골격**을 있는 그대로 못박는다.
//
// 왜 필요했나(2026-08-31 리뷰 CC-040): fire*Broadcast 5개 함수가 같은 25줄짜리 골격을
// 각자 복사해서 갖고 있다 — 토큰 발급 → 시작 로그 → broadcastStart → 단계 루프
// (비활성 스킵 / 취소 확인 / tokenDelay(800) / 취소 재확인 / runStepGuarded) →
// 완료 시 *_last_fired 기록 + 이력 + broadcastComplete → catch에서 실패 이력 + broadcastComplete.
// 2026-08-31에 이 골격을 공통 실행기(runBroadcastLane) 하나로 합쳤다(TD-01). 골격이 하나라 안전장치를
// 한 곳에만 넣어도 5개 전부에 걸린다 — 하지만 합치는 과정에서 **지금 서로 다른 지점**을
// 실수로 뭉개면 그 방송만 조용히 달라진다. 그것을 잡는 것이 이 파일의 목적이다.
//
// ── 이 테스트는 RED로 시작하지 않는다 ─────────────────────────────
// CLAUDE.md 7번("처음부터 통과하는 테스트는 잘못된 테스트")은 **기능 추가**에 대한 규칙이다.
// 여기는 기능을 더하는 것이 아니라 **동작을 바꾸지 않는 리팩터링**의 안전망이라,
// 리팩터링 전에도 후에도 GREEN이어야 정상이다. 지금 빨간불이면 프로덕션이 아니라 이 파일이
// 현재 동작을 잘못 받아 적은 것이다(같은 성격의 가드가 weather-fail-cache.test.js에도 있다).
//
// 아래 CASES 표의 각 열이 곧 "5개가 서로 다른 지점"이다. 리팩터링 담당자는 이 표를
// runBroadcast의 인자 목록으로 읽으면 된다.
//   title        broadcastStart / broadcastComplete / runStepGuarded에 넘기는 제목
//   logContent   성공 시 broadcasts.content — **title과 문구가 다르다**
//   errorPrefix  catch에서 남기는 실패 이력의 앞머리 — title·logContent와 또 다르다
//   lastFiredKey 성공 시 settings에 찍는 키 (저녁 마무리만 evening_prayer_*)
//   lastStartedKey 시퀀스 시작 때 찍는 키 — 누락 감시가 "나가는 중"을 아는 근거(watchdog.js)
//   prepData     루프 전에 getMorningData()를 부르는가 (아침만 true)
//   closingTimer 완료 블록에서 bgm_set_timer를 쏘는가 (저녁 마무리만 true)
//   customOpts   default(커스텀) 분기에서 stepOpts(step)을 넘기는가 (CC-052 수정 후 5종 모두 true)
//
// ── customOpts 기대값을 바꾼 이유 (2026-08-31, CC-052) ────────────
// 이 표는 처음 쓸 때 "체조·점심·저녁은 stepOpts를 안 넘긴다"를 **결함인 줄 알면서 그대로**
// 못박아 두었다(그 차이를 발견한 것이 이 파일이다). CC-052로 그 세 곳을 아침과 같게 고치면서
// 기대값을 5종 모두 true로 바꾼다. 이것은 "테스트를 통과시키려고 테스트를 고치는 것"
// (CLAUDE.md 2번)이 **아니다** — 의도적으로 동작을 바꾸는 작업이고, 이 단언은 바로 그 순간
// 프로덕션 수정과 짝을 맞춰 움직이라고 남겨 둔 것이다. 먼저 이 표를 바꿔 RED를 확인하고,
// 그 다음 broadcastSequencer.js를 고쳐 GREEN으로 만들었다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_fireskel_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 소리·외부호출 차단 (offline-survival / step-isolation과 같은 선점 패턴) ──
// broadcastSequencer를 require하기 **전에** require.cache를 채워야 진짜 모듈이 안 뜬다.
const sent = []
let 현장창수 = 1          // 살아 있는 현장(localhost) 창 수. 시험이 0 으로 내려 본다
let 무창사건 = 0          // 창이 0 이 된 것을 본 횟수(단조 증가) — 시험이 올린다
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
    addClient: () => {}, clientCount: () => 1, localClientCount: () => 현장창수,
    // **살아 있는 현장 창 수를 시험이 쥔다**(2026-09-14 사고). 자동방송 레인이 이 숫자를
    // 보게 되면서, 0 일 때 무엇이 달라지는지가 이 파일의 시험 대상이 됐다.
    localAliveCount: () => 현장창수,
    // **창이 없던 것을 본 횟수**(V③ R8). 진짜 `sse` 는 연결이 떨어질 때마다 올린다 —
    // 대역은 **읽는 순간 0 이면 올린다.** 진짜보다 친절하지 않게: 값을 대신 채워 주지 않는다.
    무창사건수: () => 무창사건,
  },
}

// TTS는 옛 인터넷 합성 엔진(네트워크)를 탄다 — 스텁. ttsShouldFail로 단계 실패를 만든다.
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
// 날씨·캘린더 조회 차단 + **몇 번 불렸는지 센다**(아침만 부른다는 것이 골격의 차이다)
let morningCalls = 0
let morningShouldFail = false
const morningPath = require.resolve('../services/morning')
require.cache[morningPath] = {
  id: morningPath, filename: morningPath, loaded: true, exports: {
    getMorningData: async () => {
      morningCalls++
      if (morningShouldFail) throw new Error('날씨 조회 실패(주입)')
      return { info: {}, alerts: [] }
    },
    buildSegmentText: () => '',
    DEFAULT_SEGMENTS: [], QUOTES: [], pickQuote: () => '', buildMorningText: async () => '',
  },
}

const { initDB, getDB } = require('../db/schema')
const seq          = require('../services/broadcastSequencer')
const { todayStr } = require('../services/repeatSchedule')
const { readVolume } = require('../domain/volume')

// ── 5개 골격의 차이 표 ──────────────────────────────────────
const CASES = [
  {
    key: 'morning', tab: 'morning', fire: 'fireMorningBroadcast',
    title: '아침 종합 방송', logContent: '아침 방송', errorPrefix: '아침 방송 오류: ',
    lastFiredKey: 'morning_last_fired', lastStartedKey: 'morning_last_started',
    prepData: true, closingTimer: false, customOpts: true,
    fastStep: 'morning_prayer',       fastEvent: 'prayer_play',
    failStep: 'morning_prayer_intro',
    sequence: ['broadcast_started', 'prayer_play', 'broadcast_completed'],
  },
  {
    key: 'exercise', tab: 'exercise', fire: 'fireExerciseBroadcast',
    title: '국민체조', logContent: '국민체조 방송', errorPrefix: '국민체조 오류: ',
    lastFiredKey: 'exercise_last_fired', lastStartedKey: 'exercise_last_started',
    prepData: false, closingTimer: false, customOpts: true,   // CC-052로 true가 됨
    fastStep: 'exercise_video',       fastEvent: 'video_play',
    failStep: 'exercise_tts',
    // 영상 스텝은 BGM을 먼저 내리고(bgm_stop) 1.5초 뒤에 재생을 지시한다
    sequence: ['broadcast_started', 'bgm_stop', 'video_play', 'broadcast_completed'],
  },
  {
    key: 'lunch', tab: 'lunch', fire: 'fireLunchBroadcast',
    title: '점심 식사 전 방송', logContent: '점심 방송', errorPrefix: '점심 방송 오류: ',
    lastFiredKey: 'lunch_last_fired', lastStartedKey: 'lunch_last_started',
    prepData: false, closingTimer: false, customOpts: true,   // CC-052로 true가 됨
    fastStep: 'lunch_prayer_audio',   fastEvent: 'prayer_play',
    failStep: 'lunch_prayer_intro',
    sequence: ['broadcast_started', 'prayer_play', 'broadcast_completed'],
  },
  {
    key: 'dinner', tab: 'dinner', fire: 'fireDinnerBroadcast',
    title: '저녁 식사 전 방송', logContent: '저녁 방송', errorPrefix: '저녁 방송 오류: ',
    lastFiredKey: 'dinner_last_fired', lastStartedKey: 'dinner_last_started',
    prepData: false, closingTimer: false, customOpts: true,   // CC-052로 true가 됨
    fastStep: 'dinner_prayer_tts',    fastEvent: 'prayer_play',  // 녹음이 있으면 음원으로 나간다
    failStep: 'dinner_tts',
    sequence: ['broadcast_started', 'prayer_play', 'broadcast_completed'],
  },
  {
    key: 'evening_prayer', tab: 'evening_prayer', fire: 'fireEveningPrayerBroadcast',
    // 이름은 2026-10-17 종교 중립 기본값으로 「저녁 마무리」(동작·키는 그대로)
    title: '저녁 마무리', logContent: '저녁 마무리 방송', errorPrefix: '저녁 마무리 오류: ',
    lastFiredKey: 'evening_prayer_last_fired', lastStartedKey: 'evening_prayer_last_started',
    prepData: false, closingTimer: true, customOpts: true,
    fastStep: 'evening_prayer_audio', fastEvent: 'prayer_play',
    failStep: 'evening_prayer_tts',
    // 저녁 마무리만 완료 직전에 bgm_set_timer(15초)를 한 번 더 쏜다
    sequence: ['broadcast_started', 'prayer_play', 'bgm_set_timer', 'broadcast_completed'],
  },
]

// 음원 픽스처 — 각 방송의 "빠른 단계"가 실제로 나갈 수 있게
const AUDIO_FIXTURES = [
  'morning-prayer',   // morning_prayer
  'lunch-prayer',     // lunch_prayer_audio
  'dinner-grace',     // dinner_prayer_tts → stepMealPrayer가 녹음을 고른다
  'dinner-prayer',    // evening_prayer_audio
  'exercise-video',   // exercise_video
]

// 브라우저 대역 — 재생 지시가 나가면 곧바로 "다 틀었다"고 답한다.
// 이게 없으면 시퀀서가 상한(음원 300초·영상 480초)까지 기다려 테스트가 몇 분씩 멈춘다.
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
  for (const cat of AUDIO_FIXTURES) {
    getDB().prepare(
      "INSERT INTO audio_files (category, filename, original_name) VALUES (?, ?, ?)"
    ).run(cat, `${cat}.mp3`, cat)
  }
})

test.after(() => {
  clearInterval(responder)
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

// 켤 단계만 남기고 나머지는 **명시적으로 끈다.** mergeStepsWithDefaults는 DEFAULT_STEPS를
// 기준으로 병합하므로, 저장 목록에 몇 개만 적으면 나머지가 기본 enabled로 살아남는다
// (실제로 그것 때문에 투약 안내의 6분 대기까지 돌아 테스트가 멈춘 적이 있다).
// 목록을 DEFAULT_STEPS에서 뽑아 쓰므로 나중에 기본 스텝이 늘어도 이 테스트는 안 썩는다.
function configureSteps(tab, enabledIds, custom = []) {
  const rows = seq.DEFAULT_STEPS[tab].map((s, i) => ({ id: s.id, enabled: enabledIds.includes(s.id), order: i }))
  setSetting(`${tab}_steps`, JSON.stringify([...rows, ...custom]))
}

// now_playing은 상태 거울용 이벤트라 방송 수명주기 판정에서 제외한다.
//
// broadcast_step(2026-08-31 추가, "지금 3/8 기도·묵상 시간 음원 (선택)")도 같은 이유로 뺀다 — 재생을
// 지시하지 않고 화면에 진행 상황만 알리는 이벤트다. 여기 넣으면 **단계를 하나 켜고 끌 때마다**
// 이 골격 테스트의 기대값이 흔들려서, 정작 이 테스트가 지키려는 것(방송이 시작하고 끝나는
// 뼈대)이 잔가지에 묻힌다. 이 이벤트 자체의 계약은 broadcast-step-progress.test.js가 지킨다.
const MIRROR_EVENTS = new Set(['now_playing', 'broadcast_step'])
function typesSince(n) {
  return sent.slice(n).map(e => e.type).filter(t => !MIRROR_EVENTS.has(t))
}
function eventsSince(n) { return sent.slice(n) }
function rowsSince(id) {
  return getDB().prepare('SELECT * FROM broadcasts WHERE id > ? ORDER BY id').all(id)
}
function maxBroadcastId() {
  return getDB().prepare('SELECT COALESCE(MAX(id), 0) AS m FROM broadcasts').get().m
}

// ── 1) 정상 실행 — 이벤트 종류·순서, 제목, last_fired, 이력, 비활성 스킵 ──

for (const c of CASES) {
  test(`[${c.key}] 정상 실행: SSE 순서·제목·${c.lastFiredKey}·이력이 지금 값 그대로다`, async () => {
    // 켜는 단계는 하나뿐이고, 실패용 TTS 단계는 **꺼 둔다** → 비활성 스킵도 함께 고정된다
    configureSteps(c.tab, [c.fastStep])
    clearSetting(c.lastFiredKey)
    clearSetting(c.lastStartedKey)
    const before   = sent.length
    const beforeId = maxBroadcastId()
    const calls    = morningCalls

    await seq[c.fire](getDB())

    // 이벤트 종류와 순서
    assert.deepEqual(typesSince(before), c.sequence,
      `실제 이벤트: ${JSON.stringify(typesSince(before))}`)

    // broadcastStart / broadcastComplete에 넘어가는 제목 문자열
    const evs = eventsSince(before)
    assert.equal(evs.find(e => e.type === 'broadcast_started').payload.title,   c.title)
    assert.equal(evs.find(e => e.type === 'broadcast_completed').payload.title, c.title)

    // 꺼 둔 TTS 단계는 나가지 않았다
    assert.ok(!typesSince(before).includes('scheduled_broadcast'),
      `비활성(enabled:false) 단계가 실행됐다 — ${c.failStep}`)

    // 성공 시 settings에 찍히는 키와 값(오늘 날짜)
    assert.equal(getSetting(c.lastFiredKey), todayStr())
    // 시작 표시 — 시퀀스 앞머리에서 찍는다. 이게 없으면 5분 넘는 방송이 매일 누락으로 찍힌다.
    assert.equal(getSetting(c.lastStartedKey), todayStr())

    // 성공 시 broadcasts에 남는 행
    const rows = rowsSince(beforeId)
    assert.equal(rows.length, 1, `이력이 한 줄만 남아야 한다: ${JSON.stringify(rows.map(r => r.content))}`)
    assert.equal(rows[0].content, c.logContent)
    assert.equal(rows[0].type,    '자동')
    assert.equal(rows[0].user,    '자동')
    assert.equal(rows[0].target,  '전체')
    assert.equal(rows[0].success, 1)

    // 루프 앞에서 준비하는 데이터 — 아침만 getMorningData()를 부른다
    assert.equal(morningCalls - calls, c.prepData ? 1 : 0,
      c.prepData ? '아침은 루프 전에 날씨·일정을 한 번 조회한다'
                 : '아침 외의 방송은 getMorningData를 부르지 않는다')
  })
}

// 완료 블록의 차이를 정면으로 못박는다 — 저녁 마무리만 bgm_set_timer(15초)를 쏜다.
test('완료 직전 bgm_set_timer는 저녁 마무리에만 있다', () => {
  // 위 정상 실행 테스트들이 기록한 순서표를 그대로 읽는다(추가 실행 없음).
  for (const c of CASES) {
    assert.equal(c.sequence.includes('bgm_set_timer'), c.closingTimer, c.key)
  }
  const evening = CASES.find(c => c.key === 'evening_prayer')
  assert.deepEqual(evening.sequence.slice(-2), ['bgm_set_timer', 'broadcast_completed'],
    'bgm_set_timer는 완료 이벤트 **직전**이다 — 순서가 바뀌면 화면이 BGM 타이머를 놓친다')
})

// 이력 문구·키 이름이 서로 겹치지 않는다(리팩터링이 한 값으로 뭉개는 것을 막는다)
test('제목·이력 문구·실패 문구·last_fired 키가 5종 모두 다르다', () => {
  for (const field of ['title', 'logContent', 'errorPrefix', 'lastFiredKey', 'lastStartedKey']) {
    const values = CASES.map(c => c[field])
    assert.equal(new Set(values).size, values.length, `${field}가 겹친다: ${values.join(' / ')}`)
  }
  // 같은 방송 안에서도 제목과 이력 문구는 다른 문자열이다 — 한 인자로 합칠 수 없다
  for (const c of CASES) {
    assert.notEqual(c.title, c.logContent, `${c.key}: broadcastStart 제목과 이력 문구는 다르다`)
  }
  // 저녁 마무리만 evening_prayer_ 접두 — evening_last_fired가 아니다(scheduler가 이 키를 본다)
  assert.equal(getSetting('evening_last_fired'), null,
    '저녁 마무리의 키는 evening_prayer_last_fired다')
})

// ── 2) 취소 — 남은 단계 없음 / last_fired 없음 / 완료 로그 없음 ──

for (const c of CASES) {
  test(`[${c.key}] 취소되면 단계가 실행되지 않고 ${c.lastFiredKey}도 완료 이력도 남지 않는다`, async () => {
    configureSteps(c.tab, [c.fastStep])
    clearSetting(c.lastFiredKey)
    const before   = sent.length
    const beforeId = maxBroadcastId()

    const running = seq[c.fire](getDB())
    // 첫 단계 앞의 tokenDelay(800) 안에서 정지 버튼을 누른 상황.
    // 시각(150ms)에 판정을 걸지 않는다 — 이 값은 "아직 첫 단계 전"이라는 여유(800ms)일 뿐이고,
    // 판정은 아래 세 가지 상태(이벤트·설정·이력)로만 한다.
    await new Promise(r => setTimeout(r, 150))
    // **사람이 정지 버튼을 누른 경로**로 끊는다(routes/morning.js의 POST /stop).
    // 2026-09-07(ISSUE-010)까지 여기는 맨몸 cancelCurrentBroadcast()를 불렀는데, 그것은
    // 실제로는 "새 방송이 앞 방송을 밀어냈다"의 경로다. 두 경로가 같은 함수를 지나서
    // 구별이 없었고, 이 테스트는 그 시절의 "취소면 무조건 아무것도 안 남는다"를 못박고
    // 있었다 — 밀려서 사라진 방송까지 정상으로 본 셈이다.
    // 이 절이 원래 보려던 것은 정지 버튼이므로 그 호출로 바꾼다. 밀림 쪽은
    // broadcast-preempt-record.test.js가 "이력에 실패로 남는다"로 따로 못박는다.
    seq.stopCurrentBroadcast()
    await running

    const types = typesSince(before)
    assert.ok(!types.includes(c.fastEvent),
      `취소 뒤에 단계가 나갔다. 실제: ${JSON.stringify(types)}`)
    assert.ok(!types.includes('broadcast_completed'),
      `취소된 방송을 완료로 기록하면 안 된다. 실제: ${JSON.stringify(types)}`)
    assert.ok(!getSetting(c.lastStartedKey),
      '취소된 방송이 "나가는 중" 표시를 남겼다 — 감시가 60분 뒤에 "안 끝났다"고 헛경보를 낸다')
    assert.equal(getSetting(c.lastFiredKey), null,
      '취소된 방송이 발동 기록을 남기면 그날 그 방송이 다시 나가지 않는다')
    assert.deepEqual(rowsSince(beforeId), [],
      '사람이 누른 정지는 실패도 성공도 아니다 — 이력에 아무것도 남지 않는다. '
      + '(다른 방송에 밀린 경우는 다르다 — broadcast-preempt-record.test.js)')
  })
}

// ── 3) 단계 격리 — 한 단계가 throw해도 나머지는 계속 간다 ──
// step-isolation.test.js가 아침만 덮고 있어 나머지 4개로 넓힌다.

for (const c of CASES) {
  test(`[${c.key}] 한 단계가 실패해도 뒤 단계는 실행되고 방송은 완료된다`, async () => {
    configureSteps(c.tab, [c.failStep, c.fastStep])
    clearSetting(c.lastFiredKey)
    const before   = sent.length
    const beforeId = maxBroadcastId()

    ttsShouldFail = true
    await seq[c.fire](getDB())
    ttsShouldFail = false

    const types = typesSince(before)
    assert.ok(types.includes(c.fastEvent),
      `실패한 단계 뒤의 단계가 죽었다. 실제: ${JSON.stringify(types)}`)
    assert.ok(types.includes('broadcast_completed'), `실제: ${JSON.stringify(types)}`)
    assert.equal(getSetting(c.lastFiredKey), todayStr(),
      '단계 하나가 실패해도 방송 자체는 발동한 것으로 남는다')

    // runStepGuarded에 넘어가는 제목 — 경보 문구에 그대로 실린다
    const rows = rowsSince(beforeId)
    const alertRow = rows.find(r => r.success === 0)
    assert.ok(alertRow, `실패 단계가 이력에 남지 않았다: ${JSON.stringify(rows.map(r => r.content))}`)
    assert.equal(alertRow.content, `[방송단계] ${c.title}의 "${c.failStep}" 단계가 실패했습니다: TTS 생성 타임아웃 (60초 초과)`)
    assert.ok(rows.some(r => r.success === 1 && r.content === c.logContent),
      '완료 이력도 함께 남는다')
  })
}

// ── 4) catch 블록 — 실패 문구와 broadcastComplete 호출 ──
// 루프 안은 runStepGuarded가 다 삼키므로 바깥 catch에 닿는 길은 루프 앞/뒤뿐이다.
// settings 쓰기를 막아 완료 블록(*_last_fired 기록)에서 던지게 한다.
function dbWithoutSettingsWrite(real) {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql) => {
          if (/INSERT INTO settings/i.test(sql)) throw new Error('설정 저장 실패(주입)')
          return target.prepare(sql)
        }
      }
      const v = target[prop]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

for (const c of CASES) {
  test(`[${c.key}] 완료 처리 중 오류는 "${c.errorPrefix.trim()}" 이력 + 완료 이벤트로 끝난다`, async () => {
    configureSteps(c.tab, [])          // 단계 전부 꺼서 루프를 비운다(빠르다)
    const before   = sent.length
    const beforeId = maxBroadcastId()

    await seq[c.fire](dbWithoutSettingsWrite(getDB()))

    const rows = rowsSince(beforeId)
    assert.equal(rows.length, 1, `실패 이력이 한 줄만 남아야 한다: ${JSON.stringify(rows.map(r => r.content))}`)
    assert.equal(rows[0].success, 0)
    assert.ok(rows[0].content.startsWith(c.errorPrefix),
      `실패 이력 앞머리가 달라졌다: ${rows[0].content}`)

    const evs = eventsSince(before)
    const completed = evs.filter(e => e.type === 'broadcast_completed')
    assert.equal(completed.length, 1, 'catch에서도 broadcast_completed를 한 번 보낸다 — 화면이 "방송 중"에 갇히면 안 된다')
    assert.equal(completed[0].payload.title, c.title)
  })
}

// 아침만 루프 전에 getMorningData()를 부르고, 그 호출은 try 안에 있다(실패하면 catch로 간다)
test('[morning] 루프 전 날씨·일정 조회가 실패하면 아침 방송이 catch로 떨어진다', async () => {
  const c = CASES.find(x => x.key === 'morning')
  configureSteps(c.tab, [])
  clearSetting(c.lastFiredKey)
  const before   = sent.length
  const beforeId = maxBroadcastId()

  morningShouldFail = true
  await seq.fireMorningBroadcast(getDB())
  morningShouldFail = false

  const rows = rowsSince(beforeId)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].success, 0)
  assert.ok(rows[0].content.startsWith(c.errorPrefix), rows[0].content)
  assert.equal(getSetting(c.lastFiredKey), null, '실패한 방송은 발동 기록을 남기지 않는다')
  assert.ok(typesSince(before).includes('broadcast_completed'))
})

// ── 5) default(커스텀 스텝) 분기의 stepOpts ──
// 5종 모두 stepOpts(step)을 넘긴다 → 순서편집기에서 정한 스텝별 볼륨·목소리가 실제로 먹는다.
// CC-052 전에는 아침·저녁 마무리만 넘겨서, 체조·점심·저녁의 커스텀 단계는 관리자가 볼륨을
// 조절해도 **조용히 시스템 기본값으로 나갔다.**
//
// 이 수정이 실제로 소리를 바꾸는 조건은 좁다 — resolveStepVolume(domain/volume.js)이
// null/undefined/''를 "시스템 기본값"으로 보고 **0만 명시적 무음**으로 취급하므로,
// step.volume이 저장돼 있는 단계에만 영향이 간다. MorningEditor는 커스텀 단계를 만들 때
// 기본이 "시스템 기본값 사용"(volume: null)이라 체크를 풀어야 숫자가 들어간다.
// 즉 대부분의 현장 단계는 이 수정으로 동작이 바뀌지 않는다.
const STEP_VOLUME = 33

// TTS 대기(최소 6초)를 끝까지 기다리지 않는다 — 확인할 것은 나간 이벤트의 페이로드뿐이다.
async function runUntilEvent(fire, type, before) {
  const running = fire()
  const deadline = Date.now() + 15000       // 무한 대기 방지용 상한(판정 근거가 아니다)
  while (Date.now() < deadline && !sent.slice(before).some(e => e.type === type)) {
    await new Promise(r => setTimeout(r, 20))
  }
  seq.cancelCurrentBroadcast()
  await running
}

for (const c of CASES) {
  test(`[${c.key}] 커스텀 TTS 스텝에 stepOpts를 ${c.customOpts ? '넘긴다' : '넘기지 않는다'}`, async () => {
    configureSteps(c.tab, [], [{
      id: 'custom_probe', label: '커스텀 안내', enabled: true, order: 90,
      customType: 'tts', content: '커스텀 안내 문장입니다', volume: STEP_VOLUME,
    }])
    const systemDefault = readVolume(getDB(), 'tts')
    assert.notEqual(systemDefault, STEP_VOLUME, '시험 볼륨이 시스템 기본값과 같으면 차이를 못 본다')

    const before = sent.length
    await runUntilEvent(() => seq[c.fire](getDB()), 'scheduled_broadcast', before)

    const ev = eventsSince(before).find(e => e.type === 'scheduled_broadcast')
    assert.ok(ev, `커스텀 스텝이 나가지 않았다: ${JSON.stringify(typesSince(before))}`)
    assert.equal(ev.payload.title, '커스텀 안내')
    assert.equal(ev.payload.ttsVolume, c.customOpts ? STEP_VOLUME : systemDefault,
      c.customOpts
        ? `${c.key}: 커스텀 스텝의 볼륨이 SSE 페이로드(ttsVolume)에 실려야 한다 (CC-052)`
        : `${c.key}: 커스텀 스텝의 볼륨을 무시한다`)
  })
}

// ── 6) 재발 방지 가드 — 5개 default 분기를 소스로 대조한다 ──
// CC-052의 본질은 "다섯 곳에 같은 줄을 손으로 복사하다가 세 곳을 빠뜨린 것"이라,
// 위 실행 테스트만으로는 **새 방송이 생겼을 때** 같은 함정을 못 막는다. 소스를 직접 읽어
// 커스텀 분기가 전부 stepOpts(step)을 넘기는지 본다.
// (audio-backend.test.js·mac-platform-guards.test.js와 같은 소스 대조 방식)
//
// ── 이 가드가 무엇을 못 하는지 (2026-08-31 적대적 검증으로 실측) ──────────
// 소스 대조는 글자를 보는 것이라 한계가 분명하다. 과신하지 말고 이렇게 읽어라:
//  · **놓치는 것**: 새 방송이 조건을 다르게 적으면(`'message' || 'tts'`처럼 순서만 바꿔도)
//    아래 개수 검사에 안 걸린다. 즉 "방송이 하나 더 생기면 여기서 먼저 깨진다"고 믿으면 안 된다 —
//    새 자동방송을 추가할 때는 **CASES에 직접 등록하는 것이 사람의 몫**이다. 실행 테스트가
//    진짜 그물이고(뮤테이션 실험에서 방송 단위로 정확히 잡았다), 이건 보조 그물이다.
//  · **거짓으로 깨지는 것**: 동작을 안 바꾸는 정리에도 빨간불이 된다. 특히 CC-040(다섯 골격을
//    공통 실행기로 합치기)로 이 분기를 헬퍼로 뽑으면 반드시 걸린다. 그때는 **위 실행 테스트
//    5건이 여전히 초록인지 먼저 확인**하고, 초록이면 이 가드를 헬퍼 기준으로 다시 써라.
//    가드가 빨간불이라는 이유만으로 지우지도, 실행 테스트를 건드리지도 마라.
const SEQ_SRC = fs.readFileSync(require.resolve('../services/broadcastSequencer'), 'utf8')
const CUSTOM_BRANCH = "step.customType === 'tts' || step.customType === 'message'"
// 공백·줄바꿈에는 관대하게(포매팅 한 번에 깨지지 않게), stepOpts(step) 유무에는 엄격하게.
// 분기 시작점부터 좁은 창만 본다 — 넓게 잡으면 같은 함수의 medication_tts 호출(그쪽은
// 원래 stepOpts를 넘긴다)이 대신 매치돼 정작 커스텀 분기의 누락을 놓친다.
const CUSTOM_TTS_CALL = /stepTTS\([\s\S]{0,160}?tok,\s*stepOpts\(step\)\s*\)/
const BRANCH_WINDOW = 400

function countOccurrences(haystack, needle) {
  let n = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) n++
  return n
}

test('자동방송 5종의 default(커스텀) 분기가 모두 stepOpts(step)을 넘긴다 (CC-052)', () => {
  // 함수 시작 위치로 소스를 5토막 내고, 각 토막 안의 커스텀 분기를 본다
  const starts = CASES.map(c => {
    // 시그니처에 인자가 붙어도(2026-09-01 opts) 앵커가 안 깨지게 여는 괄호까지만 본다
    const at = SEQ_SRC.indexOf(`async function ${c.fire}(db`)
    assert.notEqual(at, -1, `${c.fire}를 소스에서 못 찾았다 — 이름이 바뀌었나?`)
    return { key: c.key, fire: c.fire, at }
  }).sort((a, b) => a.at - b.at)

  for (let i = 0; i < starts.length; i++) {
    const body = SEQ_SRC.slice(starts[i].at, starts[i + 1]?.at ?? SEQ_SRC.length)
    const branchAt = body.indexOf(CUSTOM_BRANCH)
    assert.notEqual(branchAt, -1, `${starts[i].fire}에 커스텀 스텝 분기가 없다`)
    assert.match(body.slice(branchAt, branchAt + BRANCH_WINDOW), CUSTOM_TTS_CALL,
      `${starts[i].fire}의 커스텀 TTS 호출이 stepOpts(step)을 안 넘긴다 — ` +
      '그 방송의 커스텀 단계만 볼륨·목소리가 조용히 무시된다(CC-052와 같은 결함)')
  }

  // 같은 분기를 복사해 만든 새 방송이라면 여기서 걸린다(조건을 다르게 적으면 못 잡는다 — 위 주석)
  assert.equal(countOccurrences(SEQ_SRC, CUSTOM_BRANCH), CASES.length,
    '커스텀 스텝 분기 개수가 CASES와 다르다 — 새 자동방송이 생겼으면 CASES에도 넣어라')
})

// ── **소리 낼 창이 없으면 성공이 아니다** (현장 사고 2026-09-14) ──────────────
//
// 그날 18:00 저녁 마무리 방송이 **아무 소리 없이** 지나갔는데 이력에는 **성공**으로 남았다.
// 원인은 현장 PC 에 localhost 로 열린 창이 하나도 없었던 것이고(예약 TTS·녹음 음원·BGM·
// 영상은 브라우저가 재생한다), **예약 경로는 진작부터 `hasSitePlayer()` 를 보는데 자동방송
// 5종만 안 보고 있었다.** 무음인데 기록은 멀쩡한 것이 이 저장소가 가장 비싸게 데인 모양이다.
const 저녁마무리 = CASES.find(c => c.key === 'evening_prayer')

test('[현장화면] 창이 하나도 없으면 **이력에 실패로 남는다**', async () => {
  configureSteps(저녁마무리.tab, [저녁마무리.fastStep])
  clearSetting(저녁마무리.lastFiredKey)
  const beforeId = maxBroadcastId()
  현장창수 = 0
  try { await seq[저녁마무리.fire](getDB()) } finally { 현장창수 = 1 }

  const 자동행 = rowsSince(beforeId).filter(r => r.type === '자동')
  assert.equal(자동행.length, 1, `자동 이력이 ${자동행.length}줄이다 — 한 방송은 한 줄이어야 한다`)
  assert.equal(자동행[0].success, 0,
    '소리를 낼 창이 하나도 없었는데 이력에 **성공**으로 남는다 — 2026-09-14 저녁 마무리 방송이 그랬다')
  assert.equal(자동행[0].fail_reason, require('../domain/broadcastRecord').사유.화면없음,
    '왜 실패했는지가 안 남는다 — 나중에 보면 원인을 모른다')
})

test('[현장화면] 그때 **배너 경보가 뜬다** — 사람이 알아야 고칠 수 있다', async () => {
  configureSteps(저녁마무리.tab, [저녁마무리.fastStep])
  clearSetting(저녁마무리.lastFiredKey)
  const before = sent.length
  const beforeId = maxBroadcastId()
  현장창수 = 0
  try { await seq[저녁마무리.fire](getDB()) } finally { 현장창수 = 1 }

  const 경보 = eventsSince(before).filter(e => e.type === 'system_alert')
  assert.equal(경보.length, 1, `경보가 ${경보.length}건이다 — 무음 한 번에 한 번 알린다`)
  assert.equal(경보[0].payload.kind, '현장화면없음', '경보 종류가 달라 배너 규칙에 안 걸린다')
  assert.match(경보[0].payload.message, /localhost/,
    '무엇을 하면 되는지가 문구에 없다 — 알리기만 하고 고칠 길을 안 준다')
  // **이력이 두 줄로 늘지 않는다** — 경보가 제 행을 또 적으면 같은 사건이 두 번 남는다.
  const 행 = rowsSince(beforeId)
  assert.equal(행.filter(r => r.type === '경보').length, 0,
    '경보가 이력 행을 또 적었다 — 같은 사건이 「자동」과 「경보」 두 줄로 남는다')
})

test('[현장화면] 창이 있으면 **예전 그대로다** — 경보도 실패도 없다', async () => {
  configureSteps(저녁마무리.tab, [저녁마무리.fastStep])
  clearSetting(저녁마무리.lastFiredKey)
  const before = sent.length
  const beforeId = maxBroadcastId()
  현장창수 = 1
  await seq[저녁마무리.fire](getDB())

  const 자동행 = rowsSince(beforeId).filter(r => r.type === '자동')
  assert.equal(자동행[0].success, 1, '현장 창이 있는데 실패로 적힌다 — 멀쩡한 방송이 전부 빨간불이 된다')
  assert.equal(eventsSince(before).filter(e => e.type === 'system_alert').length, 0,
    '현장 창이 있는데 경보가 뜬다 — 이러면 며칠 뒤부터 아무도 경보를 안 본다')
})

// ── **방송 도중에 창이 돌아와도 놓친 송출은 성공이 아니다** (V③ R7 지적) ────────────
// 처음에는 단계 루프가 **끝난 뒤에만** 창을 봤다. 그러면 송출할 때는 창이 없었는데 끝날
// 무렵 돌아온 경우 **전체가 성공으로 기록된다** — 그 방송은 아무도 못 들었다.
// 하필 같은 날 넣은 **자동 재개 루프**(창이 없으면 15초 뒤 다시 연다)가 방송 도중에 창을
// 살릴 수 있어서, **내 수정이 거짓 성공을 만들 참이었다.**
test('[현장화면] 송출 때 창이 없었으면 **끝에 돌아와도** 성공이 아니다', async () => {
  configureSteps(저녁마무리.tab, [저녁마무리.fastStep])
  clearSetting(저녁마무리.lastFiredKey)
  const beforeId = maxBroadcastId()

  // 송출 순간에는 0, 그 뒤 응답이 오가는 사이에 1 로 돌아온다(자동 재개 루프가 하는 일).
  현장창수 = 0
  const 되돌리기 = setTimeout(() => { 현장창수 = 1 }, 120)
  try { await seq[저녁마무리.fire](getDB()) } finally { clearTimeout(되돌리기); 현장창수 = 1 }

  const 자동행 = rowsSince(beforeId).filter(r => r.type === '자동')
  assert.equal(자동행.length, 1, `자동 이력이 ${자동행.length}줄이다`)
  assert.equal(자동행[0].success, 0,
    '송출할 때 창이 없었는데 **끝에 돌아왔다고 성공**으로 적었다 — 그 방송은 아무도 못 들었다')
})

test('[현장화면] **방송 도중에** 창이 닫혔다 돌아와도 성공이 아니다', async () => {
  // 위 시험은 **시작할 때** 창이 없었다 — 레인 첫 표본 하나로도 잡힌다. 그래서 **단계별
  // 표본이 필요하다는 것을 증명하지 못한다**(변이로 확인했다: 단계 표본을 지워도 초록).
  //
  // 이 시험은 그 자리를 정확히 겨눈다:
  //   시작엔 창이 **있고** → 단계 사이 지연(800ms) 동안 **닫히고** → **송출이 나가는 순간**
  //   돌아온다. 자동 재개 루프(창이 없으면 다시 연다)가 하는 일이 정확히 이 모양이고,
  //   그래서 **내 무음 수정이 거짓 성공을 만들 참이었다.**
  // 시각으로 맞추지 않고 **송출 이벤트에 맞춰** 되돌린다 — 시계로 맞추면 기계마다 흔들린다.
  configureSteps(저녁마무리.tab, [저녁마무리.fastStep])
  clearSetting(저녁마무리.lastFiredKey)
  const beforeId = maxBroadcastId()
  const before = sent.length

  현장창수 = 1                                              // 시작엔 있다
  const 닫힘 = setTimeout(() => { 현장창수 = 0 }, 150)       // 지연 도중에 닫힌다
  // 송출(`prayer_play`)이 나가는 순간 되돌린다 — 그 뒤의 표본과 마지막 판정은 「있음」을 본다
  let seen = before
  const 감시 = setInterval(() => {
    for (; seen < sent.length; seen++) {
      if (sent[seen].type === 저녁마무리.fastEvent) { 현장창수 = 1; clearInterval(감시) }
    }
  }, 10)
  try {
    await seq[저녁마무리.fire](getDB())
  } finally { clearTimeout(닫힘); clearInterval(감시); 현장창수 = 1 }

  const 자동행 = rowsSince(beforeId).filter(r => r.type === '자동')
  assert.equal(자동행.length, 1, `자동 이력이 ${자동행.length}줄이다`)
  assert.equal(자동행[0].success, 0,
    '방송 **도중에** 창이 닫힌 구간이 있었는데 끝에 돌아왔다고 성공으로 적었다 —'
    + ' 그 단계는 아무도 못 들었다')
})

test('[현장화면] **한 단계 안에서** 닫혔다 돌아와도 성공이 아니다 (V③ R8)', async () => {
  // 앞 시험은 **단계 앞뒤**에서 닫히는 경우를 봤다. 검수관이 그 안쪽을 짚었다 —
  // TTS 단계는 **합성 대기 → 송출 → 종료 대기**가 한 덩이라, 그 **안에서** 닫혔다
  // 돌아오면 경계 표본 넷이 모두 「있음」이다. 그래서 **사건 수**를 견준다.
  configureSteps(저녁마무리.tab, [저녁마무리.fastStep])
  clearSetting(저녁마무리.lastFiredKey)
  const beforeId = maxBroadcastId()

  현장창수 = 1; 무창사건 = 0
  // 단계가 도는 **도중에** 창이 떨어졌다 돌아온다 — 진짜 `sse` 라면 그 순간 사건이 오른다.
  // 경계 표본이 볼 수 없게, 값 자체는 **다시 1 로** 되돌려 둔다.
  const 안에서 = setTimeout(() => { 무창사건 += 1 }, 300)   // 레인이 도는 중(단계 지연 안쪽)
  try { await seq[저녁마무리.fire](getDB()) } finally { clearTimeout(안에서); 현장창수 = 1; 무창사건 = 0 }

  const 자동행 = rowsSince(beforeId).filter(r => r.type === '자동')
  assert.equal(자동행.length, 1, `자동 이력이 ${자동행.length}줄이다`)
  assert.equal(자동행[0].success, 0,
    '단계 **안에서** 창이 닫힌 구간이 있었는데 성공으로 적었다 — 경계만 보면 못 잡는다')
})
