// 코칭 브리프 — 구성도·목록(질문/사례/문헌)·요약 그림.
//
// ImprovementProposals.jsx에서 옮겨 왔다(2026-09-05). **옮기기만 했고 동작은 바꾸지 않았다.**
import { useState, useEffect, useCallback } from 'react'
import { apiGet, apiPost } from '../../../lib/api'
// 자연어 학습 통계는 별도 파일이다 — 이 파일이 이미 1200줄이라, 탭이 늘 때마다 여기서
// 자라면 손댈 수 없는 파일이 된다(TECH_DEBT.md 거대 파일 절).
import { RefreshCw, FileText, PenLine, Trash2, Network, Image } from 'lucide-react'
import { briefGet, briefPost, briefPut, briefDelete } from './coachingBriefApi'

// ── 구성도 ─────────────────────────────────────────────────────
// 그림을 이 카드 안에 끼워 넣지 않는다. archify 뷰어는 **자기 폭 상한을 뷰포트 높이에서**
// 정하기 때문에(2026-08-31 실측) 카드 안 iframe에서는 글씨가 8px로 뭉개진다.
// 그래서 여기서는 목록만 보여주고, 실제 그림은 창 전체를 쓰는 상세 화면에서 연다.
// (공개판: 개인 계정에 올려 둔 「밖에서 여는 주소」 링크는 뺐다 — 출시 정리 2026-10-17.)

