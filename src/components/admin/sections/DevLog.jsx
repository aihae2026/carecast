import { useState, useEffect } from 'react'
import { apiGet, apiPut, apiDelete } from '../../../lib/api'
import { BookOpen, Pencil, Trash2, Check, X, RefreshCw } from 'lucide-react'

const PAGE_SIZE = 50

async function fetchLog(offset = 0) {
  return apiGet(`/api/devlog?limit=${PAGE_SIZE}&offset=${offset}`)
}

// 페이지 경계가 날짜 한가운데를 가를 수 있으므로, 같은 날짜 그룹은 합쳐서 이어붙인다.
// git log는 최신순이고 Map은 삽입 순서를 유지하므로 날짜 정렬은 그대로 보존된다.
function mergeGroups(prev, next) {
  const map = new Map(prev.map(g => [g.date, g.entries]))
  next.forEach(({ date, entries }) => {
    map.set(date, map.has(date) ? [...map.get(date), ...entries] : entries)
  })
  // 불러오는 사이에 새 커밋이 생기면 같은 hash가 두 번 올 수 있어 중복을 걸러낸다.
  const seen = new Set()
  return [...map]
    .map(([date, entries]) => ({
      date,
      entries: entries.filter(e => !seen.has(e.hash) && seen.add(e.hash)),
    }))
    .filter(g => g.entries.length > 0)
}
async function saveNote(hash, note) {
  await apiPut(`/api/devlog/${hash}`, { note })
}
async function hideEntry(hash) {
  await apiDelete(`/api/devlog/${hash}`)
}

function fmtDate(d) {
  const [y, m, dd] = d.split('-')
  return `${y}.${m}.${dd}`
}

function cleanSubject(s) {
  return s.replace(/^(feat|fix|chore|refactor|docs|style|test|build|ci|perf|revert)(\(.+?\))?:\s*/i, '')
}

const CATEGORY_STYLE = {
  feat:     { label: 'feat',     cls: 'bg-ds-v3-tts-bg text-ds-v3-tts' },
  fix:      { label: 'fix',      cls: 'bg-ds-v3-warn-bg text-ds-v3-warn' },
  refactor: { label: 'refactor', cls: 'bg-ds-v3-flow-bg text-ds-v3-flow' },
  docs:     { label: 'docs',     cls: 'bg-ds-v3-bg text-ds-v3-ink-2' },
  chore:    { label: 'chore',    cls: 'bg-ds-v3-bg text-ds-v3-ink-2' },
  style:    { label: 'style',    cls: 'bg-ds-v3-surface-2 text-ds-v3-ink-2' },
  test:     { label: 'test',     cls: 'bg-ds-v3-surface-2 text-ds-v3-ink-3' },
  build:    { label: 'build',    cls: 'bg-ds-v3-bg text-ds-v3-ink-2' },
  ci:       { label: 'ci',       cls: 'bg-ds-v3-bg text-ds-v3-ink-2' },
  perf:     { label: 'perf',     cls: 'bg-ds-v3-surface-2 text-ds-v3-ink-2' },
  revert:   { label: 'revert',   cls: 'bg-ds-v3-warn-bg text-ds-v3-warn' },
}

// 필터 pill이 11개 태그 전부 한 줄에 뒤섞이면 정신없어서, 성격이 비슷한 것끼리 묶어 보여준다.
const CATEGORY_GROUPS = [
  { label: '기능',    keys: ['feat', 'fix', 'perf', 'revert'] },
  { label: '품질',    keys: ['refactor', 'test', 'style'] },
  { label: '기타',    keys: ['docs', 'chore', 'build', 'ci'] },
]

// 같은 날짜 안에서도 배지가 뒤섞이지 않도록, 목록 표시 순서를 위 그룹 순서로 고정한다
// (커밋 시각 순서가 아니라 카테고리 순서로 정렬 — 같은 카테고리끼리는 원래 순서 유지)
const CATEGORY_ORDER = CATEGORY_GROUPS.flatMap(g => g.keys)
function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category)
  return i === -1 ? CATEGORY_ORDER.length : i
}

