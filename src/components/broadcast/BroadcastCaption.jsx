// 방송 자막 — 지금 나가는 소리를 글자로 같이 내보낸다(배리어프리).
//
// 왜 오버레이(BroadcastIndicators) 안이 아니라 독립 레이어인가:
// 식사 방송은 BGM·무음 영상·투약 안내가 시간대로 겹친다. 영상이 뜨면 `morning_video_start`가
// 오버레이를 숨기는데(useScheduledBroadcast.js), 자막을 오버레이 안에 두면 **그 순간 자막이
// 통째로 사라진다.** 그런데 그 영상은 무음이라, 그 위로 나가는 안내야말로 자막이 가장 필요하다.
// 그래서 자막은 자기 층(z-10000)에서 살고, 밑에 무엇이 깔렸든 그 위에 얹힌다.
//
// 시계가 둘인 이유:
// 소리를 내는 창(leader)만 <audio>를 쥐고 있어 currentTime을 읽을 수 있다. 원격 PC·직원
// 휴대폰은 소리를 안 내므로 재생 위치를 알 방법이 없다 — 그쪽은 이벤트 도착 시각으로 도는
// 추정 시계를 쓴다. 시작 오차는 있어도 재생 중에 밀리지는 않는다. 자막의 1차 대상은 현장
// 홀 화면(=소리 내는 창)이라 이 비대칭을 받아들인다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { _IS_LOCAL } from '../../lib/isLocal'
import OutlinedText from './OutlinedText'
import useBroadcastTextScale from '../../hooks/useBroadcastTextScale'

// 읽은 자리에 덧입히는 색. 파스텔 하늘 위에서도, 검은 영상 위에서도 보여야 한다.
//
// **노랑(#FFE84D)에서 청록으로 바꿨다**(현장 피드백 2026-09-13: *"노란색 잘 안 보인다"*).
// 노랑은 흰 글자와 **밝기가 너무 가까워서**(노랑 0.81 / 흰색 1.00) 어디까지 읽었는지
// 경계가 안 보인다 — 색은 달라도 밝기가 비슷하면 눈이 경계를 못 잡는다.
// 청록은 밝기가 확실히 낮으면서(0.62) 색상환에서도 흰빛·살구빛과 멀어 하늘 위에서 뜬다.
// 하늘 팔레트의 청록(`--ds-v3` 밖, 레퍼런스 ②)과 같은 계열이라 화면과 따로 놀지도 않는다.
const HILITE = '#23D9D9'

// 자막 글씨. 오버레이 고정 문구(`BroadcastIndicators` 의 표어, 2026-09-15 에 함께
// 1.5배로 커져 clamp(3.3rem, 9vw, 6.75rem))의 약 1.26배다.
// 키운 만큼 한 줄에 들어가는 글자 수를 줄여야 한다 — captions.js의 MAX_CHARS가 짝이다.
//
// ── **키웠다** (사용자 요청 2026-09-15: *"방송 자막 좀 크게 해줘"*) ────────────────
// 상한 6.75rem(108px) → **8.5rem(136px)**. 그런데 **이 값만 키우면 안 보인다** —
// 한 줄이 상자보다 넓어지면 아래 `useLayoutEffect` 가 그 줄만 줄여서 맞추기 때문에,
// 키운 만큼 도로 줄어들 뿐이다. 그래서 `MAX_CHARS` 를 16 → 13 으로 같이 내렸다.
// 그 둘을 따로 고치면 **한쪽만 고친 날 아무 변화가 없다.** 짝이라는 것을 여기 적어 둔다.
const CUR_SIZE  = 'clamp(3rem, 11vw, 8.5rem)'
// 앞뒤 줄은 지금 줄의 40%. 더 키우면 셋이 비슷해져 어디를 읽는 중인지 안 보인다.
// 지금 줄을 키웠으므로 **같은 비율로** 키운다 — 비율이 흐트러지면 위계가 무너진다.
const SIDE_SIZE = 'clamp(1.2rem, 4.4vw, 3.4rem)'

