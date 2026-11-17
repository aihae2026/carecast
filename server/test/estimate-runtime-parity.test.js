// 예상 소요시간이 **실행부가 실제로 기다리는 시간**과 어긋나던 4가지.
//
// 이 숫자는 장식이 아니라 주장이다. 사람이 화면의 "대략 28분 · 07:50 → 08:18"을 보고
// 다음 방송을 08:20에 잡는다. 아래 4건은 전부 **짧게** 나오는 방향이라 오차가 상쇄되지
// 않고 쌓이고, 그 끝은 두 방송이 같은 스피커로 겹치는 것이다.
//
// 그래서 이 파일의 테스트는 값을 베껴 적는 대신 **실행부와 같아야 한다**는 관계를 고정한다.
//   1. 커스텀 BGM 재생목록 — flowRunner는 곡마다 기다리는데 추정은 첫 곡만 셌다
//   2. 재생 배속 — 실행부는 0.5~1.5로 자르는데(normalizePlaybackRate) 추정은 원값을 나눴다
//   3. enabled가 없는 단계 — 실행부는 `if (!step.enabled) continue`로 건너뛰는데 추정은 셌다
//   4. 빈 문구 — 실행부는 `getSetting(...) || 기본문구`인데 라우트는 빈 문자열을 그대로 넘겼다
//
// 근거(실측한 원본):
//   server/services/flowRunner.js         — bgm 단계의 곡별 대기 루프
//   server/services/broadcastSequencer.js — stepAudioFile의 normalizePlaybackRate, `!step.enabled`
//   server/services/scheduleStore.js      — RATE_MIN 0.5 / RATE_MAX 1.5
//   server/domain/broadcastScheduleRead.js — 추정이 문구·파일을 모으는 곳(2026-09-05에 라우트에서 내려왔다)
'use strict'

const path = require('path')
const { editorSource } = require('./helpers/editorSource')
const os   = require('os')
const fs   = require('fs')

// 운영 DB를 절대 건드리지 않는다 — 라우트 테스트가 initDB를 부르기 때문에 반드시 먼저 심는다.
const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_parity_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH     = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { estimateBroadcastDuration, STEP_GAP_MS } = require('../domain/broadcastEstimate')
// 실행부의 배속 클램프. 0.5~1.5라는 숫자를 여기 베껴 적지 않는다 — 범위가 바뀌면 같이 따라온다.
const { normalizePlaybackRate } = require('../services/scheduleStore')

const { initDB, getDB }   = require('../db/schema')
const { startTestApp }    = require('./helpers/testApp')
const settingsRoutes      = require('../routes/settings')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': settingsRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

const total = (steps, materials = {}) => estimateBroadcastDuration(steps, materials).totalMs

// ─────────────────────────────────────────────────────────────
// 1. 커스텀 BGM 재생목록 — 곡마다 기다린다
// ─────────────────────────────────────────────────────────────
// flowRunner.js의 bgm 루프: 곡마다 `(bgm_delay || 5)초` 대기하고, **마지막이 아닌 곡만**
// 추가로 `duration_sec`만큼 더 기다린 뒤 다음 곡으로 넘어간다.
// 3곡(각 5초 / 60초)이면 (5+60) + (5+60) + 5 = 135초다.
// 순서편집기가 커스텀 BGM 단계를 만들 때 넣는 기본 항목이 정확히 {bgm_delay:5, duration_sec:60}이다
// (MorningEditor.jsx addCustomStep).
test('커스텀 BGM 재생목록은 곡마다 센다 — 첫 곡만 세면 3곡짜리가 5초로 나온다', () => {
  const item = { bgm_type: 'preset', bgm_value: '클래식 음악', bgm_title: '', bgm_delay: 5, duration_sec: 60 }
  const step = { id: 'custom_bgm_1', label: 'BGM', enabled: true, customType: 'bgm', playlist: [item, item, item] }

  assert.equal(total([step], { tab: 'morning' }), STEP_GAP_MS + 135000)
})

