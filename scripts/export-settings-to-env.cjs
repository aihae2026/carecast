// 관리자 화면(API 연동 설정)에서 입력한 값을 server/.env로 내려받는다.
// 반대 방향(importEnvSettings.js: .env → settings, 아직 없는 키만)의 짝 — 이 스크립트는
// settings → .env로, DB에 값이 있는 키만 덮어쓴다. DB에 값이 없는 키의 기존 줄은 그대로 둔다
// (지우거나 비우지 않음 — 아직 안 쓴 키를 실수로 날리지 않기 위함).
//
// 이렇게 만들어두면 DB가 초기화되거나 새 PC로 옮길 때 importEnvSettings.js가 이 .env로
// 자동 복원해준다. 사용법: node scripts/export-settings-to-env.cjs
'use strict'

const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const { ENV_TO_SETTING_KEY } = require('../server/config/importEnvSettings')

const DB_PATH = path.join(__dirname, '..', 'server', 'db', 'database.db')
const ENV_PATH = path.join(__dirname, '..', 'server', '.env')

let db
try {
  db = new DatabaseSync(DB_PATH)
} catch {
  console.error(`[export-env] DB를 찾을 수 없습니다: ${DB_PATH} — 서버를 한 번 실행해주세요.`)
  process.exit(1)
}

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value

const existingLines = fs.existsSync(ENV_PATH)
  ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
  : []

const seenEnvKeys = new Set()
const updated = []
let changedCount = 0

for (const line of existingLines) {
  const m = line.match(/^([A-Z0-9_]+)\s*=/)
  if (!m) { updated.push(line); continue }
  const envKey = m[1]
  const settingKey = ENV_TO_SETTING_KEY[envKey]
  if (!settingKey) { updated.push(line); continue } // 이 스크립트가 모르는 키는 그대로 보존
  seenEnvKeys.add(envKey)
  const dbValue = getSetting(settingKey)
  if (dbValue) {
    updated.push(`${envKey}=${dbValue}`)
    changedCount++
  } else {
    updated.push(line) // DB에 값 없으면 기존 줄(빈 값이어도) 그대로 둠
  }
}

// .env에 아예 없던 매핑 키 중 DB에 값이 있는 것은 새로 추가
const newLines = []
for (const [envKey, settingKey] of Object.entries(ENV_TO_SETTING_KEY)) {
  if (seenEnvKeys.has(envKey)) continue
  const dbValue = getSetting(settingKey)
  if (dbValue) { newLines.push(`${envKey}=${dbValue}`); changedCount++ }
}

const finalContent = [...updated, ...newLines].join('\n').replace(/\n+$/, '\n')
fs.writeFileSync(ENV_PATH, finalContent)

console.log(`[export-env] server/.env 갱신 완료 — ${changedCount}개 키 반영`)
