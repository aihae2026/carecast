// 순서편집기 — 단계 이동에 **버튼 대안**이 있다 (고도화 제안 #26, 2026-09-03).
//
// 왜 필요했나: 단계 이동이 드래그 전용이었다. 마우스를 정확히 끌기 어려운 사람에게 드래그
// 전용 조작은 그 기능이 아예 없는 것과 같고, 현장 PC가 터치 화면이면 누구에게나 그렇다.
// 드래그는 그대로 남긴다 — 되는 사람에게는 그쪽이 빠르다.
//
// 여기서 고정하는 것 다섯:
//   1) 옮기는 규칙이 **한 함수**다 — 드래그와 버튼이 갈리면 저장 순서와 화면 순서가 어긋난다
//   2) 옮긴 뒤 order를 다시 매긴다 (드래그가 지키던 규칙)
//   3) 목록 밖으로 나가지 않는다 — 첫 단계의 '위로', 마지막 단계의 '아래로'는 눌리지 않는다
//   4) 버튼이 카드 펼치기·드래그 시작을 유발하지 않는다
//   5) 버튼이 늘 보인다 — hover로만 나타나면 터치 화면에서는 영영 못 찾는다
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { editorSource } = require('./helpers/editorSource')

const SRC = editorSource()

test('옮기는 규칙이 한 함수다 — 드래그도 그 함수를 쓴다', () => {
  assert.match(SRC, /const moveStep = \(from, to\) =>/, '이동 함수가 없다')
  const i = SRC.indexOf('const onDragOver =')
  const body = SRC.slice(i, i + 400)
  assert.match(body, /moveStep\(dragIdx, i\)/,
    '드래그가 제 손으로 배열을 자르면 버튼과 규칙이 갈린다')
})

test('옮긴 뒤 순서 번호를 다시 매긴다', () => {
  const i = SRC.indexOf('const moveStep =')
  const body = SRC.slice(i, i + 500)
  assert.match(body, /order: idx/,
    'order를 다시 안 매기면 저장된 순서와 화면 순서가 갈린다')
})

test('목록 밖으로 나가지 않는다', () => {
  const i = SRC.indexOf('const moveStep =')
  const body = SRC.slice(i, i + 500)
  assert.match(body, /to < 0 \|\| to >= steps\.length/,
    '범위를 안 막으면 첫 단계를 위로 눌렀을 때 목록이 뒤집힌다')
  // **카드 기준으로 옮겼다**(UX-16, 2026-09-11). BGM 이 TTS 카드 안으로 접히면서
  // 배열 번호와 화면 순서가 어긋났다 — 첫 카드의 배열 번호가 1 이라 `i === 0` 으로는
  // 잠기지 않았고, 눌러도 **화면은 그대로인데 배열만 바뀌었다**(독립 검수 재현 1).
  // 이 검사가 지키려는 뜻은 그대로다: **맨 끝에서는 그 방향 버튼이 눌리지 않는다.**
  assert.match(SRC, /disabled=\{ci === 0\}/, "첫 카드의 '위로'가 눌린다")
  assert.match(SRC, /disabled=\{ci === 카드목록\.length - 1\}/, "마지막 카드의 '아래로'가 눌린다")
})

test('버튼 둘이 있고 각각 한 칸씩 옮긴다', () => {
  // 한 칸 = **한 카드**다. 배열 한 줄이 아니다 — 접힌 BGM 이 있으면 카드가 두 줄이다.
  assert.match(SRC, /moveStep\(i, 카드목록\[ci - 1\]\.index\)/, '위로 옮기는 버튼이 없다')
  assert.match(SRC, /moveStep\(i, 카드목록\[ci \+ 1\]\.index\)/, '아래로 옮기는 버튼이 없다')
  assert.match(SRC, /aria-label="위로 옮기기"/, '이름 없는 아이콘 버튼은 무엇인지 읽히지 않는다')
  assert.match(SRC, /aria-label="아래로 옮기기"/, '이름 없는 아이콘 버튼은 무엇인지 읽히지 않는다')
})

test('버튼이 카드 펼치기·드래그 시작을 유발하지 않는다', () => {
  for (const dir of ['위로 옮기기', '아래로 옮기기']) {
    const i = SRC.indexOf(`title="${dir}"`)
    assert.ok(i > 0, `${dir} 버튼이 없다`)
    // 버튼 한 개 분량만 본다(앞뒤 속성이 다음 버튼과 섞이지 않게)
    const btn = SRC.slice(i - 300, i + 400)
    // **클릭 가드와 드래그 가드를 따로 짚는다.** 그냥 stopPropagation이 있는지만 보면
    // onDragStart 쪽 한 줄이 onClick 쪽 누락을 가려 준다(2026-09-03 뮤테이션에서 실제로 겪음).
    assert.match(btn, /onClick=\{e => \{ e\.stopPropagation\(\); moveStep\(i, 카드목록\[ci [-+] 1\]\.index\) \}\}/,
      '헤더 클릭이 카드를 펼치므로, 막지 않으면 옮길 때마다 카드가 펼쳐진다')
    assert.match(btn, /onDragStart=\{e => e\.stopPropagation\(\)\}/,
      '부모 카드가 draggable이라, 막지 않으면 버튼을 누른 채 움직이면 드래그가 시작된다')
  }
})

test('버튼이 늘 보인다 — 터치 화면에서 hover는 없다', () => {
  const i = SRC.indexOf('title="위로 옮기기"')
  const btn = SRC.slice(i - 400, i + 400)
  assert.doesNotMatch(btn, /opacity-0|invisible|group-hover:opacity/,
    'hover로만 나타나면 터치 화면에서는 영영 못 찾는다')
})
