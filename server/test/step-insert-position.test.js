// 순서편집기 — 단계를 **넣을 자리를 먼저 정해서** 끼워 넣는다(카드 사이의 ＋).
//
// 왜 필요했나(2026-08-31, 사용자 지적): 위쪽 추가 버튼은 새 단계를 맨 위에 만든다. 그래서
// "영상 뒤에 BGM을 다시 깔기"처럼 흔한 일이 카드를 여섯 칸 끌어내리는 일이 됐다. 저녁 방송의
// 4번(식사 전 안내)이 음악 없이 나가는 것을 고치려면 정확히 그 작업이 필요하다.
// 단계가 많은 탭에서는 번거롭고, 현장 PC가 터치 화면이면 드래그 자체가 잘 안 된다.
//
// 여기서 고정하는 것:
//   1) 추가는 자리를 받는다 — 받지 않으면 예전처럼 맨 위로 간다(위쪽 버튼의 기존 동작 유지)
//   2) 끼워 넣은 뒤 order를 다시 매긴다 — 안 그러면 저장된 순서와 화면 순서가 갈린다
//   3) ＋는 카드 사이 **모든 자리**와 맨 끝에 있다
//   4) ＋는 마우스를 올려야만 보이면 안 된다 — 터치 화면에서는 영영 못 찾는다
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { editorSource } = require('./helpers/editorSource')

const SRC = editorSource()

test('단계 추가가 넣을 자리를 받는다', () => {
  assert.match(SRC, /const addCustomStep = \(customType, atIndex\) =>/,
    '자리를 안 받으면 새 단계가 늘 맨 위에 생겨서 끌어내려야 한다')
  assert.match(SRC, /Number\.isInteger\(atIndex\)/,
    '자리를 안 준 호출(위쪽 추가 버튼)은 예전처럼 맨 위여야 한다')
})

test('끼워 넣은 뒤 순서 번호를 다시 매긴다', () => {
  const i = SRC.indexOf('const addCustomStep =')
  const body = SRC.slice(i, i + 1400)
  assert.match(body, /steps\.slice\(0, at\)/, '자리 앞뒤로 잘라 붙이지 않는다')
  assert.match(body, /order: idx/,
    'order를 다시 안 매기면 저장된 순서와 화면 순서가 갈린다(드래그 정렬과 같은 규칙)')
})

test('＋가 카드 사이 모든 자리와 맨 끝에 있다', () => {
  assert.match(SRC, /const renderInserter = \(at\) =>/, '＋를 그리는 곳이 없다')
  // **카드가 시작하는 자리**에 넣는다(UX-16, 2026-09-11). `i`(= TTS 의 배열 번호)를 쓰면
  // 접힌 BGM 과 TTS **사이**로 끼어들어 새 단계가 그 BGM 을 가져간다(독립 검수 재현 3).
  assert.match(SRC, /\{renderInserter\(시작\)\}/, '카드 앞자리마다 ＋가 없다')
  assert.match(SRC, /\{renderInserter\(steps\.length\)\}/, '맨 끝자리에 ＋가 없다')
})

test('＋를 누르면 그 자리에 넣는다 — 다른 자리가 아니라', () => {
  assert.match(SRC, /addCustomStep\(t\.value, at\)/,
    '종류를 고를 때 열어 둔 자리(at)를 함께 넘겨야 한다')
})

test('＋는 마우스를 올리지 않아도 보인다 — 현장 PC는 터치 화면일 수 있다', () => {
  const i = SRC.indexOf('const renderInserter =')
  const block = SRC.slice(i, SRC.indexOf('const bgmCover', i))
  assert.ok(!/opacity-0/.test(block),
    '＋가 hover에만 나타나면 터치 화면에서는 영영 못 찾는다')
  assert.ok(/group-hover/.test(block) === false,
    '같은 이유로 group-hover에 기대지 않는다')
})
