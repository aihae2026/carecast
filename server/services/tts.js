// 안내 음성 합성 — 엔진 차례·캐시·재시도·지난 성공본 폴백의 **단일 입구**.
// 엔진은 `ttsEngines/` 에 있다(2026-09-21 사용자 지시): 기본 Supertonic 3(이 PC) · 선택 Azure · 마지막 대비
// 윈도우 기본 음성. 예전 인터넷 엔진(비공식 경로)은 2026-09-21 걷어냈다 — 그때 만든 mp3 캐시는
// 「지난 성공본」으로만 남아 모든 엔진이 실패한 날의 무음을 막는다(30일 청소로 저절로 사라진다).
// 파이썬 찾기는 여기 남는다 — 차임·서버 스피커(MCI)·마이크·받아쓰기가 이것을 쓴다.
const { execSync } = require('child_process')
// 기본 안내 음성 엔진(2026-09-21 사용자 지시). 엔진 차례는 아래 「엔진 차례」 절.
const supertonic = require('./ttsEngines/supertonic')
// 마지막 받침 — 윈도우 기본 한국어 음성(사용자 결정 2026-09-21: 브라우저 음성 대신 이것).
const sapi = require('./ttsEngines/sapi')
// 선택 엔진 — 키·지역을 넣은 기관만(설정 → API 연동).
const azure = require('./ttsEngines/azure')
// 합성 직전 읽기 다듬기(℃ → 도, ㎍/㎥ → 마이크로그램 …) — 소리에만 쓴다. 자막·열쇠 문안은 원문(domain/ttsReading.js).
const { 읽기다듬기, READING_REV } = require('../domain/ttsReading')
const 읽을것 = (params) => ({ ...params, text: 읽기다듬기(params.text) })
const path                = require('path')
const os                  = require('os')
const fs                  = require('fs')

// Windows에서 python 절대 경로 자동 감지
// ── **함께 묶어 온 파이썬을 먼저 본다** (사용자 지시 2026-09-16) ────────────────
// *"파이썬도 묶어"*
//
// 설치판에는 파이썬이 `runtime/python/` 에 함께 들어 있다. 그것을 **먼저** 보는 이유는
// 둘이다:
//   · 새로 설치한 PC 에는 파이썬이 아예 없다 — 있는 것을 찾는 순서로는 못 찾는다.
//   · 시스템에 다른 파이썬이 깔려 있어도, **우리가 필요한 모듈(numpy 등)을 미리 넣어 둔 것**은
//     이쪽이다. 남의 파이썬을 쓰면 차임·서버 스피커 재생이 안 될 수 있다.
//
// 소스로 받았거나 현장 PC 처럼 이 폴더가 없으면 **예전과 똑같이** 시스템에서 찾는다.
function 묶어온파이썬() {
  const 후보 = path.join(__dirname, '..', '..', 'runtime', 'python', 'python.exe')
  try { return fs.existsSync(후보) ? 후보 : null } catch { return null }
}