// 자막 글씨는 오버레이 고정 문구와 **같은 부품**(`OutlinedText`)으로 그린다.
// 여기 있던 `outline()` 헬퍼는 걷었다 — 획 하나로 맞추는 방법이라 이 크기(최대 108px)에서
// 흰 속이 회색으로 먹혔다. 두 겹으로 가는 이유는 그 파일 머리말에 있다.

// 미리보기는 상자가 작아진 만큼 글씨도 줄여야 실제 화면과 같은 비율로 보인다.
// clamp를 그대로 곱한다 — 브라우저가 clamp를 먼저 풀고 곱한다.
const sized = (size, scale) => (scale === 1 ? size : `calc(${size} * ${scale})`)

// 자막이 끝나고 이만큼 더 보여준다. 마지막 낱말이 화면에서 즉시 사라지면 못 읽는다.
const TAIL_MS = 1200

// ── 자막 시계 계기판 (주소에 ?sync=1을 붙인 창에서만) ─────────
//
// **자막이 소리와 맞는지**를 눈으로 재는 도구다. 평소 화면에는 영향이 없다 — 이 깃발이 없으면
// 아예 그리지 않는다. 홀 TV에 이게 뜨면 안 되므로 그 조건을 테스트가 고정한다.
//
// 왜 상시로 두나: "자막이 밀리나?"는 되풀이해서 묻게 되는 질문이다(현장 실기·병합 뒤 확인·
// PC를 바꿀 때마다). 그때마다 임시로 붙였다 걷으면, 재는 사람마다 다른 걸 재게 된다.
//
// **소리 내는 창 하나만 보면 된다.** 그 창은 진짜 재생 위치(실측)와, 원격 창들이 쓰는 것과
// **같은 공식**의 추정 시계를 동시에 갖고 있다. 둘의 차이가 곧 원격 화면의 오차다.
// ⚠ 주소가 갈라야 갈린다 — localhost는 소리 내는 창, IP 주소는 원격 취급이다(lib/isLocal).
//    같은 주소를 두 탭으로 열면 중복 탭 억제에 걸려, 소리가 안 나면서도 '홀 화면'으로 찍힌다.
const SYNC_HUD = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('sync')

function SyncHud({ elRef }) {
  // 현장 PC 판정은 lib/isLocal.js가 단일 출처다 — 여기서 다시 적으면 갈린다
  // (is-local-single-source.test.js가 잡는다. 실제로 이 계기판을 넣으며 걸렸다).
  return (
    <div className="fixed top-2 left-2 z-[10001] pointer-events-none rounded-lg bg-black/85 px-3 py-2
                    font-mono text-[18px] leading-snug text-[#23D9D9]">
      <div>{_IS_LOCAL ? '홀 화면 (소리 남)' : '원격 화면 (무음)'} · {window.location.hostname}</div>
      <div ref={elRef} style={{ whiteSpace: 'pre-line' }}>대기 중</div>
    </div>
  )
}

/** 지금 시각(초)에 해당하는 줄. 줄 수가 많아도 프레임당 비용이 일정하도록 이진탐색. */
function lineAt(lines, t) {
  let lo = 0, hi = lines.length - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].s <= t) { found = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return found
}

/**
 * @param {boolean} embedded  편집기 미리보기로 쓸 때 true. 전체화면이 아니라 부모 상자를 채우고,
 *   **미리보기용 신호만** 듣는다(실제 방송 자막과 서로 안 섞이게).
 * @param {number} scale  미리보기 축소 비율. 글씨는 vw 기준이라 상자만 줄이면 글씨가 안 줄어든다.
 *   실제 화면과 같은 비율로 보이려면 글씨도 같은 비율로 줄여야 한다.
 */
