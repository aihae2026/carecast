// 설치 bat이 찍어내는 시작 bat에는 ASCII만 들어간다 (2026-09-04 실측).
//
// **cmd는 배치 파일을 글자가 아니라 바이트 위치로 읽는다.** 파일에 UTF-8 한글이 있으면
// `goto`로 루프에 되돌아올 때 글자 중간에 떨어져 **조각을 명령으로 실행**한다.
// 현장 도스창에 `'  ' is not recognized ...`가 3시간56분 동안 2932번 찍혔고, 주기가
// 4.83초 — 감시 루프 한 바퀴와 같았다. 같은 루프를 조건만 같게 두고 나란히 돌린 실측:
//
//   한글 UTF-8 : 333바퀴 / 오류 1672 / 시작 배너 안 뜸
//   ASCII만    :  78바퀴 / 오류    0 / 정상
//
// CP949로 저장하는 것은 답이 아니다 — 편집기·git·다른 PC에서 깨진다. **ASCII만 쓴다.**
//
// 설치 bat 자신의 안내 문구(한글)는 검사하지 않는다. 그건 위에서 아래로 한 번 흐르고
// 끝나서 되돌아올 자리가 없다. 문제는 **찍어내는 쪽**이다 — 그건 goto로 도는 루프다.
'use strict'

const fs   = require('fs')
const path = require('path')
const test   = require('node:test')
const assert = require('node:assert/strict')

const BAT = path.join(__dirname, '..', '..', 'CareCast-설치.bat')

// `( ... ) > "%START_BAT%"` / `> "%SCHED_BAT%"` 두 블록의 **안쪽**만 떼어 낸다.
// 설치 bat 자신의 echo와 섞이면 안 되므로 줄 접두로 거르지 않고 블록으로 자른다.
function generatedBlocks() {
  const lines = fs.readFileSync(BAT, 'utf8').split(/\r?\n/)
  const blocks = []
  let cur = null
  for (const l of lines) {
    if (l.trim() === '(') { cur = []; continue }
    if (cur && /^\)\s*>\s*"%(START|SCHED)_BAT%"/.test(l.trim())) { blocks.push(cur); cur = null; continue }
    if (cur) cur.push(l)
  }
  return blocks
}

test('찍어내는 시작 bat 두 벌을 모두 찾을 수 있다', () => {
  const blocks = generatedBlocks()
  assert.equal(blocks.length, 2,
    '바탕화면용·작업스케줄러용 두 벌이어야 한다 — 못 찾았으면 설치 bat의 모양이 바뀐 것이니 이 가드를 먼저 고칠 것')
  for (const b of blocks) {
    assert.ok(b.length > 3, '블록이 너무 짧다 — 잘못 잘랐다')
  }
})

test('찍어내는 내용에 ASCII가 아닌 글자가 하나도 없다', () => {
  for (const [i, block] of generatedBlocks().entries()) {
    // 정규식 대신 코드포인트로 본다 — 제어문자 범위를 정규식에 적으면 lint가 막는다
    const bad = block.filter(l => [...l].some(ch => ch.codePointAt(0) > 127))
    assert.equal(bad.length, 0,
      `${i + 1}번째 시작 bat에 ASCII가 아닌 글자가 있다 — cmd가 goto로 되돌아올 때 글자 중간에 `
      + `떨어져 조각을 명령으로 실행한다(현장 실측 2932회/3시간56분). 첫 줄: ${bad[0]}`)
  }
})
