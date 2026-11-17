// 통합 홈의 공통 프레임 — 머리줄(세그먼트 넷) · 물감 배경 · 폭 규칙.
// 디자인 정본: mockup-UX01/mockup/v3.html. 색은 tokens.css 의 `--ds-v3-*` 뿐이다.
import { useEffect, useRef, useState } from 'react'
import { useTourStage } from '../../lib/tourStage'
import { ChevronLeft, Home, Calendar, ListOrdered, Upload, Settings } from 'lucide-react'
import BrandMark from '../shared/BrandMark'
import WarmupNotice from '../shared/WarmupNotice'
import HomeClock from './HomeClock'
import BigViewButton from './BigViewButton'
import HomeBrandMenu from './HomeBrandMenu'
import useViewWidth from '../../hooks/useViewWidth'

// 탭 **둘**(2026-09-15 에 다섯에서 줄였다). 어느 쪽이든 **기존 화면으로 보낸다** — 같은 기능을 새로
// 만들지 않는다. 목업의 독립 화면은 다음 단계에서 그 화면들을 이 틀 안으로 옮기며 붙인다.
//
// **「간편」은 `/simple` 이다. `/` 가 아니다**(V③ 검수 2026-09-13 지적).
// 통합 홈의 주소는 아직 `/simple` 이고 `/` 는 EasyMode 다. `/` 로 보내면 지금 보고 있는
// 화면을 떠나는 것이라, **입력하던 초안이 그 자리에서 사라진다.**
// `/` 를 통합 홈으로 바꾸는 날 이 한 줄도 같이 바꾼다.
//
// ── 「업로드」를 설정 밖으로 꺼냈다 (사용자 결정 2026-09-13) ──────────────────
// 음원·동영상 올리기는 **자주 하는 일**인데 설정 사이드바 일곱 칸 중 하나에 묻혀 있었다.
// 자주 하는 일이 설정 안에 있으면 사람이 그 기능을 안 쓰거나 매번 길을 헤맨다.
// **설정에서 지우지는 않는다** — 두 길이 같은 화면으로 가는 것은 중복이 아니라 지름길이다
// (목업 v3 머리말의 판단 그대로. dev 의 빠른설정도 그렇게 한다).
//
// ── 이름표에 그림을 함께 단다 (사용자 결정 2026-09-13) ───────────────────────
// 이모지가 아니라 **선 아이콘**이다. 이모지는 기기·글꼴마다 모양이 갈리고 색이 제멋대로라
// 이 제품의 색 셋과 부딪힌다(G-38 에서 📡 를 걷은 것과 같은 이유).
// 아이콘은 **글자를 대신하지 않고 거든다** — 이름표는 그대로 둔다. 요양원 실무자에게
// 그림만 있는 탭은 "무엇인지 눌러 봐야 아는" 것이 된다.
// ── **둘로 줄이는 것은 휴대폰에서만이다** (사용자 정정 2026-09-15) ───────────────
// 처음 지시는 *"위에 간편화면이랑 캘린더만 띄워주는건 어때 토글로"* 였고, 그것을
// **모든 폭에** 적용했다. 그러자 넓은 화면에서도 탭이 둘만 남아 자동순서·업로드·설정이
// 머리줄에서 사라졌다. 사용자 정정: ***"저건 모바일에서만 적용하라고."***
//
// 그래서 목록은 **다섯 그대로 두고**, 좁은 화면에서만 셋을 감춘다(`폰에도` 가 없는 것).
// **JS 로 폭을 재지 않는다** — 재면 첫 그림과 두 번째 그림이 달라 탭이 깜빡이고,
// 재는 시점에 따라 갈린다. CSS 로 감추면 어느 폭에서든 처음부터 맞다.
//
// 좁은 화면에서 감추는 셋은 **서랍의 「관리」 줄**에서 그대로 들어간다
// (`HomeAdminLinks.jsx`). 그래서 감춰도 닿는 길이 없어지지 않는다 —
// 오히려 서랍은 휴대폰에도 있어서, 탭 줄을 통째로 안 그리던 때보다 넓다.
const TABS = [
  { id: 'home',     label: '간편',     to: '/simple',   Icon: Home,        폰에도: true },
  { id: 'calendar', label: '캘린더',   to: '/calendar', Icon: Calendar,    폰에도: true },
  { id: 'flow',     label: '자동순서', to: '/flow',     Icon: ListOrdered },
  { id: 'media',    label: '업로드',   to: '/upload',   Icon: Upload },
  // **`/admin` 만 주면 대시보드가 뜬다**(`resolveSection(null)` → dashboard).
  // 탭 이름은 「설정」인데 도착지가 대시보드면 이름과 도착지가 다르다.
  { id: 'settings', label: '설정',     to: '/admin?section=systemSettings', Icon: Settings },
]

