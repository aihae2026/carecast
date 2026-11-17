// 기동 직후 준비 — 네트워크 확인 → TTS 예열 → 선제 렌더.
//
// 왜 필요한가(2026-09-06): 현장은 **07:45 전원 · 07:49 부팅 완료 · 07:50 첫 방송**이다.
// 부팅과 첫 방송 사이가 **60초**뿐이고, 그 60초 안에 세 가지가 어긋날 수 있다:
//
//   ① DHCP·Wi-Fi 가 아직 안 붙었다 → 외부 API 를 부르면 그냥 실패한다.
//      그래서 **먼저 도달을 확인하고**, 안 되면 짧은 간격으로 다시 본다.
//   ② 음성 합성 첫 호출은 준비 비용이 붙는다(모델 적재) → 그 비용을 **첫 방송 이전에** 치른다.
//      짧은 더미 한 문장을 만들고 결과는 버린다.
//   ③ 미리 만들 것이 여럿이면 **가장 먼저 나갈 방송부터** 만든다(FIFO 아님).
//
// **이 파일은 절대 던지지 않는다.** 기동 준비가 실패해도 방송은 예전처럼 나가야 한다
// (발사 시각에 합성하는 옛 경로가 그대로 살아 있다). 느려질 뿐이지 멈추면 안 된다.
'use strict'

const { generateTTSWithRetry, deleteTmpFile, rateToStr, pitchToStr } = require('./tts')
const { prerenderStatic, prerenderMorningEarly } = require('./prerenderAuto')

// 도달 확인 대상. 특정 음성·날씨 서비스가 아니라 **일반 인터넷**을 본다 —
// 여기서 특정 서비스를 찍으면 그 서비스가 잠깐 흔들릴 때 준비 전체가 멈춘다.
// **http 다(https 아님).** 이 주소는 윈도우 NCSI 가 쓰는 평문 HTTP 전용이라 TLS 인증서가 이 호스트명을
// 덮지 않는다 — https 로 부르면 ERR_TLS_CERT_ALTNAME_INVALID 로 6회 전부 실패하고, 기동 선제 렌더가
// **항상** 건너뛰어졌다(2026-09-07 개발 PC 실측: https 000 · http 200 'Microsoft Connect Test').
const PROBE_URL = 'http://www.msftconnecttest.com/connecttest.txt'

const 기본옵션 = {
  tries: 6,                 // 6회 × 5초 = 최대 30초. 07:49 부팅 → 07:50 방송 안에 든다.
  gapMs: 5000,
  probeTimeoutMs: 3000,
}

/** 인터넷에 닿는가. **던지지 않는다** — 못 닿아도 다음 단계로 간다(캐시가 있으면 방송은 나간다). */
async function waitForNetwork({ tries, gapMs, probeTimeoutMs } = 기본옵션, { log = console.log, fetchFn = fetch, sleep } = {}) {
  const 쉬기 = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetchFn(PROBE_URL, { signal: AbortSignal.timeout(probeTimeoutMs) })
      if (res && (res.ok || res.status)) {
        if (i > 1) log(`[기동준비] 네트워크 확인됨 (${i}번째 시도)`)
        return true
      }
    } catch { /* 부팅 직후엔 흔한 일이다 — 조용히 다시 본다 */ }
    if (i < tries) await 쉬기(gapMs)
  }
  log(`[기동준비] ⚠ 네트워크에 못 닿았습니다(${tries}회 시도) — 선제 렌더를 건너뜁니다. `
    + '캐시가 있으면 방송은 그대로 나갑니다.')
  return false
}

/**
 * TTS 예열 — 짧은 더미 한 문장. **결과는 버린다.**
 * 목적은 소리가 아니라 **첫 호출의 연결 수립 비용을 지금 치르는 것**이다.
 */
async function warmupTTS(db, { log = console.log } = {}) {
  const { getSetting } = require('../domain/settingsRead')
  try {
    const voice = getSetting(db, 'tts_voice_morning', 'ko-KR-SunHiNeural')
    const rate  = rateToStr(parseFloat(getSetting(db, 'tts_rate', '0.9')) || 0.9)
    const pitch = pitchToStr(parseFloat(getSetting(db, 'tts_pitch', '1')) || 1)
    const t0 = Date.now()
    // 아주 짧게. 이 문장은 캐시에 남아도 무해하고, 남으면 다음 기동은 더 빠르다.
    const tmp = await generateTTSWithRetry({ text: '준비', voice, rate, pitch })
    deleteTmpFile(tmp)
    log(`[기동준비] TTS 예열 완료 (${Date.now() - t0}ms)`)
    return true
  } catch (e) {
    log(`[기동준비] TTS 예열 실패(계속 진행): ${e.message}`)
    return false
  }
}

