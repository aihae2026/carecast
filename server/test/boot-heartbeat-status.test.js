// 생존 표식이 안 써지고 있으면 **감시가 「켜짐」이라고 말하지 않는다**
// (V③ DEV-MERGE-R10[2], HIGH, 2026-09-14).
//
// ── 무엇이 잘못됐나 ──────────────────────────────────────────────────────────
// `bootStatus` 가 `recorded`(= `recordBoot` 이 성공했나) **하나만** 보고 감시 상태를
// 「켜짐」이라고 말했다. 그런데 예약 누락 감시가 실제로 묻는 것은 *"그 시각에 서버가
// 떠 있었나"* 이고, 그 답은 `server_boot.last_seen_at` 이 자라야 나온다.
//
// `recordBoot` 은 성공했는데 그 뒤 `heartbeat` 쓰기가 계속 실패하면 **구간의 끝이 멈춘다.**
// 그러면 지금 이 순간이 「서버가 꺼져 있던 시간」으로 읽혀서, **진짜 누락이 조용히
// 「그때 꺼져 있었다」로 치워진다.** 그런데 화면·`/api/health` 는 「감시 켜짐」이다.
// 이 저장소가 가장 비싸게 겪는 실패(조용히 안 도는 것)의 전형이다.
//
// ── 이 시험이 보는 것 ────────────────────────────────────────────────────────
// **제품 모듈을 그대로 돌린다.** DB 만 대역으로 끼워서 UPDATE 를 실패시킨다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

process.env.CARECAST_NO_HARDWARE = '1'
const boot = require('../services/serverBoot')

/** 필요한 문장만 돌려주는 최소 DB 대역. `update실패` 면 UPDATE 만 던진다. */
function db대역({ update실패 = false } = {}) {
  return {
    prepare(sql) {
      if (/^INSERT INTO server_boot/i.test(sql.trim())) {
        return { run: () => ({ lastInsertRowid: 7 }) }
      }
      if (/^UPDATE server_boot/i.test(sql.trim())) {
        return { run: () => { if (update실패) throw new Error('database is locked'); return { changes: 1 } } }
      }
      if (/^SELECT id, started_at/i.test(sql.trim())) {
        return { get: () => ({ id: 7, started_at: 'x', last_seen_at: 'y', stopped_at: null }) }
      }
      return { get: () => null, all: () => [], run: () => ({}) }
    },
  }
}

test('생존 표식이 실패하고 있으면 감시를 「켜짐」이라 하지 않는다', () => {
  boot._reset()
  const db = db대역({ update실패: true })
  assert.ok(boot.recordBoot(db), '긍정 앵커 — 기동 기록 자체는 성공했다')

  boot.heartbeat(db, { now: new Date('2026-09-14T05:00:00Z') })

  const s = boot.bootStatus(db)
  assert.equal(s.recorded, true, '긍정 앵커 — 기동은 기록됐다(그래서 옛 판정이 「켜짐」이었다)')
  assert.equal(s.scheduleWatchdog, 'off',
    '생존 표식이 안 써지는데 「감시 켜짐」이라고 말한다 — 진짜 누락이 조용히 치워진다')
  assert.match(String(s.note || ''), /생존 표식/,
    '왜 꺼졌는지를 사람 말로 안 알려 준다')
})

test('표식이 잘 써지면 그대로 「켜짐」이다 — 과하게 끄지 않는다', () => {
  boot._reset()
  const db = db대역()
  assert.ok(boot.recordBoot(db))
  boot.heartbeat(db, { now: new Date('2026-09-14T05:00:00Z') })

  const s = boot.bootStatus(db)
  assert.equal(s.scheduleWatchdog, 'on', '멀쩡한데 감시가 꺼졌다고 한다')
  assert.equal(s.note, null, '멀쩡한데 경고 문구가 붙었다')
})

test('한 번 실패해도 다음 표식이 성공하면 되살아난다 — 영구 낙인이 아니다', () => {
  boot._reset()
  let 실패 = true
  const db = {
    prepare(sql) {
      if (/^INSERT INTO server_boot/i.test(sql.trim())) return { run: () => ({ lastInsertRowid: 7 }) }
      if (/^UPDATE server_boot/i.test(sql.trim())) {
        return { run: () => { if (실패) throw new Error('database is locked'); return { changes: 1 } } }
      }
      if (/^SELECT id, started_at/i.test(sql.trim())) {
        return { get: () => ({ id: 7, started_at: 'x', last_seen_at: 'y', stopped_at: null }) }
      }
      return { get: () => null, all: () => [], run: () => ({}) }
    },
  }
  boot.recordBoot(db)
  boot.heartbeat(db, { now: new Date('2026-09-14T05:00:00Z') })
  assert.equal(boot.bootStatus(db).scheduleWatchdog, 'off', '긍정 앵커 — 실패가 잡혔다')

  실패 = false
  boot.heartbeat(db, { now: new Date('2026-09-14T05:01:00Z') })
  assert.equal(boot.bootStatus(db).scheduleWatchdog, 'on',
    '다시 써지기 시작했는데도 꺼짐으로 남았다 — 사람이 경고를 무시하게 만든다')
})

test('기동 기록 자체가 실패하면 예전 판정 그대로 꺼짐이다 — 회귀 없음', () => {
  boot._reset()
  const 던지는db = { prepare() { throw new Error('no table') } }
  assert.equal(boot.recordBoot(던지는db), null, '긍정 앵커 — 기동 기록이 실패했다')
  const s = boot.bootStatus(db대역())
  assert.equal(s.recorded, false)
  assert.equal(s.scheduleWatchdog, 'off')
  assert.match(String(s.note || ''), /가동 기록/)
})
