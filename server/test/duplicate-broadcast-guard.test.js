// **같은 방송이 두 번 나가지 않는다** (사용자 지시 2026-09-14).
//
// *"같은 실행의 중복 클릭·중복 요청을 방지한다."*
// *"중복 실행 방지는 카드의 클릭 잠금뿐 아니라 **서버의 중복 요청·재시도 처리**까지 확인해라."*
//
// ── 왜 화면 잠금만으로는 모자라나 ────────────────────────────────────────────
// 단추를 잠가도 서버에 요청이 두 번 닿는 길이 남는다:
//   · 응답이 늦어 **브라우저가 재시도**한다(사람은 한 번 눌렀다).
//   · **다른 PC·다른 창**에서 같은 방송을 누른다(현장에 원격 PC가 있다).
//   · 잠그기 전에 손가락이 두 번 닿는다(P3 「두 번 누르는 시설장」).
// 전관 스피커로 나간 소리는 되돌릴 수 없다. 그러므로 **마지막 방어선은 서버**여야 한다.
//
// ── 어떤 규칙인가 ────────────────────────────────────────────────────────────
// 시간 창이 아니라 **「아직 나가고 있나」**로 본다. 창(예: 5초)으로 막으면 짧으면 못 막고
// 길면 **일부러 다시 내보내는 길**을 막는다 — 재방송은 현장에서 자주 쓰는 기능이다.
// 같은 방송이 **끝난 뒤**에는 몇 번이든 다시 나간다.
'use strict'

process.env.CARECAST_DB_PATH = ':memory:'
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')

// 대역을 **라우트보다 먼저** 끼운다(`instant-tts-options.test.js` 와 같은 이유 —
// 라우트가 로드 시점에 함수를 값으로 묶는다).
const 기록 = { enqueue: [], 풀기: [] }
require('../services/audioQueue').enqueue = (f, p, d, v) => {
  기록.enqueue.push({ file: f, priority: p, device: d, volume: v })
  // **재생이 끝나는 시점을 시험이 쥔다** — 나가는 중인지 끝났는지를 갈라 봐야 한다.
  return new Promise(r => { 기록.풀기.push(r) })
}
require('../services/tts').generateTTSWithRetry = () => Promise.resolve('/tmp/더미.mp3')
const chime = require('../services/chimePlayer')
chime.playChime = (t, v, cb) => { cb && cb(true) }
chime.부수차임막힘 = () => null
require('../domain/broadcastRecord').시작기록 = () => 1
require('../services/sse').broadcastSSE = () => {}
require('../services/audioDevices').resolveDeviceIndex = async () => ({ index: null })

const TTS_ROUTER = require('../routes/tts')

test.before(() => { initDB() })

function 라우트찾기(router, 경로) {
  for (const layer of router.stack || []) {
    if (layer.route && layer.route.path === 경로) {
      const st = layer.route.stack
      return st[st.length - 1].handle
    }
  }
  return null
}

async function 보내기(body) {
  const handler = 라우트찾기(TTS_ROUTER, '/broadcast')
  const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  await handler({ body, get: () => undefined }, res)
  await new Promise(r => setTimeout(r, 20))
  return res
}
/** 나가던 방송들을 끝낸다. */
async function 재생끝(){ 기록.풀기.splice(0).forEach(r => r()); await new Promise(r => setTimeout(r, 20)) }
function 비우기() { 기록.enqueue.length = 0; 기록.풀기.length = 0 }

test('긍정 앵커 — 서로 다른 방송 둘은 둘 다 나간다', async () => {
  비우기()
  await 보내기({ text: '첫째 안내입니다' })
  await 보내기({ text: '둘째 안내입니다' })
  assert.equal(기록.enqueue.length, 2, '다른 방송인데 하나가 막혔다 — 막는 규칙이 너무 넓다')
  await 재생끝()
})

