// 흐름이 스스로 단계를 끊을 때(앵커 절단) 마이크 생방송은 살아남는다 (td09 H10, 2026-09-04 레드팀).
//
// flowRunner는 예약 시각(앵커)에 진행 중인 단계를 끊으면 broadcast_stopped를 쏜다 — 끊긴 단계의
// 소리(BGM·TV·영상)를 정리하려는 신호다. 그런데 화면은 그걸 사람이 누른 정지와 똑같이
// 다뤄서 **마이크 생방송까지 끊고 "현장에서 정지 버튼을 눌러…"라는 거짓 문구를 띄웠다.**
// 사용자 결정(H10): 정지 버튼은 마이크도 끊지만, **자동방송의 진행은 마이크를 안 끊는다.**
//
// 고정하는 사실 넷:
//  1. 앵커 절단의 broadcast_stopped에는 auto:true가 실린다
//  2. 화면은 stop-broadcast에 byUser(= !auto)를 실어 보낸다
//  3. 마이크는 byUser:false를 무시한다 — 나머지 재생기는 표를 안 보고 멎는다(그게 목적이다)
//  4. 사람이 누른 정지(broadcastGate)에는 auto가 없다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

test('앵커 절단의 broadcast_stopped에는 auto:true가 실린다', () => {
  const src = read('server/services/flowRunner.js')
  const at  = src.indexOf("broadcastSSE('broadcast_stopped'")
  assert.ok(at > 0, 'flowRunner의 앵커 절단 신호를 못 찾았다')
  assert.match(src.slice(at, at + 80), /broadcast_stopped',\s*\{\s*auto: true\s*\}/,
    '앵커 절단에 auto 표가 없다 — 화면이 사람의 정지와 구별 못 해 마이크를 끊고 거짓 문구를 띄운다')
})

test('화면은 stop-broadcast에 byUser를 실어 보낸다', () => {
  const src  = read('src/hooks/useScheduledBroadcast.js')
  const from = src.indexOf("if (type === 'broadcast_stopped')")
  const body = src.slice(from, src.indexOf("if (type === 'broadcast_step')", from))
  assert.match(body, /new CustomEvent\('carecast:stop-broadcast', \{ detail: \{ byUser: !data\.auto \} \}\)/,
    '정지 신호에 byUser가 안 실린다 — 마이크가 자동 절단과 사람의 정지를 구별할 길이 없다')
})

test('마이크는 byUser:false(자동)를 무시하고, 사람의 정지에는 멎는다', () => {
  const src  = read('src/components/easy/InstantBroadcast.jsx')
  const from = src.indexOf('const onForceStop')
  assert.ok(from > 0, 'onForceStop을 못 찾았다')
  const body = src.slice(from, from + 500)
  assert.match(body, /if \(e\?\.detail\?\.byUser === false\) return/,
    '마이크가 자동 절단에도 끊긴다 — H10(자동은 마이크를 안 끊는다) 위반 + 거짓 "정지 버튼" 문구')
  assert.match(body, /stopBroadcast\(\)/, '사람의 정지에 마이크를 안 내린다 — H10의 앞 절반이 사라졌다')
  // 가드가 `=== false`여야 한다 — detail 없는 옛 emitter(정지 버튼들)는 그대로 멎어야 하니까
  assert.doesNotMatch(body, /if \(!e\?\.detail\?\.byUser\) return/,
    '가드가 "byUser가 없으면 무시"다 — 정지 버튼(detail 없음)이 마이크를 못 끊게 된다')
})

test('사람이 누른 정지(broadcastGate)에는 auto가 없다', () => {
  const src = read('server/services/broadcastGate.js')
  const at  = src.indexOf("broadcastSSE('broadcast_stopped'")
  assert.ok(at > 0)
  assert.doesNotMatch(src.slice(at, at + 80), /auto/, '사람의 정지에 auto가 붙었다 — 정지를 눌러도 마이크가 안 끊긴다')
})
