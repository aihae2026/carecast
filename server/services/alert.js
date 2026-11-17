// 실패를 사람에게 알리는 유일한 통로.
//
// 왜 이 파일이 있나: 이 시스템의 가장 큰 구멍은 기능 결함이 아니라 **실패가 아무에게도
// 전달되지 않는 것**이었다. 방송이 안 나가도 console.error 한 줄로 끝나는데, 그 콘솔은
// cmd 창이 닫히면 사라지고 요양원 직원은 애초에 그 창을 보지 않는다. broadcasts 테이블에
// 남겨도 관리자 화면 '방송 이력' 메뉴를 열어야만 보인다.
//
// 그래서 실패 하나를 세 곳에 동시에 남긴다.
//   DB(broadcasts, success=0) — 나중에 "그날 무슨 일이 있었나"를 추적할 근거
//   SSE(system_alert)         — 지금 켜져 있는 화면이 즉시 아는 경로
//   console.error             — 로그 파일(fileLog.js)에 남는 원문
//
// 규칙: 실패 처리는 절대 새 실패를 만들면 안 된다. 경보를 남기려다 예외가 나서 방송이
// 멈추면 본말전도다. 이 함수는 어떤 경우에도 던지지 않는다.
'use strict'

const { todayStr, nowHHMM } = require('./repeatSchedule')

// broadcasts.content가 이력 화면에 그대로 뜨므로 한 줄 길이로 자른다
const MAX_MESSAGE = 300


/**
 * 실패 하나를 DB·화면·로그에 동시에 남긴다.
 * @param {string} kind    어디서 난 실패인지 ('아침방송', '자동업데이트', '식전 안내' 등)
 * @param {string} message 사람이 읽을 한 줄
 * @param {object} detail  화면이 쓸 추가 정보(scheduleId 등). SSE에만 실린다
 * @param {object} db      테스트 이음새. 기본값은 운영 DB
 * @param {object} opts    `{ 이미기록됨: true }` 면 DB 행을 안 남긴다 — 아래 규칙을 읽을 것
 */
function raise(kind, message, detail = {}, db = null, opts = {}) {
  const msg = String(message ?? '').slice(0, MAX_MESSAGE)
  const at  = new Date().toISOString()

  // 1) DB — 실패해도 아래 두 경로는 계속 간다
  //
  // **`이미기록됨` 은 아껴 쓴다**(P-28, 2026-09-10). 이 함수가 DB 에 남기는 이유는
  // "그날 무슨 일이 있었나"의 근거를 남기기 위해서다. 그 근거가 **이미 이력에 있는 것을
  // 읽어서 확인한 경우에만** 생략한다 — 추측으로 생략하면 유일한 흔적이 사라진다.
  // 지금 쓰는 곳은 감시(watchdog)의 밀림 알림 한 곳뿐이다: 그쪽은 `broadcasts` 표를
  // 직접 조회해 밀림 행이 있는 것을 확인한 뒤에만 이 값을 넘긴다.
  // 화면·로그는 **언제나 그대로 나간다** — 알리는 것을 생략하는 옵션이 아니다.
  if (!opts.이미기록됨) {
    try {
      const conn = db || require('../db/schema').getDB()
      conn.prepare(
        'INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, 0)'
      ).run(todayStr(), nowHHMM(), '경보', `[${kind}] ${msg}`, '자동', '-')
    } catch (e) {
      console.error('[경보] 이력 기록 실패(경보 자체는 계속 전달함):', e.message)
    }
  }

  // 2) 화면 — 지금 보고 있는 사람이 알아야 한다
  try {
    require('./sse').broadcastSSE('system_alert', { kind, message: msg, at, ...detail })
  } catch (e) {
    console.error('[경보] 화면 알림 실패:', e.message)
  }

  // 3) 로그 — fileLog.js가 파일로 남긴다
  console.error(`[경보:${kind}] ${msg}`)
}

module.exports = { raise, MAX_MESSAGE }
