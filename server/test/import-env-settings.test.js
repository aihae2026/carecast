// server/.env는 아무 코드도 읽지 않아서(전부 settings 테이블 기반) 실제로는 무효였던 문제 —
// 서버 시작 시 .env에 있는 값을 settings 테이블의 "아직 없는 키"에만 채워넣는 임포터 검증
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_envimport_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { importEnvToSettings, parseEnvFile } = require('../config/importEnvSettings')

const TEST_ENV_PATH = path.join(os.tmpdir(), `carecast_test_envfile_${process.pid}_${Date.now()}.env`)

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
  try { fs.unlinkSync(TEST_ENV_PATH) } catch { /* 파일 없으면 무시 */ }
})

test('parseEnvFile: KEY=VALUE, 주석, 빈 줄, 따옴표를 올바르게 처리한다', () => {
  const parsed = parseEnvFile([
    '# 주석',
    '',
    'SWITCHBOT_TOKEN=abc123',
    'SWITCHBOT_SECRET="quoted-value"',
    "YOUTUBE_API_KEY='single-quoted'",
  ].join('\n'))
  assert.equal(parsed.SWITCHBOT_TOKEN, 'abc123')
  assert.equal(parsed.SWITCHBOT_SECRET, 'quoted-value')
  assert.equal(parsed.YOUTUBE_API_KEY, 'single-quoted')
})

test('.env 파일이 없으면 아무 것도 하지 않는다', () => {
  const result = importEnvToSettings(path.join(os.tmpdir(), 'no-such-file.env'))
  assert.deepEqual(result.imported, [])
})

test('매핑된 키는 settings 테이블에 없을 때만 채워진다', () => {
  fs.writeFileSync(TEST_ENV_PATH, 'SWITCHBOT_TOKEN=my-token\nSWITCHBOT_SECRET=my-secret\n')
  const result = importEnvToSettings(TEST_ENV_PATH)
  assert.ok(result.imported.includes('switchbot_token'))
  assert.ok(result.imported.includes('switchbot_secret'))

  const db = getDB()
  assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('switchbot_token')?.value, 'my-token')
})

test('DB에 이미 값이 있으면 .env 값으로 덮어쓰지 않는다', () => {
  const db = getDB()
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('youtube_api_key', 'admin-entered-value')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run()

  fs.writeFileSync(TEST_ENV_PATH, 'YOUTUBE_API_KEY=env-value-should-be-ignored\n')
  const result = importEnvToSettings(TEST_ENV_PATH)
  assert.ok(!result.imported.includes('youtube_api_key'))

  const value = db.prepare('SELECT value FROM settings WHERE key = ?').get('youtube_api_key')?.value
  assert.equal(value, 'admin-entered-value')
})

// 자동 업데이트는 화면에 켜고 끄는 칸이 없다 — .env 로 켰으면 .env 로 끌 수 있어야 한다(c6 지적 6).
test('AUTO_UPDATE_ENABLED 는 .env 값이 DB 값을 덮는다 — 0 으로 바꾸면 꺼진다', () => {
  const db = getDB()
  const 값 = () => db.prepare('SELECT value FROM settings WHERE key = ?').get('auto_update_enabled')?.value
  fs.writeFileSync(TEST_ENV_PATH, 'AUTO_UPDATE_ENABLED=1\n')
  importEnvToSettings(TEST_ENV_PATH)
  assert.equal(값(), '1')

  fs.writeFileSync(TEST_ENV_PATH, 'AUTO_UPDATE_ENABLED=0\n')
  const r = importEnvToSettings(TEST_ENV_PATH)
  assert.ok(r.imported.includes('auto_update_enabled'), '.env 로 끈 것이 DB 에 안 들어갔다')
  assert.equal(값(), '0')

  // 빈 칸은 「안 적음」 — 이미 정한 값을 지우지 않는다
  fs.writeFileSync(TEST_ENV_PATH, 'AUTO_UPDATE_ENABLED=\n')
  importEnvToSettings(TEST_ENV_PATH)
  assert.equal(값(), '0')
})

test('매핑되지 않은 ENV 키는 무시한다', () => {
  fs.writeFileSync(TEST_ENV_PATH, 'SOME_RANDOM_KEY=whatever\n')
  const result = importEnvToSettings(TEST_ENV_PATH)
  assert.deepEqual(result.imported, [])
})

// ── 한 키를 여러 칸에 복사해 넣은 흔적을 기동 때 알린다 (2026-09-06) ──────
//
// 실제로 겪었다: server/.env 에 같은 data.go.kr 키가 네 칸에 적혀 있었고 날씨·자외선이
// 전부 401 이었다. **그때까지 아무 신호가 없었다** — 화면에는 날씨가 안 나올 뿐이었다.
//
// **좁게 본다.** kma_alert_api_key·airkorea_api_key 는 같은 data.go.kr 서비스라
// kma_api_key 와 값이 같아도 정상이다(코드도 그렇게 폴백한다). 확실히 틀린 것은
// apihub 하나다 — 오탐을 만들면 다음 사람이 경고를 안 읽게 되고, 그러면 없느니만 못하다.

test('apihub 키가 본 키와 같으면 경고한다', () => {
  const { warnIfApihubKeyLooksCopied } = require('../config/importEnvSettings')
  const db = getDB()
  const 넣기 = (k, v) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(k, v)

  const 찍힌것 = []
  const 원래 = console.warn
  console.warn = (...a) => 찍힌것.push(a.join(' '))
  try {
    넣기('kma_api_key', 'AAAA-같은키')
    넣기('kma_apihub_key', 'AAAA-같은키')
    assert.equal(warnIfApihubKeyLooksCopied(db), true, '같은 값인데 경고를 안 한다')
  } finally { console.warn = 원래 }

  assert.match(찍힌것.join('\n'), /apihub/, '무엇이 문제인지 안 알려 준다')
  assert.match(찍힌것.join('\n'), /401/, '증상을 안 알려 줘서 사람이 연결을 못 짓는다')
})

test('오탐을 만들지 않는다 — 정상인 경우들', () => {
  const { warnIfApihubKeyLooksCopied } = require('../config/importEnvSettings')
  const db = getDB()
  const 넣기 = (k, v) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(k, v)

  // 1) 제대로 다른 키를 넣은 정상 상태
  넣기('kma_api_key', 'AAAA-데이터포털키')
  넣기('kma_apihub_key', 'BBBB-아피허브키')
  assert.equal(warnIfApihubKeyLooksCopied(db), false, '제대로 넣었는데 경고한다')

  // 2) alert·airkorea 는 같은 data.go.kr 서비스라 본 키와 같아도 정상이다
  넣기('kma_alert_api_key', 'AAAA-데이터포털키')
  넣기('airkorea_api_key', 'AAAA-데이터포털키')
  assert.equal(warnIfApihubKeyLooksCopied(db), false,
    '같은 서비스의 키가 같다고 경고한다 — 오탐이다')

  // 3) apihub 키를 아직 안 넣은 PC 도 정상이다(그 기능만 안 쓸 뿐)
  넣기('kma_apihub_key', '')
  assert.equal(warnIfApihubKeyLooksCopied(db), false, '비어 있는데 경고한다')
})