test('**같은 방송을 두 번 보내면 한 번만 나간다** — 되돌릴 수 없는 소리다', async () => {
  비우기()
  const 첫 = await 보내기({ text: '점심 식사 시간입니다' })
  const 둘 = await 보내기({ text: '점심 식사 시간입니다' })
  assert.equal(첫.code, 200, '첫 요청이 거절됐다')
  assert.equal(기록.enqueue.length, 1,
    `같은 방송이 ${기록.enqueue.length}번 대기열에 들어갔다 — 어르신은 같은 말을 두 번 듣는다`)
  assert.equal(둘.code, 409, `둘째 요청이 ${둘.code} 로 끝났다 — 막았으면 그렇다고 말해야 한다`)
  assert.match(둘.body?.error || '', /\S/, '**조용히 버렸다** — 왜 안 나갔는지 화면이 말할 수 없다')
  await 재생끝()
})

test('**끝난 뒤에는 다시 나간다** — 일부러 하는 재방송을 막지 않는다', async () => {
  비우기()
  await 보내기({ text: '다시 알려드립니다' })
  await 재생끝()                                   // 방송이 끝났다
  const 다시 = await 보내기({ text: '다시 알려드립니다' })
  assert.equal(다시.code, 200, '끝난 방송을 다시 내보내는 길이 막혔다 — 재방송은 현장 기능이다')
  assert.equal(기록.enqueue.length, 2, '두 번째가 대기열에 안 들어갔다')
  await 재생끝()
})

test('음량·대상이 다르면 **다른 방송**이다 — 한 벌로 뭉뚱그리지 않는다', async () => {
  비우기()
  await 보내기({ text: '같은 문구입니다', volume: 30 })
  const 다름 = await 보내기({ text: '같은 문구입니다', volume: 80 })
  assert.equal(다름.code, 200, '음량만 다른 방송을 같은 것으로 봤다')
  assert.equal(기록.enqueue.length, 2, '다른 방송인데 막혔다')
  await 재생끝()
})

// ── 잠금 자체 ────────────────────────────────────────────────────────────────
// 열쇠가 **끼는** 것이 이 장치의 고장 모드다(풀어 줄 자리가 예외로 건너뛰어지는 경우).
// 그러면 그 방송은 **영영 안 나간다** — 막으려던 것보다 나쁜 결과다. 상한을 둔다.
test('열쇠가 끼어도 방송이 **영영 막히지 않는다** — 상한을 둔다', () => {
  const { 겹침잠금 } = require('../services/duplicateBroadcast')
  const 열쇠 = '시험|끼임'
  const 첫 = 겹침잠금(열쇠, 0)
  assert.equal(첫.ok, true, '첫 잠금이 안 걸린다')
  assert.equal(겹침잠금(열쇠, 1000).ok, false, '1초 뒤 같은 방송이 그냥 나간다')
  // 풀어 주는 자리를 **일부러 안 부른다** — 예외로 건너뛰어진 상황이다.
  assert.equal(겹침잠금(열쇠, 61_000).ok, true,
    '풀어 주는 자리를 놓치면 그 방송이 영영 막힌다 — 상한이 없다')
})

test('풀면 곧바로 다시 걸 수 있다', () => {
  const { 겹침잠금 } = require('../services/duplicateBroadcast')
  const 열쇠 = '시험|풀기'
  const 첫 = 겹침잠금(열쇠, 0)
  첫.풀기()
  assert.equal(겹침잠금(열쇠, 1).ok, true, '풀었는데도 잠겨 있다')
})

