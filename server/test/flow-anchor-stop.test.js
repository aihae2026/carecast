// 예약 시각에 앞 소리를 끊는 신호가 안 나가던 것. (전수검수 CC-047)
//
// 무엇이 문제였나: `cutShort`는 **단계가 isCancelled를 불러 줄 때만** 세워졌다.
// 그런데 `cancellableSleep`은 각 조각 **시작**에만 확인한다:
//
//   while (elapsed < ms) {
//     if (isCancelled()) return          ← 여기서만 확인
//     await sleep(Math.min(CHUNK, ms - elapsed))   ← 이 사이에 앵커가 지나면 다시 안 물어본다
//     elapsed += CHUNK
//   }
//
// 마지막 조각 도중에 예약 시각이 지나면 다시 안 물어보고 그냥 끝난다. 그러면 `cutShort`가
// false로 남아 `broadcast_stopped`가 안 나가고, **앞 음원이 계속 흐르는 위로 다음 방송이
// 시작된다** — 현장에서 "겹쳐 들린다"고 신고된 그것이다.
// `flow-integration.test.js`가 간헐 실패로 이 경로를 드러내고 있었다(그 실패는 테스트 문제가
// 아니라 진짜 제품 결함을 가리키고 있었다).
//
// **왜 순수 함수로 뺐나**: 이 판정을 실제 시계로 시험하면 "마지막 조각에 앵커가 걸리도록"
// 타이밍을 맞춰야 하는데, 그런 테스트는 병렬 부하에서 흔들린다 — 이 저장소가 이미 두 번
// 겪은 함정이다(CC-048). 판정만 떼어내면 시계 없이 확정적으로 검증할 수 있다.
'use strict'

// ── **임시 DB 를 제품 모듈보다 먼저 정한다** (2026-09-14 전수 확인) ─────────────────
// 이 파일이 부르는 제품 모듈이 어딘가에서 `getDB()` 를 부른다. 경로를 안 정하면 그 읽기가
// **기본 경로의 DB** 로 간다 — 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를
// 돌리면 운영 DB** 를 연다(없으면 새로 만들기까지 한다). `db/schema.js` 는 로드 시점에
// 경로를 굳히므로 **`require` 보다 위**여야 한다. 이름은 `_` 로 시작한다 — 아래에서 같은
// 모듈을 다시 부르는 파일이 있어 부딪히면 안 된다.
process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_flow_anchor_stop_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')

const { shouldStopBeforeAnchor } = require('../services/flowRunner')

// ── 원래 되던 것 (보존) ──────────────────────────────────────

test('단계가 앵커를 보고 스스로 끊었으면 정지 신호를 보낸다', () => {
  assert.equal(shouldStopBeforeAnchor({ cutShort: true, stepEndedAtMs: 100, anchorAtMs: 500 }), true)
})

test('제 시간에 끝난 단계는 정지 신호를 보내지 않는다 — 계속 흐르라고 만든 BGM이 같이 꺼진다', () => {
  assert.equal(shouldStopBeforeAnchor({ cutShort: false, stepEndedAtMs: 400, anchorAtMs: 500 }), false)
})

// ── 새로 막는 것 ─────────────────────────────────────────────

test('앵커 시각을 넘겨서까지 돌던 단계는 스스로 못 알아챘어도 정지 신호를 보낸다', () => {
  // cancellableSleep의 마지막 조각에서 앵커가 지나간 경우가 정확히 이것이다.
  // 단계는 "끝까지 잘 돌았다"고 생각하지만 소리는 아직 남아 있다.
  assert.equal(shouldStopBeforeAnchor({ cutShort: false, stepEndedAtMs: 501, anchorAtMs: 500 }), true)
})

test('앵커 시각과 정확히 같은 순간에 끝나도 보낸다 — 애매하면 겹치지 않는 쪽으로', () => {
  // 겹쳐 들리는 것과 BGM이 한 곡 일찍 끊기는 것 중에서는 후자가 훨씬 가벼운 사고다.
  assert.equal(shouldStopBeforeAnchor({ cutShort: false, stepEndedAtMs: 500, anchorAtMs: 500 }), true)
})

test('1밀리초 차이도 가른다 — 이 판정이 흔들려서 간헐 실패가 났다', () => {
  assert.equal(shouldStopBeforeAnchor({ cutShort: false, stepEndedAtMs: 499, anchorAtMs: 500 }), false)
  assert.equal(shouldStopBeforeAnchor({ cutShort: false, stepEndedAtMs: 500, anchorAtMs: 500 }), true)
})

// ── 앵커가 없으면 아무 일도 없다 ─────────────────────────────

test('뒤에 예약 시각이 없으면 정지 신호를 보내지 않는다', () => {
  assert.equal(shouldStopBeforeAnchor({ cutShort: false, stepEndedAtMs: 999, anchorAtMs: null }), false)
  assert.equal(shouldStopBeforeAnchor({ cutShort: true,  stepEndedAtMs: 999, anchorAtMs: null }), false)
  assert.equal(shouldStopBeforeAnchor({ cutShort: false, stepEndedAtMs: 999 }), false)
})

// ── runFlow가 이 판정을 실제로 쓰는지 ────────────────────────

test('runFlow가 cutShort만 보고 판단하지 않는다', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  assert.match(src, /shouldStopBeforeAnchor\(/,
    '판정 함수를 만들어 놓고 runFlow가 안 쓰면 고친 게 아니다')
  assert.doesNotMatch(src, /if \(cutShort\) broadcastSSE\('broadcast_stopped'/,
    'cutShort만 보는 옛 판정이 남아 있으면 마지막 조각의 틈이 그대로다')
})
