// 즉시 TTS 라우트가 **예약 경로가 주던 것을 잃지 않는다** (사용자 지시 2026-09-14).
//
// ── 왜 이 시험이 있나 ────────────────────────────────────────────────────────
// 「지금 방송」의 즉시 TTS 를 예약 경로에서 `/api/tts/broadcast` 로 옮긴다. 차임이 붙는
// 것이 이유인데, **차임만 보고 갈아타면 세 가지를 잃는다** — 안내 음량 · 2회 반복 ·
// 방송 전후 BGM. 사용자가 못 박았다: *"지원되지 않는 옵션을 조용히 무시하거나 UI 에만
// 남기지 마라."* 카드에 토글이 남아 있는데 서버가 무시하면 그게 가장 나쁜 상태다.
//
// ── 이 시험이 보는 것 ────────────────────────────────────────────────────────
// 라우트의 **실제 본문을 실행**한다. 합성·재생·차임·DB 는 대역으로 받되, **무엇을 어떤
// 값으로 넘기는지**를 기록해서 본다. 소스에 글자가 있는지가 아니라 **값이 흐르는지**다.
'use strict'

process.env.CARECAST_DB_PATH = ':memory:'
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { 반복문안 } = require('../domain/broadcastDefaults')

// ── 대역을 **라우트보다 먼저** 끼운다 ───────────────────────────────────────
// `routes/tts.js` 는 로드 시점에 `const { enqueue } = require(...)` 로 **값을 묶는다.**
// 그래서 나중에 모듈 속성을 바꿔도 라우트는 옛 함수를 계속 본다 — 처음에 그렇게 썼다가
// 진짜 합성이 돌아 시험 하나가 3초씩 걸렸다. 제품을 고치지 않고 **부르는 순서**로 푼다.
const 기록 = { enqueue: null, 합성: null, 차임: [], 이력: [], sse: [], bgm해석: null }
function 비우기() { 기록.enqueue = null; 기록.합성 = null; 기록.차임 = []; 기록.이력 = []; 기록.sse = []; 기록.bgm해석 = null }

let 재생실패 = null   // 시험이 채우면 그 오류로 거절한다(진짜 `audioQueue` 가 하는 일)
require('../services/audioQueue').enqueue =
  (f, p, d, v) => {
    기록.enqueue = { file: f, priority: p, device: d, volume: v }
    return 재생실패 ? Promise.reject(new Error(재생실패)) : Promise.resolve()
  }
require('../services/tts').generateTTSWithRetry =
  (opts) => { 기록.합성 = opts; return Promise.resolve('/tmp/더미.mp3') }
const chime = require('../services/chimePlayer')
chime.playChime = (type, vol, cb) => { 기록.차임.push({ type, vol }); cb && cb(true) }
chime.부수차임막힘 = () => null
require('../domain/broadcastRecord').시작기록 = (db, o) => { 기록.이력.push(o); return 1 }
require('../services/sse').broadcastSSE = (n, d) => { 기록.sse.push([n, d]) }
require('../services/audioDevices').resolveDeviceIndex = async () => ({ index: null })
// BGM 해석 대역 — 폴더를 안 뒤진다. **해석 결과만** 흉내 내고(이 PC 음원 모양), 라우트가 그것을
// 어떻게 쓰는지(언제 쏘고 언제 끄는지)를 본다. 「못 고름」은 bgm_title 로 시킨다.
require('../services/broadcastConfig').resolveBGM = async (db, sch) => {
  기록.bgm해석 = sch
  return sch.bgm_title === '없음' ? null
    : { kind: 'local', files: [{ url: '/audio/bgm/a.mp3', name: '반주' }], bgmTitle: '반주', bgmDefault: 55 }
}
require('../services/sitePlayer').hasSitePlayer = () => true
// 차임과 TTS 사이의 대기(CHIME_LEAD_MS)를 시험에서 기다리지 않는다.
const 원래setTimeout = global.setTimeout

const TTS_ROUTER = require('../routes/tts')   // ← 대역을 다 끼운 뒤에 부른다

test.before(() => { initDB() })

/** 라우트 하나를 꺼내 온다(express 라우터의 스택에서). */
function 라우트찾기(router, 경로) {
  for (const layer of router.stack || []) {
    if (layer.route && layer.route.path === 경로) {
      const st = layer.route.stack
      return st[st.length - 1].handle
    }
  }
  return null
}

