// Azure AI Speech — **선택 엔진** (사용자 지시 2026-09-21: 기본 Supertonic · 선택 Azure · 최종 대비 윈도우 음성).
//
// 키·지역이 설정돼 있을 때만 차례에 선다(Supertonic 다음). 설치처마다 **자기** Azure 구독·키를 쓴다 —
// 한 키를 여러 기관이 나눠 쓰면 재판매에 가깝다(Microsoft 약관, 2026-09-20 원문 확인).
//
// 부르는 길은 REST 하나다(라이브러리를 늘리지 않는다): SSML 을 보내고 **WAV(44100Hz·16bit·모노)** 를 받는다 —
// Supertonic·윈도우 음성과 같은 형식이라 서버 스피커(MCI)·화면 재생·캐시가 그대로 돈다.
//
// 인터넷을 탄다: `NO_NETWORK` 에서는 차례에서 빠지고, 결과를 인터넷 상태 증거(netHealth 「안내음성」)로 남긴다.
// **키는 어디에도 찍지 않는다** — 오류 문구에 섞여 들어오면 지운다(SwitchBot 과 같은 규칙).
//
// 목소리 이름은 설정의 `tts_voice_*`(예: ko-KR-SunHiNeural)를 그대로 쓴다 — Azure 목소리 이름과 같다.
// 게인(+2dB)·쉼은 **넣지 않았다**: Azure 의 prosody volume 이 dB 단위를 받는지 실제 키로 확인하지 못했고,
// 틀린 SSML 은 요청 전체를 거절시킨다(선택 엔진이 통째로 죽는다). 실제 키로 확인한 뒤 켠다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const SALT = 'azure@riff-44100hz-16bit-mono-pcm'
const DEFAULT_TIMEOUT_MS = 15000
const 지역모양 = /^[a-z0-9-]{2,40}$/i
let fetchFn = (...a) => fetch(...a)   // 시험 이음새

function 시험중() {
  return !!process.env.NODE_TEST_CONTEXT && process.env.CARECAST_TTS_ENGINE_IN_TESTS !== '1'
}

function 설정읽기() {
  try {
    const { getDB } = require('../../db/schema')
    const { rawSetting } = require('../../domain/settingsRead')
    const db = getDB()
    return {
      key: String(rawSetting(db, 'azure_speech_key') ?? '').trim(),
      region: String(rawSetting(db, 'azure_speech_region') ?? '').trim(),
    }
  } catch { return { key: '', region: '' } }
}

function available() {
  if (시험중()) return false
  if (require('../networkMode').networkDisabled()) return false
  const { key, region } = 설정읽기()
  return !!key && 지역모양.test(region)
}

const xml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

// 속도·높이는 ±N% · ±NHz 문자열('-10%', '+0Hz')로 흘러온다(tts.rateToStr · pitchToStr) — Azure prosody 가 같은 모양을 받는다.
const 모양맞나 = (v, 단위) => new RegExp(`^[+-]\\d+(\\.\\d+)?${단위}$`).test(String(v ?? ''))

function ssmlOf({ text, voice, rate, pitch }) {
  const 목소리 = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(String(voice ?? '')) ? voice : 'ko-KR-SunHiNeural'
  const 속성 = [
    모양맞나(rate, '%') ? `rate="${rate}"` : null,
    모양맞나(pitch, 'Hz') ? `pitch="${pitch}"` : null,
  ].filter(Boolean).join(' ')
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">`
    + `<voice name="${목소리}"><prosody ${속성}>${xml(text)}</prosody></voice></speak>`
}

function 비밀지우기(msg, key) {
  let m = String(msg ?? '')
  if (key && key.length >= 4) m = m.split(key).join('***')
  return m
}

// WAV 의 **실제로 받은** 소리 길이(초). 머리가 적은 길이만 믿지 않는다 — 머리만 있고 소리 바이트가 없는
// 응답을 1초짜리로 읽어 성공 처리하던 것(Codex ④-b 1회차 Medium). 받은 바이트와 머리 값 중 작은 쪽.
function wav길이(buf) {
  const i = buf.indexOf('data', 12, 'ascii')
  if (i < 0 || buf.length < 44) return 0
  const 머리값 = buf.readUInt32LE(i + 4)
  const 받은 = Math.max(0, buf.length - (i + 8))
  return Math.min(머리값, 받은) / (buf.readUInt32LE(28) || 88200)
}
// 이보다 짧으면 소리가 없는 것으로 친다(짧은 안내 한 마디도 0.3초는 넘는다).
const 최소초 = 0.1

