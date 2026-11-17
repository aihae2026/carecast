import { useEffect, useState } from 'react'
import { TAB_ID } from './lib/tabId'
import { _IS_LOCAL } from './lib/isLocal'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import EasyMode from './pages/EasyMode'
// 통합 홈. 옛 `SimpleMode`(타일 넷)는 파일을 지우지 않고 남겨 둔다 —
// 되돌릴 때 그 화면이 필요하고, 디자인 결정 기록이기도 하다.
import HomeMode from './pages/HomeMode'
import CalendarMode from './pages/CalendarMode'
import UploadMode from './pages/UploadMode'
import FlowMode from './pages/FlowMode'
import AdminMode from './pages/AdminMode'
import MonitorPage from './pages/MonitorPage'
import DevConsolePage from './pages/DevConsolePage'
import ArchViewPage from './pages/ArchViewPage'
import GuideMapPage from './pages/GuideMapPage'
import MusicPlayer from './components/easy/MusicPlayer'
import SystemAlertBanner from './components/shared/SystemAlertBanner'
import SiteScreenWarning from './components/shared/SiteScreenWarning'
import useAudioListener from './hooks/useAudioListener'
import useScheduledBroadcast from './hooks/useScheduledBroadcast'
import useConnectionWatch from './hooks/useConnectionWatch'
import VideoPlayer from './components/broadcast/VideoPlayer'
import MorningVideoDisplay from './components/broadcast/MorningVideoDisplay'
import { BroadcastToast, BroadcastOverlay,
         AudioUnlockBanner, OfflineBanner } from './components/broadcast/BroadcastIndicators'
// 재생 표시줄. 파일은 `easy/` 에 있지만 **옛 화면 전용이 아니다** — 2026-09-15 에
// 앱 전체 층으로 올라왔다(위 주석 참고). 옮기지 않은 것은 경로가 바뀌면 이 파일을 읽는
// 가드·문서가 같이 죽기 때문이다. 자리를 옮길 일이 생기면 그것들과 **같은 커밋**에서 옮긴다.
import NowPlayingBar from './components/easy/NowPlayingBar'
import { BroadcastCaption } from './components/broadcast/BroadcastCaption'
import BroadcastScrim from './components/broadcast/BroadcastScrim'
import ErrorBoundary from './components/shared/ErrorBoundary'

// 이 창의 이름표. **lib/tabId.js가 유일한 출처다** — SSE를 여는 lib/api.js도 같은 값을
// 서버에 보내야 하는데, 두 곳이 각자 만들면 서버가 지목한 창과 실제로 재생하는 창이
// 어긋나 아무도 소리를 안 낸다.
const _TAB_ID = TAB_ID
// 모니터링 팝업(/monitor) — 읽기 전용 요약 화면이라 재생 리더 선출/방송 오디오 로직에서 항상 제외
const _IS_MONITOR = window.location.pathname === '/monitor'
// 개발 콘솔(/dev-console) — 고도화 제안/코칭 브리프 관리 전용, 방송 재생과 무관해 마찬가지로 제외.
// 하위 주소(/dev-console/arch/...)도 같은 껍데기다 — startsWith로 봐야 구성도 상세 화면이
// 본 앱으로 떨어져 빈 화면이 되지 않는다.
const _IS_DEV_CONSOLE = window.location.pathname === '/dev-console' ||
  window.location.pathname.startsWith('/dev-console/')
// 안내도(/guide) — 시스템을 그림으로 설명하는 화면. 방송을 내지도 받지도 않으므로 같은 이유로 제외한다.
// 현장 PC에서 이걸 띄워 놓아도 소리 담당이 바뀌거나 중복 창 경고가 뜨면 안 된다.
const _IS_GUIDE = window.location.pathname === '/guide'
// 이 탭이 leader(방송 처리 담당)인지 여부 — 선출 전까지 false
window.CC_IS_LEADER = false