test('긍정 앵커 — /broadcast 라우트가 있다', () => {
  assert.equal(typeof 라우트찾기(TTS_ROUTER, '/broadcast'), 'function', 'POST /broadcast 핸들러를 못 찾았다')
})

/** 라우트를 돌리고 **넘어간 값**을 받아 온다. */
async function 돌리기(body) {
  비우기()
  const handler = 라우트찾기(TTS_ROUTER, '/broadcast')
  const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  await handler({ body, get: () => undefined }, res)
  await new Promise(r => 원래setTimeout(r, 60))   // 재생 뒤 종료음까지 돈다
  return { 기록, res }
}

test('**안내 음량**이 재생까지 간다 — 예약의 main_volume 에 해당하는 값', async () => {
  const { 기록, res } = await 돌리기({ text: '음량 시험입니다', volume: 35 })
  assert.equal(res.code, 200, `요청이 거절됐다: ${JSON.stringify(res.body)}`)
  assert.ok(기록.enqueue, '재생 대기열을 아예 안 불렀다')
  assert.equal(기록.enqueue.volume, 35,
    `이 방송에만 쓸 음량이 재생으로 안 갔다(${기록.enqueue.volume}) — 카드에서 고른 값이 조용히 버려진다`)
})

test('음량을 안 주면 예전 그대로다 — 「누르고 말하기」에 회귀가 없어야 한다', async () => {
  const { 기록 } = await 돌리기({ text: '기본 음량 시험입니다' })
  assert.equal(기록.enqueue.volume ?? null, null,
    '음량을 안 줬는데 값이 실렸다 — 시스템 기본값을 덮어쓴다')
})

test('**2회 반복**이 합성 문장에 반영된다 — 같은 단일 출처를 쓴다', async () => {
  const 본문 = '반복 시험입니다'
  const { 기록 } = await 돌리기({ text: 본문, repeat: true })
  assert.equal(기록.합성.text, 반복문안(본문, true),
    `합성 문장이 반복을 안 담았다 — 카드의 「방송 2회 반복」이 아무 일도 안 한다`)
  const 한번 = await 돌리기({ text: 본문 })
  assert.equal(한번.기록.합성.text, 본문, '반복을 안 켰는데 두 번 읽는다')
})

test('시작 차임·종료음은 개별로 먹는다 — 하나만 켜도 그것만 운다', async () => {
  const 시작만 = await 돌리기({ text: '차임 시험입니다', chimeStart: true })
  assert.deepEqual(시작만.기록.차임.map(c => c.type), ['general'], '시작 차임만 켰는데 다르게 울렸다')
  const 끝만 = await 돌리기({ text: '차임 시험입니다', chimeEnd: true })
  assert.deepEqual(끝만.기록.차임.map(c => c.type), ['end'], '종료음만 켰는데 다르게 울렸다')
  const 둘다 = await 돌리기({ text: '차임 시험입니다', chimeStart: true, chimeEnd: true })
  assert.deepEqual(둘다.기록.차임.map(c => c.type), ['general', 'end'], '시작→종료 순서가 아니다')
})

test('이력은 **실행자를 지어내지 않는다** — 식별 정보가 없으면 그렇게 적는다', async () => {
  const { 기록 } = await 돌리기({ text: '이력 시험입니다' })
  assert.equal(기록.이력.length, 1, '이력을 안 남겼다')
  assert.equal(기록.이력[0].type, 'TTS', '유형이 TTS 가 아니다')
  assert.notEqual(기록.이력[0].user, '자동', '사람이 누른 방송을 자동으로 적는다')
})

// ── **방송 전후 BGM·지연이 즉시 경로에도 붙는다** (B-2·B-3, 사용자 승인) ─────────────
// 「지금 방송」이 예약 경로에서 이리로 옮겨 왔다. 예약 경로에서는 브라우저가 반주를
// 깔았는데(`scheduled_broadcast` 에 `bgm` 을 실어 보냈다), 즉시 경로는 **안내를 서버
// 스피커가** 내므로 그 순서를 서버가 짠다. 그 순서가 틀리면 소리가 겹치거나 반주만 남는다.
test('**BGM 을 먼저 깔고** 안내를 낸다 — 순서가 뒤집히면 겹친다', async () => {
  const { 기록 } = await 돌리기({ text: 'BGM 시험입니다',
    bgm: { bgm_type: 'local_broadcast', bgm_delay: 0 } })
  const 순서 = 기록.sse.map(([n]) => n)
  const 시작 = 순서.indexOf('bgm_start')
  const 말함 = 순서.indexOf('tts_speak')
  assert.ok(시작 >= 0, '반주를 아예 안 깐다 — 카드의 「BGM 재생」가 아무 일도 안 한다')
  assert.ok(말함 >= 0 && 시작 < 말함, `반주가 안내보다 늦게 나간다(${순서.join(' → ')})`)
})

