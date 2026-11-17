// 이 PC 의 배경음악을 **지금** 틀고 멈추는 카드 — 홈 서랍 「배경음악」·쉬운 화면 (2026-09-21).
//
// 예전엔 이 자리에 외부 동영상 BGM 판(검색·즐겨찾기·URL·TV 송출)이 있었다. 그 연동을 걷어내며
// (사용자 지시 2026-09-21) 이 PC 에 올린 **방송용·식사용 BGM** 폴더에서
// 랜덤·차례로 트는 카드로 바꿨다. 고르는 두 줄은 예약·흐름 화면과 같은 고르개(BgmSourcePicker)라
// 화면마다 말이 갈리지 않는다.
//
// 트는 길은 `/api/audio/bgm/now`(방송 이력을 남긴다), 멈추는 길은 `/api/audio/bgm/stop`.
// 재생 중인지는 **재생기(MusicPlayer)가 알려 주는 것**을 따른다(local-bgm-started/stopped) —
// 버튼을 눌렀다고 켜진 것으로 치지 않는다.
import { useState, useEffect } from 'react'
import { Play, Square, Volume2 } from 'lucide-react'
import { startBgmNow, stopLocalBGM, getNowPlaying } from '../../lib/api'
import BgmSourcePicker from '../shared/BgmSourcePicker'
import { BGM_DEFAULT_TYPE } from '../../lib/bgmTypes'

export default function LocalBGMCard({ bare = false }) {
  const [bgmType,      setBgmType]      = useState(BGM_DEFAULT_TYPE)
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  // **서버가 아는 지금 상태**를 따른다 — 같은 창의 신호만 들으면 다른 PC(직원 폰)나 화면에 다시 들어온
  // 때 늘 「없음·틀기」로 보여, 틀어져 있는 음악을 이 카드로 못 끈다(Codex 3단계 1회차 Medium).
  // 현장 PC 의 재생바(NowPlayingBar)가 시작·정지를 서버에 보고하고, 여기선 재생바와 같이 3초마다 묻는다.
  useEffect(() => {
    let 살아있음 = true
    const poll = async () => {
      try {
        const np = await getNowPlaying()
        if (!살아있음) return
        setIsPlaying(!!np?.bgm)
        setCurrentTrack(np?.bgm?.title || null)
      } catch { /* 다음 물음이 덮는다 */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { 살아있음 = false; clearInterval(id) }
  }, [])

  useEffect(() => {
    const onStarted = (e) => { setIsPlaying(true); setCurrentTrack(e.detail?.title || null); setError('') }
    const onStopped = () => { setIsPlaying(false); setCurrentTrack(null) }
    window.addEventListener('carecast:local-bgm-started', onStarted)
    window.addEventListener('carecast:local-bgm-stopped', onStopped)
    return () => {
      window.removeEventListener('carecast:local-bgm-started', onStarted)
      window.removeEventListener('carecast:local-bgm-stopped', onStopped)
    }
  }, [])

  const handlePlay = async () => {
    setLoading(true); setError('')
    try { await startBgmNow({ bgm_type: bgmType }) }
    catch (e) { setError(e.message || '배경음악을 틀지 못했습니다.') }
    finally { setLoading(false) }
  }

  const handleStop = async () => {
    setLoading(true); setError('')
    try { await stopLocalBGM() }
    catch (e) { setError(e.message || '배경음악을 멈추지 못했습니다.') }
    finally { setLoading(false) }
  }

  const 칩 = (고름) => `px-3 py-1.5 rounded-full t-sub font-semibold transition-colors ${
    고름 ? 'bg-ds-v3-bgm text-white' : 'bg-ds-v3-surface-2 text-ds-v3-ink-2 hover:bg-white'}`

  return (
    <div className={bare ? 'space-y-3' : 'easy-card bg-white space-y-3'}>
      {!bare && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ds-v3-ink-2 flex-1">배경음악</span>
          {isPlaying && <span className="flex items-center gap-1 text-xs text-ds-v3-bgm font-semibold"><Volume2 size={11} /> 재생 중</span>}
        </div>
      )}

      <BgmSourcePicker value={bgmType} onChange={setBgmType} chipClass={칩} />

      {/* 재생 상태 — 색만이 아니라 글로도 적는다 */}
      <p className={`rounded-[10px] px-3 py-2 t-sub truncate ${
        isPlaying ? 'bg-ds-v3-bgm-bg text-ds-v3-ink' : 'bg-ds-v3-bg text-ds-v3-ink-2'}`}>
        {isPlaying ? `재생 중 — ${currentTrack || '배경음악'}` : '재생 중인 배경음악 없음'}
      </p>

      <button
        onClick={isPlaying ? handleStop : handlePlay}
        disabled={loading}
        className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-btn text-sm font-semibold
                    btn-press disabled:opacity-50 transition-colors min-h-[44px] ${
          isPlaying ? 'bg-ds-v3-ink text-white' : 'bg-ds-v3-bgm text-white'}`}
      >
        {loading ? '처리 중…'
          : isPlaying ? <><Square size={12} fill="currentColor" /> 멈추기</>
          : <><Play size={12} /> 틀기</>}
      </button>

      {error && <p className="t-sub text-ds-v3-warn" role="alert">{error}</p>}
    </div>
  )
}
