// 방송일정 및 예약 — **월간이 기본**인 달력 (UX-19 ~ UX-26, 2026-09-11).
//
// 무엇이 바뀌었나(사용자 지시):
//   · 이름을 "주간방송일정및예약" → **"방송일정 및 예약"** 으로 바꿨다.
//   · 기본 보기를 주간 → **월간**으로 바꿨다. 주간은 탭으로 남는다.
//   · 월간 칸이 **점 + 건수**가 아니라 **제목·시각 칩**을 보여준다.
//   · 빈 날을 누르면 **빠른 등록 팝업**, 일정을 누르면 **상세 팝업**이 뜬다(참고 이미지).
//   · 자동방송 5종은 날짜마다 **한 칩으로 접는다.** 색도 다르다.
//   · 아래에 늘 펼쳐져 있던 "예약방송관리"를 **'목록' 탭으로 옮겼다** —
//     없애라는 지시였지만 그 안의 기능(일시정지·묶음 접기·자동방송 즉시실행·집계)을
//     잃으면 안 되므로(UX-21) 자리를 옮기고 기본으로는 안 보이게 했다.
//   · 일정을 **끌어서 옮길 수 있다.** 무엇이 바뀌는지는 `planMove()` 가 정하고,
//     자동방송과 여러 요일 반복은 막는다(UX-22 · UX-23).
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { FileText, Music2, Volume2, Bell, Video, ListOrdered, Sunrise, Activity, Utensils, Moon, Sunset, RefreshCw, Plus, Check, AlertCircle, CalendarDays, List, Repeat } from 'lucide-react'
import { getSchedules, getBroadcastSchedule, updateSchedule } from '../../../lib/api'
import { runsOnDate, planMove, parseWeekdays } from '../../../lib/scheduleUtils'
import { batchSchedules } from '../../../lib/scheduleBatch'
import { autoName } from '../../../lib/autoBroadcastNames'
import { kindOfItem, kindOfType } from '../../../lib/broadcastKind'
import useWideScreen from '../../../hooks/useWideScreen'
import { TAB_ID } from '../../../lib/tabId'
import ScheduledBroadcast, { ScheduleModal } from './ScheduledBroadcast'
import QuickSchedulePhrase from '../../shared/QuickSchedulePhrase'
import { QuickCreatePopup, EventDetailPopup, AutoGroupPopup, MoveConfirmPopup } from './scheduleCalendarPopups'

const DAY_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

// 갈래별 옷 — **색은 셋뿐이다**(G-1). 이 표가 이 화면에서 색의 유일한 자리다.
// 관리자 달력과 통합 홈 달력이 **같은 표**를 쓴다(아래 `chipStyle`).
const KIND_STYLE = {
  tts:  { bg: 'bg-ds-v3-tts-bg',  text: 'text-ds-v3-tts',   dot: 'bg-ds-v3-tts'   },
  bgm:  { bg: 'bg-ds-v3-bgm-bg',  text: 'text-ds-v3-bgm',   dot: 'bg-ds-v3-bgm'   },
  flow: { bg: 'bg-ds-v3-flow-bg', text: 'text-ds-v3-flow',  dot: 'bg-ds-v3-flow'  },
  '':   { bg: 'bg-ds-v3-bg',      text: 'text-ds-v3-ink-2', dot: 'bg-ds-v3-ink-3' },
}

// 서버가 인정하는 방송 유형은 7종이다 — `server/domain/ontology.js` 의 KNOWN_BROADCAST_TYPES 가
// 단일 출처이고, 여기 목록이 그것보다 좁으면 **그 유형의 예약 하나가 이 화면을 통째로 죽인다**
// (2026-09-07 실제 사고: flow 예약 2건 때문에 주간표가 빈 화면이 됐다 — `Cannot read properties
// of undefined (reading 'Icon')`). 목록이 갈리는지는 weekly-schedule-type-style.test.js 가 대조한다.
//
// **색을 손으로 적지 않는다**(2026-09-13). 예전엔 여덟 유형에 여덟 색이 손으로 적혀
// 있었다 — TTS 파랑 · BGM 빨강 · 음원 초록 · 차임벨 노랑 · 영상 보라 · (당시) TV 장미 ·
// 흐름 청록 · 자동 남색. 왜 음원이 초록인지 답할 수 있는 사람이 없고, 여덟 색이 서로
// 경쟁해 아무것도 못 가리켰다(G-1·G-2).
//
// 지금은 **갈래를 `lib/broadcastKind.js` 에 묻고** 그 답으로 옷을 입는다. 이름과 아이콘만
// 여기 남는다. 그래서 차임벨·음원·영상은 색이 없다 — 색은 "무슨 소리인가"에만 쓴다.
// 통합 홈 캘린더(`tone='v3'`)가 쓰던 규칙과 **같은 것**이라, 같은 방송이 화면마다
// 다른 색으로 보이는 일이 생기지 않는다.
//
// `auto`(자동 일과방송)는 `kindOfType` 에 없는 이 화면만의 열쇠라 따로 적는다 —
// 하루치를 접은 묶음이고 캘린더의 `kindOfItem` 이 흐름으로 보내는 것과 같은 자리다.
const 옷 = (kind) => KIND_STYLE[kind] ?? KIND_STYLE['']
const TYPE_STYLE = {
  text:         { label: 'TTS',    Icon: FileText,    ...옷(kindOfType('text')) },
  bgm:          { label: 'BGM',    Icon: Music2,      ...옷(kindOfType('bgm')) },
  audio:        { label: '음원',   Icon: Volume2,     ...옷(kindOfType('audio')) },
  chime:        { label: '차임벨', Icon: Bell,        ...옷(kindOfType('chime')) },
  video:        { label: '영상',   Icon: Video,       ...옷(kindOfType('video')) },
  flow:         { label: '흐름',   Icon: ListOrdered, ...옷(kindOfType('flow')) },
  auto:         { label: '자동',   Icon: Sunrise,     ...옷('flow') },
}

// 그래도 모르는 유형이 오면 **화면은 살아 있어야 한다.** 위 목록을 넓히는 것만으로는 부족하다 —
// 서버에 유형이 하나 더 생기는 날 이 화면이 또 죽는다. 이름은 유형 문자열을 그대로 보여준다.
const UNKNOWN_TYPE_STYLE = { label: '기타', Icon: FileText, bg: 'bg-ds-v3-bg', text: 'text-ds-v3-ink-2', dot: 'bg-ds-v3-ink-2' }

// **범례를 손으로 적지 않는다.** 칩 색과 같은 규칙에서 뽑는다.
// 처음엔 유형 이름을 손으로 적었는데, 그중 하나(당시의 TV 송출)는 `kindOfType` 이
// **음악(자주)** 으로 보냈다 — 칩은 자주인데 범례는 "색 없음"이라고 말하고 있었다(V③ 검수 2026-09-13 지적). 범례가 거짓말을 하면 색이 있으나 마나다.
// 이렇게 뽑으면 서버에 유형이 하나 더 생겨도 범례가 저절로 따라간다.
const V3_LEGEND = ['tts', 'bgm', 'flow', ''].map(kind => ({
  kind,
  // 자기 열쇠로 도는 자리라 없을 수가 없지만 **여기서도 기본값을 챙긴다** —
  // "이 조회는 안전하다"는 예외를 하나 허락하면 다음 조회도 그 예외로 들어온다.
  // 이름이 없으면 유형 문자열을 그대로 보여준다(`UNKNOWN_TYPE_STYLE` 과 같은 규칙).
  names: Object.keys(TYPE_STYLE)
    .filter(t => t !== 'auto' && kindOfType(t) === kind)
    .map(t => TYPE_STYLE[t]?.label ?? t),
})).filter(g => g.names.length > 0)

// 아이콘과 이름은 **양쪽이 같다** — 색만 가른다. 유형을 아이콘으로도 알아볼 수 있어야
// 색각 차이를 넘는다(색 하나로만 구분하면 그 차이에서 정보가 사라진다).
function chipStyle(item, v3) {
  const base = TYPE_STYLE[item._isAuto ? 'auto' : (item.broadcast_type || 'text')] ?? UNKNOWN_TYPE_STYLE
  if (!v3) return base
  return { ...base, ...옷(kindOfItem(item)) }
}

const AUTO_META = {
  morning:        { label: '아침 방송',        Icon: Sunrise,  },
  exercise:       { label: '국민체조',         Icon: Activity, },
  lunch:          { label: '식사전 체조(점심)', Icon: Utensils, },
  dinner:         { label: '식사전 체조(저녁)', Icon: Moon,     },
  evening_prayer: { label: '저녁 마무리',      Icon: Sunset,   },
}

