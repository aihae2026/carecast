// 코칭 브리프 — 체크리스트와 평가 점수.
//
// ImprovementProposals.jsx에서 옮겨 왔다(2026-09-05). **옮기기만 했고 동작은 바꾸지 않았다.**
//
// ⚠ **server/test/coaching-brief.test.js가 이 파일을 본다.** "문항 상수가 코드로 되살아나지
// 않았는지"를 `assert.doesNotMatch`로 보는데, 그건 **대상이 없는 파일에서도 통과하는**
// 부정 단언이다. 이 코드를 또 옮길 일이 생기면 그 가드의 경로도 **같은 커밋에서** 옮겨야
// 한다. 안 그러면 아무 신호 없이 감시가 사라진다.
import { useState, useEffect } from 'react'

// 자연어 학습 통계는 별도 파일이다 — 이 파일이 이미 1200줄이라, 탭이 늘 때마다 여기서
// 자라면 손댈 수 없는 파일이 된다(TECH_DEBT.md 거대 파일 절).
import { PenLine, ListChecks, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { briefGet, briefPost, briefPut, briefDelete } from './coachingBriefApi'

// **문항은 이제 DB가 단일 출처다**(마이그레이션 0019, 고도화 제안 #23).
// **체크리스트 문항은 DB가 단일 출처다**(마이그레이션 0019, 고도화 제안 #23).
// 예전엔 여기 CHECKLIST_SETS 상수에 주차별 문항이 박혀 있어서, 새 주차 문항이 오면 개발자가
// 코드를 고쳐야 했고 문항 수도 7개로 묶여 있었다. 이제 화면에서 넣고 고치고 지운다.
// 기존 주차의 문항은 서버가 1회 시딩했다(server/domain/checklistItems.js의 SEED_SETS).
// 평가 점수 5항목은 그대로 코드 상수다 — 심사 기준이라 주차마다 바뀌지 않는다.

const SCORE_ITEMS = {
  importance: '문제의 중요성',
  ai_need: 'AI 솔루션 필요성',
  feasibility: '실현 가능성',
  tech_ready: '기술적 준비도',
  impact: '임팩트',
}

// 평가 점수 한 항목 — 드래그 중에는 로컬 상태만, 손을 떼거나 메모칸을 벗어날 때 저장.
// 주차가 바뀌면 부모가 key를 바꿔 이 컴포넌트를 통째로 다시 마운트시킨다(서버 값으로 리셋).
function ScoreRow({ itemKey, label, value, note, onSave }) {
  const [localValue, setLocalValue] = useState(value)
  const [localNote, setLocalNote] = useState(note)

  const commit = () => onSave(itemKey, Number(localValue), localNote)

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-ds-v3-ink w-28 flex-shrink-0">{label}</span>
        <input type="range" min="0" max="5" step="0.5" value={localValue}
          onChange={e => setLocalValue(e.target.value)}
          onMouseUp={commit} onTouchEnd={commit}
          className="flex-1" />
        <span className="text-xs font-semibold text-ds-v3-tts w-8 text-right flex-shrink-0">{localValue}</span>
      </div>
      <textarea className="input-base w-full resize-y" rows={2} placeholder="근거 메모(선택)"
        value={localNote} onChange={e => setLocalNote(e.target.value)} onBlur={commit} />
    </div>
  )
}

