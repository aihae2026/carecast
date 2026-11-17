// 흐름 단계 묶음(폴더)의 순수 규칙 — src/lib/flowGroups.js.
//
// 왜 서버 테스트에서 화면 쪽 모듈을 부르는가: 이 파일의 moveBlock이 틀리면 **사람이 저장해 둔
// 방송 순서가 조용히 뒤바뀐다.** 화면에서 눈으로만 확인하기엔 위험한데, 이 프로젝트에는
// 프론트 테스트 러너가 없다(무의존 원칙). 순수 함수라 러너를 새로 들이지 않고 node --test로
// 그대로 부를 수 있어서 여기에 뒀다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { blockLength, ownerGroupIndexes, moveBlock } = require('../../src/lib/flowGroups.js')

// 읽기 쉬운 흐름 만들기 — 'G:이름'은 묶음 머리글, 나머지는 일반 단계
const mk = (spec) => spec.map(s => s.startsWith('G:')
  ? { step_type: 'group', label: s.slice(2) }
  : { step_type: 'chime', label: s })

const names = (steps) => steps.map(s => (s.step_type === 'group' ? `G:${s.label}` : s.label))

test('묶음 길이: 머리글부터 다음 머리글 직전까지', () => {
  const steps = mk(['G:동요', 'a', 'b', 'G:체조', 'c'])
  assert.equal(blockLength(steps, 0), 3, '동요 = 머리글 + a + b')
  assert.equal(blockLength(steps, 3), 2, '체조 = 머리글 + c')
  assert.equal(blockLength(steps, 1), 1, '일반 단계는 혼자 움직인다')
})

test('소속 판정: 머리글 뒤 단계는 그 묶음, 묶음 밖은 -1', () => {
  const steps = mk(['첫줄', 'G:동요', 'a', 'G:체조', 'b'])
  assert.deepEqual(ownerGroupIndexes(steps), [-1, -1, 1, -1, 3])
})

test('머리글 뒤가 전부 그 묶음이다 — 다음 머리글이 없으면 끝까지', () => {
  const steps = mk(['G:동요', 'a', 'b', '끝인사'])
  assert.equal(blockLength(steps, 0), 4, '뒤에 다른 묶음이 없으면 끝인사도 동요 묶음 소속이다')
  assert.equal(moveBlock(steps, 0, 3), null, '전체가 한 묶음이면 옮길 자리가 없다')
})

test('묶음을 끌면 안의 단계가 통째로 따라간다 (뒤로)', () => {
  const steps = mk(['G:동요', 'a', 'b', 'G:마무리', '끝인사'])
  const res = moveBlock(steps, 0, 4)   // 동요 묶음을 마무리 묶음 뒤로
  assert.deepEqual(names(res.steps), ['G:마무리', '끝인사', 'G:동요', 'a', 'b'])
  assert.equal(res.index, 2, '옮긴 뒤에도 같은 줄을 계속 끌 수 있어야 한다')
})

test('묶음을 끌면 안의 단계가 통째로 따라간다 (앞으로)', () => {
  const steps = mk(['첫인사', 'G:동요', 'a', 'b'])
  const res = moveBlock(steps, 1, 0)
  assert.deepEqual(names(res.steps), ['G:동요', 'a', 'b', '첫인사'])
  assert.equal(res.index, 0)
})

test('묶음을 자기 자신 안으로는 못 넣는다 — 넣으면 순서가 뒤엉킨다', () => {
  const steps = mk(['G:동요', 'a', 'b'])
  assert.equal(moveBlock(steps, 0, 1), null)
  assert.equal(moveBlock(steps, 0, 2), null)
})

test('일반 단계 이동은 묶음이 없던 시절과 완전히 같다', () => {
  const steps = mk(['a', 'b', 'c'])
  assert.deepEqual(names(moveBlock(steps, 0, 2).steps), ['b', 'c', 'a'])
  assert.deepEqual(names(moveBlock(steps, 2, 0).steps), ['c', 'a', 'b'])
})

test('일반 단계를 묶음 안으로 끌어 넣을 수 있다', () => {
  const steps = mk(['바깥단계', 'G:동요', 'a'])
  const res = moveBlock(steps, 0, 2)
  assert.deepEqual(names(res.steps), ['G:동요', 'a', '바깥단계'],
    '묶음 안으로 들어가야 소속이 바뀐다')
})

test('제자리로 옮기면 아무 일도 일어나지 않는다', () => {
  const steps = mk(['a', 'b'])
  assert.equal(moveBlock(steps, 1, 1), null)
  assert.equal(moveBlock(steps, null, 1), null)
})

// ── 접힌 묶음과의 상호작용 ──────────────────────────────────
// 접힌 묶음의 속살은 화면에 없다. 그 사이에 단계를 떨어뜨리면 단계가 **화면에서 사라진다**
// ("어디 갔지?"가 되는 사고). 접힌 묶음은 한 덩어리로 취급한다.

test('접힌 묶음 머리글로 끌어내리면 묶음 안(숨은 곳)이 아니라 묶음 뒤에 놓인다', () => {
  const steps = [
    { step_type: 'chime', label: 'x' },
    { step_type: 'group', label: '동요', config: { collapsed: true } },
    { step_type: 'chime', label: 'a' },
  ]
  const res = moveBlock(steps, 0, 1)
  assert.deepEqual(names(res.steps), ['G:동요', 'a', 'x'],
    '접힌 묶음 사이에 넣으면 x가 화면에서 사라진다')
})

test('접힌 묶음 머리글로 끌어올리면 묶음 앞에 놓인다 (기존 동작 유지)', () => {
  const steps = [
    { step_type: 'group', label: '동요', config: { collapsed: true } },
    { step_type: 'chime', label: 'a' },
    { step_type: 'chime', label: 'x' },
  ]
  const res = moveBlock(steps, 2, 0)
  assert.deepEqual(names(res.steps), ['x', 'G:동요', 'a'])
})

test('펼친 묶음 머리글로 끌어내리면 묶음 안 첫 자리로 들어간다 — 눈에 보이니 의도된 동작', () => {
  const steps = [
    { step_type: 'chime', label: 'x' },
    { step_type: 'group', label: '동요', config: { collapsed: false } },
    { step_type: 'chime', label: 'a' },
  ]
  const res = moveBlock(steps, 0, 1)
  assert.deepEqual(names(res.steps), ['G:동요', 'x', 'a'])
})