const AUTO_IDS = ['morning', 'exercise', 'lunch', 'dinner', 'evening_prayer']

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ── **칩 크기는 자리마다 다르다** (사용자 지시 2026-09-16) ──────────────────────
// *"캘린더 밑에 자동방송이랑 매일방송 건 야 저건 인간적으로 너무 작지 않냐,
//   좀 더 키워 주변사이즈맞춰서"*
//
// **작았던 이유가 뒤집힌 중단점이다.** `tablet:` 은 `min-width: 834px`(이상)이라,
// 큰 값(14px)이 **폰**에 먹고 작은 값(11px)이 **PC**에 먹고 있었다 — 화면이 넓을수록
// 글씨가 작아지는 셈이다. 사진을 찍은 PC 화면이 딱 그 11px 이었다.
//
// **그렇다고 그냥 키우면 안 된다.** 월 달력 한 칸은 `min-h-[104px]` 안에 칩 여럿을
// 담아야 해서 거기서는 11px 이 필요하다. 키울 곳과 아닌 곳이 다르다.
//
// 그래서 **크기를 자리가 정한다**(`큼`). 달력 칸 안은 그대로 촘촘하게, 「고른 날 목록」과
// 주 보기 줄은 옆에 있는 글자(13~15px)에 맞춰 키운다. 셋이 같은 표를 보므로
// 한 칩만 커지는 일이 안 생긴다.
const 칩크기 = (큼) => 큼
  ? 'px-3 py-2 min-h-[38px] text-[14px] '
  : 'px-2.5 py-2 min-h-[38px] text-[14px] tablet:px-1.5 tablet:py-1 tablet:min-h-[24px] tablet:text-[11px] '
const 칩아이콘 = (큼) => (큼 ? 15 : 13)
const 칩아이콘칸 = (큼) => (큼 ? 'shrink-0' : 'shrink-0 tablet:w-[10px] tablet:h-[10px]')

// 1차·2차로 나뉜 같은 방송(환기방송)은 한 칩으로 접는다 — 오늘방송일정과 같은 규칙이다.
// 접기 전에는 환기방송만으로 한 요일이 여섯 칸을 차지해, 실제로 하는 일보다 훨씬
// 복잡해 보였다. 누르면 1차가 열린다(편집은 1차부터가 자연스럽다).
function BroadcastChip({ items, onChipClick, onDragStart, compact, v3, 큼 = false }) {
  const item      = items[0]
  const last      = items[items.length - 1]
  const batched   = items.length > 1
  const style     = chipStyle(item, v3)
  const Icon      = item._isAuto ? (AUTO_META[item._autoId]?.Icon ?? Sunrise) : (style?.Icon ?? FileText)
  const paused    = !item._isAuto && !item.active
  // **버튼으로 알려 준다.** 그냥 div 면 접근성 트리에 글자로만 잡혀서 키보드로 못 누르고
  // 화면 낭독기도 "누를 수 있는 것"으로 안 읽는다(UX-42). 2026-09-11 실제로 그랬다 —
  // 브라우저 접근성 스냅샷에 이 칩들이 StaticText 로만 나왔다.
  // **묶음이면 묶음 전체를 넘긴다.** 예전엔 `items[0]` 한 건만 넘겨서, 칩에는 "2건"이라
  // 적어 놓고 상세 팝업의 삭제는 1차만 지웠다(2026-09-11 독립 검수 지적).
  // 현장 예약은 전부 환기방송 시작·종료 쌍이라, 그러면 "여세요"만 나가고 "닫으세요"가 안 나간다.
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChipClick(items, e) }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={batched ? `${item.title} 묶음 ${items.length}건 — 눌러서 자세히 보기`
                          : `${item.scheduled_time} ${item.title} — 눌러서 자세히 보기`}
      onKeyDown={onKey}
      draggable={!!onDragStart && !batched}
      onDragStart={batched ? undefined : onDragStart}
      onClick={(e) => { e.stopPropagation(); onChipClick(items, e) }}
      title={batched
        ? items.map(i => `${i.scheduled_time} ${i.title}`).join('\n')
        : `${item.scheduled_time} ${item.title}`}
      className={'flex items-center gap-1.5 rounded-md cursor-pointer '
        + 칩크기(큼)
        + `hover:brightness-95 transition-all ${style.bg} ${style.text} `
        + (paused ? 'opacity-50 line-through' : '')}
    >
      <Icon size={칩아이콘(큼)} className={칩아이콘칸(큼)} />
      <span className="nums font-semibold shrink-0">
        {batched ? `${item.scheduled_time}~${last.scheduled_time}` : item.scheduled_time}
      </span>
      <span className={`truncate ${compact ? 'max-w-[70px]' : 'max-w-[110px]'}`}>{item.title}</span>
      {batched && (
        <span className="ml-auto shrink-0 text-[9px] font-semibold px-1 rounded-full bg-white/70">
          {items.length}건
        </span>
      )}
    </div>
  )
}

// ── **매일 반복 예약도 하루에 한 칩으로 접는다** (사용자 지시 2026-09-14) ────────
// 현장의 환기방송은 매일 3쌍(6건)이다. 그것이 날짜 칸마다 여섯 줄로 펼쳐지면 달력이
// 환기방송으로 뒤덮여 **정작 그날 특별한 예약이 안 보인다** — 자동방송 5종을 접은 것과
// 똑같은 이유다(UX-24).
//
// **이름으로 고르지 않는다.** 「환기방송」이라는 글자를 찾으면 이름을 바꾼 순간 안 접히고,
// 다른 시설에서는 아예 안 걸린다. **반복 규칙**으로 고른다 — 요일 일곱이 다 켜져 있으면
// 매일이다. 그 날짜에 실제로 도는지는 이미 `runsOnDate` 가 걸러서 들어온다.
//
// 자동방송과 **겹쳐 세지 않는다**: `_isAuto` 는 여기 오기 전에 빠진다.
function 매일예약인가(s) {
  return !s._isAuto && parseWeekdays(s.repeat_weekdays).length === 7
}

// 매일 반복 예약을 한 칩으로. **자동방송 칩과 색을 달리한다** — 둘은 다른 것이다
// (자동 5종은 `settings` 가 돌리고, 이쪽은 `schedules` 표의 진짜 예약 행이라
// 펼치면 고치고 지울 수 있다).
function DailyChip({ items, onClick, v3, 이웃달 = false, 큼 = false }) {
  const skin = (v3
    ? 'bg-ds-v3-tts-bg text-ds-v3-tts border border-ds-v3-tts-line'
    : 'bg-ds-v3-bg text-ds-v3-ink-2 border border-ds-v3-line')
    // 이웃 달이면 **배경만** 비운다 — 글자·테두리는 그대로다(대비 실측은 MonthDayCell 주석).
    + (이웃달 ? ' !bg-transparent' : '')
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`매일 방송 ${items.length}건 — 눌러서 목록 보기`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(items, e) }
      }}
      onClick={(e) => { e.stopPropagation(); onClick(items, e) }}
      title={items.map(i => `${i.scheduled_time} ${i.title}`).join('\n')}
      className={'flex items-center gap-1.5 rounded-md cursor-pointer '
        + 칩크기(큼)
        + 'hover:brightness-95 transition-all ' + skin}
    >
      <Repeat size={칩아이콘(큼)} className={칩아이콘칸(큼)} />
      <span className="font-semibold truncate">매일 방송 {items.length}건</span>
    </div>
  )
}

// 자동방송 5종을 하루에 한 칩으로 접는다 (UX-24).
// **개수를 하드코딩하지 않는다** — 켜져 있는 것만 세므로 4종이면 4종으로 나온다.
function AutoChip({ items, onClick, v3, 이웃달 = false, 큼 = false }) {
  // 자동방송 5종은 **흐름**이다 — 규칙은 `kindOfItem` 한 곳에 있다.
  const skin = (v3
    ? 'bg-ds-v3-flow-bg text-ds-v3-flow border border-ds-v3-flow-line'
    : 'bg-ds-v3-tts-bg text-ds-v3-tts border border-ds-v3-line')
    + (이웃달 ? ' !bg-transparent' : '')
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`자동방송 ${items.length}종 — 눌러서 구성 보기`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(items, e) }
      }}
      onClick={(e) => { e.stopPropagation(); onClick(items, e) }}
      title={items.map(i => `${i.scheduled_time} ${i.title}`).join('\n')}
      className={'flex items-center gap-1.5 rounded-md cursor-pointer '
        + 칩크기(큼)
        + 'hover:brightness-95 transition-all ' + skin}
    >
      <Sunrise size={칩아이콘(큼)} className={칩아이콘칸(큼)} />
      <span className="font-semibold truncate">자동방송 {items.length}종</span>
    </div>
  )
}

