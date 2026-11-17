// Supertonic 3 — **기본 안내 음성 엔진** (사용자 지시 2026-09-21: 기본 Supertonic · 선택 Azure · 최종 브라우저 음성).
//
// 이 PC 안에서(CPU) 합성한다 — 인터넷이 끊겨도 소리가 난다. 합성은 `supertonicWorker.js`(fork)가 하고,
// 여기는 **줄 세우기·시간 상한·다시 띄우기**만 한다(동기 합성이 서버를 멈추지 않게 — 그 파일 머리말).
//
// ── 「못 쓴다」와 「이번에 실패」를 가른다 ──────────────────────────────────────────
// 라이브러리(sherpa-onnx-node)나 모델 파일이 없으면 **영구 불가**(`err.permanent = true`)로 알린다.
// 호출부(tts.js)는 그러면 재시도(3회 · 3초 대기)를 태우지 않고 **곧바로 다음 엔진**으로 넘어간다.
// 현장 PC 가 새 판을 당겨 왔는데 모델을 아직 안 받았을 때가 이 경우다 — 그때도 방송은 나가야 한다.
//
// ── 시험 안에서는 띄우지 않는다 ────────────────────────────────────────────────────
// `node --test` 가 진짜 모델을 적재하면 시험이 PC 마다 다르게 돈다(모델이 있는 PC · 없는 PC).
// 소리 스위치(`hardwareDisabled`)와 같은 이유로, 시험 안에서는 **없는 엔진**으로 친다.
// 이 엔진 자체를 시험할 때만 `CARECAST_TTS_ENGINE_IN_TESTS=1` 로 푼다(가짜 합성기를 주입해서).
'use strict'

const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')
const { 모델파일, SID, NUM_STEPS } = require('./supertonicWorker')

// 모델 폴더. 저장소에는 넣지 않는다(139MB) — `npm run setup:tts` 가 받아 여기 둔다. 설치판은 함께 담는다.
const 기본모델폴더 = path.join(__dirname, '..', '..', 'tts-models', 'supertonic-3')
const modelDir = () => process.env.CARECAST_TTS_MODEL_DIR || 기본모델폴더

// 모델 판. 캐시 열쇠에 들어간다 — 모델을 바꾸면 옛 소리가 저절로 밀려난다(ttsSynthesis 의 소금과 같은 뜻).
const MODEL_REV = 'supertonic-3-tts-int8-2026-05-11'
// 화자(0~9)는 사람이 고른다(사용자 결정 2026-09-22 — 기본은 현장에서 고른 SID 1). 소금에 화자를 넣어
// **화자마다 캐시가 갈린다**(다른 목소리로 만든 옛 소리를 캐시 적중으로 내지 않는다).
// **sid 1 이면 소금이 예전과 한 글자도 같다** — 이미 만들어 둔 음성이 그대로 산다(설계 검토 위험 5, 시험이 고정).
// 빈 값(없음·'')은 **기본값**이다 — `Number('')` 가 0 이라 그대로 두면 설정이 없는 PC 가 0번 목소리로 나간다.
const 화자정리 = (sid) => {
  if (sid === null || sid === undefined || String(sid).trim() === '') return SID
  const n = Number(sid)
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : SID
}
const 소금 = (sid = SID, steps = NUM_STEPS) => `supertonic@${MODEL_REV}|sid@${화자정리(sid)}|steps@${steps}`
// 미리 만들기(자동방송·예약 준비)의 합성 단계 (사용자 지시 2026-09-22 「미리 합성할 때는 자동방송처럼」).
// 급한 합성(즉시방송·미리듣기)은 기본 단계 그대로 — 16단계는 8단계보다 1.9배 걸린다(실측 1.8초 → 3.4초).
const 고음질단계 = 16
const 단계of = (params) => (params?.고음질 ? 고음질단계 : NUM_STEPS)
// 문장 사이 쉼(ms)을 열쇠 꼬리에 — 0(안 씀)이면 아무것도 안 붙어 이미 만든 음성이 그대로 산다.
const 쉼소금 = (ms) => { const n = require('../../domain/ttsSentences').쉼정리(ms); return n > 0 ? `|쉼@${n}` : '' }
const SALT = 소금(SID)

