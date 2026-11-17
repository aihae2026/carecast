// 머리줄 왼쪽 **메뉴 단추** — 이름표 옆에 따로 선다 (사용자 정정 2026-09-15).
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────────
// 이 이름표는 여태 **「간편 화면으로」 한 곳으로만** 갔다. 그런데 이 자리는 웹에서
// 「처음으로」인 동시에 **「여기서 갈 수 있는 데가 어디인가」를 묻는 자리**다.
//
// 지금 구조에서 그 답이 세 군데로 흩어져 있었다:
//   · 머리줄 탭     — 넓은 화면에 다섯, **좁은 화면에는 둘**
//   · 간편모음 서랍 — 「관리」 줄 넷
//   · 관리자 사이드바 — 아홉. **그런데 `/admin` 안에서만 보인다**
// 그래서 간편·캘린더 화면에서는 「대시보드」·「방송 로그」·「비상 방송 관리」로 갈 길이
// **아예 없었다.** 주소를 외우고 있어야 갔다.
//
// **이 메뉴는 그 셋을 한 장에 편다.** 어느 화면에 있든 이름표를 누르면 전부 보인다.
//
// ── **이름표에 얹지 않는다** (사용자 정정 2026-09-15) ────────────────────────────
// *"메뉴 버튼은 좋은데, 배너에다가 하지 말고 다른 메뉴로 옆에다가 넣으면 어떨까."*
//
// 처음엔 이름표(CareCast) 자체를 눌러 열게 했다. 그러면 **이름표의 옛 일**이 없어진다 —
// 웹에서 왼쪽 위 이름은 「처음으로」 자리인데, 메뉴가 열려 버리니 간편 화면으로 돌아가려면
// 메뉴를 열고 한 번 더 눌러야 했다. **한 자리에 두 가지 일을 시킨 것**이 문제였다.
//
// 그래서 갈랐다: **이름표는 「처음으로」, 그 옆 단추가 「메뉴」.** 둘 다 제 일만 한다.
// 「간편」은 메뉴 맨 위에도 그대로 남는다 — 어느 길로 와도 닿는다.
import { useEffect, useRef, useState } from 'react'
import { Menu, Home, Calendar, ListOrdered, Upload, LayoutDashboard, FileText, Sliders, Star, Wand2, Settings2, CloudLightning, AlertTriangle, Map, Landmark, Compass } from 'lucide-react'
import { useTourStage, 안내열기, 안내대기키 } from '../../lib/tourStage'

