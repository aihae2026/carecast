// 즉시 방송의 **차임벨 · 종료음 켬/끔** — 한 곳에서 읽고 쓴다.
//
// **왜 모았나**: 목업 v3 에서 「누르고 말하기」 알약은 화면에 늘 있고, 그 **옵션은 서랍**으로
// 내려간다(*"누르고 말하기는 서랍을 열지 않아도 화면에 늘 있습니다"*). 그러면 값을 **두 곳이
// 보게 된다** — 서랍에서 끈 차임이 알약 쪽에 반영이 안 되면, 사람이 껐다고 믿는 차임이
// 그대로 울린다. 각자 `useState` 로 들고 있으면 정확히 그 일이 난다.
//
// 그래서 **localStorage 를 단일 출처로 두고, 바뀔 때 창 안에 알린다.**
// `storage` 이벤트는 **다른 탭에서만** 오므로(같은 탭에서는 안 온다) 자체 이벤트를 쓴다.
import { useCallback, useEffect, useState } from 'react'

// **`InstantBroadcast` 가 쓰던 키를 그대로 쓴다.** 이름을 바꾸면 현장 브라우저에 저장된
// 값이 안 읽혀서, 껐던 차임이 어느 날 되살아난다.
// (`TTSBroadcast` 의 `carecast:ttsChime*` 은 **다른 값**이다 — 그 화면의 차임이다.)
export const CHIME_START_KEY = 'carecast:instantChimeStart'
export const CHIME_END_KEY   = 'carecast:instantChimeEnd'
const EVENT = 'carecast:chime-toggles'

/** 저장된 값이 없으면 **켬**이다 — 안내 앞뒤의 차임은 기본 동작이다. */
export function readToggle(key) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? true : v === 'true'
  } catch { return true }   // 사생활 보호 창 등에서 접근이 막히면 기본값으로 돈다
}

export function writeToggle(key, value) {
  try { localStorage.setItem(key, String(value)) } catch { /* 못 써도 이번 세션은 돈다 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value } }))
}

/**
 * 두 토글을 읽고 쓴다. **어느 화면에서 바꾸든 같은 값을 본다.**
 * @returns {{chime:boolean, endChime:boolean, setChime:(v:boolean)=>void, setEndChime:(v:boolean)=>void}}
 */
export function useChimeToggles() {
  const [chime, setChimeState]       = useState(() => readToggle(CHIME_START_KEY))
  const [endChime, setEndChimeState] = useState(() => readToggle(CHIME_END_KEY))

  useEffect(() => {
    const sync = () => {
      setChimeState(readToggle(CHIME_START_KEY))
      setEndChimeState(readToggle(CHIME_END_KEY))
    }
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)   // 다른 탭에서 바꾼 것
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setChime    = useCallback((v) => { writeToggle(CHIME_START_KEY, v); setChimeState(v) }, [])
  const setEndChime = useCallback((v) => { writeToggle(CHIME_END_KEY, v);   setEndChimeState(v) }, [])

  return { chime, endChime, setChime, setEndChime }
}
