// 1회성 데이터 보정(mealFlowAnchorFix, main 전용) 검증.
// 현장 DB를 볼 수 없는 상태에서 배포되는 보정이라, 예상되는 데이터 모양들을 전부 재현해서
// "맞는 단계만 건드리고 나머지는 절대 안 건드린다"를 고정한다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_anchorfix_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { applyMealFlowAnchorFix, DONE_KEY } = require('../config/mealFlowAnchorFix')

let seq = 0
function makeFlow(steps) {
  const db = getDB()
  const now = new Date().toISOString()
  const id = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(`보정테스트${++seq}`, now, now).lastInsertRowid
  const ins = db.prepare(`
    INSERT INTO flow_sequence_steps (flow_sequence_id, sort_order, step_type, label, config)
    VALUES (?, ?, ?, ?, ?)
  `)
  steps.forEach((s, i) => ins.run(id, i, s.step_type, s.label || '', JSON.stringify(s.config || {})))
  return id
}

function makeFlowSchedule(time, flowId, active = 1) {
  const db = getDB()
  return db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays,
                           broadcast_type, flow_sequence_id)
    VALUES (?, '', '전체', ?, ?, '2026-08-28', '[0,1,2,3,4,5,6]', 'flow', ?)
  `).run(`보정예약${++seq}`, time, active, flowId).lastInsertRowid
}

const stepConfigs = (flowId) => getDB()
  .prepare('SELECT step_type, config FROM flow_sequence_steps WHERE flow_sequence_id = ? ORDER BY sort_order')
  .all(flowId).map(s => ({ type: s.step_type, config: JSON.parse(s.config || '{}') }))

const resetDone = () => getDB().prepare('DELETE FROM settings WHERE key = ?').run(DONE_KEY)

test.before(() => { initDB() })

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('점심(11:00 발동)·저녁(16:00 발동) 동요 흐름의 "음원 뒤 첫 BGM"에 11:15/16:20이 들어간다', () => {
  const db = getDB()
  const lunch  = makeFlow([{ step_type: 'audio' }, { step_type: 'audio' }, { step_type: 'bgm' }, { step_type: 'tts' }])
  const dinner = makeFlow([{ step_type: 'audio' }, { step_type: 'bgm' }])
  makeFlowSchedule('11:00', lunch)
  makeFlowSchedule('16:00', dinner)

  applyMealFlowAnchorFix(db)

  assert.equal(stepConfigs(lunch)[2].config.at_time, '11:15')
  assert.equal(stepConfigs(dinner)[1].config.at_time, '16:20')
  // 음원·TTS 단계는 건드리지 않는다
  assert.equal(stepConfigs(lunch)[0].config.at_time, undefined)
  assert.equal(stepConfigs(lunch)[3].config.at_time, undefined)
  // 실행 기록이 남는다
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(DONE_KEY)
  assert.ok(done?.value.includes('11:15'), '기록에 무엇을 바꿨는지 남아야 한다')
})

test('BGM 선재생이 앞에 있는 흐름: 음원 앞의 BGM은 두고, 음원 뒤 BGM에만 건다', () => {
  const db = getDB()
  resetDone()
  const flow = makeFlow([{ step_type: 'bgm', label: '선재생' }, { step_type: 'audio' }, { step_type: 'bgm', label: '식사BGM' }])
  makeFlowSchedule('10:50', flow)

  applyMealFlowAnchorFix(db)

  const cfg = stepConfigs(flow)
  assert.equal(cfg[0].config.at_time, undefined, '선재생 BGM에 걸면 엉뚱한 단계가 끊긴다')
  assert.equal(cfg[2].config.at_time, '11:15')
})

test('사람이 이미 넣어둔 예약 시각은 절대 덮어쓰지 않는다', () => {
  const db = getDB()
  resetDone()
  const flow = makeFlow([{ step_type: 'audio' }, { step_type: 'bgm', config: { at_time: '11:10' } }])
  makeFlowSchedule('11:05', flow)

  applyMealFlowAnchorFix(db)

  assert.equal(stepConfigs(flow)[1].config.at_time, '11:10')
})

test('한 번 실행되면 다시는 실행되지 않는다 — 재부팅마다 값이 되살아나면 안 된다', () => {
  const db = getDB()
  resetDone()
  applyMealFlowAnchorFix(db)   // 1회차 실행(기록 남김)

  // 이후에 새 대상이 생겨도(사용자가 시각을 지웠어도) 다시 건드리지 않는다
  const flow = makeFlow([{ step_type: 'audio' }, { step_type: 'bgm' }])
  makeFlowSchedule('11:00', flow)
  applyMealFlowAnchorFix(db)

  assert.equal(stepConfigs(flow)[1].config.at_time, undefined,
    '한 번 끝난 보정이 재부팅마다 다시 돌면, 사람이 지운 값이 계속 되살아난다')
})

test('시간대 밖·비활성·비flow 예약은 건드리지 않고, 대상이 없어도 죽지 않는다', () => {
  const db = getDB()
  resetDone()
  // 앞 테스트들이 만든 시간대 안 예약을 전부 꺼서 "정말 대상이 없는" 상태를 만든다
  db.prepare("UPDATE schedules SET active = 0 WHERE broadcast_type = 'flow'").run()
  const off      = makeFlow([{ step_type: 'audio' }, { step_type: 'bgm' }])   // 시간대 밖
  const inactive = makeFlow([{ step_type: 'audio' }, { step_type: 'bgm' }])   // 비활성
  makeFlowSchedule('14:00', off)
  makeFlowSchedule('11:00', inactive, 0)
  db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES ('일반예약', '내용', '전체', '11:00', 1, '2026-08-28', '[]', 'text')
  `).run()

  applyMealFlowAnchorFix(db)

  assert.equal(stepConfigs(off)[1].config.at_time, undefined)
  assert.equal(stepConfigs(inactive)[1].config.at_time, undefined)
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(DONE_KEY)
  assert.ok(done?.value.includes('대상 흐름 예약 없음'), '대상이 없으면 그 사실을 기록한다')
})
