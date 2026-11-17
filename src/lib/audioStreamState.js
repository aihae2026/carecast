// 방송 중 여부를 공유하는 모듈 레벨 상태
// broadcaster가 켜지면 listener가 자기 소리를 재생하지 않도록 차단
let _broadcasting = false
export const isBroadcasting  = () => _broadcasting
export const setBroadcasting = (v) => { _broadcasting = v }

// ── **이 창이 지금 소리를 낼 수 있나** (현장 사고 2026-09-15) ────────────────────
//
// 창이 붙어 있는 것과 **소리를 낼 수 있는 것**은 다르다. 브라우저는 자동재생을 막을 때
// 창을 멀쩡히 그려 주고 소리만 안 낸다 — 오류도 없다. 그날 07:50 아침 종합 방송이
// 그렇게 지나갔고, 서버는 창이 붙어 있으니 **성공으로 적었다.**
//
// 서버가 그것을 알 방법은 **화면이 말해 주는 것뿐**이다. 그래서 여기 한 벌 둔다:
//   · `useAudioListener` 가 자물쇠를 풀 때마다 적고
//   · `api.js` 의 생존 신호가 10초마다 서버로 실어 보낸다
//
// **기본값이 `true` 인 것이 중요하다.** 아직 판단이 안 선 창을 「소리 못 냄」으로 보내면
// 멀쩡한 방송이 실패로 적히고 경보가 뜬다 — 이 저장소가 지키는 규칙 그대로,
// **자신 없을 때는 멀쩡한 쪽으로 기운다.** 실제로 막힌 것을 확인했을 때만 false 가 된다.
let _soundReady = true
export const isSoundReady  = () => _soundReady
export const setSoundReady = (v) => { _soundReady = !!v }
