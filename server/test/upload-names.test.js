'use strict'
// UX-29 — 같은 이름을 두 번 올렸을 때, 그리고 디스크가 꽉 찼을 때.
//
// 둘 다 예전에는 **아무 처리가 없었다**. 같은 이름은 그대로 두 줄이 돼 목록에서 구별이
// 안 됐고(식전 음원 자리처럼 카테고리로 고르는 단계에서는 "먼저 올린 것만 나가는" 상태),
// 디스크가 차면 `ENOSPC: no space left on device, write` 원문이 그대로 화면에 나갔다.

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const { 안겹치는이름, 이름가르기, 번호떼기, 업로드오류문구 } =
  require(path.join(__dirname, '..', 'domain', 'uploadNames'))

test('UX-29: 안 부딪히면 올린 이름 그대로다', () => {
  const r = 안겹치는이름('가을 아침.mp3', ['다른 것.mp3'])
  assert.equal(r.이름, '가을 아침.mp3')
  assert.equal(r.바뀜, false, '안 바꿨는데 바꿨다고 한다')
})

test('UX-29: 같은 이름이면 (2) 를 붙인다 — 막지 않는다', () => {
  const r = 안겹치는이름('가을 아침.mp3', ['가을 아침.mp3'])
  assert.equal(r.이름, '가을 아침 (2).mp3')
  assert.equal(r.바뀜, true)
})

test('UX-29: 여러 번 올려도 번호가 이어진다 — (2) (2) 가 되지 않는다', () => {
  const 있음 = ['노래.mp3', '노래 (2).mp3', '노래 (3).mp3']
  assert.equal(안겹치는이름('노래.mp3', 있음).이름, '노래 (4).mp3')
  // 이미 번호가 붙은 이름을 **다시** 올려도 겹치지 않는다.
  assert.equal(안겹치는이름('노래 (2).mp3', 있음).이름, '노래 (4).mp3')
})

test('UX-29: 확장자를 잃지 않는다 — 한글·공백·점이 여럿인 이름도', () => {
  assert.deepEqual(이름가르기('아침 방송.문안.mp3'), { 몸통: '아침 방송.문안', 확장자: '.mp3' })
  assert.equal(안겹치는이름('아침 방송.문안.mp3', ['아침 방송.문안.mp3']).이름, '아침 방송.문안 (2).mp3')
  // 확장자가 없으면 통째로 몸통이다.
  assert.deepEqual(이름가르기('이름없음'), { 몸통: '이름없음', 확장자: '' })
  assert.equal(안겹치는이름('이름없음', ['이름없음']).이름, '이름없음 (2)')
  // 앞이 비는 `.env` 같은 이름을 확장자로 읽으면 **이름이 사라진다.**
  assert.deepEqual(이름가르기('.gitignore'), { 몸통: '.gitignore', 확장자: '' })
})

test('UX-29: 번호떼기는 진짜 번호만 뗀다', () => {
  assert.equal(번호떼기('노래 (2)'), '노래')
  assert.equal(번호떼기('노래(2)'), '노래')
  assert.equal(번호떼기('2026 (봄)'), '2026 (봄)', '숫자가 아닌 괄호를 떼면 안 된다')
  assert.equal(번호떼기('노래'), '노래')
})

test('UX-29: 저장 공간이 차면 **원문이 아니라 할 일**을 말한다', () => {
  const 안내 = 업로드오류문구({ code: 'ENOSPC' })
  assert.ok(안내, '저장 공간 부족을 못 알아본다')
  assert.match(안내, /저장 공간/)
  assert.match(안내, /지운 뒤 다시/, '다음에 뭘 하면 되는지를 안 말한다')
  assert.doesNotMatch(안내, /ENOSPC|no space left/, '원문을 그대로 내보낸다')
  assert.ok(업로드오류문구({ code: 'EDQUOT' }), '할당량 초과도 같은 뜻이다')
})

test('UX-29: 모르는 오류는 **지어내지 않는다**', () => {
  assert.equal(업로드오류문구({ code: 'EWEIRD' }), null)
  assert.equal(업로드오류문구(null), null)
  assert.equal(업로드오류문구({}), null)
})

test('UX-29: 권한 오류도 사람 말로 바꾼다', () => {
  const 안내 = 업로드오류문구({ code: 'EACCES' })
  assert.match(안내, /권한/)
  assert.doesNotMatch(안내, /EACCES/)
})

// 라우트가 그 규칙을 **실제로 쓰는가** — 규칙만 만들고 안 부르면 아무 일도 안 한다.
test('UX-29: 업로드 라우트가 그 규칙을 부른다', () => {
  const fs = require('node:fs')
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'audio.js'), 'utf8')
  assert.match(SRC, /안겹치는이름\(originalName/, '중복 이름 규칙을 안 부른다')
  assert.match(SRC, /업로드오류문구\(err\)/, '저장 실패 안내를 안 부른다')
  // 바뀐 이름으로 저장하고, 바꿨다는 사실을 응답에 싣는다.
  assert.match(SRC, /정한이름\.이름/, '정한 이름으로 저장하지 않는다')
  assert.match(SRC, /renamedFrom/, '이름을 바꿨다는 사실을 안 알려 준다')
})
