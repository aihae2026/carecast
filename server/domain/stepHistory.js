// 방송이 어느 단계까지 갔나 (docs/db-retention-design.md 6번, 2026-09-03).
//
// 이력은 방송 1건에 성공/실패 **한 줄**이다. 5분짜리 아침방송이 "차임 → 인사 → 날씨 → 안내 음원
// → BGM" 중 어느 단계에서 멎었는지는 서버 콘솔 로그에만 있었고, 그 로그는 30일 뒤 사라진다.
//
// 그리고 이것이 **prep_ms(0018)의 빈 자리를 메운다** — 준비 시간이 예약 경로에만 남고
// 자동방송에는 안 남았다(오늘 발견한 구멍). 단계마다 걸린 시간이 남으면 "어디서 시간이
// 갔나"를 자동방송에서도 볼 수 있다.
//
// 지키는 것 셋:
//  1) **방송을 막지 않는다.** 기록이 실패해도 던지지 않는다 — 기록하려다 방송이 멎으면
//     본말전도다(alert.js·retention.js와 같은 규칙).
//  2) **로그 이름표와 같은 열쇠**를 쓴다(runContext.currentRunId, 예: '아침-12').
//     이력 행에 붙이지 않는 이유는 그 행이 시퀀스 **끝**에 만들어지기 때문이다.
//  3) 방송 구간 밖(수동 미리듣기 등)에서는 **아무것도 안 남긴다** — 열쇠가 없으면 어느
//     방송의 단계인지 말할 수 없고, 열쇠 없는 행은 나중에 아무도 못 읽는다.
'use strict'

const { currentRunId } = require('../services/runContext')

// 한 방송 안에서 몇 번째 단계인지 세는 자리. 열쇠가 바뀌면 1부터 다시 센다.
const counters = new Map()
// 방송이 끝나도 지워 줄 사람이 없으므로 상한을 둔다 — 무인 6개월 운영에서 Map이 자라면
// 그게 곧 메모리 누수다. 가장 오래된 것부터 버린다(끝난 방송의 번호는 다시 쓸 일이 없다).
const MAX_RUNS = 50

function nextStepNo(runKey) {
  const n = (counters.get(runKey) ?? 0) + 1
  counters.set(runKey, n)
  if (counters.size > MAX_RUNS) counters.delete(counters.keys().next().value)
  return n
}

/**
 * 단계 하나의 결과를 남긴다.
 * @param {object} db
 * @param {string} title  방송 이름('아침 종합 방송')
 * @param {object} step   단계 객체(label·id를 본다)
 * @param {'성공'|'실패'} result
 * @param {number} ms     걸린 밀리초
 * @param {string} detail 실패 사유 등 한 줄
 * @returns {boolean} 남겼는지(테스트·진단용)
 */
