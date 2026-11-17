import { useState, useEffect } from 'react'
import { Star, Radio } from 'lucide-react'
import { apiGet, ttsBroadcast } from '../../lib/api'

// 서버 미연결 시 표시할 더미 데이터
const fallback = [
  { id: 1, label: '식사 안내',    content: '어르신 여러분, 식사 시간이 되었습니다. 식당으로 이동해 주시기 바랍니다.',   voice: 'ko-KR-SunHiNeural' },
  { id: 2, label: '약 복용',      content: '약 복용 시간입니다. 담당 간호사에게 약을 받아 복용해 주시기 바랍니다.',     voice: 'ko-KR-SunHiNeural' },
  { id: 3, label: '프로그램 시작',content: '오늘의 프로그램이 시작됩니다. 1층 강당으로 모여 주시기 바랍니다.',          voice: 'ko-KR-SunHiNeural' },
  { id: 4, label: '보호자 안내',  content: '보호자분께서 방문하셨습니다. 1층 접수처로 나와 주시기 바랍니다.',           voice: 'ko-KR-SunHiNeural' },
]

// 카드 ⑤ 즐겨찾기 — DB 연동 (서버 미연결 시 더미 표시)
export default function Favorites() {
  const [favorites,    setFavorites]    = useState(fallback)
  const [broadcasting, setBroadcasting] = useState(null) // 방송 중인 항목 id
  const [error,        setError]        = useState('')

  useEffect(() => {
    apiGet('/api/favorites')
      .then(data => { if (data.length > 0) setFavorites(data) })
      .catch(() => {}) // 서버 미연결 시 fallback 유지
  }, [])

  const handleBroadcast = async (fav) => {
    setBroadcasting(fav.id)
    setError('')
    try {
      await ttsBroadcast({ text: fav.content, voice: fav.voice || 'ko-KR-SunHiNeural', target: '전체' })
    } catch (e) {
      setError(e.message)
    } finally {
      setBroadcasting(null)
    }
  }

  return (
    <div className="easy-card bg-ds-v3-warn-bg">
      <div className="flex items-center gap-2 mb-3">
        <Star size={15} className="text-ds-v3-warn" />
        <h3 className="text-xs font-semibold text-ds-v3-ink-2 uppercase tracking-widest">즐겨찾기</h3>
      </div>

      <p className="text-xs text-ds-v3-ink-2 mb-4">자주 사용하는 방송을 즉시 실행합니다.</p>

      {error && <p className="text-xs text-ds-v3-warn mb-2 line-clamp-2">{error}</p>}

      <div className="flex-1 grid grid-cols-2 gap-2.5">
        {favorites.slice(0, 4).map(fav => (
          <button
            key={fav.id}
            onClick={() => handleBroadcast(fav)}
            disabled={broadcasting !== null}
            className={`flex flex-col items-center justify-center gap-2 p-3 bg-white
                       border rounded-btn text-center btn-press transition-colors group
                       disabled:opacity-60 disabled:cursor-not-allowed
                       ${broadcasting === fav.id
                         ? 'border-ds-v3-warn/40 bg-ds-v3-warn-bg'
                         : 'border-ds-v3-warn/15 hover:border-ds-v3-warn/40 hover:bg-ds-v3-warn-bg'
                       } min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
          >
            <Radio size={18} className={`transition-colors ${
              broadcasting === fav.id
                ? 'text-ds-v3-warn animate-pulse'
                : 'text-ds-v3-warn/50 group-hover:text-ds-v3-warn'
            }`} />
            <span className="text-xs font-normal text-ds-v3-ink leading-tight">{fav.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
