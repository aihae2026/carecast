import { useState, useEffect } from 'react'
import { Music2, Square } from 'lucide-react'
import { stopBroadcast as stopBroadcastAPI } from '../../lib/api'

export default function BroadcastBGMStatus() {
  const [bgm, setBgm] = useState(null)  // null | { title }

  useEffect(() => {
    const onStart = (e) => {
      const title = e.detail?.title || 'BGM'
      setBgm({ title })
    }
    const onStop = () => setBgm(null)

    window.addEventListener('carecast:broadcast-bgm-start', onStart)
    // 표시는 "멎었다" 통지를 듣는다(명령/통지 분리, td09 §2) — 명령은 소리 주인만 듣는다
    window.addEventListener('carecast:broadcast-bgm-stopped', onStop)
    return () => {
      window.removeEventListener('carecast:broadcast-bgm-start', onStart)
      window.removeEventListener('carecast:broadcast-bgm-stopped', onStop)
    }
  }, [])

  // 정지는 하나의 길(2026-09-02 사용자 결정 — 아래 바와 동일한 전체 정지). 예전엔
  // BGM 정지 명령만 쐈다 — ① 로컬 BGM 은 안 멎고(§6 위반)
  // ② 수동 곡 복원이 깨어나 "정지했는데 음악이 다시 나는" 구멍이 여기 하나 더 있었다.
  // 화면 이벤트 먼저, 서버는 뒤(레드 검증 2026-09-02) — 서버가 행이어도 소리는 즉시 멎는다.
  const handleStop = async () => {
    setBgm(null)
    window.dispatchEvent(new CustomEvent('carecast:stop-broadcast'))
    try { await stopBroadcastAPI() } catch (e) { console.error('[BGM카드] 정지 요청 실패:', e.message) }
  }

  if (!bgm) return null

  return (
    <div className="card-base flex items-center gap-3 py-2.5 px-3
                    border-ds-v3-tts/30 bg-ds-v3-tts/5">
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ds-v3-tts opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-ds-v3-tts" />
      </span>
      <Music2 size={14} className="text-ds-v3-tts flex-shrink-0" />
      <span className="text-sm text-ds-v3-ink flex-1 truncate font-normal">{bgm.title}</span>
      <button
        onClick={handleStop}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-normal
                   bg-ds-v3-warn-bg text-ds-v3-warn hover:bg-ds-v3-warn-bg active:bg-ds-v3-warn
                   transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
      >
        <Square size={10} fill="currentColor" />
        BGM 정지
      </button>
    </div>
  )
}
