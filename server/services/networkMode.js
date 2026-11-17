// 이 프로세스가 **바깥 인터넷**으로 나가도 되는가.
//
// `hardwareMode.js` 와 **일부러 갈라 둔다.** 그 스위치는 로컬 하드웨어(스피커·차임·마이크·
// 출력장치)만 보고, 게다가 `NODE_TEST_CONTEXT` 에서 자동으로 켜진다 — 여기에 네트워크를
// 얹으면 **테스트 전체의 전제가 조용히 바뀐다.** 그래서 판정을 따로 둔다.
// 계약표: `docs/audit/NETWORK_FLAG_DESIGN.md` (사용자 승인 2026-09-10 §2).
//
// **무엇을 막나 — 바깥 인터넷만.**
//   막는다: 날씨(data.go.kr·apihub·open-meteo) · Google(캘린더·OAuth) · Gemini ·
//           SwitchBot 클라우드 · Azure 음성 합성
//   안 막는다: **로컬 HTTP/WS 수신**(:3001·SSE·마이크 WS). 막으면 화면이 서버에 못 붙어
//           시스템이 통째로 죽는다 — 검수 목적과 정반대다.
//   해당 없음: 장비 LAN. 이 저장소에는 그런 통신이 없다(스마트플러그도 클라우드 경유다).
//
// **미설정이면 아무것도 안 바뀐다.** 기본값은 지금 동작 그대로다.
'use strict'

function networkDisabled() {
  return process.env.CARECAST_NO_NETWORK === '1'
}

// 같은 안내를 매 호출마다 찍지 않는다 — 로그가 덮이면 진짜 정보가 묻힌다.
// (`hardwareMode.noticeOnce` 와 같은 이유·같은 모양이다. 태그만 다르다.)
const _알림함 = new Set()
function noticeOnce(tag) {
  if (_알림함.has(tag)) return
  _알림함.add(tag)
  console.log(`[${tag}] 네트워크 차단 모드(CARECAST_NO_NETWORK=1) — 바깥 호출을 하지 않습니다`)
}

// **조용히 성공으로 위장하지 않는다.** 이 저장소가 가장 비싸게 데인 유형이
// "안 나갔는데 기록은 성공"이다(CC-008 delivery-truth). 막을 때는 **거절**한다.
// 부르는 쪽이 이유를 사람 말로 그대로 쓸 수 있게 문장으로 준다.
// 조사는 끝 글자 받침에 맞춘다(2026-10-17 설치 시험 c12 — 「날씨 조회을(를)」). 한글이 아니면 둘 다 적는다.
function 을를(말) {
  const c = String(말).trim().slice(-1).charCodeAt(0) - 0xAC00
  if (!(c >= 0 && c <= 11171)) return '을(를)'
  return c % 28 ? '을' : '를'
}
// **표시를 단다**(`code`). 부르는 쪽이 「사용자가 끈 것」과 진짜 오류를 가려 로그 수준을 고를 수 있게.
const 차단코드 = 'NETWORK_BLOCKED'
function blockedError(what) {
  const e = new Error(`네트워크 차단 모드 — ${what}${을를(what)} 하지 않았습니다`)
  e.code = 차단코드
  return e
}
const 차단인가 = (e) => !!e && e.code === 차단코드

// 라우트의 catch 에서 쓴다. 네트워크를 끈 것은 사용자가 정한 일이라 **정보 수준**으로 남기고,
// 그 밖의 실패는 지금처럼 error 로 남긴다.
function 실패기록(tag, err) {
  if (차단인가(err)) console.log(tag, err.message)
  else console.error(tag, err?.message)
}

// 바깥 호출 **앞에 부르는 한 줄.** 파일마다 각자 helper 를 정의하면 그 정의를 무력화하는
// 변이를 아무도 못 잡는다([FACT] EV-003223 — 실제로 하나가 살아남았다).
// 여기 하나만 두고 모두가 이것을 부른다.
function 바깥호출차단(tag, what) {
  if (!networkDisabled()) return
  noticeOnce(tag)
  throw blockedError(what)
}

module.exports = { networkDisabled, noticeOnce, blockedError, 바깥호출차단, 차단인가, 실패기록 }
