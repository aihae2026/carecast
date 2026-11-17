import { useState, useEffect, useRef } from 'react'
import { Square, Music2, Film, Pause, Play } from 'lucide-react'
import { stopBroadcast as stopBroadcastAPI, getNowPlaying, postNowPlaying } from '../../lib/api'
import { 단축키뜻, 글자입력중, 일시정지할수있나 } from '../../lib/shortcutRules'
import { 안내중 } from '../../lib/tourStage'

// ── **아래 BGM 바 바로 위에 붙는다** (사용자 지적 2026-09-15) ────────────────────
// *"저 빨간 줄은 밑에랑 일부러 띄워놓는 거야?"* — 아니다. **버그였다.**
//
// 이 바는 `bottom: '4rem'`(64px) 을 **세 군데에 하드코딩**하고 있었다. 그런데 밑에 깔린
// BGM 바(`MusicPlayer`)는 **높이가 둘**이다 — BGM 이 쉴 때 40px, 나올 때 64px.
// 그래서 **BGM 이 쉬는 동안 24px 이 떴다.** 현장 사진에서 빨간 줄과 「BGM 대기 중」
// 사이가 벌어져 보인 것이 그것이다.
//
// `MusicPlayer` 는 **이미 제 높이를 내보내고 있었다**(`--cc-nowplaying-h`, 그 파일이
// 정하는 두 값 중 하나). 안 쓰고 있었을 뿐이다. 같은 실수를 관리자 사이드바가 먼저
// 겪었고(그때도 24px 이 덮여 「시스템 안내도」가 가렸다) 그 교훈으로 이 변수가 생겼다.
// **매직 넘버를 양쪽에 적으면 한쪽만 바뀌는 날 어긋난다.**
const 아래바높이 = 'var(--cc-nowplaying-h, 64px)'

// 즉시 방송을 세울 때 쓰는 제목. **세우는 쪽과 지우는 쪽이 같은 글자를 본다** —
// 글자를 두 곳에 적으면 한쪽을 다듬는 날 지우는 조건이 조용히 안 맞는다.
const 즉시방송제목 = '즉시 방송'