test('커스텀 BGM 재생목록이 한 곡이면 선재생만 센다 — 마지막 곡은 기다리지 않는다', () => {
  const step = {
    id: 'custom_bgm_1', label: 'BGM', enabled: true, customType: 'bgm',
    playlist: [{ bgm_delay: 5, duration_sec: 60 }],
  }
  assert.equal(total([step], { tab: 'morning' }), STEP_GAP_MS + 5000)
})

// ─────────────────────────────────────────────────────────────
// 2. 재생 배속 — 실행부가 자르는 범위 안에서만 계산한다
// ─────────────────────────────────────────────────────────────
// stepAudioFile은 `normalizePlaybackRate(opts.rate) || 1`로 속도를 정한다. 3배로 저장돼
// 있어도 실제로는 1.5배로 재생되므로, 추정도 1.5배와 **같은 값**이어야 한다.
// 숫자를 단정하지 않고 "잘린 값으로 계산한 것과 같다"는 관계만 고정한다.
const audioStep = (rate) => ({ id: 'morning_prayer', label: '기도·묵상 시간 음원 (선택)', enabled: true, rate })
const AUDIO_MATERIALS = { tab: 'morning', audioFiles: { morning_prayer: { exists: true, duration: 300 } } }

test('배속이 상한을 넘으면 실행부처럼 잘라서 센다 — 3배는 1.5배와 같은 시간', () => {
  const clamped = normalizePlaybackRate(3)
  assert.equal(clamped, 1.5, '실행부의 클램프 상한이 바뀌면 이 테스트의 전제부터 다시 본다')
  assert.equal(total([audioStep(3)], AUDIO_MATERIALS), total([audioStep(clamped)], AUDIO_MATERIALS))
})

test('배속이 하한보다 낮으면 실행부처럼 잘라서 센다 — 0.2배는 0.5배와 같은 시간', () => {
  const clamped = normalizePlaybackRate(0.2)
  assert.equal(clamped, 0.5, '실행부의 클램프 하한이 바뀌면 이 테스트의 전제부터 다시 본다')
  assert.equal(total([audioStep(0.2)], AUDIO_MATERIALS), total([audioStep(clamped)], AUDIO_MATERIALS))
})

// ─────────────────────────────────────────────────────────────
// 3. enabled가 없는 단계 — 실행부는 건너뛴다
// ─────────────────────────────────────────────────────────────
// 자동방송 5종의 루프는 전부 `if (!step.enabled) continue`다. enabled가 아예 없는 단계는
// 실행부가 건너뛰므로 0초인데, 추정은 `s.enabled !== false`로 걸러서 **세고 있었다**.
// 10분짜리 대기 단계 하나면 화면이 10분을 통째로 지어낸다.
test('enabled가 없는 단계는 실행부와 같이 건너뛴다 — 800ms 간격도 붙지 않는다', () => {
  const step = { id: 'custom_delay_1', label: '대기', customType: 'delay', wait_sec: 600 }  // enabled 없음

  const r = estimateBroadcastDuration([step], { tab: 'morning' })
  assert.deepEqual(r.steps, [], '실행부가 건너뛰는 단계는 목록에도 안 들어온다')
  assert.equal(r.totalMs, 0)
})

test('기본 단계는 enabled 표시가 없어도 센다 — 병합이 항상 채워 주므로 켜진 것이다', () => {
  // mergeStepsWithDefaults는 기본 단계를 `{...def, ...user}`로 합친다. def에 enabled: true가
  // 있으므로 표시 없는 기본 단계는 실행부에 닿을 수 없다. 커스텀 단계와 갈라 보는 이유다.
  const r = estimateBroadcastDuration([{ id: 'bgm' }], { tab: 'morning' })   // enabled 없음
  assert.equal(r.steps.length, 1, '기본 단계까지 지우면 화면이 방송을 통째로 0분으로 적는다')
})

