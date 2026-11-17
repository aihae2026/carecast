import { useEffect, useRef, useState } from 'react'
import { isBroadcasting, setSoundReady } from '../lib/audioStreamState'
import { _IS_LOCAL } from '../lib/isLocal'

// 전역 AudioContext — 페이지 전체에서 하나만 사용
let globalCtx = null

export function getCtx() {
  if (!globalCtx || globalCtx.state === 'closed') {
    globalCtx = new AudioContext()
  }
  return globalCtx
}

/**
 * **소리 자물쇠를 연다.** 띠와 훅이 **같은 함수**를 부른다.
 *
 * 띠가 제 손으로 부르게 한 이유(사용자 신고 2026-09-15): 문서 전파에만 기대면, 누군가
 * 중간에서 `stopPropagation` 을 부르는 날 **띠가 조용히 죽는다.** 눌러도 아무 일이 없는
 * 화면은 사람이 고장으로 읽고, 실제로 그렇게 신고가 들어왔다.
 *
 * @returns {Promise<boolean>} 풀렸으면 true
 */
export async function unlockAudio() {
  const ctx = getCtx()
  // **몸짓 안에서 동기적으로** 재생을 건다 — 아이폰은 약속을 기다린 뒤의 호출을
  // 「사용자가 누른 것」으로 안 쳐 준다. 길이 1프레임이라 소리는 나지 않는다.
  try {
    const src = ctx.createBufferSource()
    src.buffer = ctx.createBuffer(1, 1, 22050)
    src.connect(ctx.destination)
    src.start(0)
  } catch { /* 못 만들면 resume 결과로만 판정한다 */ }
  try { await ctx.resume() } catch { /* 다음 터치에서 다시 시도한다 */ }
  const 열렸나 = ctx.state === 'running'
  // **서버에게 알릴 수 있도록 여기 한 번만 적는다**(현장 사고 2026-09-15).
  // 자물쇠를 여는 자리가 여기 하나뿐이라, 이 한 줄이면 모든 경로가 덮인다 —
  // 로드 직후 자동 시도 · 사람이 화면을 누른 것 · 띠를 직접 누른 것.
  // 이 값을 `api.js` 의 생존 신호가 10초마다 서버로 실어 보낸다. 서버는 이것으로
  // **「창은 있는데 소리가 잠긴」 상태**를 알게 된다 — 그 전에는 알 방법이 없어서
  // 무음 방송이 성공으로 적혔다.
  setSoundReady(열렸나)
  return 열렸나
}

