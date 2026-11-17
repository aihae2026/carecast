// 통합 홈 — 목업 v3 의 「간편」 화면을 제품에 옮긴 것.
//
// **디자인 정본은 `carecast-mockup-wt/docs/design/mockup-UX01/mockup/v3.html` 이다**
// (2026-09-13 사용자 확정). 규칙서는 `docs/audit/design-guideline-v3.md`(G-1~G-44).
// 색값은 `src/styles/tokens.css` 의 `--ds-v3-*` 한 곳에만 있다 — 여기에 hex 를 적지 않는다.
//
// ── 화면의 짜임 (목업 그대로) ────────────────────────────────────────────────
//   본문: 제목 한 줄 → 검색창 → **누르고 말하기 알약** → 오늘 일과(누끼)
//   서랍: 즉시 방송(옵션) → BGM → 음량 → 시스템
//
// **본문에 카드를 쌓지 않는다.** 예전엔 즉시 방송과 BGM 이 큰 카드로 본문에 앉아
// 배경 물감을 가리고 스크롤만 늘렸다(사용자: *"밑에 지저분하게 있지마"*). 조작하는 것은
// 서랍으로 내리고, 본문에는 **묻고 답하는 것**만 남긴다(G-21·G-36·G-39).
//
// ── 왜 화면을 새로 만들지 않고 기존 것을 「호스팅」하나 ────────────────────────
// 소리를 내고 값을 저장하는 일은 전부 기존 컴포넌트가 그대로 한다. 같은 일을 하는
// 상태·저장 로직을 화면마다 복제하면 볼륨 기본값이 두 벌이 됐던 실패(CLAUDE.md 볼륨 규칙)를
// UI 층에서 되풀이하게 된다.
// 다만 **얹는 것과 옮기는 것은 다르다**(G-40) — 옛 껍데기째 얹으면 한 화면에 두 디자인이
// 겹친다. 그래서 부품마다 `tone`·`variant` 로 **그 화면의 옷**을 입혀 넣는다.
//
// ── 지키는 것 ────────────────────────────────────────────────────────────────
//  · 자연어 입력은 `QuickSchedulePhrase` 를 그대로 쓴다 → **초안 → 검토 → 명시적 확정**
//    게이트가 살아 있다. 여기서 예약을 직접 저장하는 길을 만들지 않는다.
//  · "누르고 말하기"는 서랍 **밖**에 상시 둔다(목업 결정). 급한 안내에 한 번 더 누르게
//    만들지 않는다.
//  · SSE·소리 담당 선출·중복 탭·오프라인·오버레이는 `App.jsx` 의 Routes **바깥** 층이라
//    이 파일이 건드리지 않는다.
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '../styles/tokens.css'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import QuickSchedulePhrase from '../components/shared/QuickSchedulePhrase'
import HomeHeadline from '../components/home/HomeHeadline'
import HomeWeatherChip from '../components/home/HomeWeatherChip'
import InstantBroadcast from '../components/easy/InstantBroadcast'
import VolumePanel from '../components/easy/VolumePanel'
import LocalBGMCard from '../components/easy/LocalBGMCard'
import HomeShell from '../components/home/HomeShell'
import HomeToday from '../components/home/HomeToday'
import HomeDrawer from '../components/home/HomeDrawer'
import HomeTour from '../components/home/HomeTour'
import { _IS_LOCAL } from '../lib/isLocal'
import { useTourStage } from '../lib/tourStage'
import HomePanel from '../components/home/HomePanel'
import HomeMicOptions from '../components/home/HomeMicOptions'
import MonitorOpenButton from '../components/home/MonitorOpenButton'
import HomeAdminLinks from '../components/home/HomeAdminLinks'
import { FavsCard } from '../components/easy/FavoritesBar'
import { getSetupState } from '../lib/api'
import useViewWidth from '../hooks/useViewWidth'

// 이 창에서 첫 확인을 이미 끝냈나 — 화면을 오가며 다시 마운트돼도 또 비우지 않는다.
let 첫확인끝 = false

const 두칸최소폭 = 1180

