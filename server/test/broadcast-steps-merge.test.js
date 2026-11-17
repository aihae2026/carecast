// 자동방송순서편집기(MorningEditor) 커스텀 스텝 유실 버그 회귀 테스트.
// settings.js의 parseSteps와 broadcastSequencer.js의 getSteps가 둘 다 DEFAULT_STEPS[tab].map(...)
// 기준으로만 배열을 재구성해서, 고정 ID에 없는 커스텀 스텝(TTS/메시지 추가 버튼으로 만든 것 포함)이
// 저장은 되지만 다시 불러올 때 조용히 사라지는 버그가 있었다. mergeStepsWithDefaults로 공유 로직을
// 추출해 이 버그를 고친다 — getSteps/parseSteps 양쪽 다 이 함수 하나만 고치면 같이 고쳐지게.
'use strict'

const path = require('path')
const os = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_stepsmerge_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { mergeStepsWithDefaults } = require('../services/broadcastSequencer')

test.after(() => {
  const fs = require('fs')
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const defaults = [
  { id: 'bgm', label: 'BGM 시작', enabled: true, order: 0 },
  { id: 'medication_tts', label: '투약 안내 (TTS)', enabled: true, order: 1, content: '기본 안내문' },
]

test('mergeStepsWithDefaults: 커스텀 스텝(고정 ID에 없는 것)이 결과에 포함된다', () => {
  const saved = [
    { id: 'bgm', label: 'BGM 시작', enabled: true, order: 0 },
    { id: 'medication_tts', label: '투약 안내 (TTS)', enabled: false, order: 1, content: '사용자 수정본' },
    { id: 'custom_tts_123', customType: 'tts', content: '커스텀 내용', label: '커스텀 방송', enabled: true, order: 2 },
  ]
  const merged = mergeStepsWithDefaults(defaults, saved)
  const custom = merged.find(s => s.id === 'custom_tts_123')
  assert.ok(custom, '커스텀 스텝이 병합 결과에서 사라지면 안 된다')
  assert.equal(custom.content, '커스텀 내용')
  assert.equal(custom.customType, 'tts')
})

test('mergeStepsWithDefaults: 여러 커스텀 스텝이 저장된 순서를 유지한 채 모두 포함된다', () => {
  const saved = [
    ...defaults,
    { id: 'custom_a', customType: 'bgm', label: 'A', enabled: true, order: 5, bgm_type: 'preset', bgm_value: '클래식 음악' },
    { id: 'custom_b', customType: 'delay', label: 'B', enabled: true, order: 6, wait_sec: 10 },
  ]
  const merged = mergeStepsWithDefaults(defaults, saved)
  const customIds = merged.filter(s => !defaults.some(d => d.id === s.id)).map(s => s.id)
  assert.deepEqual(customIds, ['custom_a', 'custom_b'])
})

test('mergeStepsWithDefaults: 기존 고정 스텝 병합 동작(enabled/content 사용자 값 유지, label은 기본값 사용)은 그대로다', () => {
  const saved = [
    { id: 'bgm', label: '무시될 라벨', enabled: false, order: 0 },
    { id: 'medication_tts', label: '무시될 라벨', enabled: true, order: 1, content: '사용자 수정본' },
  ]
  const merged = mergeStepsWithDefaults(defaults, saved)
  const bgm = merged.find(s => s.id === 'bgm')
  const med = merged.find(s => s.id === 'medication_tts')
  assert.equal(bgm.enabled, false)
  assert.equal(bgm.label, 'BGM 시작', '레이블은 항상 최신 기본값을 써야 한다(기존 동작)')
  assert.equal(med.content, '사용자 수정본')
})

test('mergeStepsWithDefaults: saved가 비어있으면 defaults를 order순 그대로 반환한다', () => {
  const merged = mergeStepsWithDefaults(defaults, [])
  assert.deepEqual(merged.map(s => s.id), ['bgm', 'medication_tts'])
})

// 회귀: 커스텀 스텝을 고정 스텝 사이로 드래그해서 저장해도, 병합 시 항상 고정 스텝들
// 뒤로 밀려나던 버그(순서 편집기에서 "위로 넣어도 저장하면 맨 아래"로 보이던 원인).
test('mergeStepsWithDefaults: 사용자가 재정렬한 순서(커스텀 스텝이 고정 스텝 사이에 낀 경우)를 그대로 반영한다', () => {
  const saved = [
    { id: 'bgm', label: 'BGM 시작', enabled: true, order: 0 },
    { id: 'custom_mid', customType: 'tts', content: '중간에 낀 커스텀', label: '중간 커스텀', enabled: true, order: 1 },
    { id: 'medication_tts', label: '투약 안내 (TTS)', enabled: true, order: 2, content: '기본 안내문' },
  ]
  const merged = mergeStepsWithDefaults(defaults, saved)
  assert.deepEqual(merged.map(s => s.id), ['bgm', 'custom_mid', 'medication_tts'],
    '사용자가 커스텀 스텝을 고정 스텝 사이로 옮겨서 저장했으면 그 순서 그대로 유지되어야 한다')
})

// 회귀: bgm_final은 "재생창 비활성화 버그" 방지를 위해 durationSec을 항상 기본값(10)으로
// 고정해야 하지만, 같은 로직이 bgm_closing처럼 원래 문제 없던 BGM 스텝의 사용자 저장값까지
// 덮어써서 "재생 시간(초)" 슬라이더가 장식으로만 존재하던 버그.
const eveningDefaults = [
  { id: 'bgm_closing', label: 'BGM 재시작 (안내 사이)',  enabled: true, order: 0, bgmSource: 'auto', durationSec: 0 },
  { id: 'bgm_final',   label: 'BGM 재시작 (문안인사 전)', enabled: true, order: 1, bgmSource: 'auto', durationSec: 10 },
]

test('mergeStepsWithDefaults: bgm_closing의 재생시간(durationSec)은 사용자 저장값을 존중하고, bgm_final은 안전 기본값(10)을 유지한다', () => {
  const saved = [
    { id: 'bgm_closing', label: 'x', enabled: true, order: 0, bgmSource: 'auto', durationSec: 30 },
    { id: 'bgm_final',   label: 'x', enabled: true, order: 1, bgmSource: 'auto', durationSec: 999 },
  ]
  const merged = mergeStepsWithDefaults(eveningDefaults, saved)
  const closing = merged.find(s => s.id === 'bgm_closing')
  const final   = merged.find(s => s.id === 'bgm_final')
  assert.equal(closing.durationSec, 30, 'bgm_closing은 사용자가 저장한 재생시간을 써야 한다')
  assert.equal(final.durationSec, 10, 'bgm_final은 재생창 비활성화 버그 방지를 위해 항상 기본값(10)을 써야 한다(기존 동작 유지)')
})
