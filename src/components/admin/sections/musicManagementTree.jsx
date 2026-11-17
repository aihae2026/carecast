// 음원/동영상 관리 화면의 왼쪽 트리 부품과 참조 뱃지 — 상태를 갖지 않고 받은 것만 그린다.
//
// 왜 갈라냈나: MusicManagement.jsx 본체에서 트리 노드·그룹 헤더·뱃지를 떼어냈다.
// 뱃지 문구를 짓는 referenceBadge는 순수 함수라 musicManagementConst.js에 있다.

import { useState } from 'react'
import {
  ChevronRight, ChevronDown, Folder, Tag, Pencil, FolderPlus, Info,
} from 'lucide-react'

const pathEqual = (a, b) => a.length === b.length && a.every((p, i) => p.id === b[i].id)

function Badge({ tone, children }) {
  const cls = tone === 'active' ? 'bg-ds-v3-surface-2 text-ds-v3-ink-3 border-ds-v3-line'
    : tone === 'warn' ? 'bg-ds-v3-surface-2 text-ds-v3-ink-2 border-ds-v3-line'
    : 'bg-ds-v3-bg text-ds-v3-ink-2 border-ds-v3-line'
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border ${cls}`}>
      <Tag size={10} />
      {children}
    </span>
  )
}

// ── 트리의 폴더/카테고리 노드 (재귀) ─────────────────────────────
// folderId=null이면 카테고리 최상위, 아니면 실제 content_folders 폴더.
// 두 경우 모두 자식 조회는 동일하게 getFolders(category, folderId)라서 하나의 컴포넌트로 처리한다.
function TreeNode({
  category, folderId, name, ancestorPath, depth, icon,
  expanded, childrenMap, loadingKeys, selection, onToggle, onSelect, onDropFile,
  badge = null,   // 이름 옆 작은 글자(예: 배경음악 기본 폴더의 「기본」) — 색만으로 뜻을 전하지 않는다
  onRename = null, // 있으면 이름 바꾸기 단추(연필) — 사용자 지시 2026-09-22 「폴더 이름 수정할 수 있게」
}) {
  const key = `${category}:${folderId ?? 'root'}`
  const isExpanded = expanded.has(key)
  const kids = childrenMap[key]
  const thisPath = folderId === null ? [] : [...ancestorPath, { id: folderId, name }]
  const isSelected = selection.cat === category && pathEqual(selection.path, thisPath)

  return (
    <div>
      <div
        className={`flex items-center gap-1 pr-1.5 py-1 rounded-md cursor-pointer transition-colors ${
          isSelected ? 'bg-ds-v3-tts-bg text-ds-v3-tts font-semibold' : 'text-ds-v3-ink hover:bg-ds-v3-bg'
        }`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => onSelect(category, thisPath)}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); onDropFile(e, category, folderId) }}
      >
        {/* 16×16 이었다 — 누를 자리의 최소치(WCAG 2.2 AA 24×24)에 못 미친다(UX-42). */}
        <button
          onClick={e => { e.stopPropagation(); onToggle(key, category, folderId) }}
          className="w-6 h-6 flex items-center justify-center text-ds-v3-ink-2 hover:text-ds-v3-ink flex-shrink-0"
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {icon}
        <span className="text-sm truncate">{name}</span>
        {badge && <span className="t-sub text-ds-v3-ink-3 flex-shrink-0">{badge}</span>}
        {onRename && folderId != null && (
          <button type="button" aria-label={`「${name}」 이름 바꾸기`} title="이름 바꾸기"
            onClick={e => { e.stopPropagation(); onRename({ id: folderId, name, category }) }}
            className="ml-auto w-6 h-6 flex-shrink-0 flex items-center justify-center rounded text-ds-v3-ink-3 hover:text-ds-v3-ink hover:bg-white">
            <Pencil size={12} />
          </button>
        )}
      </div>
      {isExpanded && (
        <div>
          {loadingKeys.has(key) ? (
            <p className="text-xs text-ds-v3-ink-2" style={{ paddingLeft: (depth + 1) * 14 + 20 }}>불러오는 중...</p>
          ) : !kids || kids.length === 0 ? (
            <p className="text-xs text-ds-v3-ink-2" style={{ paddingLeft: (depth + 1) * 14 + 20 }}>하위폴더 없음</p>
          ) : (
            kids.map(f => (
              <TreeNode
                key={f.id}
                category={f.category} folderId={f.id} name={f.name}
                ancestorPath={thisPath} depth={depth + 1}
                icon={<Folder size={13} className="text-ds-v3-ink-2 flex-shrink-0" />}
                expanded={expanded} childrenMap={childrenMap} loadingKeys={loadingKeys}
                selection={selection} onToggle={onToggle} onSelect={onSelect} onDropFile={onDropFile}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// 그룹 헤더(내 폴더/오디오/영상) — 화살표는 펼침/접힘만, 라벨 클릭은 그 그룹 자체를 선택
// (misc/misc-audio/misc-video 최상위로 이동, 거기서 바로 새 폴더를 만들 수 있음)
// hint — 그룹이 무엇인지 한 줄(펼쳤을 때). onAdd — 있으면 「+」 새 폴더 단추(사용자 지시 2026-09-22 「추가도 가능하게」).
function GroupHeader({ title, icon, expanded, isSelected, onToggle, onSelect, children, hint = null, onAdd = null }) {
  // 설명은 (i) 를 눌렀을 때만 — 늘 펼쳐 두니 지저분했다(사용자 지시 2026-09-22)
  const [설명, set설명] = useState(false)
  return (
    <div>
      <div className={`flex items-center gap-1 pr-1 rounded-md transition-colors ${
        isSelected ? 'bg-ds-v3-tts-bg text-ds-v3-tts font-semibold' : 'hover:bg-ds-v3-bg'
      }`}>
        <button onClick={onToggle} className="p-1.5 flex-shrink-0">
          {expanded ? <ChevronDown size={13} className="text-ds-v3-ink-2" /> : <ChevronRight size={13} className="text-ds-v3-ink-2" />}
        </button>
        {/* 높이가 20px 이었다 — 24×24 미달(UX-42). 글자 크기는 그대로 두고 누를 자리만 넓힌다. */}
        <button onClick={onSelect} className="flex items-center gap-1.5 py-1.5 min-h-[24px] flex-1 text-left min-w-0">
          {icon}
          <span className="text-sm font-semibold text-ds-v3-ink-2 uppercase tracking-wide truncate">{title}</span>
        </button>
        {hint && (
          <button type="button" onClick={() => set설명(v => !v)} aria-label={`${title} 설명`} aria-expanded={설명} title="설명 보기"
            className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded hover:bg-white ${설명 ? 'text-ds-v3-ink' : 'text-ds-v3-ink-3 hover:text-ds-v3-ink'}`}>
            <Info size={14} />
          </button>
        )}
        {onAdd && (
          <button type="button" onClick={onAdd} aria-label={`${title}에 새 폴더`} title="새 폴더"
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-white">
            <FolderPlus size={14} />
          </button>
        )}
      </div>
      {설명 && hint && <p className="t-sub text-ds-v3-ink-2 mx-1 mb-1 px-2 py-1.5 rounded-md bg-ds-v3-bg leading-snug">{hint}</p>}
      {expanded && <div className="mt-0.5">{children}</div>}
    </div>
  )
}

export { Badge, TreeNode, GroupHeader }
