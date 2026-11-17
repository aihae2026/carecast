import { useState, useEffect } from 'react'
import { CalendarClock } from 'lucide-react'
import { getTodaySchedule } from '../../lib/api'
import { batchSchedules } from '../../lib/scheduleBatch'

// 오늘 나갈 방송을 한 목록으로 — 일과방송(아침 방송·국민체조 등) + 예약.
//
// 예전엔 getSchedules()만 읽어서 **일과방송 5종이 아예 안 보였다**(CC-026). 그것들은
// schedules 테이블이 아니라 settings의 시각·활성 키로 돌기 때문이다. 이제 서버가 두 출처를
// 합쳐서 주고(GET /api/schedules/today), **완료/누락 판정도 서버 것을 그대로 쓴다** —
// 화면이 따로 계산하면 watchdog 경보와 어긋나서 사람이 둘 다 안 믿게 된다.

// 같은 묶음(group_id)의 항목을 한 줄로 접어 "1차/2차" 배지로 보여준다.
//
// **접을지 말지의 판정은 scheduleBatch가 한다** — 주간표·예약목록도 같은 규칙을 쓴다.
// 규칙을 화면마다 복사해 두면 한쪽만 고쳐지는 순간 같은 방송이 화면에 따라 한 줄로도
// 두 줄로도 보인다. 여기서는 접힌 덩어리를 **이 화면이 그리는 모양**으로 바꾸기만 한다.
function groupItems(items) {
  return batchSchedules(items, 'time').map(batch => {
    if (batch.items.length === 1) return batch.items[0]
    const sorted = batch.items
    return {
      _isGroup: true, _items: sorted,
      key: `group_${batch.groupId}`, time: sorted[0].time,
      _time_end: sorted[sorted.length - 1].time,
      label: sorted[0].label, target: sorted[0].target,
      // 묶음의 상태 — 하나라도 안 나갔으면 그게 보여야 한다(누락 > 예정 > 완료)
      status: sorted.some(i => i.status === 'missed') ? 'missed'
            : sorted.some(i => i.status === 'pending') ? 'pending'
            : sorted.some(i => i.status === 'unknown') ? 'unknown'
            : 'done',
    }
  })
}

// 우측: 오늘 방송 일정 타임라인
export default function TodaySchedule() {
  const [items, setItems] = useState([])

  useEffect(() => {
    const load = () => getTodaySchedule().then(r => setItems(r?.items ?? [])).catch(() => {})
    load()
    // 상태(예정→완료/누락)는 시간이 지나면서 바뀐다. 서버가 판정하므로 주기적으로 다시 받는다.
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [])

  const today = groupItems(items)

  // 다음 방송 — 아직 안 나간 것 중 첫 번째. 누락된 건 "다음"이 아니다.
  const nextKey = today.find(s => s.status === 'pending')?.key ?? null

  return (
    <div className="card-base flex flex-col">
      <h3 className="text-xs font-semibold text-ds-v3-ink mb-3 flex-shrink-0">오늘 방송 일정</h3>

      {today.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
          <CalendarClock size={28} className="text-ds-v3-ink-3" />
          <p className="text-xs text-ds-v3-ink-2 text-center">오늘 예정된 방송이<br />없습니다</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {today.map(s => {
            const isNext  = s.key === nextKey
            const done    = s.status === 'done'
            const missed  = s.status === 'missed'
            // 누락은 흐리게 하지 않는다 — 사람이 알아채야 하는 유일한 상태다
            const grayOut = done

            const rowClass = `flex items-center gap-2 px-3 py-2.5 rounded-btn border transition-colors
              ${grayOut
                ? 'bg-ds-v3-bg border-ds-v3-line opacity-50'
                : missed
                  ? 'bg-ds-v3-warn-bg border-ds-v3-warn-bg'
                  : isNext
                    ? 'bg-ds-v3-tts-bg border-ds-v3-tts/30'
                    : 'bg-white border-ds-v3-line'}`
            const dotClass = `w-2 h-2 rounded-full flex-shrink-0 ${
              grayOut ? 'bg-ds-v3-line' : missed ? 'bg-ds-v3-warn' : isNext ? 'bg-ds-v3-tts' : 'bg-ds-v3-line'
            }`
            const timeClass = `nums text-xs font-semibold flex-shrink-0 ${
              grayOut ? 'text-ds-v3-ink-2' : missed ? 'text-ds-v3-warn' : isNext ? 'text-ds-v3-tts' : 'text-ds-v3-ink'
            }`
            const labelClass = `flex-1 text-xs truncate ${
              grayOut ? 'text-ds-v3-ink-2' : missed ? 'text-ds-v3-warn' : 'text-ds-v3-ink'
            }`

            // ── 묶음 항목 (1차/2차 배지) ──
            if (s._isGroup) {
              return (
                <div key={s.key} className={rowClass}>
                  <span className={dotClass} />
                  <span className={timeClass}>{s.time}~{s._time_end}</span>
                  <span className={labelClass}>
                    {s.label}
                    {missed || s.status === 'unknown' ? (
                      <span className="block text-xs">{missed ? '안 나감' : '결과 미확인'}</span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {s._items.map((item, idx) => (
                      <span key={item.key} className={`text-xs px-1 py-0.5 rounded-full font-semibold border
                        ${item.status === 'done'
                          ? 'bg-ds-v3-surface-2 text-ds-v3-ink-2 border-ds-v3-line'
                          : item.status === 'missed'
                            ? 'bg-ds-v3-warn-bg text-ds-v3-warn border-ds-v3-warn-bg'
                            : item.status === 'unknown'
                              ? 'bg-ds-v3-surface-2 text-ds-v3-ink-2 border-ds-v3-line'
                            : 'bg-ds-v3-tts-bg text-ds-v3-tts border-ds-v3-tts/30'}`}>
                        {item.status === 'done' ? '✓' : ''}{idx + 1}차
                      </span>
                    ))}
                  </div>
                </div>
              )
            }

            // ── 일반 항목 ──
            return (
              <div key={s.key} className={rowClass}>
                <span className={dotClass} />
                <span className={`${timeClass} w-10`}>{s.time}</span>
                <span className={labelClass}>{s.label}</span>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* 일과방송은 매일 같은 시각에 도는 고정 방송이라 대상 대신 그걸 표시한다 */}
                  {s.kind === 'auto'
                    ? <span className="text-xs text-ds-v3-ink-2">고정</span>
                    : s.target ? <span className="text-xs text-ds-v3-ink-2">{s.target}</span> : null}
                  {done ? (
                    <span className="text-xs text-ds-v3-ink-2 bg-ds-v3-surface-2 border border-ds-v3-line px-1.5 py-0.5 rounded-full">
                      완료
                    </span>
                  ) : missed ? (
                    <span className="text-xs text-ds-v3-warn bg-ds-v3-warn-bg border border-ds-v3-warn-bg px-1.5 py-0.5 rounded-full font-semibold">
                      안 나감
                    </span>
                  ) : s.status === 'unknown' ? (
                    <span className="text-xs text-ds-v3-ink-2">결과 미확인</span>
                  ) : isNext ? (
                    <span className="text-xs text-ds-v3-tts bg-ds-v3-tts-bg border border-ds-v3-tts/30 px-1.5 py-0.5 rounded-full font-semibold">
                      다음
                    </span>
                  ) : (
                    <span className="text-xs text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-1.5 py-0.5 rounded-full">
                      대기
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