// ── 나머지 셋은 **서랍으로 내려갔다** ───────────────────────────────────────────
// **지우지 않았다.** 탭에서 빠진다고 화면이 없어지면 그건 줄인 것이 아니라 잃은 것이다.
// 자동순서·업로드·설정은 간편모음(서랍)의 「관리」 줄에서 그대로 들어간다
// (`components/home/HomeAdminLinks.jsx` 가 그 목록을 들고 있다).
// 그리고 서랍은 **휴대폰에도 있어서**, 오히려 예전보다 닿는 길이 넓어졌다 —
// 탭 줄은 휴대폰에서 안 그려지고 있었다.
//
// **목록을 여기 두고 내보내지 않는다.** 이 파일은 컴포넌트 파일이라 값을 함께 내보내면
// fast refresh 가 깨지고(`react-refresh/only-export-components`), 무엇보다
// 「탭에서 뺀 것」과 「서랍에 넣을 것」은 언젠가 갈릴 수 있는 **다른 판단**이다.


/**
 * @param {string}  tab       지금 어느 탭인가 (`home` · `calendar` · `flow` · `settings`)
 * @param {string|React.ReactNode|null} title
 *                            가운데 큰 제목. **`null` 이면 안 그린다** — 캘린더·자동순서는
 *                            제 화면의 머리를 따로 갖는다(목업 v3).
 *                            **글자 대신 부품을 넣어도 된다** — 홈은 `HomeHeadline` 을 넣어
 *                            이 자리를 돌린다(2026-09-15). 껍데기는 h1 만 씌우고, 무엇을
 *                            띄울지·언제 넘길지는 그 부품이 정한다.
 * @param {'center'|'page'} layout
 *                            `center` 는 부품이 가운데로 모이는 홈, `page` 는 폭을 다 쓰는 화면.
 *                            **`center` 에서는 폭을 자식이 정한다** — 여기서 `width:100%` 를 주면
 *                            자식의 `max-w-[720px]` 가 덮여서 검색창이 1280 을 다 차지한다(실측).
 */
