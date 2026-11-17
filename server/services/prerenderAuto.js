// 자동 일과방송의 문안을 **미리 만들어 둔다** — 정적 4종(체조·점심·저녁·저녁 마무리).
//
// 왜 필요한가(2026-09-06): 그때는 발사 시각에 인터넷 합성을 불렀다(broadcastSteps.js:93,
// 예산 15초). 그래서 12:00 예약이 12:01 전후에 나갔다. 이 파일은 그 합성을 **방송 시각에서
// 떼어내** 미리 끝내 둔다. 발사 때는 캐시에서 꺼내 쓰므로 수 ms 다.
//
// **아침 종합 방송은 여기서 다루지 않는다.** 날씨·미세먼지가 들어가 매번 문안이 달라진다
// (LANES.morning.contentSource === 'system_template'). 아침은 2-b 에서 조각 단위로 다룬다 —
// 부팅 60초 창(07:49 부팅 → 07:50 방송)이 걸려 있어 설계가 다르다.
//
// ── 캐시 키가 맞아야 의미가 있다 ────────────────────────────────────────
// 미리 만든 것과 발사 때 찾는 것이 **글자 하나라도 다르면** 캐시가 안 맞고, 발사 경로가
// 예전처럼 합성한다(= 아무것도 안 고친 것이 된다). 그래서 이 파일은 문안·음성·속도·피치를
// **실행부와 같은 방법으로** 만든다:
//   · 단계 목록  — broadcastSequencer.getSteps (편집기에서 끈 단계를 그대로 반영)
//   · 음성       — 단계의 ttsVoice 덮어쓰기 → 없으면 tts_voice_morning
//   · 속도·피치  — tts_rate / tts_pitch
// 이 규칙이 broadcastSteps.js 의 stepTTS 와 어긋나면 server/test/prerender-auto.test.js 가 잡는다.
'use strict'

const { getSetting } = require('../domain/settingsRead')
const { AUTO_BROADCASTS, autoTime } = require('../domain/autoBroadcasts')
const { generateTTSWithRetry, deleteTmpFile, cachePathFor, cuesPathOf, rateToStr, pitchToStr } = require('./tts')

// 정적 4종의 TTS 단계 — 단계 id ↔ 문안이 담긴 설정 키.
// 기본값은 broadcastSequencer 가 갖고 있다(그 파일이 문안의 단일 출처다).
const STATIC_TTS_STEPS = {
  exercise: [
    { stepId: 'exercise_tts', key: 'exercise_tts', def: 'EXERCISE_TTS_DEFAULT' },
  ],
  lunch: [
    { stepId: 'lunch_tts',              key: 'lunch_tts',              def: 'LUNCH_TTS_DEFAULT' },
    { stepId: 'lunch_prayer_intro_tts', key: 'lunch_prayer_intro_tts', def: 'LUNCH_PRAYER_INTRO_DEFAULT' },
    { stepId: 'lunch_prayer_tts',       key: 'lunch_prayer_tts',       def: 'LUNCH_PRAYER_DEFAULT' },
  ],
  dinner: [
    { stepId: 'dinner_tts',        key: 'dinner_tts',        def: 'DINNER_TTS_DEFAULT' },
    { stepId: 'dinner_prayer_tts', key: 'dinner_prayer_tts', def: 'DINNER_PRAYER_DEFAULT' },
  ],
  evening_prayer: [
    { stepId: 'evening_prayer_tts',  key: 'evening_prayer_tts',  def: 'EVENING_PRAYER_TTS_DEFAULT' },
    { stepId: 'evening_prayer_tts2', key: 'evening_prayer_tts2', def: 'EVENING_PRAYER_TTS2_DEFAULT' },
    { stepId: 'evening_closing_tts', key: 'evening_closing_tts', def: 'EVENING_CLOSING_TTS_DEFAULT' },
  ],
}

