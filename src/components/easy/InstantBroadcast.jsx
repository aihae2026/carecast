import { useState, useRef, useCallback, useEffect } from 'react'
import { useTourStage, 안내중 } from '../../lib/tourStage'
import { Mic, Radio, Square, AlertCircle } from 'lucide-react'
import HelpTip from '../shared/HelpTip'
import { useChimeToggles } from '../../hooks/useChimeToggles'
import { setBroadcasting } from '../../lib/audioStreamState'
import { apiGet, apiPost } from '../../lib/api'
// 마이크 청크는 `lib/api` 를 안 거치는 유일한 자리라(아래 TD-08 예외) 공통 머리글이 안 붙는다.
// 그래서 **여기서 직접** 붙인다. 이름표는 `lib/api` 가 쓰는 것과 **같은 한 벌**이다 —
// 새로 만들면 서버가 같은 탭을 두 사람으로 본다.
import { TAB_ID } from '../../lib/tabId'
// 현장(메인) PC 판정 — src/lib/isLocal.js 한 곳에서만 만든다(2026-09-02에 사본 넷을 합쳤다).
// 예전엔 이 파일 안에서만 같은 식을 두 번 다시 계산했다.
import { _IS_LOCAL as isLocal } from '../../lib/isLocal'
import { 마이크고르기 } from '../../lib/micPick'

const DEFAULT_MIC_GAIN = 2.5

// 차임벨/종료음 토글 — 브라우저(기기)별 기억, 기본값은 둘 다 켜짐
// 차임벨·종료음 켬/끔은 `hooks/useChimeToggles` 가 단일 출처다 — 목업에서 그 **옵션은
// 서랍**으로 내려가므로 두 곳이 같은 값을 봐야 한다. 각자 들고 있으면 서랍에서 끈 차임이
// 여기 반영이 안 돼서, **껐다고 믿는 차임이 그대로 울린다.**

// 무음 WAV Blob URL — iOS 오디오 세션 백그라운드 유지용
function makeSilentWavUrl(sec = 3, sr = 22050) {
  const N   = Math.round(sr * sec)
  const buf = new ArrayBuffer(44 + N * 2)
  const v   = new DataView(buf)
  const str = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + N * 2, true)
  str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true)
  v.setUint16(32, 2, true);  v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, N * 2, true)
  // data 영역은 모두 0 (무음)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

/**
 * 즉시 방송(누르고 말하기).
 *
 * `tone` 은 **색만** 바꾼다 — 동작·상태·API 는 하나도 갈라지지 않는다.
 *   'easy'(기본) 쉬운화면의 초록. **기본값이라 기존 화면은 한 글자도 안 바뀐다.**
 *   'v3'        통합 홈. 색은 셋뿐이라는 규칙(2026-09-13)에 맞춰 초록을 쓰지 않고
 *               말(TTS) 파랑을 쓴다. 방송 중 빨강은 **양쪽 다 그대로다** —
 *               "지금 소리가 나가고 있다"는 표시는 색 규칙보다 우선한다.
 */
