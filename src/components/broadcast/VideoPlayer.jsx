// 동영상 전체화면 오버레이(video_play SSE). App.jsx에서 갈라져 나왔다.
//
// 360줄짜리 한 덩어리라 App.jsx의 화면 조립을 읽는 데 방해가 됐다. Web Audio DelayNode로
// TV HDMI 지연을 맞추고, 재생 중 배속·볼륨을 이 재생에만 적용한다 — 저장은 순서편집기가
// 맡는다는 원칙이 여기 주석에 적혀 있으니 옮길 때 함께 읽을 것.
import { useEffect, useRef, useState } from 'react'
import RateInput from '../shared/RateInput'
import { rateToPercent, percentToRate } from '../../lib/scheduleUtils'
import { videoEnded as videoEndedAPI, getAudioSubtitle,
         getVideoAudioDelay, getCaptionOffset } from '../../lib/api'
import { audioBus } from '../../lib/audioBus'

// 자막에게 "소리를 이만큼 미뤘다"고 알린다 (2026-09-12).
//
// **모듈 바깥에 둔다** — 지연 슬라이더를 듣는 처리기는 한 번만 붙으므로(의존성 []),
// 컴포넌트 안의 함수를 부르면 첫 렌더의 것에 묶인다. 이 함수는 상태를 안 보므로
// 밖에 두는 편이 안전하고, 무엇을 하는지도 한 줄로 읽힌다.
// **자막 시점 = 영상 보정 + 자막 오프셋**(2026-09-16).
//
// 자막은 지금까지 소리 보정을 **그대로** 따라갔다. 소리를 늦추면 자막도 같이 늦는데,
// 사람 눈은 귀보다 자막을 먼저 찾아서 그게 늦게 느껴진다
// (*"자막은 조금 늦어, 그래서 조금 빠르게 설정할 수 있도록"*).
// 그래서 그 위에 **더하는** 값을 둔다. 음수면 자막이 소리보다 먼저 뜬다.
const 자막보정 = (딜레이ms, 오프셋ms) => {
  const ms = (Number(딜레이ms) || 0) + (Number(오프셋ms) || 0)
  window.dispatchEvent(new CustomEvent('carecast:caption-attach', { detail: { offsetMs: ms } }))
}

// ── 보정 갈래(A/B)는 **없앴다** (사용자 지시 2026-09-16) ──────────────────────
// *"이거 영상 하나로 통일해줘, 어차피 동일하게 TV에서 수신받아서 약간씩 늦는거잖아"*
//
// 값이 둘일 때는 「어느 영상이냐」로 갈라야 했고, 그 배선(`delayProfile`)이 서버 →
// 화면 → 재생기로 흘렀다. 그 사슬이 끊겨 조용히 틀린 값이 걸린 사고가 두 번 있었다
// (V③ R18·R23, 2026-09-14).
//
// 그런데 두 값은 **같은 것을 재고 있었다** — 지연은 캡처카드→TV 경로에서 오고 그
// 경로는 영상마다 다르지 않다. 현장 값도 둘 다 400 이었다.
// **고를 것이 없으면 틀리게 고를 수도 없다.** 갈래를 걷는 것이 곧 그 사고 유형을
// 없애는 일이다.

