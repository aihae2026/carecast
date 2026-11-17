import ImprovementProposals from '../components/admin/sections/ImprovementProposals'

// /dev-console — 관리자 사이드바에서 뺀 "고도화 제안"(자율 점검·코칭 브리프) 전용 페이지.
// URL을 직접 아는 사람만 들어옴 — CareCast 관리자 화면(직원이 볼 수 있는 화면)에는 노출 안 함.
export default function DevConsolePage() {
  return (
    <div className="min-h-screen bg-ds-v3-bg">
      <ImprovementProposals />
    </div>
  )
}
