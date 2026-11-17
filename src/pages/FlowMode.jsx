// 자동순서 — 머리줄 탭의 제 화면 (사용자 지시 2026-09-13).
//
// *"자동순서에서 저 왼쪽 대시바 안지울래? 설정 페이지를 갖고 오면 어떡하냐"*.
//
// 탭을 눌러 도착했는데 **관리자 사이드바가 그대로 붙어** 있었다. 그러면 "설정 안에
// 들어와 있다"로 읽힌다 — 탭으로 꺼낸 뜻이 없어진다. 캘린더·업로드와 **같은 층**이어야
// 층이 실제로 갈린다.
//
// 화면은 `MorningEditor` 그대로다. 이 파일은 **틀만** 준다(머리줄·배경·폭).
// 옛 주소 `/admin?section=morningEditor` 도 그대로 산다 — 저장해 둔 링크가 죽지 않는다.
import { useNavigate } from 'react-router-dom'
import '../styles/tokens.css'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import HomeShell from '../components/home/HomeShell'
import MorningEditor from '../components/admin/sections/MorningEditor'

export default function FlowMode() {
  const navigate = useNavigate()

  return (
    <HomeShell tab="flow" onNavigate={navigate} title={null} layout="page">
      <ErrorBoundary 이름="자동순서">
        <MorningEditor />
      </ErrorBoundary>
    </HomeShell>
  )
}
