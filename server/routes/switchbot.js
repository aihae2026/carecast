// SwitchBot 라우트 — 누르기(press), 상태 조회
const { rawSetting } = require('../domain/settingsRead')
const express  = require('express')
const { sendCommand, getDeviceStatus, listDevices, getSwitchBotConfig, isConfigured } = require('../services/switchbot')
const { getDB } = require('../db/schema')
const { todayStr, nowHHMM } = require('../services/repeatSchedule')

const router = express.Router()

// settings 테이블에 마지막 제어 기록 저장 헬퍼
function saveLastControl(action) {
  const db = getDB()
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('switchbot_last_control', JSON.stringify({ action, time: new Date().toISOString() }))
}

// 방송 오류 로그 저장 헬퍼
function logBroadcast(db, content, success) {
  const t    = new Date()
  const date = todayStr(t)
  const time = nowHHMM(t)
  db.prepare('INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(date, time, '시스템', content, '시스템', '-', success ? 1 : 0)
}

// POST /api/switchbot/on  — 누르기 (비상 방송 자동 연동, 수동 호출용)
// POST /api/switchbot/off — 누르기 (스케줄러 자동 호출용, 동작은 동일)
// Bot(press) 타입: turnOn/turnOff 미지원, press 명령 한 번으로 토글
async function handlePress(label, res) {
  if (!isConfigured()) return res.status(400).json({ error: 'SwitchBot 설정이 없습니다.' })
  try {
    await sendCommand('press')
    saveLastControl(label)
    res.json({ ok: true })
  } catch (err) {
    console.error(`[SwitchBot] ${label} 실패:`, err.message)
    logBroadcast(getDB(), `SwitchBot ${label} 오류: ${err.message}`, false)
    res.status(500).json({ error: err.message })
  }
}

router.post('/on',    (req, res) => handlePress('on',  res))
router.post('/off',   (req, res) => handlePress('off', res))
router.post('/press', (req, res) => handlePress('press', res))

// GET /api/switchbot/devices — 이 계정의 장치 목록 (UX-08, 2026-09-12)
//
// Device ID 를 손으로 적게 하지 않는다. 그 값은 앱의 「장치 > 장치 정보」에 있는 16진
// 문자열이라, 옮겨 적다 한 글자만 틀려도 조용히 안 먹는다 — 화면은 "연결 끊김"이라
// 말하는데 사람은 토큰을 의심한다.
//
// **읽기만 하는 경로다** — 장치를 누르지 않으므로 실부작용이 없고, `deviceId` 가 아직
// 없어도 부를 수 있다(그것을 고르려고 부른다).
//
// **못 받았을 때 빈 목록을 주지 않는다.** 빈 목록은 화면에서 "장치가 없다"로 읽히는데
// 실제로는 토큰이 틀렸거나 인터넷이 끊긴 것이다 — 그 둘을 섞으면 사람이 엉뚱한 것을 고친다.
router.get('/devices', async (req, res) => {
  try {
    res.json({ devices: await listDevices() })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// GET /api/switchbot/status — 현재 전원 상태 + 마지막 제어 + 다음 예정 동작
router.get('/status', async (req, res) => {
  if (!isConfigured()) {
    return res.json({ configured: false, power: null, lastControl: null, next: null })
  }

  const cfg = getSwitchBotConfig()

  // 다음 예정 동작 계산 (autoControl 활성 시)
  function calcNext() {
    if (!cfg.autoControl) return null
    const now = new Date()
    const cur = nowHHMM(now)
    if (cur < cfg.onTime)  return { time: cfg.onTime,  action: 'on'  }
    if (cur < cfg.offTime) return { time: cfg.offTime, action: 'off' }
    return { time: cfg.onTime, action: 'on', tomorrow: true }
  }

  try {
    const body = await getDeviceStatus()
    const power = String(body.power ?? '').toLowerCase() === 'on' ? 'on' : 'off'

    // 마지막 제어 기록 읽기
    const db  = getDB()
    const raw = rawSetting(db, 'switchbot_last_control')
    const lastControl = raw !== null ? JSON.parse(raw) : null

    res.json({ configured: true, power, lastControl, next: calcNext(), error: null })
  } catch (err) {
    console.error('[SwitchBot] 상태 조회 실패:', err.message)
    const db  = getDB()
    const raw = rawSetting(db, 'switchbot_last_control')
    const lastControl = raw !== null ? JSON.parse(raw) : null
    res.json({ configured: true, power: null, lastControl, next: null, error: err.message })
  }
})

module.exports = router
