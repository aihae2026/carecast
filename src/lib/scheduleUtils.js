import { FileText, Music2, Volume2, Bell, Film, Workflow } from 'lucide-react'

// 예약 추가 모달(shared/ScheduleModal.jsx)의 방송 유형 목록 — react-refresh/only-export-components
// 규칙 때문에 컴포넌트 파일과 분리해서 여기(순수 데이터)에 둔다.
export const BROADCAST_TYPES = [
  { value: 'text',       label: 'TTS',       icon: FileText, color: 'text-ds-v3-tts'  },
  // ── 차임벨은 **고르는 목록에서 뺀다** (사용자 지시 2026-09-15) ───────────────────
  // *"차임벨 같은 경우에도 자세히 유형이 사실 안 들어갔으면 좋겠어, 어차피 예약도
  //   하지도 않는 건데."*
  //
  // 맞다. 차임은 **누르면 그 자리에서 나가는 것**이고(검색창 밑 「차임벨」 단추가
  // 그 일을 한다 — 예약 행도 안 만든다), 「몇 시에 차임만 울리게 예약」하는 일은 없다.
  // 고를 수 있는데 아무도 안 쓰는 칸은 **고르는 사람을 헷갈리게 할 뿐**이다.
  //
  // **지우지는 않는다.** 2026-09-14 지시가 *"기존 차임 예약·저장된 순서·API 기능은
  // 삭제하지 않는다"* 였고, 무엇보다 이 표는 **이름표를 찾는 표**이기도 하다 —
  // 빼 버리면 이미 있는 차임 예약이 화면에 「chime」으로 뜨고, 고칠 때 유형이
  // **조용히 다른 것으로 바뀐다.**
  //
  // 그래서 `숨김` 만 붙인다. 고르는 자리는 `고를수있는유형()` 을 쓰고, 이름표를 찾는
  // 자리는 이 표 전체를 그대로 본다.
  { value: 'chime',      label: '차임벨',     icon: Bell,     color: 'text-ds-v3-ink-2', 숨김: true },
  { value: 'audio',      label: '음원선택',   icon: Volume2,  color: 'text-ds-v3-ink-2'   },
  { value: 'bgm',        label: 'BGM',       icon: Music2,   color: 'text-ds-v3-warn'     },
  { value: 'video',      label: '업로드 영상', icon: Film,     color: 'text-ds-v3-flow'  },
  // 방송 흐름(순서) 만들기 — 저장된 흐름(FlowBuilder.jsx)을 골라서 그대로 실행
  { value: 'flow', label: '고급: 저장된 흐름', icon: Workflow, color: 'text-ds-v3-tts' },
]

/**
 * **고르는 자리에 내놓을 유형들.** 숨긴 것은 뺀다 — 다만 **지금 그 값이면 남긴다.**
 *
 * 남기는 이유가 중요하다. 이미 차임으로 만들어 둔 예약을 고치러 열었는데 목록에 그것이
 * 없으면, `<select>` 는 **첫 항목으로 튄다.** 사람이 유형은 건드리지도 않았는데
 * 저장하는 순간 **차임이 안내 음성으로 바뀐다.** 조용한 오독 중에서도 나쁜 쪽이다.
 *
 * @param {string} [현재값] 지금 고른 유형. 숨긴 것이어도 목록에 남긴다.
 */
/**
 * **「이 방송 앞에 반주를 깔까」를 물어도 되는 유형인가** (사용자 결정 2026-09-15).
 *
 * 둘에서는 안 묻는다.
 *
 * - `bgm` — **그 자체가 반주**다. 음악 앞에 음악을 깔지 묻는 꼴이 된다.
 * - `flow` — **서버가 그 값을 안 읽는다.** `scheduler.js` 의 흐름 갈래는 `runFlow()` 를
 *   부르고 그 자리에서 `return` 하고, `resolveBGM()` 은 그 아래에 있다. 그래서 체크하고
 *   저장해도 **그 시각에 아무 음악도 안 나간다** — 오류도 안 나는 조용한 오독이다.
 *   흐름의 BGM 은 **흐름 안에** 「BGM 시작」 단계로 이미 있다. 한 가지를 두 곳에서
 *   설정하게 만들지 않는다(볼륨에서 세운 원칙과 같다).
 *
 * **안 묻는 것이지 지우는 것이 아니다.** 이미 저장된 `bgm_enabled` 는 건드리지 않는다 —
 * 화면이 물음을 감춘다고 값을 0 으로 되돌리면, 카드를 한 번 열었다 닫은 것만으로 남의
 * 설정이 사라진다.
 */
