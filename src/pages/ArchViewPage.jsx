import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { apiGet, apiPost } from '../lib/api'

// /dev-console/arch/:view — 구성도 한 장을 창 전체로 본다.
//
// 왜 창 전체인가: archify 뷰어는 **자기 폭 상한을 뷰포트 높이에서 정한다.** 카드 안에 작게
// 끼워 넣으면 글씨가 8px로 뭉개진다(2026-08-31 실측). 그래서 상세 화면은 머리줄 하나만 두고
// 나머지를 전부 그림에 준다.
export default function ArchViewPage() {
  const { view } = useParams()
  const navigate = useNavigate()
  const [meta, setMeta] = useState(null)
  const [building, setBuilding] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => apiGet('/api/dev/arch')
    .then(d => setMeta((d.views || []).find(v => v.key === view) || null))
    .catch(() => setMeta(null)), [view])

  useEffect(() => { load() }, [load])

  const rebuild = async () => {
    setBuilding(true)
    try {
      await apiPost('/api/dev/arch/rebuild', {})
      // 다 만들 때까지 상태를 물어본다 — 합본은 2MB라 몇 초 걸린다.
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const st = await apiGet('/api/dev/arch/rebuild/status')
        if (!st.running) break
      }
      await load()
      setReloadKey(k => k + 1)   // iframe을 새로 읽게 한다(같은 주소라 캐시가 남는다)
    } catch { /* 실패하면 아래 안내가 그대로 보인다 */ }
    setBuilding(false)
  }

  const src = `/api/dev/arch/${view}/html?v=${reloadKey}`

  return (
    <div className="h-screen flex flex-col bg-ds-v3-bg">
      <div className="flex items-center gap-3 px-4 h-12 flex-shrink-0 bg-white border-b border-ds-v3-line">
        <button onClick={() => navigate('/dev-console')}
          className="flex items-center gap-1.5 text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press">
          <ArrowLeft size={15} /> 개발 콘솔
        </button>
        <span className="text-sm font-semibold text-ds-v3-ink">{meta?.title || view}</span>
        {meta?.builtAt && (
          <span className="text-[11px] text-ds-v3-ink-2 nums">
            {new Date(meta.builtAt).toLocaleString('ko-KR')} · {meta.sizeKB}KB
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {meta?.buildable && (
            <button onClick={rebuild} disabled={building}
              className="flex items-center gap-1.5 text-xs text-ds-v3-tts hover:underline disabled:opacity-50">
              <RefreshCw size={13} className={building ? 'animate-spin' : ''} />
              {building ? '만드는 중…' : '다시 만들기'}
            </button>
          )}
          <a href={`/api/dev/arch/${view}/html`} target="_blank" rel="noopener"
            className="flex items-center gap-1.5 text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts">
            <ExternalLink size={13} /> 새 탭에서 열기
          </a>
        </div>
      </div>

      {meta && !meta.exists ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-ds-v3-ink">아직 만들지 않은 그림입니다.</p>
          <p className="text-xs text-ds-v3-ink-2 max-w-md leading-relaxed">
            {meta.buildable
              ? '"다시 만들기"를 누르면 지금 코드와 코칭 브리프로 새로 만듭니다.'
              : '이 그림은 docs/arch/*.json을 소스로 archify가 그립니다 — 터미널에서 /arch-view로 다시 그리세요.'}
          </p>
        </div>
      ) : (
        <iframe key={reloadKey} src={src} title={meta?.title || view}
          className="flex-1 w-full border-0 bg-white" />
      )}
    </div>
  )
}