// ── 월간 칸 ────────────────────────────────────────────────────────────────
// 예전엔 점 + 건수만 보여줬다. 사용자 지시대로 **제목·시각 칩**을 보여준다(UX-20).
/**
 * ── 좁은 화면의 **점 요약** (사용자 지시 2026-09-15) ────────────────────────────
 * *"핸드폰에서 캘린더 화면을 ui를 모바일 전용으로 하나 만들까봐 저렇게 애플에 위에
 *   일정 떠주고 누르면 나오게끔 … 그대로 웹 들어오니까 꾸져보이잖아."*
 *
 * 휴대폰에서 한 칸이 약 51px 인데 칸마다 제목·시각 칩을 쌓고 있었다. 글자가 뭉개지고
 * 칸 높이가 104px 이라 한 화면에 두 주도 안 들어왔다.
 *
 * 애플 달력처럼 **위에는 점만, 누르면 아래에 그날 목록**이다. 점은 갈래 색 셋을 쓴다
 * (`KIND_STYLE` — 이 화면의 색은 그 표 하나가 정한다). 넷 이상이면 셋만 찍는다 —
 * 점을 세는 자리가 아니라 **"무엇인가 있다"를 보는 자리**다.
 */
function 점요약({ items }) {
  // 갈래별로 하나씩만 찍는다. 같은 색 점이 다섯 개면 그냥 얼룩으로 보인다.
  const 갈래 = [...new Set(items.map(x => (x._isAuto ? 'flow' : kindOfItem(x))))].slice(0, 3)
  if (갈래.length === 0) return null
  return (
    // 점도 **넓은 화면에서는 키운다** — 5px 은 390px 폰에 맞춘 값이라 카드 옆
    // 640px 자리에서는 먼지처럼 보인다(사용자 지적 2026-09-15).
    <div className="flex items-center justify-center gap-[3px] laptop:gap-1" aria-hidden="true">
      {갈래.map((k, i) => (
        <span key={i} className={'h-[5px] w-[5px] laptop:h-[6px] laptop:w-[6px] rounded-full '
          + (KIND_STYLE[k] || KIND_STYLE['']).dot} />
      ))}
    </div>
  )
}

function MonthDayCell({ date, isToday, 지난날 = false, isCurrentMonth, autoItems, dailyItems = [],
                        chips, expanded,
                        onExpand, onEmptyClick, onChipClick, onAutoClick, onDragStart,
                        onDragEnter, onDragLeave, onDrop, dragOver, v3,
                        점만 = false, 선택됨 = false, onSelect }) {
  const dow       = date.getDay()
  const isWeekend = dow === 0 || dow === 6
  const LIMIT     = 3
  const shown     = expanded ? chips : chips.slice(0, LIMIT)
  const hidden    = chips.length - shown.length

  // 끌어오는 동안 **어느 칸에 놓이는지** 보여야 한다. 예전엔 onDragEnter 배선이 아예 없어
  // 화면이 아무 반응도 안 했다(2026-09-11 브라우저 확인에서 발견).
  //
  // 이웃 달 칸은 **흐림(opacity)으로 가르지 않는다**(UX-42, 2026-09-12 실측).
  // `opacity-45` 였는데, 이 칸은 눌러서 예약을 추가할 수 있는 **살아 있는 칸**이라
  // 흐린 글자가 그대로 대비 미달이 된다(날짜 2.83 · 안의 칩 2.12). 흐림을 걷고
  // 바탕색과 **점선 테두리**로 가른다 — 글자는 이번 달과 똑같이 또렷하다.
  // 한 속성(배경색)을 두 클래스로 주지 않는다. 나란히 적으면 어느 쪽이 이길지
  // 문자열 순서가 아니라 CSS 순서가 정해서 조용히 뒤집힌다.
  // ── 지난 날에는 **예약을 못 넣는다** (사용자 지시 2026-09-14) ────────────────────
  // *"지난 날짜에도 방송 등록하게 하면 어떻게 하냐"* — 맞다. 앞서 «막지 않는다» 로
  // 두었던 판단을 거둔다. 지난 날짜에 1회성 예약을 넣으면 **그 예약은 영영 안 나간다**
  // (`shouldRunToday` 가 시작일이 오늘일 때만 발동한다). 저장은 되는데 아무 일도
  // 안 일어나는 것 — 이 저장소가 가장 경계하는 조용한 실패다.
  // 칸 자체는 그대로 둔다(그날 무엇이 나갔는지 보는 자리다). 누르는 것만 막는다.

  // ── 좁은 화면: **점만 찍고, 누르면 고른다** ──────────────────────────────────
  // 넓은 화면과 **하는 일이 다르다** — 여기서 누르면 예약 추가가 아니라 **그날을 고르는**
  // 것이고, 목록은 달력 아래에 뜬다(애플 달력과 같은 결). 그래서 CSS 로 숨기는 것이
  // 아니라 **아예 다른 것을 그린다** — 누르면 다른 일이 나야 하므로 CSS 로는 못 한다.
  //
  // **지난 날도 고를 수 있다.** 넓은 화면에서 누르는 것을 막은 이유는 「예약 추가」가
  // 열리기 때문인데(지난 날에 1회성을 넣으면 영영 안 나간다), 여기서는 **보기만** 한다.
  // 그날 무엇이 나갔는지 보는 것을 막을 이유가 없다.
  if (점만) {
    return (
      <button type="button"
        onClick={onSelect}
        aria-pressed={선택됨}
        aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일`
          + (chips.length + autoItems.length + dailyItems.length > 0 ? ' — 방송 있음' : '')}
        // G-15 — 손으로 누르는 것은 44px 이상이다. 7칸이 390px 에 들어가야 하므로
        // 가로는 좁지만(약 51px) **세로로 48px** 을 줘서 손가락이 닿는 넓이를 만든다.
        //
        // ── **넓은 화면에서는 키운다** (사용자 지적 2026-09-15) ────────────────────
        // *"모바일에서 있던 거 그대로 갖고 오지 말고 적당히 크기 키워서."*
        // 이 접은 모습은 카드 옆(약 400~640px)에도 쓰이는데, 390px 폰에 맞춘 48px 칸을
        // 그대로 두니 **남는 자리에 비해 옹색했다.** `laptop:` 부터 칸을 키우고 날짜
        // 글자도 한 단 올린다 — 폰은 그대로다(거기서는 48px 이 맞는 값이다).
        className={'flex min-h-[48px] laptop:min-h-[60px] flex-col items-center justify-center '
          + 'gap-1 laptop:gap-1.5 rounded-[10px] laptop:rounded-[12px] '
          + 'border transition-colors '
          + (선택됨 ? 'border-ds-v3-ink bg-ds-v3-ink text-white'
            : isToday ? 'border-ds-v3-tts bg-ds-v3-tts-bg/50 text-ds-v3-ink'
            : !isCurrentMonth ? 'border-transparent text-ds-v3-ink-3'
            : 지난날 ? 'border-transparent text-ds-v3-ink-2'
            : 'border-transparent text-ds-v3-ink')}>
        <span className={'text-[13px] laptop:text-[15px] font-semibold tabular-nums '
          + (선택됨 ? '' : isWeekend ? 'text-ds-v3-warn' : '')}>
          {date.getDate()}
        </span>
        {/* 고른 칸에서는 점을 안 찍는다 — 진한 바탕 위에서 색점이 안 읽힌다.
            그 칸의 내용은 바로 아래 목록이 글자로 말하고 있다. */}
        {!선택됨 && <점요약 items={[...autoItems, ...dailyItems, ...chips.flatMap(c => c.items)]} />}
      </button>
    )
  }

  return (
    <div
      role={지난날 ? undefined : 'button'}
      tabIndex={지난날 ? -1 : 0}
      aria-label={지난날
        ? `${date.getMonth() + 1}월 ${date.getDate()}일 — 지나간 날입니다`
        : `${date.getMonth() + 1}월 ${date.getDate()}일 — 눌러서 예약 추가`}
      title={지난날 ? '지나간 날에는 예약을 넣을 수 없습니다' : undefined}
      onKeyDown={(e) => { if (!지난날 && e.key === 'Enter') { e.preventDefault(); onEmptyClick(e) } }}
      onClick={지난날 ? undefined : onEmptyClick}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move' } catch { /* 일부 브라우저는 던진다 */ } }}
      onDrop={onDrop}
      className={`rounded-xl border min-h-[104px] p-1.5 transition-colors flex flex-col gap-1
        ${지난날 ? 'cursor-default' : 'cursor-pointer'}
        ${dragOver ? 'ring-2 ring-ds-v3-tts bg-ds-v3-tts-bg border-ds-v3-tts' :
          isToday ? 'border-ds-v3-tts bg-ds-v3-tts-bg/40' :
          지난날 ? 'border-ds-v3-line bg-ds-v3-bg/70 hover:bg-ds-v3-bg' :
          !isCurrentMonth ? 'border-ds-v3-line border-dashed bg-ds-v3-bg hover:bg-ds-v3-line/40' :
          'border-ds-v3-line bg-white hover:bg-ds-v3-bg/60'}`}
    >
      {/* ── 지난 날은 **한눈에 지나간 것으로 보인다** (사용자 지시 2026-09-13) ──────────
          *"캘린더에 센스있게 지난 날짜는 비활성화 표시 해주던지"*
          **누르는 것 자체는 막지 않는다** — 지난 날짜에도 예약을 넣을 수 있어야 하는
          경우가 있고(요일 반복의 시작일을 뒤로 잡는 등), 막으면 사람이 우회로를 찾는다.
          그래서 «못 누르게» 가 아니라 «지나갔다고 보이게» 다: 바탕을 한 톤 내리고 날짜
          숫자를 잉크2 로 낮춘다. **잉크3 까지 내리지 않는다** — 그 아래는 대비 미달이고,
          이웃 달 칸을 흐림에서 뺀 것과 같은 이유다(UX-42). */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
        isToday ? 'bg-ds-v3-ink text-white'
          : 지난날 ? (isWeekend ? 'text-ds-v3-warn/70' : 'text-ds-v3-ink-2')
          : isWeekend ? 'bg-ds-v3-warn-bg text-ds-v3-warn'
          : 'text-ds-v3-ink'
      }`}>
        {date.getDate()}
      </div>

      {/* ── 이웃 달 칸의 칩은 **배경만 비운다** (사용자 지적 2026-09-15) ──────────────────
          *"다음달에 해당하는 1,2,3 은 배경 투명하게"* — 10월 칸에 9월과 똑같이 꽉 찬 칩이
          서 있으면 **어디까지가 이번 달인지 흐려진다.**
          **글자는 안 흐린다.** 2026-09-12 실측에서 `opacity-45` 를 걷은 이유가 그것이다 —
          이 칸은 눌러서 쓰는 **살아 있는 칸**인데 흐린 글자가 대비 미달이 됐다
          (날짜 2.83 · 칩 2.12). 배경만 비우면 **조용해지면서 글자는 또렷하다.** */}
      {autoItems.length > 0 && <AutoChip items={autoItems} onClick={onAutoClick} v3={v3} 이웃달={!isCurrentMonth} />}
      {/* 매일 반복 묶음. **누르면 그날의 개별 예약 목록**이 뜬다(자동방송 칩과 달리 고칠 수 있다). */}
      {dailyItems.length > 0 && <DailyChip items={dailyItems} onClick={onChipClick} v3={v3} 이웃달={!isCurrentMonth} />}

      {shown.map((b, i) => (
        <BroadcastChip key={i} items={b.items} compact v3={v3}
          onChipClick={onChipClick}
          onDragStart={(e) => onDragStart(b.items[0], e)} />
      ))}

      {hidden > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onExpand() }}
          className="text-[10px] text-ds-v3-ink-2 hover:text-ds-v3-tts text-left px-1">
          + {hidden}개 더 보기
        </button>
      )}
      {expanded && chips.length > LIMIT && (
        <button onClick={(e) => { e.stopPropagation(); onExpand() }}
          className="text-[10px] text-ds-v3-ink-2 hover:text-ds-v3-tts text-left px-1">
          접기
        </button>
      )}
    </div>
  )
}

