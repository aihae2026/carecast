import { useState, useEffect, useRef } from 'react'
import { Radio, Music2, Film, Moon, Bell, VolumeX } from 'lucide-react'
import { getNowPlaying, openSSEBus, subscribeSSEState } from '../lib/api'

function formatClock(date) {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

const STATES = {
  broadcast: { color: '#ef4444', label: '방송 중',       Icon: Radio },
  bgm:       { color: '#2563eb', label: 'BGM 재생 중',   Icon: Music2 },
  video:     { color: '#4b5563', label: '영상 재생 중',  Icon: Film },
  chime:     { color: '#f59e0b', label: '차임벨',        Icon: Bell },
  idle:      { color: '#1f2937', label: '대기 중',       Icon: Moon },
}

// 소리만 나가는 방송(안내·음원)의 표시를 스스로 걷는 상한. 예약 TTS는 시작만 알리고 끝났다는
// 신호가 없다(scheduler.js는 scheduled_broadcast 하나만 쏜다) — 상한이 없으면 다음 방송이
// 올 때까지 몇 시간이고 남아 "지금 나가는 중"처럼 보인다.
const SPEECH_MAX_MS = 3 * 60 * 1000
// 차임벨은 몇 초짜리고 끝 신호가 아예 없다
const CHIME_MS = 6 * 1000

// 폴더폰 커버스크린 느낌의 요약 전용 모니터링 화면 — 다른 PC/현장 PC 재생 상태를 읽기 전용으로 표시.
// 팝업으로 열리며, 재생 제어는 하지 않으므로(App.jsx 리더 선출에서 항상 제외) 닫아도 현장 재생에 영향 없음.
//
// 화면 미러(2026-08-31): 예전엔 "방송 중"이라는 글자만 떠서, 지금 무엇이 나가는지 보려면 현장 PC
// 앞으로 가야 했다. 이 창은 현장 PC와 **같은 SSE를 받는다** — 같은 영상·같은 방송문을 그대로
// 그리면 그게 곧 지금 화면이다. 소리만 내지 않는다. 무음은 두 겹으로 지킨다:
//   1) <video>는 muted (속성 + ref 양쪽. React가 muted를 DOM에 안 실어 주는 경우가 있다)
//   2) SSE를 이름표(?tab=) 없이 연다 — 이름표 없는 연결은 서버가 소리 담당 후보에서 뺀다(tabId.js)
// 이 창이 서버로 보내는 것은 아무것도 없다(상태 보고도, 재생 종료 신호도).
export default function MonitorPage() {
  const [now, setNow] = useState(new Date())
  const [np,  setNp]  = useState({ broadcast: null, bgm: null, video: null })
  // 지금 화면에 떠 있는 영상 — { kind:'file', src, name }
  const [media,  setMedia]  = useState(null)
  // 소리만 나가는 방송의 내용 — { label, title, content, at }
  const [speech, setSpeech] = useState(null)
  // 지금 몇 번째 단계인가(자동방송·흐름이 단계를 시작할 때마다 보내 준다)
  const [step,   setStep]   = useState(null)
  const videoRef      = useRef(null)
  const speechTimerRef = useRef(null)
  // 현장 PC가 "영상 재생 중"이라고 보고한 적이 있는가. 이걸 봐야 **끝나서 null**과
  // **아직 보고 전이라 null**을 구별한다 — 구별 못 하면 미리보기가 뜨자마자 걷힌다.
  const sawVideoRef   = useRef(false)
  // 이 창은 화면 내용을 **전부 실시간 연결로** 받는다(폴링으로 오는 건 방송 제목 정도다).
  // 연결이 죽으면 화면이 조용히 멈춘 채 그럴듯해 보인다 — 그래서 눈에 보이게 적는다.
  // 2026-09-01에 원격 창에서 실제로 그 상태를 겪고도 창만 보고는 알 수 없었다.
  const [live, setLive] = useState(false)
  useEffect(() => subscribeSSEState(setLive), [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // 방송/로컬BGM/영상 상태 — 다른 PC도 보는 서버 폴링 상태 그대로 재사용 (NowPlayingBar와 동일 소스)
  useEffect(() => {
    const poll = () => { getNowPlaying().then(setNp).catch(() => {}) }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [])

  // 현장 PC가 받는 것과 같은 이벤트를 그대로 받는다.
  // lib/api.js의 initSSE를 쓰지 않는 이유: 그 목록은 App.jsx 한 곳이 쓰는 것이라 여기서 필요한
  // 이벤트(prayer_play·chime_play·bgm_*)가 없고, 그 목록을 늘리면 App.jsx 처리기의 끝단
  // (어느 것도 아니면 TTS 재생)까지 새 이벤트가 흘러든다. 이 창 전용 구독은 여기서 연다.
  useEffect(() => {
    let es = null
    let retry = null
    let closed = false

    const showSpeech = (s, ms = SPEECH_MAX_MS) => {
      setSpeech({ ...s, at: new Date() })
      clearTimeout(speechTimerRef.current)
      speechTimerRef.current = setTimeout(() => setSpeech(null), ms)
    }
    const clearAll = () => {
      clearTimeout(speechTimerRef.current)
      setSpeech(null); setMedia(null); setStep(null); sawVideoRef.current = false
    }

    const connect = () => {
      if (closed) return
      // 이름표(?tab=)를 붙이지 않는다 — 붙이면 이 창이 소리 담당으로 뽑혀 아무도 소리를 안 낸다
      es = openSSEBus()   // 창에 하나뿐인 연결(lib/api). 모니터 창은 이름표를 안 보낸다.
      const on = (name, fn) => es.addEventListener(name, (e) => {
        try { fn(JSON.parse(e.data)) } catch { /* 형식이 다른 데이터 한 건 때문에 구독이 끊기면 안 된다 */ }
      })

      // ── 화면이 있는 것 ──
      on('video_play', (d) => {
        sawVideoRef.current = false
        if (d.url) setMedia({ kind: 'file', src: d.url, name: d.name || '영상' })
      })
      on('morning_video_start', (d) => {
        // 방송 뒤 배경 영상 — 이 PC 의 「배경 영상」 파일(2026-09-21)
        if (d.url) { sawVideoRef.current = false; setMedia({ kind: 'file', src: d.url, name: d.name || '배경 영상' }) }
      })

      // ── 소리만 나는 것 ──
      on('scheduled_broadcast', (d) => showSpeech({ label: '안내 방송', title: d.title || '방송', content: d.content || '' }))
      on('broadcast_started',   (d) => {
        // 새 방송이 시작하면 앞 방송의 단계 표시부터 지운다 — 취소로 끝난 방송은
        // broadcast_completed가 안 나가서 "7/8 저녁 문안인사"가 그대로 남아 있다.
        setStep(null)
        setSpeech(s => s?.content ? s : { label: '방송', title: d.title || '방송 중', content: '', at: new Date() })
      })
      on('prayer_play',         (d) => showSpeech({ label: '음원 재생', title: d.name || '음원', content: '' }))
      on('chime_play',          ()  => showSpeech({ label: '차임벨', title: '차임벨', content: '' }, CHIME_MS))
      on('broadcast_step', (d) => setStep(d))
      on('broadcast_stopped',   clearAll)
      on('broadcast_completed', clearAll)

      // 다시 붙는 일은 공유 연결이 맡는다.
    }

    connect()
    return () => { closed = true; clearTimeout(retry); clearTimeout(speechTimerRef.current); es?.close() }
  }, [])

  // 현장에서 영상이 끝나거나 사람이 창을 닫으면 이 미리보기도 걷는다.
  // 파일 영상은 아래 <video>의 onEnded가 먼저 알려 주지만, 중간에 닫는 경우는
  // 서버 상태로만 알 수 있다.
  useEffect(() => {
    if (np.video) { sawVideoRef.current = true; return }
    if (sawVideoRef.current) {
      sawVideoRef.current = false
      setMedia(null)
    }
  }, [np.video])

  // React가 muted 속성을 DOM에 안 실어 주는 경우가 있다 — 소리는 여기서 한 번 더 못 박는다
  useEffect(() => {
    if (videoRef.current) { videoRef.current.muted = true; videoRef.current.defaultMuted = true }
  }, [media])

  const { broadcast, bgm, video } = np
  let key = 'idle', title = null
  if (speech?.label === '차임벨') { key = 'chime';     title = '차임벨' }
  else if (broadcast)            { key = 'broadcast'; title = broadcast.title }
  else if (bgm)                  { key = 'bgm';       title = bgm.title }
  else if (video)                { key = 'video';     title = video.name }
  else if (speech)               { key = 'broadcast'; title = speech.title }

  const { color, label, Icon } = STATES[key]

  return (
    <div
      className="h-screen w-screen flex flex-col items-center justify-between overflow-hidden select-none"
      style={{ background: '#0b0b0f', color: '#fff' }}
    >
      <div className="flex flex-col items-center gap-1 pt-5">
        <span className="text-sm tracking-wide" style={{ color: '#6b7280' }}>CareCast 모니터링</span>
        <span className="text-lg font-semibold nums" style={{ color: '#9ca3af' }}>{formatClock(now)}</span>
        {/* 지금 몇 번째 단계인가 — 조용한 단계(6분 대기 중인 투약 안내)와 멈춘 것을 구별하게 해 준다 */}
        {step && (
          <span className="mt-1 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(255,255,255,0.08)', color: '#d1d5db' }}>
            <span className="nums font-semibold" style={{ color: '#9ca3af' }}>{step.index}/{step.total}</span>
            <span className="max-w-[200px] truncate">{step.label}</span>
          </span>
        )}
        {/* 실시간 연결 표시 — 끊기면 화면이 멈춘다는 뜻이다 */}
        {!live && (
          <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}>
            실시간 연결 끊김
          </span>
        )}
      </div>

      {media ? (
        // ── 지금 현장 화면에 떠 있는 영상 그대로 (소리 없음) ──
        <div className="w-full px-3 flex flex-col items-center gap-2">
          <div className="w-full rounded-xl overflow-hidden relative" style={{ background: '#000', aspectRatio: '16 / 9' }}>
            {(
              <video
                ref={videoRef}
                src={media.src}
                muted
                autoPlay
                playsInline
                onEnded={() => setMedia(null)}
                className="w-full h-full object-contain"
              />
            )}
            <span
              className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(0,0,0,0.6)', color: '#d1d5db' }}
            >
              <VolumeX size={10} /> 소리 없음
            </span>
          </div>
          <span className="text-sm text-center max-w-full truncate" style={{ color: '#d1d5db' }}>{media.name}</span>
        </div>
      ) : speech ? (
        // ── 소리만 나가는 방송 — 지금 읽고 있는 문구를 그대로 보여준다 ──
        <div className="w-full px-4 flex flex-col items-center gap-2 min-h-0">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: color }}>
              <Icon size={16} color="#fff" className="animate-pulse" />
            </span>
            <span className="text-sm font-semibold" style={{ color }}>{speech.label}</span>
            <span className="text-xs nums" style={{ color: '#6b7280' }}>{formatClock(speech.at)} 시작</span>
          </div>
          <span className="text-lg font-semibold text-center" style={{ color: '#f3f4f6' }}>{speech.title}</span>
          {/* ── **방송 제목만으로는 「뭐가 나가는지」를 모른다** (사용자 지적 2026-09-15) ────
              현장에서 영상이 돌고 BGM 이 깔리는 동안 이 창에는 **「점심 식사 전 방송」**
              넉 자만 떠 있었다. 위 `key` 판정이 `broadcast` 를 먼저 잡아서, 같이 울리는
              영상·BGM 이름이 **가려졌기 때문**이다(그 판정은 「무슨 상태인가」를 고르는
              것이라 그대로 둔다 — 여기서 **덧붙이기만** 한다).

              `np.video` 에는 이름뿐이고 주소가 없어(`nowPlaying.js` 의 `video: {name, category}`)
              화면을 그대로 비출 수는 없다. **이름이라도 보이면 「지금 저게 나가는 중」인 것을
              안다** — 이 창의 목적이 그것이다. 주소까지 실으려면 서버 상태의 모양을 바꿔야
              하고, 그건 이 자리에서 조용히 할 일이 아니다. */}
          {(np.video || np.bgm) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {np.video && (
                <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.08)', color: '#d1d5db' }}>
                  영상 · {np.video.name}
                </span>
              )}
              {np.bgm && (
                <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.08)', color: '#d1d5db' }}>
                  배경음악 · {np.bgm.title}
                </span>
              )}
            </div>
          )}
          {speech.content && (
            <p
              className="text-sm leading-relaxed text-center overflow-y-auto px-1"
              style={{ color: '#9ca3af', maxHeight: '38vh', whiteSpace: 'pre-wrap' }}
            >
              {speech.content}
            </p>
          )}
        </div>
      ) : (
        // ── 화면에 아무것도 안 떠 있을 때 — 예전 요약 표시 그대로 ──
        <div className="flex flex-col items-center gap-4 px-8 text-center">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center transition-colors duration-500"
            style={{ background: key === 'idle' ? 'rgba(255,255,255,0.06)' : color }}
          >
            <Icon size={40} color={key === 'idle' ? '#6b7280' : '#fff'} className={key !== 'idle' ? 'animate-pulse' : ''} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-2xl font-semibold" style={{ color: key === 'idle' ? '#9ca3af' : color }}>{label}</span>
            {title && <span className="text-base max-w-xs truncate" style={{ color: '#d1d5db' }}>{title}</span>}
          </div>
        </div>
      )}

      <div className="pb-4 text-xs text-center px-6" style={{ color: '#4b5563' }}>
        현장 화면 그대로 · 이 창에서는 소리가 나지 않습니다
      </div>
    </div>
  )
}