export default function HomeMode() {
  const navigate = useNavigate()
  // 서랍은 닫힌 채로 연다. 「소리 조절」은 자주 쓰는 것이 아니고, 열어 두면 목록을 덮는다.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 처음 안내(N18) 「간편모음」 장 — 서랍을 실제로 열어 보인다
  useTourStage({ drawer: (on) => setDrawerOpen(!!on) })
  // 일과 목록을 다시 읽게 하는 손잡이 — 예약이 추가되면 숫자가 바로 맞아야 한다.
  const [reloadKey, setReloadKey] = useState(0)
  // 초안 카드가 떠 있나 — 그동안만 배치를 두 칸으로 벌린다(아래 주석 참고).
  const [초안열림, set초안열림] = useState(false)
  // ── **두 칸은 실제 폭으로 가른다** (사용자 신고 2026-09-17 「큰화면에서는 … 드래그로 몇번 왔다갔다」) ──
  // 예전엔 CSS `wide:`(창 1440 이상)였는데, 크게 보기(zoom)는 그 조건을 속인다 — 1536 창을 1.5배로 키우면
  // 실제 1024 폭인데도 두 칸이 서서 입력 칸이 좁아지고 목록과 오가며 끌어야 했다. 이제 창 폭 ÷ 배율로 가른다.
  const { 폭: 보이는폭 } = useViewWidth()
  // **1440 이 아니라 두 칸이 실제로 들어가는 폭이다** (사용자 신고 2026-09-17 「가장 큰 화면에서는 카드가 아래로 내려오고」).
  // 칸 480 + 560 + 사이 24 = 1064 에 좌우 여백을 더해 1180. 1536 노트북이면 보통·크게에서 두 칸, 아주 크게(1024)는 쌓는다.
  // 클래스도 `wide:`(CSS 창 폭 1440)를 떼었다 — 윈도 배율 150% 노트북은 CSS 창 폭이 1280 이라 조건이 둘 다 맞아야 서던 두 칸이 영영 안 섰다.
  const 두칸 = 초안열림 && 보이는폭 >= 두칸최소폭
  // 크게 보기에서 카드가 열리면 **입력 자리를 화면 위로 올린다** — 머리줄 밑에서 바로 적게.
  const 입력자리 = useRef(null)
  useEffect(() => {
    if (!초안열림 || 두칸) return
    const z = parseFloat(document.documentElement.style.zoom) || 1
    // 크게 보기이거나 **휴대폰 폭**일 때 — 둘 다 카드가 첫 화면 밑에서 열려 끌어 내려야 했다(390×844 실측 카드 위 417px).
    if (z <= 1 && 보이는폭 >= 834) return
    const t = setTimeout(() => {
      // 카드 윗변을 **붙박이 머리줄 바로 밑**에 맞춘다(scrollIntoView 는 머리줄을 몰라 검색창이 반쯤 가렸다).
      const 카드 = document.querySelector('[data-tour="card"]') || 입력자리.current
      const r = 카드?.getBoundingClientRect()
      const 머리 = document.querySelector('header')?.getBoundingClientRect().bottom || 0
      if (!r) return
      // 잰 값과 scrollBy 는 같은 단위다 — 배율을 곱하면 1.5배 지나쳤다(실측).
      const 옮길만큼 = r.top - 머리 - 12
      if (Math.abs(옮길만큼) > 8) window.scrollBy({ top: 옮길만큼, behavior: 'smooth' })
      // **바로 적게** — 글 칸에 커서를 둔다. 스크롤을 끌지 않게 preventScroll.
      // 손가락 기기에서는 안 한다 — 자판이 올라와 방금 올린 카드를 도로 가린다.
      const 마우스 = window.matchMedia?.('(pointer: fine)').matches
      if (마우스) 카드?.querySelector('textarea, input[type="text"], input:not([type])')?.focus({ preventScroll: true })
    }, 120)
    return () => clearTimeout(t)
  }, [초안열림, 두칸, 보이는폭])

  // ── **설치하고 처음 열면 초기 설정으로 보낸다** (사용자 지시 2026-09-16) ────────
  // *"초기설정 메뉴에 있는거 설치하고 맨처음에 떴으면 좋겠는데"*
  //
  // 세 가지를 지킨다:
  //  ① **한 번만.** `sessionStorage` 표식으로 막는다 — 뒤로 가기로 돌아왔을 때 다시
  //     끌려가면 사람이 이 화면을 못 본다(가두는 셈이다).
  //  ② **정말 새 PC 일 때만.** 서버가 기관 이름·예약까지 보고 판정한다
  //     (`/api/settings/setup-state`) — 설정 한 칸만 보면 이미 쓰던 시설에서 다시 뜬다.
  //  ③ **실패하면 아무 일도 안 한다.** 서버를 못 물어봤다고 화면을 옮기지 않는다 —
  //     방송하러 온 사람을 설정 화면에 떨어뜨리는 것이 못 띄우는 것보다 나쁘다.
  //  ④ **확인 전에는 홈을 그리지 않는다** (사용자 신고 2026-09-17 — 「바로 들어가져서 … 밀리고」).
  //     홈이 먼저 뜨면 초기 설정보다 간편 화면이 먼저 보이고, 첫 기동의 음성 합성과 겹쳐 굼뜨다.
  //     로컬 서버라 한 번 묻는 데 수십 ms 다. **안 풀리는 일이 없게** 처음이 아닐 때·실패할 때·
  //     3초 시한 셋 다 푼다 — 빈 화면에 갇히는 것은 마법사를 못 띄우는 것보다 나쁘다(③).
  //  ⑤ **이 PC 에서 연 화면에서만** (사용자 신고 2026-09-17 「QR 로 들어가면 초기설치화면이 나와서 앵? 하잖아」).
  //     휴대폰·사무실 PC 는 설치한 기계가 아니다 — 거기서 스피커·방화벽을 고르게 하면 엉뚱한 PC 를 설정하게 된다.
  const [확인중, set확인중] = useState(() => {
    if (첫확인끝 || !_IS_LOCAL) return false
    try { if (sessionStorage.getItem('carecast:setup-checked')) return false } catch { /* 못 읽으면 묻는다 */ }
    return true
  })
  useEffect(() => {
    let 살아있나 = true
    if (!_IS_LOCAL) return
    try { if (sessionStorage.getItem('carecast:setup-checked')) return } catch { /* 못 읽어도 진행 */ }
    const 시한 = setTimeout(() => { if (살아있나) set확인중(false) }, 3000)
    ;(async () => {
      try {
        const st = await getSetupState()
        if (!살아있나) return
        if (!st?.처음인가) { 첫확인끝 = true; set확인중(false); return }
        try { sessionStorage.setItem('carecast:setup-checked', '1') } catch { /* 못 써도 진행 */ }
        navigate('/admin?section=setupWizard')
      } catch { /* 못 물어봤으면 그냥 이 화면에 머문다 */ if (살아있나) set확인중(false) }
    })()
    return () => { 살아있나 = false; clearTimeout(시한) }
  }, [navigate])

  if (확인중) return <div className="min-h-screen bg-ds-v3-bg" aria-busy="true" />

  return (
    // ── 큰 제목이 곧 안내다 (사용자 결정 2026-09-15) ──────────────────────────────
    // 예전엔 제목이 「무엇을 방송할까요?」 고정이고 그 아래 13px 작은 줄이 돌았다.
    // 사용자 결정으로 **둘을 합쳤다** — 도는 것은 이제 큰 제목이고, 그 문구도 차례도
    // 서버가 정한다(`domain/guideTips.차례짜기`). **초안이 열려도 제목은 남는다** —
    // 작은 줄일 때는 카드 위에 얹히는 군말이라 숨겼지만, 제목은 이 화면의 머리다.
    <HomeShell tab="home" onNavigate={navigate} title={<HomeHeadline />}
      drawerOpen={drawerOpen} onToggleDrawer={() => setDrawerOpen(v => !v)}>

      {/* ── 초안이 열리면 **오늘 일과가 옆으로 간다** (사용자 결정 2026-09-13) ────────
          초안 카드는 세로로 400px 넘게 자란다. 스택으로 두면 그 아래 오늘 일과가
          화면 밖으로 밀려서, 방금 만든 예약이 오늘 어디에 끼는지 보려면 **스크롤을
          내려야** 했다(*"이렇게 내려오면 오늘 하루일정이 안보이잖아"*).
          예약을 만드는 순간이야말로 오늘 일과를 같이 봐야 하는 순간이다.

          그래서 초안이 뜬 동안만 **두 칸**으로 벌린다 — 왼쪽 오늘 일과, 오른쪽 입력·초안.
          자리가 있을 때만 한다(`두칸` — 창 폭 ÷ 배율로 잰다). 좁은 화면에서는 두 칸이 각각 너무 좁아져
          오히려 둘 다 못 읽으므로 그대로 쌓는다 — 스크롤이 더 나은 선택이다.
          **닫히면 원래 가운데 한 줄로 돌아간다.** 평소의 홈은 검색창 하나가 주인공이다. */}
      <div ref={입력자리} className={초안열림
        ? 'grid w-full items-start justify-center gap-6 '
          + (두칸 ? 'grid-cols-[minmax(0,480px)_minmax(0,560px)]' : '')
        : 'flex w-full flex-col items-center gap-5'}>

        {/* 오늘 일과 — 카드로 감싸지 않는다(누끼). 배경 물감이 그대로 비친다.
            두 칸일 때는 **왼쪽 첫 칸**이고 두 줄(입력+마이크)에 걸쳐 선다. */}
        {/* ── 좁은 화면에서도 **순서를 준다** (사용자 신고 2026-09-14) ─────────────
            카드가 열리면 배치가 `grid` 로 바뀌는데, 순서 지정이 `wide:` 접두사뿐이었다.
            좁은 화면에서는 그 규칙이 안 걸려 **DOM 순서대로** 목록이 맨 위로 올라가고
            입력·카드가 화면 밖(실측 top 1090px, 화면 844px)으로 밀렸다. 사용자에게는
            *"「지금 말하기」를 눌렀는데 입력창 대신 오늘 일과방송이 보인다"* 로 나타났다.
            **닫혔을 때의 순서를 기본으로 깔고 `wide:` 가 덮게 한다.** */}
        {/* `key` 가 바뀌면 리액트가 이 상자를 **새로 그린다** — 그래야 `cc-settle`
            애니메이션이 배치가 바뀔 때마다 한 번씩 돈다(같은 노드에 클래스만 붙이면
            처음 한 번만 돈다). 상자만 새로 그리는 것이라 안의 목록은 제 상태를
            그대로 들고 있다. */}
        <div key={초안열림 ? 'two' : 'one'}
          className={'w-full cc-settle ' + (두칸 ? 'max-w-[480px] ' : 'max-w-[720px] ') + (초안열림 ? 'order-3' : 'order-3')
          + (두칸 ? ' col-start-1 row-start-1 row-span-2' : '')}>
          <ErrorBoundary 이름="오늘 일과방송">
            {/* **칸이 좁아진다는 사실은 여기만 안다.** 목록은 제 그릇이 480px 인지 720px
                인지 못 보고 창 너비만 본다 — 그래서 창은 넓고 그릇만 좁은 이 상태에서
                이름이 잘렸다(사용자 지적 2026-09-15). 아는 쪽이 알려 준다. */}
            <HomeToday reloadKey={reloadKey} onNavigate={navigate} 좁게={두칸} />
          </ErrorBoundary>
        </div>

        {/* 폭은 **한 자리에서** 정한다 — 부품마다 따로 두면 줄마다 끝이 안 맞는다.
            입력·초안은 560, 목록은 720.

            **2026-09-15 에 좁혔다**(720/920 → 560/720). 사용자 지적: *"지금 검색창 맞춰서
            딱 떨어지니까 뭔가 넓데데 하게 보여"*. 검색창이 높이 56px 에 폭 720px 이라
            **가로세로 비가 13:1** 이었다 — 그 납작함이 「넓데데」의 정체다. 560px 이면
            10:1 이 되고, 밑에 깔린 단추 다섯이 서로 붙어 **한 묶음으로** 읽힌다.
            글자 크기·행 높이·44px 터치 크기는 **안 건드렸다** — 좁히는 것만으로 밀도가
            오르므로, 읽기 어려워지는 쪽으로는 손대지 않는다. */}
        <div className={'w-full max-w-[640px] ' + (초안열림
          ? 'cc-settle order-1' : 'order-1') + (두칸 ? ' col-start-2 row-start-1' : '')}>
          {/* ── 날씨는 **제목과 검색창 사이**다 (사용자 지시 2026-09-16) ──────────────
              *"날씨정보는 무엇을 방송할까요랑 검색창 사이에 끼는 거지."*

              머리줄에 있던 것을 여기로 내렸다. 머리줄은 **조작하는 자리**(로고·메뉴·
              크게 보기·탭)이고 날씨는 **읽는 것**이라, 거기 섞여 있으니 덩어리가 다섯이
              되어 어수선했다. 제목 바로 밑이면 *"오늘은 이렇습니다"* 가 한 호흡에 읽히고,
              방송 문안을 적기 직전에 눈에 들어온다 — 날씨 안내를 적을 때 쓰는 값이다.

              못 받으면 스스로 아무것도 안 그린다. 그때는 제목과 검색창이 그대로 붙는다. */}
          {/* ── **제목에 붙인다** (사용자 지적 2026-09-17 N19 v4) ─────────────────────────
              *"무엇을 방송할까요랑 검색창이랑 … 뭔가 좀 많이 어색하게 떨어져있는것 같기도 하고"*
              재 보니 제목→날씨 약 28px(껍데기 gap) · 날씨→검색창 12px 라 날씨가 **어디에도 안 붙고 떠** 있었다.
              가까운 것끼리 묶는다: 제목→날씨 8px · 날씨→검색창 22px. 초안이 열려 두 칸일 때는
              제목과 다른 칸이라 당기지 않는다. */}
          <div className={'mb-[22px] flex justify-center ' + (초안열림 ? '' : '-mt-4 tablet:-mt-5')}>
            <ErrorBoundary 이름="오늘 날씨" 조용히><HomeWeatherChip /></ErrorBoundary>
          </div>

          {/* 자연어 입력 — 저장하지 않는다. 초안을 만들어 사람이 확정하게 한다. */}
          <ErrorBoundary 이름="말로 예약하기">
            <QuickSchedulePhrase tone="v3"
              onAdded={() => setReloadKey(k => k + 1)}
              onDraftChange={set초안열림} />
          </ErrorBoundary>
        </div>

        {/* 누르고 말하기 — **서랍 밖, 늘 보인다.** 알약 한 알이고 옵션은 서랍에 있다.
            동작은 토글이다(G-43, 사용자 결정) — 목업의 "누르는 동안만"은 손이 1px 벗어나면
            문장 중간에 소리가 끊긴다. */}
        <div className={'flex justify-center ' + (초안열림
          ? 'order-2' : 'order-2') + (두칸 ? ' col-start-2 row-start-2' : '')}>
          <ErrorBoundary 이름="즉시 방송">
            <InstantBroadcast tone="v3" variant="pill" />
          </ErrorBoundary>
        </div>
      </div>

      {/* ── 「소리 조절」 — 목업의 패널 넷 ────────────────────────────────────────
          순서는 **급한 것 → 자주 쓰는 것 → 가끔 정하는 것 → 보기만 하는 것**이다.
          즉시 방송 옵션이 맨 위인 이유는 서랍 밖 알약과 **짝**이기 때문이고(짝을 멀리 두면
          어디 있는지 못 찾는다), 시스템이 맨 아래인 이유는 **읽기 전용**이라서다.

          **BGM 카드가 여기 들어와도 음악은 안 끊긴다** — 소리를 내는 재생기(MusicPlayer)는
          `App.jsx` 의 Routes 바깥에 있다. 그리고 보이는 조각(전체화면·모달)은 `body` 로 포털해 뒀다. 그것이 없으면 닫힌 서랍의
          `inert` 에 걸려 **전체화면과 종료 단추가 죽는다.** */}
      <HomeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        {/* ── 모니터링은 **맨 위**다 (사용자 지시 2026-09-14) ─────────────────────
            그전에는 맨 아래 「시스템」 패널 안에만 있어서 실측 `top: 2411px` — 서랍을 열고
            한참 내려야 나왔다. 휴대폰에서는 사실상 못 찾는다. *"찾기 쉬운 위치에 명시적인
            이름으로"* 라는 지시대로 서랍을 열면 바로 보이는 자리에 둔다.
            **「방송 화면」과 다른 것이다** — 저쪽은 소리를 내고 이쪽은 보기만 한다.
            단추는 `MonitorOpenButton` 한 곳에서 만든다(시스템 패널도 같은 것을 쓴다). */}
        <MonitorOpenButton variant="row" />

        {/* ── **「즉시 방송」이 아니라 「방송 차임 설정」이다** (사용자 지시 2026-09-15) ────
            이 칸에는 **차임 켬/끔 둘뿐**인데 이름이 「즉시 방송」이라, 여기서 방송을
            내보내는 줄 알고 열게 된다. 실제로 내보내는 자리는 위의 「지금 방송」 카드와
            「누르고 말하기」다. **이름이 하는 일과 달랐다.**
            곁말도 「마이크」에서 **무엇의 차임인지**로 바꾼다. */}
        <HomePanel title="방송 차임 설정">
          <HomeMicOptions />
        </HomePanel>

        {/* 즐겨찾기 — **「즉시 방송」 바로 밑**(사용자가 정한 자리, 2026-09-13).
            둘 다 "지금 바로 내보낸다"라 같은 묶음이다. 마이크가 **말로** 하는 것이면
            이쪽은 **미리 적어 둔 말**로 하는 것이다.
            설정에서 버튼을 만들어 놓고 정작 누를 자리가 통합 홈에 없었다 —
            만드는 곳과 쓰는 곳이 갈리면 만든 것이 안 쓰인다. */}
        <HomePanel title="즐겨찾기" state="한 번 누르기">
          <ErrorBoundary 이름="즐겨찾기"><FavsCard bare /></ErrorBoundary>
        </HomePanel>

        <HomePanel title="배경음악" accent="text-ds-v3-bgm">
          <ErrorBoundary 이름="배경음악"><LocalBGMCard bare /></ErrorBoundary>
        </HomePanel>

        <HomePanel title="음량">
          {/* `narrow` — 이 격자는 `tablet:`(화면 폭)으로 두 칸이 되는데 서랍은 300px 이다.
              안 주면 넓은 화면에서 라벨과 숫자가 겹친다(2026-09-13 실측). */}
          <ErrorBoundary 이름="음량 제어"><VolumePanel narrow bare /></ErrorBoundary>
        </HomePanel>

        {/* ── 「관리」 — 탭에서 내려온 화면들 (사용자 결정 2026-09-15) ────────────────
            *"애초에 간편화면에서 전체예약 관리 들어가게끔할수 있게하면 위에 간편화면이랑
              캘린더만 띄워주는건 어때 토글로."*
            탭을 둘로 줄이면서 자동순서·업로드·설정이 갈 곳을 잃었다 — 여기가 그 자리다.
            **맨 아래인 이유**: 읽기 전용이던 「시스템」이 있던 자리이고, 이 줄들도
            자주 쓰는 것이 아니다(급한 것 → 자주 쓰는 것 → 가끔 → 드물게 순서). */}
        <HomePanel title="관리">
          <HomeAdminLinks onNavigate={navigate} />
        </HomePanel>

        {/* ── 「시스템」 패널을 뺐다 (사용자 결정 2026-09-15) ─────────────────────────
            *"저 옆에 간편모드 아래 시스템을 칸을 없애버리고"*. 서랍이 길어져 정작 자주
            쓰는 음량·BGM 이 아래로 밀려 있었다.

            **잃는 것이 없는지 확인하고 뺐다:**
            · 「모니터링 창」 단추는 이미 서랍 위쪽으로 나와 있다(`MonitorOpenButton`).
            · 컴포넌트 자체는 **쉬운 화면(`EasyMode`)에 그대로 남는다** — 지우지 않았다.
            · **무음 경보는 이 패널이 아니다.** 현장에 소리 낼 창이 없을 때 뜨는 띠는
              `SiteScreenWarning` 이고 화면 맨 위에 따로 선다(2026-09-14 현장 사고).
              그러니 이 패널을 빼도 가장 비싼 신호는 그대로 보인다. */}
      </HomeDrawer>

      {/* 처음 안내 — 초기 설정을 막 끝낸 첫 방문에 한 번, 메뉴 「처음 안내 다시 보기」로 언제든 */}
      <HomeTour />
    </HomeShell>
  )
}
