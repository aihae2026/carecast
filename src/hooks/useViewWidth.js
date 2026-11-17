// **크게 보기를 뺀 실제 폭** — 창 폭 ÷ 크게 보기 배율 (사용자 신고 2026-09-17).
//
// *"큰화면에서는 토글 깨져보인다 … 드래그로 몇번 왔다갔다하는거야"*
//
// 크게 보기는 `<html>` 에 `zoom` 을 건다(`lib/bigView`). 그런데 **CSS 의 폭 조건(`tablet:`·`wide:`)은
// 확대를 모른다** — 1536px 창을 1.5배로 키우면 실제로 1024px 폭만 쓰는데도 `wide:`(1440 이상)가 참이라,
// 넓은 화면용 배치(머리줄 시계·탭 다섯, 초안 두 칸)가 그대로 나와 탭이 밀리고 칸이 좁아졌다.
// 이 폭이 **배치를 가를 때만** 쓴다. 보통 배율(1)에서는 창 폭 그대로라 예전과 같다.
//
// **배율은 `<html>` 의 style 이 아니라 저장값에서 읽는다** — 크게 보기 단추(자식)의 효과가 이 훅의 구독보다
// 먼저 돌아 style 을 읽으면 첫 그림에서 1 로 잘못 읽는다(실측으로 겪었다).
import { useEffect, useState } from 'react'
import { 배율이벤트, 지금배율 } from '../lib/bigView'

function 지금() {
  if (typeof window === 'undefined') return { 폭: 1280, 배율: 1 }
  const 배율 = 지금배율()
  return { 폭: Math.round(window.innerWidth / 배율), 배율 }
}

/** @returns {{ 폭: number, 배율: number }} */
export default function useViewWidth() {
  const [값, set값] = useState(지금)
  useEffect(() => {
    const 다시 = () => set값((앞) => { const n = 지금(); return n.폭 === 앞.폭 && n.배율 === 앞.배율 ? 앞 : n })
    window.addEventListener('resize', 다시)
    window.addEventListener(배율이벤트, 다시)
    return () => { window.removeEventListener('resize', 다시); window.removeEventListener(배율이벤트, 다시) }
  }, [])
  return 값
}