export default function DevLog() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // hash
  const [editVal, setEditVal] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(null) // null = 전체
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchLog(0)
      setGroups(data.groups || [])
      setHasMore(!!data.hasMore)
      setNextOffset(data.nextOffset ?? 0)
    } catch (e) { console.error('[DevLog] 기록 불러오기 실패:', e.message) }  // 목록은 비워 두고 화면은 그대로 뜬다
    finally { setLoading(false) }
  }

  // 과거 기록을 이어서 불러온다. 편집/숨김 후의 load()는 첫 페이지로 되돌아간다.
  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const data = await fetchLog(nextOffset)
      setGroups(prev => mergeGroups(prev, data.groups || []))
      setHasMore(!!data.hasMore)
      setNextOffset(data.nextOffset ?? nextOffset)
    } catch {
      // 실패해도 지금까지 불러온 목록은 그대로 두고, 버튼을 살려 다시 시도할 수 있게 한다
    }
    finally { setLoadingMore(false) }
  }

  useEffect(() => { load() }, [])

  const usedCategories = [...new Set(groups.flatMap(g => g.entries.map(e => e.category).filter(Boolean)))]

  // 카테고리 필터 적용 후 항목이 하나도 남지 않는 날짜 그룹은 헤더까지 통째로 숨긴다.
  // (렌더링 시점에 groups를 두 번 필터링하면 로직이 갈라질 수 있으므로 이 한 곳에서만 필터한다)
  const visibleGroups = groups
    .map(g => ({
      ...g,
      entries: g.entries
        .filter(e => !categoryFilter || e.category === categoryFilter)
        .slice()
        .sort((a, b) => categoryRank(a.category) - categoryRank(b.category)),
    }))
    .filter(g => g.entries.length > 0)

  const startEdit = (entry) => {
    setEditing(entry.hash)
    setEditVal(cleanSubject(entry.subject))
  }

  const confirmEdit = async (hash) => {
    // 예전에는 응답을 확인하지 않아 저장 실패가 조용히 넘어갔다. 화면 흐름은 그대로 두되
    // (닫고 다시 불러온다) 실패한 사실은 남긴다 — 다시 열면 옛 메모가 그대로일 것이다.
    try { await saveNote(hash, editVal.trim()) }
    catch (e) { console.error('[개발일지] 메모 저장 실패:', e.message) }
    setEditing(null)
    load()
  }

  const confirmHide = async (hash) => {
    try { await hideEntry(hash) }
    catch (e) { console.error('[개발일지] 항목 숨김 실패:', e.message) }
    load()
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={18} className="text-ds-v3-tts" />
        <h2 className="text-lg font-semibold text-ds-v3-ink">개발 일지</h2>
        <button onClick={load}
          className="ml-auto flex items-center gap-1.5 text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press px-2 py-1 rounded-btn">
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {usedCategories.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={() => setCategoryFilter(null)}
            className={`text-xs px-2.5 py-1 rounded-full font-normal transition-colors ${
              !categoryFilter ? 'bg-ds-v3-ink text-white' : 'bg-ds-v3-bg text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
            전체
          </button>
          {CATEGORY_GROUPS.map(group => {
            const cats = group.keys.filter(k => usedCategories.includes(k))
            if (cats.length === 0) return null
            return (
              <div key={group.label} className="flex items-center gap-1.5 pl-3 border-l border-ds-v3-line">
                <span className="text-[10px] font-semibold text-ds-v3-ink-2">{group.label}</span>
                {cats.map(cat => {
                  const style = CATEGORY_STYLE[cat] ?? { label: cat, cls: 'bg-ds-v3-bg text-ds-v3-ink-2' }
                  return (
                    <button key={cat} onClick={() => setCategoryFilter(cat)}
                      className={`text-xs px-2.5 py-1 rounded-full font-normal transition-colors ${
                        categoryFilter === cat ? 'bg-ds-v3-ink text-white' : `${style.cls} hover:opacity-75`}`}>
                      {style.label}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {loading && (
        <div className="text-sm text-ds-v3-ink-2 text-center py-12">불러오는 중...</div>
      )}

      {!loading && groups.length === 0 && (
        <div className="text-sm text-ds-v3-ink-2 text-center py-12">커밋 내역이 없습니다.</div>
      )}

      <div className="space-y-6">
        {visibleGroups.map(({ date, entries }) => (
          <div key={date}>
            {/* 날짜 헤더 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-ds-v3-tts bg-ds-v3-tts/10 px-2 py-0.5 rounded-full">
                {fmtDate(date)}
              </span>
              <div className="flex-1 h-px bg-ds-v3-line/50" />
            </div>

            {/* 항목들 */}
            <div className="space-y-1 pl-1">
              {entries.map(entry => (
                <div key={entry.hash} className="group flex items-start gap-2 py-1">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ds-v3-line flex-shrink-0" />

                  {editing === entry.hash ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') confirmEdit(entry.hash)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        className="flex-1 text-sm border border-ds-v3-tts rounded px-2 py-0.5 focus:outline-none bg-white"
                      />
                      <button onClick={() => confirmEdit(entry.hash)}
                        className="p-1 text-ds-v3-ink-3 hover:text-ds-v3-ink-3 btn-press">
                        <Check size={13} />
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="p-1 text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      {entry.category && CATEGORY_STYLE[entry.category] && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${CATEGORY_STYLE[entry.category].cls}`}>
                          {CATEGORY_STYLE[entry.category].label}
                        </span>
                      )}
                      <span className={`text-sm text-ds-v3-ink flex-1 ${entry.edited ? 'font-normal' : ''}`}>
                        {cleanSubject(entry.subject)}
                      </span>
                      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => startEdit(entry)}
                          className="p-1 text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press">
                          <Pencil size={11} />
                        </button>
                        <button onClick={() => confirmHide(entry.hash)}
                          className="p-1 text-ds-v3-ink-2 hover:text-ds-v3-warn btn-press">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!loading && hasMore && (
        <div className="pt-6 text-center">
          <button onClick={loadMore} disabled={loadingMore}
            className="text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press px-3 py-1.5 rounded-btn border border-ds-v3-line disabled:opacity-50">
            {loadingMore ? '불러오는 중...' : '이전 기록 더 보기'}
          </button>
        </div>
      )}
    </div>
  )
}
