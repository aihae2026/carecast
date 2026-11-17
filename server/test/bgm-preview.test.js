// 전체 미리듣기에서 BGM 단계를 무엇으로 들려줄지 정하는 규칙(src/lib/bgmPreview.js).
//
// 2026-09-21: BGM 은 이 PC 의 방송용·식사용 폴더 곡이다(외부 동영상 연동을 걷어냈다). 미리듣기는
// 그 용도 폴더에서 한 곡을 받아 **이 브라우저에서만** 튼다(GET /api/audio/bgm/preview — 서버는 소리를
// 안 낸다). 여기서 고정하는 것은 **어느 폴더인가** 하나다 — 서버 실행부(broadcastSteps.stepBGMStart)와
// 같은 규칙이어야 미리듣기가 실제 방송과 같은 폴더를 들려준다:
//   단계의 bgmRole → 없으면 방송 종류(점심·저녁=식사용, 나머지=방송용 — domain/bgmRoles.js 기본역할).
//   커스텀 BGM 단계는 재생목록 첫 곡의 bgm_type(실행부도 첫 곡부터 튼다).
//
// **미리듣기는 실제 방송과 같은 곡을 보장하지 못한다.** 서버는 방송할 때 그 용도의 차례로 다시 고른다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const { bgmPreviewPlan } = require(path.join(ROOT, 'src', 'lib', 'bgmPreview.js'))
const { 기본역할 } = require(path.join(ROOT, 'server', 'domain', 'bgmRoles.js'))

test('용도를 안 고른 자동방송 BGM 단계는 서버와 같은 기본 폴더를 본다', () => {
  for (const tab of ['morning', 'exercise', 'lunch', 'dinner', 'evening_prayer']) {
    assert.deepEqual(bgmPreviewPlan({ id: 'bgm' }, tab), { kind: 'local', role: 기본역할(tab) },
      `${tab}: 미리듣기와 실제 방송이 다른 폴더를 본다`)
  }
})

test('단계에 용도를 골라 두면 그 폴더다 — 방송 종류보다 앞선다', () => {
  assert.deepEqual(bgmPreviewPlan({ id: 'bgm_start', bgmRole: 'broadcast' }, 'lunch'), { kind: 'local', role: 'broadcast' })
  assert.deepEqual(bgmPreviewPlan({ id: 'bgm', bgmRole: 'meal' }, 'morning'), { kind: 'local', role: 'meal' })
})

test('옛 소스 값(검색어 등)이 남아 있어도 이 PC 음원으로 읽는다 — 서버와 같다', () => {
  assert.equal(bgmPreviewPlan({ id: 'bgm', bgmSource: 'yt_preset', bgmKeyword: '클래식' }, 'morning').kind, 'local')
})

test('커스텀 BGM 단계는 재생목록 첫 곡의 폴더를 쓴다', () => {
  const step = {
    id: 'custom_bgm_1', customType: 'bgm',
    playlist: [{ bgm_type: 'local_meal_seq' }, { bgm_type: 'local_broadcast' }],
  }
  assert.deepEqual(bgmPreviewPlan(step, 'morning'), { kind: 'local', role: 'meal' })
})

test('커스텀 BGM 에 재생목록이 없으면 단일 필드를 본다 — 구버전 저장분 · 옛 값은 방송용', () => {
  assert.equal(bgmPreviewPlan({ id: 'c', customType: 'bgm', bgm_type: 'local_meal' }).role, 'meal')
  assert.equal(bgmPreviewPlan({ id: 'c', customType: 'bgm', bgm_type: 'preset', bgm_value: '옛 방식' }).role, 'broadcast')
})

test('BGM 단계가 아니면 계획이 없다 — 부르는 쪽이 잘못 물어본 것이다', () => {
  assert.equal(bgmPreviewPlan({ id: 'exercise_tts' }), null)
  assert.equal(bgmPreviewPlan(null), null)
})

test('BGM 단계 판별 — 자동방송의 다섯 가지 id와 커스텀 단계를 모두 잡는다', () => {
  const { isBgmStep } = require(path.join(ROOT, 'src', 'lib', 'bgmPreview.js'))
  for (const id of ['bgm', 'bgm_start', 'bgm_after', 'bgm_closing', 'bgm_final']) {
    assert.equal(isBgmStep({ id }), true, `${id}를 놓치면 그 단계에서 음악이 안 깔린다`)
  }
  assert.equal(isBgmStep({ id: 'custom_bgm_1', customType: 'bgm' }), true)
  assert.equal(isBgmStep({ id: 'exercise_tts' }), false)
})

// 미리듣기 곡을 주는 서버 자리는 **소리를 안 낸다** — SSE 를 쏘면 미리듣기가 곧 방송이 된다.
test('미리듣기 곡 주는 자리(GET /bgm/preview)는 SSE 를 쏘지 않고 「차례로」 자리도 안 민다', () => {
  const fs = require('fs')
  const 라우트 = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'audio.js'), 'utf8')
  const i = 라우트.indexOf("router.get('/bgm/preview'")
  assert.ok(i > 0, '미리듣기 곡 자리가 없다')
  const 블 = 라우트.slice(i, 라우트.indexOf('\n})', i))
  assert.ok(!/broadcastSSE/.test(블), '미리듣기 자리가 SSE 를 쏜다 — 홀 스피커로 나간다')
  const 서비스 = fs.readFileSync(path.join(ROOT, 'server', 'services', 'localBgm.js'), 'utf8')
  const j = 서비스.indexOf('function 미리듣기곡(')
  const 본문 = 서비스.slice(j, 서비스.indexOf('\n}', j))
  assert.ok(!/writeSetting/.test(본문), '미리듣기가 「차례로」 자리를 민다 — 다음 방송 순서가 바뀐다')
})
