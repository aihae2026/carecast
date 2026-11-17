import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { 연동오류읽기 } from '../../lib/connectionError'

// 연동 오류를 **한 가지 모양으로** 보여준다 (UX-10, 2026-09-11).
//
// 카드마다 `{testResult.error}` 를 날것으로 띄우고 있었다 — `fetch failed`,
// `UND_ERR_CONNECT_TIMEOUT`. 시설 실무자가 읽는 화면인데 무엇을 하면 되는지가 없다.
//
// 규칙은 `lib/connectionError.js` 한 곳에 있다. 여기는 그리기만 한다 —
// 카드가 다섯이라 문구를 화면마다 적으면 곧 갈린다.
//
// **원문은 접어서 남긴다.** 우리가 못 알아본 오류를 사람이 검색이라도 할 수 있어야 하고,
// 조용히 삼키면 원인을 찾는 데 더 오래 걸린다.
export default function ConnectionErrorNote({ 오류, className = '' }) {
  const [폄, 설정] = useState(false)
  if (!오류) return null
  const { 무엇, 다음, 원문 } = 연동오류읽기(오류)

  return (
    <div className={`rounded-[10px] border border-ds-v3-warn-bg bg-ds-v3-warn-bg p-2.5 space-y-1 ${className}`}>
      <div className="flex items-start gap-1.5">
        <AlertCircle size={13} className="text-ds-v3-warn mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ds-v3-warn">{무엇}</p>
          {다음 && <p className="text-[11px] text-ds-v3-ink mt-1 leading-relaxed">{다음}</p>}
        </div>
      </div>
      {원문 && (
        <div className="pl-5">
          <button type="button" onClick={() => 설정(!폄)}
            className="text-[11px] text-ds-v3-ink-2 underline underline-offset-2">
            {폄 ? '원문 접기' : '원문 보기'}
          </button>
          {폄 && (
            <p className="text-[11px] text-ds-v3-ink-2 mt-1 break-all font-mono leading-relaxed">{원문}</p>
          )}
        </div>
      )}
    </div>
  )
}
