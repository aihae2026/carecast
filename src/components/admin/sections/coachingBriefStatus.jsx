// 코칭 브리프 — 현황 카드들(파싱 통계 · 4주 로드맵 · 실행 기록 · 진행 기록).
//
// ImprovementProposals.jsx에서 옮겨 왔다(2026-09-05). **옮기기만 했고 동작은 바꾸지 않았다.**
// CHECKIN_RESULTS를 여기 둔 이유: CheckinLogCard와 ActivityLog **둘 다** 쓴다. 갈라놓으면
// 그 객체를 export 해야 하고, 그러면 Fast Refresh 벽에 부딪혀 .js 파일이 하나 더 는다.
import { useState, useEffect } from 'react'
import { apiGet } from '../../../lib/api'

// 자연어 학습 통계는 별도 파일이다 — 이 파일이 이미 1200줄이라, 탭이 늘 때마다 여기서
// 자라면 손댈 수 없는 파일이 된다(TECH_DEBT.md 거대 파일 절).
import { RefreshCw, Milestone, Activity, ChevronDown, ChevronUp, Wand2 } from 'lucide-react'
import { briefGet, briefPost, briefPut, fmtDate } from './coachingBriefApi'

const CHECKIN_RESULTS = {
  auto_verified:    { label: '자동검증', cls: 'bg-ds-v3-surface-2 text-ds-v3-ink-3 border-ds-v3-line' },
  fixed:             { label: '수정완료', cls: 'bg-ds-v3-tts-bg text-ds-v3-tts border-ds-v3-tts/20' },
  manual_confirmed:  { label: '수동확인', cls: 'bg-ds-v3-surface-2 text-ds-v3-ink-2 border-ds-v3-line' },
  failed:            { label: '실패',     cls: 'bg-ds-v3-warn-bg text-ds-v3-warn border-ds-v3-line' },
}

const ROADMAP_STATUS_ORDER = ['upcoming', 'active', 'done']

// ── 4주 로드맵 — 칸을 클릭하면 upcoming → active → done 순으로 상태 순환 ──
// 자연어 예약이 실제로 얼마나 읽히는지. 목표는 90%.
// 성공률 분모에는 "파서가 더 잘하면 줄어드는 실패"만 넣는다 — Gemini가 503으로 죽은 날의
// 숫자가 파서 품질처럼 보이면 개선 여부를 판단할 수 없다(services/parseFailures.js).
const PARSE_TARGET = 90

const FAILURE_LABEL = {
  no_datetime:  'AI가 날짜·시간을 못 찾음',
  time_missing: '규칙 파서가 시각을 못 읽음',
  ai_error:     'AI 서버 오류',
  past_date:    '이미 지난 날짜로 읽음',
}

// 이 카드만 쓰는 조회다 — 부모에 두면 부모→자식→부모 순환 import가 된다.
async function fetchParseStats() {
  return apiGet('/api/schedule-drafts/stats')
}