// ── 목록은 **여기 한 벌**이다 ────────────────────────────────────────────────
// 관리자 사이드바(`components/admin/Sidebar.jsx`)와 글자가 겹치지만, 그쪽은 **`/admin`
// 안에서 쓰는 차림표**이고 여기는 **어디서든 여는 전체 지도**다 — 언젠가 갈릴 수 있는
// 두 판단이라 묶지 않는다(`HomeAdminLinks` 머리말이 같은 이유를 적고 있다).
// 다만 **도착 주소는 같아야 한다** — `server/test/brand-menu.test.js` 가 대조한다.
const 묶음 = [
  {
    title: '화면',
    items: [
      { label: '간편',      to: '/simple',   Icon: Home,        설명: '오늘 방송과 지금 바로 내보내기' },
      { label: '캘린더',    to: '/calendar', Icon: Calendar,    설명: '예약을 달력·목록으로' },
      { label: '자동 순서',  to: '/flow',     Icon: ListOrdered, 설명: '일과방송 다섯의 차례 편집' },
      { label: '업로드',    to: '/upload',   Icon: Upload,      설명: '음원·동영상 올리기' },
    ],
  },
  {
    title: '보기',
    items: [
      { label: '대시보드',  to: '/admin?section=dashboard',    Icon: LayoutDashboard, 설명: '오늘 상태 한눈에' },
      { label: '방송 로그', to: '/admin?section=broadcastLog', Icon: FileText,        설명: '무엇이 나가고 안 나갔나' },
      // **`통째로`** — 이 주소는 `App.jsx` 가 **주소를 보고 껍데기를 통째로 갈아 끼우는**
      // 화면이라(`_IS_GUIDE`), 앱 안에서 주소만 바꾸면 주 `Routes` 에 없어서 **빈 화면**이 된다.
      // 저장소가 이미 겪고 적어 둔 함정인데(`admin/Sidebar.jsx` 가 그래서 `<a href>` 를 쓴다)
      // 이 메뉴가 그대로 밟았다(사용자 지적 2026-09-15). 그래서 **통째로 다시 연다.**
      { label: '시스템 안내도', to: '/guide', 통째로: true,  Icon: Map,             설명: '방송이 홀까지 가는 길' },
      // 처음 안내(N11·N18) — 언제든 다시 본다. 간편 화면에서만 돌므로 다른 화면이면 간편으로 옮긴 뒤 연다.
      { label: '처음 안내 다시 보기', to: '#tour', Icon: Compass, 설명: '하나씩 따라 해 보기 · 약 1분' },
    ],
  },
  {
    title: '설정',
    items: [
      { label: '음량 및 TTS',   to: '/admin?section=soundSettings',      Icon: Sliders },
      { label: '즐겨찾기 버튼', to: '/admin?section=favorites',          Icon: Star },
      { label: '초기 설정',     to: '/admin?section=setupWizard',        Icon: Wand2 },
      { label: '시스템 설정',   to: '/admin?section=systemSettings',     Icon: Settings2 },
      { label: 'AI · API 연동', to: '/admin?section=apiSettings',        Icon: CloudLightning },
      { label: '비상 방송 관리', to: '/admin?section=emergencyBroadcast', Icon: AlertTriangle },
      { label: '데이터 출처',   to: '/admin?section=dataCredits',        Icon: Landmark },
      // 「개발 일지」는 **입구만 걷었다**(사용자 지시 2026-09-16). 화면과 글은 그대로
      // 살아 있고 `/admin?section=devLog` 로 들어간다 — 사라진 것은 메뉴의 한 줄이다.
    ],
  },
]