// 시간 포맷 (초 → MM:SS)
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// 동영상 전체화면 오버레이 — video_play SSE 수신 시 표시, 종료 후 서버에 신호
export default function VideoPlayer() {
  const [video,    setVideo]    = useState(null)   // { url, name, token }
  const [paused,   setPaused]   = useState(false)
  const [current,  setCurrent]  = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume,   setVolume]   = useState(1)
  // 지금 이 재생의 배속. 예약·단계에 걸린 값으로 시작하고, 사람이 오버레이에서 바꿀 수 있다.
  const [rate,     setRate]     = useState(1)
  const [showCtrl, setShowCtrl] = useState(true)
  // 재생이 **안 된** 이유(UX-40). 검은 화면만 두면 사람은 나가는 중이라고 읽는다.
  const [playError, setPlayError] = useState('')
  const videoRef              = useRef(null)
  // 자막 조회의 세대. **늦게 온 응답이 지워진 자막을 되살리는 것**을 막는다(UX-09-R10).
  // 자막을 걷는 자리가 곧 이 번호를 올리는 자리다 — 한쪽만 하면 같은 사고가 돌아온다.
  const 자막세대Ref           = useRef(0)
  const busRef                 = useRef(null)   // [audioBus] 영상 소리 장부 등록 손잡이
  const hideTimerRef          = useRef(null)
  const endedRef              = useRef(false)
  // 보정은 **하나뿐이다**(2026-09-16). 기본 0 — 새 PC 는 대개 모니터로 그냥 본다.
  const audioDelayRef           = useRef(0)
  const captionOffsetRef        = useRef(0)
  const mediaVolRef             = useRef(1.0)
  // 이 방송에만 적용할 영상 볼륨(0~1). 서버가 예약의 main_volume을 실어 보내면 채워지고,
  // 방송이 끝나면 비운다 — 음량 슬라이더(mediaVolRef)는 건드리지 않는다.
  const mediaOverrideRef        = useRef(null)
  const effectiveMediaVol       = () => mediaOverrideRef.current ?? mediaVolRef.current
  // Web Audio API refs
  const audioCtxRef             = useRef(null)
  const gainNodeRef             = useRef(null)
  const delayNodeRef            = useRef(null)   // 실시간 딜레이 조정용
  const currentVideoCategoryRef = useRef(null)   // 현재 재생 중인 영상 카테고리

  const teardownWebAudio = () => {
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
      gainNodeRef.current = null
      delayNodeRef.current = null
    }
  }

  // Web Audio DelayNode 설정
  // 원리: video 엘리먼트 오디오를 Web Audio가 캡처 → DelayNode(delayMs) 통과 → 스피커
  //       TV HDMI 지연(D ms)과 오디오 지연(D ms)이 정확히 일치 → 완벽 싱크
  const setupWebAudioDelay = (videoEl, delayMs) => {
    teardownWebAudio()
    try {
      // createMediaElementSource 전에 muted 해제 필수 — muted 상태에서는 Web Audio 소스도 무음
      videoEl.muted = false
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      // createMediaElementSource 호출 시점부터 videoEl 직접 오디오 출력 차단됨
      const source = ctx.createMediaElementSource(videoEl)
      const gain   = ctx.createGain()
      gain.gain.value = effectiveMediaVol()

      // DelayNode는 0ms여도 항상 생성 — 슬라이더 실시간 조정을 위해 ref 보관
      const delay = ctx.createDelay(5.0)         // 최대 5초
      delay.delayTime.value = delayMs / 1000
      source.connect(delay)
      delay.connect(gain)
      gain.connect(ctx.destination)
      ctx.resume()

      audioCtxRef.current  = ctx
      gainNodeRef.current  = gain
      delayNodeRef.current = delay
      console.log(`[VideoPlayer] Web Audio DelayNode ${delayMs}ms 적용`)
    } catch (err) {
      console.error('[VideoPlayer] Web Audio 실패 — fallback unmute:', err.message)
      videoEl.muted  = false
      videoEl.volume = effectiveMediaVol()
    }
  }

  useEffect(() => {
    getVideoAudioDelay().then(d => { audioDelayRef.current = d.delayMs ?? 0 }).catch(() => {})
    getCaptionOffset().then(d => { captionOffsetRef.current = d.offsetMs ?? 0 }).catch(() => {})
  }, [])

  useEffect(() => {
    const onPlay = (e) => {
      endedRef.current = false
      // **새 영상이 오는 것도 교체다**(Codex UX-09-R11 지적 2026-09-12).
      //
      // 앞 영상의 자막 조회가 아직 오는 중일 수 있다. 그 응답이 도착했을 때 `<video>`
      // 요소는 **같은 노드가 다시 쓰이므로** 요소 비교만으로는 못 가른다 — 세대를 여기서
      // 올려야 비로소 갈린다. 안 올리면 앞 영상의 자막이 새 영상 위에 뜬다.
      // 걷는 것도 같이 한다: 새 영상의 자막이 준비되기 전까지 앞 글자가 남아 있으면 안 된다.
      자막세대Ref.current += 1
      window.dispatchEvent(new CustomEvent('carecast:caption-end'))
      // 새 영상이 시작되면 옛 오류를 지운다 — 안 지우면 멀쩡히 나가는 영상 위에
      // "나가지 않았습니다" 가 붙어 있다(UX-40).
      setPlayError('')
      teardownWebAudio()
      currentVideoCategoryRef.current = e.detail?.category || null
      const v = e.detail?.volume
      mediaOverrideRef.current = (typeof v === 'number' && v >= 0 && v <= 100) ? v / 100 : null
      // [audioBus] 영상 등록 — video 상태가 서면 소리가 난다(td09 §1 #6·7).
      busRef.current?.done()
      busRef.current = audioBus.register({ kind: 'video', label: e.detail?.name || e.detail?.url || '' })
      setVideo(e.detail); setPaused(false); setCurrent(0); setDuration(0)
    }
    const onStop = () => {
      currentVideoCategoryRef.current = null
      mediaOverrideRef.current = null   // 이 방송에만 쓰던 값이라 끝나면 비운다
      // 자막도 같이 걷는다 — 정지 경로는 handleEnded 를 안 지난다. 걷는 자리가 둘인 것은
      // 이 저장소가 UX-17 에서 되풀이해 겪은 모양이라, 한쪽만 걸면 글자가 남는다.
      window.dispatchEvent(new CustomEvent('carecast:caption-end'))
      // **걷는 자리가 곧 올리는 자리다.** 번호를 안 올리면 그 전에 나간 자막 조회가
      // 돌아와 지워진 자막을 되살린다(UX-09-R10).
      자막세대Ref.current += 1
      teardownWebAudio()
      // [audioBus] 정지로 영상이 내려간다 — 장부 해제
      busRef.current?.done(); busRef.current = null
      setVideo(null)
    }
    // 슬라이더를 미는 동안 **재생 중인 것에 바로 먹인다** — 저장하고 다시 틀어 봐야
    // 알 수 있으면 맞추는 데 몇 분이 걸린다.
    // **재생 중일 때만** 건다(`delayNodeRef.current` 가 그 표시다).
    const onDelay = (e) => {
      const ms = Number(e.detail) || 0
      audioDelayRef.current = ms
      if (delayNodeRef.current) {
        delayNodeRef.current.delayTime.value = ms / 1000
        // 자막도 같이 옮긴다 — 소리만 옮기면 글자가 그만큼 어긋난다.
        자막보정(ms, captionOffsetRef.current)
      }
    }
    // 자막만 옮긴다 — 소리는 그대로 둔다(그게 이 값의 존재 이유다).
    const onCaptionOffset = (e) => {
      const ms = Number(e.detail) || 0
      captionOffsetRef.current = ms
      if (delayNodeRef.current) 자막보정(audioDelayRef.current, ms)
    }
    const onMediaVol = (e) => {
      const v = Number(e.detail) / 100
      mediaVolRef.current = v
      if (gainNodeRef.current) gainNodeRef.current.gain.value = v
      else if (videoRef.current) videoRef.current.volume = v
    }
    window.addEventListener('carecast:video-play',                 onPlay)
    window.addEventListener('carecast:stop-broadcast',             onStop)
    window.addEventListener('carecast:video-audio-delay',          onDelay)
    window.addEventListener('carecast:caption-offset',             onCaptionOffset)
    window.addEventListener('carecast:media-volume',               onMediaVol)
    return () => {
      teardownWebAudio()
      // [audioBus] 컴포넌트 해제 — 남아 있는 장부 등록을 내린다
      busRef.current?.done(); busRef.current = null
      // 화면이 사라질 때도 번호를 올린다 — 돌아온 조회가 전역 자막 이벤트를 쏘면
      // 다음 화면의 자막을 흔든다(UX-09-R10).
      자막세대Ref.current += 1
      window.removeEventListener('carecast:video-play',                 onPlay)
      window.removeEventListener('carecast:stop-broadcast',             onStop)
      window.removeEventListener('carecast:video-audio-delay',          onDelay)
      window.removeEventListener('carecast:caption-offset',             onCaptionOffset)
      window.removeEventListener('carecast:media-volume',               onMediaVol)
    }
  }, [])

  // **왜 안 나갔는지 사람 말로 적는다**(UX-40). `MediaError.code` 는 숫자라 그대로 보여주면
  // 아무도 못 고친다. 브라우저마다 문구가 다르므로 **꾸며 내지 않고** 아는 것만 말한다.
  const handleVideoError = () => {
    const code = videoRef.current?.error?.code
    setPlayError(
      code === 1 ? '재생이 중단됐습니다.'
        : code === 2 ? '파일을 불러오지 못했습니다 — 네트워크를 확인해 주세요.'
          : code === 3 ? '영상을 해독하지 못했습니다 — 파일이 손상됐을 수 있습니다.'
            : code === 4 ? '이 브라우저가 열 수 없는 형식입니다 — 음원 관리에서 MP4 로 올려 주세요.'
              : '알 수 없는 이유로 재생되지 않았습니다.',
    )
  }

  const handleEnded = async () => {
    if (endedRef.current) return
    endedRef.current = true
    // 자막을 먼저 걷는다. 안 걷으면 영상이 사라진 빈 화면에 글자만 남고, 그 보정값(450ms)이
    // 다음에 나가는 **음원** 자막까지 밀어 버린다 — 원인을 찾기 가장 어려운 모양이다.
    window.dispatchEvent(new CustomEvent('carecast:caption-end'))
    // **걷는 자리가 곧 올리는 자리다.** 번호를 안 올리면 그 전에 나간 자막 조회가
    // 돌아와 지워진 자막을 되살린다(UX-09-R10).
    자막세대Ref.current += 1
    const tok = video?.token
    // 실제로 잰 재생시간을 같이 돌려준다 — 서버는 audio_files.duration이 비어 있을 때만
    // 받아 적는다(MusicPlayer의 음원 종료 보고와 같은 이유. 업로드 때는 길이를 알 수 없어
    // 0으로 들어가고, 그동안 흐름이 "모르는 파일" 상한까지 기다렸다).
    const fileId   = video?.audioFileId
    const measured = videoRef.current?.duration
    currentVideoCategoryRef.current = null
    teardownWebAudio()
    // [audioBus] 영상 종료(자연 종료·닫기 버튼) — 장부 해제
    busRef.current?.done(); busRef.current = null
    setVideo(null)
    window.dispatchEvent(new CustomEvent('carecast:video-player-closed'))
    if (tok) {
      await videoEndedAPI(tok, (fileId && Number.isFinite(measured) && measured > 0)
        ? { audioFileId: fileId, duration: measured }
        : {}).catch(() => {})
    }
  }

  // onPlay: Web Audio DelayNode로 오디오 딜레이 적용
  // pause/resume 시에는 재진입 방지 — createMediaElementSource는 element당 한 번만 허용
  const handleVideoPlay = () => {
    // **배경음악을 끈다**(2026-09-21 Codex 5회차). 흐름에 「방송용 BGM → 업로드 영상」을 두면 영상 밑에서
    // BGM 이 계속 났다. 주인 표 없이 보낸다: 영상이 나오는 동안에는 어떤 배경음악도 깔리지 않는 것이 이 자리의 약속이다.
    window.dispatchEvent(new CustomEvent('carecast:broadcast-local-bgm-stop'))
    setPaused(false)

    const v = videoRef.current
    if (!v || audioCtxRef.current) return  // 이미 Web Audio 설정됨

    const delayMs = audioDelayRef.current

    setupWebAudioDelay(v, delayMs)
    // 자막은 소리 보정 **위에** 오프셋을 더한 시점에 뜬다(2026-09-16).
    자막붙이기(v, delayMs, captionOffsetRef.current)
  }

  // ── 영상 자막 (2026-09-12) ──────────────────────────────────────────────
  //
  // **자막 층은 음원이든 영상이든 안 가린다** — `currentTime` 만 읽는다
  // (`BroadcastCaption.jsx` 의 onAttach). 그리고 영상은 소리 내는 창에서만 재생되므로
  // (`useScheduledBroadcast.js` 의 `CC_IS_LEADER && _IS_LOCAL` 가드) 음원에서 골치였던
  // **추정 시계 문제가 아예 없다.** 이 창은 늘 실측이다.
  //
  // 대신 음원에 없는 것이 하나 있다 — **바로 위에서 건 소리 미룸**이다. TV HDMI 지연만큼
  // 소리를 늦춰 보내므로, 자막을 `currentTime` 그대로 따라가게 두면 PC 모니터에서
  // **자막이 소리보다 정확히 그만큼 앞선다.** 그래서 같은 값을 자막에도 넘긴다.
  //
  // **기본은 꺼짐이다**(사용자 지시). 음원은 올리면 초안이 저절로 생기지만 영상은 아니고,
  // 사람이 자막을 만들어 「방송에 쓰기」로 올린 것(`status === 'ready'`)만 나간다.
  // **순서가 거꾸로면 실측 시계를 버린다**(Codex UX-09-R10 지적 2026-09-12).
  //
  // `caption-cue` 를 받은 쪽은 `audioRef.current = null` 로 **초기화한다**
  // (`BroadcastCaption.jsx` 의 onCue — 새 방송이 오면 앞 방송의 요소를 놓는 것이 맞다).
  // 그래서 `attach` 를 먼저 쏘면 그 다음 `cue` 가 그것을 지워 **추정 시계로 떨어진다** —
  // 영상에서는 추정이 필요 없는데도 그렇게 됐고, 탐색·배속을 바꾸면 자막이 따로 갔다.
  // **cue 먼저, attach 나중.**
  //
  // **그리고 조회가 끝날 때까지 영상이 그대로인지 본다.** `getAudioSubtitle` 은 비동기라,
  // 그 사이에 정지하거나 다른 영상으로 바뀌면 **늦게 온 응답이 지워진 자막을 되살린다** —
  // UX-17 이 열네 판 끈 그 모양(취소 토큰 없는 비동기)을 자막에서 또 만들었다.
  // 세대 번호로 가른다: 시작·정지·종료·언마운트가 올리고, 올라갔으면 안 쏜다.
  // 자막이 뜨는 시각 = **영상 보정 + 자막 오프셋**(2026-09-16). 소리는 보정만큼만 늦고,
  // 자막은 그 위에서 앞뒤로 더 움직인다 — 눈이 귀보다 자막을 먼저 찾기 때문이다.
  const 자막붙이기 = async (videoEl, delayMs, offsetMs = 0) => {
    const id = video?.audioFileId
    if (!id) return
    const 세대 = (자막세대Ref.current += 1)
    try {
      const { subtitle } = await getAudioSubtitle(id)
      if (subtitle?.status !== 'ready') return        // 초안·없음은 안 띄운다
      // 기다리는 동안 정지·교체가 있었나. 요소까지 견준다 — 세대만 보면 같은 번호로
      // 다른 요소가 들어온 경우를 놓친다.
      if (세대 !== 자막세대Ref.current || videoRef.current !== videoEl) return
      // 이 창은 실측 시계를 쓰므로 leadMs 는 0 이다(추정으로 돌 일이 없다).
      window.dispatchEvent(new CustomEvent('carecast:caption-cue',
        { detail: { kind: 'video', title: video?.name || '', cues: subtitle.cues, leadMs: 0 } }))
      window.dispatchEvent(new CustomEvent('carecast:caption-attach',
        { detail: { audio: videoEl, offsetMs: (Number(delayMs) || 0) + (Number(offsetMs) || 0) } }))
    } catch (e) {
      // 자막을 못 받는 것은 방송 실패가 아니다 — 영상은 그대로 나간다.
      console.error('[자막] 영상 자막을 받지 못했습니다(영상은 정상):', e.message)
    }
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v || endedRef.current) return
    setCurrent(v.currentTime)
    if (v.duration > 0 && v.currentTime >= v.duration - 0.3) handleEnded()
  }

  const handleMeta = () => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration); setVolume(v.volume)
    // 예약·단계에 걸린 배속(0.5~1.5). 매번 명시한다 — playbackRate는 영상을 바꿔도 남아 있어서
    // 안 정하면 앞 방송의 느린 속도가 다음 방송까지 따라간다. 음정은 preservesPitch로 지킨다.
    const r = video?.rate
    const start = (typeof r === 'number' && r >= 0.5 && r <= 1.5) ? r : 1
    try { v.preservesPitch = true } catch { /* 지원 안 하는 브라우저는 그냥 둔다 */ }
    v.playbackRate = start
    setRate(start)
  }

  const handleSeek = (e) => {
    const v = videoRef.current
    if (v) { v.currentTime = Number(e.target.value); setCurrent(v.currentTime) }
  }

  // 재생 중 배속 바꾸기 — 노래방 방송에서 어르신이 박자를 맞추기 어려울 때 그 자리에서 늦춘다.
  // **이 재생에만 적용한다.** 저장은 자동방송 순서편집기의 '재생 배속'이 맡는다(볼륨과 같은 원칙).
  // 음정은 preservesPitch로 지킨다 — 안 그러면 느리게 틀 때 목소리가 굵어진다.
  const applyRate = (r) => {
    setRate(r)
    const v = videoRef.current
    if (!v) return
    try { v.preservesPitch = true } catch { /* 지원 안 하는 브라우저는 그냥 둔다 */ }
    v.playbackRate = r
  }

  const handleVolume = (e) => {
    const val = Number(e.target.value)
    if (videoRef.current) videoRef.current.volume = val
    setVolume(val)
  }

  const togglePause = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPaused(false) } else { v.pause(); setPaused(true) }
  }

  // 컨트롤 자동 숨김 (3초 비활동)
  const showControls = () => {
    setShowCtrl(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setShowCtrl(false), 3000)
  }

  if (!video) return null

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black flex items-center justify-center cursor-none"
      onMouseMove={showControls}
      onClick={showControls}
      style={{ cursor: showCtrl ? 'default' : 'none' }}
    >
        <video
          ref={videoRef}
          key={video.url}
          src={video.url}
          autoPlay
          muted
          onPlay={handleVideoPlay}
          onPause={() => setPaused(true)}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleMeta}
          onClick={togglePause}
          onError={handleVideoError}
          className="w-full h-full object-contain"
        />

      {/* **안 나가는 것을 말한다**(UX-40, 2026-09-11). 전에는 `onError` 도 재생 거부 처리도
          없어서, 브라우저가 막거나 파일이 깨지면 **검은 화면만** 떴다. 사람은 창을 보고
          "나가는 중" 이라고 읽는다 — 장치 목록이 있다는 사실만으로 재생 성공을 표시하지
          않는다는 것이 이 요구의 뜻이다. */}
      {playError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6">
          <div className="max-w-md text-center space-y-2">
            <p className="text-base font-semibold text-ds-v3-warn">이 영상이 나가지 않았습니다</p>
            <p className="text-sm text-white/80 leading-relaxed">{playError}</p>
          </div>
        </div>
      )}

      {/* 컨트롤 오버레이 */}
      <div
        className="absolute bottom-0 left-0 right-0 transition-opacity duration-300"
        style={{ opacity: showCtrl ? 1 : 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}
      >
        {/* 재생 진행 바 */}
        {(
          <div className="px-4 pt-4">
            <input
              type="range" min={0} max={duration || 0} step={0.1} value={current}
              onChange={handleSeek}
              className="w-full h-1.5 accent-white cursor-pointer"
              style={{ accentColor: '#fff' }}
            />
            <div className="flex justify-between text-white/60 text-xs mt-0.5 nums">
              <span>{fmtTime(current)}</span>
              <span>{fmtTime(duration)}</span>
            </div>
          </div>
        )}

        {/* 버튼 행 */}
        <div className="flex items-center gap-3 px-4 pb-4 pt-1">
          {/* 재생/일시정지 */}
          <button onClick={togglePause} className="text-white text-2xl w-8 flex-shrink-0">
            {paused ? '▶' : '⏸'}
          </button>

          {/* 영상 이름 */}
          <span className="text-white text-sm flex-1 truncate opacity-80">
            {video.name}
          </span>

          {/* 볼륨 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-white text-base">🔊</span>
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              onChange={handleVolume}
              className="w-20 h-1.5 cursor-pointer"
              style={{ accentColor: '#fff' }}
            />
          </div>

          {/* 배속 — 이 재생에만. 노래방 방송에서 박자를 맞추기 어려울 때 그 자리에서 늦춘다.
              다음에도 그 속도로 나가게 하려면 자동방송 순서편집기의 '재생 배속'에서 정한다. */}
          <div className="flex items-center gap-1 flex-shrink-0" title="재생 배속 (이 재생만)">
            <span className="text-white text-xs opacity-70">배속</span>
            {/* 정속이 100%. ±5%씩 누르거나 숫자를 직접 적는다 — 배수 버튼 다섯 개로는
                "83%처럼 조금만" 이 안 됐다(현장 요청, 2026-09-01). */}
            <RateInput
              percent={rateToPercent(rate)}
              onChange={pct => applyRate(percentToRate(pct))}
              step={5}
              dark
            />
          </div>

          {/* 닫기 (다음 단계로) */}
          <button
            onClick={handleEnded}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 text-white
                       flex items-center justify-center transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