function DayCard({ date, isToday, items, 자동보임 = false, onChipClick, onEmptyClick, onAutoClick, onDragStart, onDragEnter, onDragLeave, onDrop, dragOver, v3 }) {
  const dow       = date.getDay()
  const isWeekend = dow === 0 || dow === 6
  // 월간과 **같은 규칙**이다 — 날마다 같은 칩을 늘 세워 두면 그 주가 안 읽힌다
  const autoItems  = 자동보임 ? items.filter(i => i._isAuto) : []
  const 나머지      = items.filter(i => !i._isAuto)
  // 월간과 **같은 규칙**이다(같은 판정 함수를 쓴다) — 화면마다 다르면 같은 날이 달리 보인다.
  const dailyItems = 자동보임 ? 나머지.filter(매일예약인가) : []
  const rest       = batchSchedules(
    자동보임 ? 나머지.filter(x => !매일예약인가(x)) : 나머지, 'scheduled_time')
  // ── **주 보기는 목록이다** (사용자 지시 2026-09-16) ──────────────────────────
  // *"캘린더 주 목록에서는 저게 불편하지 … 그냥 목록 처럼 하고 깔끔하게 하는게 나을것 같아"*
  //
  // 앞 판은 요일 일곱을 **가로로 나란히** 세웠다(`md:grid-cols-7`). 그러면 1400px 화면에서도
  // 하루가 190px 이라, 칩이 그 폭에 맞춰 작아져야 했다 — H1 에서 고친 11px 이 바로 그
  // 결과다. **칸을 키우려면 칸을 가로로 쪼개는 것을 그만둬야 한다.**
  //
  // 이제 하루가 **한 줄**이다. 왼쪽에 날짜, 오른쪽에 그날 방송이 옆으로 흐른다.
  // 세로로 길어지지만 **주는 원래 세로로 읽는 것**이고, 무엇보다 하루에 방송이 몇 건
  // 있든 줄 하나가 늘어날 뿐이라 칸 높이를 맞출 필요가 없다.
  //
  // 좁은 화면에서는 날짜 머리가 **위로 올라간다**(`tablet:` 아래) — 104px 을 떼어 주면
  // 폰에서 칩 자리가 안 남는다.
  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={'rounded-2xl border overflow-hidden transition-colors '
        + 'flex flex-col tablet:flex-row tablet:items-stretch '
        + (dragOver ? 'ring-2 ring-ds-v3-tts bg-ds-v3-tts-bg'
          : isToday ? 'border-ds-v3-tts bg-ds-v3-tts-bg/40' : 'border-ds-v3-line bg-white')}>
      <div className={'shrink-0 px-3 py-2.5 flex items-center gap-2 '
        + 'border-b tablet:border-b-0 tablet:border-r tablet:w-[132px] '
        + (isToday ? 'border-ds-v3-tts/20 bg-ds-v3-tts/5' : 'border-ds-v3-line')}>
        <div className={'w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0 '
          + (isToday ? 'bg-ds-v3-ink text-white'
            : isWeekend ? 'bg-ds-v3-warn-bg text-ds-v3-warn'
            : 'bg-ds-v3-bg text-ds-v3-ink-2')}>
          {date.getDate()}
        </div>
        <div className="min-w-0">
          <p className={'text-[13px] font-semibold leading-none '
            + (isToday ? 'text-ds-v3-tts' : isWeekend ? 'text-ds-v3-warn' : 'text-ds-v3-ink')}>
            {DAY_FULL[dow]}
          </p>
          <p className="text-[11px] text-ds-v3-ink-3 mt-1 nums">{date.getMonth() + 1}/{date.getDate()}</p>
        </div>
        {isToday && (
          <span className="ml-auto tablet:ml-0 text-[10px] font-semibold text-ds-v3-tts bg-ds-v3-tts/10 px-1.5 py-0.5 rounded-full">오늘</span>
        )}
      </div>

      {/* 칩이 **옆으로 흐르다 줄을 바꾼다** — 목록 줄은 폭이 넉넉해서 큰 칩(`큼`)이 들어간다. */}
      <div onClick={onEmptyClick}
        className="flex-1 min-w-0 p-2.5 flex flex-wrap items-center gap-1.5 cursor-pointer">
        {items.length === 0 ? (
          <p className="m-0 text-[13px] text-ds-v3-ink-3">눌러서 예약 추가</p>
        ) : (
          <>
            {/* 주간 보기다 — 이웃 달 개념이 없다(그 처리는 월간 `MonthDayCell` 에 있다). */}
            {autoItems.length > 0 && <AutoChip items={autoItems} onClick={onAutoClick} v3={v3} 큼 />}
            {dailyItems.length > 0 && <DailyChip items={dailyItems} onClick={onChipClick} v3={v3} 큼 />}
            {rest.map((b, i) =>
              <BroadcastChip key={i} items={b.items} onChipClick={onChipClick} v3={v3} 큼
                onDragStart={(e) => onDragStart(b.items[0], e)} />)}
          </>
        )}
      </div>
    </div>
  )
}

const VIEWS = [
  { id: 'month', label: '월', Icon: CalendarDays },
  { id: 'week',  label: '주', Icon: CalendarDays },
  { id: 'list',  label: '목록', Icon: List },
]

/**
 * @param {'easy'|'v3'} tone
 *   `easy`(기본) — 관리자 화면의 지금 모습 그대로. 유형 색 여덟.
 *   `v3`         — 통합 홈 캘린더 탭. **색 셋**으로 접는다(사용자 결정 2026-09-13).
 *   **기능은 하나도 안 갈린다** — 보기 전환·끌어 옮기기·팝업·일시정지·자동방송 접기
 *   전부 같은 코드를 지난다. 두 벌로 두면 한쪽만 고쳐지는 날이 온다.
 */
/**
 * @param {'month'|'week'|'list'} [초기보기] 처음 열릴 보기. 주소의 `?view=` 가 준다.
 *   **모르는 값은 무시한다** — 오타 하나로 빈 화면이 뜨면 안 된다.
 */
