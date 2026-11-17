// 고도화 제안 #10 회귀 테스트 — "비상 방송 음성"이 저장은 되지만 실제 비상방송(priority=true)에
// 전혀 적용되지 않던 버그. loadTTSDefaults()가 priority 여부에 따라 tts_voice_normal /
// tts_voice_emergency 중 올바른 키를 읽는지 DB 레벨에서 직접 확인한다(옛 인터넷 합성 엔진 서브프로세스는
// 호출하지 않아 빠르다 — 실제 오디오 파이프라인은 tts-audio-path.test.js가 이미 덮는다).
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttsemergency_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { getDB, initDB } = require('../db/schema')
const { loadTTSDefaults } = require('../routes/tts')

test.before(() => {
  initDB()
  const db = getDB()
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('tts_voice_normal', 'ko-KR-SunHiNeural')
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('tts_voice_emergency', 'ko-KR-InJoonNeural')
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('loadTTSDefaults: priority=true면 tts_voice_emergency를 사용한다', () => {
  const db = getDB()
  const defaults = loadTTSDefaults(db, { priority: true })
  assert.equal(defaults.voice, 'ko-KR-InJoonNeural')
})

test('loadTTSDefaults: priority 미지정(기본)이면 기존과 동일하게 tts_voice_normal을 사용한다', () => {
  const db = getDB()
  const defaults = loadTTSDefaults(db)
  assert.equal(defaults.voice, 'ko-KR-SunHiNeural')
})

test('loadTTSDefaults: priority=false여도 tts_voice_normal을 사용한다', () => {
  const db = getDB()
  const defaults = loadTTSDefaults(db, { priority: false })
  assert.equal(defaults.voice, 'ko-KR-SunHiNeural')
})
