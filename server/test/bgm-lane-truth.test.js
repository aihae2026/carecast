// 화면이 사실대로 말하게 — 순서편집기의 분홍 선(H13)과 마무리 뮤트 영상의 정지(H12).
// (docs/td09-audiobus.md §3-B 규칙 3·4 · §4 H12·H13 · §6 사용자 결정)
//
// 왜 이 가드가 있나 — 둘의 뿌리가 같다: **화면이 실제와 다르게 굴면 사람이 속는다.**
//
//  · H13(그림): 분홍 선은 그림이 아니라 **주장**이다. "여기서 음악이 끊긴다"고 그려 놓으면
//    사람이 그 그림을 보고 방송 순서를 짠다 — 안 끊기는 자리에 'BGM 재시작' 단계를 넣어
//    음악이 두 번 겹치거나, 반대로 끊긴 줄 알고 안내를 옮긴다. 선의 근거는 실측한 서버
//    동작이어야 하고, 서버는 영상을 **둘로 갈라** 다룬다:
//      - 소리 있는 중간 영상(stepVideoFile) → `broadcastSSE('bgm_stop', {})` + 1.5초 대기
//        (server/services/broadcastSteps.js) → 진짜로 끊긴다. 'stop'이 맞다.
//      - 마무리 뮤트 영상(stepVideoAfter: morning_video·lunch_video_after·dinner_video_after)
//        → bgm_stop을 **안 쏜다.** bgm_set_timer로 남은 시간만 맞춘다. 게다가
//        broadcastSequencer.js의 호출 세 곳이 전부 `stepVideoAfter(db, step, null, tok)`라
//        stepBGMStart 가지로도 안 간다 → **BGM이 그 밑에 계속 깔린다.**
//    2026-09-02 전까지 화면은 이 둘을 똑같이 '끊김'으로 그렸다.
//
//  · H12(정지): 그 마무리 뮤트 영상은 화면을 통째로 덮는데 「정지」를 안 들었다. 소리가
//    없다고 방송이 아닌 것이 아니다 — 사람이 정지를 눌러도 전체화면이 그대로 남아 있으면
//    "정지가 안 먹는다"가 된다. 사용자 결정(§6)은 **예외 없이 전부 멎는다**이다.
//    강제종료용 `carecast:morning-video-stop` 리스너가 있었지만 **쏘는 곳이 없는 죽은 길**이라
//    실제로는 아무도 이 영상을 닫지 못했다.
//    그 리스너는 2026-09-02에 지웠다(문서 §5) — 이제 이 영상을 닫는 길은
//    carecast:stop-broadcast 하나뿐이다.
//
// 고정하는 사실 셋:
//  1. bgmRole이 마무리 뮤트 영상을 'stop'으로 보지 않는다 — 서버가 bgm_stop을 안 쏘니까
//  2. 소리 있는 영상(customType video_file, 카테고리 *-video)은 여전히 'stop'이고,
//     커스텀 유튜브TV·커스텀 음원은 흐름의 진실을 따른다 — 실행(runCustomExtraStep)이
//     flowRunner로 가는 길이라서다. TV는 BGM을 안 끊고('other'), 음원은 복귀 없이 끊는다('stop')
//  3. MorningVideoDisplay가 carecast:stop-broadcast를 듣고 **기존 종료 경로**를 탄다
//     (BGM 둘을 끄는 부수효과 포함 — 새 종료를 짜면 그게 빠진다)
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// Node는 CJS에서 ESM을 require할 수 있다(bgm-lane.test.js와 같은 방식)
const { bgmCoverage, bgmRole } = require(path.join(ROOT, 'src', 'lib', 'bgmLane.js'))

// 화면(StepList.jsx)이 넘기는 것과 같은 표 — morningEditorConst.js의 사본
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

