import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import HomeShell          from '../components/home/HomeShell'
import Sidebar            from '../components/admin/Sidebar'
import Dashboard          from '../components/admin/sections/Dashboard'
import BroadcastLog       from '../components/admin/sections/BroadcastLog'
import EmergencyBroadcast from '../components/admin/sections/EmergencyBroadcast'
import MorningEditor      from '../components/admin/sections/MorningEditor'
import MusicManagement    from '../components/admin/sections/MusicManagement'
import SystemSettings     from '../components/admin/sections/SystemSettings'
import AiApiSettings      from '../components/admin/sections/AiApiSettings'
import FavoritesSection   from '../components/admin/sections/FavoritesSection'
import SoundSettings      from '../components/admin/sections/SoundSettings'
import SetupWizard        from '../components/admin/sections/SetupWizard'
import WeeklySchedule    from '../components/admin/sections/WeeklySchedule'
import Placeholder        from '../components/admin/sections/Placeholder'
import ErrorBoundary      from '../components/shared/ErrorBoundary'
import DevLog            from '../components/admin/sections/DevLog'
import DataCreditsPage   from '../components/admin/sections/DataCreditsPage'
import LicenseNoticePage from '../components/admin/sections/LicenseNoticePage'
import LicenseConsentBanner from '../components/admin/LicenseConsentBanner'

// 섹션 ID → 컴포넌트 매핑
const sectionMap = {
  dashboard:          { Component: Dashboard          },
  broadcastLog:       { Component: BroadcastLog       },
  soundSettings:      { Component: SoundSettings      },
  weeklySchedule:     { Component: WeeklySchedule     },
  morningEditor:      { Component: MorningEditor      },
  musicManagement:    { Component: MusicManagement    },
  // **"준비 중" 이 아니다 — 일부러 안 만든 것이다**(UX-41, 2026-09-11).
  // 이 시스템은 **인증이 없는 것이 설계**다(PROJECT_PROFILE §1-1) — 직원이 각자 기기로
  // 곧바로 조작해야 하고, 방송을 내보내야 하는 순간에 로그인을 요구하면 그게 사고다.
  // 그런데 이 자리는 `Placeholder` 로 *"다음 업데이트에서 사용할 수 있습니다"* 라고
  // **거짓 약속**을 하고 있었다. 기다리면 생기는 것이 아니다.
  // 사이드바에는 없고 옛 링크로만 닿는다 — 닿았을 때 사실을 말한다.
  userPermissions:    { Component: () => <Placeholder
    title="사용자 권한 관리"
    상태="일부러 안 만들었습니다"
    설명="이 시스템은 로그인 없이 씁니다. 방송을 내보내야 하는 순간에 로그인을 요구하면 그게 사고라서, 직원이 각자 기기로 바로 조작할 수 있게 두었습니다."
    조건="다만 이 시스템이 붙는 망에 외부인이 들어올 수 있게 되면(게스트 와이파이 개방·원격 접속 허용 등) 이 전제는 다시 봐야 합니다."
  /> },
  emergencyBroadcast: { Component: EmergencyBroadcast },
  setupWizard:        { Component: SetupWizard        },
  systemSettings:     { Component: SystemSettings     },
  // 「AI · API 연동」과 「즐겨찾기」는 **시스템 설정에서 꺼낸 제 화면**이다(2026-09-13).
  // 하나는 너무 길어서(3258px), 하나는 방송설정 갈래에 있어야 찾을 수 있어서다.
  apiSettings:        { Component: AiApiSettings      },
  favorites:          { Component: FavoritesSection   },
  // **사이드바에서 뺐어도 화면은 산다**(2026-09-16) — 사용자 지시는 *"개발일지 삭제하고
  // (대신에 DB는 보관하고 있어야지)"* 였다. 지운 것은 **입구**이고, 저장해 둔 링크와
  // 그 글이 들어 있는 표는 그대로다.
  devLog:             { Component: DevLog             },
  dataCredits:        { Component: DataCreditsPage    },
  // 이용 조건 동의 · 합성 음성 게시문 인쇄 · 라이선스 요약(사용자 지시 2026-10-07).
  licenseNotice:      { Component: LicenseNoticePage  },
}

