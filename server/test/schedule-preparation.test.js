'use strict'
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const test = require('node:test'), assert = require('node:assert/strict')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-prepare-'))
process.env.CARECAST_DB_PATH = path.join(dir, 'fixture.db')
process.env.CARECAST_NO_HARDWARE = '1'
const T = require('../services/tts')
const cacheDir = path.join(dir, 'cache')
let calls = 0, fail = false, failText = null, gate = null
const events = []
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath].exports = { ...T, cachePathFor: p => T.cachePathFor(p, cacheDir),
  generateTTSWithRetry: (params, retries, opts = {}) => T.generateTTSWithRetry(params, 1, { ...opts, cacheDir,
    generate: async p => {
      calls++; if (gate) await gate; if (fail || p.text === failText) throw Error('fixture synthesis failure')
      const f = path.join(dir, `audio-${calls}.mp3`)
      fs.writeFileSync(f, Buffer.alloc(4096, 1))
      fs.writeFileSync(T.cuesPathOf(f), JSON.stringify([[0, 1, p.text]]))
      return f
    } }) }
// A real scheduler call may emit events, but can never address a real client or speaker here.
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = { id: ssePath, filename: ssePath, loaded: true, exports: { broadcastSSE(type, data) { events.push({ type, data }) }, getClients: () => [], hasPlayerClient: () => true } }
const { initDB, getDB } = require('../db/schema')
const S = require('../services/scheduler')
const { loadTTSConfig } = require('../services/broadcastConfig')
const { todayStr } = require('../services/repeatSchedule')
const { startTestApp } = require('./helpers/testApp')
let app
const future = new Date(); future.setDate(future.getDate() + 1)
const body = (over = {}) => ({ title: '더미 안내', target: 'all', content: '더미 방송 문구', scheduled_time: '12:00', repeat_start_date: todayStr(future), repeat_weekdays: [], active: 1, ...over })
const request = async (url, method, value) => {
  const r = await fetch(app.baseUrl + url, { method, headers: { 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) })
  return { status: r.status, data: await r.json() }
}
const flush = async () => { await new Promise(r => setImmediate(r)); await S.waitForSchedulePrewarm() }
function ready(id) {
  const row = getDB().prepare('SELECT * FROM schedules WHERE id=?').get(id)
  const params = S.ttsParamsForSchedule(row, loadTTSConfig(getDB()))
  const f = T.cachePathFor(params, cacheDir)
  return fs.existsSync(f) && fs.existsSync(T.cuesPathOf(f))
}
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/schedules': require('../routes/schedules'), '/api/schedule-drafts': require('../routes/scheduleDrafts'), '/api/settings': require('../routes/settings') })
})
test.after(async () => {
  gate = null
  if (S.waitForSchedulePrewarm) await flush()
  await app.close()
  getDB().close()
  fs.rmSync(dir, { recursive: true, force: true })
})
test('POST prepares audio and captions; PUT prepares changed content; re-enable prepares missing cache', async () => {
  const created = await request('/api/schedules', 'POST', body())
  assert.equal(created.status, 200)
  assert.equal(typeof S.waitForSchedulePrewarm, 'function', 'registration preparation worker is missing')
  await flush(); assert.ok(ready(created.data.id)); const before = calls
  assert.equal((await request('/api/schedules/' + created.data.id, 'PUT', body({ content: '수정된 더미 문구' }))).status, 200)
  await flush(); assert.ok(ready(created.data.id)); assert.equal(calls, before + 1)
  const off = await request('/api/schedules', 'POST', body({ content: '비활성 더미 문구', active: 0 }))
  await flush(); assert.equal(ready(off.data.id), false)
  await request('/api/schedules/' + off.data.id + '/toggle', 'PATCH')
  await flush(); assert.ok(ready(off.data.id))
})
test('AI draft HTTP approval prepares the accepted schedule', async () => {
  const { insertDraft } = require('../routes/scheduleDrafts')
  const draft = insertDraft({ ...body({ content: 'AI 승인 더미 안내' }), raw_input: '더미 예약' })
  const r = await request('/api/schedule-drafts/' + draft.id + '/approve', 'POST', {})
  assert.equal(r.status, 200); await flush()
  const row = getDB().prepare('SELECT id FROM schedules WHERE content=?').get('AI 승인 더미 안내')
  assert.ok(row); assert.ok(ready(row.id))
})
test('response succeeds while synthesis is pending; synthesis failure is counted', async () => {
  let release; gate = new Promise(r => { release = r })
  const r = await request('/api/schedules', 'POST', body({ content: '지연 시험 문구' }))
  assert.equal(r.status, 200)
  fail = true; release(); gate = null
  await flush(); fail = false
  assert.equal(ready(r.data.id), false)
  assert.ok(S.schedulePrewarmStats().failed > 0)
})
test('11:50 scan fills 12:00, skips hits before counting five, then progresses to remaining items', async () => {
  getDB().prepare('DELETE FROM schedules').run()
  const { insertSchedule } = require('../services/scheduleStore')
  const ids = []
  for (let i = 0; i < 8; i++) ids.push(insertSchedule(body({ content: '그물 더미 ' + i, repeat_start_date: '2026-09-03', repeat_weekdays: [0,1,2,3,4,5,6] })))
  const now = new Date('2026-09-03T11:50:00+09:00'), before = calls
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), now), 5)
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), now), 3)
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), now), 0)
  assert.equal(calls - before, 8)
  for (const id of ids) assert.ok(ready(id))
})
test('settings save does not synthesize; next scan uses new voice; cached firing does not synthesize', async () => {
  const before = calls
  // 기본(SunHi)과 **다른 실재 목소리**여야 한다. 예전엔 'fixture-new-voice' 를 썼는데, 저장 검사가
  // 생긴 뒤로는 없는 목소리가 400 이다(tts-voice-guard.test.js — GookMin 사고).
  const r = await request('/api/settings/tts', 'POST', { voiceNormal: 'ko-KR-InJoonNeural' })
  assert.equal(r.status, 200); await flush(); assert.equal(calls, before)
  const now = new Date('2026-09-03T11:50:00+09:00')
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), now), 5)
  const row = getDB().prepare('SELECT * FROM schedules ORDER BY id LIMIT 1').get()
  const count = calls
  const rod = require('../services/renderOnDemand')
  const misses = rod.missStats().total
  await S.fireSchedule(row, getDB())
  assert.equal(calls, count); assert.equal(rod.missStats().total, misses)
  const fired = events.findLast(e => e.type === 'scheduled_broadcast')
  assert.ok(fired); assert.ok(fired.data.cues.lines.length)
  T.deleteTmpFile(require('../services/audioStore').consumeAudio(fired.data.audioId))
})
test('midnight checks the occurrence date and tomorrow last_fired rather than today', async () => {
  getDB().prepare('DELETE FROM schedules').run()
  const { insertSchedule } = require('../services/scheduleStore')
  const id = insertSchedule(body({ content: '자정 더미', scheduled_time: '00:00', repeat_start_date: '2026-09-04', repeat_weekdays: [] }))
  getDB().prepare('UPDATE schedules SET last_fired=? WHERE id=?').run('2026-09-03', id)
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), new Date('2026-09-03T23:50:00+09:00')), 1)
  assert.ok(ready(id))
})
test('cache use rejuvenates both audio and cues; expiration is repaired by the scan', async () => {
  const row = getDB().prepare('SELECT * FROM schedules ORDER BY id LIMIT 1').get()
  const params = S.ttsParamsForSchedule(row, loadTTSConfig(getDB())), f = T.cachePathFor(params, cacheDir), cues = T.cuesPathOf(f)
  const old = new Date(Date.now() - 40 * 86400000)
  fs.utimesSync(f, old, old); fs.utimesSync(cues, old, old)
  const before = calls
  const tmp = await require('../services/tts').generateTTSWithRetry(params); T.deleteTmpFile(tmp)
  assert.equal(calls, before)
  assert.ok(Date.now() - fs.statSync(f).mtimeMs < 5000)
  assert.ok(Date.now() - fs.statSync(cues).mtimeMs < 5000)
  fs.utimesSync(f, old, old); fs.utimesSync(cues, old, old); T.pruneCache(cacheDir, 30)
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), new Date('2026-09-03T23:50:00+09:00')), 1)
})

