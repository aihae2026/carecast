// 서버가 꺼질 때 재생 자식 프로세스를 정리한다 (CC-023).
//
// 왜 필요했나: SIGINT/SIGTERM 핸들러가 하나도 없었다(2026-08-30 grep 실측). audioQueue의
// MCI 재생 자식은 `play cc wait`로 MP3를 끝까지 재생하므로, 서버가 죽어도 몇 분짜리
// 방송이 스피커에서 계속 나온다. 시작 bat은 포트만 보고 새 서버를 띄우므로 옛 소리와
// 새 방송이 겹칠 수 있다. autoUpdate의 process.exit(100) 재시작도 같은 문제였다.
//
// 배선 방식:
//  · 'exit' 훅 — process.exit()로 떠나는 모든 경로(자동업데이트 100, EADDRINUSE, fatal)를
//    한 곳에서 받는다. 'exit'에서는 동기 작업만 가능한데, proc.kill()은 동기라 충분하다.
//  · 신호 핸들러 — 사람이 끄는 경로. Windows에서 실제로 오는 것은 SIGINT(Ctrl+C)와
//    SIGBREAK(Ctrl+Break), SIGHUP(콘솔 창 닫기, 유예 수 초)이고 SIGTERM은 오지 않는다
//    (taskkill /f는 무엇도 못 받는다). SIGTERM은 맥/리눅스 개발 환경용이다.
//    핸들러를 단 순간 Node 기본 종료가 사라지므로 반드시 직접 exit해야 한다.
'use strict'

// 기본 정리 대상. 함수를 여기서 lazy로 당기는 이유: audioPlayer는 require 시점에
// 재생기 예약(setTimeout)이 걸리는 모듈이라, shutdown을 먼저 require해도 부작용이
// 늘지 않게 한다.
function defaultCleanups() {
  return [
    require('./audioQueue').stopAll,   // 재생 중 MCI 자식 + 대기열
    require('./audioPlayer').stop,     // 상주형 파이썬(마이크 스트리밍)
  ]
}

/**
 * 종료 정리 훅을 설치한다. server/index.js에서 기동 초반에 한 번 부른다.
 * @param {function[]} opts.cleanups  정리 함수 목록 (테스트 이음새, 기본 defaultCleanups)
 * @param {function}   opts.log       안내 출력 (테스트 이음새, 기본 console.log)
 */
function install({ cleanups = defaultCleanups(), log = console.log } = {}) {
  let done = false
  const runCleanups = () => {
    if (done) return          // 신호 핸들러가 정리한 뒤 exit 훅이 또 발화하는 경우
    done = true
    for (const fn of cleanups) {
      // 하나가 던져도 나머지 자식을 산 채로 두지 않는다
      try { fn() } catch (e) { try { console.error('[종료] 정리 실패:', e.message) } catch { /* 무시 */ } }
    }
  }

  process.on('exit', runCleanups)

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(sig, () => {
      try { log(`[종료] ${sig} 수신 — 재생 자식 정리 후 종료합니다`) } catch { /* 무시 */ }
      runCleanups()
      process.exit(0)         // 의도된 종료 — 비정상 코드를 낼 이유가 없다
    })
  }
}

module.exports = { install, defaultCleanups }
