import { useState, useEffect } from 'react'
import { TrendingUp, FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getBroadcastSummary } from '../../lib/api'
import HelpTip from '../shared/HelpTip'

export default function MonthlyBroadcastStats() {
  const [stats, setStats] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const now = new Date()
    getBroadcastSummary(now.getFullYear(), now.getMonth() + 1)
      .then(setStats)
      .catch(() => {})
  }, [])

  const now = new Date()
  const monthLabel = `${now.getMonth() + 1}월 방송`

  return (
    <div className="card-base">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={13} className="text-ds-v3-tts" />
        <span className="text-xs font-semibold text-ds-v3-ink">{monthLabel} 통계</span>
        <HelpTip id="monthlyStats" />
        {stats && (
          <span className="text-xs text-ds-v3-ink-2 nums font-semibold">총 {stats.total}건</span>
        )}
      </div>

      {/* 통계 상세 — 항상 표시 */}
      <div className="grid grid-cols-4 gap-2">
        {stats ? [
          // 칸 이름을 관리자 대시보드와 맞췄다(UX-34) — 같은 것을 두 화면이 다르게 부르면
          // 사람이 두 숫자를 다른 것으로 읽는다. 서버 집계는 `domain/broadcastRecord.종류칸` 정본.
          { label: '즉시방송', value: stats.instant,   color: 'text-ds-v3-ink-3' },
          { label: 'TTS',      value: stats.tts,       color: 'text-ds-v3-tts' },
          { label: '자동방송', value: stats.scheduled, color: 'text-ds-v3-ink-2' },
          { label: '오류',     value: stats.error,     color: 'text-ds-v3-warn'  },
        ].map(item => (
          <div key={item.label}
            className="text-center bg-ds-v3-bg rounded-[10px] py-2.5 border border-ds-v3-line">
            <p className={`text-xl font-semibold nums ${item.color}`}>{item.value}</p>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5">{item.label}</p>
          </div>
        )) : (
          <div className="col-span-4 py-3 text-center text-xs text-ds-v3-ink-2">불러오는 중...</div>
        )}
      </div>

      {/* 전체기록보기 */}
      <button
        onClick={() => navigate('/admin?section=broadcastLog')}
        className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-btn
                   border border-ds-v3-line text-sm text-ds-v3-ink-2 hover:text-ds-v3-tts
                   hover:border-ds-v3-tts/40 btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
      >
        <FileText size={12} />
        전체 기록 보기
      </button>
    </div>
  )
}