function ParseStatsCard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchParseStats().then(setStats).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading || !stats) return null

  const rate = stats.successRate
  const measured = rate !== null
  const met = measured && rate >= PARSE_TARGET

  return (
    <div className="bg-white border border-ds-v3-line rounded-[12px] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wand2 size={14} className="text-ds-v3-tts" />
        <span className="text-sm font-semibold text-ds-v3-ink">자연어 예약 성공률</span>
        <span className="text-[10px] text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-1.5 py-0.5 rounded-full">
          목표 {PARSE_TARGET}%
        </span>
      </div>

      {!measured ? (
        <p className="text-xs text-ds-v3-ink-2">
          아직 기록이 없습니다 — 자연어로 예약을 만들기 시작하면 여기에 쌓입니다.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-2 mb-2">
            <span className={`text-3xl font-semibold ${met ? 'text-ds-v3-ink-3' : 'text-ds-v3-ink-2'}`}>{rate}%</span>
            <span className="text-xs text-ds-v3-ink-2 mb-1.5">
              읽어낸 것 {stats.parsed}건 / 못 읽은 것 {stats.qualityFailed}건
            </span>
          </div>
          <div className="w-full h-1.5 bg-ds-v3-bg rounded-full overflow-hidden mb-3">
            <div className={`h-full transition-all ${met ? 'bg-ds-v3-ink-3' : 'bg-ds-v3-ink-2'}`}
                 style={{ width: `${Math.min(100, rate)}%` }} />
          </div>
        </>
      )}

      {/* AI 서버 오류는 성공률과 따로 본다 — 파서 품질이 아니라 외부 사정이다 */}
      {stats.systemFailed > 0 && (
        <p className="text-[11px] text-ds-v3-ink-2 mb-2">
          이 밖에 AI 서버 오류 {stats.systemFailed}건 (성공률 계산에서 제외됩니다)
        </p>
      )}

      {stats.recent?.length > 0 && (
        <div className="border-t border-ds-v3-line pt-2.5 mt-1 space-y-1">
          <p className="text-[10px] font-semibold text-ds-v3-ink-2 uppercase tracking-wider mb-1.5">
            최근 못 읽은 문장
          </p>
          {stats.recent.map(r => (
            <div key={r.id} className="flex items-start gap-2 text-[11px]">
              <span className="text-ds-v3-ink flex-1 break-all">"{r.raw_input}"</span>
              <span className="text-ds-v3-ink-2 flex-shrink-0">
                {FAILURE_LABEL[r.failure_reason] || r.failure_reason}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RoadmapBar() {
  const [weeks, setWeeks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    briefGet('/roadmap').then(d => setWeeks(d.weeks || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const cycle = async (idx) => {
    const cur = weeks[idx].status
    const nextStatus = ROADMAP_STATUS_ORDER[(ROADMAP_STATUS_ORDER.indexOf(cur) + 1) % ROADMAP_STATUS_ORDER.length]
    const next = weeks.map((w, i) => i === idx ? { ...w, status: nextStatus } : w)
    setWeeks(next)
    try { await briefPut('/roadmap', { weeks: next }) } catch { /* 실패 시 다음 새로고침에서 원복됨 */ }
  }

  if (loading || weeks.length === 0) return null

  return (
    <div className="card-base p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Milestone size={14} className="text-ds-v3-tts" />
        <span className="text-sm font-semibold text-ds-v3-ink">4주 로드맵 (8.24 ~ 9.18)</span>
        <span className="text-[11px] text-ds-v3-ink-2 ml-auto">칸을 클릭하면 진행 상태가 바뀝니다</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {weeks.map((w, i) => (
          <button key={w.label} onClick={() => cycle(i)}
            className={`text-left p-3 rounded-btn border transition-colors btn-press ${
              w.status === 'done' ? 'bg-ds-v3-surface-2 border-ds-v3-line' :
              w.status === 'active' ? 'bg-ds-v3-tts-bg border-ds-v3-tts' :
              'bg-ds-v3-bg border-ds-v3-line'
            }`}>
            <div className="text-xs font-semibold text-ds-v3-ink mb-0.5">
              {w.label}
              {w.dateRange && <span className="font-normal text-ds-v3-ink-2"> · {w.dateRange}</span>}
            </div>
            <div className="text-xs text-ds-v3-ink mb-1">{w.title}</div>
            <div className={`flex items-center gap-1 text-[10px] font-semibold ${
              w.status === 'done' ? 'text-ds-v3-ink-3' : w.status === 'active' ? 'text-ds-v3-tts' : 'text-ds-v3-ink-2'
            }`}>
              {w.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-ds-v3-tts animate-pulse" />}
              {w.status === 'done' ? '완료' : w.status === 'active' ? '진행 중' : '예정'}
            </div>
            {w.detail && <div className="text-[10px] text-ds-v3-ink-2 mt-1 leading-snug">{w.detail}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 실행 기록 — 기능 점검 ────────────────────────────────────
function CheckinLogCard({ refreshSignal }) {
  const [latest, setLatest] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ item_name: '', result: 'auto_verified', note: '' })
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  const load = () => briefGet('/checkins').then(d => setLatest(d.latest || [])).catch(() => {})
  useEffect(() => { load() }, [refreshSignal])

  const submit = async () => {
    if (!form.item_name.trim()) return
    setSaving(true)
    try {
      await briefPost('/checkins', form)
      setForm({ item_name: '', result: 'auto_verified', note: '' })
      setShowForm(false)
      await load()
    } catch { /* 저장 실패 시 폼 유지 */ }
    finally { setSaving(false) }
  }

  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-2">
        <Activity size={14} className="text-ds-v3-tts" />
        <span className="text-sm font-semibold text-ds-v3-ink">실행 기록 — 기능 점검</span>
        <button onClick={() => setShowForm(v => !v)} className="ml-auto text-xs text-ds-v3-tts hover:underline">
          {showForm ? '닫기' : '+ 기록 추가'}
        </button>
      </div>
      <p className="text-xs text-ds-v3-ink-2 mb-3">언제 무엇을 어떤 방법으로 확인했는지 남깁니다. 같은 항목을 다시 기록하면 최신 결과가 위로 올라옵니다.</p>

      {showForm && (
        <div className="flex flex-col gap-2 mb-3 p-3 bg-ds-v3-bg rounded-btn">
          <input className="input-base text-sm" placeholder="점검 항목 (예: 예약 등록·조회·반복설정)"
            value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} />
          <div className="flex gap-2 flex-wrap">
            {Object.entries(CHECKIN_RESULTS).map(([k, v]) => (
              <button key={k} onClick={() => setForm(f => ({ ...f, result: k }))}
                className={`text-xs px-2.5 py-1 rounded-btn border btn-press transition-colors ${form.result === k ? v.cls : 'bg-white text-ds-v3-ink-2 border-ds-v3-line'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <input className="input-base text-sm" placeholder="메모(선택)"
            value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          <button onClick={submit} disabled={saving || !form.item_name.trim()}
            className="self-start px-3 py-1.5 rounded-btn text-xs font-semibold bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 disabled:opacity-60 btn-press">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      )}

      {latest.length === 0 ? (
        <div className="text-xs text-ds-v3-ink-2 text-center py-4">아직 기록이 없습니다.</div>
      ) : (
        <div className="space-y-1.5">
          {latest.map(item => {
            const hasNote = !!item.note?.trim()
            const isOpen = expandedId === item.id
            return (
              <div key={item.id} className="border-b border-ds-v3-line/40 last:border-0">
                <button
                  type="button"
                  onClick={() => hasNote && setExpandedId(isOpen ? null : item.id)}
                  className={`w-full flex items-center gap-2 text-xs py-1.5 text-left ${hasNote ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span className="text-ds-v3-ink font-normal flex-1 min-w-0 truncate">{item.item_name}</span>
                  <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-semibold flex-shrink-0 ${CHECKIN_RESULTS[item.result]?.cls ?? ''}`}>
                    {CHECKIN_RESULTS[item.result]?.label ?? item.result}
                  </span>
                  <span className="text-ds-v3-ink-2 text-[10px] flex-shrink-0">
                    {new Date(item.checked_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                  </span>
                  {hasNote && (isOpen ? <ChevronUp size={12} className="text-ds-v3-ink-2 flex-shrink-0" /> : <ChevronDown size={12} className="text-ds-v3-ink-2 flex-shrink-0" />)}
                </button>
                {isOpen && hasNote && (
                  <p className="text-[11px] text-ds-v3-ink-2 whitespace-pre-wrap pb-2 pl-0.5">{item.note}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 진행 기록 — checkin_runs 전체 이력을 날짜별로 모아서, 매일 쌓인 기록을 훑어볼 수 있게 ──
function ActivityLog() {
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => briefGet('/checkins').then(d => setAll(d.all || [])).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const groups = {}
  all.forEach(e => {
    const date = e.checked_at.slice(0, 10)
    if (!groups[date]) groups[date] = []
    groups[date].push(e)
  })
  const dates = Object.keys(groups).sort().reverse()

  if (loading) return <div className="text-sm text-ds-v3-ink-2 text-center py-12">불러오는 중...</div>
  if (dates.length === 0) return <div className="text-sm text-ds-v3-ink-2 text-center py-12">아직 기록이 없습니다.</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ds-v3-ink-2">"현황" 탭의 실행 기록에 새 항목을 추가할 때마다 여기 날짜별로 쌓입니다.</p>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press px-2 py-1 rounded-btn">
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>
      {dates.map(date => (
        <div key={date}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-ds-v3-tts bg-ds-v3-tts/10 px-2 py-0.5 rounded-full">
              {fmtDate(date)}
            </span>
            <div className="flex-1 h-px bg-ds-v3-line/50" />
          </div>
          <div className="space-y-1.5">
            {groups[date].map(item => (
              <div key={item.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-ds-v3-line/40 last:border-0">
                <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-semibold flex-shrink-0 ${CHECKIN_RESULTS[item.result]?.cls ?? ''}`}>
                  {CHECKIN_RESULTS[item.result]?.label ?? item.result}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-ds-v3-ink font-normal">{item.item_name}</span>
                  {item.note && <div className="text-[11px] text-ds-v3-ink-2 mt-0.5">{item.note}</div>}
                </div>
                <span className="text-ds-v3-ink-2 text-[10px] flex-shrink-0">
                  {new Date(item.checked_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export { ParseStatsCard, RoadmapBar, CheckinLogCard, ActivityLog }