function record(db, { title, step, result, ms, detail = null, runKey = null, now = new Date() }) {
  try {
    const key = runKey || currentRunId()
    if (!key) return false                    // 방송 구간 밖 — 남길 자리가 없다
    const label = step?.label || step?.id || '알 수 없는 단계'
    db.prepare(`
      INSERT INTO broadcast_steps (run_key, title, step_no, label, result, ms, detail, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(key, String(title || ''), nextStepNo(key), String(label), String(result),
      Number.isFinite(ms) ? Math.round(ms) : null,
      detail == null ? null : String(detail).slice(0, 300),
      new Date(now.getTime() - (Number.isFinite(ms) ? ms : 0)).toISOString())
    return true
  } catch (e) {
    console.error('[단계기록] 남기기 실패(방송은 계속):', e.message)
    return false
  }
}

// 단계가 왜 실패로 적혔는가 — **문구 정본**(2026-09-10, P-49).
//
// 이 표를 만든 이유: `detail` 은 사람이 읽는 한 줄인데 **판정도 이것으로 한다.**
// 차임 연속 실패를 세는 쪽이 "실패면 차임 고장"으로 읽으면, 사람이 흐름을 정지한 것까지
// 차임 고장으로 세어 없는 장치 고장을 신고한다. 쓰는 곳(flowRunner)과 읽는 곳(chimeFailStreak)이
// **같은 것을 봐야** 한다 — 문구를 양쪽에 따로 적으면 한쪽만 고치는 날 조용히 어긋난다
// (FAILURE_PATTERNS FP-0005 가 그 모양이다).
const 사유문구 = {
  차임고장: '차임벨 재생 실패(보조 신호 — 흐름은 계속 진행)',
  정지: '정지 요청 또는 다른 방송 시작',
  없음: '이 단계에 실행할 것이 없습니다(내용이 비었거나 코드에 없는 단계입니다)',
  알수없음: '단계가 실패를 알렸습니다(소리가 안 났을 수 있습니다)',
  // **모름은 실패가 아니지만 성공도 아니다** (RB-01, 2026-09-11 Codex 소급 검수).
  // 흐름 차임은 결과를 3초까지만 기다린다(`flowRunner.js` 차임 단계 주석 — 콜백을 안 부르는
  // 재생기가 흐름을 영영 멈추게 하면 안 된다). 그 모름이 이력에 그냥 `성공` 으로 적혔고,
  // 연속 실패 카운터가 그것을 "실제로 울렸다" 로 읽어 **연속을 끊었다** —
  // 차임이 계속 죽어 있어도 승격이 영영 안 온다.
  결과모름: '차임 결과를 못 받았습니다(울렸는지 알 수 없음 — 흐름은 계속 진행)',
  // **의도적으로 안 낸 것도 "울렸다" 가 아니다** (RB-01-R2).
  // `chimePlayer` 는 `hardwareDisabled()` 면 프로세스를 안 띄우고 `onDone(true)` 를 부른다.
  // 그 `true` 의 뜻은 *"재생 실패가 아니다"* 이고 그건 맞다 — 그런데 부르는 쪽이 그것을
  // **"울렸다"** 로 읽어 연속 실패를 끊었다. 현장 PC 에 `CARECAST_NO_HARDWARE=1` 이 남는
  // 사고(2026-09)가 나면 **차임이 안 울리는데 경보도 안 온다** — 둘이 겹치면 아무도 모른다.
  안울림: '소리 장치가 꺼져 있어 울리지 않았습니다(드라이런 — 실패는 아님)',
  // **사람이 연결해 둔 폴더·파일이 사라졌다** (2026-09-13, 사용자 조건 3).
  // *"명시적으로 연결한 대상이 사라졌을 때 조용히 기본값으로 떨어지지 마라"* —
  // 여기서 기본값으로 돌아가면 **사람이 고른 것과 다른 소리가 나가는데 아무도 모른다.**
  // 그래서 그 단계는 건너뛰고 **실패로 적는다.** 사람이 화면에서 다시 고르면 낫는다.
  연결끊김: '연결한 폴더·파일이 없습니다(다시 골라 주세요 — 기본값으로 바꾸지 않았습니다)',
}

// 단계 실행기가 돌려주는 **사유 값**의 정본 (P-57, 2026-09-10).
//
// 예전엔 `runCustomExtraStep` 이 이것을 boolean 으로 뭉갰고, 부르는 쪽이 `isCancelled(tok)` 로
// **다시 추측해** 취소를 복원했다. 되짚기라서 틈이 생긴다 — 진짜 차임 고장 직후에 다른 방송이
// 밀어내면 `isCancelled` 가 참이 되어 **그 실패가 기록 없이 사라진다.**
// 그리고 "차임 고장"·"실행할 것 없음"이 글자 그대로 같은 줄로 남았다.
// 사유를 값으로 나르면 추측할 일이 없다.
const 단계사유 = {
  취소: 'cancelled',
  차임고장: 'chime_failed',
  없음: 'nothing_to_play',
  // 결과를 못 받았다. **`undefined` 로 흘려보내면 성공과 구별되지 않는다** — 그래서 값이다.
  모름: 'unknown_result',
  // 하드웨어가 꺼져 있어 **일부러 안 울렸다.** 실패도 아니고 "울렸다" 도 아니다.
  안울림: 'not_played',
  // 연결한 대상이 사라짐. 실패로 적고 **기본값으로 되돌리지 않는다**(사용자 조건 3).
  연결끊김: 'source_missing',
}

/**
 * 단계 실행기가 돌려준 값 → 이력에 무엇을 적을 것인가.
 * `null` 이면 **적지 않는다**(취소는 실패가 아니다).
 * 부르는 쪽이 취소 여부를 다시 추측하지 않게, 판정을 여기 한 곳에 둔다.
 */
function 이력판정(outcome) {
  if (outcome === 단계사유.취소) return null
  if (outcome === 단계사유.차임고장) return { result: '실패', detail: 사유문구.차임고장 }
  if (outcome === 단계사유.없음) return { result: '실패', detail: 사유문구.없음 }
  if (outcome === 단계사유.연결끊김) return { result: '실패', detail: 사유문구.연결끊김 }
  // **모름은 실패로 적지 않는다** — 그 결정은 그대로다(`flowRunner.js` 차임 단계 주석).
  // 대신 사유를 남겨, 연속 실패를 세는 쪽이 이것을 "울렸다" 로 읽지 않게 한다.
  if (outcome === 단계사유.모름) return { result: '성공', detail: 사유문구.결과모름 }
  // 안 울린 것도 같은 대우다 — 실패로 안 적고, 대신 **연속을 끊지 않는다**.
  if (outcome === 단계사유.안울림) return { result: '성공', detail: 사유문구.안울림 }
  // 옛 규약(boolean). 지금은 내는 곳이 없지만, 남은 호출부가 있어도 조용히 성공으로
  // 둔갑하지 않게 받아 둔다. undefined 를 실패로 보면 멀쩡한 방송이 전부 실패로 찍힌다.
  if (outcome === false) return { result: '실패', detail: 사유문구.알수없음 }
  return { result: '성공', detail: null }
}

/**
 * 이 줄이 **차임 장치가 실제로 안 울린 것**인가.
 * 정지·앵커 건너뜀으로 남은 실패는 여기 해당하지 않는다 — 차임을 시도조차 안 했다.
 */
const 차임고장인가 = (row) => row?.result === '실패' && row?.detail === 사유문구.차임고장

/**
 * 이 줄이 **차임이 실제로 울린 것**인가. 연속 실패를 끊는 유일한 근거다.
 *
 * **사유가 붙은 성공은 "울렸다" 가 아니다**(RB-01). `결과모름` 은 `성공` 으로 적히지만
 * 울렸는지 모르는 줄이다. 그것이 연속을 끊으면 차임 장치가 죽어 있어도 승격이 영영 안 온다 —
 * P-49 ②가 *"끊는 것은 실제로 울린 회차뿐"* 이라고 적어 둔 그대로 지키는 것이다.
 * 정상적으로 울린 줄은 `detail` 이 `null` 이다(`이력판정` 의 마지막 줄).
 */
const 차임정상인가 = (row) => row?.result === '성공' && !row?.detail

/** 방송 한 편의 단계들. 화면이 이력 한 줄을 펼칠 때 읽는다(2단계 갈래). */
function stepsOf(db, runKey) {
  return db.prepare('SELECT * FROM broadcast_steps WHERE run_key = ? ORDER BY step_no').all(runKey)
}

/** 최근 방송들의 단계 — 진단용. */
function recent(db, limit = 200) {
  return db.prepare('SELECT * FROM broadcast_steps ORDER BY id DESC LIMIT ?')
    .all(Math.min(Number(limit) || 200, 2000))
}

module.exports = {
  record, stepsOf, recent,
  사유문구, 단계사유, 이력판정, 차임고장인가, 차임정상인가,
  _test: { counters },
}
