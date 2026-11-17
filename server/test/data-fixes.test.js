// 2026-08-31 CC-039. server/index.js에 1회성 데이터 보정 블록 8개(약 130줄)가 퇴적해 있었고,
// 그중 6개가 완전한 빈 catch였다(실패해도 아무 흔적이 없다). 더 나쁜 것은 **적용 여부를
// 기록하지 않아 매 부팅마다 다시 돈다**는 점이다 — 현장에서 사람이 체조 시각을 16:15로 다시
// 맞춰 놓아도 재부팅하면 조용히 16:20으로 되돌아간다. "1회성 보정"이 아니라 영구 강제였다.
//
// 여기서 고정하는 것 셋:
//   1) 첫 실행에서 옛 값이 교정된다(기존 동작 유지)
//   2) 사람이 되돌린 값을 두 번째 실행이 다시 안 건드린다(마커)
//   3) 한 보정이 던져도 나머지가 돌고, 던진 것은 마커를 안 남겨 다음 부팅에 재시도된다
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_datafix_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')

const set = (k, v) => getDB().prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, v)
const get = (k) => getDB().prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? null

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

test('첫 실행에서 옛 값들을 교정한다', () => {
  set('uv_area_no', '1100000000')   // 일반 예시 코드 — 공개판의 자외선 지역코드 보정은 빈 보정이라 건드리지 않아야 한다
  set('dinner_tts', 'test')
  set('video_audio_delay_ms', '500')
  set('exercise_broadcast_time', '08:40')
  set('lunch_bgm_duration', '0')
  set('lunch_prayer_tts', '시설이 직접 쓴 식사 안내')   // 식사 안내 문구 보정은 빈 보정 — 첫 문장이 무엇이든 건드리지 않는다

  applyDataFixes(getDB())

  assert.equal(get('uv_area_no'), '1100000000', '사람이 넣은 지역코드를 부팅 보정이 바꿨다')
  assert.equal(get('lunch_prayer_tts'), '시설이 직접 쓴 식사 안내', '시설이 쓴 식사 안내 문구를 부팅 보정이 덮었다')
  assert.notEqual(get('dinner_tts'), 'test')
  assert.equal(get('video_audio_delay_ms'), '450')
  assert.equal(get('exercise_broadcast_time'), '09:00')
  assert.equal(get('lunch_bgm_duration'), '5')
})

test('모든 보정이 마커를 남긴다', () => {
  for (const fix of DATA_FIXES) {
    assert.ok(get(fix.key), `${fix.key} 마커가 없다 — 다음 부팅에 또 돈다`)
    assert.ok(fix.key.startsWith('datafix_'), '마커는 datafix_ 접두어여야 한다(현장 기초값 추출에서 제외되는 규칙)')
  }
})

test('사람이 되돌린 값을 두 번째 실행이 다시 안 고친다', () => {
  // 현장에서 "저녁 체조는 16:15가 낫다"고 되돌린 상황
  set('exercise_broadcast_time', '08:40')
  set('video_audio_delay_ms', '500')

  applyDataFixes(getDB())

  assert.equal(get('exercise_broadcast_time'), '08:40', '사람이 정한 값을 부팅이 뒤집으면 안 된다')
  assert.equal(get('video_audio_delay_ms'), '500')
})

test('한 보정이 던져도 나머지는 돌고, 던진 것은 마커를 안 남긴다', () => {
  const boom = { key: 'datafix_test_boom', label: '일부러 실패', run() { throw new Error('의도된 실패') } }
  const ok   = { key: 'datafix_test_ok',   label: '뒤에 오는 보정', run(db) {
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('datafix_test_touched', 'yes')
    return ['건드림']
  } }

  applyDataFixes(getDB(), [boom, ok])

  assert.equal(get('datafix_test_boom'), null, '실패한 보정은 마커를 안 남겨야 다음 부팅에 재시도된다')
  assert.equal(get('datafix_test_touched'), 'yes', '앞의 실패가 뒤의 보정을 막으면 안 된다')
  assert.ok(get('datafix_test_ok'), '성공한 보정은 마커를 남긴다')
})

test('index.js는 인라인 보정 블록 대신 dataFixes를 부른다', () => {
  const src = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  assert.ok(/applyDataFixes/.test(src), 'index.js가 applyDataFixes를 부르지 않는다')
  assert.equal((src.match(/\[DB 마이그레이션\]/g) || []).length, 0,
    '보정 블록이 index.js에 남아 있다 — config/dataFixes.js 한 곳에 모은다')
  assert.equal((src.match(/\} catch \{\}/g) || []).length, 0,
    'index.js에 완전한 빈 catch가 남아 있다(실패가 흔적 없이 사라진다)')
})
