'use strict'
// **이 음원·영상을 지금 쓰고 있는 곳** (UX-29, 2026-09-11).
//
// 왜 필요했나: 파일 삭제에 **참조 검사가 아예 없었다**. 예약이 쓰는 음원을 지우면
// 그 시각에 `reportMissingSource` 가 돌고 **홀은 조용하다.** 지우는 사람은 그 사실을
// 모른다 — 목록에서 사라진 것만 보인다. 며칠 뒤 "그 방송 왜 안 나와요" 로 돌아온다.
//
// **막는 것이 맞나**: 이 저장소는 "무음이 가장 비싼 오판" 이라고 여러 번 적었다. 지우는
// 것은 되돌릴 수 없고, 쓰이는 줄 모르고 지우는 것이 바로 그 무음을 만든다. 그래서
// **어디서 쓰는지 말해 주고 막는다.** 사람이 그 예약을 먼저 고치면 그때 지워진다.
//
// 참조처가 셋이고 **모양이 다 다르다** — 컬럼 하나(예약), JSON 배열 안(흐름 단계),
// 설정 문자열 안(자동방송 편집기). 한 곳에서 모아 보지 않으면 반드시 하나를 빠뜨린다.

const { rawSettings } = require('./settingsRead')

// 자동방송 5종의 단계가 사는 설정 키. `domain/broadcastScheduleRead.js` 가 읽는 것과 같다.
const 자동방송단계키 = [
  'morning_steps', 'exercise_steps', 'lunch_steps', 'dinner_steps', 'evening_prayer_steps',
]
const 자동방송이름 = {
  morning_steps: '아침 종합 방송',
  exercise_steps: '국민체조',
  lunch_steps: '점심 식사 전 방송',
  dinner_steps: '저녁 식사 전 방송',
  evening_prayer_steps: '저녁 마무리',
}

/**
 * JSON 어디에 묻혀 있든 이 파일 id 를 쓰는가.
 *
 * **숫자는 「파일 번호가 사는 자리」에서만 센다**(2026-09-21 QA 재현). 예전엔 어디서든 `값 === id`
 * 면 참이라, 단계의 `durationMin: 15` 가 15번 곡을 「쓰는 중」으로 만들어 **지울 수 없었다.**
 * BGM 을 한꺼번에 올리면 번호가 커져 그런 우연이 잦아진다. 번호가 사는 자리는 둘뿐이다 —
 * 이름에 파일 번호가 든 칸(`audio_file_id`·`audioFileId`·`fileId`·`prayerFileId`)과
 * `playlist` 배열의 원소. 흐름의 영상 재생목록은 번호를 **글자**(`["14","13"]`)로 들고 있어서
 * 예전 `===` 는 그것을 못 잡았다 — 여기서는 숫자로 바꿔 비교한다.
 */
const 번호칸 = /(audio_?file_?id|^file_?id$|prayer_?file_?id|bgm_?file_?id)/i
function 안에있나(값, id, 키 = '') {
  if (Array.isArray(값)) {
    if (키 === 'playlist' && 값.some(v => (typeof v === 'number' || typeof v === 'string') && Number(v) === id)) return true
    return 값.some(v => 안에있나(v, id))
  }
  if (값 && typeof 값 === 'object') {
    for (const k of Object.keys(값)) {
      if (번호칸.test(k) && (typeof 값[k] === 'number' || typeof 값[k] === 'string') && Number(값[k]) === id) return true
      // BGM 곡 하나(2026-09-22) — `bgm_type: 'local_a<번호>'`
      if (k === 'bgm_type' && 값[k] === `local_a${id}`) return true
      if (안에있나(값[k], id, k)) return true
    }
  }
  return false
}

const 파싱 = (s) => { try { return JSON.parse(s) } catch { return null } }

/**
 * @returns {string[]} 사람이 읽을 참조처 목록. 비어 있으면 아무도 안 쓴다.
 *
 * **조회가 실패하면 빈 배열을 주지 않는다** — 던진다. "못 물어봤다" 를 "안 쓴다" 로
 * 바꾸면 그게 바로 조용한 삭제다(이 저장소가 여러 번 데인 모양).
 */
function 쓰는곳(db, fileId) {
  const id = Number(fileId)
  const 목록 = []

  // ① 예약 — 컬럼 하나다
  for (const r of db.prepare(
    'SELECT title, scheduled_time FROM schedules WHERE audio_file_id = ? AND active = 1').all(id)) {
    목록.push(`예약 "${r.title}" (${r.scheduled_time})`)
  }

  // ①-2 예약의 배경음악 곡 하나(2026-09-22) — BGM 을 실제로 까는 예약만(폴더 삭제 막기와 같은 조건)
  for (const r of db.prepare(
    "SELECT title, scheduled_time FROM schedules WHERE bgm_type = ? AND active = 1 AND (bgm_enabled = 1 OR broadcast_type = 'bgm')").all(`local_a${id}`)) {
    목록.push(`예약 "${r.title}" (${r.scheduled_time}) 배경음악`)
  }

  // ② 흐름 단계 — config 가 JSON 이고 재생목록이 배열로 들어간다
  for (const r of db.prepare(`
    SELECT s.config AS config, f.name AS name
      FROM flow_sequence_steps s JOIN flow_sequences f ON f.id = s.flow_sequence_id`).all()) {
    if (안에있나(파싱(r.config), id)) 목록.push(`방송 흐름 "${r.name}"`)
  }

  // ③ 자동방송 편집기 — 설정 문자열 안에 단계 배열이 통째로 들어 있다.
  // **`settings` 를 직접 조회하지 않는다** — 읽는 규칙은 `domain/settingsRead` 한 곳이고
  // `settings-read-single-source.test.js` 가 그것을 고정한다(실제로 여기서 걸렸다. 가드가 옳다).
  const 단계값 = rawSettings(db, 자동방송단계키)
  for (const 키 of 자동방송단계키) {
    const v = 단계값.get(키)
    if (v && 안에있나(파싱(v), id)) 목록.push(`자동방송 "${자동방송이름[키]}"`)
  }

  // 같은 흐름이 여러 단계에서 쓰면 한 줄로 줄인다 — 목록이 길어지면 사람이 안 읽는다.
  return [...new Set(목록)]
}

module.exports = { 쓰는곳, 자동방송단계키 }