export function BGM물음이있나(유형) {
  const t = 유형 || 'text'
  return t !== 'bgm' && t !== 'flow'
}

export function 고를수있는유형(현재값) {
  return BROADCAST_TYPES.filter(t => !t.숨김 || t.value === 현재값)
}

// 방송 유형 → 그 방송의 '주 소리'가 쓰는 볼륨 채널.
// server/domain/volume.js의 MAIN_CHANNEL_BY_TYPE과 **같은 표**여야 한다
// (server/test/volume.test.js의 드리프트 테스트가 두 목록을 대조한다).
// null이면 주 소리 볼륨을 따로 정할 수 없는 유형이다 — bgm은 BGM 볼륨이, flow는 스텝이 맡는다.
export const MAIN_VOLUME_CHANNEL = {
  text:         'tts',
  chime:        'tts',
  audio:        'audio',
  video:        'media',
  bgm:          null,
  flow:         null,
}

// 채널을 사람 말로 — 현장 선생님이 "무슨 소리 볼륨인지" 바로 알아야 한다
export const VOLUME_CHANNEL_LABEL = { tts: '안내 음성', audio: '음원', media: '영상' }

// 재생할 파일을 반드시 골라야 하는 방송 유형 — 화면 전체의 단일 출처.
// server/domain/ontology.js의 NEEDS_AUDIO_FILE_TYPES와 **같은 목록**이어야 한다
// (server/test/ai-approval-pickers.test.js가 두 목록을 대조한다).
// 예전엔 이 배열이 TTSBroadcast와 QuickSchedulePhrase에 따로 박혀 있었고 가드는 한쪽만 봤다 —
// 어긋나면 저장은 되는데 그 시각에 아무 소리도 안 나거나, 멀쩡한 예약이 화면에서 막힌다.
export const NEEDS_AUDIO_FILE = ['audio', 'video']

// audio_files.category 중 "영상" 카테고리 — video 방송유형의 파일 피커 필터링에 공용으로 쓴다
// (ScheduleModal.jsx, MorningEditor.jsx 양쪽에서 import)
export const VIDEO_CATEGORIES = ['exercise-video', 'lunch-video', 'dinner-video', 'scene-video', 'misc-video']

// 방송 유형에 맞는 파일 선택지만 걸러낸다.
// 음원(audio)은 오디오 카테고리, 업로드영상(video)은 영상 카테고리.
// 파일 이름이 빈 행(예전 링크 등록)은 틀 것이 없으니 뺀다.
// 예약 모달(ScheduleModal)과 AI 승인 화면(TTSBroadcast)이 함께 쓴다 — 한쪽에만 두면
// 규칙이 갈려서 "여기선 보이는데 저기선 안 보이는 파일"이 생긴다.
export function filesForBroadcastType(audioFiles, broadcastType) {
  return (audioFiles || []).filter(af => {
    if (!af.filename) return false
    if (broadcastType === 'audio')       return !VIDEO_CATEGORIES.includes(af.category)
    if (broadcastType === 'video')       return VIDEO_CATEGORIES.includes(af.category)
    return false
  })
}

// 재생 배속을 정할 수 있는 방송 유형 — 브라우저가 직접 트는 파일(업로드 음원·영상)과
// 그 둘을 품는 흐름만. BGM 은 배경이라 배속을 안 받는다.
export const RATE_TYPES = ['audio', 'video', 'flow']