// ── 사실 1: 마무리 뮤트 영상 밑에는 BGM이 계속 깔린다 (H13) ──────────────────────
test('마무리 뮤트 영상은 BGM을 끊지 않는다 — 서버가 bgm_stop을 안 쏜다', () => {
  for (const id of ['morning_video', 'lunch_video_after', 'dinner_video_after']) {
    assert.notEqual(bgmRole({ id }, TABLES), 'stop',
      `${id}를 'stop'으로 본다 — 서버(broadcastSteps.js의 stepVideoAfter)는 bgm_stop을 쏘지 않고 `
      + 'bgm_set_timer만 보낸다(broadcastSequencer.js의 호출 세 곳 모두 bgmMealKey=null). '
      + '실제로는 음악이 그 밑에 계속 깔리는데 화면만 "여기서 끊긴다"고 그리게 된다 '
      + '(docs/td09-audiobus.md §3-B 규칙 3, H13).')
  }
})

test('마무리 뮤트 영상 칸까지 분홍 선이 이어진다 — 그 밑에서 음악이 나고 있다', () => {
  assert.deepEqual(
    bgmCoverage([{ id: 'bgm_after' }, { id: 'medication_tts' }, { id: 'morning_video' }], TABLES),
    ['start', 'mid', 'mid|end'],
    '아침 방송 마지막 영상 칸에서 선이 끊겼다 — 실제로는 BGM이 영상 밑에 깔려 있다')

  // 영상 뒤에 안내가 더 붙어도 구간은 끊기지 않는다. 여기가 틀리면 사람이 "음악이 없으니
  // BGM을 다시 켜자"고 재시작 단계를 넣어 **음악이 두 겹으로 난다.**
  assert.deepEqual(
    bgmCoverage([{ id: 'bgm' }, { id: 'lunch_video_after' }, { id: 'lunch_tts' }], TABLES),
    ['start', 'mid', 'mid|end'])
})

// ── 사실 2: 소리 있는 영상은 여전히 BGM을 끊는다 ────────────────────────────────
test('소리 있는 영상은 그대로 BGM을 끊는다 — 서버가 bgm_stop을 쏜다', () => {
  // 커스텀 업로드 영상 — flowRunner의 video_file 갈래가 video_play를 쏘고 VideoPlayer가
  // 재생 시작과 함께 broadcast-bgm-stop을 쏜다
  assert.equal(bgmRole({ id: 'c1', customType: 'video_file' }, TABLES), 'stop')
  // 내장 단계 — stepVideoFile(db, 'exercise-video' | 'lunch-video' | 'dinner-video', …)
  for (const id of ['exercise_video', 'lunch_video', 'dinner_video']) {
    assert.equal(bgmRole({ id }, TABLES), 'stop',
      `${id}가 BGM을 끊는 것으로 안 보인다 — 이 단계들은 stepVideoFile을 타고 bgm_stop을 쏜다. `
      + '이름이 video로 끝나는 카테고리를 영상으로 보는 처리(bgmLane.js)가 사라졌는지 볼 것.')
  }
  assert.deepEqual(
    bgmCoverage([{ id: 'bgm' }, { id: 'exercise_tts' }, { id: 'exercise_video' }], TABLES),
    ['start', 'mid|end', null])
})

// ── 사실 2′: 커스텀 단계의 진실은 흐름이다 — 실행이 flowRunner로 간다 ─────────────
// runCustomExtraStep(broadcastSteps.js)은 커스텀 단계를 flowRunner.runStep에 그대로 넘긴다
// (youtube_tv만 'video'로 이름을 바꿔서). 그래서 자동방송 편집기의 커스텀 단계도 흐름과
// 같은 소리 동작을 하고, 선도 그렇게 그려야 한다. 2026-09-02 전까지는 내장 단계의 규칙
// (audio 'pause'·youtube_tv 'stop')을 잘못 갖다 붙여 두 가지를 거짓으로 그렸다.
test('커스텀 유튜브TV는 BGM을 끊지 않는다 — tv-start만 쏘고 정지 신호가 없다', () => {
  // flowRunner의 video 갈래(:247)는 yt_bgm_command의 tv-start만 쏜다. 받는 쪽은 전체화면
  // TV를 켤 뿐 어떤 BGM 정지 신호도 안 쏜다 — 음악이 TV 소리와 겹쳐 계속 나간다.
  // 'stop'으로 그리면 "여기서 음악이 끊긴다"는 H13과 같은 거짓말이 된다.
  assert.equal(bgmRole({ id: 'c2', customType: 'youtube_tv' }, TABLES), 'other')
  assert.deepEqual(
    bgmCoverage([{ id: 'bgm' }, { id: 'x1', customType: 'youtube_tv' }, { id: 'medication_tts' }], TABLES),
    ['start', 'mid', 'mid|end'],
    '커스텀 유튜브TV 칸에서 선이 끊겼다 — 실제로는 BGM이 TV 소리와 겹쳐 계속 나간다')
})