export default function NowPlayingBar() {
  const [st, setSt] = useState({ broadcast: null, bgm: null, video: null })
  // 지금 몇 번째 단계인가 — 서버가 단계를 시작할 때마다 보내 준다.
  // 5분째 조용할 때 그게 원래 조용한 단계(6분 대기 중인 투약 안내)인지 멈춘 것인지를 이걸로 안다.
  const [step, setStep] = useState(null)
  // **멈춰 둔 상태인가.** 화면이 기억한다 — 서버는 이 창이 내는 소리를 모른다.
  const [멈춤, set멈춤] = useState(false)
  const stRef = useRef(st)
  stRef.current = st
  // 서버 보고를 보낸 순서대로 줄 세운다(아래 report 머리말).
  const 보고줄 = useRef(Promise.resolve())

  // 서버 폴링 (3초) — 다른 PC에서 접속해도 현재 상태 반영
  useEffect(() => {
    const poll = async () => {
      try { setSt(await getNowPlaying()) } catch { /* 3초마다 다시 묻는다 — 한 번 실패는 다음 폴링이 덮는다 */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  // 로컬 CustomEvent → 서버에 즉시 보고 (메인 PC에서만 실제로 발생)
  useEffect(() => {
    // ── **시작·끝이 거의 동시에 와도 「방송 중」이 안 굳는다** (2026-09-17 브라우저 전수 시험) ─────────
    // 재생이 곧바로 거절되면(장치 없음·재생기 오류) 서버가 `tts_speak` 시작과 끝을 몇 ms 차이로 보낸다.
    // 그런데 끝 처리(`onImmediateEnd`)는 `stRef` 를 보는데, 시작이 부른 `setSt` 는 **다음 렌더에야** 반영돼
    // 끝이 「방송 없음」으로 읽고 그냥 돌아갔다 — 뒤이어 시작 보고가 서버에 닿아 표시가 **영영 남았다**
    // (실측: 실패 3분 뒤에도 `now-playing` 이 「즉시 방송」). 그래서 둘을 고친다:
    //   ① 참조를 **그 자리에서** 고친다 — 바로 뒤에 오는 신호가 방금 세운 값을 본다.
    //   ② 서버 보고를 **보낸 순서대로** 줄 세운다 — 시작 보고가 끝 보고보다 늦게 닿으면 같은 고장이다.
    const report = (patch) => {
      stRef.current = { ...stRef.current, ...patch }
      setSt(s => ({ ...s, ...patch }))
      보고줄.current = 보고줄.current.then(() => postNowPlaying(patch)).catch(() => {})
    }

    // ── **즉시 방송도 바에 뜬다** (사용자 신고 2026-09-15) ────────────────────
    // *"즉시방송했을 때는 밑에 보이지도 않고"* — 맞다. 즉시 방송은 `broadcast_started`
    // 를 안 쏘고 `tts_speak` 만 쏜다(서버 스피커로 나가는 길이라 화면이 재생하지 않는다).
    // 그래서 이 바가 그 방송을 몰랐다.
    //
    // **일시정지는 못 한다.** 소리를 내는 것이 이 창이 아니라 **서버 스피커**라서다.
    // 그 사실을 `서버소리` 로 실어 보내 재생바가 단추를 안 그리게 한다.
    const onImmediateStart = (e) => {
      if (stRef.current.broadcast) return   // 자동·예약 방송 중이면 그쪽이 주인이다
      report({ broadcast: { title: 즉시방송제목, 서버소리: !!e.detail?.서버소리 } })
    }
    // ── **끝 신호를 「칸 하나」에 걸지 않는다** (현장 신고 2026-09-16) ────────────
    //
    // 앞 판은 `서버소리` 가 참일 때만 지웠다. 그런데 그 칸이 서버 왕복에서 **버려졌고**
    // (`nowPlaying.js` 의 허용 칸 목록에 없었다), 3초 폴링이 그 값으로 화면을 덮자
    // 조건이 영영 거짓이 됐다 — **재생바가 「방송 중」인 채로 굳었고, 서버의 같은 표시가
    // 그 뒤 예약을 통째로 밀어 버렸다**(환기방송 2차가 그렇게 빠졌다).
    //
    // 칸은 고쳤지만 **여기도 고친다.** 지우는 신호가 한 칸의 생존에 걸려 있으면, 다음에
    // 어느 칸이든 하나가 빠지는 날 같은 고장이 되풀이된다. 이제 근거를 둘로 본다:
    //   · `서버소리` 가 참이거나 (제대로 온 경우)
    //   · 제목이 우리가 세운 그 제목이거나 (칸이 빠진 경우의 예비)
    // 둘 다 아니면 **남의 방송이므로 안 지운다** — 그 판단 자체는 옳았다.
    const onImmediateEnd = () => {
      const b = stRef.current.broadcast
      if (!b) return
      if (!b.서버소리 && b.title !== 즉시방송제목) return   // 남의 방송을 지우지 않는다
      report({ broadcast: null })
    }

    const onBroadcastStart = (e) => {
      const title = e.detail?.title || '방송 중'
      // 앞 방송의 단계 표시를 먼저 지운다. 취소로 끝난 방송은 broadcast_completed가 안 나가므로
      // (시퀀서가 취소 시 완료를 안 알린다) 새 방송 제목 옆에 앞 방송의 "7/8"이 그대로 남는다.
      clearStep()
      report({ broadcast: { title }, bgm: null, video: null })
    }
    const onBroadcastEnd = () => { clearStep(); report({ broadcast: null, video: null }) }

    const onBGMStart = (e) => {
      if (stRef.current.broadcast) return
      report({ bgm: { title: e.detail?.title || 'BGM' } })
    }
    const onBGMStop = () => report({ bgm: null })


    const onVideoPlay = (e) => {
      report({ video: { name: e.detail?.name || '영상 재생 중' } })
    }
    const onVideoClose = () => report({ video: null })

    const onStep = (e) => setStep(e.detail || null)
    const clearStep = () => setStep(null)
    window.addEventListener('carecast:broadcast-tts-start', onImmediateStart)
    window.addEventListener('carecast:broadcast-tts-end',   onImmediateEnd)
    window.addEventListener('carecast:broadcast-step',      onStep)
    window.addEventListener('carecast:broadcast-started',   onBroadcastStart)
    window.addEventListener('carecast:broadcast-ended',     onBroadcastEnd)
    window.addEventListener('carecast:broadcast-completed', onBroadcastEnd)
    window.addEventListener('carecast:broadcast-bgm-start', onBGMStart)
    // 표시는 "멎었다" 통지를 듣는다(명령/통지 분리, td09 §2) — 명령은 소리 주인만 듣는다
    window.addEventListener('carecast:broadcast-bgm-stopped', onBGMStop)
    window.addEventListener('carecast:video-play',          onVideoPlay)
    window.addEventListener('carecast:video-player-closed', onVideoClose)
    return () => {
      window.removeEventListener('carecast:broadcast-tts-start', onImmediateStart)
      window.removeEventListener('carecast:broadcast-tts-end',   onImmediateEnd)
      window.removeEventListener('carecast:broadcast-step',      onStep)
      window.removeEventListener('carecast:broadcast-started',   onBroadcastStart)
      window.removeEventListener('carecast:broadcast-ended',     onBroadcastEnd)
      window.removeEventListener('carecast:broadcast-completed', onBroadcastEnd)
      window.removeEventListener('carecast:broadcast-bgm-start', onBGMStart)
      window.removeEventListener('carecast:broadcast-bgm-stopped', onBGMStop)
      window.removeEventListener('carecast:video-play',          onVideoPlay)
      window.removeEventListener('carecast:video-player-closed', onVideoClose)
    }
  }, [])

  // 순서가 명세다(레드 검증 2026-09-02): **화면 이벤트 먼저, 서버는 뒤.** 이 창의 소리
  // (로컬 오디오·영상)는 window 이벤트로만 멎는데, 서버 응답을 기다린 뒤에 쏘면
  // 서버가 행에 걸렸을 때 그 시간만큼 소리가 계속 난다. FavoritesBar가 진작 지키던 순서다.
  const handleStop = async () => {
    // **`confirm()` 은 메인 스레드를 통째로 막는다** — 그 동안에는 키 이벤트가 아예
    // 안 들어온다. 그래서 여기서는 「확인창이 떠 있는가」를 따로 들고 있을 필요가 없다.
    // (`shortcutRules` 에 그 규칙이 남아 있는 것은, 스레드를 안 막는 **제 화면 확인창**을
    //  쓰는 자리가 나중에 생길 때를 위해서다.)
    if (!confirm('정말 종료하시겠습니까?')) return
    setSt(s => ({ ...s, broadcast: null, bgm: null }))
    postNowPlaying({ broadcast: null, bgm: null }).catch(() => {})
    window.dispatchEvent(new CustomEvent('carecast:stop-broadcast'))
    try { await stopBroadcastAPI() } catch (e) { console.error('[재생바] 정지 요청 실패:', e.message) }
  }
  // 파란 바(BGM만)의 정지도 빨간 바와 **같은 전체 정지 길**을 탄다(2026-09-02 사용자 결정 —
  // 정지는 아래 바 하나로 통일). 예전엔 BGM 정지 명령만 쐈는데, 그 신호는 로컬 BGM 을 못 세우고
  // 수동 곡 복원을 깨워 **정지를 눌렀는데 음악이 되살아나는** 구멍이었다(실기 신고). 확인창은 안 띄운다 —
  // BGM만 멎는 일이라 방송 종료(빨간 바)만큼 무겁지 않다.
  const handleBGMStop = async () => {
    // ── **BGM 정지에도 물어본다** (사용자 신고 2026-09-15) ──────────────────────
    // *"bgm은 ESC누르니까 바로 꺼지더라."* — 맞다. 앞 판은 *"BGM만 멎는 일이라
    // 방송 종료만큼 무겁지 않다"* 며 확인창을 안 띄웠고, **마우스로만 누를 때는
    // 그 판단이 맞았다.** 단추까지 손을 가져가는 것 자체가 확인이었다.
    //
    // **키보드로 끄는 길이 생기면서 위험도가 달라졌다.** 아무 데나 눌린 ESC 한 번에
    // 어르신들이 듣던 음악이 끊긴다. 되돌릴 수 없는 일에는 물어본다.
    if (!confirm('배경음악을 끌까요?')) return
    setSt(s => ({ ...s, broadcast: null, bgm: null }))
    postNowPlaying({ broadcast: null, bgm: null }).catch(() => {})
    window.dispatchEvent(new CustomEvent('carecast:stop-broadcast'))   // 이벤트 먼저 — 위 주석
    try { await stopBroadcastAPI() } catch (e) { console.error('[재생바] 정지 요청 실패:', e.message) }
  }
  const handleVideoClose = () => {
    setSt(s => ({ ...s, video: null }))
    postNowPlaying({ video: null }).catch(() => {})
    window.dispatchEvent(new CustomEvent('carecast:video-player-closed'))
  }

  const { broadcast, bgm, video } = st
  const 갈래 = broadcast ? 'broadcast' : bgm ? 'bgm' : video ? 'video' : null

  // ── **일시정지** (사용자 지시 2026-09-15) ─────────────────────────────────
  // 소리를 내는 것은 **이 창**이다(로컬 오디오). 그래서 서버를
  // 부르지 않고 창 안에서 이벤트로 멈췄다 잇는다 — 볼륨에서 세운 원칙과 같다
  // (되돌릴 상태를 서버에 만들지 않는다).
  //
  // **안내 방송에는 이 단추가 없다.** 그것은 서버가 단계를 밟는 시퀀스라 중간에
  // 멈춰 두면 서버의 시각 계산과 화면이 어긋난다(`일시정지할수있나`).
  const 서버소리 = !!broadcast?.서버소리
  const 멈추거나잇기 = (멈출까) => {
    if (!일시정지할수있나(갈래, 서버소리)) return
    set멈춤(멈출까)
    window.dispatchEvent(new CustomEvent('carecast:pause-toggle', { detail: { 멈춤: 멈출까, 갈래 } }))
  }

  // ── **ESC · 스페이스바** ────────────────────────────────────────────────
  // 뜻은 `lib/shortcutRules` 가 정한다. 이 바는 **소리가 날 때만 그려지므로**,
  // 아무것도 안 나갈 때는 이 듣기 자체가 안 걸린다 — 초안 카드의 ESC 와 다투지 않는다.
  // `capture` 로 듣고 처리한 키는 전파를 멈춘다. 방송이 카드보다 위라는 규칙이
  // 그래서 저절로 지켜진다.
  useEffect(() => {
    if (!갈래) return undefined
    const onKey = (e) => {
      // **처음 안내 중에는 키를 안 받는다**(2026-09-26 Codex 검수 High). 안내도 window capture 로 듣고
      // 말풍선 단추의 Space·안내 닫는 ESC 를 쓴다 — 여기서도 받으면 그 키가 실제 방송을 멈추거나 정지시켰다.
      // 막대의 정지 단추는 그대로 눌린다(마우스는 안내 막이 따로 다룬다).
      if (안내중()) return
      const 뜻 = 단축키뜻({
        key: e.key, 방송중: true, 글자입력: 글자입력중(e.target),
        일시정지됨: 멈춤,
      })
      if (!뜻) return
      if (뜻 === '정지') {
        e.preventDefault(); e.stopPropagation()
        if (갈래 === 'video') handleVideoClose()
        else if (갈래 === 'bgm') handleBGMStop()
        else handleStop()
        return
      }
      // 일시정지는 **할 수 있는 갈래에서만** 키를 먹는다. 못 하는 갈래에서 키를
      // 삼키면 스페이스가 죽은 것처럼 보인다.
      if (!일시정지할수있나(갈래, 서버소리)) return
      e.preventDefault(); e.stopPropagation()
      멈추거나잇기(뜻 === '일시정지')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })


  // ── **색을 제품 토큰으로** (사용자 지적 2026-09-15) ──────────────────────────
  // *"색감이 빨간색이 좀 그렇지 않아? 디자인 가이드라인에 맞춰서 조화롭게."*
  //
  // 앞 판은 `bg-ds-v3-warn`·`bg-ds-v3-tts`·`bg-ds-v3-ink-2` 이었다. **셋 다 이 제품의
  // 색이 아니다** — 화면의 나머지는 `--ds-v3-*`(말 파랑 · 음악 자주 · 순서 보라)로
  // 칠해져 있는데 이 바만 원색으로 혼자 소리쳤다. 빨강은 이 제품에서 **경보** 색이라,
  // 「지금 방송 중」이라는 **정상 상태**에 쓰면 위험 신호와 섞인다.
  //
  // 그래서 **갈래마다 제 색**을 쓴다: 안내 방송 = 말 파랑, BGM = 음악 자주,
  // 영상 = 잉크(중립). 채도를 낮추는 대신 **왼쪽에 굵은 색 띠**와 **깜빡이는 점**으로
  // 「지금 나가는 중」을 말한다 — 색만으로 말하지 않는다(G-7).
  //
  // ── 층 — **사이드바보다 위다** (사용자 지적 2026-09-15) ────────────────────────
  // *"빨간 선 뚫고 나오는 거잖아."* 관리자 사이드바가 `z-50` 인데 이 바가 `z-45` 라,
  // `/admin` 에서 사이드바가 이 바를 **뚫고 올라와** 가운데가 잘려 보였다.
  // 사이드바는 아래 여백을 비워 두는 쪽으로 이미 대비하고 있지만, 그 계산은
  // **BGM 바 높이만** 본다 — 그 위에 얹히는 이 바까지는 못 센다.
  // 그래서 바를 올린다. 55·56 인 이유: 사이드바(50) 위, 머리줄(60) 아래.
  // ── **바를 짧게** (사용자 지적 2026-09-15) ──────────────────────────────────
  // *"재생바가 너무 길어서, 정지 버튼 어딧는지 한참 찾아야 하잖아."*
  //
  // 앞 판은 `left-0 right-0` — **화면 폭을 통째로** 썼다. 1900px 짜리 화면에서
  // 제목은 왼쪽 끝, 정지는 오른쪽 끝이라 눈이 1.5m 를 가로질러야 했다.
  //
  // 이제 **가운데 뜨는 알약**이다. 폭을 내용만큼만 쓰고(최대 720px) 제목과 단추가
  // 붙어 선다. 좁은 화면에서는 예전처럼 폭을 다 쓴다 — 거기서는 이미 짧다.
  const 틀 = 'fixed left-0 right-0 z-[56] mx-auto flex w-fit max-w-[min(720px,calc(100%-24px))] '
    + 'items-center gap-3 rounded-full border px-4 py-2 '
    + 'shadow-[0_2px_16px_rgba(25,31,40,.16)]'
  // 정지는 **채워서** 그린다 — 이 바에서 사람이 찾는 단추는 이것 하나다.
  // 나머지(일시정지)는 테두리만 둬서 위계를 만든다.
  const 단추틀 = 'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 '
    + 'text-[13px] font-semibold transition-colors flex-shrink-0 '
    + 'min-h-[40px] laptop:min-h-[32px] focus-visible:outline-2 focus-visible:outline-offset-2'
  const 멈춤단추 = 단추틀 + ' bg-current/10 hover:bg-current/20 border border-current/30'
  const 정지단추 = 단추틀 + ' bg-white text-ds-v3-ink hover:bg-white/80 border border-current/20 shadow-sm'

  /** 갈래 하나를 그린다 — 셋이 같은 틀을 쓰고 색과 글만 다르다. */
  const 바 = ({ 색, 띠, 아이콘, 제목, 곁말, 단추글, 누름, 점, 갈래키 }) => (
    <div className={틀 + ' ' + 색}
         style={{ bottom: `calc(${아래바높이} + 10px)` }}
         role="status">
      {/* ── **왼쪽 색 띠를 걷었다** (사용자 지적 2026-09-15) ──────────────────────
          긴 바였을 때는 그 띠가 **갈래를 말하는 유일한 표시**였다. 알약이 되면서
          테두리·바탕·깜빡이는 점이 이미 같은 말을 하고 있어, 띠는 알약 왼쪽 끝에
          붙은 **잘린 막대**로만 보였다. 같은 말을 네 번 하지 않는다. */}
      <div className="flex items-center gap-2.5 min-w-0">
        {점 ? (
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className={'motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ' + 띠} />
            <span className={'relative inline-flex h-2.5 w-2.5 rounded-full ' + 띠} />
          </span>
        ) : 아이콘}
        <span className="font-semibold text-[15px] truncate">{제목}</span>
        <span className="text-[13px] opacity-70 flex-shrink-0 truncate">{곁말}</span>
      </div>
      {/* 일시정지 — **할 수 있는 갈래에만** 그린다. 안내 방송은 서버가 밟는
          시퀀스라 멈춰 둘 수 없다. 못 하는 일에 단추를 그려 두면 사람이 고장으로 읽는다. */}
      {일시정지할수있나(갈래키, 서버소리) && (
        <button onClick={() => 멈추거나잇기(!멈춤)} className={멈춤단추}
                title={(멈춤 ? '다시 재생' : '일시정지') + ' (스페이스바)'}>
          {멈춤 ? <Play size={13} fill="currentColor" /> : <Pause size={13} fill="currentColor" />}
          {멈춤 ? '다시' : '일시정지'}
        </button>
      )}
      <button onClick={누름} className={정지단추} title={단추글 + ' (ESC)'}>
        <Square size={12} fill="currentColor" />
        {단추글}
      </button>
    </div>
  )

  // 안내 방송 중 — **말**이라 파랑이다(`kindOfType` 의 갈래와 같다)
  if (broadcast) return 바({
    색: 'bg-ds-v3-tts-bg border-ds-v3-tts-line text-ds-v3-tts',
    띠: 'bg-ds-v3-tts', 점: true,
    제목: broadcast.title,
    곁말: step ? `${step.index}/${step.total} ${step.label}` : '방송 중',
    단추글: '정지', 누름: handleStop, 갈래키: 'broadcast',
  })

  // BGM 만 — **음악**이라 자주다
  if (bgm) return 바({
    색: 'bg-ds-v3-bgm-bg border-ds-v3-bgm-line text-ds-v3-bgm',
    띠: 'bg-ds-v3-bgm',
    아이콘: <Music2 size={15} className="flex-shrink-0 motion-safe:animate-pulse" />,
    제목: bgm.title, 곁말: 멈춤 ? '멈춤' : 'BGM 재생 중',
    단추글: '정지', 누름: handleBGMStop, 갈래키: 'bgm',
  })

  // 영상 — 소리 갈래가 아니라 **중립**이다
  if (video) return 바({
    색: 'bg-ds-v3-surface-2 border-ds-v3-line-2 text-ds-v3-ink-2',
    띠: 'bg-ds-v3-ink-3',
    아이콘: <Film size={15} className="flex-shrink-0 motion-safe:animate-pulse" />,
    제목: video.name, 곁말: 멈춤 ? '멈춤' : '영상 재생 중',
    단추글: '닫기', 누름: handleVideoClose, 갈래키: 'video',
  })

  return null
}