// ── 예약 수동 재생(`POST /api/schedules/:id/trigger`) ────────────────────────
// 이 길은 증상이 다르다. 발사 전에 **앞 소리를 밀어내므로**(P-43), 두 번 누르면
// "두 번 들린다"가 아니라 **나가던 방송이 처음으로 되감긴다** — 말이 끊겼다 다시 시작한다.
// 둘 다 안 되는 결과다. 판정은 위와 **같은 모듈**이 한다(규칙이 두 벌이면 곧 갈린다).
test('같은 예약을 두 번 누르면 **한 번만 발사한다** — 되감기지 않는다', async () => {
  // ── **대역이 진짜처럼 굴게 한다** (V③ 지적, 2026-09-14) ─────────────────────────
  // 앞 판은 `fireSchedule` 을 **재생이 끝날 때까지 기다리는** 대역으로 세웠다. 그런데 진짜
  // `fireSchedule` 은 브라우저에 재생을 **지시하고 바로 돌아온다**(`scheduler.js:538`).
  // 그 차이 때문에 잠금이 몇 밀리초 만에 풀리는 것을 **시험이 못 봤다** — 가짜 오라클이다.
  // 이제 대역도 **바로 돌아온다.** 그래서 잠금은 발사 약속이 아니라 「두 번 누름 창」이
  // 잡고 있어야 한다.
  const 발사 = []
  const sch = require('../services/scheduler')
  sch.fireSchedule = (s) => { 발사.push(s.id); return Promise.resolve() }   // ← 즉시 돌아온다
  require('../services/broadcastGate').cancelCurrentBroadcast = () => {}
  const { getDB } = require('../db/schema')
  const db = getDB()
  db.prepare("INSERT INTO schedules (title, content, scheduled_time, broadcast_type, active) VALUES (?,?,?,?,0)")
    .run('겹침 시험 예약', '겹침 시험 문구입니다', '09:30', 'text')
  const id = db.prepare("SELECT id FROM schedules WHERE title = '겹침 시험 예약'").get().id

  const SCH_ROUTER = require('../routes/schedules')
  const 누르기 = async () => {
    const h = 라우트찾기(SCH_ROUTER, '/:id/trigger')
    const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await h({ params: { id: String(id) }, body: {}, get: () => undefined }, res)
    await new Promise(r => setTimeout(r, 30))
    return res
  }
  assert.equal((await 누르기()).code, 200, '첫 누름이 거절됐다')
  const 둘 = await 누르기()
  assert.equal(발사.length, 1,
    `같은 예약을 ${발사.length}번 발사했다 — 나가던 방송이 처음으로 되감긴다.`
    + ' 발사 약속이 곧바로 풀리므로 그것으로 잠금을 풀면 아무것도 못 막는다')
  assert.equal(둘.code, 409, `둘째 누름이 ${둘.code} 로 끝났다 — 막았으면 그렇다고 말해야 한다`)
})

test('**두 번 누름 창이 지나면** 다시 내보낼 수 있다 — 재방송을 영영 막지 않는다', () => {
  // 창 길이 자체는 실제로 기다리지 않는다(8초). **규칙이 시간에 걸려 있다는 사실**과
  // 그 값이 상한 안에 있다는 것을 본다 — 창이 상한보다 길면 잠금이 영영 안 풀린다.
  const g = require('../services/duplicateBroadcast')
  assert.equal(typeof g.이중클릭창ms, 'number', '두 번 누름 창이 값으로 안 드러나 있다')
  assert.ok(g.이중클릭창ms > 1000, `창이 ${g.이중클릭창ms}ms 다 — 손가락이 두 번 닿는 구간을 못 덮는다`)
  assert.ok(g.이중클릭창ms < g.최대잠금ms,
    '두 번 누름 창이 상한보다 길다 — 그러면 상한이 무의미해지고 재방송이 오래 막힌다')
  const 코드 = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'routes', 'schedules.js'), 'utf8')
  assert.match(코드, /setTimeout\(\(\) => 자물쇠\.풀기\(\), 겹침\.이중클릭창ms\)/,
    '발사 약속이 풀리는 것으로 잠금을 푼다 — 그건 몇 밀리초다')
  assert.match(코드, /console\.error\('\[schedules\/trigger\]'[\s\S]{0,80}자물쇠\.풀기\(\)/,
    '발사가 실패했는데도 창이 끝날 때까지 잡고 있다 — 못 나간 방송을 다시 시도할 수 없다')
})