// ── 체크리스트(7항목) + 평가·점수(5항목) — 주차 단위, 항목 변경 시 즉시 저장 ──
function ChecklistScoreCard() {
  const [current, setCurrent] = useState(null)
  const [entries, setEntries] = useState([])
  const [pastWeeks, setPastWeeks] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyDetail, setHistoryDetail] = useState({})
  const [items,        setItems]        = useState([])   // 그 주차의 문항(DB가 출처)
  const [editingItems, setEditingItems] = useState(false) // 문항 편집 관문 — 잠금이 기본
  const [newItemText,  setNewItemText]  = useState('')
  const [newWeekLabel, setNewWeekLabel] = useState('')
  const [showNewWeek, setShowNewWeek] = useState(false)

  const load = () => briefGet('/checklist').then(d => {
    setCurrent(d.current)
    setEntries(d.entries || [])
    setPastWeeks(d.pastWeeks || [])
    setItems(d.items || [])
  }).catch(() => {})
  useEffect(() => { load() }, [])

  const checklistEntry = (key) => entries.find(e => e.kind === 'checklist' && e.item_key === String(key))
  const checklistValue = (key) => checklistEntry(key)?.value === 1
  const scoreEntry = (key) => entries.find(e => e.kind === 'score' && e.item_key === key)

  const toggleChecklist = async (key) => {
    if (!current) return
    const nextVal = checklistValue(key) ? 0 : 1
    const note = checklistEntry(key)?.note ?? ''
    setEntries(es => [...es.filter(e => !(e.kind === 'checklist' && e.item_key === String(key))),
      { week_id: current.id, kind: 'checklist', item_key: String(key), value: nextVal, note }])
    try { await briefPut('/checklist/entries', { week_id: current.id, kind: 'checklist', item_key: String(key), value: nextVal, note }) }
    catch { /* 실패 시 다음 새로고침에서 원복됨 */ }
  }

  const saveScore = async (key, value, note) => {
    if (!current) return
    setEntries(es => [...es.filter(e => !(e.kind === 'score' && e.item_key === key)),
      { week_id: current.id, kind: 'score', item_key: key, value, note }])
    try { await briefPut('/checklist/entries', { week_id: current.id, kind: 'score', item_key: key, value, note }) }
    catch { /* 실패 시 다음 새로고침에서 원복됨 */ }
  }

  // ── 문항 편집 (고도화 제안 #23) ──────────────────────────────
  // **열쇠(item_key)는 화면에서 절대 안 만든다.** 서버가 "지금까지 쓴 적 없는 번호"를 준다 —
  // 값(체크·메모)이 그 열쇠로 붙어 있어서, 재사용하면 새 문항이 옛 체크를 물려받는다.
  const addItem = async () => {
    const label = newItemText.trim()
    if (!label || !current) return
    try {
      await briefPost(`/checklist/${current.id}/items`, { label })
      setNewItemText('')
      load()
    } catch (err) { alert(err.message) }
  }

  // 문구만 고친다. 값은 열쇠에 붙어 있으므로 체크·메모가 그대로 따라온다.
  const saveItemLabel = async (itemKey, label, before) => {
    const text = (label || '').trim()
    if (!current || !text || text === before) return
    try { await briefPut(`/checklist/${current.id}/items/${itemKey}`, { label: text }) }
    catch (err) { alert(err.message) }
    load()
  }

  const moveItem = async (from, to) => {
    if (!current || to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setItems(next)   // 화면은 먼저 움직이고, 서버에는 순서만 보낸다(열쇠는 안 바뀐다)
    try { await briefPut(`/checklist/${current.id}/items-order`, { keys: next.map(i => i.item_key) }) }
    catch (err) { alert(err.message); load() }
  }

  const removeItem = async (item) => {
    if (!current) return
    if (!confirm(`"${item.label}"

이 문항과 **그 문항의 체크·메모를 함께** 지웁니다. 되돌릴 수 없습니다.`)) return
    try { await briefDelete(`/checklist/${current.id}/items/${item.item_key}`) }
    catch (err) { alert(err.message) }
    load()
  }

  const startNewWeek = async () => {
    if (!newWeekLabel.trim()) return
    try {
      await briefPost('/checklist/new-week', { week_label: newWeekLabel.trim() })
      setNewWeekLabel('')
      setShowNewWeek(false)
      await load()
    } catch { /* 실패 시 폼 유지 */ }
  }

  const loadHistoryDetail = async (weekId) => {
    if (historyDetail[weekId]) return
    try {
      const d = await briefGet(`/checklist/${weekId}`)
      setHistoryDetail(h => ({ ...h, [weekId]: d }))
    } catch { /* 조회 실패 시 무시 */ }
  }

  // 문항 목록은 지금 보고 있는 주차의 것이다(주차마다 다르다).
  const checkedCount = items.filter(it => checklistValue(it.item_key)).length

  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <ListChecks size={14} className="text-ds-v3-tts" />
        <span className="text-sm font-semibold text-ds-v3-ink">체크리스트 · 평가 점수</span>
        {current && <span className="text-xs text-ds-v3-ink-2">— {current.week_label}</span>}
        <span className="text-xs text-ds-v3-ink-2">({checkedCount}/{items.length})</span>
        <button onClick={() => setShowNewWeek(v => !v)} className="ml-auto text-xs text-ds-v3-tts hover:underline">
          새 주차 시작
        </button>
      </div>

      {showNewWeek && (
        <div className="flex items-center gap-2 mb-3 p-2.5 bg-ds-v3-bg rounded-btn">
          <input className="input-base text-sm flex-1" placeholder="예: 2주차"
            value={newWeekLabel} onChange={e => setNewWeekLabel(e.target.value)} />
          <button onClick={startNewWeek} disabled={!newWeekLabel.trim()}
            className="px-3 py-1.5 rounded-btn text-xs font-semibold bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 disabled:opacity-60 btn-press">
            시작
          </button>
        </div>
      )}

      {current && (
        <>
          {/* 문항 머리 — 「문항 편집」은 순서편집기의 잠금 관문과 같은 결이다(평소 읽기 전용) */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-ds-v3-ink-2">
              {editingItems ? '문항을 고치거나 지울 수 있습니다' : `문항 ${items.length}개`}
            </span>
            <button onClick={() => setEditingItems(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full
                         bg-ds-v3-tts-bg text-ds-v3-tts transition-all cursor-pointer hover:scale-105 active:scale-95">
              <PenLine size={12} /> {editingItems ? '편집 마침' : '문항 편집'}
            </button>
          </div>

          <div className="space-y-2 mb-4">
            {items.length === 0 && (
              <p className="text-xs text-ds-v3-ink-2 py-2">
                아직 문항이 없습니다. 「문항 편집」에서 이번 주차 문항을 넣어주세요.
              </p>
            )}
            {items.map((it, idx) => {
              const note = checklistEntry(it.item_key)?.note
              return (
                <div key={it.item_key} className="flex items-start gap-2 text-xs py-0.5">
                  <input type="checkbox" checked={checklistValue(it.item_key)}
                    onChange={() => toggleChecklist(it.item_key)}
                    disabled={editingItems}
                    className="mt-0.5 flex-shrink-0" />
                  {editingItems ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <input defaultValue={it.label}
                        onBlur={e => saveItemLabel(it.item_key, e.target.value, it.label)}
                        className="input-base flex-1 py-1" />
                      <button onClick={() => moveItem(idx, idx - 1)} disabled={idx === 0}
                        aria-label="위로" title="위로"
                        className="p-1 rounded text-ds-v3-ink-2 hover:text-ds-v3-tts disabled:opacity-25">▲</button>
                      <button onClick={() => moveItem(idx, idx + 1)} disabled={idx === items.length - 1}
                        aria-label="아래로" title="아래로"
                        className="p-1 rounded text-ds-v3-ink-2 hover:text-ds-v3-tts disabled:opacity-25">▼</button>
                      <button onClick={() => removeItem(it)} aria-label="문항 삭제" title="문항 삭제"
                        className="p-1 rounded text-ds-v3-ink-2 hover:text-ds-v3-warn">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ) : (
                    <span>
                      <span className={checklistValue(it.item_key) ? 'text-ds-v3-ink' : 'text-ds-v3-ink-2'}>{it.label}</span>
                      {note && <span className="block text-[10px] text-ds-v3-ink-2 italic mt-0.5">{note}</span>}
                    </span>
                  )}
                </div>
              )
            })}

            {editingItems && (
              <div className="flex items-center gap-1.5 pt-1">
                <input value={newItemText} onChange={e => setNewItemText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addItem() }}
                  placeholder="새 문항을 적고 Enter"
                  className="input-base flex-1 py-1" />
                <button onClick={addItem}
                  className="px-3 py-1.5 text-xs font-semibold rounded-full bg-ds-v3-ink text-white btn-press">
                  추가
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3 pt-3 border-t border-ds-v3-line/50">
            <div className="text-xs font-semibold text-ds-v3-ink-2 mb-1">평가 및 점수 — 심사 기준 자체 평가 (5점 만점)</div>
            {Object.entries(SCORE_ITEMS).map(([key, label]) => {
              const e = scoreEntry(key)
              return (
                <ScoreRow key={`${key}-${current.id}`} itemKey={key} label={label}
                  value={e?.value ?? 0} note={e?.note ?? ''} onSave={saveScore} />
              )
            })}
          </div>
        </>
      )}

      {pastWeeks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ds-v3-line/50">
          <button onClick={() => setShowHistory(v => !v)} className="flex items-center gap-1 text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts">
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />} 지난 주차 보기 ({pastWeeks.length})
          </button>
          {showHistory && (
            <div className="mt-2 space-y-2">
              {pastWeeks.map(w => (
                <div key={w.id} className="text-xs">
                  <button onClick={() => loadHistoryDetail(w.id)} className="text-ds-v3-ink font-normal hover:text-ds-v3-tts">
                    {w.week_label} ({new Date(w.started_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })})
                  </button>
                  {historyDetail[w.id] && (
                    <div className="mt-1 pl-3 text-ds-v3-ink-2 space-y-0.5">
                      <div>체크 {historyDetail[w.id].entries.filter(x => x.kind === 'checklist' && x.value === 1).length}/{(historyDetail[w.id].items || []).length}</div>
                      {Object.entries(SCORE_ITEMS).map(([k, lbl]) => {
                        const se = historyDetail[w.id].entries.find(x => x.kind === 'score' && x.item_key === k)
                        return se ? <div key={k}>{lbl}: {se.value}</div> : null
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { ChecklistScoreCard }
