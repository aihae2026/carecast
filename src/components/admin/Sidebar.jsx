import {
  LayoutDashboard, FileText,
  AlertTriangle, Star, CloudLightning,
  Settings2, ChevronRight, Lightbulb, Map, Sliders, Wand2, Landmark, ScrollText,
} from 'lucide-react'
import BrandMark from '../shared/BrandMark'

// **그룹마다 색을 주지 않는다**(G-1, 2026-09-13). 왜 「방송설정」이 초록인지 답할 수
// 있는 사람이 없고, 세 덩어리는 이미 **글자 라벨**이 가른다. 왼쪽 선은 남기되 무채색이다.
//
// 여기 있던 것은 hex 세 개였고 옆에 `// cc-primary` 처럼 토큰 이름이 적혀 있었는데
// **그 주석이 거짓이었다.** UX-42(2026-09-12)가 대비 미달을 고치며 토큰을 어둡혔지만
// (`ds-v3-tts` #4F8EF7→#2563EB · `ds-v3-ink-3` #22C55E→#166534) 이 사본은 옛 값에 남았다.
// `tokens.css` 머리말이 경고하는 바로 그 실패다 — 사본은 조용히 옛 색으로 남는다.
const GROUPS = [
  { id: 'monitoring', label: '모니터링'   },
  { id: 'broadcast',  label: '방송설정'   },
  { id: 'system',     label: '시스템운영' },
]

const menuItems = [
  { id: 'dashboard',          label: '대시보드',            icon: LayoutDashboard, group: 'monitoring' },
  { id: 'broadcastLog',       label: '방송 로그',           icon: FileText,        group: 'monitoring' },

  // ── 소리와 즐겨찾기는 **방송설정**이다 (사용자 지시 2026-09-13) ────────────────
  // 「음량 및 TTS」가 모니터링에 있었다. 모니터링은 **보는 것**이고 이것은 **정하는 것**이다.
  // 즐겨찾기도 시스템 설정 안의 카드였는데, 그것은 기계 설정이 아니라 방송 문구라
  // 찾는 사람이 여기서 찾는다.
  // 소리 설정은 2026-09-11 에 이 한 화면으로 모았다(UX-37) — 예전엔 쉬운 화면·
  // 시스템설정 오디오·시스템설정 TTS 셋에 흩어져 있었다.
  { id: 'soundSettings',      label: '음량 및 TTS',         icon: Sliders,         group: 'broadcast' },
  { id: 'favorites',          label: '즐겨찾기 버튼',        icon: Star,            group: 'broadcast' },

  // ── 「방송일정 및 예약」·「음원 및 동영상 관리」는 **여기서 뺐다** (사용자 지시 2026-09-13)
  // 둘 다 머리줄 탭으로 올라갔다 — 「캘린더」와 「업로드」다. 사이드바에 그대로 두면
  // **한 화면으로 가는 길이 둘**이 되는데, 이 둘은 그래도 되는 종류가 아니다:
  // 사이드바에서 들어가면 관리자 사이드바를 낀 채로 도착해 "설정 안에 있는 화면"으로
  // 읽히고, 탭에서 들어가면 사이드바 없는 제 화면으로 도착한다. **같은 화면이 두 모습으로
  // 보이면 사람은 둘을 다른 것으로 기억한다.** 그래서 길을 하나로 줄인다.
  //
  // **옛 주소는 안 끊는다** — `/admin?section=weeklySchedule`·`musicManagement` 로 들어오면
  // `AdminMode` 가 그대로 그린다(`sectionMap` 에 남아 있다). 저장해 둔 링크가 죽지 않는다.
  // 사라진 것은 사이드바의 **입구**이지 화면이 아니다.
  // **「자동방송 편집」도 뺐다**(사용자 지시 2026-09-13) — 머리줄 「자동순서」 탭이
  // 같은 화면으로 간다. 위 둘과 같은 이유다: 길이 둘인데 도착한 모습이 다르면
  // 사람은 둘을 다른 화면으로 기억한다. 옛 주소는 그대로 산다.

  // 설치 세션(UX-01) — 사용자 원문: *"미리 시스템설정 한 메뉴탭에 빼놨다가 나중에
  // 설치파일 패키징할 때 기초설정 탭으로 쓰면되잖아"*. 그래서 시스템운영 그룹에 둔다.
  { id: 'setupWizard',        label: '초기 설정',           icon: Wand2,           group: 'system' },
  // ── **초기 설정 아래로 한 칸 들인다** (사용자 지시 2026-09-16) ────────────────
  // *"어차피 초기설정에 있는 내용들이니 초기설정보다 한 칸 띄움으로 위계를 잡으면"*
  //
  // 맞다. 이 둘은 초기 설정 마법사가 **단계로 물어보는 바로 그것**이다(기관 정보·
  // 시스템 설정·API 연결). 같은 줄에 나란히 두면 **넷이 서로 다른 일**처럼 보이는데,
  // 실제로는 하나가 나머지를 안내하는 관계다.
  //
  // **비상 방송 관리는 안 들인다** — 그것은 설정이 아니라 **운영**이고, 마법사의
  // 단계도 아니다. 들이면 「초기 설정에 딸린 것」으로 읽혀 급할 때 찾는 길이 흐려진다.
  { id: 'systemSettings',     label: '시스템 설정',         icon: Settings2,       group: 'system', 하위: true },
  // AI·API 는 **따로 모았다**(사용자 지시 2026-09-13) — 시스템 설정 안에서 그 갈래만
  // 3258px 라, 나머지를 보려면 매번 그 길이를 지나야 했다.
  { id: 'apiSettings',        label: 'AI · API 연동',       icon: CloudLightning,  group: 'system', 하위: true },
  { id: 'emergencyBroadcast', label: '비상 방송 관리',      icon: AlertTriangle,   group: 'system' },
  // ── 데이터 출처는 **제 메뉴다** (사용자 지시 2026-09-16) ──────────────────────
  // *"데이터 출처 저기다 집어넣으니까 뭔가 이상하잖아. 그냥 따로 시스템 운영 메뉴
  //   하나로 빼면 안될까?"* — 맞다. 사이드바 푸터는 **가는 곳**이지 읽는 곳이 아니다.
  { id: 'dataCredits',        label: '데이터 출처',         icon: Landmark,        group: 'system' },
  // 이용 조건 동의 · 합성 음성 게시문 인쇄 (사용자 지시 2026-10-07) — 데이터 출처와 같은 「밝혀 둘 것」 갈래라 바로 아래.
  { id: 'licenseNotice',      label: '라이선스 · 고지',     icon: ScrollText,      group: 'system' },
  // ── 「개발 일지」는 **입구만 없앴다** (사용자 지시 2026-09-16) ─────────────────
  // *"개발일지 삭제하고(대신에 DB는 보관하고 있어야지)"*
  //
  // 그래서 **지운 것은 이 한 줄뿐**이다. 화면(`DevLog`)도, 그 글이 들어 있는 표도
  // 그대로 산다 — `/admin?section=devLog` 로 들어가면 예전처럼 열린다.
  // 이 저장소가 「방송일정」·「음원 관리」를 사이드바에서 뺄 때와 같은 방식이다:
  // **사라지는 것은 입구이지 화면이 아니다.**
]

