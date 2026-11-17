// 커스텀 자동순서 패널 — 정지 버튼과 "꺼져 있음" 안내 (2026-09-03 실기 신고).
//
// 신고 둘:
//  · "지금 방송을 눌렀는데 끌 방법이 없다" — 정지는 쉬운 화면 아래 바에만 있어서,
//    관리자 화면에서 발사한 사람은 화면을 옮겨야 끌 수 있었다. 같은 전체 정지 길
//    (POST /api/morning/stop)을 부르는 버튼을 발사 버튼 옆에 둔다 — 새 정지 경로를
//    만드는 것이 아니다(정지는 하나의 길, 2026-09-02 사용자 결정 그대로).
//  · "자동 방송 토글이 꺼져 있다" — 새 자동순서는 일부러 꺼진 채 만들어지는데
//    (시각을 정하고 켜야 나간다), 그 사실이 화면에 안 적혀 있어 고장으로 보였다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const { editorSource } = require('./helpers/editorSource')

test('커스텀 자동순서 패널에 정지 버튼이 있고, 기존 전체 정지 길을 쓴다', () => {
  const src = editorSource()
  assert.match(src, /stopBroadcast/,
    '편집기가 정지 API를 안 부른다 — 관리자 화면에서 발사한 방송을 그 자리에서 끌 수 없다')
  assert.match(src, /CustomSequencePanel[\s\S]*?정지/,
    '커스텀 자동순서 패널에 정지 버튼이 없다')
})

test('꺼져 있는 자동순서에는 "저절로 나가지 않는다" 안내가 뜬다', () => {
  const src = editorSource()
  assert.match(src, /꺼진 채/,
    '새 자동순서가 꺼진 채 만들어진다는 사실이 패널에 없다 — 꺼진 토글이 고장으로 보인다')
})
