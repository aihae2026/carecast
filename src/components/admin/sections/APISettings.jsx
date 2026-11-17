
import { Bot, Cloud, Zap, AudioLines } from 'lucide-react'

import { AIProviderSelector, GeminiApiCard } from './apiSettingsAI'
import LocalAiSetup from './LocalAiSetup'
import { KmaApiCard, AirKoreaApiCard } from './apiSettingsWeather'
import { GoogleCalendarCard, SwitchBotCard } from './apiSettingsIntegrations'
import { SpeechEngineCards } from './apiSettingsSpeech'

// ── 카드 그룹 구분용 소제목 — 7개 카드가 한 화면에 그냥 쌓여 있으면 뭐가 뭔지 구분이 안 돼서
// 성격별로(AI/날씨/기타연동) 묶어 보여준다
function GroupHeading({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-1.5 mt-1 mb-2">
      <Icon size={13} className="text-ds-v3-ink-2" />
      <span className="text-xs font-semibold text-ds-v3-ink-2 uppercase tracking-wide">{label}</span>
      <div className="flex-1 h-px bg-ds-v3-line/60" />
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────
export default function APISettings() {
  return (
    <div className="space-y-5">
      <GroupHeading icon={Bot} label="AI 방송 도우미" />
      {/* ── 이 둘도 **두 칸 격자**에 넣는다 (G-64, 사용자 지적 2026-09-13) ────────────
          *"제미나이가 저렇게 너비 잡아먹어도 되냐"* — 안 된다. 아래 「날씨 · 미세먼지」
          「기기 · 일정 연동」은 전부 두 칸인데 이 둘만 화면 폭을 다 썼다.
          같은 종류의 카드가 같은 화면에서 폭이 다르면 **더 넓은 쪽이 더 중요해 보인다** —
          여기서는 그럴 이유가 없다.
          입력칸 한두 개짜리 카드가 1280px 를 다 쓰면 그 안의 글도 같이 늘어나, 한 줄이
          길어져 다음 줄 첫 글자를 찾기 어려워진다(G-64: 읽는 글은 65자 안팎). */}
      <div className="grid grid-cols-1 laptop:grid-cols-2 gap-4">
        <AIProviderSelector />
        <GeminiApiCard />
      </div>
      {/* ── 로컬 AI 진단은 **숨겼다** (사용자 지시 2026-09-13: *"로컬AI는 숨겨놔바"*) ──
          이 카드는 **진단 결과만 보여 주는 개발자용 화면**이다 — 브라우저 내장 모델을
          쓸 수 있는지 판정하고, 못 쓰면 크롬 플래그·`chrome://components` 를 안내한다.
          시설 실무자가 할 수 있는 일이 아니고, 「미설정」 같은 빨간 상태만 눈에 띄어
          **고장으로 읽힌다.** 게다가 MCP 크롬에서는 구조적으로 늘 `unavailable` 이라
          여기서 본 값으로는 판정도 못 한다(PROJECT_PROFILE §1-5).
          **지우지는 않았다** — 개발 빌드에서는 그대로 보인다. 현장 dist 에서만 사라진다. */}
      {import.meta.env.DEV && <LocalAiSetup />}

      {/* 안내 음성 엔진(2026-09-21) — 기본은 이 PC 의 Supertonic, Azure 는 선택. 둘을 두 칸에 나란히. */}
      <GroupHeading icon={AudioLines} label="안내 음성 엔진" />
      <div className="grid grid-cols-1 laptop:grid-cols-2 gap-4">
        <SpeechEngineCards />
      </div>

      {/* 2026-09-21: 외부 동영상 키 카드를 걷어냈다(배경음악·영상은 이 PC 파일). 남은 둘은
          기상청(키 큰 카드)과 에어코리아 — 두 칸 격자에 나란히 둔다. 격자 기본(stretch)이라
          에어코리아 카드가 기상청 높이를 따라가 **옆 칸에 구멍이 안 남는다**(2026-09-13 지적
          *"저기만 공백 만들어놓으면 어떻게해"*). 순서는 쓰는 빈도 순 — 날씨가 먼저다. */}
      <GroupHeading icon={Cloud} label="바깥 자료 — 날씨 · 미세먼지" />
      <div className="grid grid-cols-1 laptop:grid-cols-2 gap-4">
        <KmaApiCard />
        <AirKoreaApiCard />
      </div>

      <GroupHeading icon={Zap} label="기기 · 일정 연동" />
      <div className="grid grid-cols-1 laptop:grid-cols-2 gap-4">
        <GoogleCalendarCard />
        <SwitchBotCard />
      </div>
    </div>
  )
}