/** stepTTS 와 **같은 방법으로** TTS 파라미터를 만든다. 여기가 어긋나면 캐시가 안 맞는다. */
function ttsParamsFor(db, text, step = {}) {
  const voiceMap = { female: 'ko-KR-SunHiNeural', male: 'ko-KR-InJoonNeural' }
  const voice    = voiceMap[step.ttsVoice] || getSetting(db, 'tts_voice_morning', 'ko-KR-SunHiNeural')
  const rateVal  = parseFloat(getSetting(db, 'tts_rate',  '0.9')) || 0.9
  const pitchVal = parseFloat(getSetting(db, 'tts_pitch', '1'))   || 1
  return { text, voice, rate: rateToStr(rateVal), pitch: pitchToStr(pitchVal) }
}

/** 이미 만들어져 있나. **자막까지 있어야** "있다"로 본다 — 소리만 있으면 발사 때 자막 합성이 붙는다. */
function alreadyRendered(params) {
  // 차례 안의 어느 엔진으로든(tts.준비된캐시 — 예약 준비와 같은 판정)
  try { return !!require('./tts').준비된캐시(params, (e) => cachePathFor(params, undefined, e), cuesPathOf) } catch { return false }
}

/**
 * 정적 4종이 지금 어떤 문안을 쓰는지 모은다. **DB 만 읽는다 — 합성하지 않는다.**
 * 관찰 스크립트도 이 함수를 써서 "몇 개가 준비돼 있나"를 센다.
 */
function staticTexts(db) {
  const seq = require('./broadcastSequencer')
  const out = []
  for (const [laneId, entries] of Object.entries(STATIC_TTS_STEPS)) {
    const lane = seq.LANES[laneId]
    if (!lane) continue
    if (lane.contentSource !== 'system_static') continue   // 성격이 바뀌면 여기서 빠진다

    // 꺼 둔 방송은 미리 만들지 않는다. 활성 키는 방송마다 이름이 달라서
    // domain/autoBroadcasts.js 의 표를 그대로 읽는다 — 여기서 이름을 다시 짓지 않는다.
    const spec = AUTO_BROADCASTS.find((s) => s.id === laneId)
    if (spec && getSetting(db, spec.enabledKey) !== 'true') continue

    const steps = seq.getSteps(db, lane.tab)
    for (const e of entries) {
      const step = steps.find((s) => s.id === e.stepId)
      if (step && step.enabled === false) continue          // 편집기에서 끈 단계
      const text = getSetting(db, e.key, seq[e.def] || '')
      if (!text || !String(text).trim()) continue
      out.push({
        lane: laneId, stepId: e.stepId, settingKey: e.key,
        params: ttsParamsFor(db, String(text), step || {}),
      })
    }
  }
  return out
}

/**
 * 준비 상태만 센다. 합성하지 않는다 — 관찰용.
 * @returns {{total:number, ready:number, missing:Array}}
 */
function readiness(db) {
  const items = staticTexts(db)
  const missing = items.filter((it) => !alreadyRendered(it.params))
    .map((it) => ({ lane: it.lane, stepId: it.stepId }))
  return { total: items.length, ready: items.length - missing.length, missing }
}

// ── 진행 상태 — 밖에서 물어볼 수 있어야 한다 ──────────────────────────────
//
// 시간 상한을 안 두는 대신(아래 prerenderStatic 주석) **오래 걸리는 것을 알아챌 수 있어야**
// 한다. 합성이 응답 없이 매달리면 이 일이 안 끝나고, 그때 밖에서 볼 수 있는 것이
// 없으면 "왜 안 되지"를 로그로만 짐작하게 된다.
const 진행 = { running: false, startedAt: null, total: 0, done: 0, made: 0, cached: 0, failed: 0 }

// 같은 건이 계속 실패하면 그만 시도한다. 무한 재시도로 도는 것을 막는다 —
// 매분 스캔이 매번 같은 실패를 반복하면 합성 엔진을 두들기기만 하고 아무것도 안 고쳐진다.
const 실패이력 = new Map()          // "lane/stepId" → 연속 실패 횟수
const 실패상한 = 3