// `bgm_end_delay` 5 — TTS 가 끝난 뒤 BGM 이 5초 더 흐르다 부드럽게 꺼진다(UX-17).
// **DB 의 DEFAULT 는 0 이다.** 기존 예약의 소리 길이를 그 자리에서 바꾸지 않으려는 것이고,
// 새로 만드는 예약만 여기서 5를 받는다. 두 숫자가 다른 것은 의도다(0027 마이그레이션 머리말).
export const BGM_DEFAULTS = { bgm_enabled: 0, bgm_type: 'local_broadcast', bgm_value: '', bgm_title: '', bgm_delay: 5, bgm_end_delay: 5 }

// 새 예약의 기본값 — ScheduleModal이 쓰고, 자연어 파싱 결과를 이 위에 덮어쓸 때도 쓴다.
// 파싱 결과만 넘기면 target/has_second 같은 기본값이 빠지므로 반드시 이걸 바탕으로 만든다.
// **「지금」 에서 시작하는 시각.** 다음 5분 자리로 올린다.
//
// 사용자 지적 2026-09-13: *"설정할 때 09:00 픽스해놓는 게 아니라 지금 설정하는 시간대
// 갖고 와서 해야지"*. 맞다 — 예약을 새로 만드는 사람은 대개 «조금 뒤»를 생각하고 있는데,
// 09:00 이 박혀 있으면 매번 지우고 다시 친다. 새벽에 열면 이미 지난 시각이기도 하다.
//
// **초 단위의 지금을 그대로 넣지는 않는다.** 제목을 치는 사이에 그 시각이 지나가면
// 1회성 예약은 그날 영영 안 나간다. 다음 5분 자리로 올려 여유를 둔다.
// (`scheduleCalendarPopups.jsx` 의 빠른 등록도 같은 규칙을 쓴다.)
export function 다음자리시각(now = new Date()) {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + (5 - (d.getMinutes() % 5 || 5)) + (d.getMinutes() % 5 === 0 ? 5 : 0))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 2차 방송의 기본 시각 — 1차에서 10분 뒤(환기방송의 «열기 → 닫기» 가 그 간격이다)
function 십분뒤(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m + 10)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function emptySchedule() {
  const 시작 = 다음자리시각()
  return {
    title: '', content: '', target: '전체', scheduled_time: 시작, active: 1,
    broadcast_type: 'text', repeat_broadcast: 0,
    // 이 방송에만 적용할 볼륨 — null이면 시스템 기본값을 그대로 쓴다(0은 무음이라 유효한 값)
    main_volume: null, bgm_volume: null,
    // 재생 배속 — null이면 원래 속도(1.0배). 느리게(0.5)~빠르게(1.5)
    playback_rate: null,
    repeat_start_date: todayLocalStr(), repeat_end_date: null, repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],
    ...BGM_DEFAULTS,
    // 2차 방송(1차·2차를 group_id로 묶어 표시) — 새 예약을 만들 때만 쓸 수 있다(수정 화면엔 없음).
    has_second: false, second_scheduled_time: 십분뒤(시작), second_content: '',
  }
}