export default function Sidebar({ activeSection, onNavigate }) {

  return (
    // 높이에서 **아래 재생 바까지 뺀다**. `100vh - 머리줄` 만 빼면 사이드바 바닥이 화면
    // 맨 아래까지 내려가는데, 거기에는 재생 바가 항상 떠 있다(`fixed bottom-0`).
    // 그래서 창이 낮을수록 맨 아래 항목(「시스템 안내도」)이 그 바 뒤로 숨는다.
    // **`z-50` 을 낮추는 쪽은 안 골랐다** — 그러면 사이드바가 바 위로 올라가 이번엔
    // 바를 가린다. 겹치지 않게 **자리를 비우는** 것이 맞다.
    //
    // ── **40px 을 박아 두면 안 된다** (사용자 지적 2026-09-13, 두 번째) ─────────────
    // 그 바는 **접히면 40px, 펼치면 64px** 이다(`MusicPlayer.jsx`). 40 만 비워 두니
    // BGM 이 실제로 나가는 동안 24px 이 덮였고, 하필 그 자리가 「시스템 안내도」다 —
    // 그래서 "겹친다" 는 말이 두 번 나왔다. 이제 그 파일이 제 키를 변수로 내놓고
    // 여기서 그것을 쓴다(머리줄 높이를 `--cc-header-h` 로 넘기는 것과 같은 방식).
    //
    // ── 그런데 **높이 계산만으로는 안 맞았다** (실측 2026-09-14) ─────────────────────
    // 이 칸은 머리줄 바로 밑이 아니라 그보다 36px 아래에서 시작한다(본문 여백). 높이를
    // `100vh - 머리줄 - 재생바` 로 잡으면 **스크롤을 내려 붙기 전까지** 그 36px 만큼
    // 넘치고, 그만큼이 재생 바 뒤로 들어간다 — 실측으로 「시스템 안내도」가 **12px** 잘렸다.
    // 「사진에서 겹친다」는 지적이 세 번 나온 이유다(계산은 맞는데 시작점이 달랐다).
    //
    // 그래서 둘을 더 건다:
    //   · `overflow-y-auto` — 넘치면 **스크롤로 닿을 수 있게**. `hidden` 이면 그냥 잘린다.
    //   · `pb-12` — 마지막 항목과 재생 바 사이에 손가락이 들어갈 자리를 늘 비운다.
    // 스크롤 컨테이너가 되면 안의 `sticky` 가 죽지만, 이 안에는 sticky 가 없다(G-51 은
    // 본문 이야기다).
    // ── **모서리를 둥글린다** (사용자 지시 2026-09-16) ──────────────────────────
    // *"그 설정에서 왼쪽에 있는 메뉴화면 너무 각졌어, 좀 둥글하게 만들어 주고."*
    //
    // 이 화면의 카드·단추는 전부 둥글다(`card 22` / `box 14` / `btn 10`). 여기만
    // 직각이라 **혼자 각져 보였다.** `rounded-[14px]`(box)를 쓴다 — 넷 중 하나이지
    // 새 값이 아니다(G-12).
    //
    // **바깥쪽 두 모서리만** 둥글린다. 본문과 맞닿는 오른쪽은 각져야 두 면이 이어진다.
    // 그리고 **테두리를 토큰으로 바꿨다** — `#E8ECF4` 를 손으로 적고 있었는데 그 값은
    // `--ds-v3-line` 과 **같다.** 지금은 안 보이지만 토큰을 고치는 날 여기만 안 따라온다.
    <aside className="w-60 flex-shrink-0 bg-white flex flex-col overflow-y-auto z-50 relative pb-12
      rounded-l-[14px] border-r border-ds-v3-line
      tablet:sticky tablet:top-[var(--cc-header-h,64px)]
      tablet:h-[calc(100vh/var(--cc-zoom,1)-var(--cc-header-h,64px)-var(--cc-nowplaying-h,64px))]">
      {/* 로고 */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-ds-v3-line flex-shrink-0">
        <BrandMark size="sm" ai />
        {/* **둥근 알약이다** (사용자 지적 2026-09-13: *"왜 이렇게 각졌어, 전반적인 디자인
            라인은 둥근데"*). `rounded-md`(6px) 하나만 각져 있었다 — 이 화면의 다른 배지·칩은
            전부 알약(`rounded-full`)이다. 한 곳만 모서리가 다르면 그것이 먼저 눈에 띈다.
            바탕도 반투명으로 낮춰 이름표 옆에서 조용히 있게 한다. */}
        <span className="ml-auto t-sub text-ds-v3-ink-2 bg-ds-v3-bg/70 px-2 py-0.5 rounded-full font-normal">
          관리
        </span>
      </div>

      {/* 메뉴 목록 (그룹별) */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {GROUPS.map(group => (
          <div key={group.id}>
            <p className="t-sub font-semibold text-ds-v3-ink-2 px-3 mb-1.5 tracking-wide">
              {group.label}
            </p>
            {/* 줄 사이 **8px**(G-61). 2px 이었다 — 그것은 "한 부품 안쪽" 값인데
                메뉴 항목은 서로 다른 목적지다. 붙여 놓으면 한 덩어리로 읽혀
                어디를 누르는지가 흐려진다(G-62 근접성). */}
            <div className="space-y-2 border-l-[3px] border-ds-v3-line-2 pl-2.5">
              {menuItems.filter(item => item.group === group.id).map(item => {
                const Icon     = item.icon
                const isActive = activeSection === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    /* `하위` 는 **바로 위 메뉴에 딸린 것**이라는 표시다(2026-09-16).
                       들여쓰기만으로 말한다 — 선을 하나 더 그으면 그것대로 또 한
                       덩어리가 되고, 이 폭(사이드바)에서는 금방 어수선해진다. */
                    className={`w-full flex items-center gap-3 py-2.5 rounded-btn text-sm
                                transition-colors btn-press text-left group
                                ${item.하위 ? 'pl-7 pr-3' : 'px-3'}
                                ${isActive
                                  ? 'bg-ds-v3-tts-bg text-ds-v3-tts font-semibold'
                                  : 'text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-ds-v3-bg'}`}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    <span className="flex-1 leading-none">{item.label}</span>
                    {isActive && <ChevronRight size={14} className="flex-shrink-0 opacity-60" />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 데이터 출처는 **제 메뉴로 갔다**(사용자 지시 2026-09-16) — 사이드바 푸터에
          글을 붙여 두니 «메뉴가 아닌 것이 메뉴 자리에» 앉아 어수선했고, 작은 글씨로
          눌러 두니 정작 찾아야 할 때 못 찾았다. 위 「데이터 출처」 항목이 그 자리다. */}

      {/* 하단 — 버전 + 쉬운 화면 전환 */}
      <div className="border-t border-ds-v3-line p-4 flex-shrink-0">
        <p className="t-sub text-ds-v3-ink-2 text-center mb-3 nums">v1.0.0-beta</p>
        {/* 고도화 제안(코칭 브리프)은 직원이 보는 화면이 아니라 개발용이다. 그래서 메뉴가 아니라
            여기 한 줄로 두고, 개발 빌드에서만 보인다 — 현장 PC는 dist(프로덕션)라 이 줄이 없다.
            길이 없으면 매번 /dev-console을 손으로 쳐야 해서 붙였다.

            **navigate()를 쓰면 안 된다.** 개발 콘솔은 App.jsx에서 주소를 보고 갈아 끼우는
            별도 껍데기다(재생 코드를 아예 안 태운다). 화면 안에서 주소만 바꾸면 본 앱의
            Routes에는 /dev-console이 없어서 **빈 화면**이 된다 — 실제로 그렇게 만들었다가 고쳤다.
            /monitor 팝업이 window.open을 쓰는 것과 같은 이유다. 그래서 a 태그(통째 이동)다.
            sidebar-dev-console-link.test.js가 "DEV 밖으로 새지 않는다"와 "navigate가 아니다"를 고정한다. */}
        {import.meta.env.DEV && (
          <a
            href="/dev-console"
            target="_blank"
            rel="noopener"
            className="w-full flex items-center justify-center gap-2 py-2 mb-2 rounded-btn t-sub
                       font-normal text-ds-v3-ink-2 border border-dashed border-ds-v3-line
                       hover:text-ds-v3-tts hover:border-ds-v3-tts/40 btn-press transition-colors"
          >
            <Lightbulb size={13} />
            고도화 제안 (개발용)
          </a>
        )}
        {/* 시스템 안내도 — 방송이 어디를 거쳐 홀까지 가는지 그림으로 설명하는 화면.
            직원·방문객에게 보여 주는 것이라 개발 빌드 가드를 걸지 않는다(현장 dist에도 보인다).
            **여기도 navigate()가 아니라 a 태그다** — /guide는 App.jsx가 주소를 보고 통째로
            갈아 끼우는 별도 껍데기라(재생 코드를 안 태운다) 화면 안에서 주소만 바꾸면
            본 앱 Routes에 없어서 빈 화면이 된다. /dev-console에서 이미 한 번 겪은 함정이다. */}
        <a
          href="/guide"
          className="w-full flex items-center justify-center gap-2 py-2 mb-2 rounded-btn t-sub
                     font-normal text-ds-v3-ink-2 border border-ds-v3-line
                     hover:text-ds-v3-tts hover:border-ds-v3-tts/40 btn-press transition-colors"
        >
          <Map size={13} />
          시스템 안내도
        </a>
        {/* ── 돌아가는 길은 **머리줄의 탭**이다 ──────────────────────────────
            잠깐 여기 「간편 화면으로」 단추를 뒀었다. 그때는 이 화면이 `HomeShell` 밖이라
            탭 줄이 사라졌기 때문이다. 지금은 관리자 화면도 그 안에 있어 **탭 다섯이 늘 보인다**
            (가이드라인 G-26). **같은 일을 하는 길이 둘이면 어느 것이 뭔지 물어야 한다.**

            ── 「쉬운 화면으로 전환」도 걷었다 (사용자 지시 2026-09-13) ─────────────
            *"쉬운화면도 없애 이제, 자꾸 전으로 돌아가잖아"* — 이 단추가 옛 화면(`/`)으로
            가는 **유일한 눈에 띄는 입구**였고, 새 화면을 보다가 여기를 누르면 옛 디자인으로
            떨어졌다. 두 디자인을 오가면 어느 쪽이 지금 것인지 사람이 못 정한다.
            **`/` 주소 자체는 아직 안 건드렸다** — 현장 PC 가 매일 여는 화면이라
            무엇이 빠지는지 먼저 확인해야 한다(사용자 결정 대기). 여기서 없앤 것은 **입구**다. */}
      </div>
    </aside>
  )
}
