import { useEffect, useState } from 'react'
import { Bell, Clock } from 'lucide-react'
import { getTodaySchedule } from '../../lib/api'
import { formatRepeatLabel } from '../../lib/scheduleUtils'

// 다음에 나갈 방송 하나. 아직 안 나간 것(pending) 중 가장 이른 것.
//
// 예전엔 예약 목록 API만 읽어서 **자동방송 5종(아침·체조·점심·저녁·저녁 마무리)이 여기 아예
// 안 떴다** — 그것들은 schedules 테이블이 아니라 settings의 시각·활성 키로 돌기 때문이다.
// 07:50에 아침방송이 있는데 띠에는 "다음 예약 14:00"만 보였다(CC-026).
// /api/schedules/today가 둘을 합쳐서 주고, 오늘 도는 것만 걸러서 준다.
function findNext(items) {
  return items.find(i => i.status === 'pending') ?? null
}

// 다음 예약 방송 알림 바
export default function NotificationBar() {
  const [next, setNext] = useState(null)

  useEffect(() => {
    const load = () => {
      getTodaySchedule()
        .then(items => setNext(findNext(Array.isArray(items) ? items : items?.items || [])))
        .catch(err => console.error('[다음예약] 오늘 목록 조회 실패:', err.message))
    }
    load()
    // 1분마다 갱신 (시간 경과에 따라 다음 예약 변경)
    const t = setInterval(load, 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // 다음 예약이 없으면 알림 바 숨김
  if (!next) return null

  // 자동방송은 대상·반복이라는 개념이 없다(settings로 도는 고정 방송) — 그 자리에 갈래를 적는다
  const meta = next.kind === 'auto'
    ? '자동방송'
    : [next.target, formatRepeatLabel(next)].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-3 px-6 py-2.5 bg-ds-v3-surface-2 border-b border-ds-v3-line flex-shrink-0">
      <Bell size={14} className="text-ds-v3-ink-2 flex-shrink-0" />
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ds-v3-ink-2 font-semibold">다음 예약</span>
        <span className="text-ds-v3-ink-2">·</span>
        <Clock size={13} className="text-ds-v3-ink-2" />
        <span className="nums font-semibold text-ds-v3-ink-2">{next.time}</span>
        <span className="text-ds-v3-ink-2">{next.label}</span>
        {meta && <span className="text-ds-v3-ink-2 text-xs">({meta})</span>}
      </div>
      <div className="ml-auto text-xs text-ds-v3-ink-2 font-normal">자동 방송 예정</div>
    </div>
  )
}
