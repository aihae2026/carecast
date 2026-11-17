// 자연어 한 문장 → 방송 예약 초안.
//
//   "매일 오후 3시에 산책 안내 방송 넣어줘"
//     → { scheduled_time: '15:00', repeat_weekdays: [0..6], content: '산책 안내', ... }
//
// 규칙 기반으로 만든 이유: 요양원 방송 예약은 표현이 사실상 정형화돼 있고("매일/평일/월수금",
// "오전·오후 N시"), 무엇보다 AI 키 없이 동작하고 테스트로 전부 검증할 수 있다.
// 나중에 키가 확인되면 규칙이 실패한 문장에 한해 LLM을 덧붙이는 자리도 여기가 된다.
//
// 원칙: **못 읽은 건 조용히 추측하지 않는다.** 시간의 오전/오후가 불분명하면 임의로 정하지 말고
// ambiguous에 담아 화면에서 사람이 확인하게 한다. 잘못 읽으면 엉뚱한 시각에 방송이 나가므로,
// 파싱 결과는 곧바로 저장하지 않고 예약 추가 모달을 채운 채 열어 확인을 받는다.
'use strict'

const { detectBroadcastType, detectFlow, detectVolume, ACTION_CUES, isImmediateRequest, FLOW_ONLY_CUES, FLOW_ONLY_CUES_ALL } = require('../domain/ontology')

const ALL_DAYS  = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS  = [1, 2, 3, 4, 5]
const WEEKEND   = [0, 6]
const DAY_INDEX = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 }

// **시각을 못 읽었을 때의 기본값** — 09:00 을 박아 두지 않는다 (사용자 지시 2026-09-13).
//
// *"설정할 때 09:00 픽스해놓는 게 아니라 지금 설정하는 시간대 갖고 와서 해야지"*
// 말로 예약을 만드는 사람은 대개 «조금 뒤» 를 생각하고 있다. 09:00 이 박혀 있으면
// 오후에 적은 예약이 **이미 지난 시각**이 되고, 1회성이면 그날 영영 안 나간다.
//
// 다음 5분 자리로 올린다 — 초 단위의 지금을 넣으면 사람이 확인 카드를 읽는 사이에
// 그 시각이 지나간다. 화면(`lib/scheduleUtils.js` 의 `다음자리시각`)과 **같은 규칙**이다.
function 기본시각(now = new Date()) {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + (5 - (d.getMinutes() % 5 || 5)) + (d.getMinutes() % 5 === 0 ? 5 : 0))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 고유어 숫자 시각("오후 세시") — 숫자 표기("오후 3시")만큼 흔하게 쓰이는데 못 읽고 있었다
// (2026-08-27 사용자 실사용 중 발견: "내일 오후 세시 산책"이 시간을 못 읽음).
// 길이가 긴 것부터 매칭해야 "열두"가 "열"에 먼저 먹히지 않는다.
const NATIVE_HOUR = { 열두: 12, 열한: 11, 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }
const NATIVE_HOUR_PATTERN = Object.keys(NATIVE_HOUR).sort((a, b) => b.length - a.length).join('|')

// 고유어 날짜 수("이틀 뒤") — 숫자 표기("3일 후")와 함께 지원한다
const NATIVE_DAY_COUNT = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7 }