// 반복시작일(repeat_start_date, YYYY-MM-DD) / 반복종료일(repeat_end_date, YYYY-MM-DD, null=무기한) /
// 반복요일(repeat_weekdays, JSON 배열, 0=일~6=토, 빈 배열=1회성)로 특정 날짜에 실행되는지 판정한다.
// server/services/repeatSchedule.js의 shouldRunToday와 같은 규칙 — 서버는 "오늘"만 판정하면 되고
// 클라이언트(주간캘린더)는 임의의 날짜에 대해 판정해야 해서 date 인자를 받는 점만 다르다.
export function todayLocalStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// DB/API에서 온 JSON 문자열("[1,3,5]")과, 클라이언트에서 만든 자동방송 항목처럼
// 이미 배열인 값 둘 다 받는다 — 후자를 문자열 전용으로 취급하면 JSON.parse가
// 조용히 실패해 반복요일이 빈 배열(=1회성)로 오인된다.
export function parseWeekdays(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  try {
    const arr = JSON.parse(value)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function toDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isOneTime(schedule) {
  return parseWeekdays(schedule.repeat_weekdays).length === 0
}

export function runsOnDate(schedule, date) {
  const dateStr = toDateStr(date)
  const weekdays = parseWeekdays(schedule.repeat_weekdays)

  if (weekdays.length === 0) {
    return schedule.repeat_start_date === dateStr
  }
  if (schedule.repeat_start_date && dateStr < schedule.repeat_start_date) return false
  if (schedule.repeat_end_date && dateStr > schedule.repeat_end_date) return false
  return weekdays.includes(date.getDay())
}

const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토']

// 반복설정을 사람이 읽는 짧은 라벨로 표시 (예: 매일 / 월수금 / 1회)
export function formatRepeatLabel(schedule) {
  const weekdays = parseWeekdays(schedule.repeat_weekdays)
  if (weekdays.length === 0) return '1회'
  if (weekdays.length === 7) return '매일'
  return [...weekdays].sort((a, b) => a - b).map(d => WEEKDAY_SHORT[d]).join('')
}

// 같은 시각에 이미 다른 예약이 있는가 — 저장 전에 알려주기 위한 판정.
//
// **막지 않는다.** 겹침을 대기·건너뛰기·끊기로 처리하는 안은 전부 지금보다 나빴다
// (줄서기가 길어지거나, 방송 하나가 그날 안 나가거나, 긴 흐름이 잘린다). 사용자 결정은
// "지금 그대로 두고 경고만 강하게"다(2026-08-31).
//
// **범위가 2026-09-03에 넓어졌다 — 자동방송 5종도 본다.** 예전엔 "매일 돌아가는 곳이라
// 건드리지 않는다"며 뺐는데, 정작 가장 흔한 겹침이 그것이고 실행 시점에 사고가 난다
// (레드 검증 F6: 같은 분에 영상 예약과 점심 자동방송이 있으면 예약이 먼저 나가고 1.5초 뒤
// 자동방송이 그것을 밀어낸다). 사용자 결정: **넣을 때 "이미 있는 시간입니다"라고 알린다.**
// 자동방송은 autoBroadcastSiblings()가 이 함수가 아는 모양으로 바꿔서 넣어 준다.
//
// 시각만 같은 것으로는 안 된다: 월요일 예약과 화요일 예약은 같은 10:00라도 안 겹친다.
// 그래서 **같은 분 + 같은 날 도는가**를 함께 본다.
const OVERLAP_NEAR_MIN = 5   // 방송은 순간이 아니라 몇 분을 쓴다(schedulePhrase의 창과 같은 값)

function hhmmToMinutes(value) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// 두 예약이 같은 날 도는 날이 하루라도 있는가.
function sharesADay(a, b) {
  const wa = parseWeekdays(a.repeat_weekdays)
  const wb = parseWeekdays(b.repeat_weekdays)
  if (wa.length && wb.length) {
    if (!wa.some(d => wb.includes(d))) return false
    // 기간이 아예 안 겹치면 같은 요일이어도 만나지 않는다
    if (a.repeat_end_date && b.repeat_start_date && b.repeat_start_date > a.repeat_end_date) return false
    if (b.repeat_end_date && a.repeat_start_date && a.repeat_start_date > b.repeat_end_date) return false
    return true
  }
  if (!wa.length && !wb.length) return a.repeat_start_date === b.repeat_start_date  // 둘 다 1회성
  // 한쪽만 1회성 — 그 날짜에 반복 예약이 도는가
  const [once, rep] = wa.length ? [b, a] : [a, b]
  if (!once.repeat_start_date) return false
  const d = new Date(`${once.repeat_start_date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return false
  return runsOnDate(rep, d)
}

/**
 * @param {object} draft 지금 만들거나 고치는 중인 예약(폼 값). id가 있으면 자기 자신은 뺀다.
 * @param {Array}  all   비교 대상 예약 목록
 * @returns {Array<{id, title, time, exact}>} exact=true면 같은 분, false면 앞뒤 몇 분 이내
 */
export function findScheduleOverlaps(draft, all = []) {
  const target = hhmmToMinutes(draft?.scheduled_time)
  if (target === null) return []
  const out = []
  for (const s of all) {
    if (!s || Number(s.active) === 0) continue          // 꺼진 예약은 소리를 안 낸다
    if (draft.id != null && s.id === draft.id) continue // 고치는 중인 자기 자신
    const t = hhmmToMinutes(s.scheduled_time)
    if (t === null) continue
    const gap = Math.abs(t - target)
    // **도는 도중**도 겹침이다. 아침 방송은 27분짜리라 08:00 예약이 그 위에 얹히는데,
    // 시작 시각끼리의 ±5분 창으로는 절대 못 잡는다(끝 시각을 아는 자동방송에만 해당).
    const end = hhmmToMinutes(s.endTime)
    const running = end !== null && target > t && target <= end
    if (gap > OVERLAP_NEAR_MIN && !running) continue
    if (!sharesADay(draft, s)) continue
    out.push({
      id: s.id, title: s.title || '예약 방송', time: s.scheduled_time,
      exact: gap === 0, running, isAuto: !!s.isAuto, endTime: s.endTime ?? null,
    })
  }
  // 같은 분을 먼저 보여준다 — 그게 실제로 소리가 겹치는 것이다
  return out.sort((a, b) => (a.exact === b.exact ? 0 : a.exact ? -1 : 1))
}

// 자동방송 5종을 위 함수가 아는 모양으로 바꾼다(2026-09-03).
//
// 자동방송은 예약 표가 아니라 설정에 산다 — 그래서 예약끼리의 겹침 판정에 안 잡혔다.
// 매일 도는 것이므로 요일은 전부, 그리고 **예상 종료 시각을 함께 싣는다**: 시작 시각만
// 비교하면 27분짜리 아침 방송 한복판(08:00)에 넣는 예약을 못 잡는다.
// 꺼 둔 방송은 소리를 안 내므로 후보가 아니다.
//
// @param {object} settings  getBroadcastSchedule() 응답 — { [tab]: { enabled, time, name } }
// @param {object} estimate  getBroadcastEstimate() 응답 — { [tab]: { startTime, end: { time } } }
export function autoBroadcastSiblings(settings = {}, estimate = {}) {
  const LABEL = {
    morning: '아침 방송', exercise: '국민체조', lunch: '점심 식사 전 방송',
    dinner: '저녁 식사 전 방송', evening_prayer: '저녁 마무리',
  }
  const rows = []
  for (const [tab, label] of Object.entries(LABEL)) {
    const conf = settings?.[tab]
    if (!conf || conf.enabled === false) continue
    const time = conf.time || estimate?.[tab]?.startTime
    if (!time) continue
    rows.push({
      id: `auto:${tab}`,
      title: conf.name || label,
      scheduled_time: time,
      endTime: estimate?.[tab]?.end?.dayOffset ? null : (estimate?.[tab]?.end?.time ?? null),
      active: 1,
      isAuto: true,
      repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],   // 매일 돈다
      repeat_start_date: null,
    })
  }
  return rows
}

// ── 재생 배속: 저장은 배수, 화면은 퍼센트 ────────────────────────────────
// DB에는 배수(0.5~1.5)로 들어간다 — 서버 services/scheduleStore.js의 RATE_MIN/RATE_MAX가
// 단일 출처이고, server/test/rate-percent.test.js가 아래 상한·하한을 그 값과 대조한다.
//
// 화면에서만 퍼센트로 다룬다: **정속이 100%**, 느리게 80%, 빠르게 120%.
// 0.5·0.75·1.25 같은 배수 버튼만 있던 것을 사람이 숫자로 적을 수 있게 바꿨다 — 현장에서
// "너무 성기다"는 말을 들었고, 실제로 필요한 건 83%처럼 1% 단위의 미세 조정이었다.
export const RATE_PCT_MIN = 50
export const RATE_PCT_MAX = 150
export const RATE_PCT_DEFAULT = 100

export function clampRatePercent(pct) {
  const n = Math.round(Number(pct))
  if (!Number.isFinite(n)) return RATE_PCT_DEFAULT
  return Math.max(RATE_PCT_MIN, Math.min(RATE_PCT_MAX, n))
}

// 0.83 → 83. 부동소수 때문에 83.00000000000001이 나오므로 반올림한다.
export const rateToPercent = (rate) => Math.round((Number(rate) || 1) * 100)
// 83 → 0.83. 범위 밖 값은 잘라서 넣는다(서버도 같은 범위로 한 번 더 자른다).
export const percentToRate = (pct) => clampRatePercent(pct) / 100

// ── 캘린더에서 끌어 놓았을 때 무엇이 바뀌는가 (UX-22 · UX-23, 2026-09-11) ────────────
//
// **화면(확인 문구)과 실제 저장이 같은 판단을 보게 하려고 순수 함수로 뺐다.**
// 두 벌로 두면 "확인창은 하루만이라 하고 저장은 전부 바꾸는" 일이 생긴다 — 이 저장소가
// 여섯 번 밟은 모양이다(FP-0005).
//
// 규칙 셋:
//   ① 1회성 예약    → 그 날짜만 바꾼다. 되돌리기 쉬워서 가장 안전하다.
//   ② 매주 한 요일   → 그 요일을 바꾼다. **앞으로 모든 회차가 옮겨진다** — 그래서 되묻는다.
//   ③ 여러 요일·자동 → 옮기지 않는다. 어느 회차를 옮기려는 것인지 알 수 없다.
//
// 자동방송(5종)에 "이 날짜만"이 없는 이유: 그것들은 `settings` 의 시각 하나로 매일 도는
// 것이라 **회차별 예외를 담을 저장 자리가 아예 없다.** 지어내지 않고 사실대로 막는다.
export const DAY_SHORT = ['일', '월', '화', '수', '목', '금', '토']

export function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_SHORT[d.getDay()]}요일)`
}

export function planMove(item, fromDateStr, toDateStr) {
  if (!item) return { allowed: false, kind: 'none', message: '옮길 일정이 없습니다.' }
  if (fromDateStr === toDateStr) {
    return { allowed: false, kind: 'same', message: '같은 날짜입니다.' }
  }
  if (item._isAuto) {
    return {
      allowed: false, kind: 'auto',
      message: '자동방송은 날짜를 옮길 수 없습니다.',
      detail: '자동방송은 날마다 같은 시각에 나갑니다. 시각을 바꾸려면 "자동방송 편집"에서 '
        + '고쳐주세요 — 그날 이후 모든 날에 적용됩니다.',
    }
  }
  const days = parseWeekdays(item.repeat_weekdays)
  if (days.length === 0) {
    return {
      allowed: true, kind: 'once',
      // 종료일이 적혀 있으면 **같이 옮긴다**(2026-09-17 독립 검수 F3). 시작일만 옮기면 뒤 날짜로 끈 순간
      // 종료일 < 시작일 이 되어 서버가 400 으로 거절한다(예전엔 저장되고 영영 안 나갔다).
      patch: { repeat_start_date: toDateStr, ...(item.repeat_end_date ? { repeat_end_date: toDateStr } : {}) },
      message: `"${item.title}" 을(를) ${formatDayLabel(toDateStr)}로 옮깁니다.`,
      detail: '한 번만 나가는 예약이라 이 날짜만 바뀝니다.',
    }
  }
  if (days.length === 1) {
    const to = new Date(toDateStr + 'T00:00:00').getDay()
    if (to === days[0]) return { allowed: false, kind: 'same', message: '같은 요일입니다.' }
    return {
      allowed: true, kind: 'weekly',
      patch: { repeat_weekdays: [to] },
      message: `"${item.title}" 의 반복 요일을 ${DAY_SHORT[days[0]]}요일 → ${DAY_SHORT[to]}요일로 바꿉니다.`,
      detail: '이 예약은 매주 반복됩니다. 옮기면 이 날짜만이 아니라 **앞으로 모든 회차**가 바뀝니다.',
    }
  }
  return {
    allowed: false, kind: 'multi',
    message: `"${item.title}" 은(는) ${formatRepeatLabel(item)} 반복이라 끌어서 옮길 수 없습니다.`,
    detail: '여러 요일에 반복되는 예약은 어느 요일을 옮기려는 것인지 알 수 없습니다. '
      + '일정을 눌러 "수정"에서 반복 요일을 직접 골라주세요.',
  }
}
