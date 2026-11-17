'use strict'
// **간편 화면 오늘 일과의 펼친 단계 = 자동순서 편집기와 같은 색·그림·BGM 선** (사용자 지시 2026-09-17 N19)
//
// *"설마 저렇게 디자인할거야? 색이라도 세번쨰 자동순서편집처럼 넣어줘야지 구분이 가지 음원인지 TTS인지
//   어떻게 구분할거여 bgm은 연결되는지 옆에 … 선으로"*
//
// 지키는 사실: ① 종류 판정은 **한 함수**(`lib/bgmLane.stepKindOf`)다 — 두 화면이 각자 판정하면 같은 단계가
// 다른 색이 된다. ② 서버가 사람이 추가한 단계의 종류(`customType`)를 싣는다 — 안 실으면 오늘 일과에서
// 커스텀 음원·영상이 전부 「기타」 회색이 된다.
const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stepkinds_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const { stepKindOf } = require(path.join(ROOT, 'src', 'lib', 'bgmLane.js'))

test('**종류 판정은 한 함수다** — 편집기와 오늘 일과가 같은 함수·같은 표를 쓴다', () => {
  const 편집기 = 코드만(읽기('src/components/admin/sections/StepList.jsx'))
  const 오늘 = 코드만(읽기('src/components/home/HomeToday.jsx'))
  assert.match(편집기, /stepKindOf\(step, \{ videoIds: VIDEO_STEP_IDS, bgmIds: BGM_STEP_IDS, ttsKeys: TTS_STEP_KEYS, audioMap: AUDIO_STEP_MAP \}\)/,
    '편집기가 공용 판정을 안 쓴다')
  assert.doesNotMatch(편집기, /step\.customType === 'youtube_tv' \? 'video'/, '편집기에 옛 판정 사슬이 남아 있다 — 두 벌이 된다')
  assert.match(오늘, /단계표 = \{ videoIds: VIDEO_STEP_IDS, bgmIds: BGM_STEP_IDS, ttsKeys: TTS_STEP_KEYS, audioMap: AUDIO_STEP_MAP \}/,
    '오늘 일과가 편집기와 다른 표로 판정한다')
  assert.match(오늘, /stepKindOf\(step, 단계표\)/, '오늘 일과가 공용 판정을 안 쓴다')
  // 2026-09-26 정정(Codex 검수 0917A Medium, 사용자 승인): 이 줄은 `bgmCoverage(stepState.steps, 단계표)` 를 글자 그대로
  // 요구했는데, 단계표에는 bgmCoverage 가 보는 `audioCategory` 가 없어 **결함을 고정하고 있었다**(영상 뒤까지 선이 이어짐).
  // 편집기(StepList)처럼 audioCategory 를 함께 주는지를 본다.
  assert.match(오늘, /bgmCoverage\(stepState\.steps, 배경음악표\)/, '오늘 일과가 BGM 선을 편집기와 같은 규칙으로 안 긋는다')
  assert.match(오늘, /const 배경음악표 = \{ \.\.\.단계표, audioCategory: AUDIO_STEP_MAP \}/, 'BGM 선에 편집기와 같은 audioCategory 를 안 준다')
})

test('**판정 순서가 편집기 원래 순서 그대로다** — 사람이 추가한 단계가 먼저, 그다음 내장 표', () => {
  const 표 = { videoIds: new Set(['dinner_video']), bgmIds: new Set(['bgm_start', 'bgm']), ttsKeys: new Set(['dinner_tts']), audioMap: { lunch_prayer_audio: 'lunch-prayer' } }
  assert.equal(stepKindOf({ id: 'bgm_start' }, 표), 'bgm')
  assert.equal(stepKindOf({ id: 'dinner_tts' }, 표), 'tts')
  assert.equal(stepKindOf({ id: 'dinner_video' }, 표), 'video')
  assert.equal(stepKindOf({ id: 'lunch_prayer_audio' }, 표), 'audio')
  assert.equal(stepKindOf({ id: 'date_weather_schedule' }, 표), 'plain')
  assert.equal(stepKindOf({ id: 'x1', customType: 'video_file' }, 표), 'video')
  assert.equal(stepKindOf({ id: 'x2', customType: 'message' }, 표), 'tts')
  // 내장 id 와 겹쳐도 사람이 정한 종류가 이긴다(편집기 원래 동작)
  assert.equal(stepKindOf({ id: 'dinner_tts', customType: 'audio' }, 표), 'audio')
})

test('**서버가 단계 종류(customType)를 싣는다** — 기존 칸은 그대로', async () => {
  const { initDB } = require('../db/schema')
  const { startTestApp } = require('./helpers/testApp')
  initDB()
  const app = await startTestApp({ '/api/morning': require('../routes/morning') })
  try {
    const r = await fetch(`${app.baseUrl}/api/morning/steps/dinner`)
    assert.equal(r.status, 200)
    const { steps } = await r.json()
    assert.ok(steps.length > 3, '저녁 단계가 비었다')
    for (const s of steps) {
      assert.ok('customType' in s, `단계 ${s.id} 에 customType 칸이 없다`)
      for (const k of ['id', 'label', 'enabled', 'index']) assert.ok(k in s, `기존 칸 ${k} 가 사라졌다`)
    }
  } finally {
    await app.close()
    try { require('../db/schema').getDB().close() } catch { /* 이미 닫힘 */ }
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없음 */ } }
  }
})
