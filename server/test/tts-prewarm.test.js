// 예약 음성을 **10분 전에 미리 만든다** — "12:00 예약인데 12:01에 나온다"의 2번 갈래.
//
// 캐시 우선(tts-cache-first)만으로는 **문구를 새로 쓴 예약의 첫 발사**가 여전히 합성을
// 기다린다. 그래서 발사 10분 전 tick에서 미리 만들어 캐시에 넣어 둔다.
//
// 고정하는 사실 여섯:
//  1. 10분 뒤 예약의 음성을 미리 만든다
//  2. **발사 때와 같은 키**다 — 문구를 두 곳에서 지으면 미리 만든 것이 통째로 버려진다
//     (반복 방송의 "두 번 읽기"까지 같아야 한다)
//  3. 이미 캐시에 있으면 다시 만들지 않는다
//  4. 오늘 안 도는 요일·꺼진 예약·이미 나간 예약·TTS 아닌 유형은 만들지 않는다
//  5. 한 tick에 한도(5건)까지만 — 같은 분에 여럿이면 나머지는 예전대로 발사 때 만든다
//  6. 미리 만들다 실패해도 **던지지 않는다** — 그때는 발사 시각에 예전처럼 합성한다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_prewarm_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

// 진짜 옛 인터넷 합성 엔진를 부르지 않는다(네트워크·수 초). 캐시 저장은 진짜 코드가 하게 둔다 —
// "미리 만들면 캐시에 남는가"가 이 테스트의 핵심이라 그 부분을 가짜로 만들면 아무것도 안 본다.
const realTts = require('../services/tts')
const CACHE_DIR = path.join(os.tmpdir(), `carecast_test_prewarmcache_${process.pid}_${Date.now()}`)
fs.mkdirSync(CACHE_DIR, { recursive: true })

let synthCount = 0
let synthFails = false
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true, exports: {
    ...realTts,
    cachePathFor: (params) => realTts.cachePathFor(params, CACHE_DIR),
    generateTTSWithRetry: (params) => realTts.generateTTSWithRetry(params, 1, {
      cacheDir: CACHE_DIR,
      generate: async (p) => {
        synthCount += 1
        if (synthFails) throw new Error('TTS 생성 타임아웃 (60초 초과)')
        const f = path.join(os.tmpdir(), `carecast_pw_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`)
        fs.writeFileSync(f, 'MP3:' + p.text.slice(0, 10) + 'x'.repeat(4096))
        fs.writeFileSync(realTts.cuesPathOf(f), JSON.stringify([[0, 1, p.text]]))
        return f
      },
    }),
  },
}

const { initDB, getDB } = require('../db/schema')
const scheduler = require('../services/scheduler')

// 2026-09-03(목) 11:50 — 10분 뒤가 12:00이다
const NOW = new Date('2026-09-03T11:50:10+09:00')

