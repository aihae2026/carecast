// 1차 · 브라우저 로컬 모델(크롬 내장 Gemini Nano) — 감지와 호출.
//
// **왜 서버가 아니라 여기인가**: 크롬 Prompt API(`globalThis.LanguageModel`)는
// 브라우저 안에만 있다. 서버가 흉내 내려 하면 "어느 PC 의 로컬이냐"가 곧바로 문제가 된다 —
// 방송용 PC 와 관리자 PC 는 사양이 다르다(설계 문서 docs/flows/llm-fallback.md §B-2).
//
// **이 파일은 판정만 한다. 실패를 삼키지 않는다.** 안 되면 `ok:false` 와 사유를 돌려주고,
// 부른 쪽이 2차(서버 API)로 넘어간다. 여기서 던지면 화면이 빈손이 된다.
//
// 전역을 인자로 받는 이유: 브라우저 없이도 테스트할 수 있어야 한다.
// `globalThis` 를 직접 읽는 코드는 node 에서 한 줄도 못 돌린다.

/**
 * 로컬 모델 제한시간. **8초를 넘으면 그 PC 에서는 못 쓰는 것으로 본다.**
 * 로컬은 네트워크를 안 타므로 빨라야 정상이다 — 느리면 2차 API 가 오히려 빠르다.
 */
export const LOCAL_TIMEOUT_MS = 8000

/** 진단 결과를 이 브라우저에만 저장한다. PC 마다 사양이 다르므로 서버 전역에 두지 않는다. */
export const DIAG_STORAGE_KEY = 'carecast:localAi:diagnosis'

/**
 * 이 브라우저에 로컬 모델 경로가 있는가.
 * @returns {'unsupported'|'ok'} `unsupported` 면 크롬 138+ 가 아니거나 플래그가 꺼져 있다
 */
export function detectSupport(g = globalThis) {
  return g && typeof g.LanguageModel?.availability === 'function' ? 'ok' : 'unsupported'
}

/**
 * 우리가 필요한 출력 언어. **이것이 이 기능의 생사를 가른다.**
 *
 * 실측(2026-09-06, 사용자 크롬 콘솔): 언어를 안 정하고 부르면 크롬이 이렇게 경고한다 —
 *   "Please specify a supported output language code: [de, en, es, fr, ja]"
 * **`ko` 가 목록에 없다.** 그래도 답은 나오지만 쓸 수 없는 것이 나온다 —
 * `## 점심 배식 안내 (YYYY년 YYYY월 YYYY일)` 처럼 마크다운 제목과 빈칸 표시가 섞인다.
 * TTS 가 그걸 그대로 읽으면 어르신께 "샵샵 … 와이와이와이와이년"이 나간다.
 *
 * 그래서 **한국어가 지원되지 않으면 1차를 아예 안 켠다.** 느린 것이 문제가 아니라
 * 나오는 물건이 방송문이 아닌 것이 문제다.
 */
export const NEEDED_OUTPUT_LANGUAGE = 'ko'

/**
 * 이 브라우저가 **한국어 출력**을 지원하나.
 *
 * 목록을 코드에 박지 않는다 — 크롬이 나중에 한국어를 더하면 **이 함수가 저절로 참이 된다.**
 * 박아 두면 그날 아무도 안 고쳐서 영영 안 켜진다.
 */
export async function outputLanguageSupported(g = globalThis, lang = NEEDED_OUTPUT_LANGUAGE) {
  if (detectSupport(g) === 'unsupported') return false
  try {
    const v = await g.LanguageModel.availability({ outputLanguage: lang })
    // 못 쓰는 언어는 'unavailable' 이거나 아예 던진다. 둘 다 "안 된다"로 본다.
    return ['available', 'downloadable', 'downloading'].includes(v)
  } catch {
    return false
  }
}

/**
 * 모델이 쓸 수 있는 상태인가.
 * @returns {Promise<'unsupported'|'unavailable'|'downloadable'|'downloading'|'available'>}
 *          **던지지 않는다.** 예외는 `unavailable` 로 접는다 — 진단 화면이 빈손이 되면 안 된다.
 */
