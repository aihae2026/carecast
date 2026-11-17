// 현재 재생 상태를 서버 메모리에 유지 — 다른 PC에서 폴링으로 조회 가능
// 상태가 바뀌면 sse로 전파한다. 예전엔 sse도 이 모듈을 역참조해서(접속 스냅샷용)
// 서로 lazy require였는데, 그쪽 참조를 routes/events.js로 옮겨 방향이 한쪽이 됐다(배선도 ③).
const { broadcastSSE } = require('./sse')

let state = {
  broadcast: null,  // null | { title, tab } — tab은 자동방송 5종의 식별자(없으면 null)
  bgm:       null,  // null | { title }
  video:     null,  // null | { name, category }
}

function get() { return { ...state } }

// **여기 들어오는 것이 서버의 판정 상태가 된다** (P-46, 2026-09-11).
//
// `POST /api/status/now-playing` 이 `req.body` 를 **검증 없이** 여기로 넘겼다. 그런데 이
// 상태는 표시용이 아니다 — `scheduler.broadcastInProgress()` 가 `state.broadcast` 를 읽어
// **예약을 내보낼지 미룰지**를 정한다. 문자열 하나만 꽂혀도 truthy 라 "방송 중" 이 된다.
//
// 이 시스템은 **인증이 없는 것이 설계**다(PROJECT_PROFILE §1-1). 그러니 "아무나 보낼 수
// 있다" 는 전제는 못 바꾸고, 대신 **무엇을 받을지**를 좁힌다. 화면이 정당하게 보내는 것
// (`{broadcast:null}` — 정지 버튼)은 그대로 받는다.
// **남는 위험**: 같은 망의 누구든 정지 신호를 보낼 수 있다. 그건 인증의 문제라 여기서 못 막는다.
//
// 씻는 자리를 라우트가 아니라 여기 둔 이유: `update()` 가 **모든 경로의 단일 통로**다.
// 라우트에만 두면 다음에 생기는 경로가 그대로 새 구멍이 된다(FP-0005).
const 허용칸 = ['broadcast', 'bgm', 'video']
// ── **`서버소리` 를 빠뜨렸다가 현장 방송이 밀렸다** (2026-09-16 현장 신고) ──────────
//
// 2026-09-15 에 재생바가 「이 소리를 누가 내는가」를 `서버소리` 로 실어 보내기 시작했다
// (즉시 방송은 서버 스피커가 내므로 화면이 일시정지를 못 한다). 그런데 **이 목록에 안
// 넣어서 서버가 그 칸을 조용히 버렸다.** 그 결과가 이랬다:
//
//   ① 재생바가 `{title, 서버소리:true}` 를 올린다 → 서버는 `{title}` 만 저장
//   ② 3초 뒤 폴링이 그 값으로 화면 상태를 덮는다 → 화면에서도 `서버소리` 가 사라진다
//   ③ 방송이 끝나 `onImmediateEnd` 가 와도 `서버소리` 가 없어 **안 지운다**
//   ④ `state.broadcast` 가 영원히 남는다 → `scheduler.broadcastInProgress()` 항상 true
//   ⑤ **그 뒤 예약이 전부 미뤄지다가 10분 뒤 「겹쳐서 … 건너뛰었습니다」로 버려진다**
//
// 현장에서 환기방송 2차가 그렇게 빠졌다. 겹친 것은 없었다 — 시스템이 그렇게 **믿었을**
// 뿐이다. 칸 하나가 빠지면 조용히 방송이 사라진다는 것을 이 자리에 적어 둔다.
const 칸의필드 = { broadcast: ['title', 'tab', '서버소리'], bgm: ['title'], video: ['name'] }
const 글자상한 = 200
const 글자 = (v) => (typeof v === 'string' ? v.slice(0, 글자상한) : null)

// **참·거짓 칸은 따로 씻는다.** 앞 판은 모든 칸을 `글자()` 로 받아서, 불리언인
// `서버소리` 는 목록에 넣어도 `null` 이 됐을 것이다 — 목록만 고치고 여기를 안 고치면
// 같은 고장이 되풀이된다.
const 참거짓칸 = new Set(['서버소리'])

function 씻기(칸, v) {
  if (v === null || v === undefined) return null
  // 배열·문자열·숫자가 오면 비운다 — truthy 인 채로 두면 "방송 중" 으로 읽힌다.
  if (typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  for (const f of 칸의필드[칸]) {
    if (참거짓칸.has(f)) {
      if (f in v) out[f] = !!v[f]
      continue
    }
    const s = 글자(v[f])
    if (s !== null) out[f] = s
    else if (f in v) out[f] = null      // 준 것이 문자열이 아니면 비운 채로 남긴다(tab: null)
  }
  return out
}

// **「방송 중」이 언제 켜졌나.** `broadcastInProgress()` 가 낡은 값을 걸러 내는 근거다 —
// 이 표시는 브라우저가 켜고 브라우저가 끈다. 그 사이에 창이 닫히거나 새로고침되거나
// SSE 가 끊기면 **끄는 쪽이 영영 안 온다.** 그러면 예약이 통째로 사라진다(위 ⑤).
let broadcastSince = 0
function getBroadcastSince() { return broadcastSince }

function update(patch) {
  const 씻은 = {}
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const 칸 of 허용칸) {
      // `in` 이 아니라 `hasOwnProperty` — `{}` 의 프로토타입 칸을 값으로 오해하지 않는다.
      if (!Object.prototype.hasOwnProperty.call(patch, 칸)) continue
      씻은[칸] = 씻기(칸, patch[칸])
    }
  }
  const 앞서방송중 = !!state.broadcast
  state = { ...state, ...씻은 }
  // 꺼짐 → 켜짐일 때만 시계를 새로 잡는다. 같은 방송이 제목만 바뀌어도 시계가 돌아가면
  // 긴 방송이 영영 「새것」이 되어 아래 낡음 판정을 빠져나간다.
  if (!앞서방송중 && state.broadcast) broadcastSince = Date.now()
  if (!state.broadcast) broadcastSince = 0
  try { broadcastSSE('now_playing', state) } catch { /* 전파 실패로 상태 갱신을 막지 않는다 */ }
}

module.exports = { get, update, getBroadcastSince }
