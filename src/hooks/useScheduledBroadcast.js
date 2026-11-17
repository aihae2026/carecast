// 예약·아침 방송이 서버에서 발화되면 자동 재생하는 앱 전역 SSE 처리기.
//
// App.jsx가 1478줄이 되면서 "주소 판정 + 화면 조립"과 이 300줄짜리 방송의 심장이 한 파일에
// 섞여 있었다. 여기는 소리가 나느냐 마느냐가 걸린 자리라(빈 catch로 실패를 삼키던 CC-009가
// 여기였다) 화면 조립을 고치다 건드리는 일이 없도록 파일부터 갈라 둔다.
import { useEffect, useRef, useState } from 'react'
import { TAB_ID as _TAB_ID } from '../lib/tabId'
import { _IS_LOCAL } from '../lib/isLocal'
import { reportPlayStarted } from '../lib/api'
import { initSSE, fetchScheduledAudio, audioEnded as audioEndedAPI,
         reportBroadcastFailure } from '../lib/api'
import { audioBus } from '../lib/audioBus'
import { bgmStopAfterMs, bgmFadeMsFor } from '../lib/bgmFade'
import { 영상재생상세 } from '../lib/videoPlayEvent'

// **이 훅은 앱에 하나만 있어야 한다.**
//
// 예전엔 App.jsx 안의 모듈 사설 함수라 두 번 마운트가 구조적으로 불가능했다. 파일을 가르며
// `src/hooks/`에 놓이자 useAudioListener와 나란한 **평범한 훅 모양**이 됐다 — 다른 화면에서
// 한 번 더 쓰기 쉬워졌다는 뜻이다. 그런데 initSSE는 멱등이 아니라, 부를 때마다 이벤트마다
// 새 처리기를 붙인다. 두 번 마운트되면 **같은 방송에 재생 경로가 두 번 돌아 TTS가 겹친다.**
// (2026-09-02 레드 코드 지적. 그날 겹치는 소리로 이미 한 번 고생했다.)
//
// 규칙은 server/test/scheduled-broadcast-single-mount.test.js가 고정한다. 아래 셈은 그물이
// 새는 경우(그 테스트가 못 보는 경로)를 위한 두 번째 그물이다 — 던지지는 않는다.
// 현장에서 방송 도중에 화면이 죽는 것이 겹쳐 들리는 것보다 나쁘다.
let 살아있는처리기 = 0

// 소리가 실제로 시작하기까지, 음원을 받아오고 재생 직전에 일부러 두는 대기까지 합친 시간.
// **소리를 안 내는 창의 자막이 이 값만큼 앞뒤로 움직인다**(아래 caption-cue의 leadMs).
// 2026-09-05 실측 0.54초. 400ms는 재생 직전 대기(이 파일 안에 있다), 나머지는 음원 받아오기와
// 재생 시작이다. 그 400ms를 고치면 이 값도 같이 고쳐야 한다.
const TTS_LEAD_MS = 540

