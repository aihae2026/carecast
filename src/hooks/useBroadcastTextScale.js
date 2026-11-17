import { useEffect, useState } from 'react'
import { getOrgInfo } from '../lib/api'
import { 글자배율, 기본글자크기 } from '../lib/broadcastTextSize'

// **방송 화면 글자 배율** — 설정의 「크게·중간·작게」를 숫자로 (사용자 지시 2026-09-16).
//
// 자막(`BroadcastCaption`)은 기관 문구(`BroadcastOverlay`)와 **다른 층**이라 그 상태를 못
// 본다. 그래서 같은 곳에서 같은 방법으로 읽는다: 처음 한 번 `/api/settings/org` 를 묻고,
// 그 뒤로는 **저장될 때 서버가 쏘는 SSE**(`org_info` → `carecast:org-info`)를 받는다.
// 홀 TV 가 다른 PC 여도 저장한 순간 바뀐다.
//
// 못 읽으면 1(= 지금 크기)이다 — 설정을 못 읽었다고 방송 글자가 작아지면 안 된다.
export default function useBroadcastTextScale() {
  const [크기, set크기] = useState(기본글자크기)

  useEffect(() => {
    let 살아있음 = true
    let 타이머 = null
    // 못 읽으면 그동안은 기본 크기로 두고 **다시 묻는다**(2026-09-26 Codex 검수 Medium). 예전엔 첫 조회가 한 번
    // 실패하면 다시 안 물어, 저장된 크기가 「중간·작게」여도 새로고침 전까지 기본(크게)에 머물렀다.
    const 묻기 = () => getOrgInfo()
      .then(d => { if (살아있음 && d?.textSize) set크기(d.textSize) })
      .catch(() => { if (살아있음) 타이머 = setTimeout(묻기, 10_000) })
    묻기()
    const 받기 = (e) => { if (e.detail?.textSize) set크기(e.detail.textSize) }
    window.addEventListener('carecast:org-info', 받기)
    return () => { 살아있음 = false; clearTimeout(타이머); window.removeEventListener('carecast:org-info', 받기) }
  }, [])

  return 글자배율(크기)
}
