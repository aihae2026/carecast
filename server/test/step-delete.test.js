// 자동순서 단계 삭제 — 기본 단계도 지운다 (2026-10-23 사용자 신고).
//
// 「단계 편집하면 위아래로 바꾸거나 추가하는 것만 있지 이미 등록된 걸 삭제하는 기능은 없다」.
// 삭제 버튼은 추가한 단계에만 있었다. 기본 단계는 저장본에서 빼도 `mergeStepsWithDefaults` 가
// 기본값으로 다시 채워 넣기 때문이다. 그래서 화면은 빼는 대신 `deleted: true` 를 남기고,
// 병합이 그 단계를 **언제나 꺼진 단계**로 둔다 — 방송·예상 시간은 `enabled` 만 보고 건너뛴다.
'use strict'

const path = require('path')
const os = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stepdelete_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { mergeStepsWithDefaults, getSteps, DEFAULT_STEPS } = require('../services/broadcastSequencer')
const { getDB, initDB } = require('../db/schema')
const { editorSource } = require('./helpers/editorSource')

test.after(() => {
  const fs = require('fs')
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const defaults = [
  { id: 'bgm', label: 'BGM 시작', enabled: true, order: 0 },
  { id: 'evening_prayer_tts', label: '삼종기도 안내 (TTS)', enabled: true, order: 1 },
  { id: 'evening_closing_tts', label: '저녁 문안인사 (TTS)', enabled: true, order: 2 },
]

test('지운 기본 단계는 병합 뒤에도 지운 채 꺼져 있다 — 기본값으로 되살아나지 않는다', () => {
  const saved = [
    { id: 'bgm', enabled: true, order: 0 },
    { id: 'evening_closing_tts', enabled: true, order: 1 },
    { id: 'evening_prayer_tts', enabled: false, deleted: true, order: 2 },
  ]
  const s = mergeStepsWithDefaults(defaults, saved).find(x => x.id === 'evening_prayer_tts')
  assert.equal(s.deleted, true)
  assert.equal(s.enabled, false)
})

test('화면이 deleted 인데 enabled:true 로 보내도 방송에서 빠진다', () => {
  const saved = [{ id: 'evening_prayer_tts', enabled: true, deleted: true, order: 1 }]
  const s = mergeStepsWithDefaults(defaults, saved).find(x => x.id === 'evening_prayer_tts')
  assert.equal(s.enabled, false, 'enabled 만 보는 방송·예상 시간이 따로 고치지 않아도 건너뛰어야 한다')
})

test('지우지 않은 단계는 그대로다 (기존 성질 보존)', () => {
  const saved = [{ id: 'evening_prayer_tts', enabled: true, order: 1 }]
  const merged = mergeStepsWithDefaults(defaults, saved)
  assert.ok(merged.every(s => !s.deleted))
  assert.equal(merged.find(x => x.id === 'evening_prayer_tts').enabled, true)
})

test('저장한 뒤 다시 읽어도(getSteps) 지운 표시가 남는다', () => {
  initDB()
  const db = getDB()
  const steps = DEFAULT_STEPS.evening_prayer.map((s, i) =>
    s.id === 'evening_prayer_tts' ? { ...s, deleted: true, enabled: false, order: i } : { ...s, order: i })
  db.prepare("INSERT INTO settings (key, value) VALUES ('evening_prayer_steps', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(steps))
  const got = getSteps(db, 'evening_prayer').find(s => s.id === 'evening_prayer_tts')
  assert.equal(got.deleted, true)
  assert.equal(got.enabled, false)
})

// ── 화면 ─────────────────────────────────────────────────────
const SRC = editorSource()

test('삭제 버튼이 추가한 단계에만 묶여 있지 않다 — 모든 단계에 있다', () => {
  assert.doesNotMatch(SRC, /\{isCustom && \(\s*<button[^>]*?deleteStep/s, '예전처럼 isCustom 일 때만 그리면 기본 단계를 못 지운다')
  assert.match(SRC, /deleteCard\(\[step\.id\]\)/,
    'TTS 카드 안에 접힌 BGM 은 남긴다 — 같이 지우면 저녁기도 「삼종기도 안내」만 빼려다 첫 BGM 까지 빠진다')
})

test('기본 단계는 배열에서 빼지 않고 지운 표시를 남긴다 — 빼면 서버가 되살린다', () => {
  assert.match(SRC, /!s\.customType\)\s*\n?\s*\.map\(s => \(\{ \.\.\.s, deleted: true, enabled: false \}\)\)/)
})

test('지운 단계는 목록에서 감추고, 되살릴 길이 있다', () => {
  assert.match(SRC, /const steps = 전체단계\.filter\(s => !s\.deleted\)/)
  assert.match(SRC, /restoreStep\(s\.id\)/)
})

test('삭제는 두 번 눌러야 된다 — 한 번 실수로 방송 단계가 사라지지 않게', () => {
  assert.match(SRC, /if \(지울후보 === step\.id\) deleteCard/)
})

test('모든 단계에 「수정」 버튼이 있다', () => {
  assert.match(SRC, /aria-label=\{isExpanded \? '수정 닫기' : '수정'\}/)
})