test('커스텀 음원은 잠시 멈춤이 아니라 끝이다 — restoreBGM:false에 복귀가 없다', () => {
  // flowRunner의 audio 갈래(:215)는 prayer_play를 restoreBGM:false + token으로 쏜다.
  // MusicPlayer는 무조건 broadcast-bgm-stop을 쏘고, hadActiveBGM 조건이 전부 거짓이라
  // 되돌릴 것도 안 챙긴다. 내장 녹음 음원('pause')과 여기가 갈린다.
  assert.equal(bgmRole({ id: 'c3', customType: 'audio' }, TABLES), 'stop')
  assert.deepEqual(
    bgmCoverage([{ id: 'bgm' }, { id: 'x2', customType: 'audio' }, { id: 'medication_tts' }], TABLES),
    ['start|end', null, null],
    '커스텀 음원 뒤로 선이 이어졌다(빗금 포함) — 실제로는 음악이 끊기고 돌아오지 않는다')
})

// ── 사실 3: 뮤트 영상도 「정지」에 닫힌다 (H12, 사용자 결정 §6) ───────────────────
test('마무리 뮤트 영상이 정지 버튼을 듣는다 — 소리가 없어도 화면을 통째로 덮는 방송이다', () => {
  const src = read('src/components/broadcast/MorningVideoDisplay.jsx')

  assert.match(src, /addEventListener\('carecast:stop-broadcast'/,
    'MorningVideoDisplay가 carecast:stop-broadcast를 구독하지 않는다 — 사람이 「정지」를 눌러도 '
    + '전체화면 뮤트 영상이 화면에 그대로 남는다. 강제종료용 carecast:morning-video-stop은 '
    + '쏘는 곳이 없는 죽은 길이라 2026-09-02에 지웠다 — '
    + '이제 이 구독 말고는 영상을 닫는 길이 없다(docs/td09-audiobus.md H12, §6).')
  assert.match(src, /removeEventListener\('carecast:stop-broadcast'/,
    '정지 신호 구독을 안 거둔다 — 화면이 갈릴 때마다 처리기가 쌓인다')

  // **기존 종료 경로(onForceStop)를 그대로 타야 한다.** 새 종료를 짜면 이 파일의 부수효과
  // (함께 틀던 BGM 을 끄는 것)가 빠져서 영상만 사라지고 음악이 남는다.
  assert.match(src, /addEventListener\('carecast:stop-broadcast',\s*onForceStop\)/,
    '정지 신호를 듣기는 하는데 기존 종료 경로(onForceStop)를 안 탄다 — 이 파일의 종료에는 '
    + 'BGM 을 끄는 부수효과가 있고, 길이 둘로 갈리면 한쪽에서만 음악이 남는다.')

  // 그 "기존 종료 길"이 실제로 종료 한 벌을 다 하는지도 함께 본다. 여기가 비면 위 단언이
  // 통과해도 화면이 안 닫힌다.
  const from = src.indexOf('const onForceStop')
  assert.ok(from > 0, 'onForceStop이 없다 — 종료 길 자체가 사라졌다')
  const body = src.slice(from, from + 400)
  assert.match(body, /setData\(null\)/,   'onForceStop이 영상을 안 내린다')
  assert.match(body, /stopBGM\(\)/,       'onForceStop이 BGM 을 안 끈다 — 영상만 닫히고 음악이 남는다')
  // 끄는 신호는 **로컬 BGM** 이다(2026-09-21 — 배경음악은 이 PC 음원뿐이다).
  assert.match(src, /const stopBGM = \(\) => \{[\s\S]{0,120}carecast:broadcast-local-bgm-stop/,
    'stopBGM 이 로컬 BGM 을 안 끈다 — 배경 영상이 닫혀도 음악이 남는다')
  assert.match(body, /exitFs\(\)/,        'onForceStop이 전체화면을 안 푼다')
})
