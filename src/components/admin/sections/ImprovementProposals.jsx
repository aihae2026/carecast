import { useState, useEffect } from 'react'
import { apiGet, apiPost, apiPut, apiPatch } from '../../../lib/api'
// 자연어 학습 통계는 별도 파일이다 — 이 파일이 이미 1200줄이라, 탭이 늘 때마다 여기서
// 자라면 손댈 수 없는 파일이 된다(TECH_DEBT.md 거대 파일 절).
import NlLearningCard from './NlLearningCard'
import {
  Lightbulb, RefreshCw, Check, ThumbsUp, Ban, Clock, Timer, ExternalLink, Hourglass, Milestone, ListChecks, HelpCircle, BookOpen, Link2, ChevronDown, ChevronUp, History, Zap, Network, Sprout,
} from 'lucide-react'
import { startVerifyRun, fetchVerifyRunStatus, fmtDate } from './coachingBriefApi'
import { ParseStatsCard, RoadmapBar, CheckinLogCard, ActivityLog } from './coachingBriefStatus'
import { ChecklistScoreCard } from './coachingBriefChecklist'
import { ArchCard, CrudList, SummaryDiagram } from './coachingBriefResources'

const STATUSES = ['승인', '추천', '차단', '보류', '구현됨']

const STATUS_STYLE = {
  승인:  { icon: Check,    pill: 'bg-ds-v3-surface-2 text-ds-v3-ink-3 border-ds-v3-line',  active: 'bg-ds-v3-ink-3 text-white' },
  추천:  { icon: ThumbsUp, pill: 'bg-ds-v3-tts-bg text-ds-v3-tts border-ds-v3-ink/20', active: 'bg-ds-v3-ink text-white' },
  차단:  { icon: Ban,      pill: 'bg-ds-v3-warn-bg text-ds-v3-warn border-ds-v3-line',        active: 'bg-ds-v3-warn text-white' },
  보류:  { icon: Clock,    pill: 'bg-ds-v3-bg text-ds-v3-ink-2 border-ds-v3-line',        active: 'bg-ds-v3-ink-2 text-white' },
  구현됨: { icon: Check,   pill: 'bg-ds-v3-bg text-ds-v3-ink-2 border-ds-v3-line',    active: 'bg-ds-v3-ink-3 text-white' },
}

const TABS = [
  { id: 'status',    label: '현황',          icon: Milestone },
  { id: 'checklist', label: '체크리스트·평가', icon: ListChecks },
  { id: 'list',      label: '고도화 리스트',   icon: Lightbulb },
  { id: 'resources', label: '코칭 자료',      icon: BookOpen },
  { id: 'arch',      label: '구성도',         icon: Network },
  { id: 'nl',        label: '자연어 학습',    icon: Sprout },
  { id: 'log',       label: '진행 기록',      icon: History },
]

async function fetchProposals() {
  return apiGet('/api/dev/proposals')
}
async function setStatus(id, status) {
  await apiPatch(`/api/dev/proposals/${id}`, { status })
}
async function dismissQueue(id) {
  await apiPost(`/api/dev/proposals/${id}/dismiss-queue`, {})
}
async function fetchLoopSettings() {
  return apiGet('/api/dev/proposals/loop-settings')
}
async function saveLoopSettings(settings) {
  await apiPut('/api/dev/proposals/loop-settings', settings)
}

