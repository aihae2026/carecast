// 전체 미리듣기에서 이 단계를 **무엇으로** 들려줄지 정하는 판정(src/lib/previewKind.js).
//
// 왜 밖으로 뺐나(2026-08-31 사용자 신고 "미리듣기에서 BGM이 안 들린다"):
// 판정이 화면 안 if-else 사슬로만 있었고, 그 사슬이 `canPreview(step, 'audio')`를 물어보고
// 있었다. 그런데 그 함수는 **kind가 'audio'면 무조건 true를 돌려준다** — 단계가 무엇이든
// 상관없이. 그래서 BGM 단계가 음원 분기로 빨려 들어갔고, 그 뒤에 있던 BGM 분기는
// **한 번도 도달하지 못하는 죽은 코드**였다. 화면에는 "이 단계는 미리듣기가 안 됩니다"만 떴다.
//
// 순서가 곧 규칙인 판정은 사슬로 두면 이렇게 조용히 죽는다. 여기서 순서째로 고정한다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const { previewKindOf } = require(path.join(ROOT, 'src', 'lib', 'previewKind.js'))

// 화면(MorningEditor.jsx)이 넘기는 것과 같은 표 — bgm-lane.test.js와 같은 방식
const TABLES = {
  ttsIds: new Set([
    'morning_prayer_intro', 'breakfast_prayer_tts', 'exercise_tts', 'lunch_tts',
    'lunch_prayer_intro', 'lunch_prayer_tts', 'dinner_tts', 'dinner_prayer_tts',
    'evening_prayer_tts', 'evening_prayer_tts2', 'evening_closing_tts', 'medication_tts',
  ]),
  audioCategory: {
    morning_prayer: 'morning-prayer', exercise_video: 'exercise-video',
    lunch_video: 'lunch-video', lunch_prayer_audio: 'lunch-prayer',
    dinner_video: 'dinner-video', dinner_prayer_audio: 'dinner-prayer',
    evening_prayer_audio: 'dinner-prayer', evening_closing_audio: 'evening-prayer',
  },
  ytVideoIds: new Set(['morning_video', 'lunch_video_after', 'dinner_video_after']),
}

const kind = (step) => previewKindOf(step, TABLES)

test('BGM 단계는 bgm이다 — 음원으로 새면 그 단계에서 음악이 영영 안 난다', () => {
  // 이게 이 파일이 생긴 이유다. 자동방송 5종의 BGM id를 하나도 빠뜨리면 안 된다.
  for (const id of ['bgm', 'bgm_start', 'bgm_after', 'bgm_closing', 'bgm_final']) {
    assert.equal(kind({ id }), 'bgm', `${id}가 bgm으로 안 잡힌다`)
  }
  assert.equal(kind({ id: 'custom_bgm_1', customType: 'bgm' }), 'bgm')
})

test('차임벨·대기는 제 이름으로 잡힌다', () => {
  assert.equal(kind({ id: 'c1', customType: 'chime' }), 'chime')
  assert.equal(kind({ id: 'd1', customType: 'delay' }), 'delay')
})

test('안내 문구 단계는 tts다', () => {
  assert.equal(kind({ id: 'exercise_tts' }), 'tts')
  assert.equal(kind({ id: 'x1', customType: 'tts' }), 'tts')
  assert.equal(kind({ id: 'x2', customType: 'message' }), 'tts')
})

test('음원·업로드 영상 단계는 audio다 — 브라우저가 파일을 직접 튼다', () => {
  assert.equal(kind({ id: 'morning_prayer' }), 'audio')
  assert.equal(kind({ id: 'a1', customType: 'audio' }), 'audio')
  assert.equal(kind({ id: 'v1', customType: 'video_file' }), 'audio')
})

test('유튜브 영상·TV는 브라우저에서 못 튼다 — 없음으로 잡고 화면이 그렇게 말한다', () => {
  assert.equal(kind({ id: 'morning_video' }), 'none')
  assert.equal(kind({ id: 't1', customType: 'youtube_tv' }), 'none')
})

test('모르는 단계는 없음이다 — 시간을 지어내거나 엉뚱한 걸 틀면 안 된다', () => {
  assert.equal(kind({ id: 'wait_exercise' }), 'none')
  assert.equal(kind(null), 'none')
})

test('표를 안 넘기면 기본 단계를 못 알아본다 — 화면이 표를 넘기고 있는지 여기서 드러난다', () => {
  // bgmLane과 같은 계약이다. 표 없이도 커스텀 단계는 알아본다(그건 step 자체에 적혀 있다).
  assert.equal(previewKindOf({ id: 'exercise_tts' }, {}), 'none')
  assert.equal(previewKindOf({ id: 'x', customType: 'bgm' }, {}), 'bgm')
})
