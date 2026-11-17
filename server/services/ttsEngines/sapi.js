// 윈도우 기본 음성(SAPI · 예: Microsoft Heami ko-KR) — **마지막 엔진** (사용자 결정 2026-09-21).
//
// 「어떤 경우에도 무음 금지」의 마지막 받침이다. 윈도우에 들어 있는 한국어 음성으로 **WAV 파일**을 만든다 —
// 파일이 나오므로 캐시·자막·서버 스피커(MCI)·화면 재생이 다른 엔진과 똑같이 돈다.
// 사용자는 브라우저 음성(Web Speech) 대신 이것을 골랐다: 윈도우에서는 둘 다 같은 Heami 목소리이고,
// 이쪽은 화면이 없어도(서버 스피커 경로) 소리가 난다.
//
// 인터넷을 타지 않는다(`NO_NETWORK` 에서도 허용). 목소리 품질은 낮다 — 앞 엔진이 다 실패했을 때만 쓴다.
// 합성은 고정 스크립트(`../carecast_sapi.ps1`)를 PowerShell 로 부른다. 문장은 **UTF-8 파일로** 넘긴다
// (명령줄 인자로 넘기면 코드 페이지에서 한글이 깨진다).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const { spawn } = require('child_process')

const SCRIPT = path.join(__dirname, '..', 'carecast_sapi.ps1')
const SALT = 'sapi@ko-KR'
const DEFAULT_TIMEOUT_MS = 30000
// 한국어 음성이 없는 PC 라고 판정되면 10분 기억한다(그동안은 차례에서 빠진다).
const 없음기억ms = 10 * 60 * 1000
let 목소리없음 = null   // { at }
let spawnFn = spawn     // 시험 이음새

function 시험중() {
  return !!process.env.NODE_TEST_CONTEXT && process.env.CARECAST_TTS_ENGINE_IN_TESTS !== '1'
}

function available() {
  if (process.platform !== 'win32' && spawnFn === spawn) return false
  if (시험중()) return false
  if (목소리없음 && Date.now() - 목소리없음.at < 없음기억ms) return false
  return fs.existsSync(SCRIPT)
}

// 속도: 설정 배율(0.9) → SAPI Rate(-10~10, 0 이 보통). 한 칸이 대략 10% 라 배율 차이 × 10.
function sapiRate(rate) {
  const m = /^([+-]?\d+(?:\.\d+)?)%$/.exec(String(rate ?? '').trim())
  const 배율 = typeof rate === 'number' ? rate : (m ? 1 + Number(m[1]) / 100 : 1)
  return Math.max(-10, Math.min(10, Math.round((배율 - 1) * 10)))
}

// WAV 의 소리 길이(초). 머리 크기가 엔진마다 달라 'data' 조각을 찾아 읽는다.
function wav길이(file) {
  const b = fs.readFileSync(file)
  const i = b.indexOf('data', 12, 'ascii')
  if (i < 0 || b.length < 44) return 0
  const 바이트초 = b.readUInt32LE(28) || 88200
  return b.readUInt32LE(i + 4) / 바이트초
}

/**
 * @param {{text:string, rate?:string|number}} params
 * @param {{timeoutMs?:number, out:string}} opts
 * @returns {Promise<{file:string, durationSec:number}>}
 */
function synthesize(params, { timeoutMs = DEFAULT_TIMEOUT_MS, out } = {}) {
  if (!available()) {
    const e = new Error('윈도우 한국어 음성을 쓸 수 없다'); e.permanent = true
    return Promise.reject(e)
  }
  const text = String(params?.text ?? '').trim()
  if (!text) return Promise.reject(new Error('읽을 문장이 비었다'))
  const 글파일 = `${out}.txt`
  fs.writeFileSync(글파일, text, 'utf8')
  const 치우기 = () => { try { fs.unlinkSync(글파일) } catch { /* 임시 글 파일 — 없거나 아직 잠겼으면 끝날 때 다시 치운다 */ } }
  // 실패했으면 반쯤 쓰인 WAV 도 치운다(임시 폴더에 쌓이지 않게).
  const 결과치우기 = () => { try { fs.unlinkSync(out) } catch { /* 없으면 그만 */ } }
  return new Promise((resolve, reject) => {
    let done = false
    let proc
    try {
      proc = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', SCRIPT, '-In', 글파일, '-Out', out, '-Rate', String(sapiRate(params.rate))],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    } catch (e) { 치우기(); return reject(e) }
    let stderr = ''
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { proc.kill() } catch { /* 이미 끝났다 — 원하는 상태 */ }
      치우기()
      reject(new Error(`윈도우 음성 합성 시간 초과(${Math.round(timeoutMs / 1000)}초)`))
    }, timeoutMs)
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    // **끝날 때는 먼저 치운다 — 이미 끝낸 일이어도** (Codex ④-c 1회차 Medium). 시간 초과 순간에는 PowerShell 이
    // 아직 글 파일을 쥐고 있어 지우기가 실패할 수 있다. 예전엔 뒤이은 close 가 done 을 보고 곧바로 돌아가 파일이 남았다.
    proc.on('error', (e) => {
      치우기()
      if (done) { 결과치우기(); return }
      done = true; clearTimeout(timer); 결과치우기()
      reject(new Error(`윈도우 음성을 부르지 못했다: ${e.message}`))
    })
    proc.on('close', (code) => {
      치우기()
      if (done) { 결과치우기(); return }
      done = true; clearTimeout(timer)
      if (code === 3) {
        목소리없음 = { at: Date.now() }
        console.warn('[TTS] 이 PC 에 켜진 한국어 윈도우 음성이 없다 — 마지막 대비 엔진을 10분 동안 뺀다')
        const e = new Error('윈도우 한국어 음성이 없다'); e.permanent = true
        return reject(e)
      }
      if (code !== 0 || !fs.existsSync(out)) {
        결과치우기()
        return reject(new Error(`윈도우 음성 합성 실패(종료코드 ${code}): ${stderr.trim().slice(0, 200)}`))
      }
      // **읽기 실패도 실패로 끝낸다** (Codex ④-c 1회차 High). 이 콜백 안에서 던지면 약속이 영영 안 끝나
      // 방송이 그 자리에서 멎는다(잠긴 파일 EBUSY 등).
      let 길이
      try { 길이 = wav길이(out) } catch (e) {
        결과치우기()
        return reject(new Error(`윈도우 음성 결과를 못 읽었다: ${e.message}`))
      }
      resolve({ file: out, durationSec: 길이 })
    })
  })
}

function tmpOut(uniq) { return path.join(os.tmpdir(), `carecast_sapi_${uniq}.wav`) }

function __resetForTests() { 목소리없음 = null }
function __setSpawnForTests(fn) { spawnFn = fn || spawn }

module.exports = {
  name: 'sapi', ext: 'wav', SALT, DEFAULT_TIMEOUT_MS,
  available, synthesize, sapiRate, wav길이, tmpOut,
  __resetForTests, __setSpawnForTests,
}
