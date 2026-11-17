// **화면이 넓은가** — 자바스크립트로 알아야 할 때만 쓴다.
//
// ── 먼저: 대개는 이것이 필요 없다 ────────────────────────────────────────────
// 보이고 안 보이고, 가로로 놓고 세로로 쌓고는 **CSS 로 한다**(`tablet:` 접두사).
// 이 훅은 **행동이 달라질 때**만 쓴다 — 같은 곳을 눌렀는데 폭에 따라 다른 일이
// 일어나야 하거나, 한쪽만 마운트해야 할 때.
//
// ── 왜 한 곳으로 모았나 (2026-09-15) ────────────────────────────────────────
// `EasyMode` 가 제 안에 같은 것을 들고 있었다. 두 벌이면 기준 폭이 갈리고, 한쪽만
// 정리 함수를 빠뜨리는 날이 온다. 이 저장소는 그런 사본을 여러 번 겪었다.
//
// `EasyMode` 의 주석이 **왜 CSS 로만 숨기면 안 되는지**를 실측으로 적어 뒀다:
//   *"md:hidden / hidden md:flex 로 CSS 만 숨기면 두 레이아웃이 항상 같이 마운트돼 있어서
//     (당시) BGM 재생 컴포넌트가 동시에 2개씩 생기고(숨겨진 쪽 iframe 도 autoplay 로 같이
//     재생), BGM 상태도 두 인스턴스가 동시에 써서 꼬임."*
// 그 사실은 여기로 따라온다 — 훅을 옮기면서 이유를 두고 오면 다음 사람이 다시 겪는다.
import { useEffect, useState } from 'react'

/**
 * @param {number} [기준폭] 이 폭 **이상**이면 `true`. 기본 834 는 `tailwind.config.js` 의
 *   `tablet` 과 같은 값이다 — CSS 와 JS 가 다른 폭에서 갈리면 그 사이 폭에서
 *   **화면 반쪽만 바뀌는** 상태가 생긴다.
 * @returns {boolean}
 */
export default function useWideScreen(기준폭 = 834) {
  const query = `(min-width: ${기준폭}px)`
  // 서버 렌더는 없지만, `matchMedia` 가 없는 환경(시험·오래된 웹뷰)에서 던지지 않게 둔다.
  const [넓나, set넓나] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches : true))
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const handler = (e) => set넓나(e.matches)
    // **여기서 한 번 더 맞추지 않는다.** 처음 값은 위 초기화가 이미 읽었고, 효과 안에서
    // `setState` 를 바로 부르면 렌더가 한 번 더 돌아 린트가 막는다
    // (`react-hooks/set-state-in-effect`). 초기화와 이 구독 사이의 틈은 마이크로초라
    // 그 사이에 폭이 바뀔 일이 사실상 없다 — `EasyMode` 가 이 모양으로 오래 돌았다.
    // **`기준폭` 을 런타임에 바꾸는 호출자가 생기면** 그때는 초기값이 굳으므로,
    // 이 자리를 다시 봐야 한다(지금은 둘 다 상수로 부른다).
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return 넓나
}
