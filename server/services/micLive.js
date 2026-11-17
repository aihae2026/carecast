// 마이크 생방송 신호등 — 청크가 오는 동안 모든 화면에 "마이크 방송 중"을 알린다.
//
// 왜(2026-09-03 실기 신고): 즉시 방송의 "● 방송 중"은 방송자 브라우저의 지역 상태였다.
// 폰으로 방송하면 홀에서는 소리가 나는데 PC 화면은 아무 표시가 없었다. 청크를 받는
// 유일한 자리(/api/mic/stream)가 서버이므로 서버가 신호등을 켠다.
//
// 규칙은 둘뿐이다.
//  · 첫 청크 → mic_live {on:true} **한 번만** — 청크는 초당 수십 개라 매번 쏘면 SSE 홍수.
//  · 청크가 HOLD_MS(3초) 끊기면 {on:false} 한 번 — 표시용이라 짧게 잡는다.
//    audioPlayer의 10초 창(stopIfStreaming, 정지 판정)과는 목적이 달라 값도 다르다.
'use strict'

const HOLD_MS = 3000

let _on = false
let _timer = null

function chunkArrived(holdMs = HOLD_MS) {
  const { broadcastSSE } = require('./sse')
  if (!_on) {
    _on = true
    broadcastSSE('mic_live', { on: true })
  }
  clearTimeout(_timer)
  _timer = setTimeout(() => {
    _on = false
    require('./sse').broadcastSSE('mic_live', { on: false })
  }, holdMs)
  _timer.unref?.()   // 이 타이머 때문에 서버 종료가 3초 늦으면 안 된다
}

function isLive() { return _on }

module.exports = { chunkArrived, isLive, HOLD_MS }
