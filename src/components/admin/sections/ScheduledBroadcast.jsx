import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, ChevronRight, ChevronDown,
         Sunrise, Moon, Sunset, Activity, Utensils, Zap } from 'lucide-react'
import { getSchedules, toggleSchedule, deleteSchedule, getBroadcastSchedule,
         triggerMorningBroadcast, triggerExerciseBroadcast, triggerLunchBroadcast, triggerDinnerBroadcast,
         triggerEveningPrayerBroadcast } from '../../../lib/api'
import { runsOnDate, formatRepeatLabel } from '../../../lib/scheduleUtils'
import { batchSchedules } from '../../../lib/scheduleBatch'
import { autoName } from '../../../lib/autoBroadcastNames'
import { TAB_ID } from '../../../lib/tabId'
import { ScheduleModal, BroadcastTypeBadge } from '../../shared/ScheduleModal'

export { ScheduleModal }

const AUTO_META = {
  morning:         { label: '아침 방송',        Icon: Sunrise,  color: 'text-ds-v3-ink-2',  trigger: triggerMorningBroadcast        },
  exercise:        { label: '국민체조',         Icon: Activity, color: 'text-ds-v3-ink-3',  trigger: triggerExerciseBroadcast       },
  lunch:           { label: '식사전 체조(점심)', Icon: Utensils, color: 'text-ds-v3-tts',   trigger: triggerLunchBroadcast          },
  dinner:          { label: '식사전 체조(저녁)', Icon: Moon,     color: 'text-ds-v3-flow', trigger: triggerDinnerBroadcast         },
  evening_prayer:  { label: '저녁 마무리',      Icon: Sunset,   color: 'text-ds-v3-tts', trigger: triggerEveningPrayerBroadcast  },
}

function buildAutoItems(schedule) {
  if (!schedule) return []
  return ['morning', 'exercise', 'lunch', 'dinner', 'evening_prayer']
    .filter(id => schedule[id]?.enabled)
    .map(id => ({
      id: `auto_${id}`,
      scheduled_time: schedule[id].time,
      title: autoName(schedule, id),
      broadcast_type: 'auto',
      active: 1,
      repeat_start_date: '2000-01-01',
      repeat_end_date: null,
      repeat_weekdays: [0, 1, 2, 3, 4, 5, 6],
      target: '전체',
      _autoId: id,
      _isAuto: true,
    }))
}

// ── **켜진 것은 파랑, 시각은 잉크** (사용자 지시 2026-09-16) ──────────────────
// *"활성 표시 저렇게 회색하니까 좀 그래 차라리 시간을 검은색 및 회색으로 하고
//   상태를 파란색을 넣던지"*
//
// 앞 판은 **정확히 반대**였다 — 시각이 파랑(`text-ds-v3-tts`)이고 「활성」이 회색
// (`text-ds-v3-ink-3`)이었다. 그래서 **모든 줄의 시각이 똑같이 파래서** 파랑이 아무
// 뜻도 못 하고, 정작 «지금 이 예약이 살아 있나» 는 회색이라 꺼진 것처럼 보였다.
//
// 색은 **다른 것들 사이에서 다른 것**에만 쓴다. 시각은 줄마다 다르니 색이 필요 없고
// (잉크로 충분하다), 상태는 살았나 멈췄나 둘뿐이라 색이 일을 한다.
export function ScheduleStatus({ active }) {
  return active
    ? <span className="flex items-center gap-1.5 text-xs font-semibold text-ds-v3-tts">
        <span className="w-1.5 h-1.5 rounded-full bg-ds-v3-tts inline-block" /> 활성
      </span>
    : <span className="flex items-center gap-1.5 text-xs font-normal text-ds-v3-ink-3">
        <span className="w-1.5 h-1.5 rounded-full bg-ds-v3-line-2 inline-block" /> 일시정지
      </span>
}

