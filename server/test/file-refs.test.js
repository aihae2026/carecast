'use strict'
// UX-29 — **쓰고 있는 파일은 안 지운다** (2026-09-11).
//
// 예약이 쓰는 음원을 지우면 그 시각에 `reportMissingSource` 가 돌고 **홀은 조용하다.**
// 지운 사람은 목록에서 사라진 것만 본다 — 며칠 뒤 "그 방송 왜 안 나와요" 로 돌아온다.
// 되돌릴 수 없는 일이라, **어디서 쓰는지 말해 주고 막는다.**
//
// 참조처가 셋이고 **모양이 다 다르다** — 컬럼 하나(예약) · JSON 배열 안(흐름 단계) ·
// 설정 문자열 안(자동방송 편집기). 한 곳에서 모아 보지 않으면 반드시 하나를 빠뜨린다.
const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_filerefs_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')
const { initDB, getDB } = require('../db/schema')
const { 쓰는곳 } = require('../domain/fileRefs')

test.before(() => { initDB() })
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 그만 */ } }
})

// `flow_sequences` 는 `created_at`·`updated_at` 이 **둘 다** NOT NULL 이다 — 스키마를 안
// 지킨 시험 자료는 코드가 아니라 **자료가 틀린 것**이고, 그 실패는 결함을 못 본다.
const 만든흐름 = (db, 이름) => {
  const 지금 = new Date().toISOString()
  return db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(이름, 지금, 지금)
}

const 비우기 = () => {
  const db = getDB()
  db.prepare('DELETE FROM schedules').run()
  db.prepare('DELETE FROM flow_sequence_steps').run()
  db.prepare('DELETE FROM flow_sequences').run()
  db.prepare("DELETE FROM settings WHERE key LIKE '%_steps'").run()
}

test('아무도 안 쓰면 빈 목록이다 — 멀쩡한 삭제를 막으면 그게 더 나쁘다', () => {
  비우기()
  assert.deepEqual(쓰는곳(getDB(), 999), [])
})

test('예약이 쓰면 잡는다 — 컬럼 하나', () => {
  비우기()
  getDB().prepare(`INSERT INTO schedules (title, scheduled_time, broadcast_type, audio_file_id, active)
    VALUES (?, ?, ?, ?, 1)`).run('환기 방송', '09:10', 'audio', 42)
  const r = 쓰는곳(getDB(), 42)
  assert.equal(r.length, 1, `예약 참조를 못 봤다: ${JSON.stringify(r)}`)
  assert.match(r[0], /환기 방송/, '어느 예약인지 안 알려준다 — 사람이 못 고친다')
  assert.match(r[0], /09:10/, '언제 나가는 것인지 안 알려준다')
})

test('**꺼 둔 예약은 안 센다** — 안 나가는 방송 때문에 못 지우면 안 된다', () => {
  비우기()
  getDB().prepare(`INSERT INTO schedules (title, scheduled_time, broadcast_type, audio_file_id, active)
    VALUES (?, ?, ?, ?, 0)`).run('꺼둔 예약', '10:00', 'audio', 42)
  assert.deepEqual(쓰는곳(getDB(), 42), [])
})

test('흐름 단계가 쓰면 잡는다 — JSON 안에 묻혀 있다', () => {
  비우기()
  const db = getDB()
  const f = 만든흐름(db,'저녁 흐름').lastInsertRowid
  db.prepare(`INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, config)
    VALUES (?, 0, 'audio', ?)`).run(f, JSON.stringify({ audio_file_id: 42 }))
  const r = 쓰는곳(db, 42)
  assert.equal(r.length, 1, `흐름 참조를 못 봤다: ${JSON.stringify(r)}`)
  assert.match(r[0], /저녁 흐름/, '어느 흐름인지 안 알려준다')
})