export async function availability(g = globalThis) {
  if (detectSupport(g) === 'unsupported') return 'unsupported'
  try {
    const v = await g.LanguageModel.availability()
    // 크롬 판올림으로 모르는 값이 오면 "없다"로 본다 — 모르는 값을 쓸 수 있다고 보면
    // 1차가 매번 실패하고 그만큼 사람이 기다린다.
    return ['unavailable', 'downloadable', 'downloading', 'available'].includes(v) ? v : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * **왜 못 쓰는지** 한 줄을 캐낸다. `unavailable` 일 때만 부른다.
 *
 * 이 확인이 필요한 이유(2026-09-06 실측): 이 PC 는 크롬 152 · RTX 2060 · RAM 16GB 로
 * 사전 요건을 전부 만족하는데도 `unavailable` 이었다. 거부 메시지는
 * "Unable to create a text session because the service is not running" 이었다 —
 * **하드웨어 문제가 아니라 크롬 구성요소가 안 받아진 것**이다. 요건 목록만 보여 주면
 * 사람은 자기 PC 사양을 의심하며 시간을 버린다.
 *
 * `downloadable` 일 때 부르면 4GB 내려받기가 시작되므로 **호출하는 쪽이 상태를 먼저 본다.**
 */
export async function probeUnavailableReason(g = globalThis) {
  if (detectSupport(g) === 'unsupported') return ''
  try {
    const s = await g.LanguageModel.create()
    s?.destroy?.()
    return ''
  } catch (e) {
    return String(e?.message || e)
  }
}

/**
 * 모델을 내려받는다(약 4GB). **관리자 화면에서 사람이 누를 때만 부른다** —
 * 방송용 PC 가 모르는 사이에 4GB 를 받는 일이 없어야 한다.
 *
 * @param {(ratio:number)=>void} onProgress 0~1
 * @returns {Promise<{ok:boolean, reason?:string}>} 던지지 않는다
 */
export async function downloadModel(onProgress, g = globalThis) {
  if (detectSupport(g) === 'unsupported') return { ok: false, reason: '이 브라우저에는 로컬 AI 경로가 없습니다.' }
  try {
    const session = await g.LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (typeof onProgress === 'function') onProgress(e.loaded ?? 0)
        })
      },
    })
    // 세션은 붙잡아 두지 않는다. 여기서 확인하려는 것은 "받아졌는가" 하나다.
    session?.destroy?.()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e?.message || '내려받기에 실패했습니다.' }
  }
}

// ── 첫 호출이 느린 문제와, 실패가 매번 8초를 더하는 문제 ────────────────
//
// 실측(2026-09-06): 로컬이 실패한 뒤 API 로 넘어가 **총 19초**가 걸렸다
// (로컬 제한시간 8초 + API 10.5초, [FACT] EV-000755). 사람이 버튼을 누르고 기다리는 자리다.
//
// 원인은 둘로 갈린다. 둘 다 손본다:
//  1. **첫 create() 가 느리다** — 모델을 메모리에 올리는 시간이다. 두 번째부터는 빠르다.
//     → 사람이 패널을 여는 순간 미리 한 번 만들어 버린다(warmup). 타자 치는 동안 끝난다.
//  2. **안 되는 PC 에서 매번 8초를 버린다** — 한 번 안 되면 대개 계속 안 된다.
//     → 연속 실패를 세어 두 번이면 그만 시도한다. "다시 진단"이 그 기록을 지운다.
//
// **미리 만든 세션을 재사용하지는 않는다.** 같은 세션에 계속 물으면 앞의 대화가 문맥으로
// 남아 다음 문구에 스며들고, 토큰 한도도 함께 찬다. 데우기는 만들고 곧바로 버린다 —
// 모델이 메모리에 올라간 것만 남으면 된다.

export const FAIL_STORAGE_KEY = 'carecast:localAi:fail'
/** 이만큼 연속 실패하면 그만 시도한다. 1이면 어쩌다 한 번에 꺼지고, 3이면 24초를 버린다. */
export const FAIL_LIMIT = 2