test('enabled가 true인 같은 단계는 그대로 센다 — 3번 수정이 켜진 단계까지 지우면 안 된다', () => {
  const step = { id: 'custom_delay_1', label: '대기', enabled: true, customType: 'delay', wait_sec: 600 }
  assert.equal(total([step], { tab: 'morning' }), STEP_GAP_MS + 600000)
})

// ─────────────────────────────────────────────────────────────
// 4. 빈 문구 — 실행부는 기본 문구를 읽는다 (라우트)
// ─────────────────────────────────────────────────────────────
// broadcastSequencer는 `getSetting(db, 'evening_prayer_tts', 기본값) || 기본값`이라 저장된
// 값이 빈 문자열이면 **기본 문구를 읽는다**. 추정 라우트에는 뒤쪽 `|| 기본값`이 없어서 빈
// 문자열을 그대로 넘겼고, 그만큼 짧게 나왔다.
// 기본 문구의 글자수를 여기 베껴 적지 않는다 — "설정이 아예 없을 때와 같아야 한다"만 고정한다.
const setSetting = (key, value) => getDB()
  .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run(key, value)

async function eveningPrayerTotal() {
  const res = await fetch(app.baseUrl + '/api/settings/broadcast-schedule/estimate')
  assert.equal(res.status, 200)
  const body = await res.json()
  return body.evening_prayer.totalMs
}

test('저녁 마무리 문구를 빈칸으로 저장해도 실행부와 같이 기본 문구 길이로 센다', async () => {
  const withDefaults = await eveningPrayerTotal()   // 설정 행 자체가 없는 상태 = 기본 문구

  for (const key of ['evening_prayer_tts', 'evening_prayer_tts2', 'evening_closing_tts']) {
    setSetting(key, '')
  }

  assert.equal(await eveningPrayerTotal(), withDefaults,
    '빈칸 저장은 "문구 없음"이 아니라 "기본 문구"다 — 실행부가 그렇게 읽는다')
})

// ─────────────────────────────────────────────────────────────
// 5. 빈 문구 — 나머지 8종은 실행부가 **통째로 건너뛴다**
// ─────────────────────────────────────────────────────────────
// 저녁 마무리 3종만 `getSetting(...) || 기본문구`이고, 나머지 안내문 8종에는 그 폴백이 없다.
// 그래서 빈칸으로 저장하면 stepTTS/stepPrayerTTS의 `if (!text?.trim()) return`에 걸려
// **아무 소리도 안 난다**. 추정이 6~8초 하한을 붙이면 나가지도 않을 시간을 세는 것이다.
test('안내 문구가 비면 0초다 — 실행부가 stepTTS에서 그대로 돌아온다', () => {
  const step = { id: 'exercise_tts', label: '체조 안내', enabled: true }
  assert.equal(total([step], { tab: 'exercise', texts: { exercise_tts: '' } }), STEP_GAP_MS)
})

test('공백뿐인 문구도 0초다 — 실행부의 판정이 trim()이다', () => {
  const step = { id: 'exercise_tts', label: '체조 안내', enabled: true }
  assert.equal(total([step], { tab: 'exercise', texts: { exercise_tts: '   \n ' } }), STEP_GAP_MS)
})

test('식사 안내 문구가 비고 녹음도 없으면 0초다 — 하한 8초가 붙으면 안 된다', () => {
  const step = { id: 'breakfast_prayer_tts', label: '아침 식사 안내', enabled: true }
  assert.equal(total([step], { tab: 'morning', texts: { breakfast_prayer_tts: '' } }), STEP_GAP_MS)
})

test('투약 안내 문구가 비면 대기만 남는다 — 대기는 문구와 무관하게 먼저 흐른다', () => {
  const step = { id: 'medication_tts', label: '투약 안내', enabled: true, delay_min: 6, content: '' }
  assert.equal(total([step], { tab: 'morning', texts: { medication_tts: '' } }), STEP_GAP_MS + 6 * 60 * 1000)
})

