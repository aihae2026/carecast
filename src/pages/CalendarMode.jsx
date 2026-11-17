// 캘린더 — 목업 v3 의 「캘린더」 화면.
//
// 사용자 지시(2026-09-13): *"차라리 캘린더라고 해서 지금 설정에 있는 방송일정 및 예약
// 페이지를 빼는거지"* — **설정 안에 묻혀 있던 화면을 탭으로 꺼낸다.**
//
// ── 화면을 새로 만들지 않는다 ────────────────────────────────────────────────
// 달력이 하는 일은 전부 `WeeklySchedule` 이 이미 한다 — 월간·주간·목록 보기, 끌어서
// 옮기기(`planMove`), 빠른 등록·상세 팝업, 자동방송 5종 접기, 묶음 접기, 일시정지.
// 그것을 여기서 다시 만들면 **기능을 잃는다.** 이 파일은 **틀만** 준다(머리줄·배경·폭).
// `HomeMode` 와 같은 규칙이다.
//
// ── `/admin?section=scheduledBroadcast` 는 살아 있다 ─────────────────────────
// 옛 주소로 들어오면 `AdminMode` 가 `weeklySchedule` 로 보낸다(`LEGACY_REDIRECTS`).
// 같은 컴포넌트라 보이는 것도 같다. **끊지 않는다** — 저장해 둔 링크·문서·바로가기가 있다.
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../styles/tokens.css'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import HomeShell from '../components/home/HomeShell'
import WeeklySchedule from '../components/admin/sections/WeeklySchedule'

export default function CalendarMode() {
  const navigate = useNavigate()
  // ── `?view=list` 로 **목록 보기**를 바로 연다 (2026-09-15) ────────────────────
  // 간편화면 서랍의 「전체 예약 관리」가 그 주소로 보낸다. 이름이 「전체 예약 관리」인데
  // 달력 격자가 뜨면 이름과 도착지가 갈린다 — 머리줄 탭에서 이미 한 번 겪은 실수다.
  // **모르는 값은 무시한다**(`WeeklySchedule` 이 거른다) — 오타로 빈 화면이 뜨면 안 된다.
  const [searchParams] = useSearchParams()

  return (
    // 제목은 이 화면이 스스로 갖는다 — 홈의 "무엇을 방송할까요?" 는 여기 어울리지 않는다.
    // 「소리 조절」 서랍은 홈의 것이다. 달력에서는 손잡이를 내지 않는다 — 여는 길이 없는데
    // 손잡이만 있으면 누르고 아무 일도 안 일어난다.
    <HomeShell tab="calendar" onNavigate={navigate} title={null} layout="page">
      <ErrorBoundary 이름="방송일정 및 예약">
        {/* tone 은 **색만** 바꾼다 — 보기 전환·끌어 옮기기·팝업·일시정지는 같은 한 벌이다.
            "캘린더 색 이대로 가"(사용자, 2026-09-13) = 목업의 색 셋을 그대로 쓴다. */}
        <WeeklySchedule tone="v3" 초기보기={searchParams.get('view')} />
      </ErrorBoundary>
    </HomeShell>
  )
}