function findPython() {
  const 묶음 = 묶어온파이썬()
  if (묶음) {
    try {
      execSync(`"${묶음}" --version`, { stdio: 'pipe', timeout: 5000 })
      return 묶음
    } catch { /* 묶어 온 것이 못 돌면 시스템 것을 찾는다 */ }
  }
  const candidates = ['python', 'python3', 'py']
  for (const cmd of candidates) {
    try {
      const whereCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`
      const result   = execSync(whereCmd, { stdio: 'pipe', timeout: 5000 }).toString().trim()
      // Windows Store 스텁(WindowsApps) 제외 — 비대화형 실행 시 0xC0000142 오류 유발
      const paths = result.split(/\r?\n/)
        .map(p => p.trim())
        .filter(p => p && fs.existsSync(p) && !p.includes('WindowsApps'))
      for (const absPath of paths) {
        try {
          execSync(`"${absPath}" --version`, { stdio: 'pipe', timeout: 5000 })
          return absPath
        } catch { /* 다음 경로 시도 */ }
      }
    } catch { /* 다음 후보 시도 */ }
  }
  return null
}


// 서버 시작 시 Python 경로 확인(차임·서버 스피커가 첫 방송 때 찾느라 늦지 않게)
let PYTHON_PATH = null

// 못 찾은 결과도 잠깐은 기억한다(CC-034). 찾으면 PYTHON_PATH에 남아 다시 안 돌지만,
// 못 찾으면 매 방송(generateTTS)마다 후보 3개 × where/which(각 5초 타임아웃)를 동기로
// 되풀이해서 — 아침 종합방송이면 TTS 단계마다 — 이벤트 루프가 통째로 멎는다.
// 영원히 기억하지는 않는다: 나중에 파이썬을 설치한 PC가 재시작 없이 살아나야 한다.
const PYTHON_RETRY_MS = 1000 * 60 * 5
let pythonProbedAt = 0

function resolvePython() {
  if (PYTHON_PATH) return PYTHON_PATH
  if (pythonProbedAt && Date.now() - pythonProbedAt < PYTHON_RETRY_MS) return null
  pythonProbedAt = Date.now()
  PYTHON_PATH = findPython()
  return PYTHON_PATH
}

setImmediate(() => {
  try {
    PYTHON_PATH = resolvePython()
    if (PYTHON_PATH) {
      console.log(`[TTS] Python 경로: ${PYTHON_PATH}`)
    } else {
      console.warn('[TTS] Python을 찾을 수 없습니다.')
    }
  } catch (e) {
    // 부팅 시 1회 탐색이다. 실패해도 기동을 막지 않는다 — 실제 방송 때 다시 찾는다.
    console.warn('[TTS] Python 탐색 실패(기동은 계속):', e.message)
  }
})

// 한 번 합성할 때 기다릴 상한. 60초는 **걸림 방지**용 최후 방어선이고,
// 방송 경로는 그보다 훨씬 짧은 예산을 준다(아래 BROADCAST_BUDGET_MS 주석 참고).
const DEFAULT_TIMEOUT_MS = 60000

// 임시 파일 이름 조각. **밀리초만으로는 안 된다**(2026-09-03에 실제로 겪었다).
// os.tmpdir()는 온 프로세스가 함께 쓰는 곳이고, 같은 밀리초에 두 곳이 파일을 만들면
// 같은 경로가 나와 서로 덮어쓴다 — 그러면 A의 방송에 B의 음원이 실린다. 이 파일이
// "엉뚱한 문장을 대신 읽느니 건너뛰는 편이 낫다"고 적어 둔 그 사고가 이름 하나로 난다.
// 합본 테스트에서 캐시 폴백이 남의 파일을 읽어 빨간불이 났고(단독으론 통과), 그 실패가
// 이것을 물어왔다. 프로세스 번호 + 밀리초 + 난수 셋을 함께 쓴다.

function tmpName() {
  return `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ── 엔진 차례 (2026-09-21 사용자 지시: 기본 Supertonic · 선택 Azure · 최종 브라우저 음성) ─────────────
// 이 PC 에서 쓸 수 있는 엔진만 차례로 세운다. Supertonic 은 라이브러리·모델이 있을 때만 앞에 선다
// (없는 PC — 새 판을 당겨 왔는데 모델을 아직 안 받은 현장 — 에서도 방송은 나가야 한다).
// 시험 안에서는 엔진이 모두 스스로 빠진다(각 엔진 머리말) — 진짜 모델·PowerShell·인터넷을 안 부른다.
// **윈도우 음성은 맨 뒤**다 — 앞 엔진이 다 실패했을 때만(목소리 품질이 낮다). 무음보다는 낫다.
let 차례덮기 = null   // 시험 이음새(__setEngineOrderForTests) — 가짜 엔진으로 넘어가기를 본다
// ── 먼저 쓸 엔진 — 사람이 고른다 (사용자 지시 2026-09-22) ─────────────────────────────
// *"설정에서 토글로 TTS에 폴백구조이긴 하지만 지금이랑 azure 이거랑 선택할 수 있게 해줘야지"*
// 설정 `tts_engine_primary` 가 'azure' 면 Azure 를 맨 앞에 세운다(키가 없거나 인터넷 차단이면 저절로 빠진다).
// 그 밖에는 이 PC 의 Supertonic 이 맨 앞이다. **어느 쪽이든 뒤에 나머지가 서서 무음이 되지 않는다.**
const 엔진선택값 = ['supertonic', 'azure']
function 먼저쓸엔진() {
  try {
    const { getDB } = require('../db/schema')
    const v = require('../domain/settingsRead').rawSetting(getDB(), 'tts_engine_primary')
    return 엔진선택값.includes(v) ? v : 'supertonic'
  } catch { return 'supertonic' }   // DB 가 아직 없으면(시험·기동 직전) 기본값
}
// ── 이 PC 음성(Supertonic)의 화자 — 사람이 고른다(사용자 결정 2026-09-22, 기본 1) ─────────────
// 설정 `tts_supertonic_sid`(0~9). 방송 한 번에 **한 번** 읽어 params.sid 에 넣는다(generateTTSWithRetry 머리) —
// 캐시 열쇠를 셀 때와 합성할 때 따로 읽으면, 그 사이 사람이 바꿨을 때 새 목소리가 옛 열쇠 이름으로 저장된다.
function 현재화자() {
  try {
    const { getDB } = require('../db/schema')
    const v = require('../domain/settingsRead').rawSetting(getDB(), 'tts_supertonic_sid')
    return supertonic.화자정리(v === null || v === '' ? undefined : v)
  } catch { return supertonic.화자정리(undefined) }
}
// 문장 사이 쉼(ms, 0~2000, 기본 0 = 안 씀) — 화자처럼 방송 한 번에 **한 번** 읽어 params.쉼 에 넣는다(2026-09-22).
function 현재쉼() {
  try {
    const { getDB } = require('../db/schema')
    return require('../domain/ttsSentences').쉼정리(require('../domain/settingsRead').rawSetting(getDB(), 'tts_sentence_pause_ms'))
  } catch { return 0 }
}
function 엔진차례() {
  if (차례덮기) return 차례덮기()
  const 로컬 = supertonic.available() ? ['supertonic'] : []
  const 인터넷 = azure.available() ? ['azure'] : []
  const 앞 = 먼저쓸엔진() === 'azure' ? [...인터넷, ...로컬] : [...로컬, ...인터넷]
  return [...앞, ...(sapi.available() ? ['sapi'] : [])]
}
// 쓸 엔진이 하나도 없으면(모델 없는 맥 개발 PC 등) 캐시 열쇠는 **옛 mp3** 규칙이다 — 그때 기댈 것은 캐시뿐이다.
function 주엔진() { return 엔진차례()[0] ?? '옛mp3' }
// `옛mp3` 는 엔진이 아니라 **캐시 열쇠 규칙**이다: 걷어낸 옛 엔진이 남긴 mp3 를 지난 성공본으로 찾는 데만 쓴다.
const 엔진확장자 = { supertonic: 'wav', azure: 'wav', sapi: 'wav', 옛mp3: 'mp3' }
const 확장자 = (engine) => 엔진확장자[engine] || 'mp3'
// 파일이 어느 엔진 것인가 — 이름으로 안다. 윈도우 음성은 임시 이름에 `_sapi_` 가 들어간다(sapi.tmpOut).
// 그 밖의 wav 는 Supertonic, mp3 는 옛 캐시 규칙(합성기를 주입한 시험도 이 규칙을 탄다).
const 엔진of파일 = (file) => {
  const f = String(file)
  if (/carecast_sapi_[^\\/]*\.wav$/i.test(f)) return 'sapi'
  if (/carecast_azure_[^\\/]*\.wav$/i.test(f)) return 'azure'
  return /\.wav$/i.test(f) ? 'supertonic' : '옛mp3'
}

// 재생 응답의 형식. 파일 확장자로 정한다 — 예전엔 세 라우트가 audio/mpeg 를 박아 두었다.
const mimeOf = (file) => (/\.wav$/i.test(String(file)) ? 'audio/wav' : 'audio/mpeg')

// Supertonic 한 문장 → WAV + 자막 사이드카.
//
// **사이드카를 반드시 쓴다.** 이 엔진은 어절 시각을 안 준다. 사이드카가 빈 목록이면 예약 미리 만들기
// (`scheduler.scheduleAudioReady`)가 자막 줄이 없다고 「준비 안 됨」으로 읽어 **매 점검마다 다시 합성**한다
// (2026-09-21 구조 검토 Critical). 길이는 합성 결과로 정확히 알므로, 그 길이를 글자 수 비례로 나눈다.
async function generateSupertonicTTS(params, { timeoutMs, priority, handle } = {}) {
  const out = path.join(os.tmpdir(), `carecast_${tmpName()}.wav`)
  const r = await supertonic.synthesize(읽을것(params), {
    out, priority, handle, ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  })
  사이드카쓰기(r.file, params.text, r.durationSec, r.구간)
  return r.file
}

// 어절 시각을 안 주는 엔진(Supertonic · 윈도우 음성)의 자막 사이드카 — 소리 길이를 글자 수 비례로 나눈다.
// 구간(문장 사이 쉼을 넣었을 때 문장마다의 [시작, 끝] 초)이 오면 **문장별로** 나눈다 — 쉼 동안 자막이 앞서가지 않게.
// 원문을 같은 규칙(domain/ttsSentences)으로 나눠 수가 맞을 때만 쓴다. 안 맞으면(읽기 다듬기가 문장을 바꿨으면) 전체 비례.
function 사이드카쓰기(file, text, durationSec, 구간 = null) {
  try {
    const { wordsFromText } = require('../domain/captions')
    const 문장들 = Array.isArray(구간) ? require('../domain/ttsSentences').문장나누기(text) : []
    const words = 문장들.length > 1 && 문장들.length === 구간.length
      ? 문장들.flatMap((s, i) => (wordsFromText(s, 구간[i][1] - 구간[i][0]) || []).map(([a, b, w]) => [a + 구간[i][0], b + 구간[i][0], w]))
      : (wordsFromText(text, durationSec) || [])
    fs.writeFileSync(cuesPathOf(file), JSON.stringify(words), 'utf8')
  } catch (e) {
    console.warn('[TTS] 자막 사이드카를 못 썼다(소리는 정상):', e.message)
  }
}

// Azure 한 문장 → WAV + 자막 사이드카(어절 시각은 REST 로는 안 온다 — 길이 비례).
async function generateAzureTTS(params, { timeoutMs } = {}) {
  const r = await azure.synthesize(읽을것(params), {
    out: azure.tmpOut(tmpName()), ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  })
  사이드카쓰기(r.file, params.text, r.durationSec)
  return r.file
}

// 윈도우 음성 한 문장 → WAV + 자막 사이드카. 인터넷을 안 탄다.
async function generateSapiTTS(params, { timeoutMs } = {}) {
  const r = await sapi.synthesize(읽을것(params), {
    out: sapi.tmpOut(tmpName()), ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  })
  사이드카쓰기(r.file, params.text, r.durationSec)
  console.warn(`[TTS] 윈도우 기본 음성으로 대신 만들었다(앞 엔진이 모두 실패) — ${String(params.text ?? '').length}자`)
  return r.file
}

/**
 * 한 문장을 소리 파일로 — **엔진 차례대로** 시도한다. 앞 엔진이 실패하면 **같은 시도 안에서** 다음 엔진으로
 * 간다(재시도 3초를 기다리지 않는다 — 무음보다 다른 목소리가 낫다).
 * @returns {Promise<string>} 임시 파일 경로(.wav 또는 .mp3)
 */
// 뒤에 이 PC 엔진이 있을 때 인터넷 엔진(Azure)이 남겨 둘 몫 — Supertonic 한 문장(실측 1.4~3.4초)에 넉넉히.
const 로컬예비ms = 6000
// 뒤 엔진의 캐시에서 꺼낸 임시 파일 — 부르는 쪽이 다시 캐시에 저장하지 않게 표시한다(엔진을 이름으로 못 가린다).
const 캐시에서온 = new Set()

async function generateTTS(params, opts = {}) {
  // 한 방송은 **시작할 때의 차례**로 끝까지 간다(Codex ⑥ 1회차 Medium) — 합성 중에 사람이 먼저 쓸 엔진을
  // 바꿔도 열쇠·진행키·합성 엔진이 갈리지 않는다. 부르는 쪽(generateTTSWithRetry)이 넘긴다.
  const 차례 = Array.isArray(opts.차례) ? opts.차례 : 엔진차례()
  if (!차례.length) {
    const e = new Error('쓸 수 있는 안내 음성 엔진이 없다 — CareCast 폴더(맨 위)에서 npm run setup:tts 로 모델을 받거나 설정에서 Azure 키를 넣으세요')
    e.permanent = true
    throw e
  }
  // **예산은 엔진들이 나눠 쓴다** (Codex ④-a 1회차 High). 앞 엔진이 다 쓰고 실패했는데 다음 엔진에
  // 같은 몫을 다시 주면 40ms 예산이 88ms 가 된다 — 정시 방송의 상한이 무너진다.
  const 마감 = Number.isFinite(opts.timeoutMs) ? Date.now() + opts.timeoutMs : null
  // **영구 불가로 끝난 엔진은 이 방송에서 다시 부르지 않는다** (Codex ④-b 1회차 Medium). 재시도는 이
  // 함수를 다시 부르는데, 차례를 매번 새로 세우면 키가 틀린 Azure 를 시도마다 또 불렀다. 부르는 쪽
  // (generateTTSWithRetry)이 한 방송 동안 같은 `제외` 묶음을 넘긴다.
  const 제외 = opts.제외 instanceof Set ? opts.제외 : null
  let lastErr
  for (const [i, engine] of 차례.entries()) {
    if (제외?.has(engine)) continue
    // **맨 앞이 아닌 엔진은 캐시부터 본다** (Codex ⑥ 1회차 Medium). 고른 엔진(예: Azure)이 실패해 넘어온
    // 것이다 — 이 엔진으로 미리 만들어 둔 소리가 있으면 다시 합성하지 않는다(예약 준비가 만든 것을 쓴다).
    // 새로 만들라는 요청(noCache — 예약 준비)과 자막 없는 캐시는 건너뛴다(Codex ⑥ 2회차 Medium): 그 캐시를 꺼내면
    // 다시 합성·저장이 모두 생략돼 예약 준비가 영영 「자막 없음」 으로 실패한다.
    // 이 PC 음성이면 미리 만든 고음질판부터 본다(Codex 2026-09-22 Medium) — 준비 판정이 그것을 「준비됨」으로 세므로.
    const 뒤판 = engine === 'supertonic' && !params.고음질 && opts.cacheDir && !opts.noCache
      && fs.existsSync(cuesPathOf(cachePathFor({ ...params, 고음질: true }, opts.cacheDir, engine)))
      ? { ...params, 고음질: true } : params
    if (i > 0 && opts.cacheDir && !opts.noCache
        && fs.existsSync(cuesPathOf(cachePathFor(뒤판, opts.cacheDir, engine)))) {
      const c = copyFromCache(뒤판, opts.cacheDir, engine)
      if (c) {
        캐시에서온.add(c)
        console.warn(`[TTS] 앞 엔진 실패 — ${engine} 로 미리 만들어 둔 소리를 쓴다`)
        return c
      }
    }
    const 남음 = 마감 === null ? null : 마감 - Date.now()
    if (남음 !== null && 남음 <= 0) {
      lastErr = lastErr || new Error(`시간 예산(${opts.timeoutMs}ms) 초과`)
      break
    }
    // **인터넷 엔진이 예산을 다 쓰지 않게** (Codex ⑥ 1회차 High). Azure 를 먼저 쓰도록 고른 PC 에서 Azure 가
    // 응답을 안 하면 15초를 다 써서, 멀쩡한 이 PC 음성이 한 번도 불리지 않고 방송이 빠졌다.
    // 뒤에 이 PC 엔진이 있으면 그 몫(로컬예비ms)을 남긴다.
    let 몫 = 남음
    if (engine === 'azure' && 남음 !== null && 차례.slice(i + 1).some((e) => e !== 'azure' && !제외?.has(e))) {
      // 여유가 있으면 로컬 몫(로컬예비ms)을 남기고, 빠듯하면 남은 시간의 60% 만 쓴다 — 어느 쪽이든 **남은 시간보다
      // 작아** 뒤 엔진이 불린다(Codex ⑥ 2회차 Medium — 1초 남았는데 1.5초를 줘 로컬이 한 번도 안 불렸다).
      몫 = 남음 > 로컬예비ms + 1500
        ? Math.min(남음 - 로컬예비ms, Math.floor(남음 * 0.6))
        : Math.floor(남음 * 0.6)
    }
    const 이번 = 몫 === null ? opts : { ...opts, timeoutMs: 몫 }
    try {
      if (engine === 'supertonic') return await generateSupertonicTTS(params, 이번)
      if (engine === 'sapi') return await generateSapiTTS(params, 이번)
      if (engine === 'azure') return await generateAzureTTS(params, 이번)
      if (엔진덮기[engine]) return await 엔진덮기[engine](params, 이번)   // 시험의 가짜 엔진
      throw new Error(`모르는 엔진: ${engine}`)
    } catch (e) {
      lastErr = e
      if (e?.permanent && 제외) 제외.add(engine)
      if (차례.length > 1) console.warn(`[TTS] ${engine} 실패 — 다음 엔진으로: ${e.message}`)
    }
  }
  // 이번 방송에서 모든 엔진이 이미 영구 불가로 빠졌으면(재시도) 부른 엔진이 없다 — **undefined 를 던지지 않는다**
  // (Codex ④-d 1회차 High: 그러면 부르는 쪽의 지난 성공본 폴백이 TypeError 로 끊겼다).
  if (!lastErr) {
    lastErr = new Error('이번 방송에서 쓸 수 있는 안내 음성 엔진이 모두 실패했다')
    lastErr.permanent = true
  }
  throw lastErr
}

// 자막 사이드카 경로. mp3 옆에 같은 이름으로 붙여 둔다 — 임시 파일이든 캐시본이든 규칙이
// 하나여야 복사·삭제·청소를 한 군데서 맞출 수 있다.
const cuesPathOf = (mp3Path) => `${mp3Path}.cues.json`

// 임시 파일 삭제
function deleteTmpFile(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) }
  catch { /* 삭제 실패 시 무시 */ }
  // 자막 사이드카도 같이 지운다. 호출부(routes/audio.js)는 mp3만 아는데, 여기서 안 지우면
  // tmpdir에 고아 json이 방송할 때마다 하나씩 쌓인다.
  try { const c = cuesPathOf(filePath); if (fs.existsSync(c)) fs.unlinkSync(c) }
  catch { /* 삭제 실패 시 무시 */ }
}

/**
 * mp3 옆의 자막 사이드카를 읽어 화면이 쓸 cue로 만든다.
 * @param {string} mp3Path  generateTTS(WithRetry)가 돌려준 경로
 * @param {string} text     그 mp3가 읽은 원문 — 어절에서 떨어진 구두점을 되살리는 데 쓴다
 * @returns {object|null}   자막이 없거나 읽을 수 없으면 null(소리는 그대로 나간다)
 */
function readCues(mp3Path, text) {
  try {
    const raw = fs.readFileSync(cuesPathOf(mp3Path), 'utf8')
    return require('../domain/captions').wordsToLines(text, JSON.parse(raw))
  } catch {
    return null   // 자막이 없는 것은 방송 실패가 아니다 — 소리만 나가면 된다
  }
}

// 속도 배율 → 합성 인자 문자열 (예: 1.2 → "+20%"). 엔진들이 이 모양을 받는다(supertonic.speedFromRate · Azure prosody).
function rateToStr(rate) {
  if (!rate || rate === 1) return '+0%'
  const pct = Math.round((rate - 1) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

// 음높이 배율 → 합성 인자 문자열 (예: 1.1 → "+1Hz"). Azure prosody 만 쓴다(Supertonic·윈도우 음성은 높이 조절이 없다).
function pitchToStr(pitch) {
  if (!pitch || pitch === 1) return '+0Hz'
  const hz = Math.round((pitch - 1) * 10)
  return hz >= 0 ? `+${hz}Hz` : `${hz}Hz`
}

// 프로세스 **생성** 자체가 실패한 종료코드. Windows STATUS_DLL_INIT_FAILED(0xC0000142).
// Node는 같은 값을 부호 없는 3221225794로 줄 때도, 부호 있는 -1073741502로 줄 때도 있다.
//
// 왜 이것만 특별한가(ISSUE-003): 스크립트가 실패한 것이 아니라 **파이썬이 뜨질 못한 것**이다.
// 그 경로가 못 쓰게 됐다는 뜻이므로 다시 부른다고 나아지지 않는다 — 경로를 다시 찾아야 한다.
// 평범한 실패(1 등)는 여기 안 걸린다. 스크립트 오류까지 재탐색을 태우면 정상 경로를 흔든다.
function isDllInitFailure(code) {
  return code === 3221225794 || code === -1073741502
}

/**
 * 캐시된 파이썬 경로를 버린다. 다음 호출이 다시 찾는다.
 *
 * 왜 필요한가(ISSUE-003): resolvePython은 `if (PYTHON_PATH) return PYTHON_PATH`라 **한 번 고르면
 * 프로세스가 죽을 때까지 그 경로만 쓴다.** 그 경로가 못 쓰게 되면 재시작 전까지 영영 실패한다 —
 * "서버를 재시작하면 낫는다"는 증상이 정확히 이 구조에서 나온다(관측: 늙은 프로세스 3/3 실패,
 * 갓 뜬 프로세스 4/4 성공).
 *
 * **재탐색 유예(PYTHON_RETRY_MS, 5분)도 함께 푼다.** 안 그러면 캐시를 버려도 다음 호출이 5분간
 * null을 돌려준다 — 그 사이에 나가야 할 방송이 있다.
 *
 * @returns {boolean} 실제로 버렸으면 true. 버릴 것이 없었으면 false(로그가 거짓말하지 않게).
 */
function invalidatePythonPath(reason = '') {
  const 버릴것있음 = !!PYTHON_PATH
  if (버릴것있음) console.warn(`[TTS] 파이썬 경로를 버립니다: ${PYTHON_PATH} — ${reason}. 다음 호출에서 다시 찾습니다.`)
  PYTHON_PATH = null
  // 버릴 캐시가 없었어도 **유예는 푼다.** 이 함수의 뜻은 "지금 당장 다시 찾아라"이고,
  // 못 찾은 상태에서 5분을 더 기다리면 그 사이 나가야 할 방송이 그냥 죽는다.
  pythonProbedAt = 0
  return 버릴것있음
}

// audioQueue.js에서 Python 경로 공유 — 재탐색 없이 캐싱된 값 사용
const getPythonPath = () => PYTHON_PATH
// **부를 때 찾아 준다.** getPythonPath는 이미 찾아 둔 값만 돌려줘서, 아직 TTS를 한 번도
// 안 낸 서버에서는 null이다 — 자막 받아쓰기가 그 순간 "Python을 찾을 수 없습니다"로 죽었다.
const ensurePythonPath = () => resolvePython()

// ── 폴백 캐시 ──────────────────────────────────────────────────
//
// 왜 필요했나(2026-08-29 리뷰 CC-016): 예전엔 3번 실패하면 그냥 throw했다. 대체 음원도
// 사전 생성도 없어서, 인터넷이 끊긴 날엔 TTS 단계가 통째로 죽었다(첫 단계가 대개 TTS라
// 6회 방송 중 생존 0회였다).
//
// 그런데 이 시스템이 매일 읽는 문장은 대부분 고정 문구다 — 식사 안내, 투약 안내,
// 체조 안내. 어제 성공한 mp3를 남겨 두면 오늘 네트워크가 죽어도 같은 소리가 나간다.
//
// audioStore는 캐시가 아니다(30분 TTL 인메모리 + consumeAudio가 꺼내면서 지운다). 그래서
// 디스크에 따로 둔다. 문장·목소리·속도·피치가 하나라도 다르면 다른 키다 — 엉뚱한 음성이
// 나가느니 없는 게 낫다.
// 시험은 `CARECAST_TTS_CACHE_DIR` 로 임시 폴더를 준다 — 운영 캐시에 쓰고 읽으면 다음 실행이 합성 없이 통과한다.
const CACHE_DIR = process.env.CARECAST_TTS_CACHE_DIR || path.join(__dirname, '..', 'public', 'tts-cache')

// 열쇠는 **엔진마다 다르다.** 옛 mp3 규칙은 걷어낸 엔진의 열쇠를 글자 하나까지 그대로 쓴다(그 캐시를 지난 성공본으로 찾는다).
// Supertonic 은 정규화한 문안 + 엔진 소금(domain/ttsSynthesis) — 모델·화자·단계를 바꾸면 저절로 밀려난다.
// 엔진을 안 주면 **지금 맨 앞 엔진**이다. 그래서 Supertonic 이 켜진 PC 는 옛 mp3 소리를 캐시 적중으로 안 낸다
// (엔진을 바꿨는데 같은 목소리 이름으로 옛 mp3 가 계속 나가는 일이 없다 — 2026-09-21 조사 결론 1).
function cacheKeyFor(params, engine = 주엔진()) {
  // 소금 끝에 읽기 다듬기 판을 붙인다 — 읽기 규칙이 바뀌면 소리가 바뀌므로 옛 소리가 캐시에서 밀려난다.
  const 읽기 = `|읽기@${READING_REV}`
  // 화자는 params.sid(방송이 정한 값) → 없으면 지금 설정(준비 확인·미리 만들기도 같은 값을 얻는다).
  // 고음질(미리 만들기)은 단계가, 문장 사이 쉼은 꼬리가 열쇠를 가른다 — 둘 다 기본이면 예전 열쇠 그대로.
  if (engine === 'supertonic') return require('../domain/ttsSynthesis').cacheKeyFor(params, supertonic.소금(params.sid ?? 현재화자(), supertonic.단계of(params)) + supertonic.속도소금(params.rate) + supertonic.쉼소금(params.쉼 ?? 현재쉼()) + 읽기)
  if (engine === 'sapi') return require('../domain/ttsSynthesis').cacheKeyFor(params, sapi.SALT + 읽기)
  if (engine === 'azure') return require('../domain/ttsSynthesis').cacheKeyFor(params, azure.SALT + 읽기)
  const { text, voice, rate, pitch } = params
  return require('crypto').createHash('sha1')
    // 구분자는 NUL — 문장·목소리·속도 어디에도 나올 수 없어서 서로 다른 조합이 같은 키가
    // 되는 일이 없다. 소스에는 반드시 escape로 적는다: 실제 NUL 바이트를 파일에 넣으면
    // git이 이 파일을 바이너리로 취급해 git diff 사람 검토(CLAUDE.md 게이트 2)가 막힌다.
    .update([text, voice, rate, pitch].join('\u0000'))
    .digest('hex')
}

// 캐시 보관 기간. fileLog와 같은 30일이고 이유도 같다 — **디스크가 차면 SQLite 쓰기가
// 실패해 방송 기록 자체가 끊긴다.** 그런데 이 캐시는 로그보다 위험하다: 아침 종합 방송
// 문구에는 날씨와 날짜가 들어가서 **매일 새 키**가 생긴다. 무인 6개월 운영이면 지우는
// 주체 없이 계속 쌓이기만 한다(2026-08-30 재점검 CC-051).
//
// 30일이면 폴백의 목적은 그대로다 — 이 캐시는 "어제 성공한 소리를 오늘 다시 쓴다"는
// 것이지 영구 보관이 아니다. 매일 나가는 고정 문구(식사 안내·투약 안내)는 매일 다시
// 저장되므로 mtime이 갱신되어 지워지지 않는다.
const CACHE_KEEP_DAYS = 30

/**
 * keepDays보다 오래된 캐시 mp3를 지운다. 서버 기동 시 1회 부른다.
 * 실패해도 던지지 않는다 — 캐시 청소가 서버 기동을 막으면 본말전도다.
 * @returns {number} 지운 파일 수
 */
function pruneCache(dir = CACHE_DIR, keepDays = CACHE_KEEP_DAYS) {
  let removed = 0
  try {
    const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
    const names = fs.readdirSync(dir)
    const mp3s = new Set(names.filter((n) => /^[0-9a-f]{40}\.(mp3|wav)$/.test(n)))
    for (const name of names) {
      // 이 디렉터리는 우리가 만든 sha1 이름의 소리(mp3 · wav)와 그 자막 사이드카만 담는다.
      // 다른 파일은 손대지 않는다.
      if (!/^[0-9a-f]{40}\.(mp3|wav)(\.cues\.json)?$/.test(name)) continue
      const f = path.join(dir, name)
      // 짝 mp3가 사라진 자막은 나이와 상관없이 지운다. 소리가 없는 자막은 쓸 데가 없고,
      // 남겨 두면 다음 청소 때도 계속 살아남는다(사이드카는 mtime이 따로 논다).
      const orphan = name.endsWith('.cues.json') && !mp3s.has(name.slice(0, -'.cues.json'.length))
      try {
        if (orphan || fs.statSync(f).mtimeMs < cutoff) { fs.unlinkSync(f); removed++ }
      } catch { /* 다른 프로세스가 이미 지웠으면 무시 */ }
    }
  } catch { /* 디렉터리가 없으면 지울 것도 없다 */ }
  return removed
}

function cachePathFor(params, dir = CACHE_DIR, engine = 주엔진()) {
  return path.join(dir, `${cacheKeyFor(params, engine)}.${확장자(engine)}`)
}

/**
 * **지금 차례 안의 어느 엔진으로든** 소리+자막이 준비돼 있으면 그 캐시 경로, 없으면 null.
 * 예약 준비·즉시 렌더·선제 렌더가 「준비됨」을 가리는 데 쓴다(Codex ⑥ 1회차 Medium) — 고른 엔진(Azure)만 보면
 * 그것이 실패해 이 PC 음성으로 만들어 둔 것을 못 보고 **매 점검마다 다시 합성**했다.
 * 방송 때는 고른 엔진이 먼저 시도되고, 실패하면 generateTTS 가 이 캐시를 꺼내 쓴다.
 */
// `경로` 는 엔진 → 캐시 경로. 부르는 쪽이 **자기가 쥔 cachePathFor** 를 넘긴다 — 시험이 모듈의 cachePathFor 를
// 임시 폴더용으로 바꿔 끼우는데, 여기서 안쪽 함수를 직접 부르면 그 바꿔 끼운 것을 비켜 간다.
// `자막` 도 같은 이유로 부르는 쪽 것을 쓴다. 크기 하한은 부르는 쪽이 본다(예약 준비만 본다 — 예전과 같다).
function 준비된캐시(params, 경로 = (engine) => cachePathFor(params, CACHE_DIR, engine), 자막 = cuesPathOf) {
  for (const engine of [...엔진차례(), '옛mp3']) {
    try {
      const p = 경로(engine)
      if (fs.existsSync(p) && fs.existsSync(자막(p))) return p
    } catch { /* 다음 엔진 */ }
  }
  return null
}

// 성공분 보관. 실패해도 이번 방송에는 영향을 주지 않는다.
function saveToCache(params, file, dir) {
  try {
    // 잘린 결과를 캐시에 넣으면 그 무음이 매일 나간다 — 넣지 않는다
    if (fs.statSync(file).size < 최소바이트(file)) {
      console.warn('[TTS] 결과가 너무 작아 캐시에 넣지 않습니다(이번 방송은 정상 진행)')
      return
    }
    fs.mkdirSync(dir, { recursive: true })
    // 만든 엔진의 열쇠로 둔다(확장자가 곧 엔진이다).
    const cached = cachePathFor(params, dir, 엔진of파일(file))
    fs.copyFileSync(file, cached)

    // 자막 사이드카도 같은 키로 짝지어 둔다. 이게 없으면 캐시로 재생되는 고정 문구
    // (식사 안내·투약 안내)는 소리는 나는데 **자막만 영영 안 나온다.**
    //
    // 파이썬이 못 남겼으면 여기서 빈 목록을 만든다. 파일 자체가 없으면 아래 hasCues가
    // "아직 안 만들어 봤다"로 읽어 매번 다시 합성하고, 그러면 그 문장은 캐시를 못 탄다.
    try {
      const src = cuesPathOf(file)
      if (!fs.existsSync(src)) fs.writeFileSync(src, '[]', 'utf8')
      fs.copyFileSync(src, cuesPathOf(cached))
    } catch (e) {
      console.warn('[TTS] 자막 저장 실패(소리는 정상):', e.message)
    }
  } catch (e) {
    console.warn('[TTS] 캐시 저장 실패(이번 방송은 정상 진행):', e.message)
  }
}

// 빈 파일·잘린 파일을 캐시로 쓰지 않기 위한 하한. 합성기가 0바이트를 남기고 죽으면
// 그걸 캐시에 넣는 순간 **매일 그 무음이 나간다.**
//
// 512바이트로 잡은 이유: 실제 안내문 한 줄은 mp3로 수십 KB지만, "네"처럼 아주 짧은 응답도
// 1KB 안팎이 나온다. 하한을 높게 잡으면 **멀쩡한 짧은 음성을 캐시에서 밀어내** 매번 다시
// 합성하게 된다. 0바이트·몇 바이트짜리 쓰레기만 걸러내면 목적은 달성된다.
const MIN_CACHE_BYTES = 512
// WAV 는 머리만 44바이트이고 몇 ms 짜리도 512 를 넘는다 — **길이로** 거른다: 0.2초(44100Hz·16bit·모노).
// 합성이 빈 소리를 내면 그 무음이 캐시에 들어가 매일 나간다(2026-09-21 구조 검토 Medium).
const MIN_WAV_BYTES = 44 + Math.round(44100 * 2 * 0.2)
const 최소바이트 = (file) => (/\.wav$/i.test(String(file)) ? MIN_WAV_BYTES : MIN_CACHE_BYTES)

// 캐시본을 임시 파일로 **복사해서** 준다. 호출부가 재생 후 deleteTmpFile로 지우기 때문에
// 원본 경로를 그대로 주면 다음날 캐시가 사라져 또 무음이 된다.
function copyFromCache(params, dir, engine = 주엔진()) {
  try {
    const cached = cachePathFor(params, dir, engine)
    if (!fs.existsSync(cached)) return null
    if (fs.statSync(cached).size < 최소바이트(cached)) return null   // 잘린 캐시는 없는 셈 친다
    // **쓸 때마다 나이를 되돌린다.** 30일 청소(pruneCache)는 mtime을 보는데, 캐시로만
    // 재생하면 파일이 다시 저장되지 않아 매일 쓰는 고정 문구가 30일째에 지워진다.
    try { fs.utimesSync(cached, new Date(), new Date()) } catch { /* 못 만져도 재생엔 지장 없다 */ }
    const tmp = path.join(os.tmpdir(), `carecast_cached_${tmpName()}.${확장자(engine)}`)
    fs.copyFileSync(cached, tmp)
    // 자막도 같이 꺼낸다. mp3만 복사하면 캐시로 나가는 방송은 자막이 없다.
    try {
      const cachedCues = cuesPathOf(cached)
      if (fs.existsSync(cachedCues)) {
        fs.utimesSync(cachedCues, new Date(), new Date())
        fs.copyFileSync(cachedCues, cuesPathOf(tmp))
      }
    } catch { /* 자막을 못 꺼내도 소리는 나간다 */ }
    return tmp
  } catch {
    return null
  }
}

// 음성 하나를 얻는 **단일 입구**. 캐시 우선 → 없으면 합성(3회 재시도) → 그래도 안 되면
// 지난 성공본 폴백.
//
// 왜 캐시를 먼저 보나(2026-09-03, 사용자 신고 "12:00 예약인데 12:01에 나온다"):
// 예약 발사는 정시인데 **소리는 합성이 끝나야** 난다. 이 PC 실측으로 문장 하나에 2.4~3.2초,
// 현장은 회선이 느려 더 걸리고 실패하면 재시도·타임아웃까지 붙는다. 그런데 이 시스템이
// 읽는 문장은 대부분 매일 같다(환기·투약·식사 안내·체조). 같은 문장·목소리·속도·피치면 소리도
// 같으니 다시 만들 이유가 없다 — 캐시가 있으면 **합성을 아예 건너뛰고** 정시에 나간다.
//
// 날씨·날짜가 들어가는 아침 방송은 매일 키가 달라 캐시가 안 맞는다. 그쪽은 미리 만들어
// 두는 방식(2번 갈래)이 받는다.
//
// opts는 테스트 이음새 — 운영 경로는 기본값을 쓴다. opts.noCache면 캐시를 건너뛴다.
// **방송 경로의 시간 예산.** 정시에 나가는 것이 이 시스템의 일이라, 소리를 못 만들면
// 오래 기다리는 것보다 **어제 소리(캐시)로 내보내거나 실패를 알리는 편이 낫다.**
//
// 왜 필요했나(2026-09-03): 이날 모든 경로를 재시도 래퍼로 돌리면서, 캐시가 없고 회선이
// 막히면 60초×3회+대기로 **3분 넘게** 기다릴 수 있게 됐다(그전에는 60초 뒤 그냥 실패였다).
// 그동안 같은 분의 다른 예약도 뒤에서 밀린다 — 발사가 순차이기 때문이다.
// 현장 실측은 1.4~4.2초다. 15초면 평소의 서너 배라 정상 경로는 절대 안 걸린다.
const BROADCAST_BUDGET_MS = 15000

// 지금 합성 중인 문장 — 열쇠(캐시 폴더|문장·목소리·빠르기·높낮이) → 그 합성의 약속. 같은 문장을 겹쳐 만들지 않게 한다.
const 합성중 = new Map()

async function generateTTSWithRetry(params, retries = 3, opts = {}) {
  // 이 방송의 Supertonic 화자 — **한 번 정해** 열쇠·진행키·합성·캐시 저장이 같은 값을 본다(위 현재화자 머리말).
  // 다른 엔진은 sid 를 안 읽는다(열쇠에도 안 들어간다 — domain/ttsSynthesis.cacheKeyFor).
  params = { ...params, sid: supertonic.화자정리(params?.sid ?? 현재화자()), 쉼: require('../domain/ttsSentences').쉼정리(params?.쉼 ?? 현재쉼()) }
  const generate = opts.generate || generateTTS
  const cacheDir = opts.cacheDir || CACHE_DIR
  // 예산을 준 경우, **남은 시간이 곧 이번 시도의 상한**이다. 안 그러면 첫 시도가 60초를
  // 다 쓰고 나서야 예산 초과를 알게 된다.
  const deadlineAt = Number.isFinite(opts.deadlineMs) ? Date.now() + opts.deadlineMs : null
  // 이 방송의 엔진 차례 — **한 번 잡아 끝까지 쓴다**(열쇠·진행키·합성이 같은 엔진을 본다, Codex ⑥ 1회차).
  const 차례 = 엔진차례()
  const 앞 = 차례[0] ?? '옛mp3'

  // 자막이 딸리지 않은 옛 캐시는 **한 번만** 미스로 친다. 안 그러면 매일 나가는 고정 문구는
  // copyFromCache가 mtime을 되돌려 30일 청소에도 안 걸리므로, 소리는 나는데 자막이 영원히
  // 안 붙는다. 다시 만들다 실패해도 아래 폴백이 같은 캐시본을 집어 주므로 최악이 "그 문장
  // 첫 회에 합성 시간(현장 실측 1.4~4.2초)이 붙는 것"이다.
  const hasCues = (() => {
    try { return fs.existsSync(cuesPathOf(cachePathFor(params, cacheDir, 앞))) }
    catch { return false }
  })()

  // ── **얼마나 걸렸는지 남긴다** (사용자 신고 2026-09-16) ──────────────────────
  // *"방송이 나가긴 나가는데 한참 뒤에 나간다"* — 그런데 **합성 시간이 어디에도 안
  // 찍히고 있었다.** 발사는 정시이므로 늦는 것은 거의 언제나 여기다. 숫자가 없으면
  // 「느린 것 같다」에서 더 나아갈 수가 없어서, 로그가 스스로 답하게 만든다.
  //
  // **갓 설치한 PC 가 제일 느리다.** 캐시(`server/public/tts-cache`)가 비어 있어 모든
  // 문장을 그 자리에서 합성해야 하고, 방송 경로의 예산은 15초다(`BROADCAST_BUDGET_MS`).
  // 현장 실측 1.4~4.2초가 느린 기기에서 그 예산을 넘으면 **소리가 늦거나 아예 빠진다.**
  //
  // **문안은 안 적는다.** 방송 문안에는 어르신 이름이 들어가는 것이 실제로 있다
  // (생신 안내). 글자 수와 캐시 열쇠 앞자리만 적으면 같은 문장인지 가리는 데 충분하다.
  const 잰시작 = Date.now()
  const 열쇠 = (() => { try { return cacheKeyFor(params, 앞).slice(0, 8) } catch { return '????????' } })()
  const 몇글자 = String(params?.text ?? '').length

  // **미리 만들어 둔 고음질판이 있으면 그것부터** (2026-09-22). 방송 경로는 고음질을 따로 청하지 않는다 —
  // 있으면 쓰고, 없으면 아래 보통 캐시·보통 합성(빠른 단계)으로 간다. 그래서 급한 방송이 느려지지 않는다.
  if (!opts.noCache && !params.고음질 && 앞 === 'supertonic') {
    try {
      const 고 = { ...params, 고음질: true }
      if (fs.existsSync(cuesPathOf(cachePathFor(고, cacheDir, 앞)))) {
        const c = copyFromCache(고, cacheDir, 앞)
        if (c) { console.log(`[TTS] 캐시 적중 ${열쇠} (${몇글자}자, 고음질) — 합성 건너뜀, ${Date.now() - 잰시작}ms`); return c }
      }
    } catch { /* 보통 캐시로 */ }
  }

  if (!opts.noCache && hasCues) {
    const cached = copyFromCache(params, cacheDir, 앞)
    if (cached) {
      console.log(`[TTS] 캐시 적중 ${열쇠} (${몇글자}자) — 합성 건너뜀, ${Date.now() - 잰시작}ms`)
      return cached
    }
  }
  // ── **같은 문장을 동시에 두 번 합성하지 않는다** (2026-09-18 노트북 로그) ────────────────
  // 「지금 방송」 카드가 음성을 미리 만드는 중에 단추를 누르면, 방송 쪽이 그것을 모르고 **처음부터 한 번 더**
  // 합성했다(로그: 같은 열쇠 「캐시 없음」 두 줄, 둘 다 47~50초). 느린 회선에서는 요청만 두 배가 된다.
  // 이미 만드는 중이면 **그것이 끝나기를 기다렸다가 캐시에서 꺼내 쓴다.** 앞 합성이 실패했거나 이 호출의
  // 시간 예산이 먼저 다 되면 기다림을 멈추고 아래에서 직접 만든다(기다리다 방송을 놓치지 않는다).
  //
  // **기다림에는 예산의 절반까지만 쓴다** (적대적 검수 2026-09-18). 처음엔 남은 예산을 통째로 걸었는데,
  // 그러면 기다림이 헛돌고 나서 `직접합성` 의 첫 줄이 곧바로 「예산 초과」로 빠져나간다 — **한 번도
  // 시도하지 않고 포기**하는 것이라, 「기다리다 방송을 놓치지 않는다」고 적어 둔 바로 그 일이 났다.
  // 느린 요청 하나가 막혀 있어도 새 연결은 빠른 경우가 있으므로, 내 몫을 남겨 둔다.
  const 진행키 = opts.noCache ? null : (() => { try { return `${cacheDir}|${cacheKeyFor(params, 앞)}` } catch { return null } })()
  // 이 문장의 합성 순위 손잡이 — 합성기(Supertonic 줄)가 읽고, 나중에 합류한 더 급한 호출이 올린다.
  const 순위 = { priority: Number.isFinite(opts.priority) ? opts.priority : 1 }
  // 이 방송 동안 영구 불가로 끝난 엔진(재시도에서 다시 안 부른다 — generateTTS).
  const 제외 = new Set()
  if (진행키 && 합성중.has(진행키)) {
    // **더 급한 방송이 합류하면 앞 합성의 순위를 올린다** (Codex ④-a 1회차 High). 미리 만들기(0)가 줄에서
    // 기다리는 문장에 비상(2)이 합류했는데 순위가 그대로면, 비상이 일반 방송 뒤로 밀렸다.
    합성중.get(진행키).올리기?.(순위.priority)
    console.log(`[TTS] 같은 문장을 이미 만드는 중 ${열쇠} (${몇글자}자) — 새로 합성하지 않고 기다린다`)
    // **예산이 없어도 무한정 기다리지 않는다** (적대적 검수 2026-09-18). 사람이 누르는 즉시 방송
    // (`routes/tts.js` 의 `/broadcast`)은 예산을 안 준다. 그런데 앞 합성이 재시도까지 다 쓰고
    // 실패하면 최대 3분이 넘는다 — 그동안 화면은 응답을 못 받아 멎은 것처럼 보이고, 사람은 다시
    // 누른다. 방송 한 건에 쓰는 시간(`BROADCAST_BUDGET_MS`)을 넘겨 기다릴 이유가 없으므로 거기서 끊고
    // 직접 만든다. 흔한 경우(2~3초)에는 그대로 같이 쓰므로 합치기의 값은 그대로다.
    const 남은 = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : null
    const 기다릴몫 = 남은 === null ? BROADCAST_BUDGET_MS : Math.floor(남은 / 2)
    let 시한 = null
    const 기다림 = [합성중.get(진행키).catch(() => {})]
    기다림.push(new Promise((r) => { 시한 = setTimeout(r, 기다릴몫) }))
    await Promise.race(기다림)
    if (시한) clearTimeout(시한)   // 남은 타이머가 프로세스를 붙잡지 않게
    const 같이씀 = copyFromCache(params, cacheDir, 앞)
    if (같이씀) {
      console.log(`[TTS] 먼저 만든 것을 같이 씀 ${열쇠} (${몇글자}자) — ${Date.now() - 잰시작}ms 기다림`)
      return 같이씀
    }
  }
  const 직접합성 = async () => {
    console.log(`[TTS] 캐시 없음 ${열쇠} (${몇글자}자) — 지금 합성한다`
      + (opts.deadlineMs ? ` · 예산 ${Math.round(opts.deadlineMs / 1000)}초` : ''))

    let lastErr
    // **몇십 ms 남은 예산으로는 다시 부르지 않는다** (2026-10-07). 시도가 예산 끝 직전에 실패하면(타이머가 조금
    // 일찍 울리는 경우) 남은 예산이 「15ms」 같은 값이 되어, 될 리 없는 시도를 또 부르고 「예산 초과」 기록도 안 남겼다
    // (tts-budget 시험이 전체 verify 에서만 가끔 빨갰던 원인). 합성은 현장 실측 1.4초 이상이라 이보다 짧으면 시도할 이유가 없다.
    const 최소시도ms = 200
    for (let i = 0; i < retries; i++) {
      const left = deadlineAt ? deadlineAt - Date.now() : null
      if (left !== null && (left <= 0 || (i > 0 && left < 최소시도ms))) {
        lastErr = lastErr || new Error(`시간 예산(${Math.round(opts.deadlineMs / 1000)}초) 초과`)
        console.warn('[TTS] 시간 예산 초과 — 더 기다리지 않는다:', lastErr.message)
        break
      }
      try {
        const 한번시작 = Date.now()
        const file = await generate(params, {
          ...(left === null ? {} : { timeoutMs: left }),
          priority: 순위.priority, handle: 순위, 제외, 차례, cacheDir, noCache: !!opts.noCache,
        })
        const 걸림 = Date.now() - 한번시작
        // 뒤 엔진의 캐시에서 꺼낸 것은 이미 캐시에 있다 — 다시 넣지 않는다(이름으로는 엔진을 못 가린다).
        if (!캐시에서온.delete(file)) saveToCache(params, file, cacheDir)
        // **느린 합성은 경고로 올린다.** 현장 실측이 1.4~4.2초라, 8초를 넘으면 그 PC 에서는
        // 예산(15초)이 위태롭다는 뜻이고 다음 방송도 같은 값을 낸다 — 사람이 볼 수 있어야 한다.
        const 줄 = `[TTS] 합성 완료 ${열쇠} (${몇글자}자) ${걸림}ms`
          + (i > 0 ? ` · ${i + 1}번째 시도` : '') + ` · 총 ${Date.now() - 잰시작}ms`
        if (걸림 >= 8000) console.warn(`${줄}  ← 느리다. 이 PC 에서는 정시 송출이 위태롭다`)
        else console.log(줄)
        return file
      } catch (err) {
        lastErr = err
        // 남은 예산이 backoff보다 적으면 기다릴 이유가 없다 — 곧바로 폴백으로 간다
        const remain = deadlineAt ? deadlineAt - Date.now() : null
        if (i < retries - 1 && (remain === null || remain > 3000)) {
          console.warn(`[TTS] 생성 실패 (${i + 1}/${retries}회), 3초 후 재시도… ${err.message}`)
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }

    // **어느 엔진 것이든** 지난 성공본을 쓴다 — 다른 목소리라도 무음보다 낫다(2026-09-21 구조 검토).
    // 맨 앞 엔진 것을 먼저 본다.
    let fallback = null
    for (const engine of [앞, ...Object.keys(엔진확장자)]) {
      fallback = copyFromCache(params, cacheDir, engine)
      if (fallback) break
    }
    // **다른 목소리(화자)의 지난 성공본도** 마지막으로 본다(2026-09-22 코드 검수·QA). 목소리를 바꾼 직후에는
    // 새 화자 열쇠의 성공본이 하나도 없어, 합성이 실패하면 옛 목소리 소리가 캐시에 있는데도 무음이 됐다.
    // 기본(1)부터, 그다음 나머지 — 다른 목소리라도 무음보다 낫다(위와 같은 원칙).
    // 같은 목소리의 다른 판(고음질·쉼 없는 판)도 본다 — 쉼을 바꾼 직후에는 새 열쇠 성공본이 없다.
    if (!fallback) {
      for (const 판 of [{ 고음질: true }, { 쉼: 0 }, { 쉼: 0, 고음질: true }]) {
        fallback = copyFromCache({ ...params, ...판 }, cacheDir, 'supertonic')
        if (fallback) { console.warn(`[TTS] ${열쇠} — 이 설정의 성공본이 없어 같은 목소리의 다른 판으로 대신합니다`); break }
      }
    }
    if (!fallback) {
      const 지금화자 = params.sid
      for (const 다른 of [1, 0, 2, 3, 4, 5, 6, 7, 8, 9].filter(s => s !== 지금화자)) {
        fallback = copyFromCache({ ...params, sid: 다른 }, cacheDir, 'supertonic')
        if (fallback) { console.warn(`[TTS] ${열쇠} — 고른 목소리(${지금화자}번) 성공본이 없어 ${다른}번 목소리 성공본으로 대신합니다`); break }
      }
    }
    if (fallback) {
      console.warn(`[TTS] 생성 실패 ${열쇠} — 지난번 성공본으로 대체합니다`
        + ` (${Date.now() - 잰시작}ms 썼다): ${lastErr?.message}`)
      return fallback
    }
    // 여기까지 왔으면 **소리가 없다.** 갓 설치한 PC 에서 가장 흔한 자리다 — 캐시가 비어
    // 있으니 대체할 지난번 소리도 없다. 얼마나 기다리다 포기했는지를 남긴다.
    console.error(`[TTS] 소리를 못 만들었다 ${열쇠} (${몇글자}자) — ${Date.now() - 잰시작}ms 뒤 포기`
      + `, 대체할 캐시도 없음: ${lastErr?.message}`)

    // 캐시도 없으면 그대로 던진다. 없는 소리를 지어내지 않는다 —
    // 엉뚱한 문장을 대신 읽느니 그 단계를 건너뛰는 편이 낫다(broadcastSequencer의 단계 격리가 받는다).
    throw lastErr
  }
  const 작업 = 직접합성()
  if (진행키 && !합성중.has(진행키)) {
    작업.올리기 = (q) => {
      if (!(Number(q) > 순위.priority)) return
      순위.priority = Number(q)   // 다음 재시도도 이 순위로 선다
      순위.raise?.(Number(q))     // 지금 줄에서 기다리는 일도 올린다
    }
    합성중.set(진행키, 작업)
    작업.then(() => {}, () => {}).finally(() => { if (합성중.get(진행키) === 작업) 합성중.delete(진행키) })
  }
  return 작업
}

// 시험 이음새 — 엔진 차례를 바꿔 끼우고, 이름 자리에 가짜 합성기를 넣는다(진짜 모델·인터넷을 안 부른다).
const 엔진덮기 = {}
function __setEngineOrderForTests(fn, 가짜 = {}) {
  차례덮기 = fn || null
  for (const k of Object.keys(엔진덮기)) delete 엔진덮기[k]
  Object.assign(엔진덮기, 가짜)
}

// 화면 표시용 — 엔진마다 쓸 수 있나(설정 → API 연동의 「안내 음성 엔진」 카드).
function 엔진상태() {
  const 차례 = 엔진차례()
  const 목록 = [
    { name: 'supertonic', label: 'Supertonic 3 (이 PC · 기본)', ok: 차례.includes('supertonic'),
      reason: 차례.includes('supertonic') ? null : supertonic.unavailableReason() },
    { name: 'azure', label: 'Azure 음성 (선택)', ok: 차례.includes('azure'),
      reason: 차례.includes('azure') ? null : (azure.상태().keySet ? '인터넷 차단 모드이거나 지역이 비어 있습니다' : '키를 넣지 않았습니다') },
    { name: 'sapi', label: '윈도우 기본 음성 (마지막 대비)', ok: 차례.includes('sapi'),
      reason: 차례.includes('sapi') ? null : '이 PC 에 윈도우 한국어 음성이 없습니다' },
  ].map((e) => ({ ...e, order: 차례.indexOf(e.name) }))
  return 목록
}

module.exports = { generateTTS, generateTTSWithRetry, mimeOf, 주엔진, 엔진차례, 엔진상태, 먼저쓸엔진, 엔진선택값, 준비된캐시, MIN_WAV_BYTES, __setEngineOrderForTests, readCues, cuesPathOf, MIN_CACHE_BYTES, BROADCAST_BUDGET_MS, DEFAULT_TIMEOUT_MS, deleteTmpFile, rateToStr, pitchToStr, getPythonPath, ensurePythonPath, invalidatePythonPath, isDllInitFailure, cacheKeyFor, cachePathFor, pruneCache, CACHE_DIR, CACHE_KEEP_DAYS }
