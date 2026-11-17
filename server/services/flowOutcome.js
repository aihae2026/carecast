// 방송이 끝난 뒤(또는 서버가 죽은 뒤) 이력 행을 정정한다.
//
// scheduler는 결과를 바로 알 수 없는 발사(흐름 — 기다리면 같은 분의 다른 예약이 밀린다,
// 차임벨 — 재생이 비동기로 끝난다)를 하고 넘어간다. 그래서 이력 행은 일단 발사 시점의
// 값으로 남고, 실제 결과가 나왔을 때 여기 settleLog()가 고친다. 자세한 배경은
// domain/broadcastOutcome.js 주석 참고. UPDATE 문은 여기 한 곳뿐이다(CLAUDE.md 단일 출처).
//
// 규칙 하나: **정산이 새 실패를 만들면 안 된다.** 방송은 이미 나갔거나 안 나갔고, 그걸
// 기록하려다 예외가 나서 서버가 멈추면 본말전도다. 이 파일의 함수는 어떤 경우에도 던지지 않는다.
'use strict'

const { FAILED, SUCCEEDED, RUNNING, outcomeOfFlow } = require('../domain/broadcastOutcome')

/**
 * 이력 행을 다른 값으로 정정한다 — **지금 그 행이 fromValue일 때만** 바꾼다(경합 방지 가드).
 * 흐름과 차임벨 모두 RUNNING → SUCCEEDED/FAILED로 쓴다(ISSUE-002, 2회차 2026-09-06). 1회차는
 * 차임벨만 SUCCEEDED(발사 시점 가정) → FAILED로 내리는 형태였는데, 콜백이 영영 안 오는 경로
 * (서버 강제종료·정전·autoUpdate 재시작)에서 그 행이 성공으로 굳었다 — recoverInterrupted가
 * RUNNING만 회수하기 때문이다. RUNNING으로 되돌리면서 콜백을 안 넘기는 기존 스텁
 * (delivery-truth.test.js 등)도 onDone(true)를 부르도록 같은 커밋에서 함께 고쳤다.
 *
 * @param {object} db
 * @param {number|null} logId
 * @param {number} fromValue  이 값일 때만 정정한다(가드)
 * @param {number} toValue    정정할 값
 * @param {string} [note]     사유. 이력 내용 뒤에 붙는다
 */
function settleLog(db, logId, fromValue, toValue, note = '') {
  if (!logId) return
  try {
    if (note) {
      // 이력만 보고 왜 실패인지 알 수 있어야 한다 — "실패" 두 글자로는 아무도 못 고친다
      db.prepare('UPDATE broadcasts SET success = ?, content = content || ? WHERE id = ? AND success = ?')
        .run(toValue, ` — ${note}`, logId, fromValue)
    } else {
      db.prepare('UPDATE broadcasts SET success = ? WHERE id = ? AND success = ?')
        .run(toValue, logId, fromValue)
    }
  } catch (e) {
    console.error('[방송정산] 이력 정정 실패(방송 자체에는 영향 없음):', e.message)
  }
}

/**
 * 흐름이 끝났을 때 그 이력 행을 성공/실패로 정정한다.
 *
 * @param {object} db
 * @param {number|null} logId  finishScheduleFire가 돌려준 broadcasts 행 id
 * @param {'completed'|'cancelled'|'skipped'|string} result  runFlow의 반환값
 * @param {string} [note]      실패 사유. 이력 내용 뒤에 붙는다
 */
function settleFlowLog(db, logId, result, note = '') {
  settleLog(db, logId, RUNNING, outcomeOfFlow(result), note)
}

/**
 * 기동 시 남아 있는 "진행 중" 행을 실패로 정리한다.
 *
 * 왜 필요한가: 흐름이 도는 도중에, 또는 차임벨 재생 콜백이 오기 전에 서버가 죽으면 그 행을
 * 고쳐 줄 사람이 없다. 그대로 두면 영원히 "진행 중"이라 이력이 거짓말을 한다 — 성공도
 * 실패도 아닌 채 굳는 것은 "성공으로 굳는 것"과 똑같이 나쁘다(ISSUE-002 2회차가 차임벨을
 * 이 회수 대상에 되돌린 이유이기도 하다). 이전 프로세스의 흔적이므로 전부 중단으로 본다.
 *
 * @returns {number} 정리한 행 수
 */
function recoverInterrupted(db) {
  try {
    const rows = db.prepare('SELECT id FROM broadcasts WHERE success = ?').all(RUNNING)
    if (rows.length === 0) return 0
    db.prepare('UPDATE broadcasts SET success = ?, content = content || ? WHERE success = ?')
      .run(FAILED, ' — 서버가 꺼져 중단됨', RUNNING)
    return rows.length
  } catch (e) {
    console.error('[방송정산] 중단된 방송 정리 실패(기동은 계속):', e.message)
    return 0
  }
}

module.exports = { settleLog, settleFlowLog, recoverInterrupted, FAILED, SUCCEEDED, RUNNING }