export function BroadcastCaption({ embedded = false, scale = 1 } = {}) {
  // ── **사용자가 고른 글자 크기를 함께 곱한다** (사용자 지시 2026-09-16) ─────────
  // *"설정에서 크게, 중간, 작게"*. `scale` 은 미리보기 축소 비율이고 이것은 사람의 선택이라
  // **둘을 곱한다.** 미리보기도 실제 화면과 같은 크기 비율로 보여야 편집한 대로 나간다.
  // `CUR_SIZE`·`SIDE_SIZE` 상수는 그대로 둔다 — `MAX_CHARS` 와 짝인 기준값이라(위 머리말),
  // 줄이는 쪽 배율만 곱하면 그 짝이 안 깨진다.
  const 사용자배율 = useBroadcastTextScale()
  const 배율 = scale * 사용자배율
  const [cue,  setCue]  = useState(null)   // { lines, title }
  const [idx,  setIdx]  = useState(-1)     // 지금 읽는 줄
  const [onGradient, setOnGradient] = useState(false)

  const audioRef = useRef(null)    // 소리 내는 창만 채워진다
  // 소리를 일부러 미뤄 내보내는 경로(영상)에서, 자막도 그만큼 미루는 값(ms). 음원은 0이다.
  const offsetRef = useRef(0)
  const clockRef = useRef(null)    // { t0, leadMs, rate } — 추정 시계
  const rafRef   = useRef(0)
  const fillRefs = useRef([])      // 현재 줄의 색칠 층
  const boxRef   = useRef(null)    // 지금 줄이 쓸 수 있는 폭
  const lineRef  = useRef(null)    // 지금 줄 자체(줄바꿈 없이 한 줄로 그린다)
  const hudRef   = useRef(null)    // 계기판의 숫자 칸(?sync=1일 때만 있다)

  // ── 자막 받기 ────────────────────────────────────────────────
  useEffect(() => {
    const onCue = (e) => {
      // 미리보기 신호와 실제 방송 신호를 서로 안 받는다. 안 그러면 편집기에서 재생할 때
      // 관리자 화면 전체가 자막으로 덮인다.
      if (!!e.detail?.preview !== embedded) return
      const lines = e.detail?.cues?.lines
      if (!Array.isArray(lines) || !lines.length) return   // 자막 없는 방송 — 소리만 나간다
      audioRef.current = null
      clockRef.current = {
        t0: performance.now(),
        leadMs: Number(e.detail.leadMs) || 0,
        rate:   Number(e.detail.rate) || 1,
        audioId: e.detail.audioId ?? null,   // 아래 보정 신호가 이 방송의 것인지 가리는 열쇠
      }
      setCue({ lines, title: e.detail.title || '' })
      setIdx(-1)
      // **자막 한 판이 시작됐다.** 어두운 바탕(`BroadcastScrim`)이 이 신호로 켜진다 —
      // 줄이 바뀌는 사이에도 꺼지지 않게, **줄이 아니라 판**을 알린다.
      window.dispatchEvent(new CustomEvent('carecast:caption-session', { detail: { on: true, embedded } }))
    }
    // 소리를 내는 창만 여기까지 온다. 이 순간부터 추정이 아니라 실제 재생 위치를 본다.
    const onAttach = (e) => {
      if (!!e.detail?.preview !== embedded) return
      if (e.detail?.audio) audioRef.current = e.detail.audio
      // **소리가 그림보다 늦게 나가는 경우가 있다.** 영상은 TV HDMI 지연만큼 소리를 일부러
      // 미뤄서 내보낸다(`VideoPlayer` 의 Web Audio DelayNode, 체조·식사 각각 기본 450ms).
      // 자막을 `currentTime` 그대로 따라가게 두면 **PC 모니터에서 자막이 소리보다 그만큼
      // 앞선다.** 그래서 미룬 만큼 자막도 미룬다. 음원 경로는 이 값이 없어 0 이다.
      // 슬라이더로 지연을 바꾸면 다시 쏘아 주므로 여기 값도 따라 바뀐다.
      if ('offsetMs' in (e.detail || {})) {
        const v = Number(e.detail.offsetMs)
        offsetRef.current = Number.isFinite(v) ? v : 0
      }
    }
    // ── 어림값을 실측으로 바꿔 단다 ─────────────────────────────
    //
    // 소리를 내는 창이 "진짜로 소리가 시작됐다"고 서버에 보고하고, 서버가 그걸 되쏜다
    // (routes/morning.js). 추정 시계의 출발선(leadMs)을 그 값으로 갈아 끼우면, 이 창의
    // 자막이 실제 소리와 같은 자리에 선다. 2026-09-05 실측으로 0.36초 늦던 자리다.
    //
    // 소리를 내는 창은 무시한다 — 거기는 이미 재생 위치를 직접 읽고 있다.
    // audioId가 다르면 흘린다 — 방송이 잇달아 나갈 때 옛 보고가 새 자막을 흔들면 나빠진다.
    //
    // 값이 바뀌는 순간 자막이 한 번 훌쩍 건너뛴다. 보정은 소리 시작 직후에 오므로 첫 줄
    // 첫 어절 언저리이고, 그 뒤로는 계속 맞는다 — 20초 내내 어긋난 채 가는 것보다 낫다.
    const onResync = (e) => {
      if (embedded || audioRef.current) return
      const c = clockRef.current
      if (!c) return
      const id = e.detail?.audioId
      if (!id || c.audioId == null || String(id) !== String(c.audioId)) return
      const measured = Number(e.detail?.leadMs)
      if (!Number.isFinite(measured) || measured < 0) return
      c.leadMs = measured
    }
    const clear    = (e) => {
      if (e && !!e.detail?.preview !== embedded) return
      // **보정값도 같이 지운다.** 안 지우면 영상 뒤에 나가는 음원 자막이 450ms 밀린다 —
      // 소리는 제때 나는데 글자만 늦어서, 원인을 찾기 가장 어려운 모양이 된다.
      setCue(null); setIdx(-1); audioRef.current = null; clockRef.current = null; offsetRef.current = 0
      window.dispatchEvent(new CustomEvent('carecast:caption-session', { detail: { on: false, embedded } }))
    }
    // 새 TTS를 틀기 직전에 훅이 **이전** 재생을 정리하며 broadcast-tts-end를 쏜다
    // (useScheduledBroadcast.js). 그 신호를 그대로 받으면 방금 띄운 자막이 곧바로 지워진다.
    //
    // 진짜 종료는 반드시 attach 뒤에 온다 — 소리를 내는 창은 <audio>를 넘겨준 다음에야
    // 끝날 수 있기 때문이다. 그래서 아직 붙지 않았으면 남의 종료로 보고 흘린다.
    // (소리를 안 내는 창은 이 신호를 애초에 못 받는다. 그쪽은 마지막 줄이 지나면 스스로 걷는다.)
    const onTtsEnd = () => { if (!embedded && audioRef.current) clear() }
    const onOverlay = (e) => setOnGradient(!!e.detail?.visible)

    window.addEventListener('carecast:caption-cue',    onCue)
    window.addEventListener('carecast:caption-attach', onAttach)
    window.addEventListener('carecast:caption-resync', onResync)
    window.addEventListener('carecast:caption-end',    clear)
    // TTS는 이미 끝났다는 신호를 쏘고 있다(broadcast-tts-end). 자막 때문에 발신처를 하나 더
    // 만들면 둘이 어긋날 때 자막만 남는다 — 있는 신호를 그대로 듣는다.
    window.addEventListener('carecast:broadcast-tts-end', onTtsEnd)
    window.addEventListener('carecast:overlay-state',  onOverlay)
    return () => {
      window.removeEventListener('carecast:caption-cue',    onCue)
      window.removeEventListener('carecast:caption-attach', onAttach)
      window.removeEventListener('carecast:caption-resync', onResync)
      window.removeEventListener('carecast:caption-end',    clear)
      window.removeEventListener('carecast:broadcast-tts-end', onTtsEnd)
      window.removeEventListener('carecast:overlay-state',  onOverlay)
    }
  }, [embedded])

  useEffect(() => {
    if (SYNC_HUD && !cue && hudRef.current) hudRef.current.textContent = '대기 중'
  }, [cue])

  // 자막이 화면에 떠 있는지 아닌지의 **단일 출처**. 오버레이는 이 신호만 보고 고정 문구를
  // 감췄다 되살린다 — 두 컴포넌트가 각자 이벤트를 해석하면 한쪽만 남아 글씨가 겹친다.
  useEffect(() => {
    if (embedded) return   // 미리보기는 오버레이의 고정 문구를 건드리지 않는다
    window.dispatchEvent(new CustomEvent('carecast:caption-state', { detail: { active: !!cue } }))
  }, [cue, embedded])

  // ── 넘치면 줄바꿈 대신 줄여서 맞춘다 ─────────────────────────
  //
  // 한 줄에 몇 글자를 넣을지(captions.js MAX_CHARS)를 화면 폭에 인질로 잡히지 않게 하는 장치다.
  // 글씨가 clamp 상한에 걸리는 구간(1200~1900px)에서는 화면이 넓어져도 글씨가 안 커져서,
  // 어느 폭에서나 안 넘치게 잡으면 좁은 쪽에 맞춰야 하고 그러면 "선생님들께 / 안내드립니다."처럼
  // 잘게 쪼개진다. 넘치는 줄만 살짝 줄이면 줄 길이를 읽기 좋은 값으로 둘 수 있다.
  // 줄이는 방법은 **글씨 크기**다. transform: scale은 레이아웃 폭을 원래대로 두기 때문에,
  // 부모보다 넓은 줄은 가운데가 아니라 왼쪽에 붙은 채로 줄어들어 오른쪽이 잘린다(실측).
  useLayoutEffect(() => {
    const box = boxRef.current
    const line = lineRef.current
    if (!box || !line) return
    // 잴 때는 반드시 원래 크기로 되돌린다. 빈 문자열로 지우면 안 된다 — React는 값이 안 바뀐
    // 인라인 스타일을 다시 쓰지 않으므로, 한 번 지우면 글씨 크기가 영영 사라진다(실측: 자막이
    // 본문 크기로 쪼그라들었다). CUR_SIZE를 그대로 다시 넣는다.
    line.style.fontSize = sized(CUR_SIZE, 배율)
    const room = box.clientWidth
    const want = line.scrollWidth
    if (room > 0 && want > room) {
      const base = parseFloat(getComputedStyle(line).fontSize)
      line.style.fontSize = `${(base * (room / want) * 0.98).toFixed(1)}px`   // 0.98은 반올림 여유
    }
  }, [idx, cue, 배율])

  // ── 시계 ─────────────────────────────────────────────────────
  //
  // 프레임마다 setState를 하면 큰 글씨 3줄을 60번 다시 그린다. 줄이 바뀔 때만 리렌더하고,
  // 낱말 색칠은 상태를 거치지 않고 clip-path를 직접 쓴다 — 프레임당 스타일 쓰기 한 번이다.
  useEffect(() => {
    if (!cue) return
    const { lines } = cue
    const endsAt = lines[lines.length - 1].e

    let cancelled = false
    let shown = -1

    const tick = () => {
      if (cancelled) return
      const audio = audioRef.current
      let t
      // **요소가 붙어 있으면 멈춰 있어도 그 위치를 본다**(Codex UX-09-R11 지적 2026-09-12).
      //
      // 예전에는 `!audio.paused` 를 같이 봤다. 그래서 사람이 일시정지를 누르면 자막이
      // **실제 위치를 버리고 추정 시계로 갈아타** 혼자 흘러갔다 — 멈춘 화면 위로 글자가
      // 계속 지나간다. 실측으로 확인: `currentTime=50` 에서 49.55초였다가 일시정지하자
      // 10초로 **되돌아가** 다시 20초로 나아갔다.
      //
      // 영상에는 사람이 누르는 일시정지 단추가 있어 이 길이 늘 열려 있다. 멈추면 자막도
      // 멈추는 것이 맞다 — 추정 시계는 **요소가 아예 없는 창**(원격 PC·직원 폰)의 것이다.
      if (audio) {
        // 소리를 미룬 만큼 자막도 미룬다(영상 HDMI 보정). 음원은 offset 이 0이라 그대로다.
        t = audio.currentTime - offsetRef.current / 1000
      } else if (clockRef.current) {
        const c = clockRef.current
        t = ((performance.now() - c.t0 - c.leadMs) / 1000) * c.rate
      } else {
        t = 0
      }

      if (SYNC_HUD && hudRef.current) {
        // 소리 내는 창은 두 시계를 다 갖고 있다 — 그 차이가 원격 화면의 오차다.
        const c = clockRef.current
        const est = c ? ((performance.now() - c.t0 - c.leadMs) / 1000) * c.rate : null
        if (audio && est != null) {
          const gap = est - audio.currentTime      // 음수면 원격 자막이 소리보다 늦다
          hudRef.current.textContent =
            `실측 ${audio.currentTime.toFixed(2)} · 추정 ${est.toFixed(2)}\n`
            + `→ 원격 ${Math.abs(gap).toFixed(2)}초 ${gap < 0 ? '늦음' : '빠름'}`
        } else {
          hudRef.current.textContent = `${t.toFixed(2)}초  ${audio ? (audio.paused ? '실측(멈춤)' : '실측') : '추정'}`
        }
        // 보정이 걸려 있으면 **그 사실을 드러낸다.** 안 보이면 "자막이 왜 늦지"를
        // 영영 못 좁힌다 — 이 계기판이 있는 이유가 그것이다.
        if (offsetRef.current) hudRef.current.textContent += `\n소리 미룸 보정 ${offsetRef.current}ms`
      }

      const i = lineAt(lines, t)
      if (i !== shown) { shown = i; setIdx(i) }

      // 낱말 색칠. 타이밍이 낱말 단위로 없으면(사람이 줄만 찍은 경우) 줄 전체를 시간
      // 비례로 칠한다 — 노래방처럼 왼쪽에서 오른쪽으로 흐르는 것은 같다.
      const line = i >= 0 ? lines[i] : null
      if (line) {
        const words = line.w
        if (words) {
          for (let k = 0; k < words.length; k++) {
            const el = fillRefs.current[k]
            if (!el) continue
            const [ws, we] = words[k]
            const pct = t >= we ? 1 : t <= ws ? 0 : (t - ws) / Math.max(we - ws, 1e-6)
            el.style.clipPath = `inset(0 ${(100 - pct * 100).toFixed(1)}% 0 0)`
          }
        } else {
          const el = fillRefs.current[0]
          if (el) {
            const span = Math.max(line.e - line.s, 1e-6)
            const pct = Math.max(0, Math.min(1, (t - line.s) / span))
            el.style.clipPath = `inset(0 ${(100 - pct * 100).toFixed(1)}% 0 0)`
          }
        }
      }

      // 소리를 안 내는 창은 끝났다는 신호를 못 받는다 — 마지막 줄이 지나면 스스로 걷는다.
      if (!audio && t > endsAt + TAIL_MS / 1000) {
        setCue(null); setIdx(-1); clockRef.current = null
        window.dispatchEvent(new CustomEvent('carecast:caption-session', { detail: { on: false, embedded } }))
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current) }
    // `embedded` 는 이 부품이 뜰 때 정해지고 사는 동안 안 바뀌는 값(props)이지만,
    // 위에서 쓰기 시작했으므로 목록에 적는다 — **"안 바뀔 것"을 빼 두는 것이
    // 이 규칙이 막으려는 바로 그 습관**이다. 값이 그대로면 효과도 다시 안 돈다.
  }, [cue, embedded])

  if (!cue || idx < 0) return SYNC_HUD && !embedded ? <SyncHud elRef={hudRef} /> : null

  const { lines } = cue
  const line = lines[idx]
  const prev = idx > 0 ? lines[idx - 1] : null
  const next = idx + 1 < lines.length ? lines[idx + 1] : null

  // 색칠 단위. 낱말 타이밍이 없으면 줄 전체가 한 덩어리다.
  // 색칠 층은 ref 콜백이 채운다(렌더 중에 ref를 건드리면 React가 경고한다). 줄이 바뀌면
  // 옛 span은 React가 null로 먼저 되돌려 주고, 시계는 지금 줄의 낱말 수만큼만 훑는다.
  const chunks = line.w ? line.w.map((w) => w[2]) : [line.text]

  // 그라디언트 오버레이 위에서는 배경 없이 큰 글씨만 — 오버레이가 이미 화면을 덮고 있다.
  // 영상 위에서는 아래쪽 반투명 검정 띠에 앉힌다(영상을 다 가리면 안 된다).
  const shell = embedded
    ? 'absolute inset-0 flex flex-col items-center justify-center px-[3%] pointer-events-none'
    : onGradient
      ? 'fixed inset-0 z-[10000] flex flex-col items-center justify-center px-10 pointer-events-none'
      : 'fixed left-0 right-0 bottom-0 z-[10000] flex flex-col items-center justify-end px-10 pb-10 pt-8 pointer-events-none'

  return (
    <div className={shell}
         /* **바탕을 여기서 안 그린다** (사용자 지적 2026-09-15). 이 부품은 읽을 줄이
            없으면 통째로 사라지는데(아래 `return null`), 바탕이 여기 있으니 줄과 줄
            사이마다 같이 꺼졌다 켜졌다 했다. 이제 `BroadcastScrim` 이 방송 내내 깔아
            둔다 — 미리보기(`embedded`)에서는 그 층이 없으므로 여기서 그대로 그린다. */
         aria-live={embedded ? 'off' : 'polite'}>

      {SYNC_HUD && !embedded && <SyncHud elRef={hudRef} />}

      {/* 지나간 줄 — 노래방 가사처럼 위로 흘러간 자리를 남겨 둔다.
          **테두리를 주지 않는다.** 반투명 흰 글씨에 검정 테두리를 대면 속이 비쳐 윤곽선만
          남고, 글자가 아니라 겹쳐 놓은 도형처럼 보인다. 흐리게 하려면 색만 흐리게 한다. */}
      <div className="text-center font-black leading-tight transition-opacity duration-300"
           style={{ fontSize: sized(SIDE_SIZE, 배율), minHeight: '1.2em', marginBottom: '0.5em',
                    color: 'rgba(255,255,255,0.62)', textShadow: '0 1px 10px rgba(0,0,0,0.28)' }}>
        {prev?.text || ''}
      </div>

      {/* 지금 읽는 줄. 바깥이 쓸 수 있는 폭, 안쪽이 줄바꿈 없이 한 줄로 그린 글씨다. */}
      <div ref={boxRef} className="w-full text-center">
      <div ref={lineRef} className="inline-block font-black leading-tight"
           /* **흐린 그림자를 걷었다.** 16px 번짐이 글자 둘레에 회색 안개를 만들어
              흰 속까지 탁해 보였다 — "쩅하게" 의 반대다. 지금은 딱 붙는 그림자 하나로
              바닥에서 살짝 띄우기만 하고, 대비는 `OutlinedText` 의 테두리가 낸다. */
           style={{ fontSize: sized(CUR_SIZE, 배율), whiteSpace: 'nowrap' }}>
        {chunks.map((word, k) => (
          <span key={`${idx}-${k}`} className="relative inline-block" style={{ whiteSpace: 'pre' }}>
            <OutlinedText>{word}</OutlinedText>
            {/* 읽힌 만큼 위에 덧입히는 색. rAF가 **이 바깥 껍데기의** clip-path만 고쳐 쓴다.
                자리잡기(`absolute`)와 잘라내기를 껍데기가 맡고 글자는 `OutlinedText` 가
                그린다 — 두 역할을 한 태그에 겹치면 `relative` 와 `absolute` 가 부딪힌다. */}
            <span aria-hidden="true"
                  ref={(el) => { fillRefs.current[k] = el }}
                  className="absolute left-0 top-0"
                  style={{ clipPath: 'inset(0 100% 0 0)' }}>
              <OutlinedText color={HILITE}>{word}</OutlinedText>
            </span>
            {k < chunks.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
      </div>

      {/* 다음 줄 — 무엇이 올지 미리 보이면 따라 읽기 쉽다. 앞 줄과 같은 이유로 테두리 없음. */}
      <div className="text-center font-black leading-tight transition-opacity duration-300"
           style={{ fontSize: sized(SIDE_SIZE, 배율), minHeight: '1.2em', marginTop: '0.5em',
                    color: 'rgba(255,255,255,0.62)', textShadow: '0 1px 10px rgba(0,0,0,0.28)' }}>
        {next?.text || ''}
      </div>
    </div>
  )
}

export default BroadcastCaption