// 한 문장의 상한. 실측 실시간 0.22배라 60초 문안도 15초 안이다. 넘으면 프로세스가 걸린 것으로 보고 다시 띄운다.
const DEFAULT_TIMEOUT_MS = 30000
// 모델 적재 상한. 실측 0.8~1.3초 — 20초를 넘으면 걸린 것으로 보고 이번 요청은 다음 엔진으로 넘긴다.
const LOAD_TIMEOUT_MS = 20000

// ── 쓸 수 있나 ──────────────────────────────────────────────────────────────────
// 파일만 본다(적재하지 않는다) — 캐시 열쇠를 고를 때마다 부르므로 싸야 한다.
// 1분 기억한다. 영원히 기억하지 않는 이유: 서버를 켜 둔 채 모델을 받으면 재시작 없이 살아나야 한다.
const 기억ms = 60 * 1000
let 판정 = null   // { at, ok, 이유 }
let 적재실패 = null   // { at, 이유 } — 자식이 모델을 못 올렸다(파일은 있는데 깨졌다 등)

function 시험중() {
  return !!process.env.NODE_TEST_CONTEXT && process.env.CARECAST_TTS_ENGINE_IN_TESTS !== '1'
}

function 없는이유() {
  if (시험중()) return '시험 실행 중입니다'
  if (process.env.CARECAST_TTS_ENGINE && process.env.CARECAST_TTS_ENGINE !== 'supertonic') {
    return `CARECAST_TTS_ENGINE=${process.env.CARECAST_TTS_ENGINE}`
  }
  // 라이브러리는 **합성 프로세스 안에서만** 적재한다. 여기선 있는지만 본다(가짜 합성기를 주입한 시험은 건너뛴다).
  if (forkFn === fork) {
    try { require.resolve('sherpa-onnx-node') } catch { return '음성 엔진 라이브러리(sherpa-onnx-node)가 설치되지 않았습니다' }
  }
  const dir = modelDir()
  const 빠짐 = Object.values(모델파일).filter((f) => !fs.existsSync(path.join(dir, f)))
  if (빠짐.length) return `모델 파일이 없습니다(${빠짐.length}개) — CareCast 폴더(맨 위)에서 npm run setup:tts`
  return null
}

function available() {
  const now = Date.now()
  if (적재실패 && now - 적재실패.at < 기억ms) return false
  if (!판정 || now - 판정.at >= 기억ms) {
    const 이유 = 없는이유()
    if (이유 && (!판정 || 판정.이유 !== 이유)) console.warn(`[TTS] Supertonic 을 쓸 수 없다 — ${이유} (모델 폴더: ${modelDir()})`)
    판정 = { at: now, ok: !이유, 이유 }
  }
  return 판정.ok
}
function unavailableReason() {
  if (적재실패 && Date.now() - 적재실패.at < 기억ms) return 적재실패.이유
  return 없는이유()
}

// ── 속도 ────────────────────────────────────────────────────────────────────────
// 설정은 배율(tts_rate 0.9)인데 합성 경로에는 ±N% 문자열('-10%')로 흘러온다(rateToStr).
// Supertonic 의 speed 는 배율이다(0.9 → 11% 길어짐, 2026-09-21 실측). 높이(pitch)는 이 엔진에 없다.
//
// **가장 느린 속도는 0.8배다** (사용자 신고 2026-09-22 「0.6x로 하니까 끊김현상」). 같은 문장을 속도별로 만들어
// 말 중간의 무음을 쟀더니 0.6배는 한 문장 안에 2.3초 무음(합성 단계를 8→16 으로 올려도 1.1초), 0.7배 0.65초,
// 0.8배부터는 0.5초 안팎(보통 말 사이)이었다 — 이 모델은 너무 느리게 늘이면 말이 끊긴다. 설정에 더 느린 값이
// 저장돼 있어도 여기서 0.8배로 만든다(화면 막대도 이 PC 음성일 때는 0.8부터). Azure 는 제 속도 범위를 따로 쓴다.
const 가장느린속도 = 0.8
function 원래속도(rate) {
  if (typeof rate === 'number') return rate > 0 ? rate : 1
  const m = /^([+-]?\d+(?:\.\d+)?)%$/.exec(String(rate ?? '').trim())
  if (!m) return 1
  const v = 1 + Number(m[1]) / 100
  return v > 0 ? v : 1
}
function speedFromRate(rate) {
  return Math.min(2, Math.max(가장느린속도, 원래속도(rate)))
}
// 캐시 열쇠 꼬리 — 0.8배보다 느리게 **저장된** 값이면 붙인다. 그 값으로 예전에 만든(끊긴) 소리가 캐시에 남아 있어도
// 다시 쓰지 않게 한다. 보통 속도에는 아무것도 안 붙는다 — 이미 만든 음성은 그대로 산다.
const 속도소금 = (rate) => (원래속도(rate) < 가장느린속도 ? `|속도하한@${가장느린속도}` : '')