test('문구가 있으면 종전대로 센다 — 5번 수정이 멀쩡한 안내까지 0으로 만들면 안 된다', () => {
  const step = { id: 'exercise_tts', label: '체조 안내', enabled: true }
  assert.ok(total([step], { tab: 'exercise', texts: { exercise_tts: '가'.repeat(60) } }) > STEP_GAP_MS + 6000)
})

// ─────────────────────────────────────────────────────────────
// 6. 커스텀 음원·영상 재생목록 — 실행부는 흐름 경로를 그대로 부른다
// ─────────────────────────────────────────────────────────────
// runCustomExtraStep은 커스텀 단계를 flowRunner.runStep에 그대로 넘긴다. 그래서 커스텀
// 음원·영상의 규칙은 **흐름 단계와 같아야 한다** — 곡마다 끝까지 기다리고, 길이를 모르면
// 상한 180초(음원·영상 둘 다 audioWaitCapMs를 쓴다), 재생목록이 비면 아무것도 안 한다.
const FILES_4 = { 11: { exists: true, duration: 240 }, 12: { exists: true, duration: 240 },
                  13: { exists: true, duration: 240 }, 14: { exists: true, duration: 240 } }

test('커스텀 음원 재생목록은 곡마다 끝까지 기다린다 — 4곡이면 4배다', () => {
  const one4 = { id: 'custom_audio_1', label: '음원', enabled: true, customType: 'audio', playlist: [11] }
  const all4 = { id: 'custom_audio_1', label: '음원', enabled: true, customType: 'audio', playlist: [11, 12, 13, 14] }

  const single = total([one4], { tab: 'morning', audioFiles: FILES_4 }) - STEP_GAP_MS
  assert.ok(single > 0, '전제: 한 곡짜리는 0이 아니다')
  assert.equal(total([all4], { tab: 'morning', audioFiles: FILES_4 }), STEP_GAP_MS + single * 4)
})

test('재생목록이 빈 커스텀 음원 단계는 0초다 — 갓 추가한 단계가 3분을 지어내면 안 된다', () => {
  // 순서편집기 addCustomStep('audio')가 만드는 그 모양 그대로다(playlist: []).
  const step = { id: 'custom_audio_1', label: '음원 재생', enabled: true, customType: 'audio', playlist: [] }
  assert.equal(total([step], { tab: 'morning' }), STEP_GAP_MS)
})

test('재생목록이 빈 커스텀 영상 단계도 0초다', () => {
  const step = { id: 'custom_video_1', label: '업로드 영상', enabled: true, customType: 'video_file', playlist: [] }
  assert.equal(total([step], { tab: 'morning' }), STEP_GAP_MS)
})

test('커스텀 영상의 상한은 흐름과 같은 180초다 — 자동방송 고정 단계의 480초가 아니다', () => {
  // flowRunner는 video_file도 audioWaitCapMs(상한 180초)로 기다린다. 480초는 자동방송의
  // 고정 영상 단계(stepVideoFile)에만 해당한다 — 그 값을 커스텀에 쓰면 종료 시각이 5분 부푼다.
  const audio = { id: 'custom_audio_1', label: '음원', enabled: true, customType: 'audio', playlist: [21] }
  const video = { id: 'custom_video_1', label: '영상', enabled: true, customType: 'video_file', playlist: [21] }
  const unknown = { 21: { exists: true, duration: 0 } }   // 파일은 있는데 길이를 모른다

  assert.equal(total([video], { tab: 'morning', audioFiles: unknown }),
               total([audio], { tab: 'morning', audioFiles: unknown }))
})

test('커스텀 음원·영상도 배속을 실행부와 같이 자른다', () => {
  const mk = (rate) => ({ id: 'custom_audio_1', label: '음원', enabled: true, customType: 'audio', playlist: [11], rate })
  assert.equal(total([mk(3)], { tab: 'morning', audioFiles: FILES_4 }),
               total([mk(normalizePlaybackRate(3))], { tab: 'morning', audioFiles: FILES_4 }))
})

