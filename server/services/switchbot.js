// SwitchBot API v1.1 서비스 — HMAC-SHA256 서명 방식
const { rawSetting } = require('../domain/settingsRead')
const { networkDisabled, noticeOnce: netNotice, blockedError } = require('./networkMode')
const crypto = require('crypto')
const { getDB } = require('../db/schema')

const SWITCHBOT_API = 'https://api.switch-bot.com/v1.1'

// HMAC-SHA256 서명 헤더 생성 (v1.1 인증)
// 헤더에 못 넣는 글자(제어문자)가 토큰에 섞여 있으면 **부르기 전에 막는다.**
// 그냥 부르면 `fetch` 가 **토큰을 통째로 담은 오류**를 던지고, 그 문구가 연결 테스트
// 결과를 타고 화면까지 간다(Codex 재현, 2026-09-11 EV-004698).
// 막는 김에 무엇이 잘못인지도 말한다 — 알 수 없는 오류보다 낫다.
// (출력장치 이름에 이미 같은 규칙이 있다 — `audioDevices.sanitizeDeviceName`.)
// eslint-disable-next-line no-control-regex -- 제어문자를 **찾는 것이 목적**인 정규식이다.
const 못넣는글자 = /[\u0000-\u001f\u007f]/

function 자격증명확인(token, secret) {
  for (const [이름, 값] of [['토큰', token], ['시크릿', secret]]) {
    if (못넣는글자.test(String(값 ?? ''))) {
      throw new Error(`SwitchBot ${이름}에 쓸 수 없는 문자(줄바꿈·제어문자)가 들어 있습니다. 설정에서 다시 붙여 넣어 주세요.`)
    }
  }
}

// 그래도 어딘가에서 토큰이 실린 오류가 올라오면 **여기서 지운다.**
// 서버는 자기 토큰을 아니까 화면 쪽 추측보다 확실하다.
function 비밀지우기(err, token, secret) {
  let 글 = err && err.message ? String(err.message) : String(err)
  for (const 비밀 of [token, secret]) {
    if (비밀 && String(비밀).length >= 8) 글 = 글.split(String(비밀)).join('***')
  }
  return 글 === (err && err.message) ? err : new Error(글, { cause: err })
}

function makeHeaders(token, secret) {
  const t     = Date.now().toString()
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const sign  = crypto
    .createHmac('sha256', secret)
    .update(token + t + nonce)
    .digest('base64')

  return {
    'Authorization':  token,
    'sign':           sign,
    't':              t,
    'nonce':          nonce,
    'Content-Type':   'application/json',
  }
}

// settings 테이블에서 SwitchBot 설정 전체 읽기
function getSwitchBotConfig() {
  const db  = getDB()
  const get = (key, def = '') => rawSetting(db, key) ?? def
  return {
    token:       get('switchbot_token'),
    secret:      get('switchbot_secret'),
    deviceId:    get('switchbot_device_id'),
    onTime:      get('switchbot_on_time',      '07:45'),
    offTime:     get('switchbot_off_time',     '17:30'),
    autoControl: get('switchbot_auto_control', 'true') === 'true',
  }
}

// 설정 완료 여부 확인
function isConfigured() {
  const { token, secret, deviceId } = getSwitchBotConfig()
  return !!(token && secret && deviceId)
}

// SwitchBot API 호출 제한시간. 이 두 함수는 매분 도는 cron(checkSwitchBotSchedule)에서
// await되므로, 응답이 없으면 그 분의 예약 점검·일과방송 판정이 통째로 밀린다.
// 5초로 잡은 이유: 조명 스위치 한 번 누르는 일이라 그보다 오래 걸리면 어차피 실패다.
const API_TIMEOUT_MS = 5000