function ArchCard() {
  const [views, setViews] = useState([])
  const [building, setBuilding] = useState(false)

  const load = () => apiGet('/api/dev/arch').then(d => setViews(d.views || [])).catch(() => setViews([]))
  useEffect(() => { load() }, [])

  const rebuild = async () => {
    setBuilding(true)
    try {
      await apiPost('/api/dev/arch/rebuild', {})
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const st = await apiGet('/api/dev/arch/rebuild/status')
        if (!st.running) break
      }
      await load()
    } catch { /* 실패하면 카드의 '아직 없음' 표시가 그대로 남는다 */ }
    setBuilding(false)
  }

  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Network size={14} className="text-ds-v3-tts" />
        <span className="text-sm font-semibold text-ds-v3-ink">구성도</span>
        <span className="text-xs text-ds-v3-ink-2">그림을 누르면 창 전체로 열립니다</span>
        <button onClick={rebuild} disabled={building}
          className="ml-auto flex items-center gap-1.5 text-xs text-ds-v3-tts hover:underline disabled:opacity-50">
          <RefreshCw size={12} className={building ? 'animate-spin' : ''} />
          {building ? '합본 만드는 중…' : '합본 다시 만들기'}
        </button>
      </div>
      <p className="text-xs text-ds-v3-ink-2 mb-3">
        그림의 소스는 <code>docs/arch/*.json</code>이고 HTML은 산출물입니다 — HTML을 직접 고치지 않습니다.
        합본(시스템 지도)만 여기서 다시 만들 수 있고, 나머지 셋은 터미널에서 <code>/arch-view</code>로 다시 그립니다.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {views.map(v => (
          <a key={v.key} href={`/dev-console/arch/${v.key}`}
            className="block p-3 rounded-btn border border-ds-v3-line bg-ds-v3-bg hover:border-ds-v3-tts/40 btn-press">
            <div className="flex items-center gap-2">
              <Image size={13} className="text-ds-v3-tts flex-shrink-0" />
              <span className="text-sm font-semibold text-ds-v3-ink">{v.title}</span>
              {!v.exists && <span className="text-[10px] text-ds-v3-ink-2 border border-ds-v3-line bg-ds-v3-surface-2 rounded px-1.5">아직 없음</span>}
            </div>
            <p className="text-[11px] text-ds-v3-ink-2 mt-1 leading-relaxed">{v.detail}</p>
            {v.exists && (
              <p className="text-[10px] text-ds-v3-ink-2 mt-1 nums">
                {new Date(v.builtAt).toLocaleString('ko-KR')} · {v.sizeKB}KB
              </p>
            )}
          </a>
        ))}
      </div>
    </div>
  )
}

// ── 코치진 질문 / 유사사례 / 참고문헌 — 같은 모양의 CRUD 리스트 재사용 ──
function CrudList({ title, icon: Icon, apiPath, fields, renderItem, addLabel = '+ 추가' }) {
  const [items, setItems] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => briefGet(apiPath).then(d => setItems(d.items || [])).catch(() => {}), [apiPath])
  useEffect(() => { load() }, [load])

  const resetForm = () => { setForm({}); setEditingId(null); setShowForm(false) }

  const startEdit = (item) => {
    const f = {}
    fields.forEach(fld => { f[fld.key] = item[fld.key] ?? '' })
    setForm(f)
    setEditingId(item.id)
    setShowForm(true)
  }

  const submit = async () => {
    const missing = fields.some(f => f.required && !String(form[f.key] || '').trim())
    if (missing) return
    setSaving(true)
    try {
      if (editingId) await briefPut(`${apiPath}/${editingId}`, form)
      else await briefPost(apiPath, form)
      resetForm()
      await load()
    } catch (err) {
      // 폼은 그대로 둔다(다시 누르면 되게) — 다만 왜 안 됐는지는 말해 준다.
      alert(err.message || '저장하지 못했습니다.')
    }
    finally { setSaving(false) }
  }

  const remove = async (id) => {
    // 사람이 지우기를 눌렀는데 아무 일도 안 나면, 눌린 건지 안 눌린 건지 알 수가 없다.
    // 이 화면의 다른 실패(저장·점수 매기기)와 같은 방식으로 말해 준다.
    try { await briefDelete(`${apiPath}/${id}`); await load() }
    catch (err) { alert(err.message || '지우지 못했습니다.') }
  }

  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-ds-v3-tts" />
        <span className="text-sm font-semibold text-ds-v3-ink">{title}</span>
        <button onClick={() => showForm ? resetForm() : setShowForm(true)} className="ml-auto text-xs text-ds-v3-tts hover:underline">
          {showForm ? '닫기' : addLabel}
        </button>
      </div>

      {showForm && (
        <div className="flex flex-col gap-2 mb-3 p-3 bg-ds-v3-bg rounded-btn">
          {fields.map(fld => fld.type === 'textarea' ? (
            <textarea key={fld.key} rows={2} placeholder={fld.label + (fld.required ? ' *' : '')}
              value={form[fld.key] ?? ''} onChange={e => setForm(f => ({ ...f, [fld.key]: e.target.value }))}
              className="w-full border border-ds-v3-line rounded-btn px-3 py-2 text-sm text-ds-v3-ink bg-white
                         focus:outline-none focus:border-ds-v3-tts resize-none" />
          ) : (
            <input key={fld.key} className="input-base text-sm" placeholder={fld.label + (fld.required ? ' *' : '')}
              value={form[fld.key] ?? ''} onChange={e => setForm(f => ({ ...f, [fld.key]: e.target.value }))} />
          ))}
          <button onClick={submit} disabled={saving}
            className="self-start px-3 py-1.5 rounded-btn text-xs font-semibold bg-ds-v3-ink text-white hover:bg-ds-v3-ink/90 disabled:opacity-60 btn-press">
            {saving ? '저장 중...' : editingId ? '수정 저장' : '추가'}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-xs text-ds-v3-ink-2 text-center py-4">아직 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="group flex items-start gap-2 p-2.5 bg-ds-v3-bg/50 rounded-btn">
              <div className="flex-1 min-w-0">{renderItem(item)}</div>
              <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                <button onClick={() => startEdit(item)} className="p-1 text-ds-v3-ink-2 hover:text-ds-v3-tts"><PenLine size={12} /></button>
                <button onClick={() => remove(item.id)} className="p-1 text-ds-v3-ink-2 hover:text-ds-v3-warn"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 요약 다이어그램 — 코칭 브리프 아티팩트의 검증 파이프라인 흐름도를 그대로 이식 ──
// currentColor를 그대로 써서 라이트/다크 테마에 자동으로 맞는다(DB 박스만 강조색).
function SummaryDiagram() {
  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText size={14} className="text-ds-v3-tts" />
        <span className="text-sm font-semibold text-ds-v3-ink">요약 다이어그램</span>
      </div>
      <figure className="text-ds-v3-ink">
        <svg viewBox="0 0 1090 400" role="img"
          aria-label="carecast-dev 저장소에서 npm run verify가 lint:check, build, test, verify:db 네 단계를 거쳐 결과를 판정하고, 그 결과가 .claude Stop 훅의 세션 종료 게이트와 improvement_proposals DB 기록으로 각각 이어지며, DB 기록은 다음 코칭 브리프 갱신에 반영되는 흐름"
          className="w-full h-auto">
          <defs>
            <marker id="brief-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="currentColor" />
            </marker>
          </defs>

          <g stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.55">
            <line x1="170" y1="170" x2="200" y2="170" />
            <line x1="200" y1="50" x2="200" y2="290" />
            <line x1="410" y1="50" x2="440" y2="50" />
            <line x1="410" y1="130" x2="440" y2="130" />
            <line x1="410" y1="210" x2="440" y2="210" />
            <line x1="410" y1="290" x2="440" y2="290" />
            <line x1="440" y1="50" x2="440" y2="290" />
          </g>
          <g stroke="currentColor" strokeWidth="1.4" fill="none">
            <line x1="200" y1="50" x2="230" y2="50" markerEnd="url(#brief-arrow)" />
            <line x1="200" y1="130" x2="230" y2="130" markerEnd="url(#brief-arrow)" />
            <line x1="200" y1="210" x2="230" y2="210" markerEnd="url(#brief-arrow)" />
            <line x1="200" y1="290" x2="230" y2="290" markerEnd="url(#brief-arrow)" />
            <line x1="440" y1="170" x2="470" y2="170" markerEnd="url(#brief-arrow)" />
            <polyline points="630,170 660,170 660,72 700,72" markerEnd="url(#brief-arrow)" />
            <polyline points="630,170 660,170 660,305 700,305" markerEnd="url(#brief-arrow)" />
            <line x1="900" y1="305" x2="940" y2="305" markerEnd="url(#brief-arrow)" />
          </g>

          <g fill="currentColor" opacity="0.7" fontSize="10.5">
            <text x="185" y="163" textAnchor="middle">실행</text>
            <text x="455" y="163" textAnchor="middle">결과 취합</text>
            <text x="672" y="105" textAnchor="start">실패 시 차단</text>
            <text x="672" y="255" textAnchor="start">기록 저장</text>
            <text x="672" y="267" textAnchor="start">(일자·상태)</text>
            <text x="920" y="298" textAnchor="middle">다음 갱신</text>
          </g>

          <g stroke="currentColor" strokeWidth="1.5" fill="none">
            <rect x="20" y="138" width="150" height="64" rx="9" />
          </g>
          <g fill="currentColor" textAnchor="middle">
            <text x="95" y="166" fontSize="12.5" fontWeight="600">carecast-dev</text>
            <text x="95" y="182" fontSize="10" opacity="0.65">dev 브랜치 · 로컬 파일</text>
          </g>

          <g stroke="currentColor" strokeWidth="1.5" fill="none">
            <rect x="230" y="20" width="180" height="60" rx="9" />
            <rect x="230" y="100" width="180" height="60" rx="9" />
            <rect x="230" y="180" width="180" height="60" rx="9" />
            <rect x="230" y="260" width="180" height="60" rx="9" />
          </g>
          <g fill="currentColor" textAnchor="middle">
            <text x="320" y="46" fontSize="12.5" fontWeight="600">lint:check</text>
            <text x="320" y="62" fontSize="10" opacity="0.65">baseline 대조</text>
            <text x="320" y="126" fontSize="12.5" fontWeight="600">build</text>
            <text x="320" y="142" fontSize="10" opacity="0.65">vite build</text>
            <text x="320" y="206" fontSize="12.5" fontWeight="600">test</text>
            <text x="320" y="222" fontSize="10" opacity="0.65">node --test</text>
            <text x="320" y="286" fontSize="12.5" fontWeight="600">verify:db</text>
            <text x="320" y="302" fontSize="10" opacity="0.65">스키마 대조</text>
          </g>

          <g stroke="currentColor" strokeWidth="1.5" fill="none">
            <rect x="470" y="138" width="160" height="64" rx="9" />
          </g>
          <g fill="currentColor" textAnchor="middle">
            <text x="550" y="166" fontSize="12.5" fontWeight="600">결과 판정</text>
            <text x="550" y="182" fontSize="10" opacity="0.65">PASS / FAIL</text>
          </g>

          <g stroke="currentColor" strokeWidth="1.5" fill="none">
            <rect x="700" y="40" width="180" height="64" rx="9" />
          </g>
          <g fill="currentColor" textAnchor="middle">
            <text x="790" y="68" fontSize="12.5" fontWeight="600">.claude Stop 훅</text>
            <text x="790" y="84" fontSize="10" opacity="0.65">세션 종료 게이트</text>
          </g>

          <g className="text-ds-v3-tts" stroke="currentColor" strokeWidth="1.8" fill="none">
            <rect x="700" y="266" width="200" height="78" rx="9" />
          </g>
          <g className="text-ds-v3-tts" fill="currentColor" textAnchor="middle">
            <text x="800" y="291" fontSize="12.5" fontWeight="700">제안 이력 DB</text>
            <text x="800" y="307" fontSize="10" opacity="0.8">improvement_proposals</text>
            <text x="800" y="323" fontSize="10" opacity="0.8">일자·상태별 저장</text>
          </g>

          <g stroke="currentColor" strokeWidth="1.5" fill="none">
            <rect x="940" y="270" width="130" height="70" rx="9" />
          </g>
          <g fill="currentColor" textAnchor="middle">
            <text x="1005" y="300" fontSize="12.5" fontWeight="600">코칭 브리프</text>
            <text x="1005" y="316" fontSize="10" opacity="0.65">(이 화면)</text>
          </g>
        </svg>
        <figcaption className="text-[11px] text-ds-v3-ink-2 mt-2 leading-relaxed">
          코드 검증 4단계(lint→build→test→DB 스키마)가 하나의 결과로 모이고, 실패하면 세션 종료를 막고,
          발견 사항은 날짜·상태와 함께 DB에 남아 이 화면 갱신에 쓰입니다.
        </figcaption>
      </figure>
    </div>
  )
}

export { ArchCard, CrudList, SummaryDiagram }
