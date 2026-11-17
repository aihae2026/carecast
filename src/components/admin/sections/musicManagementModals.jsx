// 음원/동영상 관리 화면의 모달 3개 — 재생목록 순서 편집, 새 폴더 만들기, 파일 이동.
// (링크 추가 모달은 2026-09-21 걷어냈다 — 영상은 이 PC 에 올린 파일이다.)
//
// 왜 갈라냈나: MusicManagement.jsx 본체가 1198줄이라, 화면을 덮는 창들부터 뗐다.
// 각자 자기 입력 상태만 들고 있고, 저장은 본체가 넘겨준 콜백에 맡긴다.

import { useState, useEffect, useRef } from 'react'
import {
  GripVertical, ChevronRight,
  Folder, FolderPlus, FolderInput,
} from 'lucide-react'
// 껍데기·덮개·닫기 단추는 **한 곳에서 온다**(G-53). 네 창이 각자 그리던 것을 걷었다 —
// 덮개가 `bg-black/40`, 반경 20px, 그림자가 인라인 hex 였고, Escape 로 안 닫혔으며
// 닫기 ✕ 의 타격 크기가 18px 이었다(이 창들에는 바깥 클릭도 없어서 **그것이 유일한 출구**였다).
import ModalShell from '../../shared/ModalShell'
import {
  getFolders,
} from '../../../lib/api'