function pad(n) { return String(n).padStart(2, '0') }

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── 시간 ──────────────────────────────────────────────────────
// 반환: { time, ambiguous } — 못 읽으면 time = null
function parseTime(text) {
  // 자정/정오는 그 자체로 시각이 확정적이다("정오 12시"처럼 뒤에 숫자가 더 붙어도 무해함) —
  // 2026-08-27 실사용 중 "정오 12시"가 오전/오후 불명확으로 잘못 표시되던 것을 고침.
  if (/자정/.test(text)) return { time: '00:00', ambiguous: null, matched: '자정' }
  if (/정오/.test(text)) return { time: '12:00', ambiguous: null, matched: '정오' }

  // HH:MM (24시간제로 그대로 사용)
  const colon = text.match(/(\d{1,2})\s*:\s*(\d{2})/)
  if (colon) {
    const h = Number(colon[1]), m = Number(colon[2])
    if (h <= 23 && m <= 59) return { time: `${pad(h)}:${pad(m)}`, ambiguous: null, matched: colon[0] }
  }

  // (오전|오후)? N시 (M분 | 반)? — 숫자(3시)와 고유어(세시) 둘 다 인식
  const m = text.match(new RegExp(`(오전|오후|아침|저녁|밤|낮|새벽)?\\s*(\\d{1,2}|${NATIVE_HOUR_PATTERN})\\s*시\\s*(?:(\\d{1,2})\\s*분|(반))?`))
  if (!m) return { time: null, ambiguous: 'time_missing', matched: null }

  const meridiem = m[1] || null
  let hour = /^\d+$/.test(m[2]) ? Number(m[2]) : NATIVE_HOUR[m[2]]
  const minute = m[4] ? 30 : (m[3] ? Number(m[3]) : 0)
  if (hour > 23 || minute > 59) return { time: null, ambiguous: 'time_missing', matched: null }

  let ambiguous = null
  const isPm = meridiem === '오후' || meridiem === '저녁' || meridiem === '밤'
  const isAm = meridiem === '오전' || meridiem === '아침' || meridiem === '새벽'

  if (isPm) {
    if (hour < 12) hour += 12          // 오후 3시 → 15시 (오후 12시는 그대로 정오)
  } else if (isAm) {
    if (hour === 12) hour = 0          // 오전 12시 → 자정
  } else if (hour >= 13) {
    // 15시처럼 이미 24시간제 — 모호하지 않다
  } else {
    // 오전/오후 없이 1~12시 → 어느 쪽인지 알 수 없다. 임의로 정하지 않고 알린다.
    ambiguous = 'time_meridiem'
  }

  return { time: `${pad(hour)}:${pad(minute)}`, ambiguous, matched: m[0] }
}

// 이 문장이 "반복"을 말하고 있는가. **AI 초안 경로(routes/scheduleDrafts.js)도 이것을 쓴다.**
//
// 왜 한 곳에 두나(2026-08-29 리뷰): 예전엔 AI 경로가 /매일|매주|매달|마다|평일|주말/ 이라는
// 자기 목록을 따로 갖고 있어서, 이 파서가 반복으로 읽는 요일 나열("월수금", "월요일과
// 수요일")을 반복으로 인식하지 못했다. 그러면 AI 경로가 **아무 경고 없이 1회성 예약만**
// 만들고, 사람은 매주 나갈 거라 믿는다. 조용한 오해라 현장에서 알아채기 어렵다.
//
// 아래 세 갈래는 parseRepeat이 실제로 반복으로 판정하는 표현과 같은 것을 본다:
//  1) 명시적 반복어      매일·매주·매달·마다·평일·주말·격주
//  2) 요일 지목          "월요일" (앞의 '다음주'는 1회성이라 parseRepeat이 따로 처리한다)
//  3) 요일 축약 덩어리    "월수금" — 앞뒤가 한글이 아닌 요일 글자 2~7개
const REPEAT_PHRASE = /(매일|매주|매달|마다|평일|주말|격주)|([일월화수목금토]요일)|((?<![가-힣])[일월화수목금토]{2,7}(?![가-힣]))/

function mentionsRepeat(text) {
  return REPEAT_PHRASE.test(String(text || ''))
}