// ── **준비 중이라고 말할 수 있어야 한다** (사용자 지시 2026-09-16) ──────────────
// *"차라리 그러면 합성중이면 지금 설정중입니다. 잠시만 기다려주세요 이렇게 띄우던가"*
//
// 사용자가 원인을 정확히 짚었다: *"좀 뒤에 되니까 속도가 붙는것 같은데, 이거 뒤에서
// 백그라운드 뭐 설치하고 적용해야해서 늦는거 아니야?"* — 맞다. 갓 설치한 PC 의 첫 기동은
// **여기서 TTS 를 여덟 번 합성한다**(실측 2.1~2.6초씩, 합쳐서 18초 안팎). 그동안 파이썬이
// 계속 뜨고 지므로 화면도 같이 굼뜨다.
//
// **그 일을 없앨 수는 없다.** 미리 만들어 두지 않으면 정시 방송이 그만큼 늦어지고, 그것이
// 훨씬 비싸다. 없앨 수 없으면 **말이라도 해야 한다** — 말 없이 굼뜬 것은 고장으로 읽힌다.
const 준비상태 = { running: false, startedAt: null,단계: null }

/** 지금 기동 준비 중인가. `/api/health` 가 이 값을 그대로 내보낸다. */
function 준비중() {
  const pre = (() => { try { return require('./prerenderAuto').status() } catch { return null } })()
  return {
    running: 준비상태.running,
    단계: 준비상태.단계,
    // 남은 건수를 알면 화면이 "잠시"가 얼마나 될지 가늠해 줄 수 있다.
    remaining: pre?.running ? pre.remaining : 0,
    elapsedSec: 준비상태.startedAt ? Math.round((Date.now() - 준비상태.startedAt) / 1000) : 0,
  }
}

/**
 * 기동 준비 전체. index.js 가 **비동기로** 부른다 — 스케줄러가 먼저 뜬 뒤다.
 * 던지지 않는다.
 */
async function warmupThenPrerender(db, opts = {}) {
  const log = opts.log || console.log
  const t0 = Date.now()
  준비상태.running = true
  준비상태.startedAt = Date.now()
  준비상태.단계 = '연결 확인'
  try {
    // ── **이 PC 안에서 만드는 엔진이면 인터넷을 기다리지 않는다** (2026-09-21, Supertonic) ─────────
    // 이 순서(연결 확인 → 예열 → 선제 렌더)는 인터넷 합성을 전제로 한 것이다. 로컬 엔진은
    // 모델 적재가 예열이고 인터넷이 필요 없으므로 **먼저** 한다. 인터넷이 끝내 안 닿아도 일과방송 문안은
    // 만든다 — 날씨가 들어가는 아침 조각만 인터넷에 묶인다.
    // 맨 앞 엔진이 이 PC 안에서 만드는 것(Supertonic · 윈도우 음성)이면 로컬이다. Azure 는 인터넷을 탄다.
    const 로컬 = (() => { try { return ['supertonic', 'sapi'].includes(require('./tts').주엔진()) } catch { return false } })()
    let warmed = false
    if (로컬) { 준비상태.단계 = '음성 준비'; warmed = await warmupTTS(db, { log }) }

    준비상태.단계 = '연결 확인'
    const 닿았나 = await waitForNetwork(opts.network || 기본옵션, { log, ...(opts.deps || {}) })
    if (!닿았나 && !로컬) return { network: false, warmed: false, prerender: null }

    if (!로컬) { 준비상태.단계 = '음성 준비'; warmed = await warmupTTS(db, { log }) }

    // **아침 조각을 먼저 만든다.** 07:50 이 하루 중 가장 빠듯한 자리다(07:49 부팅).
    // 정적 4종은 그다음이다 — 가장 이른 것이 09:00 이라 여유가 있다.
    // 이것이 "부팅 승격"이다: T-10분(07:40)에 PC 가 꺼져 있어 창을 놓쳤으므로,
    // **그 시점 이후 최초로 가능한 순간**인 지금 만든다.
    준비상태.단계 = '아침 방송 문안 만들기'
    const morning = 닿았나 ? await prerenderMorningEarly(db, { log }) : null

    준비상태.단계 = '일과방송 문안 만들기'
    const result = await prerenderStatic(db, { log })
    result.morning = morning
    // 기동→준비완료 구간을 숫자로 남긴다. 현장에서 며칠 보고 여유가 충분한지 판단할 근거다.
    log(`[기동준비] 완료 — 총 ${Math.round((Date.now() - t0) / 1000)}초 `
      + `(네트워크 확인 + 예열 + 선제 렌더 ${result.made}건)`)
    return { network: 닿았나, warmed, prerender: result }
  } catch (e) {
    log(`[기동준비] 실패(방송에는 영향 없음): ${e.message}`)
    return { network: false, warmed: false, prerender: null, error: e.message }
  } finally {
    // **finally 여야 한다.** 성공 경로에만 내리면 네트워크가 없거나 예외가 난 PC 는
    // 영영 「준비 중」으로 남아, 화면이 안내를 못 걷는다.
    준비상태.running = false
    준비상태.단계 = null
  }
}

module.exports = { waitForNetwork, warmupTTS, warmupThenPrerender, 준비중, PROBE_URL, 기본옵션 }
