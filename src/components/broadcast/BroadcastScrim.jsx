// **자막 뒤에 깔리는 어두운 바탕** (사용자 지시 2026-09-15, 범위 정정 2026-09-16).
//
// ── 무엇이 문제였나 ────────────────────────────────────────────────────────
// *"왜 그라디언트가 자막 있을 때마다 켜지고 또 잠깐 꺼지고 켜지고 반복해
//   정신사납게. 그냥 자동방송시간에는 쭉 켜놔."*
//
// 어두운 바탕이 **자막 부품 안에** 있었다. 그 부품은 읽을 줄이 없으면 통째로
// 사라지므로(`BroadcastCaption` 의 `if (!cue || idx < 0) return null`), **줄과 줄
// 사이마다** 바탕이 같이 꺼졌다 켜졌다 했다 — 방송 한 번에 수십 번이다.
//
// ── **내가 한 번 너무 넓게 잡았다** (2026-09-16 현장 신고) ────────────────────
// *"뭐여 지금 방송시간인데 방송중도 없고 그냥 밑에 그라데이션만 깔리는 버그
//   지금 실시간"*
//
// 처음엔 **방송이 시작되면** 켜지게 했다. 그런데 이 층은 `App.jsx` 에 붙어 있어서
// **모든 화면**에 깔린다 — 설정 화면에서 일하고 있는데 아래가 어두워졌다.
// 게다가 층이 `z-9990` 이라 **재생바(z-56)를 덮어서**, 「지금 방송 중」 표시가
// 그 밑으로 숨었다. 사용자가 본 *"방송중도 없고 그라데이션만"* 이 그것이다.
//
// **바탕은 「방송 중」이 아니라 「자막이 나가는 중」을 말해야 한다.** 그것이 원래
// 이 물건이 있던 자리(자막 부품 안)의 뜻이고, 고칠 때 넓히지 말았어야 했다.
// 이제 자막이 **한 판** 시작할 때 켜지고 끝날 때 꺼진다 — 줄 사이에는 안 꺼지므로
// 깜빡임은 그대로 고쳐져 있다.
//
// ── 1분 전 예열은 뺐다 ─────────────────────────────────────────────────────
// *"자동방송 1분전에는 켜놔"* 도 같은 이유로 걷었다 — 그 예열이 **설정 화면에서도**
// 아래를 어둡게 만든다. 방송 화면에만 걸 방법이 생기면 그때 다시 넣는다.
// (그 판정은 `lib/scrimRules.js` 에 그대로 있다. 규칙을 버리지는 않았다.)
import { useEffect, useState } from 'react'

export default function BroadcastScrim() {
  // 자막 **한 판**이 나가는 중인가. 줄 단위가 아니다.
  const [나가는중, set나가는중] = useState(false)

  useEffect(() => {
    const onSession = (e) => {
      // 미리보기 자막(편집기 안)은 제 상자 안에서 그려진다 — 화면 전체를 덮으면 안 된다.
      if (e.detail?.embedded) return
      set나가는중(!!e.detail?.on)
    }
    // 방송이 끝나면 자막도 끝나지만, 끝 신호를 놓쳤을 때를 위해 같이 듣는다.
    // **켜는 일은 안 한다** — 켜는 것은 자막만 정한다.
    const 끄기 = () => set나가는중(false)

    window.addEventListener('carecast:caption-session',     onSession)
    window.addEventListener('carecast:broadcast-ended',     끄기)
    window.addEventListener('carecast:broadcast-completed', 끄기)
    window.addEventListener('carecast:stop-broadcast',      끄기)
    return () => {
      window.removeEventListener('carecast:caption-session',     onSession)
      window.removeEventListener('carecast:broadcast-ended',     끄기)
      window.removeEventListener('carecast:broadcast-completed', 끄기)
      window.removeEventListener('carecast:stop-broadcast',      끄기)
    }
  }, [])

  if (!나가는중) return null

  return (
    // **자막(z-10000)보다 아래, 재생바(z-56)보다 위.** 자막의 바탕이어야 하므로 자막
    // 밑이고, 자막이 있는 동안에는 재생바를 가려도 된다 — 그때 화면의 주인공은 자막이다.
    // 안 나갈 때는 `null` 이라 아무것도 안 덮는다(그것이 위 사고의 교훈이다).
    <div aria-hidden="true"
         className="pointer-events-none fixed left-0 right-0 bottom-0 z-[9990]
                    transition-opacity duration-500 motion-reduce:transition-none"
         style={{
           height: '42vh',
           background: 'linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0))',
         }} />
  )
}
