// 업로드 — 목업 v3 에는 없던 다섯째 탭. 음원·동영상을 올리고 관리하는 화면이다.
//
// 사용자 지시(2026-09-13): *"업로드는 설정 페이지 내부에 있는 업로드가 아니라 따로 아예
// 캘린더 처럼 아예 빼라니까"* — 캘린더와 **같은 층**으로 올린다.
//
// ── 왜 설정 안에 두면 안 되나 ────────────────────────────────────────────────
// 음원을 올리는 일은 **자주 한다**(행사 음원·새 안내 문구·계절 BGM). 자주 하는 일이
// 「설정」 사이드바 일곱 칸 중 하나에 묻혀 있으면 사람은 그 기능을 안 쓰거나 매번 길을
// 헤맨다. 설정은 **가끔 와서 정확히 고치고 나가는 곳**이고, 여기는 그렇지 않다.
//
// 처음에는 머리줄 탭만 `/admin?section=musicManagement` 로 보냈는데, 그러면 도착한 화면에
// **관리자 사이드바가 그대로 붙어** 있어서 "설정 안에 들어와 있다"로 읽혔다. 캘린더처럼
// 사이드바 없는 제 화면이어야 층이 실제로 갈린다.
//
// ── 화면을 새로 만들지 않는다 ────────────────────────────────────────────────
// 올리기·폴더·자막·미리듣기·삭제는 전부 `MusicManagement` 가 이미 한다. 다시 만들면
// **기능을 잃는다.** 이 파일은 **틀만** 준다(머리줄·배경·폭). `CalendarMode` 와 같은 규칙이다.
//
// ── 옛 주소는 살아 있다 ─────────────────────────────────────────────────────
// `/admin?section=musicManagement` 로 들어오면 `AdminMode` 가 같은 컴포넌트를 그린다.
// **끊지 않는다** — 저장해 둔 링크·문서·바로가기가 있다.
import { useNavigate } from 'react-router-dom'
import '../styles/tokens.css'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import HomeShell from '../components/home/HomeShell'
import MusicManagement from '../components/admin/sections/MusicManagement'

export default function UploadMode() {
  const navigate = useNavigate()

  return (
    // 제목은 이 화면이 스스로 갖는다. 「소리 조절」 서랍은 홈의 것이라 손잡이를 안 낸다 —
    // 여는 길이 없는데 손잡이만 있으면 누르고 아무 일도 안 일어난다.
    <HomeShell tab="media" onNavigate={navigate} title={null} layout="page">
      <ErrorBoundary 이름="음원 및 동영상 관리">
        <MusicManagement />
      </ErrorBoundary>
    </HomeShell>
  )
}