/** 지금 미리 만들고 있는가, 몇 건 남았는가. 관찰 스크립트와 /api 가 이걸 본다. */
function status() {
  return {
    ...진행,
    remaining: Math.max(0, 진행.total - 진행.done),
    elapsedSec: 진행.startedAt ? Math.round((Date.now() - 진행.startedAt) / 1000) : 0,
    givenUp: [...실패이력.entries()].filter(([, n]) => n >= 실패상한).map(([k]) => k),
  }
}

/** 다음 발사가 가까운 방송부터. 기동이 늦었을 때 **가장 먼저 나갈 것을 가장 먼저** 만든다. */
function byImminence(db, items, now = new Date()) {
  const 분 = (t) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
  const 지금 = now.getHours() * 60 + now.getMinutes()
  const 남은분 = new Map()
  for (const spec of AUTO_BROADCASTS) {
    // 빈 시각 = 꺼진 방송. 순서 계산에서 빼면 남은분이 없어 뒤로 밀린다(P-35).
    const t = 분(autoTime(getSetting(db, spec.timeKey), spec))
    if (t === null) continue
    남은분.set(spec.id, t >= 지금 ? t - 지금 : t - 지금 + 24 * 60)   // 지났으면 내일
  }
  return [...items].sort((a, b) => (남은분.get(a.lane) ?? 9999) - (남은분.get(b.lane) ?? 9999))
}

/**
 * 아직 없는 것만 미리 만든다.
 *
 * **시간 상한을 주지 않는다.** 이건 방송 경로가 아니라서 급하지 않다 — 오히려 짧은 예산을
 * 주면 실패하고, 그러면 발사 시각에 다시 합성하게 되어 고치려던 문제가 그대로 남는다.
 * 대신 오래 걸리면 **경고를 남긴다**(중단하지는 않는다).
 *
 * 실패해도 던지지 않는다. 미리 만들기가 서버 기동을 막으면 본말전도다 —
 * 실패하면 예전처럼 발사 시각에 합성한다(동작은 그대로, 느릴 뿐).
 */
async function prerenderStatic(db, { log = console.log, warnAfterMs = 5 * 60 * 1000, now = new Date() } = {}) {
  if (진행.running) { log('[선제렌더] 이미 도는 중 — 건너뜁니다'); return { skipped: true, ...status() } }

  const items = byImminence(db, staticTexts(db), now)
  Object.assign(진행, { running: true, startedAt: Date.now(), total: items.length, done: 0, made: 0, cached: 0, failed: 0 })

  // 오래 걸리는 것을 알아챌 수 있게. 중단하지 않는다 — 알리기만 한다.
  const 경고타이머 = setTimeout(() => {
    log(`[선제렌더] ⚠ ${Math.round(warnAfterMs / 60000)}분이 지났는데 아직 도는 중입니다 `
      + `(${진행.done}/${진행.total}). 음성 합성이 매달렸을 수 있습니다 — 중단하지는 않습니다.`)
  }, warnAfterMs)

  try {
    for (const it of items) {
      const 열쇠 = `${it.lane}/${it.stepId}`
      if ((실패이력.get(열쇠) || 0) >= 실패상한) { 진행.done += 1; continue }   // 포기한 건
      // 미리 만들기는 **고음질**로(2026-09-22) — 방송은 고음질판이 있으면 그것을, 없으면 보통 캐시를 쓴다.
      const 고 = { ...it.params, 고음질: true }
      if (alreadyRendered(고)) { 진행.cached += 1; 진행.done += 1; 실패이력.delete(열쇠); continue }
      try {
        // 미리 만들기는 합성 줄의 **맨 뒤**다 — 그 사이 정시 방송이 오면 지금 것 하나만 기다린다.
        const tmp = await generateTTSWithRetry(고, 3, { priority: 0 })
        deleteTmpFile(tmp)          // 캐시에는 남았다. 지금 재생할 것이 아니다.
        진행.made += 1
        실패이력.delete(열쇠)
      } catch (e) {
        진행.failed += 1
        const n = (실패이력.get(열쇠) || 0) + 1
        실패이력.set(열쇠, n)
        log(`[선제렌더] 실패 ${열쇠} (${n}회): ${e.message}`
          + (n >= 실패상한 ? ' — 상한에 닿아 더 시도하지 않습니다(발사 시각에는 예전처럼 합성)' : ' (발사 시각에 다시 시도한다)'))
      }
      진행.done += 1
    }
  } finally {
    clearTimeout(경고타이머)
    진행.running = false
  }

  if (진행.made || 진행.failed) {
    log(`[선제렌더] 정적 4종 — 새로 ${진행.made}건, 이미 있음 ${진행.cached}건, 실패 ${진행.failed}건 `
      + `(${Math.round((Date.now() - 진행.startedAt) / 1000)}초)`)
  }
  return { made: 진행.made, cached: 진행.cached, failed: 진행.failed, total: 진행.total }
}

