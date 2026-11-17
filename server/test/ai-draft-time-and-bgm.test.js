// AI 초안 경로의 두 가지 구멍.
//
// 1) Gemini가 돌려준 시각의 HH:mm 형식(0 채움)을 아무도 검증하지 않았다 — '9:00'이면
//    지난시각 보정('9:00' <= '14:00'이 문자열 비교로 false)과 스케줄러의 정확 일치
//    발동('09:00'과 불일치)을 모두 통과 못 해, 조용히 영원히 안 울리는 예약이 됐다.
// 2) bgm 초안은 프롬프트가 content를 비우게 해서 장르(트로트·찬송가)가 통째로 유실됐고,
//    승인 시 bgm_value를 싣지 않아 발동 때마다 '클래식 음악' 프리셋으로 폴백했다 —
//    규칙 파서 경로(schedulePhrase)와 같은 증상, 다른 원인.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_aidraft2_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { insertDraft, approveDraft, normalizeHHMM } = require('../routes/scheduleDrafts')
const { todayStr } = require('../services/repeatSchedule')

// 고정 날짜를 쓰면 그날이 지나는 순간 CC-028(지난 날짜 차단)에 걸린다 — 내일로 계산한다.
const TOMORROW = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return todayStr(d) })()

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

// ── 시각 형식 정규화 ─────────────────────────────────────────────

test('0이 안 채워진 시각은 HH:mm으로 정규화된다', () => {
  assert.equal(normalizeHHMM('9:00'), '09:00')
  assert.equal(normalizeHHMM('9:5'), '09:05')
  assert.equal(normalizeHHMM('14:00'), '14:00')
})

test('시각이 아닌 값은 null — 조용히 이상한 예약을 만들지 않는다', () => {
  assert.equal(normalizeHHMM('25:00'), null)
  assert.equal(normalizeHHMM('12:60'), null)
  assert.equal(normalizeHHMM('아홉시'), null)
  assert.equal(normalizeHHMM(null), null)
  assert.equal(normalizeHHMM(undefined), null)
})

// ── bgm 초안 승인 시 검색어 전달 ────────────────────────────────

// 2026-09-21: BGM 은 이 PC 의 방송용 폴더에서 튼다(검색어로 찾던 외부 연동을 걷어냈다).
test('bgm 초안을 승인하면 방송용 BGM 폴더로 실리고, 문구는 안 읽는다', () => {
  const draft = insertDraft({
    raw_input: '내일 저녁 7시에 트로트 틀어줘',
    title: 'BGM',
    content: '트로트',
    scheduled_time: '19:00',
    repeat_start_date: TOMORROW,
    broadcast_type: 'bgm',
  })
  const { scheduleId } = approveDraft(draft.id)
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.broadcast_type, 'bgm')
  assert.equal(row.bgm_enabled, 1)
  assert.equal(row.bgm_type, 'local_broadcast', '이 PC 의 방송용 BGM 폴더가 아니다 — 서버가 해석하는 값과 갈린다')
  assert.equal(row.content, '', 'bgm은 읽을 문구가 없다 — 「트로트」가 TTS로 읽히면 안 된다')
})

test('text 초안 승인은 기존 그대로다 — content가 방송 문구로 남는다 (회귀)', () => {
  const draft = insertDraft({
    raw_input: '내일 오후 2시에 프로그램 안내',
    title: '프로그램 안내',
    content: '오후 프로그램을 안내드립니다. 감사합니다.',
    scheduled_time: '14:00',
    repeat_start_date: TOMORROW,
    broadcast_type: 'text',
  })
  const { scheduleId } = approveDraft(draft.id)
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId)
  assert.equal(row.content, '오후 프로그램을 안내드립니다. 감사합니다.')
  assert.equal(row.bgm_value, '', 'text 승인이 bgm_value를 건드리면 안 된다')
})
