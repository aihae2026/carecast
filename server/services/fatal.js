// 서버가 죽을 때 이유를 남긴다.
//
// 왜 필요했나: 이 서버에는 uncaughtException / unhandledRejection 핸들러가 하나도 없었다.
// 그런데 이 코드베이스에는 프로세스를 죽이는 확인된 경로가 있다 — 자식 프로세스의 'error'
// 이벤트에 리스너가 없으면 EventEmitter 규약대로 그대로 던져진다(2026-08-29 실측).
// 시작 bat이 재시작은 해 주지만, **왜 죽었는지가 어디에도 안 남아** 같은 장애가 반복돼도
// 원인을 못 찾는다. 무인 6개월 운영에서는 이게 치명적이다.
//
// 두 이벤트를 다르게 다루는 이유:
//  · uncaughtException — 프로세스 상태를 더 믿을 수 없다. 기록하고 **비정상 코드로 종료**해서
//    시작 bat이 재시작하게 한다. 억지로 살려 두면 반쯤 망가진 채로 방송 시각을 맞게 된다.
//  · unhandledRejection — 대개 외부 API 호출 하나가 깨진 것이다. 이걸로 방송 서버를 죽이면
//    날씨 조회 실패가 그날 방송 전체를 날리는 결과가 된다. 기록만 하고 계속 간다.
'use strict'

const fs   = require('fs')
const path = require('path')

const DEFAULT_CRASH_LOG = path.join(__dirname, '..', 'crash.log')

function formatFatal(kind, err) {
  const detail = err instanceof Error ? (err.stack || err.message) : String(err)
  return `[${new Date().toISOString()}] ${kind}: ${detail}\n`
}

// 기록에 실패해도 호출부의 흐름(특히 종료)을 막지 않는다.
function writeCrashLog(file, line) {
  try { fs.appendFileSync(file, line, 'utf8'); return true }
  catch { return false }
}

/**
 * 전역 예외 핸들러를 설치한다. server/index.js에서 기동 초반에 한 번 부른다.
 * @param {string}   opts.crashLogPath  기록 파일 (기본 server/crash.log)
 * @param {function} opts.onFatal       종료 직전 훅 — 방송 이력에 남기는 등. 실패해도 무시된다
 * @param {function} opts.exit          테스트 이음새 (기본 process.exit)
 */
function install({ crashLogPath = DEFAULT_CRASH_LOG, onFatal = null, exit = null } = {}) {
  const doExit = exit || ((code) => process.exit(code))

  process.on('uncaughtException', (err) => {
    const line = formatFatal('uncaughtException', err)
    writeCrashLog(crashLogPath, line)
    // console.error는 fileLog가 감싸고 있으면 날짜별 로그에도 남는다
    try { console.error(line.trimEnd()) } catch { /* 콘솔까지 망가진 상황 */ }
    try { if (onFatal) onFatal(err) } catch { /* 기록하려다 또 죽지 않게 */ }
    // 버퍼가 빠져나갈 짧은 여유를 주고 비정상 코드로 끝낸다 — bat이 재시작하도록.
    // unref()를 걸면 안 된다 — 이 타이머가 이벤트 루프를 붙잡지 않으면, 남은 일이 없을 때
    // Node가 타이머가 발화하기 전에 **종료코드 0으로 그냥 끝나 버린다.** 그러면 시작 bat이
    // "정상 종료"로 읽어 재시작을 안 걸 수 있다(테스트로 실제 확인).
    setTimeout(() => doExit(1), 300)
  })

  process.on('unhandledRejection', (reason) => {
    const line = formatFatal('unhandledRejection', reason)
    writeCrashLog(crashLogPath, line)
    try { console.error(line.trimEnd()) } catch { /* 무시 */ }
    // 죽이지 않는다 — 외부 API 하나 깨진 것으로 방송 서버를 내리지 않는다
  })
}

module.exports = { install, formatFatal, writeCrashLog, DEFAULT_CRASH_LOG }
