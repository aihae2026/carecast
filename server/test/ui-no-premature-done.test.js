'use strict'
// **화면은 결과가 오기 전에 「방송 완료」라고 쓰지 않는다** (2026-09-17 브라우저 전수 시험)
//
// 비상 방송·자외선 안내 카드의 「즉시 방송」은 서버가 **스피커 대기열에 넣은 순간** 응답한다 — 소리가 난 뒤가
// 아니다. 격리 시험 서버에서 재생이 거절돼 이력은 실패(success=0)인데 비상 방송 카드는 「방송 완료」였다.
// 서버 로그의 같은 규칙(`chime-log-honesty.test.js`)을 화면에도 건다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

for (const 파일 of ['src/components/admin/sections/EmergencyBroadcast.jsx', 'src/components/easy/UVBroadcastCard.jsx']) {
  test(`${파일} — 응답만 받고 「방송 완료」라고 쓰지 않는다`, () => {
    const src = 코드만(fs.readFileSync(path.join(ROOT, 파일), 'utf8'))
    assert.match(src, /ttsBroadcast|broadcastTTS|apiPost/, '긍정 앵커 — 즉시 방송을 부르는 파일이 맞다')
    assert.doesNotMatch(src, /방송 완료/, '결과가 오기 전에 「방송 완료」라고 쓴다 — 재생이 거절돼도 완료로 보인다')
  })
}