// 장치에 명령 전송 (turnOn / turnOff)
async function sendCommand(command) {
  // 네트워크 차단 모드 — 클라우드 경유라 여기서 막힌다(장비 LAN 이 아니다).
  if (networkDisabled()) { netNotice('SwitchBot'); throw blockedError('스마트플러그 제어') }
  const { token, secret, deviceId } = getSwitchBotConfig()
  if (!token || !secret || !deviceId) throw new Error('SwitchBot 설정이 없습니다.')
  자격증명확인(token, secret)

  // 앞에서 막아도 **새는 길이 하나 더 있다** — 상대 서버가 오류 문구에 토큰을
  // 되돌려 주는 경우다. 서버는 자기 토큰을 아니까 여기서 확실히 지운다.
  try {
    const res = await fetch(`${SWITCHBOT_API}/devices/${deviceId}/commands`, {
      method:  'POST',
      headers: makeHeaders(token, secret),
      body:    JSON.stringify({ command, parameter: 'default', commandType: 'command' }),
      signal:  AbortSignal.timeout(API_TIMEOUT_MS),
    })
    const data = await res.json()
    if (data.statusCode !== 100) throw new Error(data.message || `API 오류: ${data.statusCode}`)
    return data
  } catch (err) {
    throw 비밀지우기(err, token, secret)
  }
}

// 장치 상태 조회 → power: 'on' | 'off'
async function getDeviceStatus() {
  const { token, secret, deviceId } = getSwitchBotConfig()
  if (!token || !secret || !deviceId) throw new Error('SwitchBot 설정이 없습니다.')
  자격증명확인(token, secret)

  try {
    const res = await fetch(`${SWITCHBOT_API}/devices/${deviceId}/status`, {
      headers: makeHeaders(token, secret),
      signal:  AbortSignal.timeout(API_TIMEOUT_MS),
    })
    const data = await res.json()
    if (data.statusCode !== 100) throw new Error(data.message || `API 오류: ${data.statusCode}`)
    return data.body // { deviceId, deviceType, power, ... }
  } catch (err) {
    throw 비밀지우기(err, token, secret)
  }
}

// 이 계정에 붙어 있는 장치 목록 (UX-08, 2026-09-12).
//
// 왜 필요했나: Device ID 를 **손으로 적게** 해 뒀다. 그 값은 SwitchBot 앱의
// 「장치 > 장치 정보」에 있는 16진 문자열이라, 옮겨 적다 한 글자만 틀려도 조용히 안 먹는다
// (화면은 "연결 끊김"이라 말하지만 사람은 토큰을 의심한다). 계정이 아는 것을 사람에게
// 다시 적게 하지 않는다.
//
// **읽기만 한다.** 장치를 누르지 않으므로 실부작용이 없다 — `sendCommand` 와 다른 층이다.
// `deviceId` 가 없어도 부를 수 있다(그것을 고르려고 부르는 것이다).
//
// 적외선 리모컨(infraredRemoteList)도 함께 담는다 — 현장에서 방송장비 전원을 그쪽으로
// 잡아 둔 경우가 있고, 목록에 없으면 사람은 "내 장치가 안 보인다"로 읽는다.
async function listDevices() {
  if (networkDisabled()) {
    netNotice('SwitchBot')
    throw blockedError('SwitchBot 장치 목록')
  }
  const { token, secret } = getSwitchBotConfig()
  if (!token || !secret) throw new Error('SwitchBot 토큰과 시크릿을 먼저 저장해 주세요.')
  자격증명확인(token, secret)

  try {
    const res = await fetch(`${SWITCHBOT_API}/devices`, {
      headers: makeHeaders(token, secret),
      signal:  AbortSignal.timeout(API_TIMEOUT_MS),
    })
    const data = await res.json()
    if (data.statusCode !== 100) throw new Error(data.message || `API 오류: ${data.statusCode}`)
    const 물리 = (data.body?.deviceList || []).map(d => ({
      deviceId: d.deviceId, name: d.deviceName || '', type: d.deviceType || '', kind: 'device',
    }))
    const 리모컨 = (data.body?.infraredRemoteList || []).map(d => ({
      deviceId: d.deviceId, name: d.deviceName || '', type: d.remoteType || '', kind: 'remote',
    }))
    // **이름과 id 만 돌려준다.** 원본 응답에는 허브 구성·방 정보까지 들어 있어, 그대로
    // 흘리면 화면이 쓰지도 않는 것을 받는다(그리고 로그에 남는다).
    return [...물리, ...리모컨].filter(d => d.deviceId)
  } catch (err) {
    throw 비밀지우기(err, token, secret)
  }
}

module.exports = { sendCommand, getDeviceStatus, listDevices, getSwitchBotConfig, isConfigured }