// ── 즐겨찾기 버튼 편집기 ─────────────────────────────────────────
export default function ScheduledBroadcast({ embedded, onChanged, refreshKey, filterDate } = {}) {
  const [schedules,    setSchedules]    = useState([])
  const [autoSchedule, setAutoSchedule] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [modal,        setModal]        = useState(null)
  const [triggering,   setTriggering]   = useState(null)
  // 접어 둔 1·2차 묶음 중 펼쳐 놓은 것 (group_id)
  const [openGroups,   setOpenGroups]   = useState(() => new Set())

  const load = async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([getSchedules(), getBroadcastSchedule()])
      setSchedules(s)
      setAutoSchedule(a)
    } catch (e) { console.error('[예약방송] 목록 불러오기 실패:', e.message) }  // 목록만 비고 화면은 뜬다
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [refreshKey])

  // **다른 기기·다른 화면이 예약을 바꾸면 여기도 따라간다** (P-16, 2026-09-11).
  // 전에는 `refreshKey` 가 유일한 재조회 경로였다 — 부모가 올려 주지 않으면 영영 안 읽는다.
  // **내가 바꾼 것이면 건너뛴다**(이미 `load()` 를 불렀으므로 두 번 읽으면 깜빡인다).
  useEffect(() => {
    const 들을때 = (e) => { if (e.detail?.by !== TAB_ID) load() }
    window.addEventListener('carecast:schedules-updated', 들을때)
    return () => window.removeEventListener('carecast:schedules-updated', 들을때)
  }, [])

  const handleTriggerAuto = async (autoId) => {
    if (triggering) return
    setTriggering(autoId)
    try { await AUTO_META[autoId].trigger() } catch (e) { console.error('[예약방송] 수동 실행 실패:', e.message) }  // 버튼 잠금은 아래 타이머가 풀어준다
    setTimeout(() => setTriggering(null), 2000)
  }

  const handleToggle = async (id) => {
    try {
      const result = await toggleSchedule(id)
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, active: result.active ? 1 : 0 } : s))
      onChanged?.()
    } catch (err) { alert(err.message) }
  }

  const handleDelete = async (id, title) => {
    if (!confirm(`"${title}" 예약을 삭제하시겠습니까?`)) return
    try {
      await deleteSchedule(id)
      setSchedules(prev => prev.filter(s => s.id !== id))
      onChanged?.()
    } catch (err) { alert(err.message) }
  }

  const handleSaved = () => { setModal(null); load(); onChanged?.() }

  const autoItems   = buildAutoItems(autoSchedule)
  const allItems    = [...autoItems, ...schedules]
    .filter(item => filterDate == null || runsOnDate(item, filterDate))
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))

  // 1차·2차로 나뉜 같은 방송(환기방송)은 한 줄로 접는다 — 주간표·오늘방송일정과 같은 규칙.
  //
  // **접은 줄에는 편집·삭제 버튼을 두지 않는다.** 두 건을 대표하는 한 줄에서 삭제를 누르면
  // 1차만 지워지고 2차가 남는다 — 화면은 "지웠다"고 보이는데 방송은 계속 나간다.
  // 고치려면 먼저 펼치게 한다.
  const visibleRows = batchSchedules(allItems, 'scheduled_time').flatMap(b => {
    if (b.items.length === 1) return b.items
    const open = openGroups.has(b.groupId)
    const head = { ...b.items[0], _batch: b, _batchOpen: open }
    return open
      ? [{ ...head, _batchNo: 1 }, ...b.items.slice(1).map((s, i) => ({ ...s, _batchNo: i + 2 }))]
      : [head]
  })

  const toggleGroup = (gid) => setOpenGroups(prev => {
    const next = new Set(prev)
    if (next.has(gid)) next.delete(gid); else next.add(gid)
    return next
  })

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => setModal({})}
            className="flex items-center gap-2 px-4 py-2.5 bg-ds-v3-ink hover:bg-black
                       text-white rounded-btn text-sm font-semibold btn-press transition-colors">
            <Plus size={15} /> 예약 추가
          </button>
        </div>
      )}

      <div className="card-base overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-ds-v3-bg border-b border-ds-v3-line">
            {/* 좁은 화면에서는 대상·반복 열을 접는다 — 그 값은 제목 칸 아래 한 줄로 함께 보인다.
                표를 옆으로 밀지 않기 위해서다("횡스크롤은 못 쓴다", 고도화 제안 #25).
                마크업을 두 벌로 만들지 않는 이유: 예약 표는 묶음·자동방송 행이 얽혀 있어
                한 벌 더 두면 반드시 한쪽만 고쳐지는 날이 온다. */}
            <tr className="text-left text-xs text-ds-v3-ink-2">
              <th className="px-3 md:px-5 py-3.5 font-semibold w-16 md:w-20">시간</th>
              <th className="px-3 md:px-5 py-3.5 font-semibold">제목</th>
              <th className="hidden laptop:table-cell px-5 py-3.5 font-semibold w-24">대상</th>
              <th className="hidden laptop:table-cell px-5 py-3.5 font-semibold w-20">반복</th>
              <th className="px-3 md:px-5 py-3.5 font-semibold w-20 md:w-24">상태</th>
              <th className="px-3 md:px-5 py-3.5 font-semibold w-28 md:w-36 text-right">작업</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center py-8 text-ds-v3-ink-2 text-sm">불러오는 중...</td></tr>
            )}
            {!loading && allItems.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-ds-v3-ink-2 text-sm">
                {filterDate != null ? '이 날짜에는 예약이 없습니다.' : '등록된 예약이 없습니다.'}
              </td></tr>
            )}
            {!loading && visibleRows.map((s) => {
              const meta = s._isAuto ? AUTO_META[s._autoId] : null
              const AutoIcon = meta?.Icon
              // ── **줄무늬를 걷는다** (사용자 지시 2026-09-16) ────────────────────
              // *"그리고 목록은 왜 이렇게 얼룩덜룩하게 보여 … 아예 저렇게 넣지말고
              //   반투명(너무 반투명말고 살짝)해야지 통일감이 있으려나 흰배경에?"*
              //
              // 앞 판은 **두 가지 무늬가 겹쳐 있었다** — 홀짝 줄무늬와 자동방송 파랑(`/40`).
              // 둘이 엇갈리면서 규칙이 안 읽히는 얼룩이 됐다. 줄무늬는 칸이 많은 표에서 눈이
              // 줄을 놓치지 말라고 쓰는 것인데, 이 표는 줄 사이에 선(`border-b`)이 이미 있어
              // **일을 두 번 하고 있었다.**
              //
              // 이제 바탕은 **흰색 하나**고, 자동방송만 아주 옅게(`/20`) 비친다 —
              // 「저 줄은 사람이 만든 게 아니다」는 한 가지 사실만 색으로 말한다.
              //
              // 바탕 클래스는 **한 번만** 붙인다 — `bg-white` 와 `bg-…/20` 을 둘 다 적으면
              // 어느 쪽이 이길지는 문자열 순서가 아니라 CSS 파일 순서가 정한다.
              return (
                <tr key={s.id}
                  className={'border-b border-ds-v3-line transition-colors hover:bg-ds-v3-bg '
                    + (s._isAuto ? 'bg-ds-v3-tts-bg/20' : 'bg-white')}>
                  <td className="px-3 md:px-5 py-3.5 nums font-semibold text-ds-v3-ink">
                    {s._batch && !s._batchOpen
                      ? `${s._batch.items[0].scheduled_time}~${s._batch.items[s._batch.items.length - 1].scheduled_time}`
                      : s.scheduled_time}
                  </td>
                  <td className={`px-3 md:px-5 py-3.5 text-ds-v3-ink font-normal ${s._batchNo > 1 ? 'pl-10' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {s._batch && (
                        <button onClick={() => toggleGroup(s._batch.groupId)}
                          title={s._batchOpen ? '접기' : '펼쳐서 하나씩 보기'}
                          className="text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press transition-colors">
                          {s._batchOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                      {AutoIcon && <AutoIcon size={13} className={meta.color} />}
                      <span>{s.title}</span>
                      {s._batch && !s._batchOpen && (
                        <span className="text-[10px] text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-1.5 py-0.5 rounded-full font-semibold">
                          {s._batch.items.map((_, i) => i + 1).join('·')}차
                        </span>
                      )}
                      {s._batchNo && (
                        <span className="text-[10px] text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-1.5 py-0.5 rounded-full font-semibold">
                          {s._batchNo}차
                        </span>
                      )}
                      {s._isAuto
                        ? <span className="text-[10px] text-ds-v3-tts bg-ds-v3-tts-bg border border-ds-v3-tts/20 px-1.5 py-0.5 rounded-full font-semibold">자동</span>
                        : s.group_id
                          ? <span className="text-[10px] text-ds-v3-ink-3 bg-ds-v3-surface-2 border border-ds-v3-line px-1.5 py-0.5 rounded-full font-semibold">자동</span>
                          : <BroadcastTypeBadge type={s.broadcast_type} />
                      }
                    </div>
                    {s.content && (
                      <div className="text-xs text-ds-v3-ink-2 mt-0.5 truncate max-w-xs">{s.content}</div>
                    )}
                    {/* 접힌 열(대상·반복)을 여기서 보여준다 — 좁은 화면에서도 정보가 사라지지 않는다 */}
                    <div className="laptop:hidden text-xs text-ds-v3-ink-2 mt-1">
                      {s.target} · {formatRepeatLabel(s)}
                    </div>
                  </td>
                  <td className="hidden laptop:table-cell px-5 py-3.5 text-ds-v3-ink-2 text-xs">{s.target}</td>
                  <td className="hidden laptop:table-cell px-5 py-3.5 text-ds-v3-ink-2 text-xs">{formatRepeatLabel(s)}</td>
                  <td className="px-3 md:px-5 py-3.5">
                    {/* 자동방송도 **같은 부품**을 쓴다 — 예전엔 여기에 같은 마크업이
                        한 벌 더 박혀 있어서, 색을 고칠 때 한쪽만 바뀌곤 했다. */}
                    {s._isAuto
                      ? <ScheduleStatus active={1} />
                      : s._batch && !s._batchOpen
                        // 접은 줄은 두 건을 대표한다 — 1차만 보고 "활성"이라 적으면 거짓이 된다
                        ? (s._batch.items.every(i => i.active)
                            ? <ScheduleStatus active={1} />
                            : <span className="text-xs font-semibold text-ds-v3-ink-2">일부 정지</span>)
                        : <ScheduleStatus active={s.active} />
                    }
                  </td>
                  <td className="px-3 md:px-5 py-3.5">
                    {/* 버튼이 안 줄어들어 표를 밀던 자리 — 좁으면 줄을 바꾼다 */}
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      {s._batch && !s._batchOpen ? (
                        <button onClick={() => toggleGroup(s._batch.groupId)}
                          className="px-2.5 py-1 rounded-btn text-xs font-semibold text-ds-v3-ink-2 border border-ds-v3-line
                                     hover:text-ds-v3-tts hover:border-ds-v3-tts/40 transition-colors btn-press">
                          펼쳐서 수정
                        </button>
                      ) : s._isAuto ? (
                        <button
                          onClick={() => handleTriggerAuto(s._autoId)}
                          disabled={!!triggering}
                          title="지금 방송"
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-btn text-xs font-semibold border transition-colors btn-press
                            ${triggering === s._autoId
                              ? 'bg-ds-v3-ink-2 text-white border-ds-v3-ink-2 animate-pulse'
                              : 'text-ds-v3-ink-2 border-ds-v3-line hover:text-ds-v3-ink-2 hover:border-ds-v3-line'}`}>
                          <Zap size={12} /> 지금 방송
                        </button>
                      ) : (
                        <>
                          <button onClick={() => handleToggle(s.id)} title={s.active ? '일시정지' : '활성화'}
                            className="btn-press transition-colors">
                            {s.active
                              ? <ToggleRight size={20} className="text-ds-v3-ink-3" />
                              : <ToggleLeft  size={20} className="text-ds-v3-ink-2" />}
                          </button>
                          <button onClick={() => setModal(s)}
                            className="text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press transition-colors">
                            <Edit2 size={15} />
                          </button>
                          <button onClick={() => handleDelete(s.id, s.title)}
                            className="text-ds-v3-ink-2 hover:text-ds-v3-warn btn-press transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-5 py-3 bg-ds-v3-bg border-t border-ds-v3-line text-xs text-ds-v3-ink-2">
          자동방송 <span className="text-ds-v3-tts font-semibold nums">{autoItems.length}</span>건 •
          수동예약 <span className="text-ds-v3-ink font-semibold nums">{schedules.length}</span>건 (활성 <span className="text-ds-v3-ink-3 font-semibold nums">{schedules.filter(s => s.active).length}</span>건)
        </div>
      </div>

      <div className="flex items-start gap-3 px-4 py-3.5 bg-ds-v3-tts-bg border border-ds-v3-line
                      rounded-btn text-sm text-ds-v3-tts">
        <span className="flex-shrink-0 mt-0.5 font-semibold">ℹ</span>
        <span>예약 방송은 설정된 시각에 자동 실행됩니다. <strong>TTS</strong>는 텍스트 → 음성 변환, <strong>BGM</strong>은 이 PC 의 방송용·식사용 음원 재생, <strong>음원선택</strong>은 업로드된 파일 재생, <strong>차임벨</strong>은 알림음을 재생합니다.</span>
      </div>

      {/* 추가/수정 모달 */}
      {modal !== null && (
        <ScheduleModal
          schedule={modal?.id ? modal : (Object.keys(modal).length > 0 ? modal : null)}
          onClose={() => setModal(null)}
          onSave={handleSaved}
        />
      )}
    </div>
  )
}