test.before(() => { initDB() })
test.after(() => {
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }) } catch { /* 무시 */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

let seq = 0
function addSchedule(fields = {}) {
  const db = getDB()
  // **반복은 repeat_weekdays로 판정한다**(shouldRunToday). repeat_type은 외부 도구용
  // 요약 컬럼이라 여기에 'daily'를 넣어도 오늘 도는 예약이 되지 않는다.
  return db.prepare(`
    INSERT INTO schedules
      (title, content, scheduled_time, broadcast_type, active, target, repeat_weekdays, repeat_broadcast, last_fired)
    VALUES (?, ?, ?, ?, ?, '전체', ?, ?, ?)
  `).run(
    fields.title ?? `예약${++seq}`,
    fields.content ?? `안내 문구 ${seq}`,
    fields.scheduled_time ?? '12:00',
    fields.broadcast_type ?? 'text',
    fields.active ?? 1,
    fields.repeat_weekdays ?? '[0,1,2,3,4,5,6]',   // 매일
    fields.repeat_broadcast ?? 0,
    fields.last_fired ?? null,
  ).lastInsertRowid
}

function clearSchedules() {
  getDB().prepare('DELETE FROM schedules').run()
  try { for (const f of fs.readdirSync(CACHE_DIR)) fs.unlinkSync(path.join(CACHE_DIR, f)) } catch { /* 무시 */ }
  synthCount = 0
}

test('사실1·2 — 10분 뒤 예약을 미리 만들고, 발사 때와 같은 키다', async () => {
  clearSchedules()
  const id = addSchedule({ content: '점심 식사 시간입니다', scheduled_time: '12:00' })

  const warmed = await scheduler.prewarmUpcomingSchedules(getDB(), NOW)
  assert.equal(warmed, 1)
  assert.equal(synthCount, 1)

  // 발사 경로가 만드는 파라미터와 같은 캐시 파일이어야 한다
  const row = getDB().prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  const tts = require('../services/broadcastConfig').loadTTSConfig(getDB())
  const params = scheduler.ttsParamsForSchedule(row, tts)
  assert.ok(fs.existsSync(realTts.cachePathFor(params, CACHE_DIR)),
    '미리 만든 것과 발사 때 찾는 것이 다른 키다 — 미리 만들기가 통째로 헛일이 된다')
})

test('사실2-b — 반복 방송은 두 번 읽은 문구가 곧 키다', () => {
  const tts = { voice: 'v', rate: 0.9, pitch: 1 }
  const once = scheduler.ttsParamsForSchedule({ content: '안내', repeat_broadcast: 0 }, tts)
  const twice = scheduler.ttsParamsForSchedule({ content: '안내', repeat_broadcast: 1 }, tts)
  assert.equal(once.text, '안내')
  assert.equal(twice.text, '안내 다시 한번 알려드립니다. 안내')
  assert.equal(scheduler.ttsParamsForSchedule({ content: '   ' }, tts), null, '빈 문구는 만들 것이 없다')
})

test('사실3 — 이미 캐시에 있으면 다시 만들지 않는다', async () => {
  clearSchedules()
  addSchedule({ content: '같은 문구', scheduled_time: '12:00' })
  await scheduler.prewarmUpcomingSchedules(getDB(), NOW)
  assert.equal(synthCount, 1)

  const again = await scheduler.prewarmUpcomingSchedules(getDB(), NOW)
  assert.equal(again, 0, '이미 있는데 또 만들었다')
  assert.equal(synthCount, 1)
})

test('사실4 — 만들지 말아야 할 것은 안 만든다', async () => {
  clearSchedules()
  addSchedule({ scheduled_time: '13:00' })                       // 10분 뒤가 아니다
  addSchedule({ scheduled_time: '12:00', active: 0 })            // 꺼져 있다
  addSchedule({ scheduled_time: '12:00', last_fired: '2026-09-03' }) // 오늘 이미 나갔다
  addSchedule({ scheduled_time: '12:00', broadcast_type: 'chime' })  // TTS를 안 쓴다
  addSchedule({ scheduled_time: '12:00', broadcast_type: 'audio' })  // 파일 재생이다
  addSchedule({ scheduled_time: '12:00', content: '' })              // 읽을 문구가 없다
  // 오늘 안 도는 예약. 빈 요일 목록은 **어느 날에 돌려도** 오늘이 아니다 —
  // shouldRunToday는 (주입한 시각이 아니라) 실제 오늘을 보므로 요일을 박으면 테스트가 요일을 탄다.
  addSchedule({ scheduled_time: '12:00', repeat_weekdays: '[]' })

  assert.equal(await scheduler.prewarmUpcomingSchedules(getDB(), NOW), 0)
  assert.equal(synthCount, 0)
})

test('사실5 — 한 tick에 다섯 건까지만', async () => {
  clearSchedules()
  for (let i = 0; i < 8; i++) addSchedule({ content: `문구 ${i}`, scheduled_time: '12:00' })
  assert.equal(await scheduler.prewarmUpcomingSchedules(getDB(), NOW), 5)
})

test('사실6 — 실패해도 던지지 않는다', async () => {
  clearSchedules()
  addSchedule({ content: '실패할 문구', scheduled_time: '12:00' })
  synthFails = true
  const warmed = await scheduler.prewarmUpcomingSchedules(getDB(), NOW)
  synthFails = false
  assert.equal(warmed, 0, '실패는 0건으로 센다')
  // 던지지 않았다는 것 자체가 이 테스트의 결론이다 — 발사 시각에 예전처럼 합성한다
})

test('매분 tick이 미리 만들기를 부르되 기다리지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  assert.match(src, /prewarmUpcomingSchedules\(db\)\.catch\(/,
    '기다리면 미리 만들기가 늦을 때 지금 나갈 방송이 밀린다')
  assert.doesNotMatch(src, /await prewarmUpcomingSchedules\(/, 'tick이 미리 만들기를 기다리고 있다')
})