test('**재생목록 배열 안**에 있어도 잡는다 — 모양이 하나가 아니다', () => {
  비우기()
  const db = getDB()
  const f = 만든흐름(db,'묶음 흐름').lastInsertRowid
  db.prepare(`INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, config)
    VALUES (?, 0, 'audio', ?)`).run(f, JSON.stringify({ playlist: [{ audio_file_id: 7 }, { audio_file_id: 42 }] }))
  assert.equal(쓰는곳(db, 42).length, 1, '배열 안쪽을 안 본다 — 재생목록으로 쓰면 못 잡는다')
  assert.equal(쓰는곳(db, 7).length, 1)
  assert.equal(쓰는곳(db, 8).length, 0, '없는 것을 있다고 한다')
})

test('자동방송 편집기가 쓰면 잡는다 — 설정 문자열 안', () => {
  비우기()
  const db = getDB()
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .run('lunch_steps', JSON.stringify([{ id: 'x', customType: 'audio', audio_file_id: 42 }]))
  const r = 쓰는곳(db, 42)
  assert.equal(r.length, 1, `자동방송 참조를 못 봤다: ${JSON.stringify(r)}`)
  assert.match(r[0], /점심/, '어느 자동방송인지 안 알려준다')
})

test('같은 곳이 여러 번 나와도 한 줄이다 — 목록이 길면 사람이 안 읽는다', () => {
  비우기()
  const db = getDB()
  const f = 만든흐름(db,'반복 흐름').lastInsertRowid
  for (const i of [0, 1, 2]) {
    db.prepare(`INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, config)
      VALUES (?, ?, 'audio', ?)`).run(f, i, JSON.stringify({ audio_file_id: 42 }))
  }
  assert.equal(쓰는곳(db, 42).length, 1)
})

test('삭제 라우트가 이 판정을 실제로 쓴다 — 모듈만 있으면 아무것도 안 고친 것이다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'audio.js'), 'utf8')
  const m = /router\.delete\('\/:id'[\s\S]*?\n\}\)/.exec(src)
  assert.ok(m, '파일 삭제 라우트를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[0], /쓰는곳\(db, id\)/, '참조를 안 본다 — 쓰는 파일이 그냥 지워진다')
  assert.match(m[0], /409/, '막았는데 상태 코드가 성공 계열이면 화면이 지워진 줄 안다')
  // **지우기 전에** 봐야 한다 — 지우고 나서 물어보면 이미 늦다.
  assert.ok(m[0].indexOf('쓰는곳') < m[0].indexOf('unlinkSync'),
    '파일을 지운 뒤에 참조를 본다 — 순서가 뒤집혔다')
})

test('화면이 막힌 이유를 사람에게 보여준다 — 콘솔에만 남기지 않는다', () => {
  const mm = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src/components/admin/sections/MusicManagement.jsx'), 'utf8')
  assert.match(mm, /setDeleteError\(e\.message/,
    '삭제 실패를 콘솔에만 남긴다 — 사람은 버튼이 고장 난 줄 알고 계속 누른다')
  assert.match(mm, /\{deleteError &&/, '막힌 이유를 화면에 안 그린다')
  // 스스로 사라지면 "왜 안 지워졌지" 만 남는다 — 사람이 닫는다.
  assert.match(mm, /setDeleteError\(''\)/, '닫을 방법이 없다')
})

test('**설정 숫자와 번호가 같아도 쓰는 곳이 아니다** — durationMin:15 가 15번 곡을 막았다(2026-09-21 QA 재현)', () => {
  비우기()
  const db = getDB()
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .run('morning_steps', JSON.stringify([{ id: 'bgm', durationMin: 15, volume: 42, bgmOrder: 'seq' }]))
  assert.deepEqual(쓰는곳(db, 15), [], '길이 칸의 15 를 15번 곡으로 읽었다 — 곡을 못 지운다')
  assert.deepEqual(쓰는곳(db, 42), [], '볼륨 칸의 42 를 42번 곡으로 읽었다')
})

test('**글자로 든 재생목록 번호도 잡는다** — 흐름 영상 재생목록은 ["14","13"] 모양이다', () => {
  비우기()
  const db = getDB()
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .run('lunch_steps', JSON.stringify([{ id: 'v', customType: 'video_file', playlist: ['14', '13'] }]))
  assert.equal(쓰는곳(db, 14).length, 1, '글자 번호를 못 봤다 — 쓰는 영상이 지워진다')
  assert.equal(쓰는곳(db, 12).length, 0)
})
