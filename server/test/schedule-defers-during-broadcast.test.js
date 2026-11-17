// 자동방송 중의 예약은 미룬다 (td09 H5, (나)안 — 사용자 결정 2026-09-02).
//
// 자동방송 5종만 취소 토큰을 받고 예약은 토큰이 없어서, 자동방송 도중 예약 시각이 오면
// 시퀀서가 모른 채 예약 소리가 그 위에 얹혔다 — 안내 둘이 겹치면 어느 쪽도 못 알아듣는다.
// (나)안: 자동방송이 진행 중이면(nowPlaying.broadcast 존재) 예약을 미루고, 방송이 끝나면
// 곧바로 내보낸다. 상한(기본 10분)을 넘기면 건너뛰되 **이력에 실패로 적고 경보를 띄운다** —
// 조용한 누락이 제일 나쁘다.
//
// 고정하는 사실 다섯:
//  1. 자동방송 진행 중이면 예약이 그 분에 안 나가고 미룸 목록에 들어간다
//  2. 차임벨 예약은 미루지 않는다 — §3-B 규칙 5(차임은 공존)가 명세다
//  3. 방송이 끝나면 미뤄진 예약이 나간다
//  4. 상한을 넘기면 건너뛰고, 이력 실패 + 경보가 남는다
//  5. 미뤄진 사이 예약이 삭제·비활성화되면 조용히 버린다 — 사람이 지운 것을 실패로 적지 않는다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_defer_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

// ── 실제 소리가 나지 않도록 미리 심어 두는 스텁 (delivery-truth.test.js와 같은 방식) ──
const sent   = []
const chimes = []

const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }); return 1 },
    addClient: () => {}, clientCount: () => 1,
    localClientCount: () => 1, localAliveCount: () => 1,
  },
}
const chimePath = require.resolve('../services/chimePlayer')
require.cache[chimePath] = {
  id: chimePath, filename: chimePath, loaded: true, exports: {
    playChime: (type, volumePct) => { chimes.push({ type, volumePct }) },
    resolveChimeVolume: () => 0.8,
  },
}
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    generateTTS:          async () => '/tmp/fake.mp3',
    generateTTSWithRetry: async () => '/tmp/fake.mp3',
    readCues: () => null,   // 자막은 없는 셈 친다 — 여기서 보는 것은 소리와 페이로드다
    deleteTmpFile: () => {},
    rateToStr: () => '+0%', pitchToStr: () => '+0Hz', getPythonPath: () => null,
  },
}
const audioStorePath = require.resolve('../services/audioStore')
require.cache[audioStorePath] = {
  id: audioStorePath, filename: audioStorePath, loaded: true, exports: {
    storeAudio: () => 'fake-audio-id', consumeAudio: () => null,
  },
}

const { initDB, getDB } = require('../db/schema')
const nowPlaying = require('../services/nowPlaying')
const { _defer } = require('../services/scheduler')

function todayItem(id) {
  const router = require('../routes/schedules')
  const handler = router.stack.find(layer => layer.route?.path === '/today').route.stack[0].handle
  let body
  handler({}, { json(value) { body = value }, status(code) { throw new Error(`HTTP ${code}`) } })
  return body.items.find(item => item.kind === 'schedule' && item.id === id)
}

function makeDailySchedule(content) {
  const s = makeSchedule('text', content)
  getDB().prepare('UPDATE schedules SET repeat_weekdays = ? WHERE id = ?')
    .run('[0,1,2,3,4,5,6]', s.id)
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(s.id)
}

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

