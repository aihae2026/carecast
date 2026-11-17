import { useState, useEffect } from 'react'
import { statusOf } from '../../../lib/broadcastStatus'
import { Monitor, Wifi, Headphones, Mic, TrendingUp, Zap, ChevronLeft, ChevronRight, Server, Clock, HardDrive, Cpu } from 'lucide-react'
import Toggle from '../../shared/Toggle'
import { StatusDot, TypeBadge, StatusBadge } from '../../shared/Badge'
import { buildStatusCards, switchbotCard } from '../../../lib/systemStatus'
import { apiGet, apiPost, getSwitchBotStatus } from '../../../lib/api'
import { localToday } from '../../../lib/localDate'

const statusIcons       = { pc: Monitor, net: Wifi, audio: Headphones, mic: Mic }
// ── **신호등을 없앴다** (사용자 지시 2026-09-16) ──────────────────────────────
// 앞 판은 카드 위에 초록(정상)·주황(주의)·빨강(오류) 띠를 3px 로 둘렀다. 그런데
// 이 제품의 색 언어에는 **초록도 주황도 없다**(G-1: 말=파랑 · 음악=자주 · 순서=보라).
// 다섯 칸 중 서넛에 색이 붙으면 **색이 아무것도 가리키지 못한다**(G-2).
//
// **빨강만 남긴다.** 그것은 넷째 색이 아니라 **경고**다(G-6의 유일한 예외) — 실패·
// 끊김처럼 사람이 지금 손을 써야 하는 것에만 쓰고, 반드시 **글자와 함께** 쓴다.
// 정상·주의는 무채색 띠로 두고, 무슨 상태인지는 **점의 모양과 이름표**가 말한다
// (`StatusDot` 이 모양 셋 + `aria-label` 을 이미 갖고 있다).
//
// 값을 여기 hex 로 다시 적지 않는다(G-13) — 토큰 이름으로 가리킨다.
const statusBorderColor = {
  online:  'var(--ds-v3-line-2)',
  warning: 'var(--ds-v3-ink-3)',
  offline: 'var(--ds-v3-warn, #B91C1C)',
}

// ── **켜진 칸은 떠 있고, 아닌 칸은 가라앉아 있다** (사용자 지시 2026-09-16) ──────
// *"장비 및 서버현황은 저렇게 회색으로 있으니까 꺼진 것 같잖아, 켜져 있는거는 배경색
//   컬러, 그 간편모드 해당하는거 감싸 있는 배경처럼 저 회색부분 칠해주면 켜져 있다는게
//   확인이 직관적이잖아"*
//
// 맞는 지적이다. 다섯 칸이 **전부** `bg-ds-v3-bg`(#F4F6FB)였는데, 그건 이 화면 바깥
// 바탕과 **같은 회색**이다. 흰 카드 안에 바탕색 칸이 다섯 개 파여 있으니 「비활성」로
// 읽힌다 — 실제로는 다섯 다 정상인데.
//
// **초록을 되살리지 않는다.** 바로 위 머리말의 지시(*"신호등을 없앴다"*)는 그대로다.
// 대신 사용자가 가리킨 그 배경을 그대로 쓴다 — 간편 화면에서 「다음 방송」 줄을 감싸는
// 것은 `bg-white` + `shadow-v3-card` 이고, `.skin-v3` 가 흰 면에 아주 옅은 물감을
// 얹는다. 그래서 흰색이되 **살짝 물든 채로 떠 있는** 면이 된다.
//
// 결과: 켜진 것은 **떠 있고**(흰 면 + 그림자), 주의·확인 불가는 **가라앉아 있다**
// (바탕색 그대로). 색을 하나도 새로 만들지 않고 「켜짐」이 한눈에 갈린다.
const statusCardSkin = {
  online:  'bg-white shadow-v3-card',
  offline: 'bg-ds-v3-warn-bg',
}
const 칸바탕 = (status) => statusCardSkin[status] ?? 'bg-ds-v3-bg'

