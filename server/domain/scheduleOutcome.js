'use strict'

const { rawSetting, writeSetting } = require('./settingsRead')

// last_fired는 실패 때도 재발사를 막는 처리 날짜다. 성공 근거로 쓰지 않는다.
// 예약별 마지막 자동 실행의 이력 번호만 저장하고 결과는 원본 이력에서 읽는다.
// 차임/흐름은 RUNNING 뒤 결과가 정정되므로 성공값을 복사하면 다시 거짓 완료가 된다.
const keyFor = id => `schedule_${id}_last_broadcast`

function rememberScheduleOutcome(db, scheduleId, date, logId) {
  writeSetting(db, keyFor(scheduleId), JSON.stringify({ date, logId: Number(logId) }), '자동')
}

function readScheduleOutcome(db, scheduleId, date) {
  let ref
  try { ref = JSON.parse(rawSetting(db, keyFor(scheduleId))) } catch { return null }
  if (ref?.date !== date || !Number.isSafeInteger(ref.logId) || ref.logId <= 0) return null
  // 제목·내용으로 추정하면 같은 문구인 환기방송 1차/2차가 서로의 결과를 가져온다.
  const row = db.prepare("SELECT success FROM broadcasts WHERE id = ? AND date = ? AND type = '예약'")
    .get(ref.logId, date)
  return row?.success ?? null
}

module.exports = { rememberScheduleOutcome, readScheduleOutcome }
