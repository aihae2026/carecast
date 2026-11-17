// 규칙 파서에 넘길 **문맥을 읽는 단일 출처**.
//
// 왜 생겼나(2026-09-06): 자연어 한 문장을 예약으로 바꾸는 길이 둘인데, 문맥을 한쪽만 넘기고
// 있었다. `routes/schedules.js` 의 `/parse-phrase` 는 흐름 이름·일과방송 시각·볼륨 낱말을
// 모두 넘겼고, `services/llmGateway.js` 의 폴백은 **아무것도 안 넘겼다.**
// 그래서 같은 문장이 어느 길로 갔느냐에 따라 결과가 달랐다:
//
//   "아침 방송 흐름 실행해줘"  → 한쪽은 flow 예약, 다른 쪽은 그냥 text 예약
//   "잔잔하게 틀어줘"          → 한쪽은 볼륨 30%, 다른 쪽은 볼륨 없음
//   일과방송과 겹치는 시각      → 한쪽만 경고
//
// **조용한 오독이다.** 예약은 만들어지고, 사람은 승인하고, 그 시각에 다른 것이 나간다.
//
// 파서 자체는 DB 를 모르게 둔다(순수 함수라 테스트가 쉽다) — 그래서 여기서 읽어 주입한다.
// 조회가 실패해도 **문맥 없이라도 파싱은 되어야 한다.** 빈 값으로 넘기고 로그만 남긴다.
'use strict'

const { readEnabledAutoTimes } = require('./autoBroadcasts')
const { readVolumeLevels } = require('./volume')

/**
 * 규칙 파서(`services/schedulePhrase.js`)의 세 번째 인자를 만든다.
 *
 * @param {object} db
 * @returns {{flows: Array, autoTimes: Array, volumeLevels: object}}
 */
function readPhraseContext(db) {
  let flows = []
  try { flows = db.prepare('SELECT id, name FROM flow_sequences ORDER BY id').all() }
  catch (e) { console.error('[문장문맥] 흐름 목록 조회 실패:', e.message) }

  let autoTimes = []
  try { autoTimes = readEnabledAutoTimes(db) }
  catch (e) { console.error('[문장문맥] 일과방송 시각 조회 실패:', e.message) }

  let volumeLevels
  try { volumeLevels = readVolumeLevels(db) }
  catch (e) { console.error('[문장문맥] 볼륨 정성어 조회 실패:', e.message) }

  return { flows, autoTimes, volumeLevels }
}

module.exports = { readPhraseContext }
