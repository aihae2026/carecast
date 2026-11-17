import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Settings2, Cloud, Wind, CloudRain, CloudSnow, Radio,
  Bell, Type, Music2, Sliders, CalendarClock, Sunrise,
} from 'lucide-react'

import TopBar                  from '../components/easy/TopBar'
import NotificationBar         from '../components/easy/NotificationBar'
import InstantBroadcast        from '../components/easy/InstantBroadcast'
import ScheduledBroadcastMini  from '../components/easy/ScheduledBroadcastMini'
import TTSBroadcast            from '../components/easy/TTSBroadcast'
import { FavsCard, ChimeCard, MorningCard } from '../components/easy/FavoritesBar'
import SystemStatusCompact     from '../components/easy/SystemStatusCompact'
import useWideScreen           from '../hooks/useWideScreen'
import QuickSettingsNav        from '../components/easy/QuickSettingsNav'
import LocalBGMCard            from '../components/easy/LocalBGMCard'
import VolumePanel             from '../components/easy/VolumePanel'
import MonthlyBroadcastStats   from '../components/easy/MonthlyBroadcastStats'
import ErrorBoundary           from '../components/shared/ErrorBoundary'
import { getWeather, getAirQuality } from '../lib/api'

// ── 모바일 전용 헤더 ─────────────────────────────────────────
function MobileHeader() {
  const [now,     setNow]     = useState(new Date())
  const [weather, setWeather] = useState(null)
  const [air,     setAir]     = useState(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const load = () => {
      getWeather().then(setWeather).catch(() => {})
      getAirQuality().then(setAir).catch(() => {})
    }
    load()
    const t = setInterval(load, 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const days  = ['일', '월', '화', '수', '목', '금', '토']
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`
  const timeStr = [now.getHours(), now.getMinutes()]
    .map(n => String(n).padStart(2, '0')).join(':')

  const sky = weather ? (weather.precipitationType !== '없음' ? weather.precipitationType : weather.sky) : null
  const WeatherIcon = sky?.includes('비') ? CloudRain : sky?.includes('눈') ? CloudSnow : Cloud
  const weatherIconColor = sky?.includes('비') ? 'text-ds-v3-tts' : sky?.includes('눈') ? 'text-white/80' : 'text-white/90'

  const DUST_BG = { 좋음: 'bg-ds-v3-line/30', 보통: 'bg-ds-v3-line/30', 나쁨: 'bg-ds-v3-line/30', '매우나쁨': 'bg-ds-v3-warn/30' }
  const DUST_TEXT = { 좋음: 'text-ds-v3-ink-3', 보통: 'text-ds-v3-ink-3', 나쁨: 'text-ds-v3-ink-3', '매우나쁨': 'text-ds-v3-warn' }

  return (
    <div className="flex-shrink-0 bg-gradient-to-br from-ds-v3-tts to-ds-v3-tts px-5 pt-4 pb-5">
      {/* 상단 행: 로고 + 날짜 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-[8px] bg-white/20 flex items-center justify-center">
            <Radio size={14} className="text-white" />
          </div>
          <span className="text-white font-semibold text-base tracking-tight">
            CareCast <span className="text-white/70">AI</span>
          </span>
        </div>
        <span className="text-white/70 text-sm">{dateStr}</span>
      </div>

      {/* 시간 + 날씨 행 */}
      <div className="flex items-end justify-between">
        <span className="text-white text-5xl font-semibold nums tracking-tight leading-none">
          {timeStr}
        </span>

        <div className="flex flex-col items-end gap-1.5">
          {/* 날씨 */}
          <div className="flex items-center gap-1.5">
            <WeatherIcon size={16} className={weatherIconColor} />
            <span className="text-white font-semibold text-xl nums">
              {weather?.temperature != null ? `${Math.floor(weather.temperature)}°` : '--°'}
            </span>
            <span className="text-white/70 text-sm">
              {sky || '날씨 로딩 중'}
            </span>
          </div>
          {/* 미세먼지 */}
          {air?.pm10Grade && (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${DUST_BG[air.pm10Grade] ?? 'bg-white/20'}`}>
              <Wind size={11} className={DUST_TEXT[air.pm10Grade] ?? 'text-white/80'} />
              <span className={`text-xs font-semibold ${DUST_TEXT[air.pm10Grade] ?? 'text-white/80'}`}>
                미세먼지 {air.pm10Grade}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 섹션 헤더 ────────────────────────────────────────────────
function SectionHeader({ icon: Icon, label, color = 'text-ds-v3-tts', bg = 'bg-ds-v3-tts/10' }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-1">
      <div className={`w-6 h-6 rounded-lg ${bg} flex items-center justify-center`}>
        <Icon size={13} className={color} />
      </div>
      <span className="text-xs font-semibold text-ds-v3-ink-2 uppercase tracking-widest">{label}</span>
    </div>
  )
}

// ── 모바일 레이아웃 ──────────────────────────────────────────
function MobileLayout({ onNavigate }) {
  return (
    <div className="flex flex-col h-full">
      {/* 머리·알림도 경계 안에 둔다 — 날씨 응답 하나가 어긋나면 헤더가 터지고,
          그러면 아래 카드까지 통째로 사라진다(Codex 지적, 2026-09-11). */}
      <ErrorBoundary 이름="상단 정보" 조용히><MobileHeader /></ErrorBoundary>
      <ErrorBoundary 이름="알림" 조용히><NotificationBar /></ErrorBoundary>

      <div className="flex-1 overflow-y-auto bg-ds-v3-bg mobile-compact">
        {/* 차임벨 + 즉시방송 */}
        <SectionHeader icon={Bell}  label="차임벨 · 즉시방송" color="text-ds-v3-ink-2" bg="bg-ds-v3-surface-2" />
        {/* 칸마다 경계를 둔다 — 이유는 DesktopLayout 쪽에 적었다(UX-44). */}
        <div className="px-4 pb-2 grid grid-cols-2 gap-3 items-start">
          <ErrorBoundary 이름="차임벨"><ChimeCard /></ErrorBoundary>
          <ErrorBoundary 이름="즉시방송"><InstantBroadcast /></ErrorBoundary>
        </div>

        {/* TTS 방송 */}
        <SectionHeader icon={Type} label="TTS 방송" color="text-ds-v3-tts" bg="bg-ds-v3-tts-bg" />
        <div className="px-4 pb-2">
          <ErrorBoundary 이름="TTS 방송"><TTSBroadcast /></ErrorBoundary>
        </div>

        {/* 오늘 방송 일정 */}
        <SectionHeader icon={CalendarClock} label="오늘 방송 일정" color="text-ds-v3-ink-3" bg="bg-ds-v3-surface-2" />
        <div className="px-4 pb-2">
          <ErrorBoundary 이름="오늘 방송 일정">
            <ScheduledBroadcastMini onNavigate={onNavigate} />
          </ErrorBoundary>
        </div>

        {/* 배경음악 */}
        <SectionHeader icon={Music2} label="배경음악" color="text-ds-v3-warn" bg="bg-ds-v3-warn-bg" />
        <div className="px-4 pb-2">
          <ErrorBoundary 이름="배경음악"><LocalBGMCard /></ErrorBoundary>
        </div>

        {/* 음량 제어 */}
        <SectionHeader icon={Sliders} label="음량 제어" color="text-ds-v3-flow" bg="bg-ds-v3-flow-bg" />
        <div className="px-4 pb-2">
          <ErrorBoundary 이름="음량 제어"><VolumePanel /></ErrorBoundary>
        </div>

        {/* **자동방송 설정으로 바로 가는 길**(UX-14, 2026-09-11).
            요구는 *"가장 쉬운 자동방송 설정 경로가 우선 노출된다"* 인데, 그전에는
            "상세 설정" 한 칸뿐이라 **거기 들어가서 8개 메뉴 중에 찾아야** 했다.
            현장 선생님이 제일 자주 바꾸는 것이 방송 순서·시각이라, 그 자리를 앞에 둔다. */}
        <div className="px-4 pt-2">
          <button
            onClick={() => onNavigate('/admin?section=morningEditor')}
            className="w-full flex items-center justify-center gap-2 py-4
                       bg-ds-v3-tts rounded-2xl text-base font-semibold text-white
                       active:brightness-95 transition-[filter] min-h-[44px] min-w-[44px]"
            style={{ boxShadow: '0 2px 12px rgba(79,142,247,0.28)' }}
          >
            <Sunrise size={18} />
            <span>자동방송 설정 <span className="font-normal text-sm opacity-90">(순서 · 시각)</span></span>
          </button>
        </div>

        {/* 상세설정 버튼 */}
        <div className="px-4 pt-2 pb-10">
          <button
            onClick={() => onNavigate('/admin')}
            className="w-full flex items-center justify-center gap-2 py-4
                       bg-white border border-ds-v3-line rounded-2xl
                       text-base font-semibold text-ds-v3-ink-2
                       active:bg-ds-v3-bg transition-colors min-h-[44px] min-w-[44px]"
            style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <Settings2 size={18} className="text-ds-v3-tts" />
            <span>상세 설정 <span className="text-ds-v3-ink-2 font-normal text-sm">(PC 전체 화면)</span></span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PC 레이아웃 ──────────────────────────────────────────────
function DesktopLayout({ onNavigate }) {
  return (
    <>
      <ErrorBoundary 이름="상단 정보" 조용히><TopBar /></ErrorBoundary>
      <ErrorBoundary 이름="알림" 조용히><NotificationBar /></ErrorBoundary>

      <main className="flex-1 overflow-y-auto p-3 pb-32">
        <div className="grid grid-cols-1 laptop:grid-cols-[30fr_35fr_35fr] gap-3 items-start">

          {/* **칸마다 경계를 둔다**(UX-44, 2026-09-11). 한 칸이 렌더에서 터지면 React 는
              트리 전체를 언마운트한다 — BGM 카드 하나 때문에 즉시방송 버튼까지 사라진다.
              현장에서 흰 화면은 "방송을 못 내보내는 상태"다. */}

          {/* 1열: 즉시방송 · 차임벨 · TTS(AI 도움받기 내장) · 즐겨찾기 */}
          <div className="flex flex-col gap-3">
            <ErrorBoundary 이름="즉시방송"><InstantBroadcast /></ErrorBoundary>
            <ErrorBoundary 이름="차임벨"><ChimeCard /></ErrorBoundary>
            <ErrorBoundary 이름="TTS 방송"><TTSBroadcast /></ErrorBoundary>
            <ErrorBoundary 이름="즐겨찾기"><FavsCard /></ErrorBoundary>
          </div>

          {/* 2열: 오늘방송일정 · 음량제어 · 방송통계 · 빠른설정/시스템 */}
          <div className="flex flex-col gap-3">
            <ErrorBoundary 이름="오늘 방송 일정">
              <ScheduledBroadcastMini onNavigate={() => onNavigate('/calendar')} />
            </ErrorBoundary>
            <ErrorBoundary 이름="음량 제어"><VolumePanel /></ErrorBoundary>
            <ErrorBoundary 이름="방송 통계"><MonthlyBroadcastStats /></ErrorBoundary>
            <div className="grid grid-cols-2 gap-3 items-start">
              <ErrorBoundary 이름="빠른 설정"><QuickSettingsNav /></ErrorBoundary>
              <ErrorBoundary 이름="시스템 상태"><SystemStatusCompact /></ErrorBoundary>
            </div>
          </div>

          {/* 3열: 아침방송 · 배경음악 */}
          <div className="flex flex-col gap-3">
            <ErrorBoundary 이름="아침방송"><MorningCard /></ErrorBoundary>
            <ErrorBoundary 이름="배경음악"><LocalBGMCard /></ErrorBoundary>
          </div>

        </div>
      </main>

      <button
        onClick={() => onNavigate('/admin')}
        className="fixed bottom-3 right-5 flex items-center gap-2 px-5 py-3
                   bg-white border border-ds-v3-line rounded-btn text-base font-normal
                   text-ds-v3-ink-2 hover:text-ds-v3-ink hover:border-ds-v3-tts/40
                   btn-press transition-colors z-50 min-h-[44px] min-w-[44px]"
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
      >
        <Settings2 size={17} />
        상세 화면 보기
      </button>
    </>
  )
}

// md:hidden / hidden md:flex로 CSS만 숨기면 두 레이아웃이 항상 같이 마운트돼 있어서
// (당시) BGM 재생 컴포넌트가 동시에 2개씩 생기고(숨겨진 쪽 iframe도 autoplay로 같이 재생),
// BGM 상태(bgmStore)도 두 인스턴스가 동시에 써서 꼬임 — 실제로 재생 중 iframe 2개가
// 동일 영상으로 떠 있는 것과 "Cannot update … while rendering …" 경고로
// 확인함. 실제 미디어쿼리로 둘 중 하나만 마운트되게 바꿔서 근본적으로 해결.
// **폭 판정은 `hooks/useWideScreen` 한 곳에서 한다**(2026-09-15 에 여기서 옮겼다).
// 캘린더도 같은 판정이 필요해졌는데, 두 벌이면 기준 폭이 갈리고 한쪽만 정리 함수를
// 빠뜨리는 날이 온다. **위 주석의 이유(같이 마운트돼 iframe 이 둘이 되던 실측)는
// 그 파일 머리말로 함께 옮겼다** — 이유를 두고 오면 다음 사람이 다시 겪는다.

// ── 메인 ────────────────────────────────────────────────────
export default function EasyMode() {
  const navigate   = useNavigate()
  const isDesktop  = useWideScreen(768)

  return (
    <div className="h-screen flex flex-col bg-ds-v3-bg overflow-hidden">

      {/* **모바일에도 경로를 그대로 넘긴다**(UX-14). 전에는 `() => navigate('/admin')` 이라
          인자를 통째로 버렸고, 그래서 "자동방송 설정" 같은 구체적인 목적지를 못 보냈다 —
          어디를 눌러도 관리자 첫 화면이었다. 데스크톱 쪽은 이미 경로를 받는다.
          (주석을 삼항 연산자 사이에 두면 JSX 가 안 읽힌다 — CLAUDE.md 가 적어 둔 함정이다.) */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* 레이아웃 자체에도 경계를 둔다 — 칸 **바깥**(구역 머리·격자)에서 터지면
            칸 경계로는 못 잡는다(Codex R2). `resetKey` 로 폰↔PC 전환 때 다시 그려 본다. */}
        <ErrorBoundary 이름="화면 배치" resetKey={isDesktop ? 'desktop' : 'mobile'}>
          {isDesktop
            ? <DesktopLayout onNavigate={navigate} />
            : <MobileLayout onNavigate={(to) => navigate(to || '/calendar')} />}
        </ErrorBoundary>
      </div>

      {/* ── 재생 표시줄은 **앱 층으로 올라갔다** (2026-09-15) ─────────────────────────
          여기 있던 것을 `App.jsx` 의 `Routes` 형제 자리로 옮겼다. 이 화면에만 있어서
          **통합 홈(`/simple`)에는 아래 바가 없었다** — 사용자가 *"어느 순간 없어졌네?"*
          라고 물은 것이 그것이다.
          여기서 지우지 않으면 이 화면에만 **두 개**가 겹친다(같은 서버 상태를 3초마다
          각자 폴링하고, 정지 단추가 둘이 된다).
          경계(`ErrorBoundary`)는 옮겨간 자리에 그대로 따라갔다 — 2026-09-11 Codex 가
          잡은 그 이유(터지면 방송 중에 정지 버튼까지 사라진다)는 자리가 바뀌어도 같다. */}
    </div>
  )
}