function fmtRelative(iso) {
  if (!iso) return '미실행'
  const diffMs = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diffMs / 3600000)
  if (h < 1) return '방금 전'
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE['추천']
  const Icon = s.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${s.pill}`}>
      <Icon size={11} />{status}
    </span>
  )
}

// ── 고도화 리스트 — 자율 점검 루프가 찾아낸 제안들, 날짜별로 그룹핑 ──
function ProposalList({ groups, archivedEntries, loading, busyId, changeStatus, handleDismissQueue }) {
  const [showArchived, setShowArchived] = useState(false)

  if (loading) return <div className="text-sm text-ds-v3-ink-2 text-center py-12">불러오는 중...</div>
  if (groups.length === 0 && archivedEntries.length === 0) {
    return <div className="text-sm text-ds-v3-ink-2 text-center py-12">아직 등록된 제안이 없습니다.</div>
  }

  return (
    <div className="space-y-6">
      {groups.length === 0 && (
        <div className="text-sm text-ds-v3-ink-2 text-center py-8">검토 중이거나 구현 대기 중인 항목이 없습니다.</div>
      )}
      {groups.map(({ date, entries }) => (
        <div key={date}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-ds-v3-tts bg-ds-v3-tts/10 px-2 py-0.5 rounded-full">
              {fmtDate(date)}
            </span>
            <div className="flex-1 h-px bg-ds-v3-line/50" />
          </div>

          <div className="space-y-2">
            {entries.map(item => (
              <div key={item.id} className="group card-base p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-ds-v3-ink">{item.title}</span>
                      {item.category && (
                        <span className="text-[10px] text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-1.5 py-0.5 rounded-full">
                          {item.category}
                        </span>
                      )}
                      {item.queued_at && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-ds-v3-ink-2 bg-ds-v3-ink-2/10 border border-ds-v3-ink-2/30 px-1.5 py-0.5 rounded-full">
                          <Hourglass size={10} /> 구현 대기
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-ds-v3-ink-2 leading-relaxed">{item.description}</p>
                    )}
                  </div>
                  <StatusPill status={item.status} />
                </div>

                <div className="hidden group-hover:flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-ds-v3-line/50">
                  {STATUSES.map(s => (
                    <button
                      key={s}
                      disabled={busyId === item.id}
                      onClick={() => changeStatus(item.id, s)}
                      className={`text-xs px-2.5 py-1 rounded-btn btn-press transition-colors disabled:opacity-50 ${
                        item.status === s ? STATUS_STYLE[s].active : 'bg-ds-v3-bg text-ds-v3-ink-2 hover:text-ds-v3-ink'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {item.queued_at && (
                    <button
                      disabled={busyId === item.id}
                      onClick={() => handleDismissQueue(item.id)}
                      className="ml-auto text-xs px-2.5 py-1 rounded-btn btn-press transition-colors disabled:opacity-50
                                 bg-ds-v3-bg text-ds-v3-ink-2 hover:text-ds-v3-ink"
                    >
                      구현 완료 처리
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {archivedEntries.length > 0 && (
        <div className="pt-2 border-t border-ds-v3-line/50">
          <button onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-1 text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts">
            {showArchived ? <ChevronUp size={12} /> : <ChevronDown size={12} />} 결정된 항목 보기 ({archivedEntries.length})
          </button>
          {showArchived && (
            <div className="space-y-2 mt-2">
              {archivedEntries.map(item => (
                <div key={item.id} className="group card-base p-3 opacity-80">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-semibold text-ds-v3-ink">{item.title}</span>
                        {item.category && (
                          <span className="text-[10px] text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-1.5 py-0.5 rounded-full">
                            {item.category}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-ds-v3-ink-2 leading-relaxed">{item.description}</p>
                      )}
                    </div>
                    <StatusPill status={item.status} />
                  </div>
                  <div className="hidden group-hover:flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-ds-v3-line/50">
                    {STATUSES.map(s => (
                      <button
                        key={s}
                        disabled={busyId === item.id}
                        onClick={() => changeStatus(item.id, s)}
                        className={`text-xs px-2.5 py-1 rounded-btn btn-press transition-colors disabled:opacity-50 ${
                          item.status === s ? STATUS_STYLE[s].active : 'bg-ds-v3-bg text-ds-v3-ink-2 hover:text-ds-v3-ink'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ImprovementProposals() {
  const [activeTab, setActiveTab] = useState('status')

  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const [loopEnabled, setLoopEnabled] = useState(false)
  const [loopCadence, setLoopCadence] = useState('daily')
  const [loopLastRun, setLoopLastRun] = useState(null)

  const [checking, setChecking] = useState(false)
  const [checkProgress, setCheckProgress] = useState(0)
  const [checkinRefreshTick, setCheckinRefreshTick] = useState(0)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchProposals()
      setGroups(data.groups || [])
    } catch (e) { console.error('[고도화제안] 목록 불러오기 실패:', e.message) }  // 목록만 비고 화면은 뜬다
    finally { setLoading(false) }
  }

  const loadLoopSettings = async () => {
    try {
      const s = await fetchLoopSettings()
      setLoopEnabled(s.enabled)
      setLoopCadence(s.cadence)
      setLoopLastRun(s.lastRun)
    } catch (e) { console.error('[고도화제안] 자동점검 설정 불러오기 실패:', e.message) }  // 기본값 그대로 둔다
  }

  useEffect(() => { load(); loadLoopSettings() }, [])

  const handleRunVerifyNow = async () => {
    setChecking(true)
    setCheckProgress(0)
    try {
      await startVerifyRun()
      let running = true
      while (running) {
        await new Promise(r => setTimeout(r, 600))
        const s = await fetchVerifyRunStatus()
        setCheckProgress(s.pct || 0)
        running = s.running
      }
      setCheckinRefreshTick(t => t + 1)
    } catch (e) { console.error('[고도화제안] 점검 진행 조회 실패:', e.message) }  // 진행률만 못 보여준다
    finally { setChecking(false); setCheckProgress(0) }
  }

  const changeStatus = async (id, status) => {
    setBusyId(id)
    try {
      try { await setStatus(id, status) }
      catch (e) { console.error('[고도화] 상태 변경 실패:', e.message) }
      await load()
    } finally { setBusyId(null) }
  }

  const handleDismissQueue = async (id) => {
    setBusyId(id)
    try {
      try { await dismissQueue(id) }
      catch (e) { console.error('[고도화] 구현대기 해제 실패:', e.message) }
      await load()
    } finally { setBusyId(null) }
  }

  const queuedCount = groups.reduce((n, g) => n + g.entries.filter(e => e.queued_at).length, 0)

  // 기본 목록엔 "아직 판단이 필요한 것"(추천)과 "승인됐지만 아직 구현 안 된 것"(구현 대기)만 남긴다.
  // 차단/보류/구현됨(그리고 구현 완료 처리된 승인 건)은 결정이 끝난 기록이라 매번 안 띄우고 접어둔다.
  const isActiveEntry = e => e.status === '추천' || (e.status === '승인' && e.queued_at)
  const activeGroups = groups
    .map(g => ({ ...g, entries: g.entries.filter(isActiveEntry) }))
    .filter(g => g.entries.length > 0)
  const archivedEntries = groups.flatMap(g => g.entries).filter(e => !isActiveEntry(e))

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Lightbulb size={18} className="text-ds-v3-tts" />
        <h2 className="text-lg font-semibold text-ds-v3-ink">고도화 제안</h2>
        <button onClick={load}
          className="ml-auto flex items-center gap-1.5 text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press px-2 py-1 rounded-btn">
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>
      <p className="text-xs text-ds-v3-ink-2 mb-4">
        자율 점검 루프가 찾아낸 개선 아이디어와, 본선 준비를 위한 코칭 브리프 전체 내용을 모았습니다.
      </p>

      {/* 탭이 일곱이 되면서 max-w-4xl에 한 줄로는 안 들어간다. 가로 스크롤 대신 줄을 바꾼다 */}
      <div className="flex flex-wrap gap-2 border-b border-ds-v3-line mb-5">
        {TABS.map(t => {
          const Icon = t.icon
          const isActive = activeTab === t.id
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-normal rounded-t-[8px] border-b-2 transition-colors
                ${isActive ? 'border-ds-v3-tts text-ds-v3-tts bg-ds-v3-tts-bg' : 'border-transparent text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-ds-v3-bg'}`}>
              <Icon size={14} />
              {t.label}
              {t.id === 'list' && queuedCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] font-semibold text-ds-v3-ink-2 bg-ds-v3-ink-2/10 border border-ds-v3-ink-2/30 px-1.5 py-0.5 rounded-full">
                  <Hourglass size={9} /> {queuedCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {activeTab === 'status' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <button onClick={() => { const next = !loopEnabled; setLoopEnabled(next); saveLoopSettings({ enabled: next, cadence: loopCadence }).catch(() => {}) }}
              title="켜두면 설정한 주기마다 자동으로 기능 점검을 하고, 발견한 개선 아이디어를 고도화 리스트에 추가합니다"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-normal transition-colors btn-press ${
                loopEnabled ? 'bg-ds-v3-ink text-white border-ds-v3-ink' : 'bg-ds-v3-bg text-ds-v3-ink-2 border-ds-v3-line'}`}>
              <Timer size={12} /> 자율점검 {loopEnabled ? '켜짐' : '꺼짐'}
            </button>

            {loopEnabled && (
              <select value={loopCadence}
                onChange={e => { const next = e.target.value; setLoopCadence(next); saveLoopSettings({ enabled: loopEnabled, cadence: next }).catch(() => {}) }}
                className="input-base py-1 px-2 w-auto">
                <option value="daily">매일</option>
                <option value="weekly">주 1회</option>
              </select>
            )}

            <span className="text-ds-v3-ink-2">마지막 점검: {fmtRelative(loopLastRun)}</span>

            <button onClick={handleRunVerifyNow} disabled={checking}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-ds-v3-line bg-white text-ds-v3-ink
                         hover:border-ds-v3-tts hover:text-ds-v3-tts transition-colors disabled:opacity-60 btn-press ml-auto">
              <Zap size={12} /> {checking ? `점검 중 ${checkProgress}%` : '지금 점검'}
            </button>
          </div>
          {checking && (
            <div className="w-full h-1 bg-ds-v3-bg rounded-full overflow-hidden -mt-2">
              <div className="h-full bg-ds-v3-tts transition-all duration-300" style={{ width: `${checkProgress}%` }} />
            </div>
          )}
          <RoadmapBar />
          <ParseStatsCard />
          <CheckinLogCard refreshSignal={checkinRefreshTick} />
        </div>
      )}

      {activeTab === 'checklist' && <ChecklistScoreCard />}

      {activeTab === 'arch' && <ArchCard />}

      {activeTab === 'list' && (
        <ProposalList groups={activeGroups} archivedEntries={archivedEntries} loading={loading} busyId={busyId}
          changeStatus={changeStatus} handleDismissQueue={handleDismissQueue} />
      )}

      {activeTab === 'resources' && (
        <div className="space-y-4">
          <CrudList title="코치진 질문" icon={HelpCircle} apiPath="/questions"
            fields={[
              { key: 'question', label: '질문', required: true },
              { key: 'context', label: '배경(선택)' },
            ]}
            renderItem={item => (
              <div>
                <div className="text-xs font-normal text-ds-v3-ink">{item.question}</div>
                {item.context && <div className="text-[11px] text-ds-v3-ink-2 mt-0.5">{item.context}</div>}
              </div>
            )} />

          <CrudList title="유사 사례" icon={BookOpen} apiPath="/cases"
            fields={[
              { key: 'title', label: '제목', required: true },
              { key: 'description', label: '설명', required: true, type: 'textarea' },
              { key: 'source_label', label: '출처 이름(선택)' },
              { key: 'source_url', label: '출처 URL(선택)' },
            ]}
            renderItem={item => (
              <div>
                <div className="text-xs font-semibold text-ds-v3-ink">{item.title}</div>
                <div className="text-[11px] text-ds-v3-ink-2 mt-0.5 leading-relaxed">{item.description}</div>
                {item.source_label && (
                  item.source_url
                    ? <a href={item.source_url} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-ds-v3-tts hover:underline mt-1 inline-flex items-center gap-0.5">
                        <ExternalLink size={9} /> {item.source_label}
                      </a>
                    : <div className="text-[10px] text-ds-v3-ink-2 mt-1">{item.source_label}</div>
                )}
              </div>
            )} />

          <SummaryDiagram />

          <CrudList title="참고문헌" icon={Link2} apiPath="/references"
            fields={[
              { key: 'label', label: '이름', required: true },
              { key: 'detail', label: '설명(선택)' },
              { key: 'url', label: 'URL(선택)' },
            ]}
            renderItem={item => (
              <div className="text-xs">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer"
                    className="font-normal text-ds-v3-tts hover:underline inline-flex items-center gap-1">
                    {item.label} <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="font-normal text-ds-v3-ink">{item.label}</span>
                )}
                {item.detail && <span className="text-ds-v3-ink-2"> · {item.detail}</span>}
              </div>
            )} />
        </div>
      )}

      {activeTab === 'nl' && <NlLearningCard />}

      {activeTab === 'log' && <ActivityLog />}
    </div>
  )
}
