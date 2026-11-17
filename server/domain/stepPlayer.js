// 이 단계는 **누가** 소리를 내나 (P-51, 2026-09-10).
//
// 왜 이 파일이 있나: 흐름(flow)은 **서버 스피커 단계와 브라우저 단계가 섞인 컨테이너**다.
// 그래서 "재생 창이 없으면 실패"라는 예약 5경로의 규칙(`hasSitePlayer()`)을 흐름에 그대로
// 얹으면 **차임만 있는 흐름이 멀쩡히 울리고도 실패로 적힌다.** 반대로 안 얹으면 재생 창이
// 하나도 없어도 `completed` → `SUCCEEDED` 가 된다 — 아무도 못 들은 방송이 이력에 성공이다.
//
// 가르는 근거는 이미 코드에 있었다. 다만 **`flowRunner.runStep` 의 분기 안에 흩어져** 있어서
// 밖에서 물을 수가 없었다. 여기 한 곳에 적고, 실행부와 판정부가 같은 것을 본다.
//
// 근거(2026-09-10 실측): `services/flowRunner.js` 의 `runStep` 분기 ·
// `PROJECT_PROFILE.md` §1-3 의 유형별 재생 주체 표.
//   chime      → `playChime()`      = 서버 스피커
//   tts        → `scheduled_broadcast` SSE = 브라우저
//   audio      → `prayer_play` SSE          = 브라우저
//   video_file → `video_play` SSE           = 브라우저
//   bgm        → `bgm_start` SSE            = 브라우저
//   delay·group→ 소리 없음
//
// **여기에 새 유형을 더할 때는 반드시 셋 중 하나로 정한다.** 모르는 유형을 브라우저로 보면
// 안 나가는 방송이 실패로 찍히고, 서버로 보면 안 들린 방송이 성공으로 찍힌다 —
// 둘 다 나쁘므로 '모름'을 따로 둔다(판정하는 쪽이 보수적으로 다룬다).
'use strict'

const 서버 = '서버'
const 브라우저 = '브라우저'
const 무음 = '무음'
const 모름 = '모름'

const 표 = {
  chime: 서버,
  tts: 브라우저,
  audio: 브라우저,
  video_file: 브라우저,
  bgm: 브라우저,
  delay: 무음,
  group: 무음,
}

/** 이 단계 유형의 소리를 누가 내나. 모르는 유형은 `'모름'` 이다 — 성공으로 봐주지 않는다. */
function 재생주체(stepType) {
  return 표[String(stepType || '')] || 모름
}

/**
 * 이 단계는 **화면(브라우저)이 있어야 소리가 나나.**
 * `'모름'` 도 참으로 본다 — 새 유형이 조용히 "창 없어도 성공"으로 빠지지 않게.
 */
function 화면이필요한가(stepType) {
  const who = 재생주체(stepType)
  return who === 브라우저 || who === 모름
}

module.exports = { 재생주체, 화면이필요한가, 서버, 브라우저, 무음, 모름, 표 }