// enabled=false면 마이크 수신 연결을 아예 열지 않는다. 소리를 낼 일이 없는 창(안내도)이
// 이 연결을 열면, 마이크 방송이 그 창에서도 재생돼 같은 PC에서 소리가 겹친다.
export default function useAudioListener({ enabled = true } = {}) {
  const wsRef       = useRef(null)
  const nextTimeRef = useRef(0)
  const [receiving, setReceiving] = useState(false)
  const [unlocked,  setUnlocked]  = useState(false)

  // AudioContext unlock — 페이지 로드 시 자동 시도 후 안 되면 클릭 대기
  //
  // ── 왜 「눌러도 아무 반응이 없었나」 (사용자 신고 2026-09-15) ──────────────────
  // 앞 판은 **첫 터치에서 리스너를 지웠다.** 그런데 `resume()` 은 약속(Promise)이라
  // **성공했는지는 그 뒤에 안다.** 그래서 한 번 실패하면 — 아이폰 사파리에서 흔하다 —
  // 다시 시도할 길이 없어져 **띠가 영영 남고 아무리 눌러도 안 풀렸다.**
  //
  // 두 가지를 고쳤다:
  //   ① **성공을 확인한 뒤에만** 리스너를 지운다.
  //   ② `resume()` 만으로는 아이폰이 안 풀린다 — **무음 한 조각을 실제로 재생**해야
  //      그 탭의 소리 자물쇠가 열린다. 길이 0 짜리 버퍼라 아무 소리도 안 난다.
  useEffect(() => {
    const ctx = getCtx()
    let 끝났나 = false

    // ── **듣기를 먼저 세우고 시도한다** (V③ UI-0915-R1 지적) ─────────────────────
    // 앞 판은 `tryUnlock()` 을 먼저 부르고 `const onInteract` 를 그 아래에 뒀다.
    // 그런데 `tryUnlock` 안의 약속 콜백이 `onInteract` 를 **읽는다** — 이미 `running`
    // 이면 그 줄에 닿기 전에 `return` 하므로, 뒤늦게 도착한 콜백이
    // **"Cannot access 'onInteract' before initialization"** 로 터졌다(검수관이 재현).
    // 선언을 위로 올리면 어느 갈래로 빠져나가도 그 이름이 이미 서 있다.
    const 걷기 = () => {
      document.removeEventListener('click',      onInteract)
      document.removeEventListener('touchstart', onInteract)
    }
    const onInteract = () => tryUnlock()

    function tryUnlock() {
      unlockAudio().then((열렸나) => {
        if (!열렸나 || 끝났나) return
        끝났나 = true
        setUnlocked(true)
        // **성공을 확인한 뒤에만** 걷는다. 앞 판은 첫 터치에서 바로 걷어서,
        // 그 한 번이 실패하면 다시 시도할 길이 없었다.
        걷기()
      })
    }

    // 1) 로드 즉시 시도 — --autoplay-policy 플래그 있거나 Edge·허용 브라우저면 바로 됨
    tryUnlock()
    // 이미 열려 있으면 듣기를 붙일 것도 없다. **그래도 정리 함수는 돌려준다** —
    // 갈래마다 반환이 다르면 언젠가 한쪽에서 구독이 남는다.
    if (ctx.state === 'running') { setUnlocked(true); return 걷기 }

    // 2) 안 되면 누를 때마다 다시 시도한다. **성공해야 그만둔다.**
    document.addEventListener('click',      onInteract)
    document.addEventListener('touchstart', onInteract)
    return 걷기
  }, [])

  useEffect(() => {
    if (!enabled) return
    let reconnectTimer = null

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/audio?role=listener`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          const msg = JSON.parse(e.data)
          if (msg.type === 'start') {
            setReceiving(true)
            nextTimeRef.current = 0
            // unlock 시도
            getCtx().resume().catch(() => {})
          }
          if (msg.type === 'stop') setReceiving(false)
          return
        }

        // 자신이 방송 중이면 재생 안 함
        if (isBroadcasting()) return

        // 현장 PC 리더 탭만 재생한다(td09 H14). 이 가드가 없으면 서버가 청크 릴레이를 켜는
        // 순간 열려 있는 모든 창(원격 PC·중복 탭 포함)이 같은 소리를 동시에 재생한다 —
        // 지금은 서버가 릴레이를 안 해서 도달 불가지만, 켜지는 날 터지는 자리라 미리 막는다.
        // 담당(sound_owner)은 도중에 바뀔 수 있어서 연결이 아니라 재생 시점에 본다.
        if (!window.CC_IS_LEADER || !_IS_LOCAL) return

        const ctx = getCtx()
        if (ctx.state !== 'running') {
          // 아직 unlock 안 된 경우 — 다시 시도
          ctx.resume().catch(() => {})
          return
        }

        const f32All     = new Float32Array(e.data)
        const sampleRate = f32All[0]
        const samples    = f32All.subarray(1)
        if (!sampleRate || samples.length === 0) return

        try {
          const buffer = ctx.createBuffer(1, samples.length, sampleRate)
          buffer.copyToChannel(samples, 0)

          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(ctx.destination)

          const now     = ctx.currentTime
          const startAt = nextTimeRef.current > now + 0.005
            ? nextTimeRef.current
            : now + 0.01
          source.start(startAt)
          nextTimeRef.current = startAt + buffer.duration
        } catch { /* 조각 하나를 못 이으면 그 조각만 건너뛴다 — 여기서 던지면 마이크 수신이 통째로 끊긴다 */ }
      }

      ws.onclose = () => {
        wsRef.current = null
        setReceiving(false)
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [enabled])

  return { receiving, unlocked }
}
