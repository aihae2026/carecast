// 발사 시각의 소리 확보 — **캐시가 먼저, 합성은 예외.**
//
// 3단계(2026-09-06)에서 하는 일이 이것이다. 그전에는 발사 경로가 곧바로
// `generateTTSWithRetry` 를 불렀고, 캐시가 없으면 그 자리에서 15초를 기다렸다
// (`broadcastSteps.js` 의 옛 코드). 그래서 12:00 방송이 12:01에 나갔다.
//
// 이제 순서가 바뀐다:
//   1) **캐시를 본다.** 있으면 네트워크를 안 탄다(tts.js:459-462 의 copyFromCache).
//   2) 없으면 — **그것 자체가 신호다.** 선제 렌더가 제 역할을 못 한 것이므로 세어 둔다.
//   3) 그래도 소리는 내야 한다. 즉시 렌더를 걸고 **완료되는 대로** 재생한다.
//      최악이 "몇 초 늦음"이지 **"무음"이 아니다.**
//   4) 유예를 넘기면 그때는 포기하고 **알린다.** 조용히 넘어가지 않는다.
//
// 왜 캐시 미스를 세는가: 3단계 이후의 미스는 버그의 증상이다. 선제 렌더가 안 돌았거나,
// 캐시 키가 어긋났거나(문안·음성·속도가 실행부와 달라짐), 문안이 방금 바뀐 것이다.
// 숫자가 없으면 "가끔 느리네" 로 넘어가고 원인을 영영 안 본다.
'use strict'

const { generateTTSWithRetry, cachePathFor, cuesPathOf } = require('./tts')

// 미스 기록 — 언제, 무엇이, 왜. 서버가 사는 동안만 남는다(재시작하면 0).
// 영구 보관은 broadcasts.delay_ms 가 맡는다 — 여기는 "지금 이 서버에서 몇 번" 이다.
const 미스 = []
const 미스상한 = 200        // 메모리를 무한정 먹지 않게. 오래된 것부터 버린다.

function recordMiss(info) {
  미스.push({ at: new Date().toISOString(), ...info })
  if (미스.length > 미스상한) 미스.splice(0, 미스.length - 미스상한)
}

/** 지금까지의 캐시 미스. 관찰 스크립트와 사람이 본다. */
function missStats() {
  const 별로 = {}
  for (const m of 미스) 별로[m.title || '(제목 없음)'] = (별로[m.title || '(제목 없음)'] || 0) + 1
  return { total: 미스.length, recent: 미스.slice(-10), byTitle: 별로 }
}

/** 시험용 — 미스 기록을 지운다. */
function _resetMisses() { 미스.length = 0 }

/** 캐시에 준비돼 있나. **자막까지 있어야** 준비된 것이다(소리만 있으면 발사 때 자막 합성이 붙는다). */
function isReady(params) {
  // 차례 안의 어느 엔진으로든(tts.준비된캐시 — 예약 준비와 같은 판정)
  // 미리 만들기가 고음질로 만들어 두었으면 그것도 준비된 것이다(2026-09-22) — 안 보면 캐시 미스로 잘못 센다.
  const 있나 = (p) => { try { return !!require('./tts').준비된캐시(p, (e) => cachePathFor(p, undefined, e), cuesPathOf) } catch { return false } }
  return 있나(params) || (!params?.고음질 && 있나({ ...params, 고음질: true }))
}

/**
 * 소리 파일을 확보한다. 캐시가 있으면 그것을, 없으면 즉시 렌더한다.
 *
 * @param {object} params      TTS 파라미터(문안·음성·속도·피치)
 * @param {object} opts
 *   - graceMs  {number|null} 유예 상한. null 이면 상한 없음(긴급)
 *   - title    {string}      로그·기록용 이름
 *   - onMiss   {function}    미스일 때 부른다(관찰용)
 * @returns {Promise<{file: string, fromCache: boolean, waitedMs: number}>}
 * @throws  유예를 넘겨 못 만들었을 때. **호출부가 이걸 잡아 알림을 남긴다.**
 */
async function obtainAudio(params, { graceMs = null, title = '', log = console.log, onMiss } = {}) {
  const t0 = Date.now()

  if (isReady(params)) {
    // 캐시 히트 — 네트워크를 안 탄다. 이것이 정상 경로다.
    // **유예는 여기서도 넘긴다** (Codex ⑥ 2회차 High). 「준비됨」 은 차례 안 어느 엔진 캐시든이라, 먼저 쓸 엔진
    // (Azure)의 캐시가 없으면 그 엔진을 먼저 시도한다 — 예산이 없으면 그 시도가 유예를 넘겨 방송이 늦는다.
    const file = await generateTTSWithRetry(params, 1, graceMs == null ? {} : { deadlineMs: graceMs })
    return { file, fromCache: true, waitedMs: Date.now() - t0 }
  }

  // ── 미스 ── 선제 렌더가 제 역할을 못 했다. 세어 두고, 그래도 소리는 낸다.
  recordMiss({ title, text: String(params.text || '').slice(0, 40) })
  if (onMiss) { try { onMiss() } catch { /* 관찰이 방송을 막으면 안 된다 */ } }
  log(`[즉시렌더] 캐시 없음 — 지금 만든다: "${title}" `
    + (graceMs == null ? '(유예 없음)' : `(유예 ${Math.round(graceMs / 1000)}초)`))

  const file = await generateTTSWithRetry(
    params, 3, graceMs == null ? {} : { deadlineMs: graceMs })
  const waited = Date.now() - t0
  log(`[즉시렌더] 완료 — "${title}" ${(waited / 1000).toFixed(1)}초 걸렸다`)
  return { file, fromCache: false, waitedMs: waited }
}

module.exports = { obtainAudio, isReady, missStats, recordMiss, _resetMisses }
