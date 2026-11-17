// 뜨는 창이 지켜야 할 것 넷 — 한 곳에서 준다 (G-59, 2026-09-13).
//
// 전수로 세 보니 제품에 뜨는 창이 **13벌**인데, 넷을 다 갖춘 것은 `ConfirmDialog` 하나뿐이었다.
// 여덟은 **Escape 로 안 닫혔고**, 초점이 돌아오는 것은 하나뿐이었다.
// 그래서 새로 만들지 않고 **그 하나에서 떼어** 여기 둔다.
//
//   ① Escape 로 닫힌다
//   ② 열릴 때 첫 초점을 정한 자리에 둔다 — 되돌릴 수 없는 창이면 「취소」다
//   ③ 닫히면 **초점이 원래 자리로** 돌아간다
//   ④ 열려 있는 동안 뒤쪽이 스크롤되지 않는다
//
// ③ 이 없으면 창을 닫는 순간 탭 순서가 문서 처음으로 튄다 — 키보드로 설정을 고치던 사람이
// 매번 화면 맨 위부터 다시 내려와야 한다.
import { useEffect, useRef } from 'react'

// ── 창 바깥에서 마지막으로 초점을 가졌던 자리 ────────────────────────────────
//
// **모듈이 실려 있는 동안 늘 듣는다.** 창이 열린 뒤에 듣기 시작하면 늦다 —
// 「새 폴더」 단추를 누르는 순간 초점은 이미 그 단추로 갔고, 그 다음에야 창이 생긴다.
// 창 안에서 듣기 시작하면 그때는 창 안 입력칸의 `autoFocus` 만 보인다
// (2026-09-13 실측: 되돌렸는데 `activeElement` 가 body 였다).
//
// 창 안쪽은 기억하지 않는다 — 돌아갈 자리는 **창 밖**이어야 하고, 창 안 요소는
// 어차피 닫히면서 사라진다.
let 마지막초점 = null
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const t = e.target
    if (t instanceof HTMLElement && !t.closest('[role="dialog"], [role="alertdialog"]'))
      마지막초점 = t
  }, true)
}

// ── 지금 떠 있는 창들 — **맨 위 하나만 Escape 를 먹는다** ────────────────────
//
// 예전엔 처리기 안에서 `e.stopPropagation()` 만 불렀다. **그것으로는 안 막힌다** —
// `stopPropagation` 은 *다음 요소*로 가는 것을 막을 뿐, **같은 요소(`document`)에 붙은
// 다른 처리기**는 그대로 다 돈다. 서랍(`HomeDrawer`)도 `document` 에 keydown 을 걸어 두어서,
// 서랍 안에서 연 창에 Escape 를 누르면 **창과 서랍이 한 번에 닫혔다**
// (2026-09-13 실측: 폴더 선택 창을 닫았더니 서랍이 `inert` 가 돼 초점이 돌아갈 자리가
// 사라졌다 — 초점 복귀 실패로 먼저 드러났다).
//
// 그래서 둘을 함께 쓴다:
//   · **잡기 단계(capture)** 에서 듣는다 — 거품 단계에 붙은 서랍보다 반드시 먼저 돈다.
//   · 맨 위 창이 아니면 **아무것도 안 하고 넘긴다**(겹쳐 뜬 창은 위에서부터 하나씩).
//   · 맨 위 창이면 `stopImmediatePropagation()` — 같은 요소의 나머지도 여기서 끊는다.
const 창더미 = []

/**
 * @param {boolean}  open      떠 있나
 * @param {Function} onClose   닫는 법
 * @param {object}   [옵션]
 * @param {React.RefObject} [옵션.첫초점]  열릴 때 초점을 받을 자리(없으면 창 자신)
 * @param {boolean}  [옵션.스크롤잠금=true]
 * @returns {React.RefObject} 창 바깥 상자에 걸 ref
 */
export default function useDialogA11y(open, onClose, 옵션 = {}) {
  const { 첫초점, 스크롤잠금 = true } = 옵션
  const 상자 = useRef(null)
  const 돌아갈자리 = useRef(null)
  // 처리기는 한 번만 붙이는데 `onClose` 는 매 렌더마다 새 함수일 수 있다 —
  // 의존성에 넣으면 Escape 처리기가 계속 붙었다 떨어진다. ref 로 최신 것을 본다.
  //
  // **렌더 중에 `.current` 를 쓰지 않는다**(`react-hooks/refs`). 렌더 본문에서 대입하면
  // React 가 "이 값이 렌더에 쓰인다"고 오해할 수 있는 자리다. 넣는 것도 effect 에서 한다.
  const 닫기 = useRef(onClose)
  useEffect(() => { 닫기.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    // 위 모듈 추적기가 기억해 둔 **창 밖** 자리를 쓴다.
    돌아갈자리.current = 마지막초점

    // 첫 초점. 정한 자리가 없으면 창 자신이 받는다(`tabIndex={-1}` 이 붙어 있어야 한다).
    const 목표 = 첫초점?.current ?? 상자.current
    목표?.focus?.({ preventScroll: true })

    // 이 창을 더미 맨 위에 올린다. 나가면서 뺀다.
    const 표 = {}
    창더미.push(표)

    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // 내가 맨 위가 아니면 손대지 않는다 — 위 창이 먼저 닫히고, 다음 Escape 가 내 차례다.
      if (창더미[창더미.length - 1] !== 표) return
      // **같은 요소의 나머지 처리기까지 끊는다**(서랍이 같이 닫히던 자리).
      e.stopImmediatePropagation()
      닫기.current?.()
    }
    document.addEventListener('keydown', onKey, true)

    const 원래 = 스크롤잠금 ? document.body.style.overflow : null
    if (스크롤잠금) document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey, true)
      const 자리번호 = 창더미.indexOf(표)
      if (자리번호 !== -1) 창더미.splice(자리번호, 1)
      if (스크롤잠금) document.body.style.overflow = 원래
      // 초점을 되돌린다. 그 사이에 사라진 요소일 수 있으니 살아 있는지 본다.
      //
      // **다음 프레임에 되돌린다.** 여기서 바로 부르면 창 DOM 이 아직 안 지워진 상태라,
      // 곧이어 초점 받은 요소가 사라지면서 브라우저가 초점을 `body` 로 **다시 떨군다** —
      // 실측으로 확인했다(2026-09-13: 되돌렸는데 `document.activeElement` 가 body 였다).
      // 그러면 창을 닫는 순간 탭 순서가 문서 처음으로 튄다.
      const 자리 = 돌아갈자리.current
      if (자리 instanceof HTMLElement) requestAnimationFrame(() => {
        if (document.contains(자리)) 자리.focus({ preventScroll: true })
      })
    }
  }, [open, 첫초점, 스크롤잠금])

  return 상자
}