// ── 합성 프로세스와 줄 ──────────────────────────────────────────────────────────
// 한 번에 **하나만** 합성한다(모델 하나 · CPU 2스레드). 줄은 우선순위 순:
//   2 = 비상 · 1 = 방송(기본) · 0 = 미리 만들기
// 기동 때 미리 만들기가 여러 문장을 쌓아 두어도, 그 사이 정시 방송이 오면 **지금 것 하나만** 기다린다.
//
// ── 시간 예산은 **줄에 선 순간부터** 잰다 (Codex ④-a 1회차 High) ──────────────────────────
// 호출부가 준 `timeoutMs` 는 이 문장이 소리가 되기까지의 **전체** 몫이다 — 줄 기다림·모델 적재·합성 모두.
// 예전엔 합성을 보낸 뒤에만 쟀더니 25ms 예산이 121ms 로 늘었다. 넘으면 줄에서 빼거나(기다리던 것),
// 이 일만 끝내거나(적재를 기다리던 것 — 적재는 다음 일이 이어 쓴다), 프로세스를 죽여 다시 띄운다(합성 중이던 것).
//
// ── 응답·종료는 **그 일을 받은 프로세스** 것만 믿는다 (같은 회차 High) ─────────────────────
// A 가 시간 초과로 죽는 사이 새 B 에 다음 일을 보냈는데, **A 의 늦은 exit** 가 B 의 일을 실패시켰다.
// 일마다 받은 프로세스(`일.child`)를 적어 두고, 그 프로세스의 말만 그 일에 반영한다.
let 자식 = null
let 준비약속 = null
let 지금일 = null
const 줄 = []
let 다음id = 1
let forkFn = fork   // 시험 이음새(__setForkForTests)

// 일을 **한 번만** 끝낸다(시간 초과·응답·종료가 겹쳐도). 줄에 남아 있으면 뺀다.
function 끝내기(일, err, 결과) {
  if (일.settled) return
  일.settled = true
  clearTimeout(일.timer)
  const i = 줄.indexOf(일); if (i >= 0) 줄.splice(i, 1)
  if (err) 일.reject(err); else 일.resolve(결과)
}

