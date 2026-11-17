// 경보 배너가 무엇을 보여줄지 정하는 순수 로직.
//
// 화면에서 떼어낸 이유: 이 저장소에는 프론트엔드 테스트 러너가 없다. 렌더링은 못 덮어도
// "무엇을 보여줄지"는 순수 함수로 만들면 node --test로 덮을 수 있다
// (server/test/alert-store.test.js).
//
// 지켜야 하는 성질 둘 — 둘 다 사람이 경보를 무시하게 되는 것을 막는 장치다.
//  · 확인 전에는 안 사라진다. 5초 토스트로 만들면 자리를 비운 사이에 지나가 버린다.
//  · 같은 경보가 두 번 뜨지 않는다. SSE로 받은 것과 새로고침 후 이력에서 복원한 것이
//    겹치면 같은 문제가 두 줄로 보인다. 잔소리가 되면 사람이 안 읽기 시작한다.
//
// localStorage를 직접 만지지 않고 주입받는다 — node에는 없고, 사생활 모드·용량 초과에서
// 던지기도 한다. 못 읽으면 "확인 안 함"으로 본다: **경보를 숨기는 쪽으로 실패하면 안 된다.**

export const ACK_KEY     = 'cc_acked_alerts'
// 화면에 동시에 쌓이는 경보 수 상한.
// 배너는 화면 최상단을 덮으므로(TopBar 위) 많아지면 화면을 잡아먹는다 — 한 줄 약 60px라
// 5건이면 상단 300px가 사라진다. 3건이면 무슨 일이 났는지 알기에 충분하고, 나머지는
// 관리자 화면의 방송 이력에 전부 남아 있다.
export const MAX_VISIBLE = 3
export const MAX_ACK     = 200   // 확인 기록 보관 수 (localStorage 무한 증가 방지)

// 배너에 띄우지 않는 경보 종류.
//
// 2026-08-30, 사용자 요청: "방송누락 보기 싫다. 그냥 꺼놔."
// 감시(watchdog.js)는 그대로 돌고, 경보는 이력(broadcasts)·로그 파일에 그대로 남는다.
// **화면 배너에만 안 띄운다.**
//
// 왜 배너만 끄는가: 이 배너는 사람이 "확인"을 누를 때까지 안 사라지는 설계다. 그런데
// 방송을 실제로는 안 내보내는 PC(개발 PC 등)에서는 일과방송이 매일 반드시 "안 나갔다"로
// 판정되어 거짓 경보가 날마다 쌓인다. 잔소리가 되면 사람이 진짜 경보까지 안 읽기 시작한다
// — 배너를 만든 이유 자체가 무너진다.
// 다시 켜려면 이 배열에서 '방송누락'을 빼면 된다. 서버 쪽은 손댈 것이 없다.
//
// **'방송멈춤'은 여기 없다(2026-09-01, 사용자 결정).** 감시가 종류를 둘로 갈랐다 —
// '방송누락'은 시작조차 안 한 것(방송을 안 내보내는 PC에서는 매일 반드시 뜬다 = 잔소리),
// '방송멈춤'은 시작해 놓고 끝나지 않은 것(진짜로 사람이 지금 가 봐야 하는 일)이다.
// 애초에 이 배너를 끄게 만든 거짓 경보는 완료 시점으로만 판정하던 버그였고, 그건 고쳤다.
export const HIDDEN_KINDS = ['방송누락']

// 이력 content는 alert.js가 `[종류] 내용` 형태로 적는다
const KIND_RE = /^\[([^\]]+)\]\s*([\s\S]*)$/

// 같은 날 + 같은 종류 + 같은 문구면 같은 경보로 본다.
// 날짜를 넣는 이유: watchdog은 매일 같은 문구로 경보를 낼 수 있는데, 날짜가 없으면
// 어제 누른 "확인"이 오늘 것까지 영원히 묻어버린다.
function makeId(date, kind, message) {
  return `${date}|${kind}|${message}`
}

/** broadcasts 테이블 행 → 경보 객체. 경보가 아니면 null */
export function fromBroadcastRow(row) {
  if (!row || row.type !== '경보') return null
  const raw = String(row.content ?? '')
  const m   = KIND_RE.exec(raw)
  // 형식이 어긋나도 버리지 않는다 — 못 알아본다고 경보를 삼키면 그게 더 나쁘다
  const kind    = m ? m[1] : '알림'
  const message = m ? m[2] : raw
  const date    = row.date ?? ''
  return {
    id: makeId(date, kind, message),
    kind, message, date,
    at: `${date}T${row.time ?? '00:00'}`,
  }
}

/** SSE payload → 경보 객체. localDate는 화면이 계산한 오늘(로컬) 날짜 */
export function fromSSE(data, localDate) {
  const kind    = String(data?.kind ?? '알림')
  const message = String(data?.message ?? '')
  return {
    id: makeId(localDate, kind, message),
    kind, message, date: localDate,
    at: data?.at ?? `${localDate}T00:00`,
  }
}

/** 기존 목록에 새 경보를 합친다 — 중복 제거 + 최신순 + 상한 */
export function mergeAlerts(existing, incoming) {
  const byId = new Map()
  for (const a of [...(existing ?? []), ...(incoming ?? [])]) {
    if (a && a.id && !byId.has(a.id)) byId.set(a.id, a)
  }
  return [...byId.values()]
    // 가리는 것을 **자르기 전에** 걸러낸다. 나중에 걸러내면 가려질 경보가 표시 슬롯을
    // 차지해 진짜 경보가 MAX_VISIBLE 상한에 밀려 안 보인다.
    .filter(a => !HIDDEN_KINDS.includes(a.kind))
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
    .slice(0, MAX_VISIBLE)
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function readAcked(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(ACK_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []   // 못 읽으면 "확인 안 함" — 경보를 숨기는 쪽으로 실패하지 않는다
  }
}

export function isAcked(id, storage = defaultStorage()) {
  return readAcked(storage).includes(id)
}

export function ack(id, storage = defaultStorage()) {
  try {
    const list = readAcked(storage).filter(x => x !== id)
    list.push(id)
    storage?.setItem(ACK_KEY, JSON.stringify(list.slice(-MAX_ACK)))
  } catch { /* 저장 못 해도 이번 세션에서는 화면 상태로 사라진다 */ }
}

/** 아직 확인하지 않은 경보만 */
export function unacked(alerts, storage = defaultStorage()) {
  const acked = new Set(readAcked(storage))
  return (alerts ?? []).filter(a => a && !acked.has(a.id))
}

/** 화면이 쓰는 로컬 오늘 날짜 — 서버 alert.js가 적는 날짜와 같은 기준이어야 한다.
 *  구현은 localDate.js 하나뿐이다(대시보드·자동방송 편집기도 같은 것을 쓴다).
 *  기존 호출부가 alertStore에서 가져가고 있어 여기서 그대로 재수출한다. */
// 확장자를 반드시 붙인다 — server/test/alert-store.test.js가 이 파일을 Node의 ESM 로더로
// 직접 require한다. Vite는 확장자가 없어도 찾아주지만 Node ESM은 못 찾는다.
export { localToday } from './localDate.js'
