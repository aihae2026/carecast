// 순서편집기 왼쪽의 "BGM 깔림" 선이 그리는 규칙(src/lib/bgmLane.js).
//
// 이 선은 그림이 아니라 **주장**이다 — "여기부터 여기까지 음악이 깔린다"고 그려 놓으면 사람이
// 그걸 보고 방송 순서를 짠다. 틀리면 안내가 맨목소리로 나가는 걸 아무도 모른 채 넘어간다.
// 그래서 실측한 서버 동작을 여기 박아 둔다(broadcastSequencer.js · flowRunner.js).
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { editorSource } = require('./helpers/editorSource')

const ROOT = path.join(__dirname, '..', '..')
// Node는 CJS에서 ESM을 require할 수 있다(alert-store.test.js와 같은 방식)
const { bgmCoverage, bgmRole } = require(path.join(ROOT, 'src', 'lib', 'bgmLane.js'))

// 화면(MorningEditor.jsx)이 넘기는 것과 같은 표
const TABLES = {
  bgmIds:   new Set(['bgm', 'bgm_start', 'bgm_after', 'bgm_closing', 'bgm_final']),
  videoIds: new Set(['morning_video', 'lunch_video_after', 'dinner_video_after']),
  audioCategory: {
    morning_prayer: 'morning-prayer',
    exercise_video: 'exercise-video',
    lunch_video: 'lunch-video',
    lunch_prayer_audio: 'lunch-prayer',
    dinner_video: 'dinner-video',
    dinner_prayer_audio: 'dinner-prayer',
    evening_prayer_audio: 'dinner-prayer',
    evening_closing_audio: 'dinner-prayer',
  },
}
const cover = (steps) => bgmCoverage(steps, TABLES)

test('BGM은 켜진 단계부터 그 뒤 단계들 밑에 계속 깔린다', () => {
  assert.deepEqual(
    cover([{ id: 'bgm' }, { id: 'exercise_tts' }, { id: 'medication_tts' }]),
    ['start', 'mid', 'mid|end'])
})

// 2026-09-02 고침: 예전엔 여기서 morning_video를 썼는데, 그건 **마무리 뮤트 영상**이라
// 서버가 bgm_stop을 안 쏜다(BGM이 그 밑에 계속 깔린다). 끊는 것은 소리 있는 중간 영상뿐이다.
// 두 갈래의 근거는 server/test/bgm-lane-truth.test.js가 고정한다(td09 H13).
test('소리 있는 중간 영상 단계에서 BGM이 끝난다 — 서버가 페이드아웃시킨다', () => {
  assert.deepEqual(
    cover([{ id: 'bgm' }, { id: 'exercise_tts' }, { id: 'lunch_video' }]),
    ['start', 'mid|end', null])
})

test('업로드 체조 영상도 BGM을 끈다 — 미리듣기 표에 음원처럼 섞여 있지만 영상이다', () => {
  // exercise_video는 AUDIO_STEP_MAP에 들어 있어서 자칫 '음원(잠시 멈춤)'으로 그려진다.
  // 그러면 영상 위로 음악이 계속 깔린 것처럼 보인다.
  assert.equal(bgmRole({ id: 'exercise_video' }, TABLES), 'stop')
  assert.deepEqual(
    cover([{ id: 'bgm' }, { id: 'exercise_tts' }, { id: 'exercise_video' }]),
    ['start', 'mid|end', null])
})

test('음원(녹음) 단계는 잠시 멈춤이다 — 끊긴 것이 아니라 돌아온다', () => {
  assert.deepEqual(
    cover([{ id: 'bgm' }, { id: 'morning_prayer_intro' }, { id: 'morning_prayer' }, { id: 'breakfast_prayer_tts' }]),
    ['start', 'mid', 'paused', 'mid|end'])
})

test('다음 BGM 단계가 앞 구간을 닫고 새로 연다', () => {
  assert.deepEqual(
    cover([{ id: 'bgm' }, { id: 'exercise_tts' }, { id: 'bgm_after' }, { id: 'medication_tts' }]),
    ['start', 'mid|end', 'start', 'mid|end'])
})

