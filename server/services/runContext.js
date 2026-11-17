// 방송 하나가 나가는 동안 남는 로그에 같은 이름표를 붙인다(CC-035).
//
// 무엇이 문제였나: 방송 하나에 스케줄러·시퀀서·흐름러너·TTS·오디오큐가 제각기 로그를 남기는데,
// 매분 tick이 여러 예약을 동시에 발동시키면 줄이 뒤섞여 **어느 방송의 이야기인지 알 수 없었다.**
// "07:50에 소리가 안 났다"는 신고를 받고 로그를 열면 그 시각 줄이 수십 개인데 갈래를 못 나눈다.
//
// 왜 이 방식인가: 원 리뷰는 JSON 라인 로거를 새로 들이자고 했지만 그러면 fileLog와 **두 벌**이
// 된다(어느 쪽을 봐야 하는지가 다시 문제가 된다). 대신 실행 구간에 이름표를 달고 fileLog가
// 그것을 싣는다 — 호출부 87곳을 한 줄도 안 고친다.
//
// AsyncLocalStorage를 쓰는 이유: 방송 실행은 await로 수십 번 끊긴다. 전역 변수로 하면 그 사이
// 다른 방송이 시작되는 순간 이름표가 뒤바뀐다.
'use strict'

const { AsyncLocalStorage } = require('node:async_hooks')

const storage = new AsyncLocalStorage()
let seq = 0

/**
 * 방송 실행 구간 하나를 연다. 이 안에서 남는 모든 로그에 같은 이름표가 붙는다.
 *
 * 이미 구간 안이면 **새로 열지 않고 그대로 잇는다** — 스케줄러가 연 구간 안에서 흐름러너가
 * 또 열면, 같은 방송의 뒷부분이 다른 방송처럼 보이기 때문이다.
 *
 * @param {string} label 방송 갈래('아침'·'예약'·'흐름' 등). 이름표에 그대로 들어간다.
 * @param {Function} fn  실행할 함수. 반환값·예외는 그대로 통과한다.
 */
function withRun(label, fn) {
  const existing = storage.getStore()
  if (existing) return fn()
  seq = (seq + 1) % 100000
  return storage.run({ id: `${label}-${seq}` }, fn)
}

/** 지금 어느 방송 구간 안인가. 구간 밖이면 null. */
function currentRunId() {
  return storage.getStore()?.id ?? null
}

module.exports = { withRun, currentRunId }
