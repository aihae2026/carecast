// **처음 안내의 무대** — 안내(`HomeTour`)가 **실제 부품**을 움직이는 단 하나의 통로 (사용자 지시 2026-09-17 N18).
//
// *"DEV에서 실제 쓰는 구현한 기능을 갖고와서 해야지 실감나지"* — 손으로 그린 시안이 두 번이나 dev 와
// 달랐다. 그래서 안내는 검색창·카드·순서 만들기·서랍·탭·크게 보기·메뉴를 **진짜로** 움직인다.
//
// ── 지키는 것 (사용자 확정 조건 *"응 그렇게 해 기억했다가"*) ─────────────────────────────
//  ① **안내 중에는 아무것도 실제로 나가지 않는다.** `api.js` 의 쓰기 창구(POST·PUT·PATCH·DELETE)가
//     `안내중()` 을 보고 **보내기 전에 막는다** — 부품이 실수로 저장·방송을 불러도 서버에 안 닿는다.
//     읽기(GET)는 막지 않는다(순서 목록·단계 목록을 보여 줘야 한다).
//  ② 막(overlay)이 모든 클릭을 받는다 — 밝힌 단추를 눌러도 실제 단추는 안 눌린다(`HomeTour`).
//  ③ 끝나면 연 카드·서랍·입력값·글씨 크기를 되돌린다(각 장의 정리).
//
// 부품은 `useTourStage({ '동작이름': (값) => … })` 로 듣기만 한다. 안내가 없으면 아무 일도 안 한다.
import { useEffect, useRef } from 'react'

const 이벤트 = 'cc-tour'
let 켜짐 = false

/** 지금 처음 안내가 도는 중인가 — `api.js` 쓰기 창구가 본다. */
export function 안내중() { return 켜짐 }

export function 안내켜기(v) {
  켜짐 = !!v
  try { document.body.toggleAttribute('data-cc-tour', 켜짐) } catch { /* 문서가 없으면 표시만 못 한다 */ }
}

/** 안내가 부품에게 시킨다. */
export function 무대보내기(동작, 값) {
  try { window.dispatchEvent(new CustomEvent(이벤트, { detail: { 동작, 값 } })) } catch { /* 창이 없으면 무시 */ }
}

/** 부품이 듣는다. 처리 함수는 늘 최신 것을 쓴다(상태가 바뀌어도 다시 걸지 않는다). */
export function useTourStage(처리들) {
  const ref = useRef(처리들)
  useEffect(() => { ref.current = 처리들 })
  useEffect(() => {
    const 듣기 = (e) => {
      const f = ref.current?.[e.detail?.동작]
      if (typeof f === 'function') f(e.detail.값)
    }
    window.addEventListener(이벤트, 듣기)
    return () => window.removeEventListener(이벤트, 듣기)
  }, [])
}

/** 메뉴의 「처음 안내 다시 보기」 등이 안내를 연다. */
export const 안내시작이벤트 = 'cc-tour-start'
export function 안내열기() { try { window.dispatchEvent(new CustomEvent(안내시작이벤트)) } catch { /* 무시 */ } }

/** 초기 설정을 끝내면 세우는 표식 — 간편 화면이 처음 한 번 안내를 띄운다(`SetupWizard` 가 세운다). */
export const 안내대기키 = 'carecast:tour-pending'