export default function HomeBrandMenu({ onNavigate }) {
  const [열림, set열림] = useState(false)
  const 통ref = useRef(null)

  // 바깥을 누르거나 Escape 면 닫는다. **폰에는 Escape 가 없으므로** 바깥 누르기가
  // 유일한 길이고, 그래서 이 효과가 없으면 메뉴를 못 닫는다.
  useEffect(() => {
    if (!열림) return
    const 바깥 = (e) => { if (!통ref.current?.contains(e.target)) set열림(false) }
    const 키 = (e) => { if (e.key === 'Escape') set열림(false) }
    document.addEventListener('pointerdown', 바깥)
    document.addEventListener('keydown', 키)
    return () => {
      document.removeEventListener('pointerdown', 바깥)
      document.removeEventListener('keydown', 키)
    }
  }, [열림])

  // `통째로` 인 곳은 **주소를 통째로 다시 연다.** 앱 안에서 `navigate` 로 가면
  // 주 `Routes` 에 그 주소가 없어 빈 화면이 된다(위 주석).
  // 안내가 메뉴를 실제로 열어 보인다(마지막 장). `강조` 는 「처음 안내 다시 보기」 줄을 짚는다.
  const [강조, set강조] = useState(false)
  useTourStage({ 'menu': (on) => { set열림(!!on); if (!on) set강조(false) }, 'menu.hl': (on) => set강조(!!on) })

  const 가기 = (to, 통째로) => {
    set열림(false)
    if (to === '#tour') {
      try { localStorage.setItem(안내대기키, '1') } catch { /* 못 써도 아래로 연다 */ }
      if (window.location.pathname === '/simple') 안내열기(); else onNavigate('/simple')
      return
    }
    // `location.href = …` 가 아니라 `assign()` 이다 — 하는 일은 같고, 대입은
    // `react-hooks/immutability` 가 막는다(컴포넌트 밖 값을 고치는 꼴이라).
    if (통째로) { window.location.assign(to); return }
    onNavigate(to)
  }

  // ── **휴대폰에서는 안 그린다** (사용자 지시 2026-09-16) ─────────────────────
  // *"간편화면에 메뉴를 왜 넣었어, 그러니까 다깨지잖아 모바일에서는 메뉴 없애버려"*
  //
  // 머리줄은 한 줄로 고정인데(`flex-nowrap`), 390px 폰에서는 이름표 + 메뉴 + 확대 +
  // 탭 둘이 그 한 줄을 다투다 검색창까지 밀렸다. 메뉴 하나를 빼면 44px 짜리 자리가
  // 통째로 돌아온다.
  //
  // **JS 로 폭을 재지 않는다**(`HomeShell` 머리말과 같은 규칙) — 재면 첫 그림과 둘째
  // 그림이 달라 단추가 깜빡이고, 재는 시점에 따라 갈린다.
  //
  // **닿는 길은 안 끊는다.** 여기 있던 「대시보드」·「방송 로그」는 서랍의 「관리」 줄로
  // 내려갔다(`HomeAdminLinks`). 서랍은 휴대폰에도 있다. 나머지 설정들은 그 줄의
  // 「설정」 → 관리자 화면 왼쪽 메뉴판에 그대로 있다.
  return (
    <div ref={통ref} className="relative hidden tablet:block">
      {/* G-15 — 손으로 누르는 것은 44px 이상이다. 글자를 함께 두는 이유는
          **그림만 있는 단추는 눌러 봐야 아는 것**이 되기 때문이다(탭 이름표와 같은 규칙). */}
      <button type="button"
        onClick={() => set열림(v => !v)}
        data-tour="menu"
        aria-haspopup="menu" aria-expanded={열림}
        title="전체 메뉴"
        className={'flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 '
          + 'text-[13px] font-semibold transition-colors '
          + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-v3-ink/30 '
          + (열림
            ? 'border-ds-v3-ink bg-ds-v3-ink text-white'
            : 'border-ds-v3-line bg-white/60 text-ds-v3-ink-2 hover:text-ds-v3-ink hover:border-ds-v3-ink-3')}>
        <Menu size={16} strokeWidth={2} aria-hidden="true" />
        메뉴
      </button>

      {열림 && (
        // **폭을 화면에 맞춘다** — 390px 폰에서 고정 폭을 주면 오른쪽이 잘린다.
        // 세로도 화면을 넘지 않게 자르고 안에서 굴린다(설정 일곱 줄이 낮은 창에서 넘친다).
        <div role="menu" aria-label="전체 메뉴" data-tour="menu-panel"
          className="absolute left-0 top-[calc(100%+10px)] z-50 w-[min(300px,calc(100vw/var(--cc-zoom,1)-32px))]
                     max-h-[min(calc(70vh/var(--cc-zoom,1)),560px)] overflow-y-auto overscroll-contain
                     rounded-[14px] border border-ds-v3-line bg-white shadow-xl
                     py-2">
          {묶음.map((g, gi) => (
            <div key={g.title} className={gi > 0 ? 'mt-1 pt-1 border-t border-ds-v3-line/70' : ''}>
              <p className="px-3.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-ds-v3-ink-3">
                {g.title}
              </p>
              {g.items.map(({ label, to, Icon, 설명, 통째로 }) => (
                // G-15 — 손으로 누르는 것은 44px 이상이다.
                <button key={to} type="button" role="menuitem" onClick={() => 가기(to, 통째로)}
                  data-tour={to === '#tour' ? 'menu-tour' : undefined}
                  className={(to === '#tour' && 강조 ? 'bg-ds-v3-tts-bg ' : '') + `flex w-full items-start gap-2.5 min-h-[44px] px-3.5 py-2
                             text-left transition-colors hover:bg-ds-v3-surface-2
                             focus-visible:outline-none focus-visible:bg-ds-v3-surface-2`}>
                  <Icon size={16} strokeWidth={1.8} aria-hidden="true"
                    className="flex-none mt-[3px] text-ds-v3-ink-2" />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-ds-v3-ink">{label}</span>
                    {설명 && <span className="block text-[11.5px] leading-snug text-ds-v3-ink-3">{설명}</span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