function 자식띄우기() {
  if (준비약속) return 준비약속
  // **동기 예외는 기억하지 않는다** (같은 회차 Medium). Promise 실행부는 생성자 안에서 곧바로 돌아서,
  // 그 안에서 `준비약속 = null` 을 해도 바깥 대입이 **거절된 약속으로 다시 채웠다** — fork 가 한 번
  // ENOMEM 으로 실패하면 그 뒤 모든 요청이 fork 없이 같은 실패를 받았다.
  let 곧바로실패 = false
  const p = new Promise((resolve, reject) => {
    let c
    try {
      c = forkFn(path.join(__dirname, 'supertonicWorker.js'), [], {
        env: { ...process.env, CARECAST_TTS_MODEL_DIR: modelDir() },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
    } catch (e) { 곧바로실패 = true; return reject(e) }
    자식 = c
    let 준비됨 = false
    const 적재시한 = setTimeout(() => {
      if (준비됨) return
      준비됨 = true
      // 1분 동안 「못 씀」으로 기억한다 — 안 그러면 방송 한 건이 20초씩 재시도를 태워 예산을 다 쓴다.
      적재실패 = { at: Date.now(), 이유: `모델을 올리는 데 ${LOAD_TIMEOUT_MS / 1000}초를 넘었습니다` }
      const e = new Error(`Supertonic ${적재실패.이유}`); e.permanent = true
      reject(e)
      if (자식 === c) 죽이기()
    }, LOAD_TIMEOUT_MS)
    c.on('message', (m) => {
      if (!준비됨 && 'ready' in m) {
        준비됨 = true
        clearTimeout(적재시한)
        if (m.ready) { 적재실패 = null; return resolve(c) }
        적재실패 = { at: Date.now(), 이유: `모델을 올리지 못했습니다: ${m.error}` }
        console.warn(`[TTS] Supertonic ${적재실패.이유}`)
        const e = new Error(적재실패.이유); e.permanent = true
        return reject(e)
      }
      if (지금일 && 지금일.child === c && m.id === 지금일.id) {
        const 일 = 지금일; 지금일 = null
        if (m.ok) 끝내기(일, null, { file: 일.out, durationSec: m.durationSec, ...(Array.isArray(m.구간) ? { 구간: m.구간 } : {}) })
        else 끝내기(일, new Error(`Supertonic 합성 실패: ${m.error}`))
        다음()
      }
    })
    const 끝남 = (why) => {
      if (자식 === c) { 자식 = null; 준비약속 = null }
      if (!준비됨) {
        준비됨 = true
        clearTimeout(적재시한)
        const e = new Error(`Supertonic 프로세스가 뜨지 못했다: ${why}`); e.permanent = !!적재실패
        reject(e)
      }
      // **이 프로세스가 받은 일만** 실패시킨다. 적재를 기다리던 일은 다음() 의 catch 가 받는다 —
      // 여기서 먼저 「멎었다」로 끝내면 적재 실패의 **영구 불가** 표시가 사라져 호출부가 재시도를 태운다.
      if (지금일 && 지금일.child === c) {
        const 일 = 지금일; 지금일 = null
        끝내기(일, new Error(`Supertonic 프로세스가 멎었다: ${why}`))
        다음()
      }
    }
    c.on('exit', (code) => 끝남(`종료코드 ${code}`))
    c.on('error', (e) => 끝남(e.message))
  })
  p.catch(() => {})
  if (!곧바로실패) 준비약속 = p
  return p
}

function 죽이기() {
  const c = 자식
  자식 = null; 준비약속 = null
  if (c) { try { c.kill() } catch { /* 이미 죽었다 — 원하는 상태 */ } }
}

function 시간초과(일) {
  if (일.settled) return
  const e = new Error(`Supertonic 합성 시간 초과(${Math.round(일.timeoutMs / 1000)}초)`)
  if (지금일 === 일) {
    지금일 = null
    const 합성중이었나 = !!일.child
    끝내기(일, e)
    if (합성중이었나 && 자식 === 일.child) 죽이기()   // 걸린 프로세스는 버리고 다음 일에 새로 띄운다
    다음()
  } else {
    끝내기(일, e)   // 줄에서 기다리던 것 — 빼기만 한다
  }
}

// 급한 방송(우선순위 1 이상)이 줄에 섰는데 **고음질 미리 만들기**가 합성 중이면 끊고 줄 뒤로 돌린다
// (Codex 2026-09-22 High). 고음질은 단계가 두 배라 긴 문안이면 30초 넘게 프로세스를 잡는다 — 그동안 캐시 없는
// 정시 방송이 15초 예산을 넘겨 빠졌다. 모델을 다시 올리는 값(실측 1초 안팎)이 기다리는 값보다 싸다.
// 보통(8단계) 미리 만들기는 예전처럼 끝까지 둔다 — 바꾸는 범위를 고음질로 한정한다.
function 양보하나(일) { return 일 && 일.priority === 0 && 일.고음질 }
function 끼어들기() {
  const 뺏긴 = 지금일
  지금일 = null
  뺏긴.child = null   // 이 프로세스의 늦은 응답·종료는 이제 이 일과 무관하다(끝남·message 가 child 로 가린다)
  줄.push(뺏긴)       // 시간 몫(타이머)은 그대로 — 다 되면 미리 만들기는 다음 점검에서 다시 한다
  console.log('[TTS] 급한 방송 — 고음질 미리 만들기를 멈추고 뒤로 미룹니다')
  죽이기()
}

async function 다음() {
  if (지금일 || !줄.length) return
  if (!available()) {
    // 적재가 막 실패했다 — 줄에 선 것을 전부 **영구 불가**로 돌려 곧장 다음 엔진으로 가게 한다.
    for (const 일 of [...줄]) {
      const e = new Error(`Supertonic 을 쓸 수 없다: ${unavailableReason()}`); e.permanent = true
      끝내기(일, e)
    }
    return
  }
  줄.sort((a, b) => b.priority - a.priority || a.seq - b.seq)
  const 일 = 줄.shift()
  지금일 = 일
  let c
  try { c = await 자식띄우기() }
  catch (e) {
    if (지금일 === 일) 지금일 = null
    끝내기(일, e)
    return 다음()
  }
  if (지금일 !== 일 || 일.settled) return   // 기다리는 사이 시간이 다 됐다
  // 모델을 올리는 사이 급한 방송이 섰으면 고음질 미리 만들기는 양보한다
  if (양보하나(일) && 줄.some(x => x.priority >= 1)) { 지금일 = null; 줄.push(일); return 다음() }
  일.child = c
  try { c.send({ id: 일.id, text: 일.text, speed: 일.speed, sid: 일.sid, numSteps: 일.numSteps, pauseMs: 일.pauseMs, out: 일.out }) }
  catch (e) {
    지금일 = null
    끝내기(일, new Error(`Supertonic 에 보내지 못했다: ${e.message}`))
    if (자식 === c) 죽이기()
    다음()
  }
}

/**
 * 한 문장을 WAV 로 만든다.
 * @param {{text:string, rate?:string|number, sid?:number}} params  voice·pitch 는 이 엔진에 없다(무시).
 *   sid = 화자(0~9). 부르는 쪽(tts.js)이 방송 한 번에 한 번 정해 넘긴다 — 캐시 열쇠와 같은 값이어야 한다.
 * @param {{timeoutMs?:number, priority?:number, out:string, handle?:object}} opts
 *   out = 쓸 WAV 경로. timeoutMs = 줄에 선 순간부터의 전체 몫.
 *   handle = 우선순위를 **나중에 올릴** 손잡이(`{priority}`) — 같은 문장을 만드는 중에 더 급한 방송이
 *   합류하면(tts.js 의 합치기) 여기로 올린다. 재시도에도 같은 손잡이를 넘기면 높은 값이 이어진다.
 * @returns {Promise<{file:string, durationSec:number}>}
 */
function synthesize(params, { timeoutMs, priority = 1, out, handle } = {}) {
  // 고음질은 단계가 두 배라 기본 몫도 두 배(미리 만들기만 쓴다 — 방송 경로는 부르는 쪽이 예산을 준다)
  if (!Number.isFinite(timeoutMs)) timeoutMs = params?.고음질 ? DEFAULT_TIMEOUT_MS * 2 : DEFAULT_TIMEOUT_MS
  if (!available()) {
    const e = new Error(`Supertonic 을 쓸 수 없다: ${unavailableReason()}`)
    e.permanent = true
    return Promise.reject(e)
  }
  const text = String(params?.text ?? '').trim()
  if (!text) return Promise.reject(new Error('읽을 문장이 비었다'))
  return new Promise((resolve, reject) => {
    const 순위 = Math.max(Number(priority) || 0, Number(handle?.priority) || 0)
    const 일 = { id: 다음id++, seq: 다음id, text, speed: speedFromRate(params.rate), sid: 화자정리(params.sid), out,
      numSteps: 단계of(params), pauseMs: require('../../domain/ttsSentences').쉼정리(params.쉼), 고음질: !!params.고음질,
      priority: 순위, timeoutMs, resolve, reject, settled: false, child: null, timer: null }
    if (handle) {
      handle.priority = 순위
      // 합성에 들어간 뒤에는 올릴 것이 없다(하나씩 만든다) — 줄에서 기다리는 동안만 뜻이 있다.
      handle.raise = (q) => { if (!일.settled && Number(q) > 일.priority) 일.priority = Number(q) }
    }
    일.timer = setTimeout(() => 시간초과(일), timeoutMs)
    줄.push(일)
    if (순위 >= 1 && 지금일?.child && 양보하나(지금일)) 끼어들기()
    다음()
  })
}

/** 모델을 미리 올려 둔다(첫 방송이 적재 시간을 안 내게). 못 올려도 던지지 않는다. */
async function warmup() {
  if (!available()) return false
  try { await 자식띄우기(); return true } catch { return false }
}

function __resetForTests() {
  죽이기(); 판정 = null; 적재실패 = null; 지금일 = null
  for (const 일 of 줄.splice(0)) clearTimeout(일.timer)
}
function __setForkForTests(fn) { forkFn = fn || fork }

module.exports = {
  name: 'supertonic', ext: 'wav', SALT, 소금, 화자정리, 속도소금, 가장느린속도, 고음질단계, 단계of, 쉼소금, MODEL_REV, DEFAULT_TIMEOUT_MS,
  available, unavailableReason, speedFromRate, synthesize, warmup, modelDir,
  __resetForTests, __setForkForTests,
}