export default function HomeShell({
  tab, onNavigate, drawerOpen, onToggleDrawer,
  title = '무엇을 방송할까요?', layout = 'center', backdrop = 'drift', children,
}) {
  // 크게 보기에서 실제 폭(창 ÷ 배율)이 모자라는가 — 머리줄 시계·탭 그림을 뺄지 가른다(`hooks/useViewWidth`).
  const { 폭: 보이는폭, 배율 } = useViewWidth()
  const 좁은확대 = 배율 > 1 && 보이는폭 < 1200
  const 아주좁은확대 = 배율 > 1 && 보이는폭 < 1000
  // ── **폭을 어림하지 말고 탭 줄이 실제로 넘치는지 잰다** (사용자 신고 2026-09-18 밤) ──────────
  // *"아주큰화면으로 하면 설정 짤리는거 아직도 안고쳤어?"* — 위 두 줄은 「보이는 폭」으로 어림한다.
  // 그런데 탭 글자 폭은 **글꼴이 정한다.** 노트북 설치판(Edge 앱 창)에서는 탭이 이 PC 크롬보다 넓게 그려져,
  // 보이는 폭이 1200 을 넘어 시계가 남은 채로 탭 줄이 `50%-100px` 칸에 갇히고 **「설정」이 밖으로 밀렸다.**
  // (이 PC 크롬 1920·1536 × 1.5배에서는 다 들어가서 재현되지 않았다 — 어림값이 맞는 PC 가 있고 아닌 PC 가 있다.)
  // 그래서 **탭 다섯이 실제로 차지할 폭**(`scrollWidth`)을 재서, 시계 칸에 안 들어가면 시계를 빼고,
  // 시계를 빼도 안 들어가면 그림을 뺀다. 재는 값은 **그림을 다 켠 폭**으로 맞춰 둔다 — 그림을 뺀 폭으로 재면
  // 「들어간다 → 그림 켬 → 안 들어간다」로 깜빡인다.
  const navRef = useRef(null)
  const 빈칸Ref = useRef(null)
  const [탭넘침, set탭넘침] = useState({ 시계: false, 그림: false, 좁힘: false })
  // **셋째 단계 — 탭 간격·글씨를 줄인다** (QA 2026-09-18: 창 1024 × 1.5배에서 시계·그림을 다 빼도 48px 넘침, 실측).
  // 좁힌 채로 재면 폭이 줄어 「들어간다 → 넓힘 → 넘친다」로 깜빡이므로, **넓은 채로 잰 폭**을 기억해 두고 그것으로 가른다.
  const 넓은폭Ref = useRef(0)
  useEffect(() => {
    const nav = navRef.current
    const 빈칸 = 빈칸Ref.current
    const 상자 = nav?.parentElement
    if (!nav || !빈칸 || !상자) return
    const 재기 = () => {
      const cs = getComputedStyle(상자)
      const 왼 = parseFloat(cs.paddingLeft) || 0
      const 오 = parseFloat(cs.paddingRight) || 0
      const 간격 = parseFloat(cs.columnGap) || 0
      // 그림 하나 = 16px + 탭 안 간격 6px(gap-1.5). 그림을 뺀 채라면 그만큼 더해 「다 켠 폭」으로 맞춘다.
      // **보이는 탭만** 센다 — 휴대폰 폭에서는 셋이 `hidden` 이라 세면 66px 을 더 어림한다(코드 검수 2026-09-18).
      const 보이는탭 = [...nav.children].filter((el) => el.offsetParent !== null).length
      const 그림몫 = nav.dataset.icons === 'off' ? 22 * 보이는탭 : 0
      const 필요 = nav.scrollWidth + 2 + 그림몫                 // +2 = 테두리 1px 양쪽
      const 시계칸 = (상자.clientWidth - 왼 - 오) / 2 - 100       // `laptop:max-w-[calc(50%-100px)]` 과 같은 값
      const 여유 = 상자.clientWidth - 오 - 빈칸.offsetLeft - 간격  // 시계를 뺐을 때 탭 줄이 쓸 수 있는 폭
      const 좁힌중 = nav.dataset.compact === 'on'
      // 그림을 뺀 폭 — 좁히지 않은 동안에만 새로 잰다(좁힌 뒤에는 기억한 값을 쓴다).
      if (!좁힌중) 넓은폭Ref.current = 필요 - 22 * 보이는탭
      const 다음 = { 시계: 필요 > 시계칸, 그림: 필요 > 여유, 좁힘: 넓은폭Ref.current > 여유 }
      set탭넘침(앞 => (앞.시계 === 다음.시계 && 앞.그림 === 다음.그림 && 앞.좁힘 === 다음.좁힘) ? 앞 : 다음)
    }
    재기()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(재기)
    ro.observe(상자)
    ro.observe(nav)
    ro.observe(빈칸)   // 왼쪽 묶음(「아주 크게」 글자 등)이 바뀌면 여유가 바뀐다
    // 글꼴이 늦게 들어오면 탭 폭이 바뀐다 — 그때 한 번 더 잰다.
    document.fonts?.ready?.then(재기).catch(() => {})
    return () => ro.disconnect()
  }, [])
  const 시계뺌 = 좁은확대 || 탭넘침.시계
  const 그림뺌 = 아주좁은확대 || 탭넘침.그림
  const 탭좁힘 = 탭넘침.좁힘
  // **물감은 관리자 화면에도 깐다. 다만 거기서는 움직이지 않는다**(G-46, 2026-09-13).
  // 화면 언어를 만드는 것은 움직임이 아니라 **형태와 색**이라, 정지한 물감도 같은 얼룩·같은
  // 색이라 통일감은 그대로 얻는다. 움직임만 빼는 이유는 머무는 시간이 달라서다 — 홈은 훑고
  // 나가는 곳이지만 자동순서·설정은 **문구를 치고 시각을 고치며 오래 머무는 곳**이고,
  // 입력란에 눈이 고정된 동안 주변시에서 26~31초 주기로 면의 밝기가 계속 변한다.
  // 정보를 나르지 않는 움직임이므로 꺼도 잃는 것이 없다.
  // ── 머리줄 높이를 재서 알려 준다 ──────────────────────────────────────────
  // **매직 넘버 64 를 두지 않는다.** 서랍은 머리줄 **아래에서** 시작해야 하는데, 머리줄
  // 높이는 폭에 따라 다르다 — 1440 미만에서는 탭 줄이 한 줄을 통째로 차지해 **103px** 이다
  // (실측). 64 로 박아 두니 390 에서 서랍 위 39px 이 머리줄에 덮였고, 그 자리에 있는
  // **「닫기」 단추가 아예 안 눌렸다** — 머리줄(z-40)이 서랍(z-35)보다 위라 클릭을 먹는다.
  // 폰에는 Escape 키도 없어서 손잡이 말고는 닫을 길이 없었다(V② 적대 검수 2026-09-13).
  // 탭 글자가 바뀌거나 줄이 하나 더 늘면 그 숫자는 또 틀린다. 그래서 **재서 쓴다.**
  const headerRef = useRef(null)
  const rootRef   = useRef(null)
  const [안내탭, set안내탭] = useState(null)
  useTourStage({ 'tabs.on': (id) => set안내탭(id || null) })
  useEffect(() => {
    const el = headerRef.current
    const root = rootRef.current
    if (!el || !root) return
    const apply = () => root.style.setProperty('--cc-header-h', `${Math.round(el.offsetHeight)}px`)
    apply()
    if (typeof ResizeObserver === 'undefined') return   // 아주 낡은 브라우저 — 폴백 값이 쓰인다
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // `skin-v3` — 이 껍데기 안에 들어온 화면은 v3 결을 입는다(G-49). 옛 `.card-base` 를
  // 쓰는 화면(자동순서·설정)이 **파일을 고치지 않고** 새 반경·그림자를 받는 길이다.
  // 규칙은 `src/index.css` 의 `.skin-v3 .card-base` 한 곳에만 있다.
  return (
    // `data-plain-cards` — **모든 탭의 카드·입력칸**을 물감 없는 흰색으로(N15 간편 → 사용자 2026-09-17 새벽 확장:
    // *"캘린더 검색창이랑 캘린더도 흰배경으로 … 지금 간편화면만 배경이 흰색 카드 적용됐고 다른데는 안됐잖아"*).
    // 09-16 의 설정·캘린더 카드 옅은 물감은 이 지시로 대체된다. 배경 두 방울은 그대로. 규칙은 `index.css` 한 곳이다.
    <div ref={rootRef} data-plain-cards=""
      className="skin-v3 min-h-screen bg-ds-v3-bg text-ds-v3-ink" style={{ wordBreak: 'keep-all' }}>
      {/* 머리줄 — 화면이 바뀌어도 이 줄은 늘 같은 자리에 있다 */}
      {/* ── **머리줄이 사이드바보다 위다** (현장 버그 2026-09-15) ────────────────────
          이름표 메뉴를 단 뒤, `/admin` 에서 **메뉴가 뜨는데 눌러도 안 움직였다.**

          z 를 올려서 될 일이 아니었다 — `sticky` + `z-index` 는 **쌓임 맥락을 만든다.**
          머리줄이 `z-40` 이면 그 안의 메뉴는 아무리 `z-50` 을 줘도 **40 안에 갇히고**,
          관리자 사이드바(`z-50`)가 그 위를 덮는다. 덮인 자리의 클릭은 사이드바가 먹는다.

          그래서 **머리줄 자체**를 올린다. 60 인 이유: 사이드바(50)보다 위, 알림
          토스트(70)·경보 배너(200)·모달(9000)보다 아래. 저 셋은 머리줄을 덮어야 한다.
          `server/test/header-above-sidebar.test.js` 가 이 순서를 고정한다. */}
      <header ref={headerRef} className="sticky top-0 z-[60] border-b border-ds-v3-line bg-ds-v3-bg/90 backdrop-blur-md">
        {/* ── **머리줄은 한 줄이다** (사용자 신고 2026-09-16) ────────────────────────
            *"이거 왜 토글 간편-캘린더 이거 토글 위치 왜 바뀌었냐? … 이렇게 겹쳐지잖아."*

            `flex-wrap` 이었다. 그래서 안에 든 것이 조금만 넓어져도(크게 보기 단추를
            더한 것, 배율을 올린 것) **탭 줄이 둘째 줄로 떨어졌다.** 그러면 탭이 오른쪽
            끝에서 왼쪽 끝으로 **자리를 옮기고**, 머리줄이 두 배로 높아지면서 밑의 글과
            겹쳐 보였다.

            **접히게 두는 것이 애초에 틀린 선택이었다.** 머리줄은 자리가 고정돼야
            사람이 눈으로 찾는다 — 접히는 순간 「어제 여기 있던 것」이 딴 데로 간다.
            이제 **안 접는다.** 좁아지면 탭 줄이 제 안에서 가로로 밀린다(`min-w-0`),
            머리줄 높이는 그대로다. */}
        <div className="relative mx-auto w-full max-w-[1280px] px-4 tablet:px-6 wide:px-8
                        flex flex-nowrap items-center gap-x-3 tablet:gap-x-4 h-14 wide:h-16">
          {/* ── 이름표와 메뉴는 **다른 단추다** (사용자 정정 2026-09-15) ─────────────
              *"메뉴 버튼은 좋은데, 배너에다가 하지 말고 다른 메뉴로 옆에다가 넣으면 어떨까."*

              한때 이름표 자체를 눌러 메뉴를 열게 했는데, 그러면 **이름표의 옛 일**
              (「처음으로」)이 없어진다 — 간편 화면으로 돌아가려면 메뉴를 열고 한 번 더
              눌러야 했다. 한 자리에 두 가지 일을 시킨 것이 문제였다.

              이름표는 「처음으로」, 옆 단추가 「메뉴」. 둘 다 제 일만 한다. */}
          <button type="button" onClick={() => onNavigate('/simple')}
            title="간편 화면으로"
            className="flex items-center gap-2 text-[17px] font-semibold tracking-tight
                       rounded-full px-1 -mx-1 transition-colors hover:text-ds-v3-ink-2
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-v3-ink/30">
            <BrandMark size="lg" />
          </button>
          <HomeBrandMenu onNavigate={onNavigate} />
          {/* ── **크게 보기** (사용자 지시 2026-09-15) ────────────────────────────
              *"나이대가 높다보니까 노안이 많아 … 큰화면보기도 하나."*

              **자리를 여기로 옮겼다**(사용자 신고: *"아주크게 하자마자 아주크게 토글이
              옆으로 빠져가니까 엥? 하잖아"*). 처음엔 탭 줄 오른쪽 끝에 뒀는데, 크게
              하면 탭 다섯이 한 줄에 안 들어가 **줄이 접히면서 단추가 딴 데로 튀었다** —
              방금 누른 단추가 사라지는 셈이다.

              **왼쪽 묶음(로고·메뉴)은 늘 첫 줄 맨 앞이라 안 밀린다.** 배율을 바꿔도
              단추가 제자리에 있어서, 한 번 더 눌러 되돌리기도 쉽다. */}
          <BigViewButton />
          {/* 실시간 시계 — 목업 v3 머리줄의 `.site` 와 **같은 자리·같은 규칙**(세로선 + 잉크2).
              좁은 화면에서는 안 그린다(`hidden tablet:flex`) — 거기서는 탭 다섯이 이미
              한 줄을 통째로 쓰고 있어, 시계를 넣으면 머리줄이 세 줄이 된다. */}
          {/* ── 시계는 **화면 한가운데**다 (사용자 정정 2026-09-16) ──────────────────
              *"넌 이게 가운데냐, 「무엇을 방송할까요」 위가 가운데 아니냐?"*

              맞다. 앞 판은 양옆에 `flex-1` 을 두었는데 그것은 **남는 자리의 가운데**이지
              화면의 가운데가 아니다 — 왼쪽 묶음과 탭 줄의 폭이 다르니 그만큼 밀린다.
              밑에 있는 제목·검색창은 화면 한가운데에 서므로 **줄이 안 맞아 보였다.**

              그래서 자리에서 빼내 **절대 가운데**에 세운다. 이제 제목과 세로로 정렬된다.
              `pointer-events-none` — 가운데를 가로지르는 층이라 밑의 것을 가리면 안 된다. */}
          <div ref={빈칸Ref} className="flex-1" />
          {/* **크게 보기에서 폭이 모자라면 시계를 뺀다** (사용자 신고 2026-09-17 「큰화면에서는 토글 깨져보인다」).
              CSS 폭 조건은 확대를 몰라서 1536 창 1.5배(실제 1024)에서도 시계·탭 다섯이 다 서려다 「설정」이 밀려났다.
              시계는 화면 위 날짜라 없어도 조작은 그대로다. 보통 배율에서는 예전과 같다(실제 폭 = 창 폭). */}
          {!시계뺌 && (
            <div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
              <HomeClock />
            </div>
          )}
          {/* ── 휴대폰에도 **탭 줄을 그린다** (사용자 결정 2026-09-15, 앞 판 뒤집음) ──
              2026-09-14 에는 안 그렸다 — 탭 **다섯**이 좁은 화면에서 한 줄을 통째로 쓰면서
              머리줄을 두 줄로 만들었기 때문이다(실측: 다섯 칸 합 423px > 쓸 수 있는 358px).
              그 대가로 **휴대폰에는 캘린더로 갈 입구가 없었다.**

              이제 탭이 **둘**이라 들어간다. 줄인 것이 곧 입구를 되찾아 준 셈이다.
              나머지 셋(자동순서·업로드·설정)은 서랍의 「관리」 줄로 내려갔다 —
              **서랍은 휴대폰에도 있어서** 닿는 길이 예전보다 오히려 넓어졌다. */}
          {/* **줄지 않고 밀린다.** `min-w-0` 이 있어야 넘칠 때 이 안에서 가로로 밀리고,
              없으면 이 상자가 제 내용만큼 버텨서 머리줄 전체를 넘치게 만든다.
              스크롤 막대는 안 그린다 — 탭 다섯은 손가락으로 쓸어도 되고, 막대가 보이면
              머리줄이 지저분해진다. */}
          {/* **탭 줄은 가운데를 넘어오지 못한다** (사용자 신고 2026-09-16, 겹침).
              *"저기 창 줄이니까 시간 쪽 겹쳐지는거 버그 보이지?"*

              시계가 `absolute` 로 화면 한가운데 떠 있어서 **아무도 비켜 주지 않는다** —
              탭이 늘어나면 그대로 시계 밑을 파고든다. 시계 반폭(약 75px)에 사이 간격을
              더해 `50% - 100px` 까지만 쓴다. 넘치면 이 안에서 가로로 밀린다.

              **시계가 보이는 폭(`laptop`)에서만 건다.** 그 아래에는 시계가 없어 칸을
              아낄 이유가 없고, 걸면 탭 다섯이 괜히 좁은 칸에 갇힌다.
              두 폭이 어긋나면 그 사이에서 다시 겹치므로 `header-one-line.test.js` 가
              **둘이 같은지**를 본다. */}
          <nav ref={navRef} data-icons={그림뺌 ? 'off' : 'on'} data-compact={탭좁힘 ? 'on' : 'off'}
               className={'flex min-w-0 gap-0.5 overflow-x-auto rounded-full '
                          + (시계뺌 ? '' : 'laptop:max-w-[calc(50%-100px)] ')
                          + 'border border-ds-v3-line bg-white/60 p-[3px] '
                          + '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}
               aria-label="화면" data-tour="tabs">
            {TABS.map(t => {
              // 처음 안내(N18)가 탭을 하나씩 짚을 때는 **겉모습만** 옮긴다 — 이동하지 않는다.
              const on = 안내탭 ? t.id === 안내탭 : t.id === tab
              const Icon = t.Icon
              return (
                <button key={t.id} type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => onNavigate(t.to)}
                  // ── **둘이라 가로로 들어간다** (2026-09-15) ─────────────────────────
                  // 탭이 다섯이던 때는 안 들어갔다. 실측: 가로로 놓으면 다섯 칸 합이
                  // **423px** 인데 390 화면의 탭줄이 쓸 수 있는 폭은 358px 이었다.
                  // flex 칸은 기본 `min-width:auto` 라 **글자 폭 아래로는 안 줄어든다** —
                  // `flex-1` 을 줘도 넘쳤다. 그래서 그때는 **세로로 쌓아서**(그림 위, 글자 아래)
                  // 칸 폭을 글자 폭까지 줄였고, 탭 줄이 제 줄을 통째로 썼다.
                  //
                  // **좁은 화면에서는 둘만 남는다.** 「간편」·「캘린더」 두 칸이면 가로로 놓아도
                  // 140px 안쪽이라, 이름표(CareCast 약 110px) 옆에 **같은 줄로** 앉는다.
                  // 그래서 머리줄이 한 줄로 유지된다 — 2026-09-14 에 탭을 아예 숨긴 이유가
                  // 「머리줄이 두 줄이 된다」였는데, 그 이유가 없어진 것이다.
                  //
                  // **넓은 화면에서는 다섯이 다 보인다**(사용자 정정 2026-09-15 —
                  // *"저건 모바일에서만 적용하라고"*). `tablet` 위로는 폭이 남으므로
                  // 줄이던 이유 자체가 없다. 감추는 판단은 **CSS 한 곳**에서만 한다 —
                  // JS 로 폭을 재면 첫 그림과 두 번째 그림이 달라 탭이 깜빡인다.
                  //
                  // 이름표는 그대로 둔다 — 요양원 실무자에게 그림만 있는 탭은
                  // "눌러 봐야 아는 것"이 된다(위 머리말의 판단 그대로).
                  // **탭은 안 쪼그라든다**(2026-09-16). 줄을 안 접게 만들면서 탭이 제
                  // 안쪽까지 눌려 **「설정」 글자가 잘렸다**(사용자 신고: *"사진은 설정 값
                  // 씹혔어"*). 밀리는 것은 **줄**이고 탭이 아니다 — `shrink-0` 과
                  // `whitespace-nowrap` 이 그 경계를 긋는다.
                  className={'items-center justify-center gap-1.5 shrink-0 whitespace-nowrap '
                    + (t.폰에도 ? 'inline-flex ' : 'hidden tablet:inline-flex ')
                    + (탭좁힘 ? 'px-1.5 t-sub ' : 'px-2.5 t-sub tablet:px-3 tablet:t-label wide:px-4 ')
                    + 'min-h-[44px] py-1 rounded-full font-semibold transition-colors '
                    + (on ? 'bg-ds-v3-ink text-white' : 'text-ds-v3-ink-2 hover:text-ds-v3-ink')}>
                  {/* 그림은 **거들 뿐**이라 낭독기에서 숨긴다 — 이름표를 두 번 읽으면 방해가 된다.
                      선 굵기 1.8 은 작은 크기에서 형태가 뭉치지 않는 값이다. */}
                  {!그림뺌 && <Icon size={16} strokeWidth={1.8} aria-hidden="true" className="flex-none" />}
                  {t.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      {/* ── **준비 중이면 준비 중이라고 말한다** (사용자 지시 2026-09-16) ──────────
          갓 설치한 PC 의 첫 기동은 방송 문안을 여덟 번 합성한다(실측 18초 안팎). 그동안
          화면이 굼뜬데, 말이 없으면 사람은 그것을 **고장으로 읽는다.**
          머리줄 **바로 아래**다 — 본문을 가리지 않으면서 어느 화면에서든 같은 자리다.
          준비가 끝나면 스스로 사라지고 더 묻지 않는다. */}
      <WarmupNotice />

      {/* 본문 — 서랍이 열리면 그만큼 밀어 준다(안 밀면 오른쪽 끝이 덮인다).
          좁은 화면에서는 서랍이 화면을 거의 덮으므로 밀지 않는다. */}
      {/* **`overflow-hidden` 이 아니라 `overflow-x-clip` 이다**(G-51, 2026-09-13).
          `hidden` 인 조상은 스크롤 컨테이너가 되고, 그 안의 `position:sticky` 는 **그 상자**를
          기준으로 붙는다. 그 상자는 스스로 스크롤하지 않으니 sticky 가 아예 발동을 안 한다.
          실측으로 확인했다(1440, /admin): 사이드바가 스크롤에서 top 101px → -47px 로 **그냥
          따라 흘러갔다.** 죽어 있던 것이 셋이다 — 관리자 사이드바 · 설정의 바로가기 칩 줄
          (4800px 화면을 건너뛰는 유일한 길) · 자동순서 레인 목록.
          `clip` 은 스크롤 컨테이너를 만들지 않아 sticky 가 산다. 가로 잘림은 여전히 필요하다 —
          물감 감싸개가 `inset-x-[-14%]` 로 화면 밖까지 나가 있다. `clip` 이 그 일만 한다. */}
      {/* **오른쪽에 손잡이 자리(28px)를 늘 비워 둔다**(8단계, 2026-09-13).
          손잡이는 `fixed right-0` 이라 본문 위에 얹힌다. 넓은 화면에서는 본문이
          가운데 모여 있어 안 닿았는데, **390px 에서는 본문이 가장자리까지 차서
          「4건 완료 · 4건 대기 · 1건 안 나감」의 끝을 12px 가렸다**(실측).
          하필 **「안 나감」** 이 가려지는 자리다 — 이 화면에서 놓치면 가장 비싼 말이다.
          여는 길이 있을 때만 비운다(손잡이가 없으면 그 여백도 군더더기다). */}
      {/* ── 손잡이 자리는 **양쪽에 같이** 준다 (사용자 지적 2026-09-14) ─────────────
          예전엔 `pr-8` 만 줬다. 손잡이가 오른쪽에 있으니 맞는 말 같지만, 안쪽 내용은
          `mx-auto` 로 **가운데 맞춤**이라 남은 폭의 가운데에 선다 — 결과는 **전체가 16px
          왼쪽으로 치우친 화면**이다(430px 실측: 제목 left 0 / right 32).
          사용자 사진에서 입력창이 왼쪽으로 쏠려 보인 것이 이것이다.
          **한 기종에 맞춘 오프셋이 아니라 대칭으로 푼다** — 어느 폭에서도 가운데가 맞는다.
          넓은 화면에서는 손잡이가 본문 밖이라 둘 다 걷는다. */}
      <main className={'relative overflow-x-clip transition-[padding] duration-300 '
        + (onToggleDrawer ? 'px-8 wide:px-0 ' : '')
        + (drawerOpen ? 'wide:pr-[300px]' : '')}>
        {/* ── 물감 두 방울 ──────────────────────────────────────────────────
            말(파랑)과 음악(자주)이 겹치면 그 자리에서 보라가 생긴다 — 순서(흐름)다.
            보라를 칠하지 않고 `mix-blend-multiply` 로 **계산되어 나오게** 한다.
            장식이므로 `aria-hidden` 이고 포인터를 받지 않는다. */}
        {/* ── **뷰포트에 붙여 둔다** (사용자 지적 2026-09-13) ──────────────────────
            *"음량 tts랑 Ai api 연동은 왜 배경이 고정되어 있냐 투명하게 세번쨰 사진처럼 안되고"*

            원인은 배경색이 아니었다(재 보니 세 화면 다 같은 `--ds-v3-bg` 였다).
            **물감 층이 `absolute` 에 높이 760px 고정**이라 본문 맨 위에만 깔려 있었다.
            그래서 짧은 화면은 거의 전체가 물감 구간이지만(방송 로그 1016px — 그래서 비친다),
            긴 화면은 조금만 내려가면 그 아래가 통째로 민무늬가 된다
            (음량 및 TTS **4192px** · AI · API 연동 **3076px** — 실측).
            같은 껍데기인데 화면 길이에 따라 다른 제품처럼 보였다.

            `fixed` 로 바꾼다. **스크롤 맨 위에서의 모습은 그대로다** — 크기도 위치도 안 바꿨고,
            기준만 본문 상자에서 창으로 옮겼다. 내려가도 같은 자리에 남는다.
            움직임은 여전히 홈에서만이다(`backdrop === 'drift'`) — 설정·자동순서는 정지. */}
        {/* **`overflow-hidden` 을 걷었다** (사용자 지적 2026-09-13: *"왜 네모낳게"*).
            이 상자가 물감을 **직선으로 잘랐다** — 번짐이 가장자리에서 툭 끊기니 둥근
            얼룩이 아니라 네모난 면으로 보인다. 물감은 `radial-gradient` 라 제 힘으로
            사라지므로 가둘 이유가 없다. 가로로 화면 밖까지 나가는 것은 본문의
            `overflow-x-clip` 이 이미 맡는다(그쪽은 가로만 자른다). */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-[-14%] top-[-22vh]
                                           h-[min(760px,calc(86vh/var(--cc-zoom,1)))]">
          <span className="absolute left-[2%] top-[2%] block h-[96%] w-[66%]">
            <i className={`block h-full w-full rounded-full mix-blend-multiply opacity-50
                          ${backdrop === 'drift' ? 'motion-safe:animate-[cc-drift-b_26s_linear_infinite]' : ''}`}
               style={{ filter: 'blur(78px)', background:
                 'radial-gradient(closest-side, rgba(var(--ds-v3-drop-tts),1) 0%, rgba(var(--ds-v3-drop-tts),.6) 34%, rgba(var(--ds-v3-drop-tts),.24) 56%, rgba(var(--ds-v3-drop-tts),0) 82%)' }} />
          </span>
          <span className="absolute right-[2%] top-[2%] block h-[96%] w-[66%]">
            <i className={`block h-full w-full rounded-full mix-blend-multiply opacity-50
                          ${backdrop === 'drift' ? 'motion-safe:animate-[cc-drift-r_31s_linear_infinite]' : ''}`}
               style={{ filter: 'blur(78px)', background:
                 'radial-gradient(closest-side, rgba(var(--ds-v3-drop-bgm),1) 0%, rgba(var(--ds-v3-drop-bgm),.6) 34%, rgba(var(--ds-v3-drop-bgm),.24) 56%, rgba(var(--ds-v3-drop-bgm),0) 82%)' }} />
          </span>
        </div>

        <div className={'relative mx-auto w-full max-w-[1280px] px-4 tablet:px-6 wide:px-8 '
          // **아래 여백은 떠 있는 것들의 키를 합친 값이다**(8단계, 2026-09-13).
          // 이 화면 아래쪽에는 셋이 떠 있다 — 재생 바(0~40px) · 소리 켜기 알약(52~96px) ·
          // 「방송 화면」 단추(140~184px). 여백이 112px(`pb-28`) 이라 맨 아래까지 내리면
          // **마지막 줄의 「전체 예약 관리」가 「방송 화면」 단추 밑에 깔려 안 눌렸다**(실측 834px).
          // 200px 로 올려 셋 다 빈자리 위에 앉게 한다. 화면이 짧을수록 아픈 자리라
          // 폭이 아니라 **떠 있는 것의 높이**를 기준으로 정한다.
          + 'pt-6 tablet:pt-9 pb-[200px] flex flex-col gap-5 tablet:gap-6 '
          + (layout === 'center' ? 'items-center' : 'items-stretch text-left')}>
          {title && (
            <h1 className="m-0 text-center text-[clamp(24px,4.2vw,36px)] font-semibold leading-tight tracking-tight">
              {title}
            </h1>
          )}
          {children}
        </div>
      </main>

      {/* 서랍 손잡이 — 볼록 튀어나온 자리. 닫혀 있을 때도 늘 보인다.
          **여는 길이 없는 화면에는 안 낸다** — 손잡이만 있고 아무 일도 안 일어나면
          사람은 고장 난 것으로 읽는다. 서랍을 가진 화면이 `onToggleDrawer` 를 준다. */}
      {onToggleDrawer && (
      <button type="button" onClick={onToggleDrawer}
        aria-expanded={drawerOpen} aria-controls="home-drawer" data-tour="grip"
        aria-label={drawerOpen ? '간편모음 닫기' : '간편모음 열기'}
        className={'fixed top-[54%] z-[36] -translate-y-1/2 flex h-[76px] w-7 items-center justify-center '
          + 'rounded-l-[14px] border border-r-0 border-ds-v3-line bg-white text-ds-v3-ink-2 '
          + 'shadow-v3-grip transition-[right] duration-300 '
          + (drawerOpen ? 'right-0 wide:right-[300px]' : 'right-0')}>
        <ChevronLeft size={16} className={drawerOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      )}
    </div>
  )
}