export default function App() {
  // 안내도(/guide)는 소리를 내지도 받지도 않는다 — SSE·마이크 수신을 아예 안 연다.
  // `nowPlaying` 은 더 안 받는다 — 위 알약이 쓰던 값이고, 아래 바(`NowPlayingBar`)는
  // **서버를 직접 폴링**해서 제 상태를 갖는다(다른 PC 에서 시작한 방송도 보이게 하려고).
  // 훅은 그대로 부른다 — SSE 구독·정지 신호 배선이 이 훅 안에 있다.
  const { toast } = useScheduledBroadcast(!_IS_GUIDE)
  const { unlocked } = useAudioListener({ enabled: !_IS_GUIDE })
  const offline  = useConnectionWatch()
  const [isDuplicateTab, setIsDuplicateTab] = useState(false)

  // 페이지 새로고침(자동업데이트 등) 후 이전 재생 락이 남아있으면 방송이 안 재생됨
  // → 마운트 시 cc_* 키 모두 제거해서 깨끗한 상태에서 시작
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('cc_'))
        .forEach(k => localStorage.removeItem(k))
    } catch { /* 부팅 시 남은 중복 억제 표시 청소 — 막혀 있으면 표시 자체가 없다 */ }
  }, [])

  // 서버가 정한 소리 담당을 화면에 반영한다(중복 창 안내). 판정 자체는 SSE 핸들러가 한다.
  useEffect(() => {
    const onOwner = (e) => {
      if (_IS_MONITOR || _IS_DEV_CONSOLE || _IS_GUIDE) return
      setIsDuplicateTab(_IS_LOCAL && !e.detail?.isLeader)
    }
    window.addEventListener('carecast:sound-owner', onOwner)
    return () => window.removeEventListener('carecast:sound-owner', onOwner)
  }, [])

  // 중복 탭/창 감지 — localStorage 기반 leader 선출 (현장 PC only)
  // **서버가 담당을 지목하면 이 선출은 손을 뗀다**(아래 CC_SERVER_PICKED_OWNER 확인).
  // 옛 서버·이벤트 유실 때만 쓰이는 폴백으로 남는다.
  useEffect(() => {
    // 모니터링 팝업/개발 콘솔/안내도는 재생을 하지 않는 읽기 전용 창 — leader 경쟁에서 항상 제외
    if (_IS_MONITOR || _IS_DEV_CONSOLE || _IS_GUIDE) {
      window.CC_IS_LEADER = false
      return
    }
    // 리모트 PC는 leader election 생략 — 항상 방송 처리 (중복 탭 주황화면 방지)
    if (!_IS_LOCAL) {
      window.CC_IS_LEADER = true
      return
    }

    // 서버가 이미 담당을 지목했으면 브라우저 저장공간 선출은 하지 않는다.
    // 둘을 같이 돌리면 판단 주체가 둘이 되어 서로 뒤집는다.
    // 이 선출은 **서버가 아무도 못 고른 경우의 폴백**으로만 남는다(옛 서버·이벤트 유실).
    if (window.CC_SERVER_PICKED_OWNER) return

    const LEADER_KEY = 'carecast_leader'
    const TS_KEY = 'carecast_leader_ts'
    const LEADER_TIMEOUT = 5000  // 5초간 heartbeat 없으면 사망 간주
    const HB_INTERVAL = 2000

    let hbTimer = null
    let amLeader = false

    const startLeader = () => {
      amLeader = true
      window.CC_IS_LEADER = true
      const beat = () => {
        // 서버가 담당을 정한 뒤에는 이 선출이 손을 뗀다 — 판단 주체가 둘이면 서로 뒤집는다
        if (window.CC_SERVER_PICKED_OWNER) return
        try { localStorage.setItem(TS_KEY, String(Date.now())) } catch { /* 리더 심장박동 — 못 쓰면 다른 탭이 리더를 가져간다(막다른 상태는 안 생긴다) */ }
        hbTimer = setTimeout(beat, HB_INTERVAL)
      }
      beat()
    }

    const becomeDuplicate = () => {
      window.CC_IS_LEADER = false
      setIsDuplicateTab(true)
      // 리더 사망 감지 → 자동 인수 (window.close()는 bat으로 연 창에서 동작 안 함)
      const watchId = setInterval(() => {
        if (window.CC_SERVER_PICKED_OWNER) { clearInterval(watchId); return }
        try {
          const eid = localStorage.getItem(LEADER_KEY)
          const ets = parseInt(localStorage.getItem(TS_KEY) || '0', 10)
          const alive = eid && eid !== _TAB_ID && Date.now() - ets < LEADER_TIMEOUT
          if (!alive) {
            clearInterval(watchId)
            localStorage.setItem(LEADER_KEY, _TAB_ID)
            localStorage.setItem(TS_KEY, String(Date.now()))
            setTimeout(() => {
              if (localStorage.getItem(LEADER_KEY) === _TAB_ID) {
                startLeader()
                setIsDuplicateTab(false)
              }
            }, 100 + Math.floor(Math.random() * 200))
          }
        } catch { /* 리더 판정용 저장소 접근 — 실패하면 이번 주기를 건너뛰고 다음 주기에 다시 본다 */ }
      }, LEADER_TIMEOUT)
    }

    // leader 점유 시도
    try {
      const existingId = localStorage.getItem(LEADER_KEY)
      const existingTs = parseInt(localStorage.getItem(TS_KEY) || '0', 10)
      const leaderAlive = existingId && existingId !== _TAB_ID && Date.now() - existingTs < LEADER_TIMEOUT
      if (leaderAlive) { becomeDuplicate(); return }
      localStorage.setItem(LEADER_KEY, _TAB_ID)
      localStorage.setItem(TS_KEY, String(Date.now()))
    } catch { /* 리더 선출용 저장소 접근 — 실패하면 이 탭이 리더가 아닌 채로 계속 동작한다 */ }

    // 동시 마운트 레이스 해소 — 마지막으로 쓴 탭이 leader
    const verifyTimer = setTimeout(() => {
      try {
        const currentId = localStorage.getItem(LEADER_KEY)
        if (currentId !== _TAB_ID) {
          const ts = parseInt(localStorage.getItem(TS_KEY) || '0', 10)
          if (Date.now() - ts < 3000) { becomeDuplicate(); return }
        }
      } catch { /* 리더 확인용 저장소 접근 — 실패하면 바로 아래에서 리더 시작을 시도한다 */ }
      startLeader()
    }, 100 + Math.floor(Math.random() * 200))

    // 다른 탭이 leader 키를 덮어쓰면 양보
    const onStorage = (e) => {
      if (e.key === LEADER_KEY && e.newValue && e.newValue !== _TAB_ID && amLeader) {
        clearTimeout(hbTimer)
        amLeader = false
        window.CC_IS_LEADER = false
        setIsDuplicateTab(true)
      }
    }
    window.addEventListener('storage', onStorage)

    return () => {
      clearTimeout(verifyTimer)
      clearTimeout(hbTimer)
      window.removeEventListener('storage', onStorage)
      if (amLeader) {
        try {
          if (localStorage.getItem(LEADER_KEY) === _TAB_ID) {
            localStorage.removeItem(LEADER_KEY)
            localStorage.removeItem(TS_KEY)
          }
        } catch { /* 떠날 때 리더 표시 반납 — 못 지워도 TS_KEY가 낡으면 다른 탭이 가져간다 */ }
      }
    }
  }, [])

  if (_IS_MONITOR) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/monitor" element={<MonitorPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (_IS_DEV_CONSOLE) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/dev-console" element={<DevConsolePage />} />
          <Route path="/dev-console/arch/:view" element={<ArchViewPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (_IS_GUIDE) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/guide" element={<GuideMapPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      {isDuplicateTab && (
        <div className="fixed inset-0 z-[9999] bg-ds-v3-surface-2/95 backdrop-blur-sm flex flex-col items-center justify-center gap-5 p-8">
          <div className="text-6xl select-none">⚠️</div>
          <h2 className="text-2xl font-semibold text-ds-v3-ink-2">중복 탭 감지</h2>
          <p className="text-base text-ds-v3-ink text-center max-w-xs leading-relaxed">
            이미 다른 탭에서 CareCast AI가<br />실행 중입니다.<br />
            <span className="text-ds-v3-ink-2 text-sm">방송 충돌을 막으려면 이 탭을 닫으세요.</span>
          </p>
          <button
            onClick={() => { window.close(); setTimeout(() => setIsDuplicateTab(false), 500) }}
            className="px-8 py-3 bg-ds-v3-ink-2 hover:bg-ds-v3-ink-2 text-white rounded-btn font-semibold text-sm btn-press transition-colors">
            이 탭 닫기
          </button>
        </div>
      )}
      {/* **앱 층마다 경계를 둔다**(UX-44, 2026-09-11 Codex 지적).
          이것들은 `Routes` 와 형제라, 하나가 렌더에서 터지면 **화면 전체가 사라진다** —
          방송 중에 자막 하나 때문에 정지 버튼까지 없어지는 것이 제일 나쁜 모양이다.
          여기는 `조용히` 다: 오버레이 층 위에 오류 카드를 띄우면 방송을 덮는다.
          콘솔에는 그대로 남으므로 삼키는 것이 아니라 자리를 옮기는 것이다. */}
      <ErrorBoundary 이름="연결 끊김 안내" 조용히>{offline && <OfflineBanner />}</ErrorBoundary>
      {/* 방송 누락·서버 문제 경보 — 확인을 누르기 전까지 사라지지 않는다.
          Routes 위에 두면 쉬운화면·관리자화면 어디에 있든 같이 보인다. */}
      <ErrorBoundary 이름="시스템 경보" 조용히><SystemAlertBanner /></ErrorBoundary>
      {/* 현장 PC에 소리 낼 창이 없다 — **방송 시각을 기다리지 않고** 바로 보여야 한다.
          2026-09-14 저녁 마무리 방송이 무음으로 지나간 사고가 이 자리에서 났다. */}
      <ErrorBoundary 이름="현장 화면 안내" 조용히><SiteScreenWarning /></ErrorBoundary>
      <ErrorBoundary 이름="방송 오버레이" 조용히><BroadcastOverlay /></ErrorBoundary>
      {/* 자막은 오버레이 **밖**에 둔다 — 무음 영상이 뜨면 오버레이는 숨는데(morning_video_start)
          그 위로 나가는 안내야말로 자막이 가장 필요하다. 자기 층(z-10000)에서 산다. */}
      {/* 어두운 바탕은 **자막과 따로** 산다 (사용자 지적 2026-09-15) — 자막 부품 안에
          두었더니 줄과 줄 사이마다 같이 꺼졌다 켜졌다 했다. 바탕은 「방송 중」을 말하고
          자막은 「읽을 줄」을 말한다. 둘은 다른 사실이다. */}
      <ErrorBoundary 이름="방송 바탕" 조용히><BroadcastScrim /></ErrorBoundary>
      <ErrorBoundary 이름="방송 자막" 조용히><BroadcastCaption /></ErrorBoundary>
      {/* ── **재생 표시는 위 알약이 아니라 아래 바다** (사용자 지시 2026-09-15) ──────────
          앞 판은 `BroadcastNowPlaying` — 화면 **맨 위 가운데**에 뜨는 빨간 알약이었다.
          그 자리가 머리줄 탭과 겹친다. 휴대폰(390px)에서는 「간편」 탭을 통째로 덮어
          **탭을 누를 수가 없었다**(사용자 사진). 알림이 조작을 막으면 알림이 아니라 사고다.
          사용자 지시 그대로 **아래 배너로 내린다**.

          내리면서 `NowPlayingBar` 로 바꾼다. 둘이 겹치는 자리에 나란히 두지 않는 이유:
           · 바가 알약의 **상위집합**이다 — 방송 제목 · **몇 번째 단계인지** · 정지.
             5분째 조용할 때 그게 원래 조용한 단계(6분 대기 투약 안내)인지 멈춘 것인지를
             단계 표시로만 안다. 알약에는 그게 없었다.
           · **「정지는 아래 바 하나로 통일」** 이 이미 정해진 규칙이다(사용자 결정 2026-09-02).
             알약의 정지 단추는 그 규칙의 예외로 남아 있던 것이다.

          **`Routes` 와 형제 자리에 둔다** — 그래야 간편·캘린더·관리자 어디에 있든 보인다.
          앞서는 `EasyMode` 안에만 있어서 **통합 홈(`/simple`)에는 아래 바가 없었다**
          (사용자: *"예전에는 재생되는 흐름에 따라 아래에 배너가 있었던 것 같은데"* — 맞다.
          옛 화면에만 있었고 새 화면으로 옮겨오면서 빠졌다).
          `/monitor` 는 위쪽에서 먼저 반환하는 **별도 껍데기**라 이 줄이 안 닿는다. */}
      <ErrorBoundary 이름="재생 표시줄" 조용히><NowPlayingBar /></ErrorBoundary>
      <ErrorBoundary 이름="알림" 조용히><BroadcastToast toast={toast} /></ErrorBoundary>
      <ErrorBoundary 이름="소리 잠금 해제 안내" 조용히><AudioUnlockBanner unlocked={unlocked} /></ErrorBoundary>
      <ErrorBoundary 이름="영상 재생" 조용히><VideoPlayer /></ErrorBoundary>
      <ErrorBoundary 이름="아침 영상" 조용히><MorningVideoDisplay /></ErrorBoundary>
      {/* **페이지 층에도 경계를 둔다**(Codex R2, 2026-09-11). 카드마다 경계를 둬도
          레이아웃·헤더처럼 카드 **바깥** 에서 터지면 그걸 잡을 것이 없었다.
          여기는 `조용히` 가 아니다 — 페이지가 통째로 안 그려졌으면 사람이 그 사실을
          알아야 하고, 형제인 재생 host 들은 이 경계 밖이라 그대로 살아 있다
          (방송이 나가는 중이면 소리는 계속 나고, 화면만 이 카드로 바뀐다). */}
      <ErrorBoundary 이름="이 화면">
        <Routes>
          {/* ── 현관은 **간편 화면**이다 (사용자 지시 2026-09-14) ─────────────────
              그전까지 `/` 는 옛 쉬운 화면이었다. 09-13 에 *"쉬운화면도 없애 이제,
              자꾸 전으로 돌아가잖아"* 지시로 **입구만** 지우고 주소는 그대로 뒀더니,
              원격 PC 에서 `:3001` 을 처음 열면 **입구가 없어진 옛 화면**이 떴다.
              사용자에게는 "상세설정 갔다가 돌아와야 적용되는 버그"로 보였다.

              **기능을 옮기지 않았다 — 옮길 것이 없었다.** 두 화면을 실제로 띄워 훑었고
              접근 불가한 기능이 없다: 자동 5종 수동재생은 `HomeToday` 의 「지금 내보내기」,
              예약(환기 묶음) 수동재생은 `/calendar` 목록의 「지금 방송」, 즉시 TTS 는
              「지금 말하기」(`lib/quickStart` 의 `tts`), 미리듣기는 `/flow` 「전체 미리듣기」,
              통계는 `/admin` 「방송 로그」다. **다른 메뉴로 닿으면 중복 구현하지 않는다.**

              `replace` 다 — 뒤로 가기가 `/` 와 `/simple` 사이를 오가지 않게. */}
          <Route path="/" element={<Navigate to="/simple" replace />} />
          {/* 옛 쉬운 화면. **코드는 그대로 두고 주소만 옮겼다** — 이번 범위는 삭제가 아니다.
              어디서도 링크하지 않는다(입구를 되살리지 않는다, 사용자 지시). 주소를 아는
              사람이 직접 칠 수는 있다 — 무엇이 빠졌는지 대볼 자리가 남아 있어야 한다. */}
          <Route path="/easy" element={<EasyMode />} />
          {/* 간편 모드: 폰에서 말하듯이 — 3단 위계의 첫 칸(디자인 시스템 캔버스).
              새 길이라 기존 두 화면은 그대로다. 소리를 내는 경로는 아직 없다. */}
          {/* **통합 홈**(UX-IMPL, 2026-09-13) — 목업 v3 의 간편 화면이다.
              REVIEW.md D16 "간편화면을 홈으로 흡수" 결정을 따른다.
              옛 `/simple`(타일 넷) 주소를 **지우지 않고 여기로 보낸다** — 저장해 둔
              바로가기가 죽지 않게 호환성을 유지한다(사용자 지시 2026-09-13).
              `/` 는 아직 EasyMode 다. 쉬운화면의 기능이 전부 이 홈에 연결되고
              검증되기 전에 바꾸면 현장이 매일 쓰는 화면에서 기능이 사라진다. */}
          <Route path="/simple" element={<HomeMode />} />
          {/* **캘린더**(UX-IMPL §5-3, 2026-09-13) — 설정 안에 묻혀 있던 "방송일정 및 예약"을
              탭으로 꺼낸 것이다(사용자 지시). 화면은 `WeeklySchedule` 그대로이고 틀만 바뀐다.
              옛 주소 `/admin?section=scheduledBroadcast` 도 그대로 산다. */}
          <Route path="/calendar" element={<CalendarMode />} />
          {/* **업로드**(2026-09-13 사용자 지시) — 설정 안에 있던 "음원 및 동영상 관리"를
              캘린더와 **같은 층**으로 꺼낸 것이다. 자주 하는 일이라 설정에 묻어 두지 않는다.
              옛 주소 `/admin?section=musicManagement` 도 그대로 산다. */}
          <Route path="/upload" element={<UploadMode />} />
          {/* **자동순서**(2026-09-13 사용자 지시) — 탭으로 도착했는데 관리자 사이드바가
              붙어 있어 "설정 안"으로 읽혔다. 캘린더·업로드와 같은 층으로 올린다.
              옛 주소 `/admin?section=morningEditor` 도 그대로 산다. */}
          <Route path="/flow" element={<FlowMode />} />
          {/* 상세 모드: 관리자용 */}
          <Route path="/admin" element={<AdminMode />} />
        </Routes>
      </ErrorBoundary>
      {/* 소리를 내는 host 들. 눈에 보이는 것이 없으므로 여기도 `조용히` 다 —
          다만 **서로 갈라 둔다**: BGM host 가 터져도 음악 재생은 살아 있어야 한다. */}
      <ErrorBoundary 이름="음악 재생" 조용히><MusicPlayer /></ErrorBoundary>
    </BrowserRouter>
  )
}
