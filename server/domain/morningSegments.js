// 아침 종합 방송의 조각이 **무엇에 의존하는가** — 렌더 시점을 가르는 단일 출처.
//
// 왜 필요한가(2026-09-06): 현장은 07:45 전원 · 07:49 부팅 완료 · **07:50 첫 방송**이다.
// 아침 방송의 문안은 발사 시각에 지어지고 그때 합성된다. 부팅과 방송 사이 **60초** 안에
// 그 전부를 만들어야 하니 늦는다 — 12:01 지연의 실제 원인이 이 경로다.
//
// 조각을 성격별로 가르면 **60초 안에 만들 것이 크게 줄어든다.**
//
//   고정   greeting        — 문자열이 늘 같다. 한 번 만들면 영원히 쓴다
//   날짜   date, quote     — 시계만 본다. **외부 API 를 안 기다려도 문안이 정해진다**
//   외부   weather, dust, alert, schedule — API 응답이 있어야 문안이 정해진다
//
// **주의 — "외부 API 가 필요 없다"는 것이지 "네트워크가 필요 없다"가 아니다.**
// 합성 엔진이 인터넷을 쓰든 안 쓰든 상관없다. 여기서 가르는 것은 **문안이 언제
// 정해지는가**다. 앞의 둘은 날씨를 안 기다리므로 **더 일찍** 만들어 둘 수 있고
// (greeting 은 영구 캐시, date 는 그날 자정 이후 아무 때나), 그만큼 07:50 임계 구간에서
// 만들 것이 줄어든다.
//
// 근거(2026-09-06 읽음): `server/services/morning.js:264` greeting 은 고정 문자열,
// `:267` date 는 `now` 만 쓰고, `:270` weather·`:329` dust·`:348` alert 는 인자로 받은
// 외부 데이터가 없으면 빈 문자열을 낸다. `:352` schedule 은 Google Calendar 결과를 본다.
//
// ── 왜 넷이 아니라 둘로 묶나 ────────────────────────────────────────────
// 지금 실행부는 조각을 **하나로 이어 붙여 한 번에** 합성한다
// (`broadcastSequencer.js:433` — `parts.join(' ')` 뒤 stepTTS 한 번).
// 조각마다 따로 합성하면 조각 사이에 **간격이 생겨 소리가 달라진다.**
// 넷으로 쪼개면 간격이 셋, 둘로 나누면 하나다. 얻는 것(임계 구간에서 합성할 분량이
// 날씨 문장 하나로 줄어듦)은 둘로 나누는 것만으로 거의 다 얻는다.
'use strict'

/** 조각 id → 무엇에 의존하는가. 여기 없는 id 는 **외부로 본다**(안전한 쪽). */
const SEGMENT_KIND = {
  greeting: 'fixed',
  date:     'clock',
  quote:    'clock',
  weather:  'external',
  dust:     'external',
  alert:    'external',
  schedule: 'external',
}

/**
 * 문안이 **외부 API 를 안 기다리고** 정해지는가.
 * 참이면 날씨보다 먼저 만들어 둘 수 있다(합성 자체에는 네트워크가 필요하다 — 위 주석).
 */
function isKnownEarly(id) {
  const kind = SEGMENT_KIND[id]
  return kind === 'fixed' || kind === 'clock'
}

/**
 * 조각 목록을 **둘로** 가른다. 순서는 받은 그대로 유지한다 —
 * 아침 안내문은 "오늘은 9월 6일" 다음에 날씨가 와야 말이 된다.
 * @returns {{early: string[], external: string[]}}
 */
function splitSegments(ids = []) {
  const early = []
  const external = []
  for (const id of ids) (isKnownEarly(id) ? early : external).push(id)
  return { early, external }
}

// 조각 묶음 사이에 두는 간격(ms). **현장에서 들어보고 맞출 수 있어야 한다** —
// 설정 키 `morning_segment_gap_ms`. 0 이면 간격 없이 곧바로 이어진다.
const GAP_SETTING_KEY = 'morning_segment_gap_ms'
const GAP_DEFAULT_MS = 300

/** 간격(ms). 이상한 값이 들어와도 방송이 멈추지 않게 범위를 자른다. */
function gapMs(getSettingFn) {
  const raw = Number(getSettingFn(GAP_SETTING_KEY, String(GAP_DEFAULT_MS)))
  if (!Number.isFinite(raw) || raw < 0) return GAP_DEFAULT_MS
  return Math.min(raw, 3000)      // 3초를 넘길 이유가 없다 — 넘기면 방송이 늘어진다
}

module.exports = {
  SEGMENT_KIND, isKnownEarly, splitSegments,
  GAP_SETTING_KEY, GAP_DEFAULT_MS, gapMs,
}