// 기능 활성화 토글 — 여기 있는 항목은 전부 실제 동작을 제어한다.
// 예전엔 10개였는데 그중 6개는 켜고 꺼도 아무 일도 일어나지 않았다(저장만 됨).
// - Google Calendar / BGM : 각각 'API 연동', 방송별 BGM 설정에서 관리 → 중복이라 제거
// - 방송 승인             : 기능 자체가 구현된 적 없음 → 제거
// 나머지는 실제 제어 키(morning_enabled 등)나 라우트 가드에 연결돼 있다.
const featureToggles = [
  { id: 'morning', label: '자동 아침 방송', hint: '끄면 아침 방송이 발동하지 않습니다' },
  { id: 'weather', label: '날씨 안내',      hint: '아침 안내문에서 날씨 문장을 뺍니다' },
  { id: 'dust',    label: '미세먼지',       hint: '아침 안내문에서 미세먼지 문장을 뺍니다' },
  { id: 'alert',   label: '특보 안내',      hint: '특보 자동방송과 안내문 특보 문장을 끕니다' },
  { id: 'tts',     label: 'TTS 방송',       hint: '수동 TTS 방송을 막습니다(비상방송·자동방송은 계속 동작)' },
  { id: 'ai',      label: 'AI 방송 도우미', hint: 'AI 문구 생성을 막습니다' },
  { id: 'mic',     label: '실시간 마이크',  hint: '마이크 방송을 막습니다(차임벨은 계속 동작)' },
]

// 한국 공휴일
const KR_HOLIDAYS = new Set([
  '2024-01-01','2024-02-09','2024-02-10','2024-02-11','2024-02-12',
  '2024-03-01','2024-04-10','2024-05-05','2024-05-15','2024-06-06',
  '2024-08-15','2024-09-16','2024-09-17','2024-09-18',
  '2024-10-03','2024-10-09','2024-12-25',
  '2025-01-01','2025-01-28','2025-01-29','2025-01-30',
  '2025-03-01','2025-05-05','2025-05-06','2025-06-06',
  '2025-08-15','2025-10-03','2025-10-05','2025-10-06','2025-10-07','2025-10-08','2025-10-09',
  '2025-12-25',
  '2026-01-01','2026-02-16','2026-02-17','2026-02-18',
  '2026-03-01','2026-03-02','2026-05-05','2026-05-24','2026-05-25','2026-06-06',
  '2026-08-15','2026-09-24','2026-09-25','2026-09-26',
  '2026-10-03','2026-10-05','2026-10-09','2026-12-25',
  '2027-01-01','2027-02-06','2027-02-07','2027-02-08','2027-02-09',
  '2027-03-01','2027-05-05','2027-06-06',
  '2027-08-15','2027-08-16','2027-10-03','2027-10-04','2027-10-09','2027-12-25',
])

