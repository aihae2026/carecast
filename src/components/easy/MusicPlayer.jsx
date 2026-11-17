import { useState, useEffect, useRef, useCallback } from 'react'
import { Music2, Play, Pause, SkipForward, Volume2 } from 'lucide-react'
import { API_URL, apiGet, audioEnded as audioEndedAPI, postNowPlaying, openSSEBus, getAudioSubtitle } from '../../lib/api'

import { _IS_LOCAL } from '../../lib/isLocal'
import { audioBus } from '../../lib/audioBus'
import { playBrowserChime } from '../../lib/browserChime'
// 정지 페이드 길이와 마감 계산의 정본 — 숫자를 여기 또 적지 않는다(UX-17, 예약 안내 꼬리와 같은 값).
import { BGM_STOP_FADE_MS, 남은페이드ms } from '../../lib/bgmFade'

function formatTime(sec) {
  const s = Math.floor(sec || 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 음원 자막을 화면에 올린다.
//
// 재생하는 그 파일 것만 그때 받아 온다 — 목록에 얹으면 화면을 열 때마다 자막 덩어리가 전부
// 따라온다(3분짜리 녹음 문안이 10KB를 넘는다).
//
// **확인된 것(ready)만 나간다.** 받아쓰기나 AI가 만든 초안은 사람이 올리기 전까지 방송
// 화면에 안 뜬다 — 잘못 들은 자막이 홀에 그대로 뜨는 것이 여기서 가장 나쁜 결과다.
async function showAudioCaption(audioFileId, name, gapless, rate) {
  if (!audioFileId) return
  const at = Date.now()
  try {
    const { subtitle } = await getAudioSubtitle(audioFileId)
    if (subtitle?.status !== 'ready') return
    // 소리는 페이드 1.2초 + 지연 1.3초 뒤에 시작한다(gapless면 바로 잇는다). 자막을 받아 오는 데
    // 쓴 시간을 빼 줘야 소리를 안 내는 창의 추정 시계가 그만큼 앞서지 않는다.
    const leadMs = Math.max(0, (gapless ? 0 : 2500) - (Date.now() - at))
    window.dispatchEvent(new CustomEvent('carecast:caption-cue', {
      detail: {
        kind: 'prayer', title: name || '', cues: subtitle.cues, leadMs,
        rate: (typeof rate === 'number' && rate >= 0.5 && rate <= 1.5) ? rate : 1,
      },
    }))
  } catch (e) {
    // 자막을 못 받는 것은 방송 실패가 아니다 — 소리는 그대로 나간다.
    console.error('[자막] 음원 자막을 받지 못했습니다(소리는 정상):', e.message)
  }
}


// 하단 고정 BGM 플레이어 — SSE bgm_start / bgm_stop / prayer_play / prayer_schedule_play / chime_play 이벤트로 제어됨
// ── BGM 이 **저절로** 바뀌거나 끝날 때도 알린다 (Codex 3단계 2회차 Medium) ──────────────────
// 멈추기·시작 경로만 서버(now-playing)에 보고했더니, 1곡짜리가 끝까지 재생돼 멎어도 서버는 「재생 중」,
// 다음 곡으로 넘어가도 첫 곡 이름을 들고 있었다. 그 값을 배경음악 카드(원격 PC)가 읽고,
// 서버 차임(chimePlayer 부수차임막힘)도 읽는다 — 그래서 카드엔 「멈추기」가 남고 즉시 안내의 차임이 빠졌다.
//
// **방송이 깐 반주(owner 있음)면 방송 화면 제목은 건드리지 않는다** (Codex 3단계 3회차 Low, ④ 첫 커밋에서 고침).
// 예약 안내가 반주를 깔면 화면 제목은 그 안내 제목이다(useScheduledBroadcast) — 반주 곡이 넘어가거나 끝날 때
// 🎵 곡 이름·빈 칸으로 덮으면 방송 중에 제목이 사라진다. 재생 상태 보고(서버·재생바·카드)는 그대로 한다.
function BGM곡알림(title, { 화면 = true } = {}) {
  if (화면) window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: `🎵 ${title}` } }))
  window.dispatchEvent(new CustomEvent('carecast:broadcast-bgm-start', { detail: { title } }))
  window.dispatchEvent(new CustomEvent('carecast:local-bgm-started', { detail: { title } }))
  postNowPlaying({ bgm: { title } }).catch(() => {})
}
function BGM끝알림({ 화면 = true } = {}) {
  if (화면) window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: '' } }))
  window.dispatchEvent(new CustomEvent('carecast:broadcast-bgm-stopped'))
  window.dispatchEvent(new CustomEvent('carecast:local-bgm-stopped'))
  postNowPlaying({ bgm: null }).catch(() => {})
}