test('꺼 둔 BGM 단계는 선을 긋지 않는다', () => {
  assert.deepEqual(cover([{ id: 'bgm', enabled: false }, { id: 'exercise_tts' }]), [null, null])
})

// 2026-09-02 고침: 커스텀 단계는 runCustomExtraStep이 flowRunner.runStep에 그대로 넘긴다 —
// 실행이 흐름의 길이므로 판정도 흐름의 규칙이다. 예전 단언(audio 'pause'·youtube_tv 'stop')은
// 내장 단계의 규칙을 잘못 갖다 붙인 것이었다(td09, 근거는 bgm-lane-truth.test.js).
test('사람이 추가한 커스텀 단계는 흐름의 규칙을 따른다 — 실행이 flowRunner로 간다', () => {
  assert.equal(bgmRole({ id: 'c1', customType: 'bgm' }, TABLES), 'bgm')
  // 커스텀 음원: prayer_play를 restoreBGM:false로 쏘고 복귀가 없다 — 잠시 멈춤이 아니라 끝
  assert.equal(bgmRole({ id: 'c2', customType: 'audio' }, TABLES), 'stop')
  // 커스텀 유튜브TV: tv-start만 쏘고 BGM은 안 끈다 — 음악이 TV 소리와 겹쳐 계속 나간다
  assert.equal(bgmRole({ id: 'c3', customType: 'youtube_tv' }, TABLES), 'other')
  assert.equal(bgmRole({ id: 'c4', customType: 'video_file' }, TABLES), 'stop')
  assert.equal(bgmRole({ id: 'c5', customType: 'tts' }, TABLES), 'other')
  assert.equal(bgmRole({ id: 'c6', customType: 'chime' }, TABLES), 'other')
})

test('실제 아침 방송 구성 — 시작·잠시멈춤·재시작이 모두 나오고 뮤트 영상 밑까지 이어진다', () => {
  const lane = cover([
    { id: 'bgm' }, { id: 'date_weather_schedule' }, { id: 'morning_prayer_intro' },
    { id: 'morning_prayer' }, { id: 'breakfast_prayer_tts' }, { id: 'bgm_after' },
    { id: 'medication_tts' }, { id: 'morning_video' },
  ])
  assert.equal(lane[0], 'start')
  assert.equal(lane[3], 'paused', '기도·묵상 시간 음원 (선택) 칸은 잠시 멈춤')
  assert.equal(lane[5], 'start', 'bgm_after에서 다시 시작')
  assert.equal(lane[6], 'mid',     '투약 안내 밑에 계속 깔린다')
  // 2026-09-02 고침: 마무리 뮤트 영상(morning_video)은 bgm_stop을 안 쏜다 — 음악이 영상
  // 밑에서 계속 난다. 예전 단언(null)은 화면이 하던 거짓말을 그대로 굳히고 있었다(td09 H13).
  assert.equal(lane[7], 'mid|end', '뮤트 영상 밑에도 BGM이 깔린다')
})

// 표는 화면 파일에 그대로 있고 여기서는 사본으로 검사한다 — 사본이 낡으면 규칙이 맞아도
// 선이 틀리므로, 화면이 그 표들을 실제로 넘기고 있는지까지 본다.
test('편집기가 이 규칙에 자기 표를 넘겨서 쓴다', () => {
  const src = editorSource()
  assert.ok(/from '\.\.\/\.\.\/\.\.\/lib\/bgmLane'/.test(src), '편집기가 이 모듈을 안 쓴다')
  assert.ok(/bgmCoverage\(/.test(src), '편집기가 구간 계산을 부르지 않는다')
  for (const t of ['bgmIds', 'videoIds', 'audioCategory']) {
    assert.ok(src.includes(t), `편집기가 ${t}를 안 넘긴다 — 규칙이 표 없이 돌면 전부 'other'가 된다`)
  }
  // 사본이 실제 표와 같은 값을 보고 있는지(대표값 대조)
  assert.ok(src.includes("'exercise-video'"), '미리듣기 카테고리 표가 바뀌었다 — 이 테스트의 사본도 맞춰야 한다')
  assert.ok(src.includes("'bgm_after'"), 'BGM 단계 id 표가 바뀌었다 — 사본도 맞춰야 한다')
})