function formatUptime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}시간 ${m}분`
}

// 플랫폼 코드를 사람 말로. 모르는 값이면 **지어내지 않고** 그대로 보여준다.
const PLATFORM_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }

function getDayColor(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  // 800번대다. 이 글자는 **파란 열지도 칸 위**에 놓인다 — 700번대는 진한 칸(blue-300)에서
  // 3.59 로 미달이었다(UX-42, 2026-09-12 실측). 흰 칸에서도 800이 읽기 더 낫다.
  if (KR_HOLIDAYS.has(dateStr) || day === 0) return 'text-ds-v3-warn'
  if (day === 6) return 'text-ds-v3-tts'
  return ''
}

// 월별 방송 그리드 — 왼쪽 좁은 칸에 들어가므로 셀을 줄이고 범례를 한 줄로 접었다(UX-32).
function MonthlyGrid() {
  const now   = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data,  setData]  = useState({})
  const [loading, setLoading] = useState(false)

  const fetchMonthly = (y, m) => {
    setLoading(true)
    apiGet(`/api/broadcasts/monthly?year=${y}&month=${m}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchMonthly(year, month) }, [year, month])

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  // 달력 계산
  const firstDay  = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - firstDay + 1
    if (dayNum < 1 || dayNum > daysInMonth) return null
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
    return { dayNum, dateStr, cnt: data[dateStr] || 0 }
  })

  const monthTotal = Object.values(data).reduce((a, b) => a + b, 0)

  return (
    <div className="card-base">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-ds-v3-ink flex items-center gap-2 shrink-0">
          <TrendingUp size={14} className="text-ds-v3-ink-2" />
          월별 방송 실적
        </h2>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} aria-label="이전 달"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-ds-v3-bg text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-semibold text-ds-v3-ink nums w-[72px] text-center">
            {year}년 {month}월
          </span>
          <button onClick={nextMonth} aria-label="다음 달"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-ds-v3-bg text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-1">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-semibold py-0.5 ${
            i === 0 ? 'text-ds-v3-warn' : i === 6 ? 'text-ds-v3-tts' : 'text-ds-v3-ink-2'
          }`}>{d}</div>
        ))}
      </div>

      {/* 날짜 셀 — 좁은 칸에 맞춰 h-14 → h-9 로 줄였다 */}
      <div className={`grid grid-cols-7 gap-px bg-ds-v3-line rounded-[8px] overflow-hidden ${loading ? 'opacity-60' : ''}`}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="bg-ds-v3-bg h-9" />
          const { dayNum, dateStr, cnt } = cell
          // toISOString()은 UTC라 KST 09시 이전에 어제를 오늘로 표시했다(CC-015)
          const isToday = dateStr === localToday(now)
          const dayColor = getDayColor(dateStr)
          const intensity = cnt === 0 ? 0 : cnt < 3 ? 1 : cnt < 6 ? 2 : cnt < 10 ? 3 : 4
          const bgMap = ['bg-white', 'bg-ds-v3-tts-bg', 'bg-ds-v3-tts-bg', 'bg-ds-v3-tts-line', 'bg-ds-v3-tts-line']
          return (
            <div key={dateStr}
              title={`${month}월 ${dayNum}일 · 방송 ${cnt}건`}
              className={`${bgMap[intensity]} h-9 flex flex-col items-center justify-center relative leading-none`}>
              {isToday && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-ds-v3-tts" />
              )}
              <span className={`text-[11px] font-normal ${dayColor || 'text-ds-v3-ink'}`}>{dayNum}</span>
              {/* 열지도 칸이 진해질수록 파란 글자가 묻힌다 — blue-100 위에서 이미 4.24 였다.
                  칸 색은 그대로 두고 **글자만** 900으로 내린다(UX-42). blue-300 에서 5.74. */}
              {cnt > 0
                ? <span className="text-[10px] font-semibold text-ds-v3-tts nums mt-0.5">{cnt}</span>
                : <span aria-hidden="true" className="text-[10px] text-ds-v3-ink-2/40 mt-0.5">·</span>}
            </div>
          )
        })}
      </div>

      <p className="mt-2 text-[11px] text-ds-v3-ink-2">
        칸 안 숫자는 그날 나간 방송 건수입니다. 이번 달 총 <span className="font-semibold text-ds-v3-ink nums">{monthTotal}</span>건.
      </p>
    </div>
  )
}

// ── 장비·서버 현황 한 묶음 (UX-31) ────────────────────────────────────────
// 예전엔 세 덩어리로 흩어져 있었고 **IP·메모리가 두 번 나왔다**(상태카드 detail 과 서버정보).
// 여기 한 카드로 합치고 중복을 뺐다. 높이는 두 줄(장비 줄 + 서버 줄)로 묶는다.
function SystemPanel({ liveStatus, switchBotStatus }) {
  const statusCards = buildStatusCards(liveStatus)
  // 방송장비 전원도 **같은 표**를 쓴다(UX-35). 예전엔 이 카드만 여기서 손으로 만들어
  // 혼자 "조회 실패" 라고 했고 "연결 끊김" 이 없었다.
  const sb카드 = switchbotCard(switchBotStatus)
  // 위 표와 **같은 규칙**을 쓴다 — 두 벌로 두면 한쪽만 고쳐지는 날 카드마다 색이 갈린다.
  const sbBorder = sb카드.status === 'offline' ? statusBorderColor.offline
    : sb카드.status === 'warning' ? statusBorderColor.warning
    : 'var(--ds-v3-line-2)'

  // 비개발자용 부연설명 (UX-30). 장치 카드는 title 로, CPU·메모리는 **눈에 보이는 글**로 적는다
  // — 사용자가 짚어 말한 둘이라 숨기지 않는다.
  const 설명 = {
    pc:    '이 PC가 지금 얼마나 바쁜지입니다.',
    net:   '바깥 인터넷과 실제로 통신이 되는지입니다. 날씨·안내 음성·AI 가 여기 걸립니다.',
    audio: '소리가 나갈 스피커입니다. "장치 없음"이면 방송이 안 들립니다.',
    mic:   '사람이 직접 말할 때 쓰는 입력 장치입니다. 없어도 자동방송은 나갑니다.',
  }

  return (
    <div className="card-base h-full flex flex-col">
      <h2 className="text-sm font-semibold text-ds-v3-ink mb-3 flex items-center gap-2">
        <Server size={15} className="text-ds-v3-ink-2" />
        장비 · 서버 현황
      </h2>

      {/* 장비 줄 — 방송 PC / 네트워크 / 오디오 출력 / 마이크 / 방송장비 전원 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {statusCards.map(s => {
          const Icon = statusIcons[s.id]
          const borderColor = statusBorderColor[s.status] ?? 'var(--ds-v3-line)'
          return (
            <div key={s.id} title={설명[s.id]}
              className={'rounded-[10px] p-3 border border-ds-v3-line ' + 칸바탕(s.status)}
              style={{ borderTop: `3px solid ${borderColor}` }}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon size={13} className="text-ds-v3-ink-2 shrink-0" />
                  <span className="text-[11px] font-normal text-ds-v3-ink truncate">{s.name}</span>
                </div>
                <StatusDot status={s.status} />
              </div>
              <p className="text-base font-semibold nums text-ds-v3-ink truncate">{s.value}</p>
              <p className="text-[10px] text-ds-v3-ink-2 mt-0.5 truncate" title={s.detail}>{s.detail}</p>
            </div>
          )
        })}

        {/* 방송장비 전원 (SwitchBot) */}
        <div className={'rounded-[10px] p-3 border border-ds-v3-line ' + 칸바탕(sb카드.status)}
          style={{ borderTop: `3px solid ${sbBorder}` }}
          title="방송 장비(앰프 등) 전원 스위치입니다.">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Zap size={13} className="text-ds-v3-ink-2 shrink-0" />
              <span className="text-[11px] font-normal text-ds-v3-ink truncate">방송장비 전원</span>
            </div>
            {/* 낱말도 색도 **다른 카드와 같은 표**에서 온다(UX-35). 여기서 따로 정하면
                같은 뜻에 이름이 둘 생긴다 — 실제로 혼자 "조회 실패" 라고 하고 있었다. */}
            <span className={`w-2 h-2 rounded-full ${
              sb카드.status === 'online' ? (sb카드.value === 'ON' ? 'bg-ds-v3-ink-3' : 'bg-ds-v3-ink-3')
                : sb카드.status === 'offline' ? 'bg-ds-v3-warn'
                : sb카드.status === 'warning' ? 'bg-ds-v3-ink-2' : 'bg-ds-v3-line-2'}`} />
          </div>
          <p className={`text-base font-semibold ${
            sb카드.status === 'unknown' ? 'text-ds-v3-ink-2'
              : sb카드.status === 'offline' ? 'text-ds-v3-warn'
              : sb카드.value === 'ON' ? 'text-ds-v3-ink-3' : 'text-ds-v3-ink'}`}>
            {sb카드.value}
          </p>
          <p className="text-[10px] text-ds-v3-ink-2 mt-0.5 truncate">{sb카드.detail}</p>
        </div>
      </div>

      {/* 서버 줄 — IP · 켜 둔 시간 · 작업 공간 · 운영체제 */}
      <div className="mt-3 pt-3 border-t border-ds-v3-line">
        {liveStatus ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              { Icon: Wifi,      label: '이 PC 주소', value: liveStatus.ip,
                help: '다른 PC나 휴대폰에서 이 화면에 접속할 때 쓰는 주소입니다.' },
              { Icon: Clock,     label: '켜 둔 시간', value: formatUptime(liveStatus.uptime),
                help: 'PC를 마지막으로 켠 뒤 지난 시간입니다.' },
              { Icon: HardDrive, label: '작업 공간 사용량',
                value: `${liveStatus.memory?.usedPct}% / ${liveStatus.memory?.totalGB}GB`,
                help: 'PC가 한꺼번에 다룰 수 있는 공간입니다. 90%를 오래 넘으면 한 번 재시작을 권합니다.' },
              { Icon: Cpu,       label: '운영체제',
                value: PLATFORM_NAME[liveStatus.platform] ?? liveStatus.platform,
                help: '이 PC에서 도는 운영체제입니다.' },
            ].map(item => (
              <div key={item.label} className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <item.Icon size={12} className="text-ds-v3-ink-2 shrink-0" />
                  <span className="text-[11px] text-ds-v3-ink-2 truncate">{item.label}</span>
                </div>
                {/* 설명은 **`title` 로만** 둔다(사용자 지시 2026-09-13: *"장비도 최소한으로만 적어"*).
                    네 칸 밑에 네 줄이 더 붙어 카드 아래 절반이 글이었다. 값이 주인공이다. */}
                <p className="t-body font-semibold text-ds-v3-ink nums truncate"
                   title={`${item.value} — ${item.help}`}>{item.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ds-v3-ink-2 text-center py-3">서버에 연결 중...</p>
        )}
      </div>

      {/* CPU·메모리 설명 문단을 걷었다(사용자 지시 2026-09-13). 넉 줄짜리였는데
          같은 말이 위 칸들의 `title` 에 이미 있다. 대시보드는 **훑는 화면**이고,
          여기서 가장 많이 읽게 두면 훑을 수가 없다. */}
    </div>
  )
}

export default function Dashboard({ onNavigate }) {
  // 실제 값은 /api/settings/features로 받아온다(togglesLoaded 전까지 렌더링 안 함) —
  // 여기서 임의의 기본값을 보여주면 실제와 다른 상태가 잠깐 보일 수 있어 비워둔다
  const [toggles,      setToggles]      = useState({})
  const [togglesLoaded, setTogglesLoaded] = useState(false)
  const [liveStatus,   setLiveStatus]   = useState(null)
  const [recentLogs,   setRecentLogs]   = useState([])
  const [switchBotStatus, setSwitchBotStatus] = useState(null)
  const [showTotal,    setShowTotal]    = useState(false)

  useEffect(() => {
    apiGet('/api/settings/features')
      .then(data => { setToggles(data); setTogglesLoaded(true) })
      .catch(() => setTogglesLoaded(true))

    apiGet('/api/status')
      .then(data => {
        setLiveStatus(data)
        setRecentLogs((data.recentBroadcasts || []).map(r => ({
          id:      r.id,
          time:    r.time,
          content: r.content,
          type:    r.type,
          status:  statusOf(r.success),
        })))
      })
      .catch(() => {})

    // 예약 목록은 이 화면에서 더 이상 쓰지 않는다 — 캘린더(방송일정 및 예약)가 맡는다(UX-33).
    getSwitchBotStatus().then(setSwitchBotStatus).catch(() => {})
  }, [])

  const now = new Date()
  const monthLabel = `${now.getMonth() + 1}월`

  // 전부 실제 집계값이다. 칸 정의는 서버 `domain/broadcastRecord.종류칸` 한 곳에 있다.
  // **"전체" 보기도 같은 규칙으로 센 값**을 서버가 따로 보내 준다 — 예전엔 전체 보기에
  // 종류별 숫자가 없어서 이번 달 숫자를 그대로 두고 라벨만 바꿨다.
  const b   = liveStatus?.broadcasts
  const src = showTotal ? (b?.allTime ?? {}) : (b ?? {})
  const summary = {
    instant: src.instant ?? 0,
    tts:     src.tts     ?? 0,
    bgm:     src.bgm     ?? 0,
    auto:    src.auto    ?? 0,
    error:   src.error   ?? 0,
    autoOnly:      src.autoOnly      ?? 0,
    scheduledOnly: src.scheduledOnly ?? 0,
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-section text-ds-v3-ink">대시보드</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">시스템 현황 및 주요 기능을 한눈에 확인합니다.</p>
      </div>

      {/* ── 윗줄: 왼쪽 기능 활성화 · 오른쪽 장비·서버 현황 (UX-31) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-1 card-base">
          {/* ── 설명 줄을 걷었다 (사용자 지시 2026-09-13) ─────────────────────────
              *"기능활성화 토글은 설명 그냥 없애"* — 일곱 줄 밑에 일곱 줄이 더 붙어
              카드가 두 배로 길고, **읽을 것이 열네 줄**이었다. 대시보드는 훑는 화면인데
              여기서 가장 많이 읽어야 했다.
              설명은 **지우지 않고 `title` 로 옮겼다** — 마우스를 올리면 나온다.
              "끄면 무슨 일이 나는가"는 실제로 필요한 정보이고(특히 「TTS 방송」은
              끄면 수동 방송이 막힌다), 아는 사람에게는 군더더기지만 처음 보는 사람에게는
              유일한 단서다. 보이지 않게 두되 **없애지는 않는다.** */}
          <h2 className="t-label font-semibold text-ds-v3-ink mb-3">기능 활성화</h2>
          {/* 줄 사이 **8px**(G-61). 4px 이었다 — 사용자 지적: *"토글들 딱딱 붙어있으니까
              꼴보기 싫잖아"*. 4px 은 아이콘과 글자 사이 같은 **부품 안쪽** 값이지
              서로 다른 항목을 가르는 값이 아니다.
              줄 자체에도 세로 여백을 줘 **누르는 자리를 40px 로** 키운다 — 토글은 손으로
              누르는 것이고, 줄이 24px 이면 옆 줄을 잘못 누르기 쉽다. */}
          <div className="space-y-2">
            {togglesLoaded && featureToggles.map(f => (
              <div key={f.id} className="flex min-h-[40px] items-center justify-between gap-3" title={f.hint}>
                <span className="min-w-0 t-body text-ds-v3-ink">{f.label}</span>
                <Toggle
                  checked={toggles[f.id] ?? true}
                  onChange={val => {
                    const next = { ...toggles, [f.id]: val }
                    setToggles(next)
                    apiPost('/api/settings/features', next).catch(() => {})
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          <SystemPanel liveStatus={liveStatus} switchBotStatus={switchBotStatus} />
        </div>
      </div>

      {/* ── 아랫줄: 왼쪽 방송 통계 + 월별 실적 · 오른쪽 최근 로그 (UX-32) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-1 space-y-5">
          {/* 방송 통계 — 즉시방송 / TTS / BGM(단독) / 자동방송 / 오류 (UX-34) */}
          <div className="card-base">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h2 className="text-sm font-semibold text-ds-v3-ink flex items-center gap-2">
                <TrendingUp size={14} className="text-ds-v3-ink-2" />
                방송 통계
              </h2>
              <div className="flex items-center bg-ds-v3-bg border border-ds-v3-line rounded-btn p-0.5 text-xs">
                <button
                  onClick={() => setShowTotal(false)}
                  className={`px-2.5 py-1 rounded-[6px] font-normal transition-colors ${
                    !showTotal ? 'bg-ds-v3-ink text-white' : 'text-ds-v3-ink-2 hover:text-ds-v3-ink'
                  }`}>
                  {monthLabel}
                </button>
                <button
                  onClick={() => setShowTotal(true)}
                  className={`px-2.5 py-1 rounded-[6px] font-normal transition-colors ${
                    showTotal ? 'bg-ds-v3-ink text-white' : 'text-ds-v3-ink-2 hover:text-ds-v3-ink'
                  }`}>
                  전체
                </button>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { key: 'instant', label: '즉시방송', value: summary.instant, color: 'text-ds-v3-ink-3' },
                { key: 'tts',     label: 'TTS',      value: summary.tts,     color: 'text-ds-v3-ink-2' },
                { key: 'bgm',     label: 'BGM',      value: summary.bgm,     color: 'text-ds-v3-bgm'   },
                { key: 'auto',    label: '자동방송', value: summary.auto,    color: 'text-ds-v3-ink-2' },
                { key: 'error',   label: '오류',     value: summary.error,   color: 'text-ds-v3-warn'  },
              ].map(item => (
                <div key={item.key}
                  className="text-center bg-ds-v3-bg rounded-[10px] py-2.5 px-1 border border-ds-v3-line">
                  <p className={`text-xl font-semibold nums ${item.color}`}>{item.value}</p>
                  <p className="text-[10px] text-ds-v3-ink-2 mt-0.5 leading-tight">{item.label}</p>
                </div>
              ))}
            </div>
            {/* ── 집계 정의는 **한 줄**로 줄였다 (사용자 지시 2026-09-13) ──────────
                여섯 줄짜리 문단이었다. 옆 숫자가 무엇을 세는지 모르면 오독한다는 것은
                맞지만(UX-34), 그 설명을 **매번 읽게** 둘 필요는 없다 — 대시보드는 훑는
                화면이고, 이 문단이 숫자보다 자리를 많이 차지하고 있었다.
                자세한 정의는 `title` 로 내렸다. 눈에 남기는 것은 **가장 오해하기 쉬운
                한 가지**다: 자동방송 안의 TTS·BGM 을 두 번 세지 않는다는 것. */}
            <p className="mt-2.5 t-sub text-ds-v3-ink-2"
               title={'즉시방송 = 사람이 눌러 바로 내보낸 것(마이크·차임벨) · '
                    + 'BGM = 배경음악 단독 재생 · 자동방송 = 시스템이 알아서 낸 것'
                    + (summary.auto > 0 ? `(자동 ${summary.autoOnly} · 예약 ${summary.scheduledOnly})` : '')
                    + ' · 오류는 종류와 별개로 세며 다른 칸에 더해지지 않습니다.'}>
              자동방송 안에서 나간 TTS·BGM 은 <span className="font-semibold text-ds-v3-ink">두 번 세지 않습니다</span>.
            </p>
          </div>

          {/* 월별 방송 실적 — 크기를 줄여 통계 바로 아래로 (UX-32) */}
          <MonthlyGrid />
        </div>

        {/* 최근 방송 로그 — **왼쪽 두 카드를 합친 높이에 맞춘다**(UX-32).
            감싸개를 `relative` 로 두고 카드를 `absolute inset-0` 로 깔면, 이 열이 줄 높이를
            **끌어올리지 않는다** — 높이는 왼쪽이 정하고 로그는 그 안에서 스크롤한다.
            좁은 화면(lg 미만)에서는 absolute 를 풀어 평범하게 세로로 쌓인다. */}
        <div className="lg:col-span-2 relative min-h-[420px]">
        <div className="card-base overflow-hidden p-0 flex flex-col lg:absolute lg:inset-0">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-ds-v3-line shrink-0">
            <h2 className="text-sm font-semibold text-ds-v3-ink">최근 방송 로그</h2>
            <button onClick={() => onNavigate('broadcastLog')}
              className="text-xs text-ds-v3-ink-2 hover:underline inline-flex items-center min-h-[24px] px-1 -mx-1">전체 보기</button>
          </div>
          {/* 방송로그와 같은 이유로 감싸개를 하나 더 둔다 — 카드의 overflow-hidden은
              모서리를 다듬을 뿐이라, 폰에서는 오른쪽 열이 잘리고 스크롤도 안 됐다.
              **가로(`overflow-x-auto`)를 명시한다.** 2026-09-11 에 높이를 맞추려고 이것을
              `overflow-auto` 한 마디로 줄였다가 `phone-no-sideways-scroll.test.js` 를
              빨간불로 만들었다(독립 검수가 잡았다). 세로는 높이 맞춤용이고 가로는 폰 대비용이라
              **뜻이 다른 두 가지**다 — 한 마디로 합치지 않는다. */}
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ds-v3-ink-2 bg-ds-v3-bg border-b border-ds-v3-line">
                  <th className="px-5 py-2.5 font-semibold w-16">시간</th>
                  <th className="px-5 py-2.5 font-semibold">방송 내용</th>
                  <th className="px-5 py-2.5 font-semibold w-20">종류</th>
                  <th className="px-5 py-2.5 font-semibold w-16">상태</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-ds-v3-ink-2">
                    아직 방송 기록이 없습니다.
                  </td></tr>
                )}
                {recentLogs.map((log, idx) => (
                  <tr key={log.id}
                    className={`border-b border-ds-v3-line hover:bg-ds-v3-bg transition-colors ${
                      idx % 2 === 1 ? 'bg-ds-v3-bg' : 'bg-white'
                    }`}>
                    <td className="px-5 py-2.5 text-ds-v3-ink-2 nums text-xs">{log.time}</td>
                    <td className="px-5 py-2.5 text-ds-v3-ink text-xs truncate max-w-0 w-full">{log.content}</td>
                    <td className="px-5 py-2.5"><TypeBadge type={log.type} /></td>
                    <td className="px-5 py-2.5"><StatusBadge status={log.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