// ── 재생목록 순서 편집 모달 (BGM + 영상 카테고리 공용) ─────────────
function PlaylistModal({ categoryLabel, items, onSave, onClose }) {
  const [list,     setList]     = useState([...items])
  const [dragOver, setDragOver] = useState(null)
  const dragIdx                 = useRef(null)

  const handleDragStart = (e, idx) => {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (e, idx) => {
    e.preventDefault()
    setDragOver(idx)
  }
  const handleDrop = (e, idx) => {
    e.preventDefault()
    const from = dragIdx.current
    if (from !== null && from !== idx) {
      const next = [...list]
      const [item] = next.splice(from, 1)
      next.splice(idx, 0, item)
      setList(next)
    }
    dragIdx.current = null
    setDragOver(null)
  }

  return (
    <ModalShell open onClose={onClose} width="max-w-md"
      title={`${categoryLabel} 재생목록 순서 편집`}>
      <div className="space-y-4">        <p className="t-sub text-ds-v3-ink-2 -mt-2">맨 위(활성) 항목이 실제 방송에 사용됩니다.</p>

        {list.length === 0 ? (
          <p className="text-sm text-ds-v3-ink-2 text-center py-10">
            이 카테고리에 파일을 업로드하면 자동으로 목록에 등록됩니다.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {list.map((item, idx) => (
              <div
                key={item.audio_file_id}
                draggable
                onDragStart={e => handleDragStart(e, idx)}
                onDragOver={e  => handleDragOver(e, idx)}
                onDrop={e      => handleDrop(e, idx)}
                onDragEnd={() => setDragOver(null)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] border
                            select-none cursor-grab active:cursor-grabbing transition-colors ${
                  dragOver === idx ? 'border-ds-v3-tts bg-ds-v3-tts-bg' : 'border-ds-v3-line bg-ds-v3-bg'
                } ${idx === 0 ? 'ring-1 ring-ds-v3-tts/40' : ''}`}
              >
                <GripVertical size={16} className="text-ds-v3-line-2 flex-shrink-0" />
                <span className="t-sub text-ds-v3-ink-2 w-5 flex-shrink-0 nums text-right">{idx + 1}</span>
                <span className="text-sm text-ds-v3-ink truncate flex-1">{item.original_name}</span>
                {idx === 0 && (
                  <span className="t-sub text-ds-v3-tts bg-ds-v3-tts-bg px-1.5 py-0.5 rounded-full flex-shrink-0 font-semibold">활성</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-ds-v3-line rounded-btn text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => onSave(list)}
            className="flex-1 py-2.5 bg-ds-v3-ink hover:bg-ds-v3-ink text-white rounded-btn text-sm font-semibold btn-press transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ── 새 폴더 만들기 모달 ────────────────────────────────────────────
function NewFolderModal({ onCreate, onClose }) {
  const [name,  setName]  = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('폴더 이름을 입력하세요')
    setBusy(true); setError('')
    try {
      await onCreate(name.trim())
    } catch (err) {
      setError(err.message || '생성 실패')
      setBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} width="max-w-sm"
      title="새 폴더"
      icon={<FolderPlus size={18} />}>
      <div className="space-y-4">        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="t-sub text-ds-v3-warn bg-ds-v3-warn-bg border border-ds-v3-line rounded-btn px-3 py-2">{error}</p>}
          <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="폴더 이름"
            className="w-full border border-ds-v3-line rounded-btn px-3 py-2.5 text-sm text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts" />
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-ds-v3-line rounded-btn text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors">
              취소
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 py-2.5 bg-ds-v3-ink hover:bg-ds-v3-ink text-white rounded-btn text-sm font-semibold btn-press transition-colors disabled:opacity-60">
              {busy ? '만드는 중...' : '만들기'}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  )
}

// ── 파일 이동 모달 — 트리를 못 쓰는 상황(터치 등)을 위한 대체 수단 ────
// 옮기기 창의 제목 — **한 개와 여러 개를 둘 다 말한다.**
// 예전엔 `file.original_name` 하나만 읽어서, 「일괄 옮기기」로 연 창이 제목에
// `"undefined" 이동` 을 띄웠다(V③ R15 지적 3, 2026-09-13).
function 옮길것제목(것) {
  const 여럿 = 것?.여럿
  if (Array.isArray(여럿)) {
    if (여럿.length === 1) return `"${여럿[0]?.original_name ?? ''}" 이동`
    return `${여럿.length}개 이동`
  }
  return `"${것?.original_name ?? ''}" 이동`
}

function MoveFileModal({ category, file, onMove, onClose }) {
  const [navPath, setNavPath] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)

  const currentId = navPath.length ? navPath[navPath.length - 1].id : null

  useEffect(() => {
    let ignore = false
    setLoading(true)
    getFolders(category, currentId)
      .then(data => { if (!ignore) setFolders(data) })
      .catch(() => { if (!ignore) setFolders([]) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [category, currentId])

  const handleMoveHere = async () => {
    setBusy(true)
    try {
      await onMove(currentId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} width="max-w-md"
      title={옮길것제목(file)}
      icon={<FolderInput size={18} />}>
      <div className="space-y-4">
        <div className="flex items-center gap-1 t-sub flex-wrap">
          <button onClick={() => setNavPath([])}
            className={`px-1.5 py-0.5 rounded transition-colors ${navPath.length === 0 ? 'text-ds-v3-tts font-semibold' : 'text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
            카테고리 최상위
          </button>
          {navPath.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-ds-v3-line-2" />
              <button onClick={() => setNavPath(navPath.slice(0, i + 1))}
                className={`px-1.5 py-0.5 rounded transition-colors ${i === navPath.length - 1 ? 'text-ds-v3-tts font-semibold' : 'text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
                {f.name}
              </button>
            </span>
          ))}
        </div>

        <div className="min-h-[120px] max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <p className="text-sm text-ds-v3-ink-2 text-center py-8">불러오는 중...</p>
          ) : folders.length === 0 ? (
            <p className="text-sm text-ds-v3-ink-2 text-center py-8">하위폴더가 없습니다</p>
          ) : (
            folders.map(f => (
              <button key={f.id} onClick={() => setNavPath([...navPath, { id: f.id, name: f.name }])}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] border border-ds-v3-line
                           bg-ds-v3-bg hover:border-ds-v3-tts/40 transition-colors text-left">
                <Folder size={16} className="text-ds-v3-ink-2 flex-shrink-0" />
                <span className="text-sm text-ds-v3-ink truncate">{f.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-ds-v3-line rounded-btn text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink transition-colors">
            취소
          </button>
          <button onClick={handleMoveHere} disabled={busy}
            className="flex-1 py-2.5 bg-ds-v3-ink hover:bg-ds-v3-ink text-white rounded-btn text-sm font-semibold btn-press transition-colors disabled:opacity-60">
            {busy ? '이동 중...' : '여기로 이동'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

export { PlaylistModal, NewFolderModal, MoveFileModal }
