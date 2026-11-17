// 기본 방송 문구 — 관리자가 settings에서 덮어쓰기 전까지 쓰는 문구의 원본.
//
// 왜 별도 파일인가(배선도 ②, 2026-08-30): 원래 broadcastSequencer.js 안에 있었는데,
// db/schema.js와 index.js가 settings 시딩에 이 상수들을 쓰느라 방송 엔진을 통째로
// require해야 했다. 방송 엔진은 morning → schema로 되돌아오는 순환 고리라 lazy
// require로만 버티는 상태였다. 순수 문자열이라 DB도 다른 모듈도 모르는 domain/에
// 두면 장부(db/)가 부서(services/)를 부를 일이 없다(route-wiring.test.js가 고정).
// broadcastSequencer는 여기서 가져다 쓰고 기존 이름 그대로 재수출한다.
'use strict'

// ── 기본 TTS 문구 ──────────────────────────────────────────
// 기본 문구는 **종교 중립이다**(사용자 결정 2026-10-17). 시설마다 믿음이 다르고, 특정 종교의 문안이 기본값이면
// 새로 설치한 기관에서 그 문안이 첫 방송으로 나간다. 그래서
//  - 식사 전 문구는 「식사 안내」, 저녁 첫 안내는 「마음 안정 시간」으로 쓴다.
//  - 「기도·묵상 시간(선택)」 단계(…_prayer_intro · …_prayer_audio · evening_prayer_tts2 · evening_closing_audio)는
//    **기본으로 꺼진 선택 항목**이다(broadcastSequencer DEFAULT_STEPS). 아래 그 단계들의 문구도
//    중립 자리 문구일 뿐이다.
//  - 종교 시설은 관리자 화면(자동방송 순서)에서 「기도·묵상 시간(선택)」 단계를 켜고 자기 문안을 넣는다.
// 상수·단계 id·설정 키 이름(`*_PRAYER_*`, `*_prayer_*`)은 저장된 설정과 짝이라 그대로 둔다 —
// 화면에도 방송에도 나가지 않는 이름이다.
const BREAKFAST_PRAYER_DEFAULT =
  '식사 안내 드리겠습니다. 오늘도 정성껏 마련된 이 음식에 감사드리며, 우리 모두 늘 기쁘고 건강하게 지내기를 바랍니다. 어르신들 아침 진지 맛있게 드십시오.'

const LUNCH_PRAYER_DEFAULT =
  '식사 안내 드리겠습니다. 오늘도 정성껏 마련된 이 음식에 감사드리며, 우리 모두 늘 기쁘고 건강하게 지내기를 바랍니다. 어르신들 점심 진지 맛있게 드십시오.'

const DINNER_PRAYER_DEFAULT =
  '식사 안내 드리겠습니다. 오늘도 정성껏 마련된 이 음식에 감사드리며, 우리 모두 늘 기쁘고 건강하게 지내기를 바랍니다. 어르신들 저녁 진지 맛있게 드십시오.'

const EXERCISE_TTS_DEFAULT =
  '어르신 여러분, 지금부터 국민체조를 시작하겠습니다. 함께 따라해 주시기 바랍니다. 감사합니다.'

const LUNCH_TTS_DEFAULT =
  '어르신 여러분, 잠시 후 점심 식사가 준비됩니다. 식사 전 가벼운 체조를 함께 하겠습니다. 감사합니다.'

const DINNER_TTS_DEFAULT =
  '어르신 여러분, 잠시 후 저녁 식사가 준비됩니다. 식사 전 가벼운 체조를 함께 하겠습니다. 감사합니다.'

const EVENING_PRAYER_TTS_DEFAULT =
  '어르신 여러분, 지금은 마음 안정 시간입니다. 하시던 일을 잠시 멈추시고 음악과 함께 편안히 쉬어 주시기 바랍니다.'

const EVENING_PRAYER_TTS2_DEFAULT =
  '이제 잠시 조용히 마음을 모으는 시간을 갖겠습니다. 편안한 마음으로 함께해 주시기 바랍니다.'

const EVENING_CLOSING_TTS_DEFAULT =
  '어르신 여러분, 오늘 하루도 함께해 주셔서 감사합니다. 편안한 저녁 보내시길 바랍니다. 감사합니다.'

const MORNING_PRAYER_INTRO_DEFAULT =
  '새로운 하루에 감사드리며, 잠시 마음을 모으는 시간을 갖겠습니다.'

const DEFAULT_MEDICATION_TTS =
  '선생님들께 안내드립니다. 식사 후 투약 시 반드시 어르신의 성함과 얼굴을 확인하고, 성함을 직접 호명한 후 투약해 주시기 바랍니다. 투약 사고 예방을 위해 한 분 한 분 정확하게 확인해 주시기 바랍니다.'

const LUNCH_PRAYER_INTRO_DEFAULT =
  '오늘도 함께하는 하루에 감사드리며, 잠시 마음을 모으는 시간을 갖겠습니다.'

const DINNER_PRAYER_INTRO_DEFAULT =
  '오늘 하루 무사히 지낸 것에 감사드리며, 잠시 마음을 모으는 시간을 갖겠습니다.'

// ── 「2회 반복」 문장 — **짓는 자리는 여기 하나다** (2026-09-14) ─────────────
//
// 예전엔 `scheduler`(예약 발사) · `flowRunner`(순서 단계) · `broadcastEstimate`(예상 시간)
// 셋이 **각자 같은 문장을 조립**했다. 즉시 TTS 를 `/api/tts/broadcast` 로 옮기면서 네 번째
// 복사가 생길 참이라 여기로 모았다.
//
// 갈리면 비싸다: **합성 캐시 키가 곧 이 문장**이라 한 글자만 달라도 미리 만들어 둔 것이
// 통째로 버려져 소리가 늦고(`scheduler` 의 prewarm), 예상 시간이 실제와 어긋난다
// (「예상 시간은 편집기와 공유한다 — 폴백 금지」).
//
// **빈 값은 그대로 돌려준다.** 부르는 쪽들이 이미 제 앞에서 빈 문구를 걸러 왔다
// (`flowRunner` 는 그 자리에서 돌아가고, `scheduler` 는 null 을 낸다). 여기서 지어내면
// 아무도 안 적은 문구가 나간다.
function 반복문안(본문, 반복인가) {
  const base = 본문 ?? ''
  if (!반복인가 || !String(base).trim()) return base
  return `${base} 다시 한번 알려드립니다. ${base}`
}

module.exports = {
  반복문안,
  BREAKFAST_PRAYER_DEFAULT, LUNCH_PRAYER_DEFAULT, DINNER_PRAYER_DEFAULT,
  EXERCISE_TTS_DEFAULT, LUNCH_TTS_DEFAULT, DINNER_TTS_DEFAULT,
  EVENING_PRAYER_TTS_DEFAULT, EVENING_PRAYER_TTS2_DEFAULT, EVENING_CLOSING_TTS_DEFAULT,
  MORNING_PRAYER_INTRO_DEFAULT, LUNCH_PRAYER_INTRO_DEFAULT, DINNER_PRAYER_INTRO_DEFAULT,
  DEFAULT_MEDICATION_TTS,
}
