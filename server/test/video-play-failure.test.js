'use strict'
// UX-40 — **안 나간 것을 안 나갔다고 말한다** (2026-09-11).
//
// 요구: *"출력 장치 사라짐 · 브라우저 재생 제한 · 재생 가능한 창 없음 · 미리듣기 실패 ·
// 자동 저장 실패를 이해할 수 있게 안내한다. **장치 목록이 있다는 사실만으로 재생 성공을
// 표시하지 않는다**"*.
//
// `<video autoPlay>` 에 `onError` 가 **아예 없었다.** 브라우저가 막거나 파일이 깨지면
// **검은 화면만** 뜬다 — 사람은 창을 보고 "나가는 중" 이라고 읽는다. 이 저장소에서
// 가장 비싼 실패는 조용한 무음이고, 그 화면이 정확히 그것을 감추고 있었다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src/components/broadcast/VideoPlayer.jsx'), 'utf8')

test('영상 오류를 듣는다 — 검은 화면만 두지 않는다', () => {
  assert.match(SRC, /onError=\{handleVideoError\}/, '<video> 가 오류를 안 듣는다')
  assert.match(SRC, /const handleVideoError = \(\) =>/, '오류 처리기가 없다')
})

test('숫자가 아니라 사람 말로 적는다 — 네 가지 이유를 가른다', () => {
  const m = /const handleVideoError = \(\) => \{([\s\S]*?)\n {2}\}/.exec(SRC)
  assert.ok(m, '오류 처리기를 못 찾았다 — 이 가드를 옮길 것')
  // `MediaError.code` 1~4 를 다 가른다. 그대로 숫자를 보여주면 아무도 못 고친다.
  for (const code of [1, 2, 3, 4]) {
    assert.match(m[1], new RegExp(`code === ${code}`), `MediaError code ${code} 를 안 가른다`)
  }
  assert.match(m[1], /형식/, '열 수 없는 형식일 때 무엇을 하라는지 안 알려준다')
  // **모르면 모른다고 한다** — 꾸민 이유를 만들지 않는다(UX-35 와 같은 원칙).
  assert.match(m[1], /알 수 없는 이유/, '모르는 코드에 그럴듯한 이유를 지어낸다')
})

test('화면에 실제로 그린다 — 상태만 세우고 안 보여주면 없는 것과 같다', () => {
  assert.match(SRC, /\{playError && \(/, '오류를 화면에 안 그린다')
  assert.match(SRC, /나가지 않았습니다/, '무슨 일이 일어났는지 큰 글씨로 안 말한다')
})

test('새 영상이 시작되면 옛 오류를 지운다', () => {
  const m = /const onPlay = \(e\) => \{([\s\S]*?)teardownWebAudio\(\)/.exec(SRC)
  assert.ok(m, 'onPlay 를 못 찾았다')
  assert.match(m[1], /setPlayError\(''\)/,
    '옛 오류가 남는다 — 멀쩡히 나가는 영상 위에 "나가지 않았습니다" 가 붙는다')
})
