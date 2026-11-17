// 방송 뒤에 **소리 없이** 띄우는 배경 영상 전체화면(아침·점심·저녁). App.jsx에서 갈라져 나왔다.
//
// 2026-09-21: 예전엔 외부 서비스의 계절 자연 영상을 띄웠다. 그 연동을 걷어내며 이 PC 의 「배경 영상」
// (음원 관리 → 배경 영상) 파일을 띄운다(사용자 결정). 무음·반복 재생이고, 그동안 배경음악은
// MusicPlayer 가 따로 튼다 — 그래서 이 영상은 소리를 내지 않는다(muted).
//
// 소리는 안 내지만 **끄면 BGM도 같이 끈다**. 화면 조립 코드와 섞여 있으면 이 줄이 눈에 안 띄어서,
// 닫기 버튼만 손봤다가 음악이 남는 사고가 나기 쉽다.
//
// 뮤트지만 **방송의 일부**라서 「정지」에 같이 닫힌다(carecast:stop-broadcast, td09 §6·H12).
// 닫는 길은 onForceStop 하나뿐이다 — 새로 짜지 말고 그 길을 태울 것.
import { useEffect, useRef, useState } from 'react'
import { API_URL } from '../../lib/api'

export default function MorningVideoDisplay() {
  const [data,        setData]       = useState(null)   // { url, durationMin }
  const [show,        setShow]       = useState(true)
  const [isFullscr,   setIsFullscr]  = useState(false)
  const [remainSec,   setRemainSec]  = useState(0)
  const timerRef    = useRef(null)
  const countRef    = useRef(null)

  useEffect(() => {
    const onFsChange = () => setIsFullscr(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [])

  const requestFs = () => {
    const el  = document.documentElement
    const req = el.requestFullscreen || el.webkitRequestFullscreen
    if (req) req.call(el).catch(() => {})
  }
  const exitFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }

  useEffect(() => {
    const stopBGM = () => {
      window.dispatchEvent(new CustomEvent('carecast:broadcast-local-bgm-stop'))
    }
    const onStart = (e) => {
      const { url, durationMin } = e.detail || {}
      if (!url) return
      setData({ url, durationMin })
      setShow(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (countRef.current) clearInterval(countRef.current)
      if (durationMin > 0) {
        const totalSec = durationMin * 60
        setRemainSec(totalSec)
        countRef.current = setInterval(() => {
          setRemainSec(s => {
            if (s <= 1) { clearInterval(countRef.current); countRef.current = null; return 0 }
            return s - 1
          })
        }, 1000)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          if (countRef.current) { clearInterval(countRef.current); countRef.current = null }
          setData(null)
          stopBGM()
          exitFs()
        }, totalSec * 1000)
      }
    }
    const onForceStop = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      if (countRef.current) { clearInterval(countRef.current); countRef.current = null }
      setData(null)
      stopBGM()
      exitFs()
    }
    window.addEventListener('carecast:morning-video-start', onStart)
    // 「정지」는 이 PC의 방송을 **예외 없이** 끝낸다(docs/td09-audiobus.md §6, H12).
    // 이 영상은 뮤트라 소리는 없지만 화면을 통째로 덮는 **방송의 일부**다 — 안 들으면
    // 사람이 정지를 눌러도 전체화면 영상이 그대로 남는다.
    window.addEventListener('carecast:stop-broadcast',      onForceStop)
    return () => {
      window.removeEventListener('carecast:morning-video-start', onStart)
      window.removeEventListener('carecast:stop-broadcast',      onForceStop)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (countRef.current) clearInterval(countRef.current)
    }
  }, [])

  if (!data || !show) return null

  const handleClose = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    exitFs()
    setShow(false)
    window.dispatchEvent(new CustomEvent('carecast:broadcast-local-bgm-stop'))
  }

  return (
    <div className="fixed inset-0 z-[5000] bg-black">
      <video
        key={data.url}
        src={API_URL + data.url}
        className="w-full h-full object-contain"
        autoPlay muted loop playsInline
        aria-label="방송 후 배경 영상"
      />
      {/* 우상단 컨트롤 바 */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        {data.durationMin > 0 && (
          <span className="bg-black/60 text-white/80 text-xs px-2 py-1 rounded-full select-none">
            🔇 뮤트 · {remainSec > 0 ? `${Math.ceil(remainSec / 60)}분 남음` : '종료 중...'}
          </span>
        )}
        {/* 전체화면 버튼 (브라우저 주소창 숨김) */}
        <button
          onClick={isFullscr ? exitFs : requestFs}
          className="bg-black/50 hover:bg-black/70 text-white text-xs font-semibold
                     rounded-full px-3 h-8 flex items-center gap-1 transition-colors"
          title={isFullscr ? '전체화면 해제' : '전체화면'}
        >
          {isFullscr ? '⬜ 해제' : '⛶ 전체화면'}
        </button>
        <button
          onClick={handleClose}
          className="bg-black/50 hover:bg-black/70 text-white
                     rounded-full w-8 h-8 flex items-center justify-center text-lg transition-colors"
          title="영상 닫기 (BGM도 정지)"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