export default function MusicPlayer() {
  const audioRef         = useRef(null)
  // [audioBus] 장부 등록 손잡이 — 오디오 1개가 역할 3개(로컬BGM·녹음 음원·직원멘트)를 돌므로
  // 등록도 하나만 유지한다(playURL이 이전 것을 내리고 새로 올린다)
  const busRef           = useRef(null)
  const fadeRef          = useRef(null)   // 현재 실행 중인 fade 인터벌 ID
  const bgmStopRef       = useRef(null)   // bgm_stop 지연 타이머 ID
  const bgmDurationRef   = useRef(null)   // 재생 시간 제한 자동 정지 타이머
  const bgmStartDelayRef = useRef(null)   // bgm_start 350ms 딜레이 (앞 소리 300ms 페이드 완료 대기)
  const nomVolRef        = useRef(0.50)   // BGM 기준 볼륨 — **지금 재생의** 목표(방송별 값일 수 있다)
  // 시스템 BGM 볼륨(슬라이더·volume_change). 방송별 값(bgmDefault)이 nomVolRef 를 덮어도 이것은
  // 안 바뀐다 — 다음 재생이 볼륨을 안 실어 오면(식사 시간 자동 BGM) 여기로 돌아간다(2026-09-21 Codex).
  const globalBgmVolRef  = useRef(0.50)
  // 안내(TTS)가 흐르는 중인가 — 덕킹 중 다음 곡으로 넘어가도 덕킹 음량으로 들어가게(2026-09-21 Codex).
  const duckedRef        = useRef(false)
  // 예약 녹음 음원이 시작될 때 앞 반주를 페이드 뒤 멈추는 타이머 — 녹음 음원이 먼저 시작하면 playURL 이 걷는다.
  const 녹음전정지Ref      = useRef(null)
  // 녹음 음원을 앞 소리 페이드(1.2초) 뒤에 시작하는 1.3초 타이머(전문가 1차 검토 1-5).
  // 정지·화면 이탈 때 걷지 않으면 **정지를 누른 뒤에 녹음 음원이 나온다.**
  const 녹음시작Ref        = useRef(null)
  const broadcastVolRef  = useRef(0.80)   // TTS 방송 볼륨 (하위호환용)
  // 이 재생에만 적용할 볼륨(0~1). 서버가 예약의 main_volume을 실어 보내면 채워지고,
  // 그 음원이 끝나면 비운다 — 음량 슬라이더(audioVolRef 등)는 건드리지 않는다.
  const playOverrideRef  = useRef(null)
  // 이 재생에만 적용할 배속(0.5~1.5). 예약의 playback_rate가 실려 오면 채워지고, 끝나면 비운다.
  // 노래방 방송처럼 어르신들이 따라 부르는 음원을 느리게 트는 용도.
  const playRateRef      = useRef(null)
  const audioVolRef      = useRef(1.00)   // 녹음 음원 볼륨 (별도 제어)

  // playRef: 클로저 문제 방지용 재생 상태 ref
  const playRef  = useRef({
    playlist:        [],
    idx:             0,
    isPrayer:        false,
    isStaff:         false,
    afterPrayerStaff: false,
    savedBGM:        null,
  })

  const [ui, setUI] = useState({
    name:        null,
    playing:     false,
    progress:    0,
    currentTime: '0:00',
    duration:    '0:00',
    active:      false,
    isPrayer:    false,
    isStaff:     false,
  })

  // 볼륨 페이드 유틸 — target(0~1)으로 ms 동안 부드럽게 전환
  const fadeTo = useCallback((target, ms) => {
    if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null }
    const audio = audioRef.current
    if (!audio) return
    if (ms <= 0) { audio.volume = Math.max(0, Math.min(1, target)); return }
    const from  = audio.volume
    const steps = Math.max(1, Math.round(ms / 40))
    let step = 0
    fadeRef.current = setInterval(() => {
      step++
      const a = audioRef.current
      if (!a) { clearInterval(fadeRef.current); fadeRef.current = null; return }
      a.volume = Math.max(0, Math.min(1, from + (target - from) * (step / steps)))
      if (step >= steps) { clearInterval(fadeRef.current); fadeRef.current = null }
    }, 40)
  }, [])

  const playURL = useCallback((url, name) => {
    const audio = audioRef.current
    if (!audio) return
    // **앞 소리의 페이드·멈춤 예약을 먼저 걷는다**(2026-09-21 Codex 3회차). 안 걷으면 반주를 줄이던
    // 페이드가 새로 시작한 녹음 음원·직원멘트의 음량까지 0 으로 끌어내려, 재생은 되는데 소리가 안 났다.
    if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null }
    if (녹음전정지Ref.current) { clearTimeout(녹음전정지Ref.current); 녹음전정지Ref.current = null }
    const { isPrayer, isStaff } = playRef.current
    const isBGM = !isPrayer && !isStaff
    // BGM: 볼륨 0에서 페이드 인 / 녹음 음원: audioVolRef / 직원멘트: broadcastVolRef
    if (isBGM)                              audio.volume = 0
    else if (playOverrideRef.current != null) audio.volume = playOverrideRef.current
    else if (isPrayer)                       audio.volume = audioVolRef.current
    else                                     audio.volume = broadcastVolRef.current
    audio.src = API_URL + url
    // 배속은 매번 명시한다 — playbackRate는 곡을 바꿔도 남아 있어서, 안 정하면 앞 방송의
    // 느린 속도가 다음 방송까지 따라간다. preservesPitch로 음정은 지킨다(따라 부르려면 필수).
    try { audio.preservesPitch = true } catch { /* 지원 안 하는 브라우저는 그냥 둔다 */ }
    audio.playbackRate = (isPrayer && playRateRef.current) ? playRateRef.current : 1
    audio.play().catch(() => {
      // autoplay 차단 시 muted play → 즉시 unmute (muted autoplay는 항상 허용)
      audio.muted = true
      audio.play().then(() => { audio.muted = false }).catch(() => {})
    })
    // [audioBus] 이 오디오가 내는 소리 등록 — kind는 지금 역할로(td09 §1 #2, 기록만)
    busRef.current?.done()
    busRef.current = audioBus.register({
      kind: isPrayer ? 'prayer' : isStaff ? 'staff' : 'bgm-local', label: name || '',
    })
    // 안내가 흐르는 중이면 덕킹 음량으로 들어간다 — 예전엔 곡이 바뀌는 순간 제 음량까지 올라가
    // 안내 위로 배경음악이 커졌다(2026-09-21 Codex 재현). 덕킹 비율은 duckHandler 와 같다.
    if (isBGM) fadeTo(duckedRef.current ? Math.max(0.2, nomVolRef.current * 0.35) : nomVolRef.current, 3000)
    // 자막이 이 순간부터 추정이 아니라 실제 재생 위치(currentTime)를 따라간다. BGM에는 자막이
    // 없으므로 넘기지 않는다 — 넘기면 앞 방송 자막이 BGM 시각을 따라가며 흘러간다.
    if (!isBGM) window.dispatchEvent(new CustomEvent('carecast:caption-attach', { detail: { audio } }))
    setUI(s => ({ ...s, playing: true, name, active: true, isPrayer, isStaff }))
  }, [fadeTo])

  // ── **일시정지** (사용자 지시 2026-09-15) ────────────────────────────────────
  // 재생바의 스페이스바·단추가 이 이벤트를 쏜다. 로컬 음원은 이 창의 `<audio>` 가
  // 내므로 그대로 멈췄다 잇는다.
  //
  // **정지와 다르다.** 정지는 곡을 버리고 장부에서 내리지만, 이것은 자리를 지킨 채
  // 멎는다 — 그래서 `busRef`·`fadeRef` 를 안 건드린다.
  useEffect(() => {
    const onPauseToggle = (e) => {
      const a = audioRef.current
      if (!a || !a.src) return
      if (e.detail?.멈춤) a.pause()
      // 다시 틀 때 실패해도 화면을 깨뜨리지 않는다 — 브라우저가 자동재생을 막을 수 있다.
      else a.play?.().catch(() => {})
    }
    window.addEventListener('carecast:pause-toggle', onPauseToggle)
    return () => window.removeEventListener('carecast:pause-toggle', onPauseToggle)
  }, [])

  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio

    // 현재 곡 종료 핸들러
    audio.addEventListener('ended', () => {
      // 예약 녹음 음원을 받아 오는 사이 **앞 곡이 끝난 것**이면 녹음 음원 종료가 아니다 — 무시한다
      // (2026-09-21 Codex 3회차: 이것을 녹음 음원 종료로 읽어 상태를 바꿨고, 정상 응답이 버려졌다).
      if (playRef.current.녹음대기) return
      // [audioBus] 곡 종료 — 장부에서 내린다(다음 곡·복귀 BGM은 playURL이 다시 올린다)
      busRef.current?.done(); busRef.current = null
      const { playlist, idx, isPrayer, isStaff, savedBGM, afterPrayerStaff } = playRef.current
      // 자막도 같이 내린다. 이어지는 음원이 있으면 그쪽 prayer_play가 새 자막을 올린다.
      if (isPrayer || isStaff) window.dispatchEvent(new CustomEvent('carecast:caption-end'))

      // 녹음 음원 종료 후 처리
      if (isPrayer) {
        // 서버 시퀀서에 음원 종료 알림 (다음 단계로 즉시 진행)
        // 이때 실제로 잰 재생시간도 같이 보낸다 — 서버는 audio_files.duration이 비어 있을 때만
        // 받아 적는다. 그래야 다음 방송부터 "모르는 파일" 상한(180초)에 기대지 않는다.
        const { prayerToken, prayerAudioFileId } = playRef.current
        const measured = audioRef.current?.duration
        if (prayerToken) {
          audioEndedAPI(prayerToken, Number.isFinite(measured) && measured > 0
            ? { audioFileId: prayerAudioFileId ?? undefined, duration: measured }
            : {}).catch(() => {})
        }
        playOverrideRef.current = null   // 이 재생에만 쓰던 값이라 끝나면 비운다
        playRateRef.current     = null

        if (afterPrayerStaff) {
          // 직원멘트 재생 후 BGM 재개
          const 직원상태 = playRef.current = { ...playRef.current, isPrayer: false, isStaff: true, afterPrayerStaff: false }
          setUI(s => ({ ...s, isPrayer: false, isStaff: true }))
          // 늦게 온 응답은 **지금 상태**를 본다(2026-09-21 Codex 2회차): 조회 전에 잡아 둔 savedBGM 을
          // 쓰면, 그 사이 반주의 주인이 끄라고 해서 지워진 반주가 되살아났다. 그 사이 다른 소리가
          // 시작했으면(상태가 바뀌었으면) 아무것도 안 한다.
          apiGet('/api/audio/random?category=staff')
            .then(data => {
              if (playRef.current !== 직원상태) return
              if (data?.url) {
                playURL(data.url, data.original_name || '직원멘트')
              } else {
                // 직원멘트 없으면 BGM 재개(지금도 되살릴 것이 남아 있을 때만)
                const 되살릴것 = 직원상태.savedBGM
                playRef.current = { ...(되살릴것 ?? {}), isPrayer: false, isStaff: false, savedBGM: null, afterPrayerStaff: false }
                const { playlist: bgm, idx: bi } = 되살릴것 ?? { playlist: [], idx: 0 }
                if (bgm?.length > 0) playURL(bgm[bi].url, bgm[bi].name)
                else setUI(s => ({ ...s, playing: false, active: false }))
              }
            })
            .catch(() => {
              if (playRef.current !== 직원상태) return
              playRef.current = { ...(직원상태.savedBGM ?? {}), isPrayer: false, isStaff: false, savedBGM: null, afterPrayerStaff: false }
              setUI(s => ({ ...s, playing: false, active: false }))
            })
          return
        }
        // 녹음 음원 종료 → BGM 재개
        const bgmState = savedBGM ?? { playlist: [], idx: 0 }
        playRef.current = { ...bgmState, isPrayer: false, isStaff: false, savedBGM: null, afterPrayerStaff: false }
        if (bgmState.playlist.length > 0) {
          playURL(bgmState.playlist[bgmState.idx].url, bgmState.playlist[bgmState.idx].name)
        } else if (prayerToken) {
          // token 있으면 서버 시퀀서가 다음 bgm_start 전송 예정 → active 유지 (UI 깜빡임 방지)
          setUI(s => ({ ...s, isPrayer: false, isStaff: false }))
        } else {
          setUI(s => ({ ...s, playing: false, active: false }))
        }
        return
      }

      // 직원멘트 종료 → BGM 재개
      if (isStaff) {
        const bgmState = savedBGM ?? { playlist: [], idx: 0 }
        playRef.current = { ...bgmState, isPrayer: false, isStaff: false, savedBGM: null, afterPrayerStaff: false }
        if (bgmState.playlist.length > 0) playURL(bgmState.playlist[bgmState.idx].url, bgmState.playlist[bgmState.idx].name)
        else setUI(s => ({ ...s, playing: false, active: false }))
        return
      }

      // **끄는 중이면 다음 곡으로 넘기지 않는다** (브라우저 시험 2026-09-22). 정지는 4초 페이드 뒤에
      // 멈추고 「멈췄다」는 처음에 알린다 — 그 사이 곡이 끝나 여기서 다음 곡을 틀면, 2초쯤 소리가
      // 나다 끊기고 마지막 알림이 「재생 시작」으로 남아 카드·재생바·서버가 **소리 없이 「재생 중」**이었다.
      // 뒷정리(재생목록 비우기·화면)는 멈춤 예약(bgmStopRef)이 맡는다.
      if (bgmStopRef.current) return

      // BGM 다음 곡
      if (playlist.length > 1) {
        const next = (idx + 1) % playlist.length
        playRef.current = { ...playRef.current, idx: next }
        playURL(playlist[next].url, playlist[next].name)
        BGM곡알림(playlist[next].name, { 화면: !playRef.current.owner })
      } else {
        setUI(s => ({ ...s, playing: false }))
        if (playlist.length === 1) BGM끝알림({ 화면: !playRef.current.owner })   // 한 곡이 끝까지 돌고 멎었다
      }
    })

    // 진행 상태 업데이트
    audio.addEventListener('timeupdate', () => {
      setUI(s => ({
        ...s,
        progress:    (audio.currentTime / (audio.duration || 1)) * 100,
        currentTime: formatTime(audio.currentTime),
        duration:    formatTime(audio.duration),
      }))
    })

    // SSE 이벤트 구독 (WiFi 끊김 시 자동 재연결)
    let sseDestroyed = false
    let sseTimer = null
    let es = null
    // 예약 TTS 가 로컬 BGM 을 깔 때 쓰는 창 이벤트 처리기(bindSSE 안에서 채운다 — 정리할 때 뗀다).
    let localStartHandler = null

    // 창에 하나뿐인 연결에 붙는다(lib/api의 openSSEBus). 예전에는 여기서 따로 열어서,
    // 창 하나가 SSE 소켓을 셋씩 물고 있었다 — 원격 창에서 화면이 "불러오는 중"에 갇힌 원인.
    // 다시 붙는 일도 공유 연결이 맡으므로 bindSSE는 **한 번만** 부른다
    // (예전에는 재연결마다 다시 불렀다. 핸들러 등록 말고는 하는 일이 없어 결과가 같다).
    function setupSSE() {
      if (sseDestroyed) return
      es = openSSEBus()
      bindSSE(es)
    }

    function bindSSE(es) {

    const stopBGM = () => {
      if (bgmStartDelayRef.current) { clearTimeout(bgmStartDelayRef.current); bgmStartDelayRef.current = null }
      if (bgmDurationRef.current) { clearTimeout(bgmDurationRef.current); bgmDurationRef.current = null }
      fadeTo(0, 4000)
      window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: '' } }))
      window.dispatchEvent(new CustomEvent('carecast:broadcast-bgm-stopped'))  // 통지 — NowPlayingBar 파란 바 제거
      window.dispatchEvent(new CustomEvent('carecast:local-bgm-stopped'))   // LocalBGMCard 상태 업데이트
      postNowPlaying({ bgm: null }).catch(() => {})  // 서버 상태 직접 클리어 (AdminMode에서도 동작)
      bgmStopRef.current = setTimeout(() => {
        bgmStopRef.current = null
        const a = audioRef.current
        if (a) { a.pause(); a.volume = nomVolRef.current }
        // [audioBus] BGM 페이드아웃 완료 — 장부 해제
        busRef.current?.done(); busRef.current = null
        window.dispatchEvent(new CustomEvent('carecast:caption-end'))
        playRef.current = { playlist: [], idx: 0, isPrayer: false, isStaff: false, afterPrayerStaff: false, savedBGM: null }
        setUI({ name: null, playing: false, progress: 0, currentTime: '0:00', duration: '0:00', active: false, isPrayer: false, isStaff: false })
      }, 4000)
    }

    // BGM 시작 — 페이드 인
    //
    // **두 길이 같은 함수로 들어온다**(2026-09-21). ① 서버의 `bgm_start`(즉시·흐름·자동방송·
    // 식사 시간 BGM) ② 예약 TTS 가 창 이벤트 `carecast:broadcast-local-bgm-start` 로 까는 반주.
    // 예약 TTS 는 반주를 깔고·기다리고·안내 뒤 꼬리에 맞춰 끄는 순서를 **브라우저가** 짠다
    // (useScheduledBroadcast) — 그래서 서버 신호가 아니라 창 이벤트로 받는다. 두 길이 다른
    // 함수를 쓰면 한쪽만 고쳐지는 날이 온다.
    //
    // `owner` — 이 반주의 **주인**(예약 TTS 한 번). 그 주인이 보내는 끄기 신호만 이 반주를 끈다
    // (2026-09-21 Codex 재현: 앞 예약의 꼬리 타이머가 뒤에 시작한 다른 BGM 을 껐다). 서버 신호로
    // 시작한 BGM 은 주인이 없다(null) — 예약의 끄기 신호가 건드리지 않는다.
    const startLocalBGM = ({ files, durationMin, durationSec, bgmDefault, eventId, owner }) => {
      // 현장 PC(localhost)에서만 재생 — 누가 요청했든 PA는 현장 PC를 통해서만 나감
      // 리모트 PC에서 버튼 눌러도 현장 PC PA로 방송됨 (리모트 PC 자체 재생 없음)
      if (!window.CC_IS_LEADER || !_IS_LOCAL) return
      // 탭 중복재생 방지 — 같은 PC에 탭이 여러 개일 때 첫 번째 탭만 재생
      if (eventId) {
        try {
          const lk = `cc_${eventId}`
          const existing = localStorage.getItem(lk)
          if (existing && Date.now() - parseInt(existing, 10) < 60000) return
          localStorage.setItem(lk, String(Date.now()))
        } catch { /* localStorage가 막힌 브라우저에서는 중복 억제만 못 한다 — 방송은 그대로 받는다 */ }
      }
      // 진행 중인 타이머 전부 취소
      if (bgmStartDelayRef.current) { clearTimeout(bgmStartDelayRef.current); bgmStartDelayRef.current = null }
      if (bgmStopRef.current)    { clearTimeout(bgmStopRef.current);    bgmStopRef.current    = null }
      if (bgmDurationRef.current){ clearTimeout(bgmDurationRef.current); bgmDurationRef.current = null }
      if (fadeRef.current)       { clearInterval(fadeRef.current);       fadeRef.current       = null }
      if (!files?.length) return
      // 이 방송의 BGM 볼륨 — **이 재생에만** 쓴다(2026-09-21 코드 검수 High).
      // 예전엔 여기서 VolumePanel 로도 쏘아 올렸는데(bgm-volume-from-yt), 받는 쪽은 그 값을 「저장될
      // 값」으로 들고 있어서 예약별 「잔잔하게」(bgm_volume 30) 한 번이 **다음 저장 때 전역 BGM 볼륨**이
      // 됐다 — 볼륨 규칙(「음량 슬라이더 값은 절대 건드리지 않는다」) 위반. 시스템 기본값 표시는
      // 서버의 volume_change 가 맡는다.
      // 볼륨을 안 실어 오면(식사 시간 자동 BGM 등) **시스템 값으로 돌아간다** — 예전엔 앞 방송의
      // 방송별 값(예: 10%)이 그대로 남아 다음 식사 BGM 도 그 음량으로 나갔다(2026-09-21 Codex 재현).
      nomVolRef.current = bgmDefault !== undefined ? bgmDefault / 100 : globalBgmVolRef.current
      playRef.current = { playlist: files, idx: 0, isPrayer: false, isStaff: false, afterPrayerStaff: false, savedBGM: null, owner: owner ?? null }
      // 기존 오디오(녹음 음원·이전BGM)를 300ms 페이드
      fadeTo(0, BGM_STOP_FADE_MS)
      // 300ms 페이드 완료 후 새 BGM 시작 — 350ms 딜레이로 중첩 원천 차단
      bgmStartDelayRef.current = setTimeout(() => {
        bgmStartDelayRef.current = null
        playURL(files[0].url, files[0].name)
        window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: `🎵 ${files[0].name}` } }))
        // NowPlayingBar 파란 바 표시 + 서버 상태 직접 업데이트 (AdminMode에서도 크로스PC 동기화)
        window.dispatchEvent(new CustomEvent('carecast:broadcast-bgm-start', { detail: { title: files[0].name } }))
        window.dispatchEvent(new CustomEvent('carecast:local-bgm-started', { detail: { title: files[0].name } }))
        postNowPlaying({ bgm: { title: files[0].name } }).catch(() => {})
        setUI(s => ({ ...s, isPrayer: false, isStaff: false }))
        // 자동 정지 타이머: durationSec(초) 우선, 없으면 durationMin(분) 사용
        const autoStopMs = (durationSec > 0)
          ? durationSec * 1000
          : (durationMin > 0 ? durationMin * 60 * 1000 : 0)
        if (autoStopMs > 0) {
          bgmDurationRef.current = setTimeout(() => {
            bgmDurationRef.current = null
            stopBGM()
          }, autoStopMs)
        }
      }, 350)
    }
    es.addEventListener('bgm_start', (e) => startLocalBGM(JSON.parse(e.data)))
    // 예약 TTS 의 반주 — eventId 가 없다(같은 탭 안의 신호라 탭 중복을 막을 것이 없다).
    localStartHandler = (e) => startLocalBGM(e.detail || {})
    window.addEventListener('carecast:broadcast-local-bgm-start', localStartHandler)

    // BGM 종료 — 페이드 아웃 후 정지
    es.addEventListener('bgm_stop', () => {
      stopBGM()
    })

    // 녹음 음원 재생 (bgmScheduler 발송 — 기존 호환)
    es.addEventListener('prayer_play', (e) => {
      const { url, name, token, restoreBGM, volume, gapless, audioFileId, rate } = JSON.parse(e.data)

      // 자막은 **리더 게이트 앞**이다. 소리는 현장 PC 한 창만 내지만 자막은 연결된 모든 창이
      // 봐야 한다(배리어프리). 소리 내는 창은 아래 playURL에서 <audio>를 넘겨 정확한 위치로
      // 따라가고, 나머지 창은 이 시각을 기준으로 도는 추정 시계를 쓴다.
      showAudioCaption(audioFileId, name, gapless, rate)

      // 현장 PC(localhost)에서만 재생 — bgm_start와 동일한 원칙. 이 가드가 없으면 원격 PC에서
      // 열어둔 브라우저도 녹음 음원을 자체 스피커로 재생 시도(autoplay 차단 시 muted→unmute
      // 트릭까지 사용)해서, 원격에서 보면 재생/음량이 제멋대로 조종되는 것처럼 보이는 버그가 있었다.
      if (!window.CC_IS_LEADER || !_IS_LOCAL) return
      // 탭 중복재생 방지 — 같은 PC에 탭이 여러 개일 때 첫 번째 탭만 재생
      if (token) {
        try {
          const lk = `cc_${token}`
          const existing = localStorage.getItem(lk)
          if (existing && Date.now() - parseInt(existing, 10) < 300000) return
          localStorage.setItem(lk, String(Date.now()))
        } catch { /* localStorage가 막힌 브라우저에서는 중복 억제만 못 한다 — 방송은 그대로 받는다 */ }
      }
      // bgm_start 350ms 딜레이 중이면 취소 (녹음 음원 중 BGM 시작 방지)
      if (bgmStartDelayRef.current) { clearTimeout(bgmStartDelayRef.current); bgmStartDelayRef.current = null }
      // bgm_stop 페이드 중이거나 재생목록 없으면 BGM 복원 안 함
      // → 점심/저녁: 영상 후 bgm_stop → prayer_play 도착 시 이미 정지 중 → savedBGM=null → 녹음 음원 후 이중재생 없음
      const bgmWasStopping = !!bgmStopRef.current
      if (bgmStopRef.current)    { clearTimeout(bgmStopRef.current);    bgmStopRef.current    = null }
      // 이전 bgm 자동 정지 타이머 취소 (prayer 중 타이머 오작동 방지)
      if (bgmDurationRef.current){ clearTimeout(bgmDurationRef.current); bgmDurationRef.current = null }
      // restoreBGM=true(저녁 마무리 등): token 있어도 녹음 음원 후 BGM 자동복원
      // token만 있을 때: 서버 시퀀서의 bgm_after 단계가 BGM 재시작 → 자동복귀 방지
      const hadActiveBGM = !bgmWasStopping && (restoreBGM || !token) && playRef.current.playlist.length > 0
      // isPrayer=true 설정 전 현재 오디오(BGM 등) 즉시 pause — 1300ms 딜레이 중 ended 이벤트 오발사 방지
      if (audioRef.current) audioRef.current.pause()
      playRef.current = {
        playlist: [], idx: 0, isPrayer: true, isStaff: false,
        afterPrayerStaff: false,
        savedBGM: hadActiveBGM ? { ...playRef.current } : null,
        prayerToken: token || null,
        prayerAudioFileId: audioFileId ?? null,
      }
      setUI(s => ({ ...s, isPrayer: true, isStaff: false }))
      // 로컬 BGM 페이드아웃 후 녹음 음원 시작 (자연스러운 전환)
      // 예약에 지정된 음원 볼륨이 있으면 이 재생에만 적용한다
      playOverrideRef.current = (typeof volume === 'number' && volume >= 0 && volume <= 100)
        ? volume / 100
        : null
      playRateRef.current = (typeof rate === 'number' && rate >= 0.5 && rate <= 1.5) ? rate : null
      // gapless: 한 단계 안에서 앞 곡에 이어 붙는 재생. 앞 곡은 이미 끝나 있어서 페이드할
      // 대상이 없고, 그런데도 1.2초 페이드 + 1.3초 지연을 그대로 태우면 곡 사이에 매번
      // 2.5초 침묵이 생긴다(어르신들이 "노래가 끊겼다"고 느끼는 그 텀). 그래서 바로 잇는다.
      // 앞 녹음 음원의 대기 타이머가 남아 있으면 걷는다 — 두 곡이 겹쳐 나간다.
      if (녹음시작Ref.current) { clearTimeout(녹음시작Ref.current); 녹음시작Ref.current = null }
      if (gapless) {
        playURL(url, name)
      } else {
        fadeTo(0, 1200)
        // **이 재생이 아직 살아 있을 때만** 튼다. 정지·새 재생은 playRef 를 갈아 끼우므로,
        // 타이머를 걷는 자리를 하나 빠뜨려도 늦은 재생이 소리를 내지 않는다.
        const 이재생 = playRef.current
        녹음시작Ref.current = setTimeout(() => {
          녹음시작Ref.current = null
          if (playRef.current === 이재생) playURL(url, name)
        }, 1300)
      }
    })

    // 예약 방송 녹음 음원 타입 — category별 랜덤 음원 재생
    es.addEventListener('prayer_schedule_play', (e) => {
      // 현장 PC(localhost)에서만 재생 — prayer_play와 동일한 원격 PC 재생 방지 가드.
      if (!window.CC_IS_LEADER || !_IS_LOCAL) return
      const { category, withStaff } = JSON.parse(e.data)
      // 앞서 걸린 BGM 타이머 3종을 걷는다 — prayer_play(:339)와 같은 이유이자 같은 모양이다.
      // 2026-09-03 레드 검증에서 이쪽만 빠져 있는 것을 찾았다: 재생시간 제한이 걸린 BGM이
      // 흐르는 중 녹음 음원 예약이 발동하면 남은 자동정지 타이머가 **녹음 음원 한복판에** stopBGM을
      // 쏴 녹음 음원을 4초 페이드로 죽이고, 350ms 시작 예약이 남으면 그 위로 음악이 켜진다.
      const 끄던중 = !!bgmStopRef.current   // 걷기 전에 본다 — 아래 설명
      if (bgmStartDelayRef.current) { clearTimeout(bgmStartDelayRef.current); bgmStartDelayRef.current = null }
      if (bgmStopRef.current)       { clearTimeout(bgmStopRef.current);       bgmStopRef.current       = null }
      if (bgmDurationRef.current)   { clearTimeout(bgmDurationRef.current);   bgmDurationRef.current   = null }
      // **이미 끄는 중이던 반주는 녹음 음원 뒤에 되살리지 않는다**(2026-09-21 Codex 4회차). 멈춤 예약(bgmStopRef)이
      // 걸려 있었다는 것은 그 반주가 끝나는 중이었다는 뜻이다 — 예약 TTS 의 꼬리가 끝나 끄는 페이드가 도는 사이
      // 녹음 음원이 시작되면, 예전엔 그것을 savedBGM 으로 담아 녹음 음원 뒤 제 음량으로 되살렸고 아무도 끄지 않았다.
      const savedState = 끄던중
        ? { playlist: [], idx: 0, isPrayer: false, isStaff: false, afterPrayerStaff: false, savedBGM: null }
        : { ...playRef.current }
      const 소리나던반주 = 끄던중 || (playRef.current.playlist?.length && !playRef.current.isPrayer && !playRef.current.isStaff)
      // 이 녹음 음원 한 번의 상태 객체 — 늦게 돌아온 조회 응답이 **아직 이 상태일 때만** 움직인다
      // (2026-09-21 Codex 2회차: 그 사이 새 BGM 이 시작했는데 앞 녹음 음원의 조회 실패가 그것을 껐다).
      // `녹음대기` = 녹음(·직원멘트) 음원을 아직 받아 오는 중 — 그 사이 앞 곡의 `ended` 를 녹음 음원 종료로
      // 읽지 않게 한다(Codex 3회차: 앞 곡이 끝나며 상태가 바뀌어 정상 응답을 버렸다).
      let 녹음상태 = playRef.current = {
        playlist: [], idx: 0, isPrayer: true, isStaff: false,
        afterPrayerStaff: !!withStaff,
        savedBGM: savedState,
        녹음대기: true,
      }
      // **앞의 로컬 반주는 녹음 음원이 시작되는 지금 멈춘다**(2026-09-21 Codex 3회차 뒤 단순화). 받아 오는 동안 반주를 흘리면 「조회 중 끄기」·
      // 「조회 중 곡이 끝남」·「늦은 응답」이 서로 얽혀 세 번의 검수에서 매번 새 구멍이 났다 — 소리를 먼저
      // 멈추면 그 갈래들이 전부 사라진다. 녹음 음원이 끝나면 예전처럼 savedBGM 으로 되살린다(주인이 끄라고
      // 했으면 savedBGM 이 지워져 안 되살린다 — localBGMStopHandler).
      // 멈춤 타이머는 **이 녹음 음원을 아직 받아 오는 중일 때만** 멈춘다(Codex 4회차: 앞 녹음 음원의 타이머가 뒤에 시작한
      // 녹음 음원을 멈췄다). 앞 녹음 음원의 타이머는 먼저 걷고, 정지 버튼·새 BGM 으로 상태가 바뀌었으면 아무것도 안 한다.
      if (녹음전정지Ref.current) { clearTimeout(녹음전정지Ref.current); 녹음전정지Ref.current = null }
      if (소리나던반주) {
        fadeTo(0, BGM_STOP_FADE_MS)
        const 이녹음 = 녹음상태
        녹음전정지Ref.current = setTimeout(() => {
          녹음전정지Ref.current = null
          if (playRef.current === 이녹음 && 이녹음.녹음대기) audioRef.current?.pause()
        }, BGM_STOP_FADE_MS)
      }
      const 내것인가 = () => playRef.current === 녹음상태
      setUI(s => ({ ...s, isPrayer: true, isStaff: false }))
      apiGet(`/api/audio/random?category=${encodeURIComponent(category)}`)
        .then(data => {
          if (!내것인가()) return
          if (data?.url) { 녹음상태.녹음대기 = false; playURL(data.url, data.original_name || category) }
          else {
            // 녹음 음원 없음 — 직원멘트만 처리
            if (withStaff) {
              녹음상태 = playRef.current = { ...playRef.current, isPrayer: false, isStaff: true, afterPrayerStaff: false }
              apiGet('/api/audio/random?category=staff')
                .then(d => {
                  if (!내것인가()) return
                  if (d?.url) { 녹음상태.녹음대기 = false; playURL(d.url, d.original_name || '직원멘트') }
                  else 녹음못틀면복귀()
                })
                .catch(() => { if (내것인가()) 녹음못틀면복귀() })
            } else 녹음못틀면복귀()
          }
        })
        .catch(() => { if (내것인가()) 녹음못틀면복귀() })
      // 녹음(·직원멘트) 음원을 못 틀었을 때 — 멈춰 둔 반주를 되살린다. 단 **그 반주의 주인이 그사이
      // 끄라고 했으면**(savedBGM 이 지워졌으면) 되살리지 않는다. 부르는 쪽이 「아직 이 녹음 음원의 상태인가」를
      // 먼저 본다 — 그 사이 다른 소리가 시작했으면 건드리지 않는다.
      function 녹음못틀면복귀() {
        if (녹음전정지Ref.current) { clearTimeout(녹음전정지Ref.current); 녹음전정지Ref.current = null }
        const 되살릴것 = playRef.current.savedBGM
        if (되살릴것?.playlist?.length) {
          playRef.current = { ...되살릴것, isPrayer: false, isStaff: false, savedBGM: null }
          const 곡 = 되살릴것.playlist[되살릴것.idx ?? 0] || 되살릴것.playlist[0]
          playURL(곡.url, 곡.name)
          return
        }
        const a = audioRef.current
        if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null }
        if (a) { a.pause(); a.volume = nomVolRef.current }
        busRef.current?.done(); busRef.current = null
        playRef.current = { playlist: [], idx: 0, isPrayer: false, isStaff: false, afterPrayerStaff: false, savedBGM: null }
        window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: '' } }))
        postNowPlaying({ bgm: null }).catch(() => {})
        setUI({ name: null, playing: false, progress: 0, currentTime: '0:00', duration: '0:00', active: false, isPrayer: false, isStaff: false })
      }
    })

    // 차임벨 재생 — 서버가 WaveOut으로 이미 PC 스피커에 재생하므로 브라우저 중복 재생 없음.
    //
    // 원격 접속 탭에서만 청각 피드백이 필요해지면 **lib/browserChime.js의 playBrowserChime을
    // 쓴다.** 여기 있던 사본(playChimeSound)은 2026-09-05에 지웠다 — 아무도 안 부르는 데다,
    // **소리 장부(audioBus)에 등록을 안 했다.** 주석을 풀어 되살렸다면 장부가 모르는 소리가
    // 나고, 정지 버튼이 그걸 못 끊는다(TD-09가 다루던 바로 그 구멍이다).
    // es.addEventListener('chime_play', () => playBrowserChime())
    //
    // **서버 스피커를 못 열었을 때만** 이 화면이 대신 울린다(사용자 결정 2026-09-26, TODO T-36 ③). 위 `chime_play` 를
    // 살리면 서버가 멀쩡히 울릴 때도 겹쳐 울리므로 **다른 이벤트**다. 서버가 그 사실을 방송 로그에 남긴다.
    // 현장 PC 의 대표 창만 — 창마다 울리면 겹친다(다른 서버 소리와 같은 규칙).
    es.addEventListener('chime_fallback_play', (e) => {
      if (!window.CC_IS_LEADER || !_IS_LOCAL) return
      // 서버가 보낸 종류(시작음·종료음)와 볼륨(0~100)을 그대로 따른다 — 볼륨 0 이면 안 울린다(Codex 교차검수 T36 Medium)
      let d = {}
      try { d = JSON.parse(e.data) || {} } catch { /* 못 읽으면 기본 시작음·기본 볼륨 */ }
      playBrowserChime({ type: d.type, volume: d.volume })
    })

    // BGM 타이머만 설정 (재생 중인 곡 유지, durationSec 후 자동 페이드아웃)
    es.addEventListener('bgm_set_timer', (e) => {
      const { durationSec } = JSON.parse(e.data)
      if (bgmDurationRef.current) { clearTimeout(bgmDurationRef.current); bgmDurationRef.current = null }
      if (durationSec > 0) {
        bgmDurationRef.current = setTimeout(() => {
          bgmDurationRef.current = null
          stopBGM()
        }, durationSec * 1000)
      }
    })

    // 볼륨 변경 동기화 — 다른 PC에서 볼륨을 바꾸거나 신규 접속 시 수신
    es.addEventListener('volume_change', (e) => {
      const { tts, audio, media, bgm } = JSON.parse(e.data)
      if (bgm   !== undefined) {
        const v = bgm / 100
        nomVolRef.current = v; globalBgmVolRef.current = v   // 시스템 값 — 방송별 값과 따로 둔다
        const { isPrayer, isStaff } = playRef.current
        if (audioRef.current && !isPrayer && !isStaff) audioRef.current.volume = v
      }
      if (tts   !== undefined) { broadcastVolRef.current = tts   / 100 }
      if (audio !== undefined) {
        audioVolRef.current = audio / 100
        const { isPrayer } = playRef.current
        if (audioRef.current && isPrayer) audioRef.current.volume = audio / 100
      }
      if (media !== undefined) {
        const { isStaff } = playRef.current
        if (audioRef.current && isStaff) audioRef.current.volume = media / 100
      }
      // VolumePanel 슬라이더 동기화
      window.dispatchEvent(new CustomEvent('carecast:volume-sync', { detail: { tts, audio, media, bgm } }))
    })
    } // bindSSE 끝

    setupSSE()

    // 방송 TTS 시작 시 BGM 볼륨 덕킹 — TTS play() 전 400ms 대기와 맞춰 300ms 빠른 페이드
    const duckHandler = () => {
      duckedRef.current = true          // 안내 중 — 이 사이에 곡이 바뀌어도 덕킹 음량으로 들어간다
      const { isPrayer, isStaff } = playRef.current
      if (bgmStopRef.current) return   // 정지·정지 예약 창(레드 검증) — 멎는 소리를 건드리지 않는다
      if (!audioRef.current || isPrayer || isStaff) return
      fadeTo(Math.max(0.2, nomVolRef.current * 0.35), 300)
    }
    // 정지 창(300ms) 가드(레드 검증 2026-09-02 심야): 마이크 방송을 「정지」하면 cleanup의
    // tts-end가 여기로 들어와 끄는 페이드를 지우고, 아직 안 비워진 playRef로 오버레이
    // 곡명까지 되살렸다 — 소리는 +300ms의 pause가 결국 끊지만 문구는 아무도 안 지운다.
    const restoreHandler = () => {
      duckedRef.current = false
      const { isPrayer, isStaff, playlist, idx } = playRef.current
      if (bgmStopRef.current) return
      if (!audioRef.current || isPrayer || isStaff) return
      fadeTo(nomVolRef.current, 1500)
      const track = playlist[idx]
      if (track?.name) window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: `🎵 ${track.name}` } }))
    }

    // 방송 취소 신호 — 사람이 「정지」를 눌렀다.
    // **이 PC에서 나는 방송 소리는 예외 없이 멎는다**(사용자 결정 2026-09-02,
    // docs/td09-audiobus.md §6). 이 오디오 하나가 역할 셋(로컬BGM·녹음 음원·직원멘트)을 도는데,
    // 예전엔 녹음 음원·직원멘트일 때만 멎었다 — 배경음악만 흐를 때는 정지를 눌러도 계속 났다(H2).
    const stopBroadcastHandler = () => {
      // 아직 시작 전인 녹음 음원부터 걷는다 — 1.3초 대기 중에 정지를 누르면 그 뒤에 소리가 났다.
      if (녹음시작Ref.current) { clearTimeout(녹음시작Ref.current); 녹음시작Ref.current = null }
      const { isPrayer, isStaff } = playRef.current

      // ── 로컬 BGM 단독 ────────────────────────────────────────────────────────
      // 예전엔 여기서 그냥 return했다. 방송 BGM이 정지 신호를 안 듣던 e049d7c와 같은 모양이다.
      // **복귀 예약을 남기지 않는다** — 정지는 "지금 다 꺼라"이지 "잠시 멈췄다 돌아와라"가
      // 아니다. savedBGM(녹음 음원 뒤 복귀용)도 여기서 비워, 나중에 되살아나는 길을 막는다.
      if (!isPrayer && !isStaff) {
        // 예약된 것부터 전부 거둔다. 350ms 뒤에 시작하기로 한 BGM이 남아 있으면
        // **정지를 누른 다음에 음악이 켜진다.**
        if (bgmStartDelayRef.current) { clearTimeout(bgmStartDelayRef.current); bgmStartDelayRef.current = null }
        if (bgmDurationRef.current)   { clearTimeout(bgmDurationRef.current);   bgmDurationRef.current   = null }
        if (bgmStopRef.current)       { clearTimeout(bgmStopRef.current);       bgmStopRef.current       = null }
        if (fadeRef.current)          { clearInterval(fadeRef.current);         fadeRef.current          = null }
        // 4초 페이드(bgm_stop)는 **방송이 스스로 끝날 때**의 것이다. 사람이 누른 정지에 그걸
        // 쓰면 4초를 더 들려주게 되고, 그건 이 저장소가 이미 받아 본 신고("정지를 눌렀는데
        // 음악이 계속 났다")와 구분이 안 된다. 그래서 이 파일에 이미 있는 **빠른 정지**
        // (아래 localBGMStopHandler 의 BGM_STOP_FADE_MS)와 같은 길로 간다.
        // 0초로 뚝 끊지 않는 이유는 스피커 팝음 하나뿐이다 — 사람 귀에는 즉시다.
        fadeTo(0, BGM_STOP_FADE_MS)
        window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: '' } }))
        window.dispatchEvent(new CustomEvent('carecast:local-bgm-stopped'))
        window.dispatchEvent(new CustomEvent('carecast:broadcast-bgm-stopped'))   // 통지 — 재생바 파란 바
        postNowPlaying({ bgm: null }).catch(() => {})   // NowPlayingBar(서버 폴링)도 비운다
        bgmStopRef.current = setTimeout(() => {
          bgmStopRef.current = null
          const a = audioRef.current
          if (a) { a.pause(); a.volume = nomVolRef.current }
          // [audioBus] 사람이 정지한 로컬 BGM — 장부 해제
          busRef.current?.done(); busRef.current = null
          // 이 재생에만 쓰던 예약별 볼륨·배속도 비운다(녹음 음원 쪽과 같은 이유)
          playOverrideRef.current = null
          playRateRef.current     = null
          playRef.current = { playlist: [], idx: 0, isPrayer: false, isStaff: false, afterPrayerStaff: false, savedBGM: null }
          setUI({ name: null, playing: false, progress: 0, currentTime: '0:00', duration: '0:00', active: false, isPrayer: false, isStaff: false })
        }, BGM_STOP_FADE_MS)
        return
      }

      // ── 녹음 음원·직원멘트 ─────────────────────────────────────────────────────
      // 2026-09-02 사용자 결정: 녹음 음원 중 「정지」도 **전부 멎는다.** §6("정지는 예외 없이
      // 전부")과 §3-B 규칙 2(녹음 음원 후 복귀)가 부딪히던 마지막 자리를 §6으로 정리했다.
      // 복귀 상태기계 자체는 그대로다 — 녹음 음원이 **스스로 끝날 때**(ended, :133~)의 복귀는
      // 명세대로 살아 있고, 여기(사람이 누른 정지)서만 savedBGM을 비워 되살아날 길을 막는다.
      // 예전에는 여기서 savedBGM을 playURL로 되살렸다 — "정지를 눌렀는데 음악이 나온다".
      const a = audioRef.current
      if (a) a.pause()
      // [audioBus] 사람이 정지한 녹음 음원·직원멘트 — 장부 해제
      busRef.current?.done(); busRef.current = null
      // 이 재생에만 쓰던 예약별 볼륨·배속 — 정상 종료(ended)와 똑같이 여기서도 비운다.
      // 안 비우면 중간에 정지된 방송의 값이 남아, 자기 볼륨 없는 다음 녹음 음원 방송이
      // 이전 예약의 볼륨·배속으로 재생된다.
      playOverrideRef.current = null
      playRateRef.current     = null
      playRef.current = { playlist: [], idx: 0, isPrayer: false, isStaff: false, savedBGM: null, afterPrayerStaff: false }
      window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: '' } }))
      postNowPlaying({ bgm: null }).catch(() => {})
      setUI({ name: null, playing: false, progress: 0, currentTime: '0:00', duration: '0:00', active: false, isPrayer: false, isStaff: false })
    }

    // 로컬 BGM 빠른 정지(기본 300ms) — 배경 영상·업로드 영상이 시작할 때, 사람이 끌 때.
    //
    // **예약 TTS 가 끝날 때도 이것이 불린다**(2026-09-21 — 예약 TTS 에 로컬 반주를 깔 수 있게 되면서).
    // 그때는 `detail` 에 `{ fadeMs, 마감시각 }` 이 실려 온다
    // (UX-17 꼬리: 안내 뒤 몇 초 더 흐르다 **마감 시각에 소리가 0**이 되게, lib/bgmFade 가 계산).
    // 없으면 예전처럼 300ms 다. 이것을 안 받으면 안내가 끝나도 로컬 반주가 **꼬리 없이 끊기거나
    // 꼬리를 넘겨** 흐른다 — 구조 검토(architect)가 짚은 High 였다.
    const localBGMStopHandler = (e) => {
      const { isPrayer, isStaff } = playRef.current
      const d = e?.detail || {}
      // 예약 TTS 가 보내는 끄기 신호에는 **주인(owner)** 이 실려 온다(2026-09-21 Codex).
      const 주인신호 = 'owner' in d
      if (isPrayer || isStaff) {
        // 녹음 음원·직원멘트 중에 **그 반주의 주인이** 끄라고 하면, 녹음 음원 뒤에 되살릴 BGM 을 지운다(코드 검수
        // High). 안 지우면 녹음 음원형 예약에 깐 로컬 반주가 녹음 음원 뒤 되살아나 아무도 안 끄는 채 흐른다.
        // 반주 소리 자체는 예약 녹음 음원이 시작될 때 이미 멈췄다(prayer_schedule_play) — 여기서는 되살릴 것만 지운다.
        // 그 밖의 신호(영상 시작 등)는 예전처럼 녹음 음원을 건드리지 않는다.
        if (주인신호 && playRef.current.savedBGM && (playRef.current.savedBGM.owner ?? null) === d.owner) {
          playRef.current.savedBGM = null
        }
        return
      }
      // 다른 주인의 BGM 은 건드리지 않는다 — 앞 예약의 꼬리 타이머가 뒤에 시작한 BGM 을 끄던 자리다.
      if (주인신호 && (playRef.current.owner ?? null) !== d.owner) return
      // 쏘는 쪽이 실어 보낸 길이를 쓰고, 없으면 정본 상수. **마감 시각으로 줄인다** — 신호가 배달되는
      // 데 걸린 시간이 꼬리 위에 얹히지 않게(EV-004753). 계산은 lib/bgmFade 한 곳이다.
      const fadeMs = 남은페이드ms(Number.isFinite(d.fadeMs) ? Number(d.fadeMs) : BGM_STOP_FADE_MS, d.마감시각, Date.now())
      if (bgmStartDelayRef.current) { clearTimeout(bgmStartDelayRef.current); bgmStartDelayRef.current = null }
      if (bgmDurationRef.current) { clearTimeout(bgmDurationRef.current); bgmDurationRef.current = null }
      if (bgmStopRef.current)     { clearTimeout(bgmStopRef.current);     bgmStopRef.current     = null }
      if (fadeRef.current)        { clearInterval(fadeRef.current);        fadeRef.current        = null }
      fadeTo(0, fadeMs)
      window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: '' } }))
      window.dispatchEvent(new CustomEvent('carecast:broadcast-bgm-stopped'))   // 통지 — 재생바 파란 바
      window.dispatchEvent(new CustomEvent('carecast:local-bgm-stopped'))
      postNowPlaying({ bgm: null }).catch(() => {})
      bgmStopRef.current = setTimeout(() => {
        bgmStopRef.current = null
        const a = audioRef.current
        if (a) { a.pause(); a.volume = nomVolRef.current }
        // [audioBus] 빠른 정지 — 장부 해제
        busRef.current?.done(); busRef.current = null
        playRef.current = { playlist: [], idx: 0, isPrayer: false, isStaff: false, afterPrayerStaff: false, savedBGM: null }
        setUI({ name: null, playing: false, progress: 0, currentTime: '0:00', duration: '0:00', active: false, isPrayer: false, isStaff: false })
      }, fadeMs)
    }

    // VolumePanel BGM 슬라이더 변경 시 로컬 BGM 볼륨 연동 (0-100 → 0-1)
    const bgmVolHandler = (e) => {
      const v = Number(e.detail) / 100
      nomVolRef.current = v; globalBgmVolRef.current = v
      if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null }
      const { isPrayer, isStaff } = playRef.current
      if (audioRef.current && !isPrayer && !isStaff) audioRef.current.volume = v
    }

    // TTS 볼륨 변경 (하위호환 — broadcastVolRef만 업데이트)
    const ttsVolHandler = (e) => {
      const v = Number(e.detail) / 100
      broadcastVolRef.current = v
    }
    // 녹음 음원 볼륨 변경 (isPrayer 재생 중 즉시 반영)
    const audioVolHandler = (e) => {
      const v = Number(e.detail) / 100
      audioVolRef.current = v
      const { isPrayer } = playRef.current
      if (audioRef.current && isPrayer) audioRef.current.volume = v
    }
    // 영상 볼륨 변경 (직원멘트 등 isStaff 재생 중 즉시 반영)
    const mediaVolHandler = (e) => {
      const v = Number(e.detail) / 100
      const { isStaff } = playRef.current
      if (audioRef.current && isStaff) audioRef.current.volume = v
    }
    // 하위호환: 구형 carecast:broadcast-volume → broadcastVolRef 업데이트
    const broadcastVolHandler = (e) => {
      const v = Number(e.detail) / 100
      broadcastVolRef.current = v
    }

    window.addEventListener('carecast:broadcast-tts-start',      duckHandler)
    window.addEventListener('carecast:broadcast-tts-end',        restoreHandler)
    window.addEventListener('carecast:stop-broadcast',           stopBroadcastHandler)
    window.addEventListener('carecast:broadcast-local-bgm-stop', localBGMStopHandler)
    window.addEventListener('carecast:bgm-volume',               bgmVolHandler)
    window.addEventListener('carecast:tts-volume',               ttsVolHandler)
    window.addEventListener('carecast:audio-volume',             audioVolHandler)
    window.addEventListener('carecast:media-volume',             mediaVolHandler)
    window.addEventListener('carecast:broadcast-volume',         broadcastVolHandler)

    return () => {
      sseDestroyed = true
      clearTimeout(sseTimer)
      es?.close()
      audio.pause()
      audio.src = ''
      // [audioBus] 컴포넌트 해제 — 남아 있는 장부 등록을 내린다
      busRef.current?.done(); busRef.current = null
      if (fadeRef.current)        clearInterval(fadeRef.current)
      if (bgmStopRef.current)     clearTimeout(bgmStopRef.current)
      if (bgmDurationRef.current) clearTimeout(bgmDurationRef.current)
      if (녹음시작Ref.current)     clearTimeout(녹음시작Ref.current)
      window.removeEventListener('carecast:broadcast-tts-start',      duckHandler)
      window.removeEventListener('carecast:broadcast-tts-end',        restoreHandler)
      window.removeEventListener('carecast:stop-broadcast',           stopBroadcastHandler)
      window.removeEventListener('carecast:broadcast-local-bgm-stop', localBGMStopHandler)
      if (localStartHandler) window.removeEventListener('carecast:broadcast-local-bgm-start', localStartHandler)
      window.removeEventListener('carecast:bgm-volume',               bgmVolHandler)
      window.removeEventListener('carecast:tts-volume',               ttsVolHandler)
      window.removeEventListener('carecast:audio-volume',             audioVolHandler)
      window.removeEventListener('carecast:media-volume',             mediaVolHandler)
      window.removeEventListener('carecast:broadcast-volume',         broadcastVolHandler)
    }
  }, [playURL, fadeTo])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (ui.playing) {
      audio.pause()
      setUI(s => ({ ...s, playing: false }))
    } else if (audio.src) {
      audio.play().catch(() => {})
      setUI(s => ({ ...s, playing: true }))
    }
  }

  const skipNext = () => {
    const { playlist, idx, isPrayer, isStaff } = playRef.current
    if (isPrayer || isStaff || playlist.length < 2) return
    const next = (idx + 1) % playlist.length
    playRef.current = { ...playRef.current, idx: next }
    playURL(playlist[next].url, playlist[next].name)
    BGM곡알림(playlist[next].name, { 화면: !playRef.current.owner })
  }

  // ── **이 바의 키를 밖에 알려 준다** (사용자 지적 2026-09-13) ────────────────────
  // *"시스템 안내도 보이는 거 배너 겹친다"* — 관리자 사이드바가 화면 바닥에서 **40px** 만
  // 비워 두고 있었는데(`Sidebar.jsx`), 이 바는 **접히면 40px, 펼치면 64px** 이다.
  // 그래서 BGM 이 실제로 나가는 동안에는 24px 이 덮이고, 하필 맨 아래 항목인
  // 「시스템 안내도」가 그 자리다. 매직 넘버를 양쪽에 적어 두면 이런 어긋남이 또 난다
  // (머리줄 높이를 `--cc-header-h` 로 재서 넘기는 것과 같은 이유).
  // **재지 않고 적는다** — 이 바의 높이는 이 파일이 정하는 두 값 중 하나다.
  // **쉴 때는 0 이다** (사용자 지적 2026-09-15) — 아래 「대기 중」 줄을 없앴으므로
  // 비워 둘 자리도 없다. 이 값을 그대로 40 으로 두면 사이드바와 재생 표시줄이
  // **있지도 않은 바를 피해** 40px 을 띄운다.
  useEffect(() => {
    const 키 = ui.active ? 64 : 0
    document.documentElement.style.setProperty('--cc-nowplaying-h', `${키}px`)
  }, [ui.active])

  // ── **쉴 때는 아무것도 안 그린다** (사용자 지적 2026-09-15) ────────────────────
  // *"BGM 대기 중 저 밑에 흰색 대기바는 뭐 하는 역할이야? 어차피 빨간색으로 방송할 때
  //   나오는데."* — 맞다. 하는 일이 없었다.
  //
  // 이 줄은 **아무 정보도 나르지 않으면서** 화면 아래 40px 을 늘 차지했다. 무엇이
  // 나가는 중인지는 위의 재생 표시줄(`NowPlayingBar`)이 말하고, 그것은 **나갈 때만**
  // 뜬다. 「대기 중」은 「아무 일도 없음」의 다른 말이고, 아무 일도 없다는 것은
  // 화면이 비어 있는 것으로 이미 말해진다.
  //
  // **BGM 이 실제로 나갈 때의 바(아래)는 그대로 둔다** — 곡 이름·조절이 거기 있다.
  if (!ui.active) return null

  const labelColor = ui.isPrayer ? 'text-ds-v3-ink-2' : ui.isStaff ? 'text-ds-v3-ink-3' : 'text-ds-v3-tts'
  const iconBg     = ui.isPrayer ? 'bg-ds-v3-surface-2' : ui.isStaff ? 'bg-ds-v3-surface-2' : 'bg-ds-v3-tts/10'
  const subLabel   = ui.isPrayer ? '음원 방송' : ui.isStaff ? '직원멘트' : 'BGM'

  return (
    // z 는 **사이드바(50)보다 위**다 — 아래 바가 사이드바에 뚫리던 것과 같은 이유
    // (`NowPlayingBar` 머리말). 그 위에 얹히는 재생 표시줄이 56 이라 여기는 55 다.
    <div className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-ds-v3-line
                    flex items-center px-6 gap-4 z-[55]"
      style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>

      {/* 음악 정보 */}
      <div className="flex items-center gap-3 min-w-0 w-56">
        <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Music2 size={16} className={labelColor} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ds-v3-ink truncate">{ui.name || '재생 중'}</p>
          <p className={`text-xs ${labelColor}`}>{subLabel}</p>
        </div>
      </div>

      {/* 재생 컨트롤 */}
      <div className="flex items-center flex-wrap gap-3 mx-auto">
        <button onClick={togglePlay}
          className="w-11 h-11 rounded-full bg-ds-v3-tts hover:bg-ds-v3-tts
                     flex items-center justify-center btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
          style={{ boxShadow: '0 2px 8px rgba(79,142,247,0.35)' }}>
          {ui.playing
            ? <Pause size={16} className="text-white" />
            : <Play  size={16} className="text-white" />}
        </button>
        <button onClick={skipNext}
          disabled={playRef.current.isPrayer || playRef.current.isStaff || playRef.current.playlist.length < 2}
          className="text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors disabled:opacity-30 min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]">
          <SkipForward size={18} />
        </button>
      </div>

      {/* 진행바 + 시간 */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs text-ds-v3-ink-2 nums flex-shrink-0">{ui.currentTime}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={ui.progress}
          onChange={e => {
            const audio = audioRef.current
            if (!audio || !audio.duration) return
            const pct = Number(e.target.value)
            audio.currentTime = (pct / 100) * audio.duration
            setUI(s => ({ ...s, progress: pct }))
          }}
          className="flex-1 accent-ds-v3-tts h-1 cursor-pointer"
        />
        <span className="text-xs text-ds-v3-ink-2 nums flex-shrink-0">{ui.duration}</span>
      </div>

      {/* 볼륨 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Volume2 size={13} className="text-ds-v3-ink-2 flex-shrink-0" />
        <input
          type="range" min={0} max={1} step={0.01}
          defaultValue={0.50}
          onChange={e => {
            const v = Number(e.target.value)
            nomVolRef.current = v; globalBgmVolRef.current = v
            if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null }
            if (audioRef.current) audioRef.current.volume = v
            // VolumePanel BGM 슬라이더 연동 (0-1 → 0-100)
            window.dispatchEvent(new CustomEvent('carecast:bgm-volume-from-player', { detail: Math.round(v * 100) }))
          }}
          className="w-20 accent-ds-v3-tts h-1"
        />
      </div>
    </div>
  )
}
