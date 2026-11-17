// 숫자 입력 칸의 "010" 문제와, 분홍 선이 카드 밖으로 튀어나오던 것 (2026-09-02)
//
// **왜 이 가드가 있나**
//
// ① 010 — 현장 신고: "선재생 초에 0이 막고 있어서 010이 된다."
//    원인은 React의 number 입력 특성이다. 값이 10인 칸에서 커서를 맨 앞에 두고 0을 치면
//    화면은 "010"이 되고 처리기는 Number("010") = 10을 상태에 넣는다. **상태가 10에서
//    10으로 안 바뀌므로 React는 다시 그릴 것이 없다고 보고 화면의 "010"을 그대로 둔다.**
//    문자열 상태로 바꿔도 "10" → "10"이라 똑같이 막힌다. 그래서 앞자리 0을 지운 값을
//    **DOM에 직접 써 주는** 한 줄이 처방이다. 그 줄이 사라지면 증상이 그대로 돌아온다.
//
// ② 분홍 선 — 선이 카드 아래로 10px(-bottom-2.5) 튀어나가 다음 카드로 이어지려 했는데,
//    카드 사이 간격이 그보다 넓어 **허공에 토막으로 남았다.** 사용자가 "약간씩 튀어나오는 게
//    거슬린다"고 신고. 선은 카드 안에서 시작하고 끝나야 한다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'src')
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

// 초·횟수를 사람이 적는 칸들. 새 칸이 생기면 여기 추가해야 같은 사고가 안 난다.
const 숫자칸_파일 = [
  ['components', 'shared', 'FlowBuilder.jsx'],
  ['components', 'admin', 'sections', 'morningEditorParts.jsx'],
]

test('선재생·대기·재생시간 칸은 NumBox를 쓴다 — 날 것 number 입력으로 되돌아가지 않는다', () => {
  for (const p of 숫자칸_파일) {
    const src = read(...p)
    const rel = p.join('/')
    assert.match(src, /NumBox/, `${rel}가 NumBox를 안 쓴다`)
    // 이 파일들에서 Number(e.target.value)로 직접 받는 숫자 칸이 되살아나면 010이 돌아온다
    assert.doesNotMatch(src, /type="number"[^>]*\n?[^>]*Number\(e\.target\.value\)/,
      `${rel}에 날 것 number 입력이 되살아났다 — 010 문제가 그대로 돌아온다`)
  }
})

test('NumBox는 앞자리 0을 지운 값을 DOM에 직접 써 준다 — 이 한 줄이 010의 처방이다', () => {
  const src = read('components', 'shared', 'NumBox.jsx')
  assert.match(src, /replace\(\/\^0\+\(\?=\\d\)\/, ''\)/,
    '앞자리 0을 지우지 않는다')
  assert.match(src, /e\.target\.value = cleaned/,
    'DOM에 직접 써 주지 않는다 — 숫자로는 같은 값이라 React가 화면을 안 고친다(주석 참고)')
})

test('NumBox는 입력 중에 범위를 자르지 않는다 — 자르면 "8"을 치는 순간 최소값으로 튄다', () => {
  const src = read('components', 'shared', 'NumBox.jsx')
  const onChange = src.slice(src.indexOf('onChange={e => {'), src.indexOf('onBlur='))
  assert.doesNotMatch(onChange, /Math\.(min|max)\(/,
    '입력 중에 범위를 자르고 있다 — 자르는 것은 commit(벗어날 때·Enter)의 몫이다')
  assert.match(src, /onBlur=\{commit\}/, '칸을 벗어날 때 안 자른다')
})

test('BGM 분홍 선은 카드 밖으로 나가지 않는다 — 허공에 토막으로 남는다', () => {
  // 2026-09-03: 순서편집기(StepList)가 자기 사본을 들고 있던 것을 걷고 FlowBuilder의
  // BgmRail 하나를 쓴다 — 원래 "두 화면이 같은 모양이어야 한다"고 주석에 박혀 있었고
  // 실제로 글자까지 같은 사본이었다. 그래서 이 가드도 이제 그 한 곳을 본다.
  const src = read('components', 'shared', 'FlowBuilder.jsx')
  const at = src.indexOf("isStart ? 'top-3 rounded-t-full'")
  assert.ok(at > 0, '전제: 분홍 선의 클래스 계산 자리가 있다(BgmRail)')
  const block = src.slice(at - 200, at + 300)
  assert.doesNotMatch(block, /-bottom-/,
    '선이 카드 아래로 삐져나온다 — 카드 사이 간격이 더 넓어 토막으로 보인다')
  assert.doesNotMatch(block, /-top-/,
    '선이 카드 위로 삐져나온다')

  // 순서편집기가 사본을 되만들지 않았는지도 본다 — 사본이 생기면 두 화면이 또 갈라진다.
  const list = read('components', 'admin', 'sections', 'StepList.jsx')
  assert.doesNotMatch(list, /isStart \? 'top-3 rounded-t-full'/,
    '순서편집기가 분홍 선 사본을 다시 들었다 — BgmRail 하나를 import해서 쓸 것')
  assert.match(list, /BgmRail/, '순서편집기가 공용 BgmRail을 안 쓴다')
})