// ── 반복 요일 ─────────────────────────────────────────────────
// 반환: { weekdays, oneTimeOffset, explicitDate, matched, ambiguous }
// oneTimeOffset은 오늘=0 / 내일=1, explicitDate는 'YYYY-MM-DD'(연도 없이 월일만 말한 경우),
// 둘 다 null이면 반복 표현.
function parseRepeat(text, now) {
  // "8월 30일"처럼 명시적 날짜를 말하면 그게 가장 확실하므로 다른 표현보다 먼저 확인한다
  // (2026-08-27 실사용 발견: 이 경우 통째로 못 읽고 "매일, 오늘부터"로 잘못 저장되고 있었음 —
  // 안내문 자체가 하루짜리인데 매일 나가는 건 위험한 오독이라 최우선으로 고쳤다).
  const explicit = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (explicit) {
    const month = Number(explicit[1]), day = Number(explicit[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = now.getFullYear()
      // 이미 지난 날짜면 내년으로("1월 5일"을 12월에 말한 경우 등)
      const candidate = new Date(year, month - 1, day)
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (candidate < today) year += 1
      return { weekdays: [], oneTimeOffset: null, explicitDate: `${year}-${pad(month)}-${pad(day)}`, matched: explicit[0] }
    }
  }

  // 오늘(+0)/내일(+1)만 읽고 모레(+2)/글피(+3)를 못 읽던 것을 보완(2026-08-27).
  if (/글피/.test(text))  return { weekdays: [], oneTimeOffset: 3, matched: '글피' }
  if (/모레/.test(text))  return { weekdays: [], oneTimeOffset: 2, matched: '모레' }
  if (/내일/.test(text))  return { weekdays: [], oneTimeOffset: 1, matched: '내일' }
  if (/오늘/.test(text))  return { weekdays: [], oneTimeOffset: 0, matched: '오늘' }

  // "3일 후"(숫자) / "이틀 뒤"(고유어) — 몇 년 뒤가 아니라 며칠 뒤 1회성 방송
  const numDays = text.match(/(\d+)\s*일\s*(?:후|뒤)/)
  if (numDays) return { weekdays: [], oneTimeOffset: Number(numDays[1]), matched: numDays[0] }
  const nativeDays = text.match(/(하루|이틀|사흘|나흘|닷새|엿새|이레)\s*(?:후|뒤)/)
  if (nativeDays) return { weekdays: [], oneTimeOffset: NATIVE_DAY_COUNT[nativeDays[1]], matched: nativeDays[0] }

  if (/매일/.test(text))         return { weekdays: ALL_DAYS, oneTimeOffset: null, matched: '매일' }
  if (/평일/.test(text))         return { weekdays: WEEKDAYS, oneTimeOffset: null, matched: '평일' }
  if (/주말/.test(text))         return { weekdays: WEEKEND,  oneTimeOffset: null, matched: '주말' }

  // 격주는 스키마상 "요일만" 저장 가능하고 "한 주 걸러"는 표현할 방법이 없다 — 조용히 매주로
  // 취급하지 말고 ambiguous로 알린다(요일은 최대한 그대로 반영).
  const isBiweekly = /격주/.test(text)

  // 다음주 X요일 / 이번주 X요일 / 매주 X요일 / X요일마다
  // "다음주"·"이번주"가 내용에 그대로 남던 것과, "다음주 월요일"이 매주 반복으로 잘못
  // 처리되던 것을 고침(2026-08-27) — "다음주"는 이번 주가 아니라 확실히 다음 주 그 요일
  // 하루만 가리키므로 1회성으로 다룬다("이번주"는 여전히 반복 취급 — 사람들이 "이번주
  // 금요일마다"처럼 매주를 뜻하는 경우와 구분이 안 가서 무리하게 바꾸지 않음).
  const weekly = text.match(/(다음주|이번주)?\s*(?:매주\s*)?([일월화수목금토])요일/)
  if (weekly) {
    const qualifier = weekly[1]
    const dow = DAY_INDEX[weekly[2]]
    const matched = isBiweekly ? `격주 ${weekly[0]}` : weekly[0]
    const ambiguous = isBiweekly ? 'repeat_biweekly' : null

    if (qualifier === '다음주' && !isBiweekly) {
      // 일요일 시작 기준 "이번 주"의 시작(가장 최근 일요일)에서 7일 더한 지점이 "다음 주 시작"이고,
      // 거기에 목표 요일을 더한다. 단순히 "오늘 이후 가장 가까운 그 요일"에 +7을 하면(예전 버전
      // 버그) 요일이 오늘보다 이르면 한 주를 더 건너뛰어 버린다 — 예: 목요일에 "다음주 월요일"을
      // 말하면 이번 주 월요일은 이미 지났으니 나흘 뒤 월요일이 곧 "다음주"인데, 거기에 또 7일을
      // 더해 그 다음 주로 잘못 넘어갔었다.
      const d = new Date(now)
      const diff = dow - d.getDay() + 7
      d.setDate(d.getDate() + diff)
      return { weekdays: [], oneTimeOffset: null, explicitDate: toDateStr(d), matched, ambiguous }
    }
    return { weekdays: [dow], oneTimeOffset: null, matched, ambiguous }
  }

  // 월수금 / 화목 같은 축약 — 요일 글자만 2개 이상 붙어 있는 덩어리
  const combo = text.match(/(?<![가-힣])([일월화수목금토]{2,7})(?![가-힣])/)
  if (combo) {
    const days = [...new Set([...combo[1]].map(c => DAY_INDEX[c]))].sort((a, b) => a - b)
    if (days.length) return { weekdays: days, oneTimeOffset: null, matched: combo[0] }
  }

  if (isBiweekly) return { weekdays: ALL_DAYS, oneTimeOffset: null, matched: '격주', ambiguous: 'repeat_biweekly' }

  // 반복 표현이 없으면 매일로 둔다(가장 흔한 경우) — 모달에서 바꿀 수 있다
  return { weekdays: ALL_DAYS, oneTimeOffset: null, matched: null }
}

// ── 내용·제목 ────────────────────────────────────────────────
function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 시간·요일 토큰과 명령 꼬리말을 걷어낸 나머지를 내용으로 쓴다.
// stripActions: 매체 방송 지시로 읽힌 문장에서만 재생 동작("틀어주세요")까지 걷어낸다.
//   일반 TTS 방송문에는 "틀어"·"켜" 같은 말이 내용으로 들어갈 수 있어서 항상 지우면 안 된다.
function extractContent(text, matchedParts, { stripActions = false, stripModifierTail = false } = {}) {
  let rest = text
  for (const part of matchedParts) {
    if (!part) continue
    // 낱말에 붙은 조사까지 함께 걷어낸다("음악을" → 통째로). 안 그러면 "을"이 내용에 남고,
    // BGM 예약에서는 그게 그대로 검색어가 됐다(2026-08-28 발견).
    rest = rest.replace(new RegExp(escapeRe(part) + '\\s*(을|를|은|는|이|가|도|만)?'), ' ')
  }
  if (stripModifierTail) {
    // "프로그램 안내**해주고**, 볼륨은 잔잔하게 **시작해줘**"처럼 설정 수식어가 붙은 문장은
    // 절이 이어지면서 연결어와 마무리 동사가 내용에 남는다. 수식어를 읽은 문장에서만
    // 걷어낸다 — 평범한 방송문에는 "시작"·"하고"가 내용으로 들어갈 수 있다.
    rest = rest
      .replace(/(하|해)\s*(주시고|주고|고)\s*,?/g, ' ')
      .replace(/시작\s*(해)?\s*(주세요|주라|줘요|줘)?\s*$/, ' ')
  }
  if (stripActions) {
    rest = rest
      .replace(new RegExp(ACTION_CUES.source, 'g'), ' ')
      // 동작을 걷어내면 홀로 남는 부사들
      .replace(/(^|\s)(좀|다시|한번|한 번)(?=\s|$)/g, ' ')
  }
  return rest
    // 남아있는 시간/요일 조각 정리
    .replace(/(오전|오후|아침|저녁|밤|낮)/g, ' ')
    .replace(new RegExp(`(?:\\d{1,2}|${NATIVE_HOUR_PATTERN})\\s*시\\s*(\\d{1,2}\\s*분|반)?`, 'g'), ' ')
    .replace(/\d{1,2}\s*:\s*\d{2}/g, ' ')
    // 명령 꼬리말
    .replace(/(방송을?|예약을?)?\s*(넣어|추가해|잡아|만들어|등록해|예약해)\s*(주세요|주라|줘|줘요)?/g, ' ')
    .replace(/해\s*(주세요|줘)/g, ' ')
    // 남은 조사/기호 정리
    .replace(/^[\s,.·]+|[\s,.·]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^에\s*/, '')
    .trim()
}

function nowHHMM(now) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 예약 시각이 일과방송과 겹치는지. 정확히 같은 분이거나 앞뒤 OVERLAP_WINDOW_MIN분 이내면
// 소리가 섞인다(일과방송은 한 번에 끝나지 않고 여러 단계가 이어진다).
const OVERLAP_WINDOW_MIN = 5

function toMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function findAutoOverlaps(scheduledTime, autoTimes) {
  if (!Array.isArray(autoTimes) || !autoTimes.length) return []
  const target = toMinutes(scheduledTime)
  if (target === null) return []
  return autoTimes
    .filter(a => a && typeof a.time === 'string' && typeof a.label === 'string')
    .filter(a => {
      const t = toMinutes(a.time)
      return t !== null && Math.abs(t - target) <= OVERLAP_WINDOW_MIN
    })
    .map(a => ({ label: a.label, time: a.time }))
}

function makeTitle(content) {
  if (!content) return '새 예약'
  const firstLine = content.split(/[\n.]/)[0].trim()
  return (firstLine.length > 20 ? firstLine.slice(0, 20) : firstLine) || '새 예약'
}

/**
 * 자연어 문장에서 예약 초안을 만든다.
 * @param {string} text    사용자가 입력한 한 문장
 * @param {Date}   now     기준 시각(테스트에서 고정하기 위해 주입 가능)
 * @param {object} options
 * @param {{quiet:number, loud:number}} [options.volumeLevels]
 *        정성어("잔잔하게") → 수치 매핑. 스피커·공간마다 달라서 설정에서 읽어 넘긴다
 *        (domain/volume.js의 readVolumeLevels). 안 넘기면 볼륨 지시를 숫자로 바꾸지 않는다.
 * @param {Array<{id:string,label:string,time:string}>} [options.autoTimes]
 *        지금 켜져 있는 일과방송 시각. 같은 시각에 예약이 잡히면 소리가 겹치므로 알린다.
 *        (domain/autoBroadcasts.js의 readEnabledAutoTimes — 라우트가 조회해서 넘긴다)
 * @param {Array<{id:number,name:string}>} [options.flows]
 *        저장된 흐름 목록. 넘기면 "아침 방송 흐름 실행해줘"처럼 이름을 부른 문장을
 *        flow 예약으로 만든다. 이 파일은 DB를 모르므로 호출부(라우트)가 조회해서 넘긴다.
 * @returns {{scheduled_time, repeat_weekdays, repeat_start_date, title, content,
 *            broadcast_type, ambiguous: string[]}}
 */
function parseSchedulePhrase(text, now = new Date(), options = {}) {
  const ambiguous = []
  const src = typeof text === 'string' ? text.trim() : ''

  if (!src) {
    return {
      scheduled_time: 기본시각(now),
      repeat_weekdays: ALL_DAYS,
      repeat_start_date: toDateStr(now),
      title: '',
      content: '',
      broadcast_type: 'text',
      ambiguous: ['time_missing'],
    }
  }

  const t = parseTime(src)
  if (t.ambiguous) ambiguous.push(t.ambiguous)

  const r = parseRepeat(src, now)
  if (r.ambiguous) ambiguous.push(r.ambiguous)

  // "지금 당장 안내방송 해줘" — 시각·반복 표현이 없고 즉시 신호만 있으면 예약이 아니라
  // 즉시 방송 요청이다. 시각은 지금이므로 time_missing(기본값 09:00 안내)을 되물을 이유가
  // 없다 — 그 경고를 걷어내고, 아래의 지난시각 보정·repeat_assumed도 건너뛴다
  // (지금 == 지금이라 '<='에 걸려 내일로 옮겨버리고, 1회성 의도가 명확하다).
  // 자동 발사는 없다 — 화면의 "지금 방송" 버튼이 검토 게이트다.
  const immediate = isImmediateRequest(src, { hasTime: !!t.matched, hasRepeat: !!r.matched })
  if (immediate) {
    const idx = ambiguous.indexOf('time_missing')
    if (idx !== -1) ambiguous.splice(idx, 1)
  }

  let repeatStartDate
  if (r.explicitDate) {
    repeatStartDate = r.explicitDate
  } else {
    const startDate = new Date(now)
    if (r.oneTimeOffset != null) startDate.setDate(startDate.getDate() + r.oneTimeOffset)
    repeatStartDate = toDateStr(startDate)
  }

  // 1회성 예약은 시작일 당일에만 실행된다(repeatSchedule.isOneTime/shouldRunToday).
  // 그래서 "오늘 + 이미 지난 시각"으로 저장되면 **영원히 발동하지 않는다** — 등록은 됐는데
  // 방송이 안 나가는, 현장에서 원인을 찾기 가장 어려운 실패다. 내일로 옮기고 사람에게 알린다.
  // 반복 예약은 옮길 필요가 없다(오늘 시각을 놓쳐도 내일 그 시각에 정상 발동한다).
  const scheduledTime = immediate ? nowHHMM(now) : (t.time || 기본시각(now))
  const isOneTimeParse = immediate || r.weekdays.length === 0
  if (!immediate && isOneTimeParse && repeatStartDate === toDateStr(now) && scheduledTime <= nowHHMM(now)) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    repeatStartDate = toDateStr(tomorrow)
    ambiguous.push('time_past_moved')
  }

  // 저장된 흐름을 이름으로 부른 문장("아침 방송 흐름 실행해줘")이 가장 구체적이므로 먼저 본다 —
  // 흐름 이름에 "음악"·"영상" 같은 말이 들어 있어도 매체 사전에 가로채이지 않게 한다.
  const flow = detectFlow(src, options.flows)

  // 설정 수식어("볼륨은 잔잔하게") — 별개 명령이 아니라 **이 예약의 파라미터**로만 읽는다.
  // 그래야 초안 1건 = 예약 1건이 유지돼 검토 게이트가 그대로 살고, 값이 예약 행에만 남는다.
  const volume = detectVolume(src, options.volumeLevels)

  // 방송 유형("차임벨 울려줘" → chime) — 안 잡히면 지금까지처럼 TTS(text)다.
  // 매체를 가리킨 낱말과 재생 동작은 내용에서 걷어낸다(안 그러면 그게 그대로 제목이 된다).
  const concept = flow ? null : detectBroadcastType(src)

  // 흐름 방송은 읽을 문구가 없다(runFlow가 저장된 단계를 실행한다) — 내용을 비우고
  // 흐름 이름을 제목으로 쓴다. 남은 글자("순서대로 틀어줘")를 제목에 남기지 않기 위함이다.
  const content = flow
    ? ''
    : extractContent(
        src,
        [t.matched, r.matched, ...(concept?.strip || []), ...(volume?.strip || [])],
        { stripActions: Boolean(concept), stripModifierTail: Boolean(volume) },
      )

  // ── **읽을 것이 없으면 TTS 가 아니다** (사용자 지적 2026-09-13) ────────────────────
  //
  // *"순서, 흐름, 자동 할 때 왜 저거 안내방송으로 TTS 로 읽히냐"* — 맞다. 「흐름」 한 낱말을
  // 넣으면 흐름 이름이 안 맞아 `detectFlow` 가 null 을 내고, 그대로 **「흐름」이라는 글자를
  // 소리내어 읽는 안내방송**이 됐다. 어르신께 "흐름" 이 나간다.
  //
  // 이 저장소가 가장 경계하는 **조용한 오독**이다. 흐름을 부르려던 신호는 분명히 있었고
  // (FLOW_CUES), 남은 내용은 그 신호말뿐이라 **읽을 것이 하나도 없다.** 그러면 TTS 로
  // 떨어뜨리지 않고 «흐름인데 어느 흐름인지 모르겠다»로 되묻는다 — 화면이 흐름 고르개를 편다.
  // 진짜 안내 문구가 섞여 있으면(«체조 순서 안내드립니다») 여기 안 걸린다.
  const 흐름말뿐인가 = !flow && !concept
    && FLOW_ONLY_CUES.test(src)
    && !content.replace(FLOW_ONLY_CUES_ALL, '').replace(/[\s.,!?·]/g, '')
  if (흐름말뿐인가) ambiguous.push('flow_unnamed')

  if (concept?.confidence === 'weak') ambiguous.push('type_guess')
  // audio/video는 재생할 파일을 골라야 소리가 난다 — 문장만으로는 알 수 없으므로
  // 임의로 고르지 않고 사람이 "자세히 수정"에서 고르게 알린다.
  if (concept?.needs === 'audio_file') ambiguous.push('needs_audio_file')
  // 한 문장에서 다른 유형·다른 흐름도 걸린 경우("티비로 영상 틀어줘") — 우리가 고르지 않는다
  if (concept?.alternatives?.length) ambiguous.push('type_ambiguous')
  if (flow?.alternatives?.length)    ambiguous.push('flow_ambiguous')
  // 반복 표현이 아예 없으면 아래에서 '매일'로 두는데, 하루짜리 안내가 매일 나가는 건
  // 위험한 오독이다. 가장 흔한 경우라 기본값은 유지하되 조용히 넘기지는 않는다.
  if (!r.matched && !immediate) ambiguous.push('repeat_assumed')
  // 일과방송과 시각이 겹치면 두 방송이 동시에 나가 소리가 섞인다 — 막지는 않고 알린다
  const overlaps = findAutoOverlaps(scheduledTime, options.autoTimes)
  if (overlaps.length) ambiguous.push('overlaps_auto')
  // 볼륨은 귀로 바로 체감되는 값이라, 잘못 읽으면 방송이 안 들리거나 시끄럽다.
  // 정성어를 숫자로 바꾼 결과를 사람이 눈으로 보고 확인하게 한다.
  if (volume && volume.value !== null) {
    ambiguous.push('volume_set')
    // 어느 소리인지 짚어 말하지 않았으면 BGM으로 뒀다고 알린다.
    // 요양원에서 안내 음성을 작게 만드는 건 어르신이 못 듣는 결과라 훨씬 위험해서,
    // 기본을 BGM으로 두되 사람이 확인하게 한다.
    if (!volume.channelExplicit) ambiguous.push('volume_channel_guess')
  }

  return {
    scheduled_time: scheduledTime,
    // 즉시 방송은 1회성이다 — 반복 기본값('매일')이 남으면 "지금 한 번"이 매일 나간다
    repeat_weekdays: immediate ? [] : r.weekdays,
    // 즉시 방송 요청("지금 당장") — 화면이 "예약 확정" 대신 "지금 방송" 버튼을 보여준다.
    // 자동 발사는 없다: 이 플래그는 버튼의 모양을 바꿀 뿐, 누르는 건 사람이다.
    ...(immediate ? { immediate: true } : {}),
    repeat_start_date: repeatStartDate,
    // 매체만 말한 문장("저녁 6시에 차임벨")은 내용이 비므로 유형 이름을 제목으로 쓴다
    title: makeTitle(flow?.name || (흐름말뿐인가 ? '흐름 방송' : content) || concept?.label || ''),
    // 흐름은 읽을 문구가 없다 — 이름을 못 골랐어도 마찬가지다(그 낱말을 읽으면 안 된다)
    content: 흐름말뿐인가 ? '' : content,
    // `flow_unnamed` 도 **흐름**이다 — 이름만 못 골랐다. 화면이 흐름 고르개를 편다.
    broadcast_type: (flow || 흐름말뿐인가) ? 'flow' : (concept?.broadcastType || 'text'),
    // 흐름은 id가 있어야 실행된다 — 이름을 맞춘 경우에만 채운다
    ...(flow ? { flow_sequence_id: flow.flowId } : {}),
    // 이 예약에만 적용될 BGM 볼륨. "보통으로"(value: null)는 시스템 기본값을 쓰라는 뜻이라
    // 아무것도 넣지 않는다 — 값을 넣지 않는 것이 곧 "기본값을 따른다"이다.
    // main = 그 방송의 주 소리(안내 음성·차임벨·음원·영상), bgm = 배경 음악.
    // "보통으로"(value: null)는 시스템 기본값을 쓰라는 뜻이라 아무것도 넣지 않는다 —
    // 값을 넣지 않는 것이 곧 "기본값을 따른다"이다.
    ...(volume && volume.value !== null
      ? {
          [volume.channel === 'main' ? 'main_volume' : 'bgm_volume']: volume.value,
          volume_label:   volume.label,
          volume_channel: volume.channel,
        }
      : {}),
    // 겹치는 일과방송 이름 — 화면이 "아침 종합 방송과 같은 시각입니다"라고 말할 수 있게
    ...(overlaps.length ? { auto_overlaps: overlaps } : {}),
    // 화면이 "이거 맞나요?"를 사람 말로 물어볼 수 있도록 후보 이름을 함께 준다
    ...(concept?.alternatives?.length ? { type_alternatives: concept.alternatives.map(a => a.label) } : {}),
    ...(flow?.alternatives?.length    ? { flow_alternatives: flow.alternatives.map(a => a.name) }    : {}),
    // BGM 단독 방송은 이 PC 의 방송용 BGM 폴더에서 튼다(2026-09-21 — 검색어로 찾던 외부 연동을
    // 걷어냈다). 다른 유형에서는 이 필드를 건드리지 않아야 화면 기본값(BGM_DEFAULTS)을 덮어쓰지 않는다.
    ...(concept?.broadcastType === 'bgm'
      ? { bgm_enabled: 1, bgm_type: 'local_broadcast', bgm_value: '' }
      : {}),
    ambiguous,
  }
}

// findAutoOverlaps: 일과방송 겹침의 ±5분 규칙은 이 한 벌뿐이다 — AI 초안 경로(scheduleDrafts)도
// 같은 것을 쓴다. 두 벌이 되면 한쪽만 고쳐져 "규칙 파서는 경고하는데 AI는 조용한" 상태가 된다.
module.exports = { parseSchedulePhrase, findAutoOverlaps, mentionsRepeat, REPEAT_PHRASE }