/**
 * @param {{text:string, voice?:string, rate?:string, pitch?:string}} params
 * @param {{timeoutMs?:number, out:string}} opts
 * @returns {Promise<{file:string, durationSec:number}>}
 */
async function synthesize(params, { timeoutMs = DEFAULT_TIMEOUT_MS, out } = {}) {
  if (!available()) {
    const e = new Error('Azure 음성: 키·지역이 없거나 인터넷 차단 모드다'); e.permanent = true
    throw e
  }
  const text = String(params?.text ?? '').trim()
  if (!text) throw new Error('읽을 문장이 비었다')
  // **외부로 나가기 직전, 이 한 자리에서 번호를 본다**(전문가 2차 검토 4-2). 미리듣기·대체 실행처럼
  // 앞단 검사를 안 거친 길이 있었다 — 부르는 쪽마다 막게 두면 새 길이 생길 때 또 샌다.
  // 주민등록번호·휴대폰번호만 본다. 생년월일은 안 본다 — 「1919년 3월 1일」 같은 기념일 문구가
  // 시스템 방송에 들어간다(날짜 차단은 방송 저장·발송 경계에 그대로 있다).
  // 영구 실패로 던진다 — 같은 방송 안에서 Azure 를 다시 부르지 않고 이 PC 음성으로 넘어간다.
  if (require('../sensitiveInfo').번호찾기(text).length) {
    const e = new Error('Azure 음성: 문장에 개인정보(주민등록번호·휴대폰번호)가 있어 외부로 보내지 않았습니다')
    e.permanent = true
    throw e
  }
  const { key, region } = 설정읽기()
  const netHealth = require('../netHealth')
  // ── **원래 오류를 붙여 던지지 않는다** (Codex ④-b 1회차 High) ─────────────────────────────
  // 원인(cause)에 원래 오류를 달면 얼린 오류·겹친 cause 안에 **키 원문이 그대로** 남았다(헤더 값이 잘못되면
  // fetch 가 키를 담은 문구를 던진다 — SwitchBot 에서 실제로 났다, EV-004698). 그래서 실패는 **값으로** 받아
  // 키를 지운 문구만으로 새 오류를 만든다(catch 절에서 다시 던지지 않으니 원인 연결 규칙과도 부딪히지 않는다).
  const 실패로 = (e) => ({ 실패: 비밀지우기(e?.message ?? e, key) })
  const res = await fetchFn(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-44100hz-16bit-mono-pcm',
        'User-Agent': 'CareCast',
      },
      body: ssmlOf({ ...params, text }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(실패로)
  if (res.실패 !== undefined) {
    netHealth.record(false, '안내음성')
    throw new Error(`Azure 음성 요청 실패: ${res.실패}`)
  }
  if (!res.ok) {
    // 401·403 은 키·지역이 틀린 것 — 곧 고쳐지지 않으므로 이번 방송에서는 재시도하지 않는다.
    // 인터넷은 닿았다(서버가 대답했다).
    netHealth.record(true, '안내음성')
    const e = new Error(`Azure 음성 거절(HTTP ${res.status})${res.status === 401 || res.status === 403 ? ' — 키 또는 지역을 확인하세요' : ''}`)
    if (res.status === 401 || res.status === 403) e.permanent = true
    throw e
  }
  // 본문을 받다 끊겨도 같은 규칙(키 지우기 · 인터넷 실패 기록) — 예전엔 이 갈래가 둘 다 빠졌다(같은 회차 High).
  const 본문 = await res.arrayBuffer().then((b) => Buffer.from(b), 실패로)
  if (본문.실패 !== undefined) {
    netHealth.record(false, '안내음성')
    throw new Error(`Azure 음성 받기 실패: ${본문.실패}`)
  }
  netHealth.record(true, '안내음성')
  const buf = 본문
  const 길이 = wav길이(buf)
  if (!(길이 >= 최소초)) throw new Error('Azure 음성: 받은 소리가 비었다')
  fs.writeFileSync(out, buf)
  return { file: out, durationSec: 길이 }
}

function tmpOut(uniq) { return path.join(os.tmpdir(), `carecast_azure_${uniq}.wav`) }

/** 화면 표시용 — 키는 끝 4자리만. */
function 상태() {
  const { key, region } = 설정읽기()
  return { keySet: !!key, keyMasked: key ? '••••' + key.slice(-4) : null, region }
}

function __setFetchForTests(fn) { fetchFn = fn || ((...a) => fetch(...a)) }

module.exports = {
  name: 'azure', ext: 'wav', SALT, DEFAULT_TIMEOUT_MS, 지역모양,
  available, synthesize, ssmlOf, tmpOut, 상태, 비밀지우기,
  __setFetchForTests,
}