// 앱 전역 SSE 수신 — 예약·아침 방송이 서버에서 발화되면 자동 재생
// enabled=false면 SSE를 열지 않는다. 소리를 못 내는 창(안내도)이 SSE를 열면 서버의
// 소리 담당 후보가 되고(sse.js: 먼저 붙은 창이 담당), 그 창이 담당으로 뽑히면 안내
// 음성만 나고 음원·BGM은 아무 데서도 안 난다 — 절반만 들리는 방송이 된다.
export default function useScheduledBroadcast(enabled = true) {
  const audioRef         = useRef(null)
  const ttsBusRef        = useRef(null)   // [audioBus] 예약·아침방송 TTS의 장부 등록 손잡이
  // 예약 안내에 깐 로컬 반주를 **꼬리(bgm_end_delay) 뒤에** 끄는 타이머. 걷는 자리는 clearBgmTimers 하나다.
  // (예전엔 BGM 을 늦게 켜는 타이머도 있었다 — 외부 동영상 반주용이라 2026-09-21 걷어냈다.)
  const bgmEndTimerRef   = useRef(null)
  // 이 훅이 깐 **로컬 반주의 주인 표**(2026-09-21 Codex). 로컬 반주는 MusicPlayer 가 350ms 뒤에 시작하므로
  // 세대 검사만으로는 그 시작을 못 막는다 — 취소·교체 때 이 주인 표로 「내 반주만」 끄라고 알린다.
  // 주인 표가 없는 BGM(서버 신호로 시작한 식사 BGM 등)은 이 훅의 끄기 신호가 건드리지 않는다.
  const 로컬반주주인Ref = useRef(null)
  // **이 방송이 아직 유효한가** — 한 자리씩 막는 대신 세대를 센다.
  //
  // UX-17 로 일곱 회차를 도는 동안 지적이 전부 같은 뿌리였다: *늦게 깨어나는 것이
  // 정지된 줄 모른다*. 그때마다 발견된 타이머 하나에 손잡이를 달았는데, 이 훅의 본문은
  // `await` 를 네 번 한다(350ms · 예약 지연 · 음원 받기 · 400ms). **손잡이로는 `await` 를
  // 못 걷는다** — 그래서 R6 을 고친 뒤에도 예약 TTS 경로에 같은 구멍이 남아 있었다
  // (내부 독립 검수 2026-09-12: 정지 350ms 안에 `broadcast-bgm-start` 가 나가 BGM 이 되살아난다).
  //
  // 규칙은 하나다: **정지·교체가 세대를 올리고, 모든 `await` 뒤에서 세대를 확인한다.**
  const 세대Ref = useRef(0)
  const toastTimerRef = useRef(null)   // 토스트 지우는 타이머 — 언마운트 때 걷는다
  const broadcastVolRef  = useRef(0.80)   // 방송 TTS 볼륨 (0~1)
  const [toast,       setToast]       = useState(null)
  const [nowPlaying,  setNowPlaying]  = useState(false)

  // 하나만 있어야 한다는 규칙의 두 번째 그물 — 실제로 둘이 되면 콘솔에 크게 남긴다.
  useEffect(() => {
    if (!enabled) return
    살아있는처리기 += 1
    if (살아있는처리기 > 1) {
      console.error(
        `[방송] useScheduledBroadcast가 ${살아있는처리기}개 떠 있습니다 — 같은 방송에 재생 경로가 `
        + '여러 번 돌아 안내 음성이 겹칩니다. 이 훅은 App.jsx 한 곳에서만 써야 합니다.')
    }
    return () => { 살아있는처리기 -= 1 }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    // 방송 볼륨 동기 (VolumePanel에서 carecast:broadcast-volume 이벤트 수신)
    const onBcastVol = (e) => { broadcastVolRef.current = Number(e.detail) / 100 }
    window.addEventListener('carecast:broadcast-volume', onBcastVol)

    // **BGM 타이머를 걷는 곳은 여기 하나다.** 켜는 것과 끄는 것이 둘인데 걷는 자리가
    // 넷이라, 각자 적으면 반드시 한쪽만 걷는다 — 실제로 켜는 타이머를 놓쳐서 정지한 뒤
    // 350ms 에 BGM 이 다시 시작됐다(Codex 재현, EV-004783). 재생기 쪽 `clearFade` 와 같은 교훈.
    const clearBgmTimers = () => {
      if (bgmEndTimerRef.current) { clearTimeout(bgmEndTimerRef.current); bgmEndTimerRef.current = null }
    }

    const stopBGM = () => {
      clearBgmTimers()
      // 이 훅이 깐 로컬 반주를 끈다(취소·새 방송·정지).
      // 안 끄면 취소된 예약의 반주가 350ms 뒤 뒤늦게 시작해 새 방송 뒤까지 흘렀다(Codex 재현).
      if (로컬반주주인Ref.current) {
        window.dispatchEvent(new CustomEvent('carecast:broadcast-local-bgm-stop', {
          detail: { owner: 로컬반주주인Ref.current, fadeMs: 300 },
        }))
        로컬반주주인Ref.current = null
      }
    }

    // 앱 레벨 TTS 오디오 정지 (carecast:stop-broadcast 이벤트 유발 없음)
    const stopCurrent = () => {
      // **세대를 먼저 올린다.** 이 한 줄이 아직 안 깨어난 `await` 들을 전부 무효로 만든다 —
      // 타이머 손잡이가 못 걷는 것까지 여기서 걷힌다.
      세대Ref.current += 1
      stopBGM()
      // [audioBus] TTS 정지 — 장부 해제 (td09 1단계, 기록만)
      ttsBusRef.current?.done(); ttsBusRef.current = null
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
        window.dispatchEvent(new CustomEvent('carecast:broadcast-tts-end'))
      }
    }

    // ── **일시정지** (사용자 지시 2026-09-15) ───────────────────────────────────
    // 자동·예약 방송의 안내 음성은 **이 창이** 낸다(바로 위 `audioRef`). 그래서
    // 재생바의 스페이스바·단추로 멈췄다 이을 수 있다.
    //
    // **정지와 다르다.** 정지(`stopCurrent`)는 세대를 올리고 장부를 내리고 오디오를
    // 버린다. 이것은 **자리를 지킨 채** 멎는다 — `세대Ref`·`ttsBusRef` 를 안 건드린다.
    //
    // **한계를 적어 둔다**: 멈추는 것은 *이 창의 소리*뿐이고 **서버의 다음 단계는
    // 예정대로 온다.** 몇 초 멈추는 데는 맞는 동작이고, 오래 멈춰 두면 다음 단계가
    // 그 위로 겹친다. 서버까지 멈추는 것은 「정지」 하나다.
    const onPauseToggle = (e) => {
      const a = audioRef.current
      if (!a) return
      if (e.detail?.멈춤) a.pause()
      // 다시 틀 때 실패해도 화면을 안 깨뜨린다 — 브라우저가 자동재생을 막을 수 있다.
      else a.play?.().catch(() => {})
    }
    window.addEventListener('carecast:pause-toggle', onPauseToggle)

    const es = initSSE(async (data) => {
      // 지시가 도착한 순간. 여기서 소리까지 얼마나 걸렸는지가 지금 통째로 안 보이는 구간이다
      // ("12:00 예약인데 12:01에 들린다" — 서버 로그는 12:00:01에서 끝난다).
      const eventAt = Date.now()
      const { type, title, content, audioId, bgm, durationMin, url, name, token, category, source } = data
      // 이 방송에만 쓸 볼륨(0~100). 서버가 예약의 main_volume을 해석해서 실어 보낸다.
      // 없으면 지금까지처럼 화면의 음량 슬라이더 값을 쓴다 — 슬라이더 자체는 절대 건드리지 않는다.

      // ── 새 SSE 이벤트 처리 ─────────────────────────────────

      // 소리 내는 창의 "진짜 시작" 보고가 서버를 거쳐 돌아온 것(routes/morning.js).
      // **리더 게이트 앞이다** — 이 신호가 필요한 쪽은 소리를 안 내는 창이다.
      // 자막 층이 어림값 대신 이 실측값으로 시계를 다시 건다.
      if (type === 'caption_sync') {
        window.dispatchEvent(new CustomEvent('carecast:caption-resync', {
          detail: { audioId, leadMs: Number(data.sinceEventMs) },
        }))
        return
      }

      if (type === 'broadcast_started') {
        // 접속 스냅샷(routes/events.js)이면 "지금 방송 중"이라는 표시 동기화일 뿐이다 —
        // 방송 도중 재접속한 현장 창이 자기 TTS를 세우면 안 된다. 진짜 시작일 때만 정리한다.
        if (!data.snapshot) stopCurrent()  // 이전 방송 오디오 즉시 정리 (중복 방지)
        window.dispatchEvent(new CustomEvent('carecast:broadcast-started', { detail: { title: title || '방송 중' } }))
        // 가림막은 **자동방송 5종에서만** 뜬다. 예전에는 그 5종의 제목을 여기 글자로 복사해
        // 두고 맞춰 봤는데, 서버(broadcastSequencer의 LANES)에서 제목을 한 자만 고쳐도
        // 여기가 조용히 안 맞게 된다. 이제 서버가 실어 보내는 식별자(tab)로 판단한다.
        if (data.tab) {
          window.dispatchEvent(new CustomEvent('carecast:overlay-show', { detail: { title, tab: data.tab } }))
        }
        setNowPlaying(true)
        return
      }
      if (type === 'broadcast_stopped') {
        // **접속 스냅샷은 정지가 아니다.** 서버는 SSE에 새로 붙은 화면에게 "지금 방송
        // 중이 아니다"를 알리려고 이 이벤트를 한 번 보낸다(routes/events.js). 그건
        // 표시 동기화지 사람이 누른 정지가 아닌데, 여기서 둘을 같이 다루고 있었다.
        // stop-broadcast는 흐르던 BGM·TV 송출을 실제로 끄는 신호라, 표를 안 보면
        // 재접속할 때마다(서버 재시작·자동 업데이트·네트워크 끊김) 소리가 죽는다
        // — 2026-09-04에 현장(main)에서 그렇게 터졌다. 여기도 965325f 이후 같은
        // 지뢰를 안고 있었다(현장이 main을 돌려서 안 터졌을 뿐이다).
        // 표시(오버레이 내리기·아래 바 비우기)는 스냅샷에서도 그대로 한다.
        if (!data.snapshot) {
          stopCurrent()
          // byUser: 흐름이 스스로 단계를 끊은 것(auto)은 사람의 정지가 아니다. 마이크 생방송만
          // 이 값을 본다(td09 H10 — 자동은 마이크를 안 끊는다). 다른 재생기는 표를 안 보고 멎는다.
          window.dispatchEvent(new CustomEvent('carecast:stop-broadcast', { detail: { byUser: !data.auto } }))
        }
        window.dispatchEvent(new CustomEvent('carecast:broadcast-ended'))
        setNowPlaying(false)
        return
      }
      if (type === 'broadcast_step') {
        // 지금 몇 번째 단계인지. **여기서 반드시 return한다** — 이 처리기의 끝단은
        // "그 밖의 이벤트 = 예약 TTS 재생"이라, 흘려보내면 현장 PC가 이 알림으로
        // 오디오를 재생하려 든다.
        window.dispatchEvent(new CustomEvent('carecast:broadcast-step', { detail: data }))
        return
      }
      if (type === 'mic_live') {
        // 마이크 생방송 신호등(서버 micLive) — 방송자가 아닌 화면의 즉시 방송 카드가
        // "다른 기기에서 방송 중"을 띄우는 근거. 소리와 무관한 표시 신호라 여기서 끝낸다.
        window.dispatchEvent(new CustomEvent('carecast:mic-live', { detail: data }))
        return
      }
      if (type === 'broadcast_completed') {
        window.dispatchEvent(new CustomEvent('carecast:broadcast-ended'))
        setNowPlaying(false)
        return
      }
      if (type === 'sound_owner') {
        // **소리 담당은 서버가 정한다.**
        // 예전에는 브라우저 저장공간(localStorage)에 대표 표시를 남겨 화면이 스스로 정했는데,
        // 그 공간은 접속 주소마다 분리된다. 같은 PC에서 localhost와 127.0.0.1로 각각 열면
        // 서로를 못 봐서 **둘 다 자기가 담당이라 믿고 같이 재생했다**(겹쳐 들리던 원인).
        // 서버는 어느 연결이 루프백인지 요청 주소로 알고 있고 그 목록은 주소가 갈려도 하나다.
        //
        // 서버가 아무도 못 고른 경우(tabId=null)에는 손대지 않는다 — 아래 localStorage
        // 선출이 예전처럼 돌아간다. 겹쳐 들리는 것보다 무음이 훨씬 나쁘다.
        if (data.tabId != null) {
          window.CC_SERVER_PICKED_OWNER = true
          window.CC_IS_LEADER = (data.tabId === _TAB_ID) && _IS_LOCAL
          // 중복 창 안내는 다른 컴포넌트가 그린다 — 창 이벤트로 넘긴다
          window.dispatchEvent(new CustomEvent('carecast:sound-owner', {
            detail: { isLeader: window.CC_IS_LEADER },
          }))
        }
        return
      }
      if (type === 'server_update') {
        // 서버 재시작 예정 — sessionStorage 플래그 설정
        // useConnectionWatch가 다음 폴링 성공 시 즉시 reload (2회 실패 대기 불필요)
        sessionStorage.setItem('cc_server_update_pending', '1')
        return
      }
      if (type === 'video_play') {
        // 현장 PC leader 탭만 재생 — 예약 TTS 와 동일한 원칙. 이 가드가 없으면 원격
        // PC/직원 휴대폰 등 연결된 모든 탭이 국민체조·식전체조 영상을 전체화면+음소거 해제로
        // 재생 시도한다.
        if (!window.CC_IS_LEADER || !_IS_LOCAL) return
        // **칸을 빠뜨리지 않는다.** 여기서 한 칸만 빼고 넘기면 재생기가 그 값을 못 본다 —
        // 보내는데(`broadcastSteps.js` 의 `delayProfile`), 여기서 그 한 칸만 빼고 넘기면
        // `VideoPlayer` 가 폴백(`category === 'exercise-video' ? 'A' : 'B'`)으로 떨어진다.
        // 그러면 **체조 단계에 다른 폴더의 영상을 연결했을 때 지정한 A 가 B 로 바뀌고**
        // 소리·자막이 그만큼 어긋난다 — 오류는 안 난다(V③ R18 지적 3, 2026-09-14).
        // **조립은 `lib/videoPlayEvent` 한 곳에서 한다.** 여기서 칸을 손으로 적으면
        // 또 한 칸이 조용히 빠진다 — 실제로 `delayProfile` 이 그렇게 빠졌고, 그것을
        // 지키려고 붙인 가드마저 **글자만 봐서** 못 잡았다(V③ R23 지적 1).
        window.dispatchEvent(new CustomEvent('carecast:video-play', {
          detail: 영상재생상세({ url, name, token, category, source, ...data }),
        }))
        return
      }
      if (type === 'morning_video_start') {
        window.dispatchEvent(new CustomEvent('carecast:overlay-hide'))
        // 이 PC 의 「배경 영상」 파일 주소(2026-09-21 — 예전엔 외부 영상 id 였다)
        window.dispatchEvent(new CustomEvent('carecast:morning-video-start', { detail: { url, durationMin } }))
        return
      }

      // BGM 길이 타이머는 재생기(MusicPlayer)가 직접 받는다(`bgm_set_timer` SSE). 여기서는 아래
      // 안내 재생 갈래로 새지 않게만 막는다 — 예전엔 외부 동영상 반주의 끄기 타이머를 여기 걸었다.
      if (type === 'bgm_set_timer') return

      // ── 즐겨찾기 버튼 업데이트 ─────────────────────────────
      if (type === 'favorites_updated') {
        window.dispatchEvent(new CustomEvent('carecast:favorites-updated'))
        return
      }

      // ── 기관 이름·표어가 바뀌었다 (2026-09-13) ──────────────
      // 홀 TV 의 큰 글씨다. 설정에서 저장하는 사람과 그 글씨가 뜨는 창은 **서로 다른 창**
      // (대개 다른 PC)이라, 저장한 창 안에서만 갱신하면 홀 TV 는 영영 옛 값을 들고 있다.
      if (type === 'org_info') {
        window.dispatchEvent(new CustomEvent('carecast:org-info', { detail: data }))
        return
      }

      // ── 예약이 바뀌었다 (P-16) ─────────────────────────────
      // 다른 기기·다른 화면이 지우거나 고쳤다. 예약을 보여주는 화면들이 다시 읽는다.
      // `by` 에 바꾼 탭의 id 가 실려 온다 — **자기가 바꾼 것이면 건너뛴다.**
      // 그 화면은 이미 자기 상태를 고쳤고, 여기서 또 읽으면 목록이 한 번 깜빡인다.
      if (type === 'schedules_updated') {
        window.dispatchEvent(new CustomEvent('carecast:schedules-updated', { detail: data }))
        return
      }

      // ── 서버 스피커 TTS 덕킹 (td09 H6) ─────────────────────
      // 쉬운화면 '방송하기'·즐겨찾기 문구의 실소리는 서버 스피커다. 서버가 재생의 시작·끝을
      // SSE로 알리면 예약 TTS와 같은 덕킹 이벤트로 바꿔 쏜다 — 누른 PC가 아니라 BGM을
      // 틀고 있는 창(MusicPlayer)이 들어야 해서 window 이벤트만으로는 안 됐다.
      if (type === 'tts_speak') {
        window.dispatchEvent(new CustomEvent(data?.state === 'start'
          ? 'carecast:broadcast-tts-start' : 'carecast:broadcast-tts-end',
          // **이 소리는 서버 스피커가 낸다**(`routes/tts.js` 의 `audioQueue`).
          // 재생바가 「일시정지 못 하는 갈래」로 가르는 근거다.
          { detail: { 서버소리: true } }))
        return
      }

      // ── **정지가 시작보다 먼저 올 수 있다** (V③ R10 지적, 2026-09-14) ──────────────
      // 즉시 방송이 반주를 깔고 **안내 재생이 곧바로 실패**하면 서버가 바로 `bgm_stop` 을
      // 쏜다. 그런데 아래 시작 처리는 반주를 **350ms 뒤에** 켠다 — 정지가 그 사이에 도착하면
      // **정지한 뒤에 반주가 켜지고 영영 안 꺼진다**(길이가 0 이라 자동 종료도 없다).
      //
      // `MusicPlayer` 도 `bgm_stop` 을 받지만 **제 타이머만** 걷는다. 여기 걸린 타이머는
      // 여기서 걷어야 한다 — 위 `clearBgmTimers` 머리말이 같은 사고를 이미 적어 뒀다
      // (EV-004783). **걷는 자리를 하나로 두는데 부르는 자리를 빠뜨렸던 것**이다.
      if (type === 'bgm_stop') { stopBGM(); return }

      // ── 자막 ──────────────────────────────────────────────
      // **리더 게이트 앞이다.** 소리는 현장 PC 한 창만 내지만 자막은 연결된 모든 창이 봐야
      // 한다(배리어프리). 소리 내는 창은 아래에서 <audio>를 넘겨 정확한 위치로 따라가고,
      // 나머지 창은 이 시각을 기준으로 도는 추정 시계를 쓴다.
      //
      // leadMs = 이 이벤트를 받고 소리가 실제로 시작하기까지 걸리는 시간.
      //
      // 이 값이 틀리면 **소리를 안 내는 창에서만** 자막이 그만큼 어긋난다. 2026-09-05에
      // 실제로 재 봤다(자막 계기판, 소리 내는 창이 실측과 추정을 동시에 보여 준다):
      // 실측 18.72 · 추정 18.35 → 원격 자막이 **0.36초 늦게** 가고 있었다. 옛 값 900이
      // 실제(0.54초)보다 컸기 때문이고, 재생 중에 벌어지는 밀림은 없었다(18초 지점에서도
      // 0.36초 그대로).
      //
      // 그래서 아래 재생 코드가 **실제로 기다리는 것**을 그대로 더한다:
      //   BGM을 새로 트는 경우에만 350ms(로컬 BGM 페이드 대기) — 옛 값은 이걸 빠뜨렸다
      // + 예약에 지정된 BGM 지연
      // + 음원 받아오기와 재생 직전 400ms 대기(측정 0.54초)
      //
      // **여전히 어림값이다.** PC가 느리거나 파일이 크면 받아오기가 길어져 다시 틀어진다.
      // 정확히 맞추려면 리더가 이미 서버에 보내고 있는 '재생 시작' 보고(routes/morning.js의
      // play-started)를 되쏘아 원격이 실측값으로 시계를 다시 맞추면 된다 — 지금은 그 보고를
      // 도스창에 한 줄 찍고 버린다.
      if (data.cues) {
        // 로컬 반주는 350ms 뒤에 시작한다(MusicPlayer 가 앞 소리를 걷고 들어가는 간격).
        const bgmSwap = bgm?.files?.length ? 350 : 0
        // audioId를 함께 싣는다 — 아래 caption_sync가 "어느 방송의 보정인지" 가리는 열쇠다.
        window.dispatchEvent(new CustomEvent('carecast:caption-cue', {
          detail: { kind: 'tts', title, cues: data.cues, audioId,
                    leadMs: bgmSwap + (bgm?.delay ?? 0) * 1000 + TTS_LEAD_MS },
        }))
      }

      // ── 예약 방송 / 아침 방송 TTS 재생 ────────────────────
      // 현장 PC leader 탭만 처리 — audioId는 1회 소비이므로 remote PC가 먼저 fetch하면 현장 PC 묵음 발생
      if (!window.CC_IS_LEADER || !_IS_LOCAL) return
      // 탭 중복재생 방지 — 같은 PC에 탭이 여러 개일 때 첫 번째 탭만 재생
      if (audioId) {
        try {
          const lk = `cc_${audioId}`
          const existing = localStorage.getItem(lk)
          if (existing && Date.now() - parseInt(existing, 10) < 300000) return  // 5분 TTL
          localStorage.setItem(lk, String(Date.now()))
        } catch { /* localStorage가 막혀도 방송은 그대로 받아야 한다 — 중복 억제만 못 하는 것 */ }
      }
      try {
        // 이전 TTS만 정리 — BGM은 새 방송에 bgm이 있을 때만 교체 (없으면 기존 BGM 유지)
        // [audioBus] 이전 TTS 장부 해제 — 새 TTS는 아래에서 다시 등록한다
        ttsBusRef.current?.done(); ttsBusRef.current = null
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; window.dispatchEvent(new CustomEvent('carecast:broadcast-tts-end')) }
        clearBgmTimers()   // 켜는 타이머도 함께 — 한쪽만 걷으면 정지 뒤 다시 시작한다
        // **앞 예약이 깐 로컬 반주는 끝낸다**(2026-09-21 Codex 2회차). 「새 방송에 bgm 이 없으면 기존 BGM
        // 유지」는 원래 흐르던 음악(수동·식사 BGM — 주인 표 없음)에 대한 말이다. 앞 예약의 반주는 그
        // 방송이 이제 무효라 주인이 없어지고, 바로 위에서 그 꼬리 타이머도 걷혔다 — 두면 아무도 안 끈다.
        // 아직 350ms 대기 중이면 시작 자체가 걷힌다. 주인 표로 끄므로 다른 BGM 은 건드리지 않는다.
        if (로컬반주주인Ref.current) {
          window.dispatchEvent(new CustomEvent('carecast:broadcast-local-bgm-stop', {
            detail: { owner: 로컬반주주인Ref.current, fadeMs: 300 },
          }))
          로컬반주주인Ref.current = null
        }

        // **이 방송의 세대.** 새 방송이 들어오면 앞 방송의 남은 `await` 는 전부 무효다.
        const 세대 = (세대Ref.current += 1)
        const 취소됨 = () => 세대 !== 세대Ref.current

        // ── 로컬 반주 (2026-09-21) — 이 PC 의 방송용·식사용 폴더 ──────────────────
        // 서버의 resolveBGM 이 `kind:'local'` 로 곡 목록을 실어 보낸다. 재생은 MusicPlayer 가 하고
        // (녹음 음원 뒤 복귀·덕킹·볼륨이 거기 있다), 여기는 **언제 깔고 언제 끌지**만 정한다.
        // **곡이 실제로 시작할 때까지 기다린 뒤** 안내로 넘어간다(2026-09-21 코드 검수 High).
        // MusicPlayer 는 앞 소리를 걷고 350ms 뒤 곡을 시작하며, 시작할 때 3초 페이드 인을 건다.
        // 예전 판은 기다리지 않아서, 앞당김이 0초인 예약은 **덕킹(안내 시작 신호)이 곡 시작보다 먼저**
        // 와 곡 시작의 페이드 인이 덕킹을 지웠다 — 안내 내내 반주가 제 음량으로 깔렸다.
        // MusicPlayer 의 350ms 타이머가 확실히 먼저 돌도록 조금 더 기다린다.
        // 자막 시계(`bgmSwap` 350ms)와도 이제 맞는다.
        if (bgm?.kind === 'local' && bgm.files?.length) {
          // 이 방송 한 번의 주인 표 — 끄는 신호도 이것을 싣는다(다른 BGM 을 잘못 끄지 않게).
          로컬반주주인Ref.current = `예약-${세대}-${audioId || ''}`
          window.dispatchEvent(new CustomEvent('carecast:broadcast-local-bgm-start', {
            detail: { files: bgm.files, bgmDefault: bgm.bgmDefault, durationMin: 0, durationSec: 0, owner: 로컬반주주인Ref.current },
          }))
          await new Promise(r => setTimeout(r, 380))
          if (취소됨()) return
        }

        const delayMs = (bgm?.delay ?? 0) * 1000
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
        if (취소됨()) return

        const blob = await fetchScheduledAudio(audioId)
        // 음원을 받아오는 동안 정지했을 수 있다. 여기서 안 멈추면 **아무도 못 멈추는
        // 재생**이 된다 — `audioRef` 에 들어가기 전이라 이후 어떤 정지에도 안 잡힌다.
        if (취소됨()) return
        const objUrl = URL.createObjectURL(blob)

        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }

        const audio = new Audio(objUrl)
        // 예약에 지정된 안내 음성 볼륨이 있으면 이 재생에만 적용한다(음량 슬라이더는 그대로)
        audio.volume = data.ttsVolume != null
          ? Math.max(0, Math.min(1, data.ttsVolume / 100))
          : broadcastVolRef.current
        audioRef.current = audio
        // 자막이 이 순간부터 추정이 아니라 currentTime을 따라간다. 이 창에만 도달한다.
        if (data.cues) window.dispatchEvent(new CustomEvent('carecast:caption-attach', { detail: { audio } }))
        // [audioBus] 예약·아침방송 TTS 재생 등록 — autoplay가 끝까지 차단되면
        // "등록됐지만 무음"일 수 있다(장부는 '내려던 소리'의 기록, audioBus.js 머리말 참고)
        ttsBusRef.current?.done()
        ttsBusRef.current = audioBus.register({ kind: 'tts', label: title || '예약 TTS' })

        setNowPlaying(true)
        window.dispatchEvent(new CustomEvent('carecast:broadcast-tts-start'))
        if (title) window.dispatchEvent(new CustomEvent('carecast:overlay-update', { detail: { nowPlaying: title } }))
        await new Promise(r => setTimeout(r, 400))
        // 이 400ms 안에 정지하면 `audioRef` 는 이미 비었는데 아래 `audio.play()` 는 그대로
        // 돈다 — 그러면 **새로고침 말고는 멈출 방법이 없는 소리**가 난다.
        if (취소됨()) { try { audio.pause() } catch { /* 아직 재생 전이면 그만 */ } return }

        // 서버는 이 신호로 다음 단계를 시작한다(CC-033). 안 보내면 글자수 추정 상한까지
        // 기다리므로, 성공이든 실패든 **반드시 한 번은** 보낸다. 두 번 보내도 안전하다
        // (서버는 첫 신호에 대기를 풀고 토큰을 지운다).
        let ended = false
        const reportEnded = () => {
          if (ended || !token) return
          ended = true
          audioEndedAPI(token).catch(err => console.error('[방송] 종료 보고 실패:', err.message))
        }

        // 소리가 실제로 시작된 순간을 한 줄 남긴다(진단용, 실패해도 방송에 영향 없음)
        audio.addEventListener('playing', () => {
          // audioId를 같이 보낸다 — 서버가 이 값을 되쏘고, 원격 창은 자기가 받은 자막의
          // audioId와 같을 때만 시계를 고친다(routes/morning.js의 play-started).
          reportPlayStarted({ label: title || '예약 방송', kind: '예약', audioId,
                              sinceEventMs: Date.now() - eventAt })
        }, { once: true })

        audio.play().catch(() => {
          // **정지가 이 play() 를 거절시킨 것일 수 있다.** `pause()` 는 대기 중인 play 를
          // AbortError 로 거절한다 — 그것을 "자동재생 차단" 으로 읽고 muted 폴백을 돌리면
          // **정지를 눌렀는데 다시 재생된다.** 그때 `audioRef` 는 이미 비어 있어
          // 이후 어떤 정지로도 안 잡힌다(Codex UX-17-R8 지적 [1], VM 재현).
          if (취소됨()) { try { audio.pause() } catch { /* 이미 멈췄으면 그만 */ } return }
          // Edge 앱모드 autoplay 차단 시 muted 폴백 (muted 재생은 항상 허용)
          audio.muted = true
          audio.play().then(() => {
            // 폴백이 성공해도 그 사이 정지했을 수 있다.
            if (취소됨()) { try { audio.pause() } catch { /* 그만 */ } return }
            audio.muted = false
          })
            // 여기까지 실패하면 정말 아무 소리도 안 난다. 예전엔 이 자리가 빈 catch라
            // 무음인 채로 서버는 성공으로 기록했다 — 직원이 알 방법이 없었다.
            .catch(err => {
              if (취소됨()) return   // 정지 때문에 실패한 것을 "차단" 으로 이력에 남기지 않는다
              reportBroadcastFailure(title, `자동재생 차단: ${err?.message ?? err}`)
              reportEnded()   // 소리가 안 났어도 다음 단계는 가야 한다 — 안 보내면 상한까지 멈춘다
            })
        })
        // 디코드 실패·파일 손상도 소리가 안 나는 것은 마찬가지다
        audio.onerror = () => {
          reportBroadcastFailure(title, '오디오를 재생할 수 없습니다(디코드 실패)')
          reportEnded()
          // [audioBus] 디코드 실패 — 소리가 안 났으니 장부에서 내린다
          ttsBusRef.current?.done(); ttsBusRef.current = null
        }
        audio.onended = () => {
          reportEnded()
          // [audioBus] TTS 자연 종료 — 장부 해제
          ttsBusRef.current?.done(); ttsBusRef.current = null
          URL.revokeObjectURL(objUrl)
          audioRef.current = null
          setNowPlaying(false)
          try { if (audioId) localStorage.removeItem(`cc_${audioId}`) } catch { /* 재생 표시 지우기 — localStorage가 막혀 있으면 애초에 표시도 없었다 */ }
          window.dispatchEvent(new CustomEvent('carecast:broadcast-tts-end'))
          if (bgm) {
            const endDelayMs = (bgm.endDelay ?? 0) * 1000
            // **꼬리 안에 페이드를 넣는다**(UX-17 ④). 예전엔 `endDelayMs` 를 다 기다린 뒤
            // 정지를 쐈고, 받은 쪽이 **그때부터** 300ms 페이드를 시작해 실제 무음이
            // 5374ms 였다([FACT] EV-003954). 페이드 길이만큼 당겨 쏜다 —
            // 숫자는 `lib/bgmFade` 한 곳에 있다(양쪽에 적으면 한쪽만 고쳐진다).
            const 쏠때 = bgmStopAfterMs(endDelayMs)
            // **꼬리가 짧으면 페이드도 줄인다.** 안 알려주면 재생기가 늘 300ms 를 걸어서,
            // 꼬리 0초인데 0.32초가 더 붙는다(EV-004737). 꼬리 0이면 페이드도 0이다.
            const 페이드ms = bgmFadeMsFor(endDelayMs)
            // **마감 시각을 함께 보낸다.** 길이만 보내면 신호를 쏘는 데 걸린 몇 ms 가
            // 꼬리 위에 그대로 얹힌다 — 짧은 꼬리(0.1초)에서는 그것만으로 넘친다
            // (Codex 재현, EV-004753). 받는 쪽이 "지금부터 마감까지" 로 맞추면
            // 그 오차가 스스로 사라진다. **추측 대신 시각을 준다.**
            const 마감시각 = Date.now() + endDelayMs
            // 로컬 반주는 MusicPlayer 가 끈다 — `{fadeMs, 마감시각}` 을 받는다(2026-09-21).
            const 끌신호 = 'carecast:broadcast-local-bgm-stop'
            // **이 방송의 주인 표**를 싣는다 — 꼬리 사이에 다른 BGM 이 시작했으면 그것은
            // 건드리지 않는다(2026-09-21 Codex 재현: 앞 예약의 꼬리 타이머가 새 식사 BGM 을 껐다).
            const 주인 = 로컬반주주인Ref.current
            const 쏘기 = () => {
              window.dispatchEvent(new CustomEvent(끌신호, {
                detail: { fadeMs: 페이드ms, 마감시각, ...(주인 !== undefined ? { owner: 주인 } : {}) },
              }))
              if (주인 !== undefined && 로컬반주주인Ref.current === 주인) 로컬반주주인Ref.current = null
            }
            if (쏠때 > 0) {
              bgmEndTimerRef.current = setTimeout(() => {
                bgmEndTimerRef.current = null
                쏘기()
              }, 쏠때)
            } else {
              쏘기()
            }
          }
        }

        setToast({ title, content })
        // 손잡이를 잡는다 — 언마운트 뒤에 깨어나 상태를 건드리면 React 경고가 나고,
        // 방송이 잇따르면 앞 토스트의 타이머가 뒤엣것을 지운다.
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
        toastTimerRef.current = setTimeout(() => { toastTimerRef.current = null; setToast(null) }, 5000)
      } catch (e) {
        // 예전엔 여기가 빈 catch였다. 삼켜지던 것들: 음원 조회 404(서버가 재시작해
        // audioStore의 인메모리 Map이 비었을 때) · 네트워크 오류 · Blob 디코드 실패.
        // 전부 "아무 소리도 안 났는데 이력에는 성공"으로 끝났다(2026-08-29 리뷰 CC-009).
        console.error('[방송 재생 실패]', e)
        // 배너 표시 + 이력 기록을 한 번에 한다(api.js의 reportBroadcastFailure).
        // 5초 토스트로는 부족하다 — 자리를 비운 사이에 지나가면 없는 것과 같다.
        reportBroadcastFailure(title, e?.message ?? String(e))
      }
    })

    // carecast:stop-broadcast → 앱 레벨 TTS 정지
    window.addEventListener('carecast:stop-broadcast', stopCurrent)

    return () => {
      es.close()
      window.removeEventListener('carecast:stop-broadcast', stopCurrent)
      window.removeEventListener('carecast:broadcast-volume', onBcastVol)
      window.removeEventListener('carecast:pause-toggle', onPauseToggle)
      // **언마운트도 정지다.** `stopCurrent` 가 세대를 올리고 **재생 중인 TTS 까지 멈춘다** —
      // 예전에는 BGM 만 멈춰서, 창이 사라진 뒤에도 안내 음성이 계속 나고 정지 구독마저
      // 걷혀 **그 소리를 멈출 방법이 없었다**(Codex UX-17-R8 지적 [2], VM 재현).
      if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); toastTimerRef.current = null }
      stopCurrent()
    }
  }, [enabled])

  return { toast, nowPlaying }
}
