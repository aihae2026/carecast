// 서버 시작 시 server/.env가 있으면 읽어서, settings 테이블에 아직 없는 키만 채워넣는다.
// switchbot.js/weather.js/calendar.js는 전부 process.env가 아니라 settings 테이블에서
// 설정을 읽으므로, .env에 값을 넣는 것만으로는 아무 효과가 없었다 — 이 모듈이 그 간극을 메운다.
// 이미 DB에 값이 있는 키는 덮어쓰지 않는다(관리자 화면에서 직접 입력한 값이 우선).
// 예외는 화면에 칸이 없는 ENV_WINS 키뿐이다(아래).
'use strict'

const { rawSetting } = require('../domain/settingsRead')

const fs = require('fs')
const path = require('path')
const { getDB } = require('../db/schema')

// ENV 변수명 → settings 테이블 키 매핑 (.env.example과 각 서비스 파일의 getSetting() 키에 맞춤)
const ENV_TO_SETTING_KEY = {
  SWITCHBOT_TOKEN:     'switchbot_token',
  SWITCHBOT_SECRET:    'switchbot_secret',
  SWITCHBOT_DEVICE_ID: 'switchbot_device_id',
  KMA_API_KEY:         'kma_api_key',
  KMA_APIHUB_KEY:      'kma_apihub_key',
  KMA_LIVING_API_KEY:  'kma_living_api_key',
  KMA_UV_STN:          'kma_uv_stn',
  KMA_ALERT_API_KEY:   'kma_alert_api_key',
  UV_AREA_NO:          'uv_area_no',
  LOCATION_LAT:        'location_lat',
  LOCATION_LON:        'location_lon',
  AIRKOREA_API_KEY:    'airkorea_api_key',
  AIRKOREA_STATION:    'airkorea_station',
  GCAL_CLIENT_ID:      'gcal_client_id',
  GCAL_CLIENT_SECRET:  'gcal_client_secret',
  GEMINI_API_KEY:      'gemini_api_key',
  GEMINI_MODEL:        'gemini_model',
  AI_PROVIDER:         'ai_provider',
  AZURE_SPEECH_KEY:    'azure_speech_key',
  AZURE_SPEECH_REGION: 'azure_speech_region',
  AUTO_UPDATE_ENABLED: 'auto_update_enabled',   // 자동 업데이트 켜기(기본 꺼짐) — services/autoUpdate.js
}

// **.env 가 언제나 이기는 키** — 관리자 화면에 칸이 없어서 .env 말고는 바꿀 길이 없는 값들.
// 「DB 값 우선」 규칙을 그대로 적용하면 한 번 들어간 값을 .env 로 되돌릴 수 없다(공개판 검수
// c6 지적 6, 2026-10-17: 자동 업데이트를 한 번 켜면 `AUTO_UPDATE_ENABLED=0` 으로 바꿔도 안 꺼졌다).
// 빈 값(`AUTO_UPDATE_ENABLED=`)은 「안 적음」으로 보고 건드리지 않는다.
const ENV_WINS = new Set(['AUTO_UPDATE_ENABLED'])

function parseEnvFile(text) {
  const result = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

/**
 * **한 키를 여러 칸에 복사해 넣은 흔적**을 기동 때 알린다.
 *
 * 2026-09-06에 실제로 겪었다. `server/.env`에 같은 data.go.kr 키가 네 칸
 * (KMA_API_KEY·KMA_APIHUB_KEY·KMA_LIVING_API_KEY·KMA_ALERT_API_KEY)에 적혀 있었고,
 * 날씨·자외선이 전부 401이었다. **apihub.kma.go.kr는 apis.data.go.kr와 다른 서비스라
 * 전용 키가 필요하다**(현장 키는 22자, data.go.kr 키는 94자로 길이부터 다르다).
 *
 * 그때까지 아무 신호가 없었다 — 화면에는 날씨가 그냥 안 나올 뿐이었다.
 * 여기서 한 줄 찍는 것만으로 다음 사람이 몇 시간을 아낀다.
 *
 * **좁게 본다.** `kma_alert_api_key`와 `airkorea_api_key`는 같은 data.go.kr 서비스라
 * `kma_api_key`와 값이 같아도 정상이고(코드도 그렇게 폴백한다), `kma_living_api_key`도
 * 폴백이 있다. 확실히 틀린 것은 **apihub 하나**다. 오탐을 만들면 다음 사람이 경고를
 * 읽지 않게 되고, 그러면 이 장치는 없느니만 못하다.
 */
function warnIfApihubKeyLooksCopied(db = getDB()) {
  try {
    const 본키    = rawSetting(db, 'kma_api_key')
    const apihub = rawSetting(db, 'kma_apihub_key')
    if (!본키 || !apihub || 본키 !== apihub) return false
    console.warn('[설정 점검] kma_apihub_key가 kma_api_key와 같은 값입니다 —'
      + ' apihub.kma.go.kr는 다른 서비스라 전용 키가 필요합니다(401이 납니다).'
      + ' 관리자 화면 → 시스템 설정 → AI · API 연동에서 apihub 전용 키를 넣어 주세요.')
    return true
  } catch {
    // 점검이 기동을 막지 않는다 — 이건 안내일 뿐이다
    return false
  }
}

// envPath는 테스트에서만 오버라이드; 기본값은 실제 server/.env
function importEnvToSettings(envPath = path.join(__dirname, '..', '.env')) {
  // .env가 없어도 점검은 한다 — 잘못된 키는 **이미 DB에 들어앉아 있을 수 있다**.
  // 오늘 겪은 PC가 정확히 그 상태였다(.env로 한 번 들어간 뒤로는 .env를 고쳐도 안 바뀐다).
  if (!fs.existsSync(envPath)) { warnIfApihubKeyLooksCopied(); return { imported: [] } }

  const parsed = parseEnvFile(fs.readFileSync(envPath, 'utf8'))
  const db = getDB()
  const getExisting = (k) => rawSetting(db, k)
  const setSetting = (k, v) => db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(k, v)

  const imported = []
  for (const [envKey, settingKey] of Object.entries(ENV_TO_SETTING_KEY)) {
    const value = parsed[envKey]
    if (!value) continue
    const existing = getExisting(settingKey)
    if (ENV_WINS.has(envKey)) {
      if (existing === value) continue
    } else if (existing) continue // 관리자 화면에서 이미 입력한 값이 있으면 건드리지 않는다
    setSetting(settingKey, value)
    imported.push(settingKey)
  }
  // 채운 뒤에 본다 — 방금 .env에서 들어온 값도 검사 대상이다
  warnIfApihubKeyLooksCopied(db)
  return { imported }
}

module.exports = {
  importEnvToSettings, parseEnvFile, ENV_TO_SETTING_KEY, ENV_WINS, warnIfApihubKeyLooksCopied,
}
