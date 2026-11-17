// 설정에 저장할 수 있는 한국어 목소리 이름 — Azure 음성(선택 엔진)의 목소리 이름이다.
// 기본 엔진 Supertonic 은 목소리 이름 대신 화자 번호(sid 1, 사용자 확정)를 쓰고 이 값은 무시한다.
// 이름 목록은 2026-09-21 실측한 것 그대로다(목소리 이름을 기억으로 적지 않는다 — GookMin 사고).
//
// 왜 서버가 이 목록을 갖는가: 예전엔 서버가 몰라서 **무엇이 와도 저장했다.** 존재하지
// 않는 ko-KR-GookMinNeural 이 그렇게 DB 에 들어가 아침 방송을 죽였다(2026-09-18 제출판).
//
// 왜 DB 에 두지 않는가: `emergencyPresets` 는 DB 에 두었지만 그건 **현장이 고칠 수 있게**
// 하려는 것이었다. 목소리 목록은 현장이 고칠 것이 아니라 **엔진이 정하는 것**이다.
//
// 화면 목록(src/data/presets.js 의 ttsVoices)은 이 목록의 부분집합이어야 한다 — 시험
// `tts-voice-guard.test.js` 가 두 벌을 묶는다. 이름을 더할 때는 **반드시 실행해서 확인한다**:
// 기억이나 회의 기록에서 옮겨 적으면 GookMin 과 똑같은 사고가 난다.
'use strict'

const 기본목소리 = 'ko-KR-SunHiNeural'

const 목소리들 = Object.freeze([
  Object.freeze({ value: 'ko-KR-SunHiNeural',              label: '여성 — SunHi' }),
  Object.freeze({ value: 'ko-KR-InJoonNeural',             label: '남성 — InJoon' }),
  Object.freeze({ value: 'ko-KR-HyunsuMultilingualNeural', label: '남성 — Hyunsu (다국어)' }),
])

const 목록 = () => 목소리들

// **다듬지 않고 정확히 비교한다.** 예전 판은 trim() 한 값으로 판정했는데, 저장은 원래 값으로
// 하고 합성 서비스는 ' ko-KR-SunHiNeural ' 을 "Invalid voice" 로 거절한다 — 검사는 통과, 방송은
// 실패라는 GookMin 과 같은 모양의 구멍이었다(2026-09-21 검수 재현). 부팅 보정도 이 함수를
// 쓰므로 공백 붙은 저장값까지 함께 고쳐진다.
function 있는목소리인가(v) {
  return typeof v === 'string' && 목소리들.some(x => x.value === v)
}

module.exports = { 목록, 있는목소리인가, 기본목소리 }