export default function InstantBroadcast({ tone = 'easy', variant = 'card' }) {
  const v3 = tone === 'v3'
  // **알약 한 알**(목업 v3 의 `.miclive`). 큰 카드가 아니라 화면에 늘 떠 있는 단추 하나이고,
  // 옵션(차임벨·종료음)은 **서랍**으로 내려간다. 카드를 두르면 배경 물감을 가린다(G-21·G-36).
  const pill = variant === 'pill'
  // 색 묶음을 한 자리에 모은다. 여러 곳에 조건을 흩으면 한 곳만 고치게 된다.
  // **테두리 색은 클래스로 못 준다.** `.easy-card` 가 `@layer utilities` 안에서
  // `@apply border border-ds-v3-line` 를 하는데, 그 규칙이 생성된 `.border-*` 유틸리티보다
  // **뒤에** 나온다(실측: easy-card @60768 vs border-ds-v3-tts-line @21746). 특이도가 같아서
  // 뒤가 이긴다 — 클래스로 주면 조용히 회색이 된다(V② 적대 검수 2026-09-13).
  // 그래서 v3 만 인라인으로 준다. **색을 다시 적는 것이 아니라 토큰 이름을 그대로 쓴다.**
  // (같은 이유로 아래 `isBroadcasting` 의 `border-ds-v3-warn-bg` 도 **원래부터** 안 먹고 있었다.
  //  그건 이 작업이 만든 것이 아니라 물려받은 것이라 여기서 건드리지 않는다 — TODO 에 적는다.)
  const SKIN = v3
    ? { card: 'bg-ds-v3-tts-bg', cardStyle: { borderColor: 'var(--ds-v3-tts-line)' },
        icon: 'text-ds-v3-tts',
        accent: 'accent-[color:var(--ds-v3-tts)]', go: 'bg-ds-v3-tts hover:opacity-90' }
    : { card: 'bg-ds-v3-surface-2', cardStyle: undefined, icon: 'text-ds-v3-ink-3',
        accent: 'accent-ds-v3-ink-2', go: 'bg-ds-v3-ink-3 hover:bg-ds-v3-ink-2' }
  const [state,    setState]    = useState('idle')  // idle | broadcasting | error
  const [errMsg,   setErrMsg]   = useState('')
  const [httpsUrl, setHttpsUrl] = useState('')
  // HTTPS 가 **꺼져 있는지 확실히 아는가** — 인증서가 없는 PC(새 설치본)는 3443 을 아예 안 연다.
  const [https꺼짐, setHttps꺼짐] = useState(false)
  const { chime: useChime, endChime: useEndChime, setChime, setEndChime } = useChimeToggles()

  // 다른 기기의 마이크 생방송 (2026-09-03 실기 신고 — 폰으로 방송하면 홀에서 소리가
  // 나는데 PC 화면은 아무 표시가 없었다). 서버 신호등(micLive)의 mic_live SSE를 듣는다.
  // 내가 방송 중일 때는 그 청크가 내 것이라 표시하지 않는다.
  const [remoteLive, setRemoteLive] = useState(false)
  useEffect(() => {
    const onLive = (e) => setRemoteLive(!!e.detail?.on)
    window.addEventListener('carecast:mic-live', onLive)
    return () => window.removeEventListener('carecast:mic-live', onLive)
  }, [])

  // 오류 안내를 몇 초 뒤 지우는 타이머 (레드 검증 화면 발견4, 2026-09-03).
  // 되돌림은 **error일 때만** idle로 내린다 — 안내가 떠 있는 사이 새 방송을 시작하면
  // 낡은 타이머가 방송 중 화면을 idle로 뒤집어 시작 버튼이 다시 뜬다(이중 송출 유도).
  // 새 안내가 뜨면 앞 타이머를 걷고, 창을 떠날 때도 걷는다.
  const errDismissRef = useRef(null)
  const dismissErrorLater = useCallback((ms) => {
    clearTimeout(errDismissRef.current)
    errDismissRef.current = setTimeout(() => setState(s => (s === 'error' ? 'idle' : s)), ms)
  }, [])
  useEffect(() => () => clearTimeout(errDismissRef.current), [])

  const toggleChime    = setChime
  const toggleEndChime = setEndChime

  // **몇 초째 나가고 있나.** 알약 하나에는 "방송 중"이라고만 적을 자리밖에 없는데,
  // 그것만으로는 *"아까 켜 두고 잊은 것"* 과 *"방금 켠 것"* 이 안 갈린다.
  // 마이크가 켜진 줄 모르고 딴 얘기를 하는 것이 이 화면의 가장 비싼 실패라 시간을 센다.
  // **되돌리기는 effect 가 아니라 손이 한다.** effect 안에서 `set초(0)` 을 하면 방송을 끌
   // 때마다 렌더가 한 번 더 돌고, 렌더 중에 `Date.now()` 를 읽으면 순수하지 않다 —
  // 둘 다 lint 가 잡는 자리다. 그래서 **세는 것만 effect**, **0 으로 돌리는 것은
  // 시작 단추**(아래 `startBroadcast`)가 한다.
  const [초, set초] = useState(0)
  const [보여주기, set보여주기] = useState(false)
  useTourStage({ 'mic.demo': (on) => set보여주기(!!on) })
  useEffect(() => {
    if (state !== 'broadcasting') return
    const t0 = Date.now()
    const id = setInterval(() => set초(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [state])
  const 경과 = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const wsRef          = useRef(null)
  const ctxRef         = useRef(null)
  const procRef        = useRef(null)
  const gainNodeRef    = useRef(null)
  const streamRef      = useRef(null)
  const httpMode       = useRef(false)
  // 남이 마이크를 쓰고 있어서 내 청크가 거절됐을 때 쓴다(P-117 후속). 청크마다 409 가
  // 오므로 **한 번만** 끊는다. 정지 함수는 아래에서 선언되므로 ref 로 건너 잡는다.
  const 충돌끊기Ref    = useRef(null)
  const 충돌알림함     = useRef(false)
  // **이번 방송이 몇 번째인가.** `fetch` 는 취소되지 않으므로, 정지한 뒤에도 앞 방송이
  // 보낸 청크의 409 가 뒤늦게 도착한다. 그것이 **다음 방송을 끊었다**(Codex 3차 검수
  // 2026-09-11). 보낼 때의 번호를 응답에서 다시 견줘, 지난 방송의 답은 버린다.
  const 방송회차       = useRef(0)
  const wakeLockRef    = useRef(null)
  const silentAudioRef = useRef(null)
  const visHandlerRef  = useRef(null)

  // VolumePanel 마이크 슬라이더와 실시간 연동
  useEffect(() => {
    const handler = (e) => {
      if (gainNodeRef.current) gainNodeRef.current.gain.value = e.detail
    }
    window.addEventListener('carecast:mic-gain', handler)
    return () => window.removeEventListener('carecast:mic-gain', handler)
  }, [])

  // HTTP + LAN IP 환경이면 HTTPS URL 미리 계산
  useEffect(() => {
    const isHttp  = window.location.protocol === 'http:'
    if (!isHttp || isLocal) return
    apiGet('/api/server-info').then(d => {
      // ── **안 열린 주소로 보내지 않는다** (사용자 신고 2026-09-17 「권한 주소로 들어가면 먹통」) ──
      // 설치본에는 HTTPS 인증서가 없어 3443 이 열려 있지 않은데, 화면은 그 주소로 가라고 했다 →
      // 휴대폰이 시간 초과까지 멈춘 것처럼 보였다. 서버가 꺼져 있다고 말하면 주소 대신 방법을 알린다.
      if (d && d.httpsEnabled === false) { setHttps꺼짐(true); return }
      setHttpsUrl(`https://${window.location.hostname}:${d.httpsPort || 3443}`)
    }).catch(() => {
      setHttpsUrl(`https://${window.location.hostname}:3443`)
    })
  }, [])

  const cleanup = useCallback(() => {
    setBroadcasting(false)
    httpMode.current = false
    window.dispatchEvent(new CustomEvent('carecast:broadcast-tts-end'))

    // visibilitychange 리스너 해제
    if (visHandlerRef.current) {
      document.removeEventListener('visibilitychange', visHandlerRef.current)
      visHandlerRef.current = null
    }
    // 화면 잠금 방지 해제 (Wake Lock)
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
    // 무음 오디오 정지 및 Blob URL 해제
    if (silentAudioRef.current) {
      silentAudioRef.current.pause()
      URL.revokeObjectURL(silentAudioRef.current.src)
      silentAudioRef.current = null
    }

    if (procRef.current)   { procRef.current.disconnect();                         procRef.current   = null }
    if (gainNodeRef.current) { gainNodeRef.current.disconnect();                   gainNodeRef.current = null }
    if (ctxRef.current)    { ctxRef.current.close();                               ctxRef.current    = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (wsRef.current)     { wsRef.current.close();                                wsRef.current     = null }
  }, [])

  // 화면을 떠날 때도 회차를 올린다 — 마이크 권한 창이 떠 있는 동안 화면을 옮기면, 뒤늦게 끝난
  // 시작 처리가 **떠난 화면에서 마이크를 다시 켰다**(전문가 1차 검토 1-5).
  useEffect(() => () => { 방송회차.current += 1; cleanup() }, [cleanup])

  const startBroadcast = useCallback(async () => {
    // **처음 안내 중에는 마이크 방송을 시작하지 않는다** (2026-09-17 독립 검수 F2). 목소리는 WebSocket·직접 fetch 로
    // 나가 `api.js` 의 안내 중 차단을 안 지난다 — 막이 마우스는 받지만 키보드(Tab+Enter)로는 이 단추가 눌렸다.
    if (안내중()) return
    setErrMsg('')
    set초(0)   // 경과 시간은 여기서 0 으로 돌린다 — effect 가 아니라 손이 하는 일이다
    // 지난번 충돌 알림을 지운다 — 안 지우면 **다음 방송에서 409 가 와도 조용하다**
    // (한 번만 알리는 장치가 영영 닫힌 채로 남는다).
    충돌알림함.current = false
    // 회차를 올린다. 앞 방송이 남긴 응답은 이 번호와 달라 아래에서 버려진다.
    // **이 시작 처리 자신도 같은 번호로 확인한다**(전문가 1차 검토 1-5). 아래 `await` 마다 정지·화면
    // 이탈·**새 시작**이 끼어들 수 있다. 번호가 바뀌었으면 `물러나기` — **이 시작이 만든 것은 전부 닫고**,
    // ref 는 아직 내 것을 가리킬 때만 비운다. 정지 없이 새 시작이 끼어들면 ref 는 이미 새 방송 것이라,
    // ref 기준으로 닫으면 새 방송을 끊고 ref 를 안 보면 내 마이크가 열린 채 남는다(2026-11-01 검수).
    // 두 번 닫아도 안전하다(track.stop 은 멱등, ctx.close 의 거절은 받아 넘긴다).
    const 회차 = (방송회차.current += 1)
    const 늦었나 = () => 회차 !== 방송회차.current
    const 내것 = {}
    const 물러나기 = () => {
      const 비우기 = (ref, v) => { if (v && ref.current === v) ref.current = null }
      내것.stream?.getTracks().forEach(t => t.stop());                       비우기(streamRef, 내것.stream)
      if (내것.ctx)    { 내것.ctx.close().catch(() => {});                    비우기(ctxRef, 내것.ctx) }
      if (내것.silent) { 내것.silent.pause(); URL.revokeObjectURL(내것.silent.src); 비우기(silentAudioRef, 내것.silent) }
      if (내것.lock)   { 내것.lock.release().catch(() => {});                 비우기(wakeLockRef, 내것.lock) }
      if (내것.vis)    { document.removeEventListener('visibilitychange', 내것.vis); 비우기(visHandlerRef, 내것.vis) }
      if (내것.ws)     { 내것.ws.close();                                     비우기(wsRef, 내것.ws) }
      비우기(gainNodeRef, 내것.gain)
      비우기(procRef, 내것.proc)
    }
    try {
      const isHttp  = window.location.protocol === 'http:'
      if (isHttp && !isLocal) {
        const url = httpsUrl || `https://${window.location.hostname}:3443`
        throw Object.assign(
          new Error(https꺼짐
            ? '휴대폰 마이크는 보안 접속(HTTPS)이 필요한데, 방송 PC 에 아직 인증서가 없습니다.\n방송 PC 의 설정 화면에서 「인증서 생성」 후 서버를 다시 시작해 주세요. 그 전에는 방송 PC 에서 「누르고 말하기」를 써 주세요.'
            : `모바일 마이크는 HTTPS 접속이 필요합니다.\n${url} 으로 접속하세요.`),
          { name: 'SecurityError' }
        )
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(
          new Error('이 브라우저에서는 마이크를 사용할 수 없습니다.'),
          { name: 'SecurityError' }
        )
      }

      // **신호가 있는 마이크를 고른다** (사용자 신고 2026-09-18 — 노트북 기본 녹음 장치가 소리 없는 장치로 잡혀
      // 차임만 나가고 목소리가 안 나갔다. 줌은 자기 설정에서 마이크를 골라 멀쩡했다). 자세한 규칙은 `마이크고르기`.
      const stream = await 마이크고르기()
      내것.stream = stream
      // 늦게 생긴 마이크는 바로 닫는다 — 안 닫으면 브라우저의 마이크 표시가 켜진 채 남는다.
      if (늦었나()) return 물러나기()
      streamRef.current = stream

      const ctx = 내것.ctx = new AudioContext()
      ctxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      if (늦었나()) return 물러나기()

      // ── 백그라운드 유지 처리 ───────────────────────────────────────
      // 1) 무음 오디오 루프 — iOS에서 화면 꺼져도 오디오 세션 유지
      const silentAudio = 내것.silent = new Audio(makeSilentWavUrl())
      silentAudio.loop   = true
      silentAudio.volume = 0.001  // 거의 무음이지만 0이면 세션 유지 안 됨
      await silentAudio.play().catch(() => {})
      if (늦었나()) return 물러나기()
      silentAudioRef.current = silentAudio

      // 2) Wake Lock — Android/Chrome에서 화면 꺼짐 방지
      try {
        const lock = 내것.lock = await navigator.wakeLock?.request('screen')
        if (늦었나()) return 물러나기()
        wakeLockRef.current = lock
      } catch { /* Wake Lock은 브라우저·기기에 따라 아예 없다 — 없으면 화면이 꺼질 수 있을 뿐 방송은 나간다 */ }
      if (늦었나()) return 물러나기()

      // 3) AudioContext 중단 시 자동 재개
      ctx.onstatechange = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      }
      const visHandler = () => {
        if (document.visibilityState === 'visible') {
          ctxRef.current?.resume().catch(() => {})
        }
      }
      내것.vis = visHandler
      visHandlerRef.current = visHandler
      document.addEventListener('visibilitychange', visHandler)
      // ─────────────────────────────────────────────────────────────

      // WebSocket 연결 시도
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      // `tab` 을 함께 보낸다 — 서버(`index.js:347`)가 이것을 주인 이름으로 쓴다. 안 보내면
      // 연결마다 이름을 지어내서, **같은 탭인데 HTTP 폴백과 다른 사람**이 된다(P-63 후속).
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/audio?role=broadcaster&tab=${encodeURIComponent(TAB_ID)}`)
      내것.ws = ws
      wsRef.current = ws

      try {
        await new Promise((resolve, reject) => {
          ws.onopen  = resolve
          ws.onerror = () => reject(new Error('ws'))
          setTimeout(() => reject(new Error('ws')), 3000)
        })
      } catch {
        if (늦었나()) return 물러나기()
        wsRef.current?.close()
        wsRef.current  = null
        httpMode.current = true
      }
      if (늦었나()) return 물러나기()

      // 마이크 → GainNode → ScriptProcessor → 무음 출력(피드백 방지)
      const source   = ctx.createMediaStreamSource(stream)
      const gainNode = 내것.gain = ctx.createGain()
      gainNode.gain.value = parseFloat(localStorage.getItem('carecast:micGain') || DEFAULT_MIC_GAIN)
      gainNodeRef.current = gainNode
      const proc = 내것.proc = ctx.createScriptProcessor(4096, 1, 1)
      procRef.current = proc
      const mute = ctx.createGain()
      mute.gain.value = 0
      source.connect(gainNode)
      gainNode.connect(proc)
      proc.connect(mute)
      mute.connect(ctx.destination)

      setState('broadcasting')

      if (useChime) {
        let 울리는중 = false
        try { 울리는중 = !!(await apiPost('/api/mic/chime?type=general', {}))?.울리는중 } catch (e) { console.error('[즉시방송] 차임벨 실패:', e.message) }  // 차임벨이 빠져도 본 방송은 이어서 나가야 한다
        // 서버가 「이미 울리기 시작했다」고 답하면 여유(1.8초)만 둔다 — 안내 음성의 차임 뒤 여유와 같은 값.
        await new Promise(r => setTimeout(r, 울리는중 ? 1800 : 2600))
      }
      // 차임 대기 중에 정지했으면 「방송 중」으로 바꾸지 않는다 — 화면이 방송 중으로 남고 소리 조각이 나갔다.
      if (늦었나()) return 물러나기()

      setBroadcasting(true)
      window.dispatchEvent(new CustomEvent('carecast:broadcast-tts-start'))

      proc.onaudioprocess = (e) => {
        const raw = e.inputBuffer.getChannelData(0)  // GainNode 통과 후 증폭된 값
        const f32 = new Float32Array(1 + raw.length)
        f32[0] = ctx.sampleRate
        for (let i = 0; i < raw.length; i++) {
          f32[i + 1] = Math.max(-1, Math.min(1, raw[i]))  // 클리핑 방지
        }

        if (!httpMode.current && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(f32.buffer)
        } else {
          // 여기만 lib/api를 안 쓴다(TD-08 예외). 마이크 조각을 **바이너리 그대로**
          // 올린다 — apiPost는 JSON.stringify를 거치므로 ArrayBuffer가 "{}"가 된다.
          //
          // **그래서 이름표도 여기서 직접 붙인다**(P-63 후속, Codex 독립 검수 2026-09-11).
          // 서버(`routes/mic.js:75`)는 이 머리글을 읽는데 화면이 안 보내고 있었다.
          // 안 보내면 `micOwner.주인인가(undefined)` 가 하위 호환으로 **무조건 통과**라,
          // 소유권 검사가 서 있는 채로 **한 번도 작동하지 않았다.**
          // 보낼 때의 회차를 적어 둔다 — 응답이 돌아왔을 때 그 방송이 아직 살아 있는지 본다.
          const 보낸회차 = 방송회차.current
          fetch('/api/mic/stream', {
            method:  'POST',
            headers: {
              'Content-Type':   'application/octet-stream',
              'X-CareCast-Tab': TAB_ID,
            },
            body:    f32.buffer,
          }).then((r) => {
            // **지난 방송의 답은 버린다.** `fetch` 는 취소되지 않아서, 정지한 뒤에도 앞
            // 방송의 409 가 뒤늦게 온다. 그것을 처리하면 **막 시작한 다음 방송이 끊긴다.**
            if (보낸회차 !== 방송회차.current) return
            // **409 는 삼키지 않는다.** 조용히 버리면 보낸 사람은 자기 목소리가 나가는 줄
            // 안다 — 이 결함이 고치려던 것과 **같은 종류의 침묵**이다(CC-008 delivery-truth).
            //
            // **문구만 띄우면 안 된다.** 오류 문구는 `state === 'error'` 일 때만 그려지는데
            // 이 시점 상태는 `'broadcasting'` 이라, `setErrMsg` 만 하면 화면은 그대로
            // "방송 중"이고 사람은 계속 말한다(Codex 재검수 2026-09-11 지적).
            // 그래서 **현장 「정지」와 같은 길**로 보낸다 — 끊고, 이유를 남기고, 오류로 바꾼다.
            // 청크마다 409 가 오므로 한 번만 한다.
            if (r.status === 409 && !충돌알림함.current) {
              충돌알림함.current = true
              충돌끊기Ref.current?.()
              setErrMsg('다른 기기가 마이크 방송 중입니다. 그 기기에서 먼저 끝내 주세요.')
              setState('error')
              // **오류 상태에서 시작 버튼이 잠긴다.** 안 풀면 상대가 방송을 끝내도
              // 이 화면은 영영 다시 못 켠다(Codex 재검수 2026-09-11).
              // 「정지」로 끊긴 경우와 성격이 같다 — 남이 끊었고 사람이 다시 시작해야 한다.
              // 그래서 **같은 5초**를 쓴다. 문구를 읽을 시간은 되고, 그 뒤 스스로 풀린다.
              dismissErrorLater(5000)
            }
          }).catch(() => { /* 청크 하나가 못 간 것은 다음 청크가 덮는다 — 여기서 화면을 흔들지 않는다 */ })
        }
      }

    } catch (e) {
      // 이미 정지·이탈한 시작의 오류는 화면에 띄우지 않는다 — cleanup 이 새 방송을 끊는다. 내 것만 닫는다.
      if (늦었나()) return 물러나기()
      const msg = e.name === 'NotAllowedError' ? '마이크 권한이 거부됐습니다.'
        : e.name === 'NotFoundError'           ? '마이크가 연결되어 있지 않습니다.'
        : `오류: ${e.message}`
      setErrMsg(msg)
      setState('error')
      cleanup()
      dismissErrorLater(3000)
    }
  }, [cleanup, httpsUrl, https꺼짐, useChime, dismissErrorLater])

  const stopBroadcast = useCallback(() => {
    cleanup()
    // 여기서도 회차를 올린다. 정지한 뒤 다시 시작하지 않아도 앞 청크의 409 는 도착하는데,
    // 그때 오류 화면을 띄우면 **이미 끝낸 방송 때문에 가만히 있던 화면이 빨개진다.**
    방송회차.current += 1
    setState('idle')
    // 내가 방송 중에 받은 켜짐 신호는 **내 청크**가 만든 것이다. 서버의 꺼짐 신호는 최대
    // 3초 뒤에 오는데, 그 사이 "다른 기기에서 방송 중"이 뜨면 방금 내가 껐는데 남이 하는
    // 줄 안다(2026-09-03 레드 검증 발견7). 여기서 지운다 — 진짜 남의 방송이면 다음 청크가
    // 다시 켠다. 렌더나 effect가 아니라 **정지를 누른 그 자리**에서 지우는 것이 규칙에 맞다.
    setRemoteLive(false)
    if (useEndChime) {
      apiPost('/api/mic/chime?type=end', {}).catch(() => {})
    }
  }, [cleanup, useEndChime])

  // 청크 전송부는 이 함수보다 **먼저** 선언돼서 이름으로 못 부른다. ref 로 건너 잡는다
  // (P-117 후속). 함수를 위로 올리지 않는 이유는 `cleanup`·`useEndChime` 의존이 그쪽에
  // 있어서다 — 순서를 바꾸면 무관한 것이 여럿 따라 움직인다.
  useEffect(() => { 충돌끊기Ref.current = stopBroadcast }, [stopBroadcast])

  // 현장 「정지」가 마이크 생방송도 끊는다 (td09 H10, 사용자 결정 2026-09-02).
  // 다른 PC의 정지는 서버의 broadcast_stopped SSE → stop-broadcast 변환으로, 같은 창의
  // 정지는 window 이벤트로 여기 닿는다 — 새 신호 없이 "정지는 하나의 길" 그대로다.
  // 방송 중일 때만 구독한다. 끊긴 이유를 화면에 남긴다 — 조용히 끊기면 말하던 사람은
  // 계속 말하고(홀만 조용) 장비 고장으로 안다.
  useEffect(() => {
    if (state !== 'broadcasting') return
    const onForceStop = (e) => {
      // 흐름이 스스로 단계를 끊은 것(byUser:false)은 자동방송의 진행이다 — H10: 자동은 마이크를
      // 안 끊는다. 사람이 누른 정지(detail 없음 또는 byUser:true)만 여기서 마이크를 내린다.
      if (e?.detail?.byUser === false) return
      stopBroadcast()
      setErrMsg('현장에서 「정지」 버튼을 눌러 방송이 중단되었습니다.')
      setState('error')
      dismissErrorLater(5000)
    }
    window.addEventListener('carecast:stop-broadcast', onForceStop)
    return () => window.removeEventListener('carecast:stop-broadcast', onForceStop)
  }, [state, stopBroadcast, dismissErrorLater])

  const isBroadcasting = state === 'broadcasting'

  // ── 알약 한 알 (목업 v3) ────────────────────────────────────────────────
  // **동작은 목업을 따르지 않는다**(가이드라인 G-43, 사용자 결정 2026-09-13).
  // 목업은 `mouseleave` 에서 끊는 "누르고 있는 동안"이라, 마우스가 1px 벗어나면 소리가
  // 끊긴다. 요양원 안내는 문장이 여럿이고 장갑 낀 손·터치 스크롤이 그 사이에 낀다 —
  // **문장 중간에 소리가 사라지는 실패는 되돌릴 수 없다.** 그래서 **토글**이다.
  //
  // 방송 중 표시는 색 하나로 안 한다(G-44): **빨강 + 맥박 점 + 글자 + 경과 시간** 넷.
  // "내 목소리가 나가는 줄 모르고 말하는 것"도 "안 나가는 줄 모르는 것"도 둘 다 비싸다.
  if (pill) {
    // 처음 안내(N18)가 켜진 모습만 보인다 — `보여주기` 는 **녹음·전송을 시작하지 않는다**(startBroadcast 를 안 부른다).
    const 켜짐 = isBroadcasting || 보여주기
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={isBroadcasting ? stopBroadcast : startBroadcast}
            disabled={state === 'error'}
            aria-pressed={isBroadcasting}
            data-tour="mic"
            className={'inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-sm font-semibold '
              + 'backdrop-blur-[6px] transition-colors disabled:opacity-60 '
              + (켜짐
                ? 'border border-ds-v3-bgm bg-ds-v3-bgm text-white'
                : 'border border-ds-v3-line-2 bg-white/80 text-ds-v3-ink hover:bg-white')}>
            {켜짐
              ? <><span className="h-2 w-2 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
                  방송 중 · {경과(보여주기 ? 3 : 초)}<Square size={13} className="ml-1" /></>
              : <><Mic size={16} strokeWidth={1.9} /> 누르고 말하기</>}
          </button>
          {/* 남이 방송 중인 것은 **내 단추 밖**에 적는다 — 단추 안에 섞으면 누가 말하는지 갈린다 */}
          {!isBroadcasting && remoteLive && (
            <span className="text-[13px] font-semibold text-ds-v3-bgm" role="status">
              ● 다른 기기에서 방송 중
            </span>
          )}
        </div>
        {/* 오류는 지우지 않는다 — 왜 안 나갔는지가 이 화면에서 가장 비싼 정보다 */}
        {state === 'error' && (
          <p className="m-0 whitespace-pre-line text-center text-[13px] text-ds-v3-bgm" role="alert">{errMsg}</p>
        )}
        {httpsUrl && !isBroadcasting && (
          // 초기 설정의 「마이크용」 QR 을 뺀 대신(2026-09-17) 여기서 보안 화면으로 넘긴다.
          // 처음 한 번은 휴대폰이 경고를 띄운다 — 인증서가 시설 안에서 만든 것이라 없앨 수 없어, 넘기는 법을 적는다.
          <a href={httpsUrl} className="text-center text-[13px] leading-snug text-ds-v3-ink-2">
            <span className="font-semibold underline">휴대폰 마이크 쓰기 — 여기를 누르세요</span><br />
            처음 한 번 경고가 뜨면 아이폰은 「세부사항 보기 → 이 웹사이트 방문」, 안드로이드는 「고급 → 계속」
          </a>
        )}
      </div>
    )
  }

  return (
    <div className={`easy-card flex flex-col gap-2 ${isBroadcasting ? 'bg-ds-v3-warn-bg border-ds-v3-warn-bg' : SKIN.card}`}
      style={{ minHeight: 'auto', ...(isBroadcasting ? null : SKIN.cardStyle) }}>
      <div className="flex items-center gap-2">
        <Mic size={16} className={isBroadcasting ? 'text-ds-v3-warn' : SKIN.icon} />
        <h3 className="text-base font-semibold text-ds-v3-ink">즉시 방송</h3>
        <HelpTip id="instantBroadcast" />
        {isBroadcasting && (
          <span className="ml-auto text-sm text-ds-v3-warn font-semibold animate-pulse">● 방송 중</span>
        )}
        {!isBroadcasting && remoteLive && (
          <span className="ml-auto text-sm text-ds-v3-warn font-semibold animate-pulse">● 다른 기기에서 방송 중</span>
        )}
      </div>

      {/* HTTP LAN 접속 시 HTTPS 안내 배너 */}
      {httpsUrl && !isBroadcasting && (
        <a href={httpsUrl}
          className="flex items-start gap-1.5 bg-ds-v3-surface-2 border border-ds-v3-line rounded-lg px-2.5 py-2 text-xs text-ds-v3-ink-2 leading-snug">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>마이크 사용은 HTTPS 접속 필요<br />
            <span className="font-mono underline">{httpsUrl}</span>
          </span>
        </a>
      )}

      {state === 'error' && (
        <p className="text-sm text-ds-v3-warn leading-snug flex-1 whitespace-pre-line">{errMsg}</p>
      )}

      {/* 차임벨/종료음 토글 — 방송 중이 아닐 때만 표시.
          모바일(2열 그리드라 카드가 좁음)은 세로로, 데스크톱(카드 폭 넓음)은 가로로 */}
      {!isBroadcasting && (
        <div className="flex flex-col md:flex-row md:items-center gap-1.5 md:gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useChime}
              onChange={e => toggleChime(e.target.checked)}
              className={`w-4 h-4 flex-shrink-0 ${SKIN.accent}`}
            />
            <span className="text-sm text-ds-v3-ink-2 whitespace-nowrap">차임벨</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useEndChime}
              onChange={e => toggleEndChime(e.target.checked)}
              className={`w-4 h-4 flex-shrink-0 ${SKIN.accent}`}
            />
            <span className="text-sm text-ds-v3-ink-2 whitespace-nowrap">종료음</span>
          </label>
        </div>
      )}

      <button
        onClick={isBroadcasting ? stopBroadcast : startBroadcast}
        disabled={state === 'error'}
        className={`flex items-center justify-center gap-2 text-white rounded-btn py-3.5
                    text-base font-semibold btn-press transition-colors disabled:opacity-60
                    ${isBroadcasting ? 'bg-ds-v3-warn hover:bg-ds-v3-warn' : SKIN.go} min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]`}
      >
        {isBroadcasting
          ? <><Square size={15} /> 방송 종료</>
          : <><Radio size={16} /> 방송 시작</>}
      </button>
    </div>
  )
}