// 라우트가 재료를 채워 넘기는지 — 도메인만 고치면 화면 숫자는 그대로다.
test('라우트가 커스텀 재생목록의 파일 길이를 넘긴다 — 도메인만 고치면 화면은 안 바뀐다', async () => {
  const { DEFAULT_STEPS } = require('../services/broadcastSequencer')
  const db = getDB()

  const ids = [1, 2].map((n) => {
    const r = db.prepare(
      'INSERT INTO audio_files (category, filename, original_name, duration) VALUES (?, ?, ?, ?)'
    ).run('etc', `parity_${n}.mp3`, `테스트 음원 ${n}`, 240)
    return Number(r.lastInsertRowid)
  })

  // 기본 단계를 전부 꺼서 커스텀 단계 하나만 남긴다 — 총합이 곧 그 단계의 값이 된다.
  const saved = [
    ...DEFAULT_STEPS.morning.map((s, i) => ({ id: s.id, enabled: false, order: i })),
    { id: 'custom_audio_parity', label: '음원 재생', enabled: true, customType: 'audio',
      playlist: ids, order: DEFAULT_STEPS.morning.length },
  ]
  setSetting('morning_steps', JSON.stringify(saved))

  const res = await fetch(app.baseUrl + '/api/settings/broadcast-schedule/estimate')
  assert.equal(res.status, 200)
  const body = await res.json()

  // 240초짜리 2곡 = 각 (240초 + 여유 2초). 상한 180초로 뭉개지면 이 값이 안 나온다.
  assert.equal(body.morning.totalMs, STEP_GAP_MS + 2 * (240 * 1000 + 2000))
  assert.equal(body.morning.confidence, 'fixed', '길이를 아는 파일이므로 상한이 아니다')
})

// ─────────────────────────────────────────────────────────────
// 7. 화면 배선 — 숫자가 맞아도 화면이 옛것을 보여주면 소용없다
// ─────────────────────────────────────────────────────────────
const EDITOR = editorSource()

test('기본값 복원도 "저장 전 값" 표시를 세운다 — updateTab을 안 거치는 유일한 구성 변경이다', () => {
  const handler = EDITOR.slice(EDITOR.indexOf('const handleReset'), EDITOR.indexOf('const handleTrigger'))
  assert.ok(/setEstimateStale\(true\)/.test(handler),
    '단계를 통째로 갈아엎고도 화면이 옛 숫자를 현재 값인 척 보여준다')
})

test('예상시간 요청은 늦게 온 옛 응답이 새 응답을 덮지 않는다', () => {
  const loader = EDITOR.slice(EDITOR.indexOf('const loadEstimate'), EDITOR.indexOf('useEffect(() => { loadEstimate() }'))
  assert.ok(/estimateReqRef/.test(loader),
    '요청 순서 보호가 없다 — 저장을 연달아 누르면 옛 응답이 "저장 전 값" 표시까지 지운다')
})

test('예상시간 계산이 실패하면 사유가 보인다 — 줄이 조용히 사라지면 안 된다', () => {
  const loader = EDITOR.slice(EDITOR.indexOf('const loadEstimate'), EDITOR.indexOf('useEffect(() => { loadEstimate() }'))
  assert.ok(/setEstimateError\(true\)/.test(loader), '실패를 통째로 삼킨다')
  assert.ok(/예상 소요시간을 계산하지 못했습니다/.test(EDITOR), '실패했다는 사실이 화면에 안 적힌다')
})

test('겹침 판정은 테스트가 붙은 모듈을 쓴다 — JSX 안에서 다시 만들지 않는다', () => {
  assert.ok(/findScheduleOverlap/.test(EDITOR), '편집기가 겹침 판정 모듈을 안 쓴다')
  assert.ok(!/est\.end\.time > later/.test(EDITOR), 'JSX 안에 옛 판정이 남아 있다(같은 분 경계를 놓친다)')
})