test('busy scan skips overlapping ticks; a failed first item cannot starve later schedules', async () => {
  getDB().prepare('DELETE FROM schedules').run()
  const { insertSchedule } = require('../services/scheduleStore')
  for (let i = 0; i < 6; i++) insertSchedule(body({ content: 'fairness fixture ' + i, repeat_start_date: '2026-09-03', repeat_weekdays: [0,1,2,3,4,5,6] }))
  const now = new Date('2026-09-03T11:50:00+09:00')
  let release; gate = new Promise(r => { release = r }); failText = 'fairness fixture 0'
  const first = S.prewarmUpcomingSchedules(getDB(), now)
  await new Promise(r => setImmediate(r))
  const count = calls
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), now), 0)
  assert.equal(calls, count)
  release(); gate = null
  assert.equal(await first, 4)
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), now), 1)
  const last = getDB().prepare('SELECT id FROM schedules WHERE content=?').get('fairness fixture 5')
  assert.ok(ready(last.id)); failText = null
})

test('no schedules means no automatic morning or static-lane synthesis', async () => {
  getDB().prepare('DELETE FROM schedules').run()
  const before = calls
  assert.equal(await S.prewarmUpcomingSchedules(getDB(), new Date('2026-09-03T07:50:00+09:00')), 0)
  assert.equal(calls, before)
})