/** 마지막 실패 기록. 화면이 이걸 보여 주면 사람이 콘솔을 안 열어도 이유를 안다. */
export function lastFailure(storage = safeStorage()) {
  try {
    const raw = storage?.getItem(FAIL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function recordFailure(reason, storage = safeStorage()) {
  const 앞 = lastFailure(storage)
  const 기록 = { count: (앞?.count || 0) + 1, reason, at: new Date().toISOString() }
  try { storage?.setItem(FAIL_STORAGE_KEY, JSON.stringify(기록)) } catch { /* 편의값이다 */ }
  return 기록
}

/** 성공하면 지운다 — 어쩌다 한 번 실패한 PC 가 영영 안 쓰이면 안 된다. */
export function clearFailures(storage = safeStorage()) {
  try { storage?.removeItem(FAIL_STORAGE_KEY) } catch { /* 편의값이다 */ }
}

/** 계속 실패해서 그만 시도해야 하는 상태인가. */
export function localGivenUp(storage = safeStorage()) {
  return (lastFailure(storage)?.count || 0) >= FAIL_LIMIT
}

let 데웠나 = false

/**
 * 모델을 메모리에 올려 둔다. **사람이 AI 패널을 여는 순간** 부른다 —
 * 타자를 치는 동안 끝나므로 기다리는 시간이 0 이 된다.
 *
 * 한 번만 한다. 실패해도 조용하다 — 이건 준비일 뿐이고, 진짜 판정은 실제 호출이 한다.
 */
export async function warmupLocal(allowed, { g = globalThis, storage } = {}) {
  if (데웠나) return { ok: true, skipped: true }
  if (!localFirstEnabled(allowed, storage) || localGivenUp(storage)) return { ok: false, skipped: true }
  데웠나 = true
  const t0 = Date.now()
  try {
    // 실제 호출과 **같은 조건**으로 데운다 — 언어가 다르면 데운 것이 헛것이 된다
    const s = await g.LanguageModel.create({ outputLanguage: NEEDED_OUTPUT_LANGUAGE })
    // 만들자마자 버린다 — 문맥이 다음 문구에 스며들면 안 된다. 모델만 메모리에 남는다.
    s?.destroy?.()
    return { ok: true, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, reason: e?.message || '데우기 실패' }
  }
}

/** 테스트가 데우기 상태를 되돌릴 자리. 화면 코드는 부르지 않는다. */
export function _resetWarmup() { 데웠나 = false }

/**
 * 로컬 모델로 한 번 물어본다.
 *
 * @returns {Promise<{ok:true, text:string}|{ok:false, reason:string}>}
 *          **던지지 않는다.** 타임아웃·예외·빈 응답을 모두 `ok:false` 로 접는다 —
 *          부른 쪽은 사유를 로그에 적고 조용히 2차로 간다(사용자에게 묻지 않는다).
 */
export async function promptLocal(prompt, { timeoutMs = LOCAL_TIMEOUT_MS, g = globalThis } = {}) {
  if (detectSupport(g) === 'unsupported') return { ok: false, reason: '로컬 AI 경로 없음' }

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  try {
    const 시간초과 = new Promise((_, reject) => {
      timer = setTimeout(() => { ctrl?.abort(); reject(new Error(`로컬 제한시간 ${timeoutMs}ms 초과`)) }, timeoutMs)
    })
    const 본작업 = (async () => {
      // **출력 언어를 반드시 알린다.** 안 알리면 크롬이 경고만 남기고 아무 언어로나 만들어
      // 마크다운 제목이 섞인 물건이 나온다(2026-09-06 실측). 여기까지 왔다는 것은 진단에서
      // 한국어가 된다고 확인된 브라우저라는 뜻이다.
      const opts = { outputLanguage: NEEDED_OUTPUT_LANGUAGE }
      if (ctrl) opts.signal = ctrl.signal
      const session = await g.LanguageModel.create(opts)
      try {
        return await session.prompt(prompt, ctrl ? { signal: ctrl.signal } : {})
      } finally {
        session?.destroy?.()
      }
    })()

    const text = await Promise.race([본작업, 시간초과])
    // 공백만 있는 응답은 **성공으로 위장된 실패**다. 서버 게이트웨이와 같은 판정을 쓴다.
    if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, reason: '로컬이 빈 응답을 냈다' }
    return { ok: true, text: text.trim() }
  } catch (e) {
    return { ok: false, reason: e?.message || '로컬 호출 실패' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * **이 브라우저에서 1차를 시도해도 되는가.** 조건이 셋이고 **전부** 참이어야 한다.
 *
 *   허용(allowed) — 사람이 설정 화면에서 켰나. 서버 설정 `local_ai_enabled`
 *   가능(진단)    — 이 브라우저에 모델이 실제로 있나. localStorage 에 저장된 진단 결과
 *   한국어(ko)   — 그 모델이 **한국어를 낼 수 있나**. 이게 빠져 있어서 방송문 자리에
 *                  마크다운 제목이 나왔다(2026-09-06 실측). 위 NEEDED_OUTPUT_LANGUAGE 참고
 *
 * 왜 나눴나: 서버 설정 하나로만 두면 관리자 PC 에서 켠 것이 방송용 PC 에도 켜진다 —
 * 사양이 달라 그 PC 에서는 매번 1차가 실패하고 그만큼 사람이 기다린다.
 * 진단만 근거로 삼으면 **사람이 승인한 적 없는데** 모델이 도는 PC 가 생긴다.
 *
 * 진단을 한 번도 안 한 브라우저는 시도하지 않는다 — 매 호출마다 `availability()` 를
 * 부르면 그만큼 사람이 기다린다.
 */
export function localFirstEnabled(allowed, storage = safeStorage()) {
  const d = loadDiagnosis(storage)
  // `ko !== true` 를 조건에 넣었으므로, 이 필드가 없던 옛 진단 기록은 **자동으로 꺼진다.**
  // 그게 맞다 — 그 기록은 한국어를 확인해 보지 않고 저장된 것이다.
  return allowed === true && d?.status === 'available' && d?.ko === true
}

/**
 * 1차 · 로컬로 방송 문구를 만든다.
 *
 * **지침(systemPrompt)은 서버에서 받아 온 것을 그대로 넣는다.** 여기서 새로 쓰면
 * 로컬로 만든 문장과 API 로 만든 문장의 말투가 갈린다 — 같은 화면에서 두 말투가 섞인다.
 *
 * @returns {Promise<{ok:true,text:string}|{ok:false,reason:string}>} 던지지 않는다
 */
export async function generateLocal(situation, systemPrompt, opts = {}) {
  if (!localFirstEnabled(opts.allowed, opts.storage)) return { ok: false, reason: '로컬 1차 꺼짐' }
  // **계속 실패한 PC 에서는 아예 시도하지 않는다.** 안 그러면 그 PC 는 문구를 만들 때마다
  // 제한시간만큼(8초) 버리고 어차피 API 로 간다 — 실측에서 그것이 총 19초를 만들었다.
  if (localGivenUp(opts.storage)) {
    const 앞 = lastFailure(opts.storage)
    return { ok: false, reason: `로컬을 ${앞.count}번 연속 실패해 건너뜀 (${앞.reason})` }
  }
  const 지침 = (systemPrompt || '').trim()
  const 본문 = `키워드: ${situation}`
  const r = await promptLocal(지침 ? `${지침}\n\n${본문}` : 본문, opts)
  // 실패를 세고, 성공하면 지운다 — 어쩌다 한 번 실패한 PC 가 영영 안 쓰이면 안 된다.
  if (r.ok) clearFailures(opts.storage)
  else recordFailure(r.reason, opts.storage)
  return r
}

/**
 * 진단 결과를 이 브라우저에 남긴다. **못 써도 그냥 넘어간다** —
 * 사생활 보호 모드에서 localStorage 가 던지는데, 그것 때문에 화면이 죽으면 안 된다.
 */
export function saveDiagnosis(result, storage = safeStorage()) {
  try { storage?.setItem(DIAG_STORAGE_KEY, JSON.stringify({ ...result, at: new Date().toISOString() })) } catch { /* 진단은 편의값이다 */ }
}

export function loadDiagnosis(storage = safeStorage()) {
  try {
    const raw = storage?.getItem(DIAG_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function safeStorage() {
  try { return globalThis.localStorage } catch { return null }
}

/**
 * 사람이 읽을 상태 한 줄. **로그와 배지가 같은 말을 쓰게 한다** —
 * 화면이 따로 문구를 지으면 같은 상태가 두 가지 말로 보인다(경보에서 겪었다).
 */
export const AVAILABILITY_LABEL = {
  unsupported:  '이 브라우저는 로컬 AI 를 지원하지 않습니다',
  unavailable:  '이 PC 는 로컬 AI 를 쓸 수 없습니다',
  downloadable: '내려받으면 쓸 수 있습니다 (약 4GB)',
  downloading:  '내려받는 중입니다',
  available:    '준비 완료',
}

/** 진단 결과에 함께 보여 줄 사전 요건. 못 쓰는 이유를 사람이 스스로 짚을 수 있어야 한다. */
export const REQUIREMENTS = [
  '크롬 138 이상',
  '크롬 프로필이 있는 드라이브에 22GB 이상 여유',
  'GPU 메모리 4GB 초과, 또는 RAM 16GB 이상 + 4코어 이상',
  '종량제가 아닌 네트워크',
]

/** 플래그는 **코드로 못 켠다.** 주소를 복사해 주고 사람이 켜야 한다. */
export const FLAG_URLS = [
  'chrome://flags/#prompt-api-for-gemini-nano',
  'chrome://flags/#optimization-guide-on-device-model',
]

export const INTERNALS_URL = 'chrome://on-device-internals'

/** 모델 구성요소를 받는 자리. `unavailable` 의 가장 흔한 원인이 여기 "0.0.0.0" 으로 남아 있는 것이다. */
export const COMPONENTS_URL = 'chrome://components'
