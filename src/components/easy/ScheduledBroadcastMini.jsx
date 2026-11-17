import { useState, useEffect, useRef, useCallback } from 'react'
import { playBrowserChime } from '../../lib/browserChime'
import { audioBus } from '../../lib/audioBus'
import { CalendarClock, Plus, Bell, Sunrise, Sun, Moon, Volume2, Activity, Utensils, Zap, Film } from 'lucide-react'
import { getSchedules, ttsPreview, getBroadcastSchedule, triggerSchedule } from '../../lib/api'
import { AUTO_TRIGGER, 확인뒤발사 } from '../../lib/broadcastTrigger'
import { runsOnDate } from '../../lib/scheduleUtils'
import { autoName } from '../../lib/autoBroadcastNames'
import { ScheduleModal } from '../shared/ScheduleModal'
import QuickSchedulePhrase from '../shared/QuickSchedulePhrase'
import HelpTip from '../shared/HelpTip'
// 되돌릴 수 없는 것 앞의 확인 한 단계(G-42). **홈 화면과 같은 부품을 쓴다** —
// 두 벌로 만들면 한쪽만 고쳐지는 날이 온다(V③ R19 지적 3, 2026-09-14).
import ConfirmDialog from '../shared/ConfirmDialog'

// ── 그룹 방송 헬퍼 ────────────────────────────────────────────
function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`
}
function timeToMins(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m }

// 같은 group_id 항목 → 20분 이내면 그룹 가상 항목으로 묶기
function groupItems(items) {
  const gMap = new Map()
  const solo = []
  for (const item of items) {
    if (item.group_id) {
      if (!gMap.has(item.group_id)) gMap.set(item.group_id, [])
      gMap.get(item.group_id).push(item)
    } else {
      solo.push(item)
    }
  }
  const result = []
  for (const [gid, gitems] of gMap) {
    const sorted = [...gitems].sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))
    const diffMin = timeToMins(sorted[sorted.length-1].scheduled_time) - timeToMins(sorted[0].scheduled_time)
    if (sorted.length > 1 && diffMin >= 0 && diffMin <= 20) {
      result.push({
        _isGroup: true, _items: sorted,
        id: `group_${gid}`, scheduled_time: sorted[0].scheduled_time,
        _time_end: sorted[sorted.length-1].scheduled_time,
        title: sorted[0].title, target: sorted[0].target,
      })
    } else {
      result.push(...sorted)
    }
  }
  return [...result, ...solo].sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))
}

// 자동방송 슬롯 → 가상 일정 항목으로 변환
// **발사 경로는 여기서 정하지 않는다** — `lib/broadcastTrigger` 의 `AUTO_TRIGGER` 가 단일 출처다.
// 통합 홈의 오늘 목록도 같은 것을 부른다. 두 벌로 두면 한쪽만 고쳐지는 날이 오고,
// 그때 **한 화면에서는 나가고 다른 화면에서는 안 나간다.**
// 여기 남는 것은 이 화면의 **모습**(이름·아이콘·색)뿐이다.
const AUTO_META = {
  morning:       { label: '아침 방송',   Icon: Sunrise,  color: 'text-ds-v3-ink-2',  trigger: AUTO_TRIGGER.morning        },
  exercise:      { label: '국민체조',    Icon: Activity, color: 'text-ds-v3-ink-2',  trigger: AUTO_TRIGGER.exercise       },
  lunch:         { label: '식사전 체조(점심)', Icon: Utensils, color: 'text-ds-v3-tts',   trigger: AUTO_TRIGGER.lunch          },
  dinner:        { label: '식사전 체조(저녁)', Icon: Moon,     color: 'text-ds-v3-flow', trigger: AUTO_TRIGGER.dinner         },
  evening_prayer:{ label: '저녁 마무리', Icon: Bell,     color: 'text-ds-v3-tts', trigger: AUTO_TRIGGER.evening_prayer },
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
      _autoId: id,
      _isAuto: true,
    }))
}

// 방송 유형 아이콘
function TypeIcon({ s, size = 12 }) {
  if (!s) return null
  if (s._isAuto) {
    const { Icon, color } = AUTO_META[s._autoId] || {}
    return Icon ? <Icon size={size} className={`${color} flex-shrink-0`} /> : null
  }
  const type = s.broadcast_type
  if (!type || type === 'text') return null
  if (type === 'chime') return <Bell size={size} className="text-ds-v3-ink-2 flex-shrink-0" />
  if (type === 'video') return <Film size={size} className="text-ds-v3-flow flex-shrink-0" />
  if (type.startsWith('morning')) return <Sunrise size={size} className="text-ds-v3-ink-2 flex-shrink-0" />
  if (type.startsWith('lunch'))   return <Sun size={size} className="text-ds-v3-ink-2 flex-shrink-0" />
  if (type.startsWith('dinner'))  return <Moon size={size} className="text-ds-v3-tts flex-shrink-0" />
  return null
}


// 예약 추가 모달 (쉬운 모드 전용)
// 예약 추가 버튼 — 실제 모달은 shared/ScheduleModal.jsx(관리자와 동일)를 그대로 쓴다.
// 예전엔 이 파일이 독자적인 모달을 따로 구현해서 관리자 화면과 계속 기능이 갈라졌었음.
function QuickAddBtn({ onAdded }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-semibold text-ds-v3-tts bg-ds-v3-tts-bg hover:bg-ds-v3-tts-bg
                   border border-ds-v3-tts/20 rounded-btn px-3 py-1.5 btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
        <Plus size={14} />
        예약 추가
      </button>

      {open && (
        <ScheduleModal
          schedule={null}
          onClose={() => setOpen(false)}
          onSave={() => { setOpen(false); onAdded() }}
        />
      )}
    </>
  )
}

// 오늘 방송 일정 통합 카드 (자동방송 + 수동예약 합침)
export default function ScheduledBroadcastMini({ onNavigate }) {
  const [schedules,    setSchedules]    = useState([])
  const [autoSchedule, setAutoSchedule] = useState(null)
  const [previewing,   setPreviewing]   = useState(null)
  const [triggering,   setTriggering]   = useState(null)
  // 누르면 **묻고**, 확인해야 나간다(G-42). `{ 줄, 자동인가 }` 를 담는다 —
  // 자동방송과 예약은 발사 창구가 달라서 확인 뒤에 어느 쪽을 부를지 알아야 한다.
  const [물음, set물음] = useState(null)
  const audioRef = useRef(null)
  const previewBusRef = useRef(null)   // [audioBus] 미리듣기 장부 등록 손잡이

  // 이 화면의 미리듣기만 끈다 — 전역 정지 신호는 쏘지 않는다(실제 방송은 우리 것이 아니다)
  const stopPreview = () => {
    if (audioRef.current) {
      try { audioRef.current.pause() } catch { /* 이미 끝났으면 그만 */ }
      audioRef.current = null
    }
    previewBusRef.current?.done(); previewBusRef.current = null
    setPreviewing(null)
  }

  const handlePreview = async (s) => {
    if (previewing) return
    setPreviewing(s.id)
    try {
      if (s.broadcast_type === 'chime') {
        playBrowserChime()
        setTimeout(() => setPreviewing(null), 2500)
        return
      }
      if (s.content) {
        const blob = await ttsPreview({ text: s.content })
        const url  = URL.createObjectURL(blob)
        if (audioRef.current) audioRef.current.pause()
        const audio = new Audio(url)
        audioRef.current = audio
        // [audioBus] 예약 문구 미리듣기 등록 — 자연 종료 때 해제(차임은 browserChime이 스스로 등록).
        // stop을 함께 넘긴다 — 실제 방송이 시작되면 장부가 이 손잡이로 비키게 한다(td09 H9)
        previewBusRef.current?.done()
        previewBusRef.current = audioBus.register({
          kind: 'preview-tts', label: s.title || '예약 미리듣기', stop: () => stopPreview(),
        })
        audio.addEventListener('ended', () => { previewBusRef.current?.done(); previewBusRef.current = null })
        audio.play()
        audio.onended = () => { URL.revokeObjectURL(url); setPreviewing(null) }
        return
      }
    } catch (e) { console.error('[예약미니] 미리듣기 실패:', e.message) }  // 아래에서 미리듣기 표시를 원래대로 되돌린다
    setPreviewing(null)
  }

  // **화면을 떠나면 이 화면의 미리듣기를 끊는다(2026-09-02, td09 H4).**
  // 자기 것만 끈다 — 전역 정지 신호도 stopKinds도 부르지 않는다(다른 화면 미리듣기까지 죽는다).
  useEffect(() => () => { stopPreview() }, [])

  const handleTriggerAuto = async (s) => {
    if (triggering) return
    setTriggering(s.id)
    try { await AUTO_META[s._autoId].trigger() } catch (e) { console.error('[예약미니] 자동방송 실행 실패:', e.message) }  // 버튼 잠금은 아래 타이머가 풀어준다
    setTimeout(() => setTriggering(null), 2000)
  }

  const handleTriggerManual = async (s) => {
    if (triggering) return
    setTriggering(s.id)
    try { await triggerSchedule(s.id) } catch (e) { console.error('[예약미니] 예약 실행 실패:', e.message) }  // 버튼 잠금은 아래 타이머가 풀어준다
    setTimeout(() => setTriggering(null), 2000)
  }

  // 묶음의 "다음 차수를 골라 주는" 핸들러는 없앴다(2026-09-01) — 1차/2차 뱃지가 곧 버튼이라
  // 사람이 어느 차수를 낼지 직접 고른다. 고르는 규칙이 없어지면서 last_fired에 기대던 것도 없어졌다.

  const load = useCallback(() => {
    getSchedules().then(setSchedules).catch(() => {})
    getBroadcastSchedule().then(setAutoSchedule).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true, tries = 0
    const tryLoad = () => {
      Promise.all([
        getSchedules().catch(() => null),
        getBroadcastSchedule().catch(() => null),
      ]).then(([s, a]) => {
        if (!alive) return
        if (s !== null) setSchedules(s)
        if (a !== null) setAutoSchedule(a)
        // 둘 다 실패했으면 재시도
        if (s === null && a === null && tries++ < 6) setTimeout(tryLoad, 3000)
      })
    }
    tryLoad()
    return () => { alive = false }
  }, [])

  const now = new Date()
  const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  // 자동방송 + 수동예약 합쳐서 시간순 정렬 → 그룹 묶기
  const autoItems = buildAutoItems(autoSchedule)
  const manualItems = schedules.filter(s => s.active && runsOnDate(s, now))
  const today = groupItems(
    [...autoItems, ...manualItems].sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))
  )

  const nextId = today.find(s => s.scheduled_time >= cur)?.id ?? null

  return (
    <div className="easy-card bg-white flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <CalendarClock size={17} className="text-ds-v3-tts" />
          <h3 className="text-sm font-semibold text-ds-v3-ink">오늘 방송 일정</h3>
          <HelpTip id="todaySchedule" />
        </div>
        <QuickAddBtn onAdded={load} />
      </div>

      {/* 자연어 한 줄로 예약 만들기 — 모달을 채워서 열어주고, 저장은 사람이 확인 후 */}
      <QuickSchedulePhrase onAdded={load} className="mb-3 flex-shrink-0" />

      {/* 일정 목록 */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
        {today.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10">
            <CalendarClock size={32} className="text-ds-v3-ink-3" />
            <p className="text-sm text-ds-v3-ink-2 text-center">오늘 예약된 방송이<br />없습니다</p>
          </div>
        ) : (
          today.map(s => {
            const isNext = s.id === nextId

            // ── 그룹 항목 (1차/2차 묶음) ──────────────────────────
            if (s._isGroup) {
              const td = todayStr()
              const allDone = s._items.every(i => i.last_fired === td)
              const isPast  = s._items.every(i => i.scheduled_time < cur)
              const grayOut = allDone || isPast
              return (
                <div key={s.id}
                  className={`flex items-center gap-2 flex-wrap px-4 py-3 rounded-btn border transition-colors
                    ${grayOut ? 'bg-ds-v3-surface-2 border-ds-v3-line opacity-60'
                      : isNext ? 'bg-ds-v3-tts-bg border-ds-v3-tts/30'
                      : 'bg-white border-ds-v3-line'}`}>
                  {/* 상태 도트 */}
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    grayOut ? 'bg-ds-v3-line' : isNext ? 'bg-ds-v3-tts animate-pulse' : 'bg-ds-v3-line'
                  }`} />

                  {/* 시간 범위 */}
                  <span className={`nums text-base font-semibold flex-shrink-0 ${
                    grayOut ? 'text-ds-v3-ink-2' : isNext ? 'text-ds-v3-tts' : 'text-ds-v3-ink'
                  }`}>
                    {s.scheduled_time}~{s._time_end}
                  </span>

                  {/* 제목 */}
                  <span className={`text-base flex-1 min-w-0 truncate ${grayOut ? 'text-ds-v3-ink-2' : 'text-ds-v3-ink font-semibold'}`}>
                    {s.title}
                  </span>

                  {/* 1차/2차 — 뱃지가 곧 버튼이다. 누르면 **그 차수**가 나간다.
                      전에는 "다음 미완료 차수"를 골라 주는 버튼 하나뿐이라, 2차만 다시 내보내고
                      싶어도 방법이 없었고 "무엇이 나갈지"를 사람이 예측해야 했다. */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {s._items.map((item, idx) => {
                      const done = item.last_fired === td
                      const itemPast = item.scheduled_time < cur
                      const busy = triggering === item.id
                      return (
                        <button key={item.id}
                          onClick={(e) => { e.stopPropagation(); set물음({ 줄: item, 자동인가: false }) }}
                          disabled={!!triggering}
                          title={`${idx + 1}차 지금 방송 (${item.scheduled_time})`}
                          className={`flex items-center gap-0.5 text-sm px-1.5 py-0.5 rounded-full font-semibold border
                            flex-shrink-0 transition-colors disabled:opacity-40
                            ${busy
                              ? 'bg-ds-v3-ink-2 text-white border-ds-v3-ink-2 animate-pulse'
                              : done
                                ? 'bg-ds-v3-surface-2 text-ds-v3-ink-2 border-ds-v3-line hover:border-ds-v3-ink-2 hover:text-ds-v3-ink-2'
                                : itemPast
                                  ? 'bg-ds-v3-surface-2 text-ds-v3-ink-2 border-ds-v3-line hover:border-ds-v3-ink-2 hover:text-ds-v3-ink-2'
                                  : 'bg-ds-v3-tts-bg text-ds-v3-tts border-ds-v3-tts/30 hover:border-ds-v3-ink-2 hover:text-ds-v3-ink-2'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}>
                          {done ? '✓' : ''}{idx + 1}차
                          <Zap size={10} />
                        </button>
                      )
                    })}
                  </div>

                  {/* 상태 뱃지 */}
                  {allDone ? (
                    <span className="text-sm text-ds-v3-ink-2 bg-ds-v3-surface-2 px-2 py-0.5 rounded-full flex-shrink-0">완료</span>
                  ) : isNext ? (
                    <span className="text-sm text-ds-v3-tts bg-ds-v3-tts-bg border border-ds-v3-tts/20 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">다음</span>
                  ) : isPast ? (
                    <span className="text-sm text-ds-v3-ink-2 bg-ds-v3-surface-2 px-2 py-0.5 rounded-full flex-shrink-0">완료</span>
                  ) : (
                    <span className="text-sm text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-2 py-0.5 rounded-full flex-shrink-0">대기</span>
                  )}
                </div>
              )
            }

            // ── 일반 항목 ──────────────────────────────────────────
            const isPast = s.scheduled_time < cur
            return (
              <div key={s.id}
                className={`flex items-center gap-3 flex-wrap px-4 py-3 rounded-btn border transition-colors
                  ${isPast ? 'bg-ds-v3-surface-2 border-ds-v3-line opacity-60'
                    : isNext ? 'bg-ds-v3-tts-bg border-ds-v3-tts/30'
                    : 'bg-white border-ds-v3-line'}`}>
                {/* 상태 도트 */}
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  isPast ? 'bg-ds-v3-line' : isNext ? 'bg-ds-v3-tts animate-pulse' : 'bg-ds-v3-line'
                }`} />

                {/* 시간 */}
                <span className={`nums text-base font-semibold w-14 flex-shrink-0 ${
                  isPast ? 'text-ds-v3-ink-2' : isNext ? 'text-ds-v3-tts' : 'text-ds-v3-ink'
                }`}>
                  {s.scheduled_time}
                </span>

                {/* 아이콘 + 제목 */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <TypeIcon s={s} size={14} />
                  <span className={`text-base truncate ${isPast ? 'text-ds-v3-ink-2' : 'text-ds-v3-ink font-semibold'}`}>
                    {s.title}
                  </span>
                  {s._isAuto && (
                    <span className="text-xs text-ds-v3-tts bg-ds-v3-tts-bg border border-ds-v3-tts/20 px-1.5 py-0.5 rounded-full flex-shrink-0 font-semibold">자동</span>
                  )}
                </div>

                {/* 자동방송: 수동재생 / 수동: 미리듣기 + 수동재생 */}
                {s._isAuto ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); set물음({ 줄: s, 자동인가: true }) }}
                    disabled={!!triggering}
                    className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-btn text-sm font-normal transition-colors disabled:opacity-40
                      ${triggering === s.id
                        ? 'bg-ds-v3-ink-2 text-white animate-pulse'
                        : 'text-ds-v3-ink-2 border border-ds-v3-line hover:text-ds-v3-ink-2 hover:border-ds-v3-ink-2 hover:bg-ds-v3-surface-2'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
                    title="지금 방송"
                  >
                    <Zap size={11} />
                    수동재생
                  </button>
                ) : (
                  <div className="flex items-center flex-wrap gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePreview(s) }}
                      disabled={previewing !== null}
                      className={`p-1.5 rounded-full transition-colors disabled:opacity-40
                        ${previewing === s.id
                          ? 'bg-ds-v3-tts text-white animate-pulse'
                          : 'text-ds-v3-ink-2 hover:text-ds-v3-tts hover:bg-ds-v3-tts-bg'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
                      title="미리 듣기 (이 기기의 기본 출력으로 재생 — 방송 PC 에서는 홀에도 들릴 수 있습니다)"
                    >
                      <Volume2 size={13} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); set물음({ 줄: s, 자동인가: false }) }}
                      disabled={!!triggering}
                      className={`flex items-center gap-1 px-2 py-1 rounded-btn text-sm font-normal transition-colors disabled:opacity-40
                        ${triggering === s.id
                          ? 'bg-ds-v3-ink-2 text-white animate-pulse'
                          : 'text-ds-v3-ink-2 border border-ds-v3-line hover:text-ds-v3-ink-2 hover:border-ds-v3-ink-2 hover:bg-ds-v3-surface-2'} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
                      title="지금 방송 (전체 PC)"
                    >
                      <Zap size={11} />
                      수동재생
                    </button>
                  </div>
                )}

                {/* 상태 뱃지 */}
                {isPast ? (
                  <span className="text-sm text-ds-v3-ink-2 bg-ds-v3-surface-2 px-2 py-0.5 rounded-full flex-shrink-0">완료</span>
                ) : isNext ? (
                  <span className="text-sm text-ds-v3-tts bg-ds-v3-tts-bg border border-ds-v3-tts/20 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">다음</span>
                ) : (
                  <span className="text-sm text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-2 py-0.5 rounded-full flex-shrink-0">대기</span>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 하단 전체 관리 링크 */}
      <button onClick={onNavigate}
        className="mt-3 flex items-center justify-center gap-1.5 text-sm text-ds-v3-ink-2 hover:text-ds-v3-tts transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
        전체 예약 관리
        <CalendarClock size={13} />
      </button>

      {/* 되돌릴 수 없는 것 앞의 확인 한 단계(G-42, 사용자 결정 2026-09-14).
          **홈 화면(`HomeToday`)과 같은 부품·같은 문구**를 쓴다 — 같은 동작이 화면마다
          다르게 묻거나, 한쪽에만 안전장치가 있으면 사람이 규칙을 못 외운다.
          예전에는 이 화면의 단추가 **누르는 즉시** 전관 방송을 발사했다(V③ R19 지적 3). */}
      <ConfirmDialog
        open={!!물음}
        title="지금 내보낼까요?"
        body={물음 ? `「${물음.줄.title || 물음.줄.name || '이 방송'}」 방송을 지금 전관 스피커로 내보냅니다.` : ''}
        경고="한 번 나간 방송은 되돌릴 수 없습니다."
        confirmLabel="지금 방송"
        busy={!!triggering}
        onClose={() => { if (!triggering) set물음(null) }}
        onConfirm={async () => {
          if (triggering) return
          const 이번것 = 물음
          set물음(null)
          // 발사 창구는 예전 그대로다 — 확인을 앞에 세웠을 뿐 실행 규칙은 안 바꿨다.
          // **어느 쪽을 부를지는 `lib/broadcastTrigger` 가 정한다** — 화면 안에 두면
          // 시험이 글자로만 볼 수 있고, 그런 가드가 실제로 못 잡았다(V③ R23 지적 1).
          await 확인뒤발사(이번것, { 자동발사: handleTriggerAuto, 예약발사: handleTriggerManual })
        }}
      />
    </div>
  )
}