// 병합/삭제된 옛 섹션 id → 새 위치. sectionMap에서 항목이 지워질 때마다
// (Task 2~5) 여기 등록된 매핑이 이어받는다. expand는 목적지 페이지 안에서
// 자동으로 펼칠 아코디언/패널을 가리킨다.
const LEGACY_REDIRECTS = {
  systemStatus:       { section: 'dashboard',      expand: null },
  scheduledBroadcast: { section: 'weeklySchedule', expand: null },
  // 2026-09-13 — AI·API 가 제 화면이 됐다. 옛 링크는 그 화면으로 보낸다.
  aiSettings:         { section: 'apiSettings',    expand: null },
  // 2026-09-11 — 소리 설정을 '음량 및 TTS' 한 화면으로 모았다(UX-37).
  // 아코디언이 사라졌으므로 expand 는 필요 없다.
  ttsSettings:        { section: 'soundSettings',  expand: null },
  audioSettings:      { section: 'soundSettings',  expand: null },
}

function resolveSection(id) {
  if (sectionMap[id]) return { section: id, expand: null }
  if (LEGACY_REDIRECTS[id]) return LEGACY_REDIRECTS[id]
  return { section: 'dashboard', expand: null }
}

export default function AdminMode() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const mobileMenuRef = useRef(null)

  // ── 지금 어느 화면인가는 **주소가 정한다** (2026-09-13) ──────────────────────
  // 예전에는 주소를 **마운트 때 한 번만** 읽어 상태에 담았다(`useState(() => …)`).
  // 그래서 이미 `/admin` 이 떠 있는 채로 머리줄 탭을 누르면 — 자동순서 → 업로드 →
  // 설정 — **주소만 바뀌고 화면은 그대로**였다. 탭 불도 처음 자리에 머물렀다.
  // 사용자에게는 "탭이 안 눌린다 · 막히는 느낌"으로 보였다(실측: 주소는 52ms 만에
  // 바뀌는데 `activeSection` 은 안 바뀜).
  //
  // 상태를 지우고 **주소에서 곧바로 읽는다.** 판단 주체가 하나면 어긋날 자리가 없다.
  // 덤으로 뒤로가기가 화면 전환으로 이어진다(전에는 주소만 뒤로 가고 화면은 그대로였다).
  const { section: activeSection, expand: expandTarget } = resolveSection(searchParams.get('section'))

  // ── 화면을 옮기면 **맨 위에서 시작한다** (사용자 지적 2026-09-13) ──────────────
  // 주소만 바뀌고 스크롤은 그대로라, 긴 설정 화면을 내려 보다가 다른 메뉴를 누르면
  // **그 화면 중간에 떨어졌다**(실측: 설정에서 2000px 내린 뒤 「음량 및 TTS」를 누르니
  // scrollY 가 2000 그대로 · 화면 제목이 위로 1871px 벗어남). 새 화면인데 머리가 안 보이니
  // 사람은 "덜 그려졌나" 하고 위로 올려 본다.
  //
  // **펼칠 자리가 지정된 딥링크는 건드리지 않는다** — 그때는 목적지가 따로 있고
  // (`SystemSettings` 가 그 아코디언으로 옮겨 준다), 여기서 위로 올리면 그것을 덮어쓴다.
  // 자식 effect 가 먼저 돌고 부모가 나중이라, 조건을 안 걸면 **딥링크가 늘 진다.**
  useEffect(() => {
    if (expandTarget) return
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [activeSection, expandTarget])

  const closeMobileMenu = () => {
    const menu = mobileMenuRef.current
    if (!menu?.open) return
    menu.open = false
    menu.querySelector('summary')?.focus()
  }

  // 사이드바·대시보드에서 화면을 옮길 때도 **주소에 적는다.**
  // 예전에는 상태만 바꾸고 주소를 오히려 **지웠다**(`setSearchParams({})`) — 그래서
  // 화면과 주소가 갈렸고, 새로고침하면 대시보드로 떨어졌으며 링크를 건넬 수도 없었다.
  // 지금은 주소가 유일한 출처라 여기서 적기만 하면 화면이 따라온다.
  const handleNavigate = (id) => {
    closeMobileMenu()
    // **받은 id 를 그대로 적는다. 정규 id 로 바꿔 적지 않는다.**
    // `expand`(아코디언 펼침)는 URL 파라미터가 아니라 **옛 id 에서 파생**된다
    // (`aiSettings` → systemSettings + expand 'ai'). 정규화해 적으면 그 파생이 끊겨
    // **딥링크로 들어온 사람이 펼쳐진 채 도착하지 못한다.**
    // 주소에 옛 이름이 남는 것은 이미 이 제품의 딥링크 규약이다.
    setSearchParams({ section: id })
  }

  const section = sectionMap[activeSection] ?? sectionMap.dashboard
  const SectionComponent = section.Component

  // 머리줄의 어느 탭을 켜 둘 것인가. 「자동순서」 탭이 보내는 자리는 자동방송 편집이고,
  // 그 밖의 관리자 화면은 전부 「설정」 아래층이다(목업도 음원 화면에서 '설정'을 켜 둔다).
  // 머리줄에서 어느 탭에 불이 들어오나. 관리자 화면 여럿이 한 탭 아래 모여 있고,
  // **제 탭을 가진 둘만 따로 뺀다** — 자동순서·업로드. 그 밖은 전부 설정이다.
  // 여기를 안 고치면 「업로드」 탭을 눌러 도착해도 불은 「설정」에 들어와, 사람이
  // "내가 어디 있는지"를 화면에 대고 확인할 수 없게 된다.
  const tab = activeSection === 'morningEditor'   ? 'flow'
            : activeSection === 'musicManagement' ? 'media'
            : 'settings'

  return (
    // **탭 줄을 얹는다.** 예전엔 이 화면이 `HomeShell` 밖이라, 들어오는 순간 탭 줄이
    // 통째로 사라져 **한 방향 문**이 됐다(사용자: *"한번들어가면 간편이랑 캘린더로
    // 돌아오기 힘들잖아"*). 목업의 머리줄은 모든 화면 **바깥**에 있어 네 화면 다 보인다
    // (`v3.html` 의 `<header>` 가 `<main class="screen">` 밖이다). 가이드라인 G-26.
    //
    // **화면 안쪽은 한 칸도 안 옮긴다** — 사용자 지시 *"설정만큼은 형태에 유지하고"*.
    // 얹는 것은 껍데기이지 형태가 아니다.
    <HomeShell tab={tab} onNavigate={navigate} title={null} layout="page" backdrop="still">
    {/* **바탕은 껍데기가 깐다 — 화면이 자기 바탕을 다시 깔지 않는다**(G-45, 2026-09-13).
        여기 `bg-ds-v3-bg` 가 붙어 있었다. `ds-v3-bg` 와 `--ds-v3-bg` 는 **같은 값(#F4F6FB)** 이라
        색은 한 픽셀도 안 틀렸고, 그래서 아무도 못 알아챈 채 **물감 두 방울만 죽었다.**
        간편·캘린더는 물감이 비치는데 자동순서·설정만 "dev 그대로"로 보이던 원인이 이 한 줄이다
        (사용자 지적 2026-09-13). 조용히 틀리는 종류라 규칙으로 못 박았다. */}
    <div className="-mx-4 tablet:-mx-6 wide:-mx-8 flex flex-col tablet:flex-row">
      {/* 메뉴 원본은 Sidebar 한 곳에 둔다. 좁은 화면에서는 펼칠 때만 공간을 쓴다. */}
      <details ref={mobileMenuRef} className="tablet:hidden shrink-0 bg-white border-b border-ds-v3-line"
        onKeyDown={event => { if (event.key === 'Escape') closeMobileMenu() }}>
        <summary className="px-5 py-3 min-h-11 text-sm font-semibold text-ds-v3-tts cursor-pointer">관리 메뉴</summary>
        <div className="[&>aside]:w-full [&>aside]:h-auto [&>aside]:max-h-[calc(70dvh/var(--cc-zoom,1))]">
          <Sidebar activeSection={activeSection} onNavigate={handleNavigate} />
        </div>
      </details>
      <div className="hidden tablet:block shrink-0">
        <Sidebar activeSection={activeSection} onNavigate={handleNavigate} />
      </div>

      {/* 우측 콘텐츠 영역 — **폭을 묶는다.** 예전엔 화면이 넓어지는 만큼 카드가 가로로
          퍼져서, 넓은 모니터에서 한 줄이 너무 길어 읽기 불편했다(2026-09-11 사용자 지적).
          최대 폭은 `.page-shell`(src/index.css) 한 곳에서만 정한다 — 화면마다 적으면
          섹션을 하나 추가할 때마다 또 어긋난다. */}
      <main className="flex-1 min-w-0 py-7 pb-24">
        <div className="page-shell">
          {/* 이용 조건 미동의 알림 — 알리기만 한다(방송·화면을 막지 않는다, 사용자 결정 2026-10-07).
              그 화면 자체에서는 같은 말을 두 번 하지 않는다. */}
          {activeSection !== 'licenseNotice' && <LicenseConsentBanner onNavigate={handleNavigate} />}
          {/* 한 섹션이 터져도 사이드바는 살아 있어야 한다 — 다른 화면으로 갈 수 있다(UX-44).
              `resetKey` 로 섹션을 옮기면 저절로 다시 그려 본다. */}
          <ErrorBoundary 이름="이 화면" resetKey={activeSection}>
            {activeSection === 'dashboard'
              ? <Dashboard onNavigate={handleNavigate} />
              : activeSection === 'systemSettings'
              ? <SystemSettings initialGroup={expandTarget} />
              : <SectionComponent />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
    </HomeShell>
  )
}