test('**끝나면 반주를 끈다** — 안 끄면 음악만 계속 흐른다', async () => {
  const { 기록 } = await 돌리기({ text: 'BGM 끄기 시험입니다',
    bgm: { bgm_type: 'local_broadcast', bgm_delay: 0, bgm_end_delay: 0 } })
  assert.ok(기록.sse.some(([n]) => n === 'bgm_stop'),
    '재생이 끝났는데 반주를 안 끈다 — 안내는 끝났는데 음악만 남아 「방송 중」으로 보인다')
})

test('BGM 설정이 **예약과 같은 이름**으로 간다 — 화면이 이름을 새로 짓지 않는다', async () => {
  const { 기록 } = await 돌리기({ text: '이름 시험입니다',
    bgm: { bgm_type: 'local_meal_seq', bgm_delay: 0, bgm_volume: 40 } })
  assert.equal(기록.bgm해석.bgm_type, 'local_meal_seq', 'BGM 갈래(폴더·차례)가 안 갔다')
  assert.equal(기록.bgm해석.bgm_volume, 40, 'BGM 볼륨이 안 갔다 — 이 방송에만 쓸 값이다')
  assert.equal(기록.bgm해석.bgm_enabled, 1, '해석기가 꺼진 것으로 본다')
})

test('**BGM 을 안 주면 예전 그대로다** — 「누르고 말하기」에 회귀가 없다', async () => {
  const { 기록 } = await 돌리기({ text: '반주 없는 방송입니다' })
  assert.equal(기록.sse.some(([n]) => n === 'bgm_start'), false,
    '안 시킨 반주가 나간다')
  assert.equal(기록.sse.some(([n]) => n === 'bgm_stop'), false, '끌 것도 없는데 끄기를 쏜다')
  assert.equal(기록.bgm해석, null, 'BGM 해석을 괜히 부른다 — 안 시킨 폴더 조회가 붙는다')
})

test('BGM 을 **못 고르면 안내는 그대로 나간다** — 반주는 부가 요소다', async () => {
  const { 기록, res } = await 돌리기({ text: '반주 실패 시험입니다',
    bgm: { bgm_type: 'local_broadcast', bgm_title: '없음', bgm_delay: 0 } })
  assert.equal(res.code, 200, `반주를 못 골랐다고 방송이 막혔다: ${JSON.stringify(res.body)}`)
  assert.ok(기록.enqueue, '반주를 못 골랐다고 안내까지 안 나간다')
  assert.equal(기록.sse.some(([n]) => n === 'bgm_start'), false, '못 골랐는데 쐈다')
})

test('**재생이 실패해도 반주를 끈다** — 안 끄면 음악만 무기한 흐른다 (V③ R9)', async () => {
  // 재생은 거절될 수 있다 — 장치 없음 · 백엔드 오류 · 비상방송 교체 · 제한시간.
  // 처음에는 **성공 콜백에서만** 껐다. 그러면 안내는 안 나갔는데 반주만 남는다.
  // 화면도 스스로 못 끈다: 우리가 길이를 0 으로 보내서 자동 종료 타이머가 안 선다.
  재생실패 = '장치를 못 열었습니다'
  try {
    const { 기록 } = await 돌리기({ text: '재생 실패 시험입니다',
      bgm: { bgm_type: 'local_broadcast', bgm_delay: 0 } })
    assert.ok(기록.sse.some(([n]) => n === 'bgm_start'), '반주를 안 깔았다 — 전제가 깨졌다')
    assert.ok(기록.sse.some(([n]) => n === 'bgm_stop'),
      '재생이 거절됐는데 반주를 안 끈다 — 안내 없이 음악만 계속 흐른다')
  } finally { 재생실패 = null }
})

test('반주를 안 깔았으면 **실패해도 끄기를 안 쏜다** — 남의 반주를 끄면 안 된다', async () => {
  재생실패 = '장치를 못 열었습니다'
  try {
    const { 기록 } = await 돌리기({ text: '반주 없는 실패 시험입니다' })
    assert.equal(기록.sse.some(([n]) => n === 'bgm_stop'), false,
      '우리가 깔지도 않은 반주를 끈다 — 다른 방송의 음악이 끊긴다')
  } finally { 재생실패 = null }
})