// ── 아침 방송: 조각 단위 (2-b) ────────────────────────────────────────────
//
// 아침만 다르게 다루는 이유: 문안에 날씨·미세먼지가 들어가 **매일 달라진다**.
// 그래서 정적 4종처럼 "한 번 만들고 끝"이 안 된다. 대신 조각을 갈라
// **날씨를 안 기다리는 것**(인사·날짜·글귀)을 먼저 만들어 둔다 —
// 07:49 부팅 → 07:50 방송의 60초에서 만들 것을 줄이는 것이 목적이다.
//
// **외부 조각(날씨·미세먼지·특보·일정)은 여기서 만들지 않는다.** 그것은 데이터가 있어야
// 문안이 정해지고, 미리 만들면 어제 것이 나간다. 그 조각의 렌더는 발사 경로가 맡는다.

/** 아침 방송에서 **날씨를 안 기다리는** 조각의 문안. 없으면 null. */
function morningEarlyText(db) {
  try {
    const seq = require('./broadcastSequencer')
    const { splitSegments } = require('../domain/morningSegments')
    // 실행부가 쓰는 조각 목록과 같아야 한다(broadcastSequencer 의 date_weather 계열).
    const { early } = splitSegments(['date', 'weather', 'dust', 'alert', 'schedule'])
    // 외부 데이터 없이 부른다 — early 조각은 data 를 안 본다(morning.js:256 buildSegmentText).
    const parts = seq.segmentTexts(db, early, {})
    return parts.length ? parts.join(' ') : null
  } catch { return null }
}

/**
 * 아침의 "먼저 만들 수 있는" 조각을 미리 만든다.
 * 정적 4종보다 **먼저** 부른다 — 07:50 이 하루 중 가장 빠듯한 자리다.
 */
async function prerenderMorningEarly(db, { log = console.log } = {}) {
  const text = morningEarlyText(db)
  if (!text) return { made: 0, cached: 0, skipped: true }
  const params = { ...ttsParamsFor(db, text, {}), 고음질: true }   // 미리 만들기는 고음질(2026-09-22)
  if (alreadyRendered(params)) return { made: 0, cached: 1 }
  try {
    const tmp = await generateTTSWithRetry(params, 3, { priority: 0 })
    deleteTmpFile(tmp)
    log('[선제렌더] 아침 조각(날짜·인사) 준비 완료')
    return { made: 1, cached: 0 }
  } catch (e) {
    log(`[선제렌더] 아침 조각 실패: ${e.message} (발사 시각에 다시 시도한다)`)
    return { made: 0, cached: 0, failed: 1 }
  }
}

/** 시험용 — 실패 이력을 지운다. 운영 경로에서는 안 부른다. */
function _resetFailures() { 실패이력.clear() }

module.exports = {
  STATIC_TTS_STEPS, ttsParamsFor, alreadyRendered, staticTexts, readiness,
  prerenderStatic, status, byImminence, _resetFailures,
  morningEarlyText, prerenderMorningEarly,
}
