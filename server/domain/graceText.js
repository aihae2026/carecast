// 식사 안내 녹음에 **무슨 말이 들어 있는지** 아는 표 — 자막 초안의 정본.
//
// 식사 안내 녹음은 그 TTS 문구를 대신하는 것이다(broadcastSteps의 stepMealPrayer: 이 카테고리에
// 파일이 있으면 TTS 대신 그 파일을 튼다). 그러니 무슨 말이 녹음돼 있는지 이미 알고 있고,
// 업로드할 때 그 문구를 자막 초안으로 깔면 사람이 다시 칠 일이 없다.
// 나머지 녹음 카테고리(저녁 첫 안내·저녁 마무리 음원)는 정본이 코드에 없어서 넣지 않는다.
//
// **여기가 단일 출처다.** 2026-09-05까지 이 표가 두 곳에 글자까지 같은 사본으로 있었고
// (routes/audio.js · scripts/caption-draft.cjs), 갈리지 않게 하려고 테스트가 서 있었다
// (caption-wiring.test.js). 갈리면 업로드 때 깐 초안과 받아쓰기 초안이 **서로 다른 문구**를
// 쓰게 되고, 그건 소리와 자막이 다른 방송이 된다는 뜻이다.
//
// domain/broadcastDefaults.js에 합치지 않은 이유: 그 파일은 **DB를 모르는 순수 문자열**이어야
// 한다(db/schema.js가 require하므로 — 그 파일 머리말에 이유가 적혀 있다). 여기는 rawSetting을
// 쓴다.
'use strict'

const { rawSetting } = require('./settingsRead')
const {
  BREAKFAST_PRAYER_DEFAULT, LUNCH_PRAYER_DEFAULT, DINNER_PRAYER_DEFAULT,
} = require('./broadcastDefaults')

const GRACE_TEXT = {
  'breakfast-grace': ['breakfast_prayer_tts', BREAKFAST_PRAYER_DEFAULT],
  'lunch-grace':     ['lunch_prayer_tts',     LUNCH_PRAYER_DEFAULT],
  'dinner-grace':    ['dinner_prayer_tts',    DINNER_PRAYER_DEFAULT],
}

// 이 카테고리에 정해진 문구(없으면 null). 업로드 초안과 받아쓰기 라우트가 같은 것을 본다.
function canonicalGraceText(db, category) {
  const map = GRACE_TEXT[category]
  if (!map) return null
  const [settingKey, fallback] = map
  return (rawSetting(db, settingKey) ?? fallback ?? '').trim() || null
}

module.exports = { GRACE_TEXT, canonicalGraceText }