export default function WeeklySchedule({ tone = 'easy', 초기보기 }) {
  const v3 = tone === 'v3'
  const [schedules,    setSchedules]    = useState([])
  const [autoSchedule, setAutoSchedule] = useState(null)
  const [loading,      setLoading]      = useState(true)
  // **월간이 기본이다**(UX-19). 예전 기본값은 'week' 였다.
  //
  // ── 주소가 보기를 정할 수 있다 (2026-09-15) ────────────────────────────────
  // 간편화면의 「전체 예약 관리」가 `/calendar?view=list` 로 보낸다. 그전에는 이 값을
  // **아무도 안 읽어서** 그 링크가 월간 화면으로 떨어졌다 — 이 저장소가 가장 경계하는
  // 「조용히 엉뚱한 화면」이다. 이름이 「전체 예약 관리」인데 달력이 뜨면 이름과 도착지가
  // 갈린다(머리줄 탭에서 같은 실수를 이미 한 번 했다).
  const [viewMode,     setViewMode]     = useState(
    VIEWS.some(v => v.id === 초기보기) ? 초기보기 : 'month')

  // ── 보기를 바꿔도 **도구줄이 있던 자리에 그대로 있게** 한다 (사용자 지적 2026-09-13) ──
  //
  // *"월 주 목록 누를 때마다 이동하면 어쩌라는거야 위치를 내가 따라가야하냐"* — 맞다.
  // 월간은 격자가 길고 목록은 짧아서 **문서 높이가 크게 달라진다.** 아래쪽에서 「목록」을
  // 누르면 문서가 짧아지며 브라우저가 스크롤을 끝까지 당기고, 방금 누른 단추가 손가락
  // 밑에서 사라진다. 다시 「월」을 누르려면 그 단추를 **찾아 올라가야** 한다.
  //
  // 그래서 누르기 직전에 도구줄이 창에서 몇 px 에 있었는지 적어 두고, 다시 그린 **직후**
  // (그리기 전, `useLayoutEffect`) 그 자리로 되돌린다. 화면이 깜빡이지 않는다.
  const 도구줄ref = useRef(null)
  const 되돌릴자리 = useRef(null)
  const 보기바꾸기 = (id) => {
    되돌릴자리.current = 도구줄ref.current?.getBoundingClientRect().top ?? null
    setViewMode(id)
  }
  useLayoutEffect(() => {
    const 아까 = 되돌릴자리.current
    되돌릴자리.current = null
    if (아까 == null || !도구줄ref.current) return
    const 지금 = 도구줄ref.current.getBoundingClientRect().top
    if (Math.abs(지금 - 아까) > 1) window.scrollBy(0, 지금 - 아까)
  }, [viewMode])
  const [startOffset,  setStartOffset]  = useState(0)
  const [monthOffset,  setMonthOffset]  = useState(0)
  // ── 휴대폰 달력: **고른 날** (사용자 지시 2026-09-15) ─────────────────────────
  // 좁은 화면에서는 칸에 점만 찍고, 고른 날의 목록을 달력 **아래**에 편다(애플 달력 결).
  // `null` 이면 아무 날도 안 골랐다는 뜻이고, 그때는 안내 한 줄만 보인다.
  // 초안 카드가 열려 있나 — 열리면 달력을 감춘다(아래 주석 참고).
  const [초안열림, set초안열림] = useState(false)
  const [고른날, set고른날] = useState(null)   // dateKey 문자열 | null
  // **폭은 한 곳에서 판정한다**(`hooks/useWideScreen`). 여기서 `matchMedia` 를 또 쓰면
  // 기준 폭이 갈린다 — CSS 의 `tablet:` 과 같은 834 를 쓴다.
  const 좁은화면 = !useWideScreen()

  // ── **접어서 보는 때가 둘이다** (사용자 정정 2026-09-15) ──────────────────────
  // ① 좁은 화면 — 칸이 53px 이라 칩 글자가 뭉갠다
  // ② **카드가 열려 달력이 옆으로 간 때** — 폭이 560px 카드에 밀려 절반이 된다
  // 둘 다 「칸에 점만 찍고, 누르면 그 아래 목록」이 맞다. **모습을 새로 그리지 않는다** —
  // ① 이 쓰던 길을 그대로 켠다. 두 벌로 만들면 한쪽만 고치는 날 갈린다.
  const 접어보기 = 좁은화면 || 초안열림
  const [editTarget,   setEditTarget]   = useState(null)   // ScheduleModal 로 여는 전체 편집
  const [toast,        setToast]        = useState('')
  const [expandedDays, setExpandedDays] = useState(() => new Set())
  const [scheduleVersion, setScheduleVersion] = useState(0)
  // 팝업 하나만 뜬다 — { kind, ... }
  const [popup,        setPopup]        = useState(null)
  // **끌기 정보는 ref 다(state 가 아니다).** state 로 두면 dragstart 에서 넣은 값이
  // 같은 틱의 drop 콜백에서는 아직 안 보인다 — 실제로 그래서 첫 판이 아무 일도 안 했다.
  // 끌기는 화면을 다시 그릴 필요가 없는 정보라 ref 가 맞다.
  const dragRef = useRef(null)                             // { item, fromDate }
  const [dragOverKey,  setDragOverKey]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([getSchedules(), getBroadcastSchedule()])
      // **일시정지한 예약도 달력에 보여준다.** 예전엔 걸러 냈는데, 그러면 사람이
      // "지웠나?" 하고 다시 만들어 중복이 생긴다. 흐리게·취소선으로 구분한다.
      setSchedules(s)
      setAutoSchedule(a)
    } catch (e) { console.error('[방송일정] 목록 불러오기 실패:', e.message) }  // 목록만 비고 화면은 뜬다
    finally { setLoading(false); setScheduleVersion(v => v + 1) }
  }, [])

  useEffect(() => { load() }, [load])

  // **다른 기기·다른 화면이 예약을 바꾸면 여기도 따라간다** (P-16, 2026-09-11).
  //
  // 전에는 이 화면이 자기가 한 변경만 알았다. 요양원은 현장 PC·직원 폰·관리자 화면을
  // **동시에** 보는데, 옆에서 지운 예약이 여기엔 그대로 남아 있었다 — 사람은 지웠다고
  // 믿고 화면은 있다고 말한다. 실제로 두 탭으로 재현했다(10초 뒤에도 남아 있었다).
  //
  // **내가 바꾼 것이면 건너뛴다.** 그 경우엔 이미 `load()` 를 불렀고, 여기서 또 읽으면
  // 목록이 한 번 깜빡인다.
  useEffect(() => {
    const 들을때 = (e) => { if (e.detail?.by !== TAB_ID) load() }
    window.addEventListener('carecast:schedules-updated', 들을때)
    return () => window.removeEventListener('carecast:schedules-updated', 들을때)
  }, [load])

  // `kind` 는 'ok' 아니면 'fail'. 실패는 **더 오래** 남긴다 — 2.5초는 "왜 안 옮겨졌지"를
  // 읽기에 짧다. 색만으로 가르지 않고 아이콘도 바꾼다(UX-42: 색만으로 상태를 구분하지 않는다).
  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(''), kind === 'fail' ? 6000 : 2500)
  }

  const todayBase = new Date()
  todayBase.setHours(0, 0, 0, 0)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayBase)
    d.setDate(todayBase.getDate() + startOffset + i)
    return d
  })

  // 월간 그리드 — 달력처럼 일~토 정렬, 앞뒤 다른 달 날짜로 주 단위를 채운다
  const monthBase = new Date(todayBase.getFullYear(), todayBase.getMonth() + monthOffset, 1)
  const monthDays = (() => {
    const firstDay  = new Date(monthBase.getFullYear(), monthBase.getMonth(), 1)
    const lastDay   = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0)
    const gridStart = new Date(firstDay)
    gridStart.setDate(firstDay.getDate() - firstDay.getDay())
    const totalCells = Math.ceil((firstDay.getDay() + lastDay.getDate()) / 7) * 7
    return Array.from({ length: totalCells }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  })()

  const autoItems = autoSchedule
    ? AUTO_IDS
        .filter(id => autoSchedule[id]?.enabled)
        .map(id => ({
          id: `auto_${id}`,
          scheduled_time: autoSchedule[id].time,
          title: autoName(autoSchedule, id),
          broadcast_type: 'auto',
          active: 1,
          repeat_start_date: '2000-01-01',
          repeat_end_date: null,
          repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],
          _isAuto: true,
          _autoId: id,
        }))
    : []

  function itemsForDay(date) {
    return [...autoItems, ...schedules]
      .filter(s => runsOnDate(s, date))
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))
  }

  const isToday = (date) => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    return date.getTime() === t.getTime()
  }
  // ── 자동방송 칩은 **지나간 날에서만** 숨긴다 (사용자 정정 2026-09-14) ──────────────
  // 처음에 «둥둥 떠다닌다» 는 지적을 받고 **전부 접었더니** 그것도 틀렸다:
  // *"내가 언제 다 지우랬냐, 지나간 날짜만 지우라고"*.
  //
  // 맞는 말이다. 앞으로의 날에 자동방송이 보이는 것은 **정보**다 — 그 시각에 예약을
  // 넣어도 되는지(소리가 겹치는지)를 그 칸에서 바로 본다. 지나간 날에 보이는 것만
  // 정보가 아니다: 이미 끝난 일이고, 30칸에 같은 칩이 반복되어 «이날 뭐가 달랐나» 를 덮는다.
  //
  // 그래서 판정은 하나다 — **지난 날인가.** 켜고 끄는 손잡이는 두지 않는다(설정이 하나
  // 늘면 사람이 그것을 또 배워야 하고, 여기서는 옳은 답이 하나뿐이다).

  // 지난 날 — **오늘보다 앞인 날**. 오늘은 포함하지 않는다(오늘은 아직 방송이 남아 있다).
  const 지난날 = (date) => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    return date.getTime() < t.getTime()
  }

  const weekLabel = startOffset === 0 ? '이번 주'
    : startOffset < 0 ? `${Math.abs(startOffset / 7)}주 전`
    : `${startOffset / 7}주 후`

  const monthLabel = `${monthBase.getFullYear()}년 ${monthBase.getMonth() + 1}월`

  // ── 팝업 열기 ────────────────────────────────────────────────────────────
  const anchorOf = (e) => ({ x: e.clientX, y: e.clientY })
  const openQuick  = (dateStr, e) => setPopup({ kind: 'quick',  dateStr, anchor: anchorOf(e) })
  // `items` 는 **배열**이다 — 묶음(1·2차)이면 여러 건이 들어온다.
  const openDetail = (items, dateStr, e) => setPopup({ kind: 'detail', items, dateStr, anchor: anchorOf(e) })
  const openAuto   = (items, dateStr, e) => setPopup({ kind: 'auto', items, dateStr, anchor: anchorOf(e) })

  const toggleExpand = (key) => setExpandedDays(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // ── 끌어 놓기 ────────────────────────────────────────────────────────────
  // **무엇이 바뀌는지는 `planMove()` 가 정한다.** 화면이 제 규칙을 또 만들면
  // 확인 문구와 실제 저장이 갈린다(server/test/schedule-move-plan.test.js).
  const beginDrag = (item, fromDate) => (e) => {
    dragRef.current = { item, fromDate }
    try { e.dataTransfer.effectAllowed = 'move' } catch { /* 일부 브라우저는 여기서 던진다 */ }
  }

  const dropOn = (toDate) => (e) => {
    e.preventDefault()
    setDragOverKey(null)
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    const plan = planMove(d.item, d.fromDate, dateKey(toDate))
    if (plan.kind === 'same') return                       // 아무 일도 안 한다
    setPopup({ kind: 'move', plan, item: d.item, anchor: { x: e.clientX, y: e.clientY } })
  }

  const applyMove = async () => {
    const { plan, item } = popup
    // **막은 계획은 여기서도 막는다.** 예전엔 팝업 버튼의 `disabled` 한 줄이 유일한 게이트라,
    // 그 줄을 지우는 순간 자동방송의 가짜 id(`auto_morning`)로 PUT 이 나갔다
    // (2026-09-11 독립 검수 지적). 판단은 `planMove`, 집행은 여기 — 둘 다 봐야 한다.
    if (!plan?.allowed || !plan.patch) return
    try {
      // **화면 전용 필드와 이중 인코딩을 걸러 낸다.** `item` 은 API 가 준 원본이라
      // `repeat_weekdays` 가 문자열(`"[1,2,3]"`)이고 `_isAuto` 같은 화면 전용 값이 섞여 있다.
      // 그대로 보내면 서버가 `JSON.stringify` 를 한 번 더 걸어 `"\"[]\""` 가 저장된다 —
      // 다음에 누가 그것을 읽으면 반복 요일이 빈 배열(=1회성)로 보인다.
      // 수정 모달은 이미 같은 정규화를 하고 있었다(`ScheduleModal.jsx` 의 `parseWeekdays`).
      const 깨끗한 = { ...item }
      for (const k of ['_isAuto', '_autoId', '_batch', '_batchOpen', '_batchNo']) delete 깨끗한[k]
      await updateSchedule(item.id, {
        ...깨끗한,
        repeat_weekdays: parseWeekdays(item.repeat_weekdays),
        ...plan.patch,
      })
      setPopup(null)
      showToast('일정을 옮겼습니다')
      load()
    } catch (err) {
      setPopup(null)
      // **저장이 안 됐으면 화면도 안 바뀐다** — `load()` 를 안 부르므로 칩이 원래 칸에 그대로
      // 남는다(브라우저로 확인: 500 을 주면 DB 도 화면도 옛 날짜 그대로).
      // 그런데 되돌아간 이유를 안 말하면 사람은 **자기가 잘못 놓은 줄 안다.**
      // 예전엔 `alert(err.message)` 였다 — 창을 막고, 서버가 준 원시 문구가 그대로 나갔다.
      // 이 화면에 이미 있는 토스트로 통일한다(UX-10 오류 규약·UX-42 표시 규칙).
      if (err.cancelled) return
      const 자세히 = String(err.message || '').trim()
      showToast('옮기지 못해 원래 날짜로 되돌렸습니다.' + (자세히 ? ` (${자세히})` : ''), 'fail')
    }
  }

  return (
    <div className="space-y-5">
      {/* 실패는 보조기기에도 알려야 한다 — `role=alert` 면 읽어 준다. 성공은 `status` 로
          조용히 알린다(하던 일을 끊지 않는다). 색·아이콘·글 셋으로 가른다(UX-42). */}
      {toast && (
        <div role={toast.kind === 'fail' ? 'alert' : 'status'}
          className={`fixed top-20 left-1/2 -translate-x-1/2 z-[300] text-white text-sm px-4 py-2
                      rounded-full shadow-lg flex items-center gap-2 max-w-[calc(92vw/var(--cc-zoom,1))]
                      ${toast.kind === 'fail' ? 'bg-ds-v3-warn' : 'bg-ds-v3-ink-3'}`}>
          {toast.kind === 'fail' ? <AlertCircle size={13} className="flex-shrink-0" /> : <Check size={13} className="flex-shrink-0" />}
          <span>{toast.msg}</span>
        </div>
      )}

      <div ref={도구줄ref} className="flex items-center justify-between flex-wrap gap-3">
        <div>
          {/* 이름은 **캘린더**다 (사용자 지시 2026-09-13, 두 번째). 머리줄 탭도 「캘린더」이고
              주소도 `/calendar` 인데 제목만 옛 이름이라, 같은 화면을 두 이름으로 불렀다. */}
          <h1 className="t-section text-ds-v3-ink">캘린더</h1>
          <p className="t-sub text-ds-v3-ink-2 mt-1">
            빈 날짜를 누르면 예약을 추가하고, 일정을 누르면 내용을 보거나 고칠 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* `overflow-hidden` 은 둥근 모서리로 자식을 깎으려고 있는데, **포커스 링까지
              깎는다.** 링은 테두리 바깥 2px(offset)+2px(두께)에 그려지고 버튼은 이 상자의
              안쪽 면에 딱 붙어 있어, 키보드로 짚어도 링이 통째로 잘려 나간다(실측: 셋 다).
              그래서 이 안의 버튼만 링을 **안쪽에** 그린다 — 잘릴 것이 없어진다.
              전역 규칙(`index.css` 의 `:focus-visible`)은 offset 에 `!important` 를 안 걸어
              두었으므로 클래스 선택자가 이긴다. */}
          <div className="flex items-center border border-ds-v3-line rounded-btn overflow-hidden">
            {VIEWS.map(v => (
              <button key={v.id} onClick={() => 보기바꾸기(v.id)}
                className={`px-3 py-2 text-xs font-semibold transition-colors focus-visible:[outline-offset:-2px] ${
                  viewMode === v.id ? (v3 ? 'bg-ds-v3-ink text-white' : 'bg-ds-v3-ink text-white')
                                    : 'text-ds-v3-ink-2 hover:bg-ds-v3-bg'}`}>
                {v.label}
              </button>
            ))}
          </div>

          {/* ── 날짜 이동 칸은 **비어도 자리를 지킨다** (사용자 지적 2026-09-13) ──────────
              *"월/주/목록 누를 때마다 도망간다고, 어디다가 고정해놔야지"* — 맞다.
              이 줄은 오른쪽 끝에 붙어 있는데, 「목록」에는 «← 이전 / 2026년 9월 / 다음 →»
              이 없다. 그 셋이 사라지면 **줄 전체가 짧아지면서 보기 전환 단추가 오른쪽으로
              끌려간다** — 방금 누른 자리에 이제 다른 것이 있다. 다시 「월」로 돌아오려면
              단추를 눈으로 찾아야 한다.
              그래서 이 칸의 **최소 폭을 고정**한다. 안이 비어도 폭은 그대로라 보기 전환
              단추가 늘 같은 자리에 있다. 「이번 달」·「오늘」이 붙었다 떨어지는 것까지
              품는 폭이다(실측으로 잡았다). 좁은 화면에서는 줄이 접히므로 안 건다. */}
          <div className="flex items-center gap-2 tablet:min-w-[332px]">
          {viewMode === 'month' && (
            <>
              <button onClick={() => setMonthOffset(o => o - 1)}
                className="px-3 py-2 text-xs text-ds-v3-ink-2 border border-ds-v3-line rounded-btn hover:bg-ds-v3-bg transition-colors btn-press">
                ← 이전
              </button>
              <span className="text-sm font-semibold text-ds-v3-ink w-[110px] text-center nums">{monthLabel}</span>
              <button onClick={() => setMonthOffset(o => o + 1)}
                className="px-3 py-2 text-xs text-ds-v3-ink-2 border border-ds-v3-line rounded-btn hover:bg-ds-v3-bg transition-colors btn-press">
                다음 →
              </button>
              {monthOffset !== 0 && (
                <button onClick={() => setMonthOffset(0)}
                  className="px-3 py-2 text-xs text-ds-v3-tts border border-ds-v3-tts/30 bg-ds-v3-tts-bg rounded-btn hover:bg-ds-v3-tts-bg transition-colors btn-press">
                  이번 달
                </button>
              )}
            </>
          )}

          {viewMode === 'week' && (
            <>
              <button onClick={() => setStartOffset(o => o - 7)}
                className="px-3 py-2 text-xs text-ds-v3-ink-2 border border-ds-v3-line rounded-btn hover:bg-ds-v3-bg transition-colors btn-press">
                ← 이전
              </button>
              <span className="text-sm font-semibold text-ds-v3-ink w-16 text-center">{weekLabel}</span>
              <button onClick={() => setStartOffset(o => o + 7)}
                className="px-3 py-2 text-xs text-ds-v3-ink-2 border border-ds-v3-line rounded-btn hover:bg-ds-v3-bg transition-colors btn-press">
                다음 →
              </button>
              {startOffset !== 0 && (
                <button onClick={() => setStartOffset(0)}
                  className="px-3 py-2 text-xs text-ds-v3-tts border border-ds-v3-tts/30 bg-ds-v3-tts-bg rounded-btn hover:bg-ds-v3-tts-bg transition-colors btn-press">
                  오늘
                </button>
              )}
            </>
          )}
          </div>{/* ── 날짜 이동 칸 끝 (비어도 폭을 지킨다) ── */}

          <button onClick={load} aria-label="새로고침"
            className="p-2 text-ds-v3-ink-2 border border-ds-v3-line rounded-btn hover:bg-ds-v3-bg transition-colors btn-press">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setEditTarget({})}
            className={'flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white transition-colors btn-press '
              + (v3 ? 'bg-ds-v3-ink hover:bg-black rounded-full' : 'bg-ds-v3-tts hover:bg-ds-v3-ink rounded-btn')}>
            <Plus size={14} />
            예약 추가
          </button>
        </div>
      </div>

      {/* 자연어 한 줄로 예약 만들기 — 모달을 채워서 열어주고, 저장은 사람이 확인 후.
          ── **폭을 홈과 맞춘다** (사용자 지적 2026-09-15) ───────────────────────────────
          `v3` 일 때 폭 제한이 **아예 없어서**(빈 문자열) 화면 끝까지 늘어났다.
          1480px 화면에서 가로세로 비가 **17:1** 이다 — 홈에서 「넓데데」로 지적받아
          720 → 560 으로 좁힌 그 문제가 **여기만 안 고쳐져 있었다.**
          같은 값(560)을 쓴다. 홈과 캘린더가 같은 부품을 다른 폭으로 쓰면
          같은 것을 두 번 배워야 한다.
          **왼쪽에 붙인다** — 가운데 정렬이면 아래 달력(가득 찬 폭)과 축이 어긋난다. */}
      {/* ── **카드가 열리면 달력이 옆으로 간다** (사용자 정정 2026-09-15) ──────────────
          *"내가 이 텅 빈 이곳에 오른쪽 모바일처럼 만들라고 했잖아."*

          앞 판은 카드가 열리면 달력을 **감췄다.** 그런데 감추면 카드 오른쪽이 통째로
          빈다 — 1480px 화면에서 560px 카드 옆 900px 이 아무것도 아닌 것이 된다.
          그리고 **예약을 만드는 중에 달력을 못 본다**는 것이 원래 문제였는데, 감추면
          그 문제가 그대로 남는다(밀려 내려간 것이 사라진 것으로 바뀔 뿐이다).

          그래서 **옆으로 옮기고 휴대폰과 같은 모습으로 접는다** — 칸에 점만 찍고,
          누르면 그 아래에 그날 목록이 펼쳐진다. 그 모습은 **이미 만들어 둔 것**이라
          새로 그리지 않는다(`좁은화면` 이 쓰던 길을 그대로 켠다).

          좁은 화면에서는 격자를 안 만든다 — 거기는 원래 한 칸이고 이미 그 모습이다. */}
      <div className={'grid items-start gap-5 '
        // **`wide`(1440)가 아니라 `laptop`(1024)이다.** 처음에 `wide` 로 걸었더니
        // 1280·1413 화면에서 **아무 일도 안 일어났다**(사용자 사진이 그 폭이다).
        // 재 보면 1024 에서도 들어간다 — 카드 560 + 사이 20 을 빼고 달력에 약 400px 이
        // 남는데, 접어 보는 모습은 **원래 390px 폰에서 쓰라고 만든 것**이라 딱 맞는다.
        + (초안열림 ? 'laptop:grid-cols-[minmax(0,560px)_minmax(0,1fr)]' : 'grid-cols-1')}>
        <div className={v3 ? 'w-full max-w-[560px]' : ''}>
          <QuickSchedulePhrase onAdded={load} tone={tone} onDraftChange={set초안열림}
            className={v3 ? '' : 'max-w-2xl'} />
        </div>

      {/* 격자의 둘째 칸 — 달력이다. **지우지 않는다**(감추지도 않는다):
          부품이 그대로 살아 있어야 **취소했을 때 보던 달과 고른 날이 그대로 돌아온다.**
          걷어내면 이번 달로 튕긴다. */}
      <div className="space-y-5">
      {loading ? (
        <div className="text-center py-16 text-ds-v3-ink-2 text-sm">불러오는 중...</div>
      ) : viewMode === 'list' ? (
        // 예전에 달력 아래 늘 펼쳐져 있던 "예약방송관리"다. 없애라는 지시였지만
        // 그 안의 기능(일시정지·묶음 접기·자동방송 즉시실행·집계)을 잃으면 안 되므로
        // 기본으로는 안 보이게 하고 이 탭으로 옮겼다(UX-21).
        <ScheduledBroadcast embedded onChanged={load} refreshKey={scheduleVersion} />
      ) : viewMode === 'week' ? (
        // **어느 폭에서도 세로 목록이다**(2026-09-16). 예전엔 넓은 화면에서만 7열이었고
        // 폰에서 세로로 접었는데, 넓은 화면의 7열이 바로 칩을 작게 만든 원인이었다
        // (`DayCard` 머리말). 이제 폰이든 PC든 하루가 한 줄이라 **폭에 따라 다른 화면을
        // 보는 일이 없다** — 월간뷰는 달력이라 그대로 7열이다.
        <div className="flex flex-col gap-2">
          {days.map((d, i) => {
            const key = dateKey(d)
            return (
              <DayCard
                key={i}
                date={d}
                isToday={isToday(d)}
                자동보임={!지난날(d)}
                items={itemsForDay(d)}
                dragOver={dragOverKey === key}
                onChipClick={(items, e) => openDetail(items, key, e)}
                onAutoClick={(items, e) => openAuto(items, key, e)}
                onEmptyClick={(e) => openQuick(key, e)}
                onDragStart={(item, e) => beginDrag(item, key)(e)}
                onDragEnter={() => setDragOverKey(key)}
                onDragLeave={() => setDragOverKey(k => (k === key ? null : k))}
                onDrop={dropOn(d)}
                v3={v3}
              />
            )
          })}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_FULL.map((d, i) => (
              <div key={i} className={`text-center text-[11px] font-semibold py-1 ${
                i === 0 || i === 6 ? 'text-ds-v3-warn' : 'text-ds-v3-ink-2'}`}>
                {d[0]}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthDays.map((d, i) => {
              const key   = dateKey(d)
              const all   = itemsForDay(d)
              const autos   = all.filter(x => x._isAuto)
              const 나머지   = all.filter(x => !x._isAuto)
              const dailies = 나머지.filter(매일예약인가)
              // **접힌 것은 낱개로 또 그리지 않는다** — 그러면 같은 방송이 두 번 세어진다.
              const chips   = batchSchedules(나머지.filter(x => !매일예약인가(x)), 'scheduled_time')
              return (
                <MonthDayCell
                  key={i}
                  date={d}
                  isToday={isToday(d)}
                  지난날={지난날(d)}
                  isCurrentMonth={d.getMonth() === monthBase.getMonth()}
                  autoItems={지난날(d) ? [] : autos}
                  // 지난 날에는 요약을 안 보인다 — **자동방송과 같은 날짜 기준**(사용자 지시).
                  // 표시만 감추는 것이고 예약·이력·반복 규칙은 그대로다.
                  dailyItems={지난날(d) ? [] : dailies}
                  chips={chips}
                  expanded={expandedDays.has(key)}
                  dragOver={dragOverKey === key}
                  onExpand={() => toggleExpand(key)}
                  onEmptyClick={(e) => openQuick(key, e)}
                  onChipClick={(items, e) => openDetail(items, key, e)}
                  onAutoClick={(items, e) => openAuto(items, key, e)}
                  onDragStart={(item, e) => beginDrag(item, key)(e)}
                  onDragEnter={() => setDragOverKey(key)}
                  onDragLeave={() => setDragOverKey(k => (k === key ? null : k))}
                  onDrop={dropOn(d)}
                  v3={v3}
                  // ── 휴대폰: 점만 찍고 **고르기**로 쓴다 (사용자 지시 2026-09-15) ────
                  점만={접어보기}
                  선택됨={고른날 === key}
                  // 같은 날을 다시 누르면 접는다 — 달력을 다 보고 싶을 때가 있다.
                  onSelect={() => set고른날(v => (v === key ? null : key))}
                />
              )
            })}
          </div>

          {/* ── 고른 날의 목록 (휴대폰 전용) ────────────────────────────────────
              애플 달력과 같은 결이다 — **위에는 달력, 아래에는 그날 것**.
              *"저렇게 애플에 위에 일정 떠주고 누르면 나오게끔"*(사용자 2026-09-15).

              **여기서 새 목록을 만들지 않는다.** 위 격자가 쓰는 것과 **같은 칩 부품**을
              그대로 쓴다 — 누르면 같은 상세 팝업이 뜨고, 일시정지·묶음 접기도 그대로다.
              목록을 새로 그리면 그 기능들을 하나씩 잃는다(이 파일 머리말의 UX-21 과 같은 이유).

              넓은 화면에서는 **안 그린다** — 거기서는 칸 안에 칩이 이미 다 보인다. */}
          {접어보기 && (
            <div className="mt-3 border-t border-ds-v3-line pt-3">
              {!고른날 ? (
                <p className="m-0 py-4 text-center text-[13px] text-ds-v3-ink-3">
                  날짜를 누르면 그날 방송이 여기 보입니다.
                </p>
              ) : (() => {
                const 그날 = monthDays.find(d => dateKey(d) === 고른날)
                if (!그날) return null
                const all     = itemsForDay(그날)
                const autos   = 지난날(그날) ? [] : all.filter(x => x._isAuto)
                const 나머지   = all.filter(x => !x._isAuto)
                const dailies = 지난날(그날) ? [] : 나머지.filter(매일예약인가)
                const chips   = batchSchedules(나머지.filter(x => !매일예약인가(x)), 'scheduled_time')
                const 비었나 = autos.length + dailies.length + chips.length === 0
                return (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="m-0 text-[15px] font-semibold text-ds-v3-ink">
                        {그날.getMonth() + 1}월 {그날.getDate()}일 ({DAY_FULL[그날.getDay()][0]})
                      </h3>
                      {/* 지난 날에는 안 띄운다 — 1회성 예약을 넣으면 영영 안 나간다
                          (칸을 누르는 것을 막은 것과 **같은 이유**다). */}
                      {!지난날(그날) && (
                        <button type="button" onClick={(e) => openQuick(고른날, e)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full
                                     bg-ds-v3-ink px-4 text-[13px] font-semibold text-white btn-press">
                          <Plus size={14} /> 이 날 예약
                        </button>
                      )}
                    </div>
                    {비었나 ? (
                      <p className="m-0 py-3 text-[13px] text-ds-v3-ink-3">
                        {지난날(그날) ? '지나간 날입니다.' : '이 날에는 예약된 방송이 없습니다.'}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {autos.length > 0 && <AutoChip items={autos} onClick={(e) => openAuto(autos, 고른날, e)} v3={v3} 큼 />}
                        {dailies.length > 0 && <DailyChip items={dailies} onClick={(items, e) => openDetail(items, 고른날, e)} v3={v3} 큼 />}
                        {chips.map((b, i) => (
                          <BroadcastChip key={i} items={b.items} v3={v3} 큼
                            onChipClick={(items, e) => openDetail(items, 고른날, e)} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {viewMode !== 'list' && (
        /* 범례는 화면에 실제로 쓰인 색만 적는다 — v3 는 셋으로 접혔으므로 여덟을 나열하면
           있지도 않은 색을 설명하게 된다. 색 없는 유형도 **이름을 대고** 알려 준다
           ("음원·차임벨·영상"): 색이 없다는 것도 규칙이라 말해 줘야 한다. */
        <div className={'flex flex-wrap gap-3 px-1 ' + (v3 ? 'text-[13px] text-ds-v3-ink-2' : 'text-xs text-ds-v3-ink-2')}>
          <div className="flex items-center gap-1.5">
            <span className={v3 ? 'w-2.5 h-2.5 rounded-[3px] bg-ds-v3-flow-bg border border-ds-v3-flow-line'
                                : 'w-2.5 h-2.5 rounded-[3px] bg-ds-v3-tts-line border border-ds-v3-line'} />
            자동방송 <span className="opacity-70">(날마다 같은 시각 · 지나간 날에는 안 보입니다)</span>
          </div>
          {v3 ? (
            V3_LEGEND.map(({ kind, names }) => (
              <div key={kind || 'none'} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${옷(kind).dot}`} />
                {names.join(' · ')}
              </div>
            ))
          ) : (
            Object.entries(TYPE_STYLE).filter(([k]) => k !== 'auto').map(([key, s]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                {s.label}
              </div>
            ))
          )}
          <span className="ml-2">· 흐리게 표시된 것은 일시정지 상태입니다</span>
        </div>
      )}
      </div>{/* ── 달력 칸 끝 ── */}
      </div>{/* ── 검색창 + 달력 격자 끝 ── */}

      {/* ── 팝업들 ── */}
      {popup?.kind === 'quick' && (
        /* 겹침 경고는 「자세히 설정」에만 있었다(2026-09-12 브라우저 실측). 그런데 사람이
           실제로 쓰는 길은 **이 빠른 등록**이다 — 빈 날짜를 누르고 제목·시각·내용만 적고
           저장한다. 같은 분에 이미 방송이 있어도 아무 말이 없었다. 판정 규칙은
           `findScheduleOverlaps` 한 곳이므로, 비교 대상만 넘겨 주면 같은 경고가 나온다. */
        <QuickCreatePopup
          dateStr={popup.dateStr}
          anchor={popup.anchor}
          이미있는것={schedules}
          자동방송={autoSchedule}
          onClose={() => setPopup(null)}
          onCreated={(msg) => { setPopup(null); showToast(msg); load() }}
          onMoreOptions={(draft) => { setPopup(null); setEditTarget(draft) }}
        />
      )}

      {popup?.kind === 'detail' && (
        <EventDetailPopup
          items={popup.items}
          dateStr={popup.dateStr}
          anchor={popup.anchor}
          onClose={() => setPopup(null)}
          onEdit={(item) => { setPopup(null); setEditTarget(item) }}
          onChanged={load}
          onToast={showToast}
        />
      )}

      {popup?.kind === 'auto' && (
        <AutoGroupPopup
          items={popup.items}
          dateStr={popup.dateStr}
          anchor={popup.anchor}
          onClose={() => setPopup(null)}
          onGoAutoEditor={() => { setPopup(null); window.location.href = '/admin?section=morningEditor' }}
        />
      )}

      {popup?.kind === 'move' && (
        <MoveConfirmPopup
          plan={popup.plan}
          anchor={popup.anchor}
          onClose={() => setPopup(null)}
          onConfirm={applyMove}
        />
      )}

      {editTarget && (
        <ScheduleModal
          schedule={editTarget?.id ? editTarget : (Object.keys(editTarget).length > 0 ? editTarget : null)}
          onClose={() => setEditTarget(null)}
          onSave={() => { setEditTarget(null); showToast('저장되었습니다'); load() }}
        />
      )}
    </div>
  )
}