let seq = 0
function makeSchedule(broadcast_type, content = '') {
  const id = getDB().prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
    VALUES (?, ?, '전체', '10:00', 1, '2026-09-02', '[]', ?)
  `).run(`미룸테스트${++seq}`, content, broadcast_type).lastInsertRowid
  return getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
}

const lastLog = (needle) => getDB().prepare(
  'SELECT * FROM broadcasts WHERE content LIKE ? ORDER BY id DESC LIMIT 1').get(`%${needle}%`)

test.beforeEach(() => {
  sent.length = 0
  _defer.deferred.clear()
  nowPlaying.update({ broadcast: null })
})

// ── 사실 1: 진행 중이면 미룬다 ─────────────────────────────────────────────────
test('자동방송 진행 중이면 예약이 그 분에 안 나가고 미룸 목록에 들어간다', async () => {
  nowPlaying.update({ broadcast: { title: '아침방송' } })
  const s = makeSchedule('text', '점심 프로그램 안내')
  await _defer.deferOrFire(getDB(), s)

  assert.equal(_defer.deferred.size, 1, '미룸 목록에 안 들어갔다')
  assert.equal(sent.find(e => e.type === 'scheduled_broadcast'), undefined,
    '방송 이벤트가 나갔다 — 자동방송 위에 예약 안내가 얹힌다(td09 H5)')
  assert.equal(lastLog('점심 프로그램 안내'), undefined, '나가지도 않았는데 이력이 남았다')
})

// ── 사실 2: 차임은 공존 ────────────────────────────────────────────────────────
test('차임벨 예약은 미루지 않는다 — 차임은 공존이 명세다(§3-B 규칙 5)', async () => {
  nowPlaying.update({ broadcast: { title: '아침방송' } })
  const before = chimes.length
  const s = makeSchedule('chime')
  await _defer.deferOrFire(getDB(), s)

  assert.equal(chimes.length, before + 1, '차임벨이 안 나갔다')
  assert.equal(_defer.deferred.size, 0, '차임벨이 미룸 목록에 들어갔다')
})

// ── 사실 3: 방송이 끝나면 나간다 ───────────────────────────────────────────────
test('방송이 끝나면 미뤄진 예약이 나간다', async () => {
  nowPlaying.update({ broadcast: { title: '아침방송' } })
  const s = makeSchedule('text', '저녁 프로그램 안내')
  await _defer.deferOrFire(getDB(), s)
  assert.equal(_defer.deferred.size, 1)

  nowPlaying.update({ broadcast: null })
  await _defer.processDeferred(getDB())

  assert.equal(_defer.deferred.size, 0, '미룸 목록이 안 비워졌다')
  assert.ok(sent.find(e => e.type === 'scheduled_broadcast'),
    '방송이 끝났는데 미뤄진 예약이 안 나갔다')
  assert.equal(lastLog('저녁 프로그램 안내')?.success, 1, '이력이 성공으로 안 남았다')
})

// ── 사실 4: 상한을 넘기면 건너뛰고 요란하게 남긴다 ─────────────────────────────
test('상한을 넘기면 건너뛰고 이력 실패 + 경보가 남는다', async () => {
  nowPlaying.update({ broadcast: { title: '아주 긴 방송' } })
  const s = makeSchedule('text', '상한 초과 안내')
  await _defer.deferOrFire(getDB(), s)

  // 미룬 지 11분 지난 것으로 만든다 (기본 상한 10분)
  for (const d of _defer.deferred.values()) d.since = Date.now() - 11 * 60 * 1000
  await _defer.processDeferred(getDB())

  assert.equal(_defer.deferred.size, 0, '건너뛴 예약이 미룸 목록에 남아 있다')
  assert.equal(lastLog('상한 초과 안내')?.success, 0,
    '건너뛰었는데 이력이 없거나 성공으로 남았다 — 조용한 누락이 된다')
  const alert = getDB().prepare(
    "SELECT * FROM broadcasts WHERE type = '경보' AND content LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`%${s.title}%`)
  assert.ok(alert, '경보가 안 남았다 — 화면 배너도 안 뜬다')
})

// ── 사실 4-1: 상한은 설정값을 따른다 (2026-09-24) ──────────────────────────────
// 설정 화면(「겹친 예약 방송을 기다리는 최대 시간」)이 이 값을 바꾼다. 읽기 함수만 시험하면
// 판정 자리가 고정값 10 을 써도 초록이 된다(Codex 재검수 TEST_GAP) — 그래서 실제 판정으로 본다.
test('상한은 저장한 설정값을 따른다 — 20분이면 11분에는 아직 기다리고 21분에 건너뛴다', async () => {
  const db = getDB()
  db.prepare("INSERT INTO settings (key, value) VALUES ('schedule_defer_max_min', '20') ON CONFLICT(key) DO UPDATE SET value = '20'").run()
  try {
    nowPlaying.update({ broadcast: { title: '아주 긴 방송' } })
    const s = makeSchedule('text', '설정 상한 안내')
    await _defer.deferOrFire(db, s)

    for (const d of _defer.deferred.values()) d.since = Date.now() - 11 * 60 * 1000
    await _defer.processDeferred(db)
    assert.equal(_defer.deferred.size, 1, '설정은 20분인데 11분에 건너뛰었다 — 판정이 설정을 안 따른다')

    for (const d of _defer.deferred.values()) d.since = Date.now() - 21 * 60 * 1000
    await _defer.processDeferred(db)
    assert.equal(_defer.deferred.size, 0, '20분을 넘겼는데 안 건너뛰었다 — 위 단언이 헛돈다')
    assert.equal(lastLog('설정 상한 안내')?.success, 0)
  } finally {
    db.prepare("DELETE FROM settings WHERE key = 'schedule_defer_max_min'").run()
  }
})

// ── 사실 5: 그 사이 지워진 예약은 조용히 버린다 ────────────────────────────────
test('미뤄진 사이 비활성화된 예약은 조용히 버린다 — 사람이 지운 것을 실패로 적지 않는다', async () => {
  nowPlaying.update({ broadcast: { title: '아침방송' } })
  const s = makeSchedule('text', '지워질 안내')
  await _defer.deferOrFire(getDB(), s)
  getDB().prepare('UPDATE schedules SET active = 0 WHERE id = ?').run(s.id)

  nowPlaying.update({ broadcast: null })
  await _defer.processDeferred(getDB())

  assert.equal(_defer.deferred.size, 0)
  assert.equal(sent.find(e => e.type === 'scheduled_broadcast'), undefined, '지운 예약이 나갔다')
  assert.equal(lastLog('지워질 안내'), undefined, '지운 예약이 이력에 남았다')
})

// ── 사실 6: 날을 넘긴 미룸은 발사하지 않는다 (레드 검증 F2, 2026-09-02 심야) ─────
// 23:5x 예약이 미뤄져 자정을 넘기면 ① 요일 규칙이 다른 날로 새고 ② finishScheduleFire가
// 새 날짜로 last_fired를 찍어 **그날 밤 원래 시각 발화까지 통째로 막는다.** 날을 넘긴
// 미룸은 건너뛰되 이력·경보로 남기고, last_fired는 안 건드린다 — 오늘 발화는 살아야 한다.
test('자정을 넘긴 미룸은 건너뛰고, 그날 밤 원래 발화를 막지 않는다', async () => {
  nowPlaying.update({ broadcast: { title: '밤 방송' } })
  const s = makeSchedule('text', '어제자 안내')
  await _defer.deferOrFire(getDB(), s)
  // 자정을 넘겼다고 가정 — 키의 날짜를 어제로 바꾼다
  for (const [key, d] of [..._defer.deferred]) {
    _defer.deferred.delete(key)
    const parts = key.split('|'); parts[1] = '2026-09-01'
    _defer.deferred.set(parts.join('|'), d)
  }
  nowPlaying.update({ broadcast: null })
  await _defer.processDeferred(getDB())

  assert.equal(_defer.deferred.size, 0)
  assert.equal(sent.find(e => e.type === 'scheduled_broadcast'), undefined,
    '어제 미룬 예약이 오늘 새벽에 나갔다 — 요일 규칙도 안 보고 나간 방송이다')
  assert.equal(lastLog('어제자 안내')?.success, 0, '건너뛴 사실이 이력에 안 남았다')
  const row = getDB().prepare('SELECT last_fired FROM schedules WHERE id = ?').get(s.id)
  assert.equal(row.last_fired, null,
    'last_fired가 찍혔다 — 그날 밤 원래 시각의 발화가 통째로 건너뛰어진다(F2의 핵심)')
})

// ── 사실 7: 한 tick에 하나만 (레드 검증 F3) ─────────────────────────────────────
// 미룸이 여럿 쌓인 채 방송이 끝나면 연달아(TTS 생성 몇 초 간격) 몰려 나간다 — H5가
// 막으려던 겹침이 해제 순간 재현된다. 한 tick에 하나씩, 나머지는 다음 분에.
test('미뤄진 예약이 여럿이어도 한 tick에 하나만 나간다', async () => {
  nowPlaying.update({ broadcast: { title: '방송' } })
  const a = makeSchedule('text', '몰림A안내')
  const b = makeSchedule('text', '몰림B안내')
  await _defer.deferOrFire(getDB(), a)
  await _defer.deferOrFire(getDB(), b)
  assert.equal(_defer.deferred.size, 2)

  nowPlaying.update({ broadcast: null })
  await _defer.processDeferred(getDB())
  assert.equal(sent.filter(e => e.type === 'scheduled_broadcast').length, 1,
    '한 tick에 여럿이 몰려 나갔다 — 몇 초 간격 연속 방송은 겹쳐 들린다')
  assert.equal(_defer.deferred.size, 1)

  await _defer.processDeferred(getDB())
  assert.equal(_defer.deferred.size, 0, '다음 tick에 나머지가 나가야 한다')
})

test('서버 소리가 끝나고 화면 표시만 남으면 10분 제한 전에 예약을 내보낸다', async () => {
  nowPlaying.update({ broadcast: { title: '실제 방송 중' } })
  const s = makeDailySchedule('표시만 남은 뒤 안내')
  await _defer.deferOrFire(getDB(), s)
  for (const d of _defer.deferred.values()) d.since = Date.now() - 11 * 60 * 1000
  nowPlaying.update({ broadcast: { title: '끝난 서버 방송', 서버소리: true } })
  await _defer.processDeferred(getDB())
  assert.ok(sent.some(e => e.type === 'scheduled_broadcast'))
  assert.equal(lastLog(s.content)?.success, 1)
  assert.equal(todayItem(s.id)?.status, 'done')
})

test('진짜 방송 때문에 건너뛴 예약은 중복 발사를 막되 오늘 목록에서 안 나감이다', async () => {
  nowPlaying.update({ broadcast: { title: '진행 중인 방송' } })
  const s = makeDailySchedule('실패 표시 검증')
  await _defer.deferOrFire(getDB(), s)
  for (const d of _defer.deferred.values()) d.since = Date.now() - 11 * 60 * 1000
  await _defer.processDeferred(getDB())
  assert.ok(getDB().prepare('SELECT last_fired FROM schedules WHERE id = ?').get(s.id).last_fired)
  assert.equal(todayItem(s.id)?.status, 'missed')
})

test('과거 처리 날짜만 있고 연결된 결과가 없는 예약은 완료로 단정하지 않는다', () => {
  const s = makeDailySchedule('과거 기록')
  const { todayStr } = require('../services/repeatSchedule')
  getDB().prepare('UPDATE schedules SET last_fired = ? WHERE id = ?').run(todayStr(), s.id)
  assert.equal(todayItem(s.id)?.status, 'unknown')
})

test('서버 방송 표시는 실제 대기열·마이크가 바쁘거나 조회 불가일 때 계속 보호한다', () => {
  const qPath = require.resolve('../services/audioQueue')
  const mPath = require.resolve('../services/micLive')
  const originals = [require.cache[qPath], require.cache[mPath]]
  let queueBusy = false, micLive = false
  require.cache[qPath] = { exports: { isBusy: () => queueBusy }, loaded: true }
  require.cache[mPath] = { exports: { isLive: () => micLive }, loaded: true }
  try {
    nowPlaying.update({ broadcast: { title: '서버 표시', 서버소리: true } })
    assert.equal(_defer.broadcastInProgress(), false)
    queueBusy = true
    assert.equal(_defer.broadcastInProgress(), true)
    queueBusy = false; micLive = true
    assert.equal(_defer.broadcastInProgress(), true)
    micLive = false
    require.cache[qPath].exports.isBusy = () => { throw new Error('조회 불가') }
    assert.equal(_defer.broadcastInProgress(), true)
  } finally {
    for (const [index, key] of [qPath, mPath].entries()) {
      if (originals[index]) require.cache[key] = originals[index]
      else delete require.cache[key]
    }
  }
})

test('같은 문구 예약의 결과를 분리하고 비동기 결과 정정과 이력 삭제를 반영한다', async () => {
  const db = getDB()
  const a = makeDailySchedule('같은 환기 문구')
  const b = makeDailySchedule('같은 환기 문구')
  const { fireSchedule } = require('../services/scheduler')
  await fireSchedule(a, db)
  const logA = lastLog(a.content)
  await fireSchedule(b, db)
  db.prepare('UPDATE broadcasts SET success = 0 WHERE id = ?').run(logA.id)
  assert.equal(todayItem(a.id).status, 'missed')
  assert.equal(todayItem(b.id).status, 'done')
  db.prepare('UPDATE broadcasts SET success = 2 WHERE id = ?').run(logA.id)
  assert.equal(todayItem(a.id).status, 'pending')
  db.prepare('UPDATE broadcasts SET success = 1 WHERE id = ?').run(logA.id)
  assert.equal(todayItem(a.id).status, 'done')
  db.prepare('DELETE FROM broadcasts WHERE id = ?').run(logA.id)
  assert.equal(todayItem(a.id).status, 'unknown')
})

test('수동 재생 성공이 앞서 실패한 정시 예약의 결과를 덮지 않는다', async () => {
  const db = getDB()
  const s = makeDailySchedule('수동 구분 문구')
  const { fireSchedule } = require('../services/scheduler')
  await fireSchedule(s, db)
  db.prepare('UPDATE broadcasts SET success = 0 WHERE id = ?').run(lastLog(s.content).id)
  await fireSchedule({ ...s, _manual: true }, db)
  assert.equal(lastLog(s.content).success, 1)
  assert.equal(todayItem(s.id).status, 'missed')
})

test('환기방송 묶음이 실패·미확인 결과를 완료로 덮지 않는다', async () => {
  const { groupItems } = await import('../../src/lib/todayRows.js')
  const items = ['done', 'unknown'].map((status, index) => ({
    key: `schedule:${index}`, kind: 'schedule', group_id: 'dummy-group',
    time: index ? '09:20' : '09:10', label: '더미 환기방송', status,
  }))
  assert.equal(groupItems(items)[0].status, 'unknown')
  items[1].status = 'missed'
  assert.equal(groupItems(items)[0].status, 'missed')
})

test('늦은 화면 보고가 서버 표시를 덮어도 실제 자동방송은 보호한다', () => {
  const gate = require('../services/broadcastGate')
  gate.broadcastStart('더미 자동방송', 'exercise')
  try {
    nowPlaying.update({ broadcast: { title: '이미 끝난 즉시방송', 서버소리: true } })
    assert.equal(_defer.broadcastInProgress(), true)
  } finally {
    gate.broadcastComplete('더미 자동방송')
  }
  nowPlaying.update({ broadcast: { title: '뒤늦은 즉시방송 보고', 서버소리: true } })
  assert.equal(_defer.broadcastInProgress(), false)
})

test('결과 연결 저장만 실패해도 방송과 재발사 방지는 유지한다', async () => {
  const db = getDB()
  const s = makeDailySchedule('저장 실패 격리')
  db.exec(`CREATE TEMP TRIGGER reject_outcome BEFORE INSERT ON settings
    WHEN NEW.key LIKE 'schedule_%_last_broadcast'
    BEGIN SELECT RAISE(ABORT, 'test outcome write failure'); END`)
  try {
    await require('../services/scheduler').fireSchedule(s, db)
    assert.ok(sent.some(e => e.type === 'scheduled_broadcast'))
    assert.ok(db.prepare('SELECT last_fired FROM schedules WHERE id = ?').get(s.id).last_fired)
    assert.equal(todayItem(s.id).status, 'unknown')
  } finally { db.exec('DROP TRIGGER reject_outcome') }
})
