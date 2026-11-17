// **검색창 예시는 실제로 되는 것만 보인다** (사용자 지시 2026-09-15).
//
// ── 이 자리가 하는 일 ───────────────────────────────────────────────────────
// *"검색창에서는 아 이런 정보도 입력해볼 수 있네? 이렇게."*
// 이 칸의 placeholder 는 **「무엇까지 말로 되는가」를 아는 유일한 자리**다. 그래서
// 예시 하나하나가 곧 **약속**이다.
//
// ── 왜 시험으로 묶나 ────────────────────────────────────────────────────────
// **안 되는 것을 예시로 보이면 사람이 그대로 쳐 보고 실패한다.** 그건 없는 것보다 나쁘다 —
// 한 번 실패하면 이 칸을 다시 안 쓴다.
//
// 실제로 그랬다. 예시를 아홉으로 늘리면서 *"점심때 배경음악 잔잔하게"* 와
// *"내일 아침에 안내 음원 틀어줘"* 를 넣었는데, **규칙 파서가 「점심때」·「아침에」를
// 시각으로 못 읽어** 둘 다 실패했다. 돌려 보고서야 알았다.
//
// ── 무엇을 재나 ─────────────────────────────────────────────────────────────
// 화면에 적힌 예시를 **그대로 꺼내** 규칙 파서에 넣는다. AI 는 안 부른다(`callApi: null`) —
// **인터넷이 끊겨도 되는 것**만 예시로 삼는다는 뜻이다. 규칙만으로 읽히지 않으면 탈락.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ex_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const 화면 = fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'shared', 'QuickSchedulePhrase.jsx'), 'utf8')

/** 화면에 적힌 예시를 그대로 꺼낸다. 여기서 다시 적으면 **두 벌이 되어 갈린다.** */
function 예시읽기() {
  const i = 화면.indexOf('const EXAMPLES = [')
  assert.ok(i >= 0, 'EXAMPLES 를 못 찾았다 — 이름이 바뀌었으면 이 시험도 같이 옮길 것')
  const 블록 = 화면.slice(i, 화면.indexOf(']', i))
  return [...블록.matchAll(/'([^']+)'/g)].map(m => m[1])
}

const 예시 = 예시읽기()
// 파서에 넘길 빈 맥락 — 흐름·일과시각·볼륨말은 DB 에서 오는데, 예시는 **그것 없이도**
// 읽혀야 한다(새로 깐 PC 에서도 같은 예시가 뜬다).
const 빈맥락 = { flows: [], autoTimes: {}, volumeWords: {} }
const 기준시각 = new Date(2026, 8, 15, 14, 0)

test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

test('긍정 앵커 — 예시가 넉넉히 있다', () => {
  // 셋뿐이던 때는 **셋 다 같은 모양**(시각 + 안내)이라, 이 칸이 「예약 만드는 칸」으로만
  // 읽혔다. 차임·배경음악·영상까지 말로 된다는 것을 알 길이 없었다.
  assert.ok(예시.length >= 6, `예시가 ${예시.length}개다 — 갈래를 보여 주기에 모자란다`)
})

test('**예시가 전부 규칙만으로 읽힌다** — AI 없이', async () => {
  const { parseWithFallback, 파싱쓸만한가 } = require('../services/llmGateway')
  const 실패 = []
  for (const t of 예시) {
    const r = await parseWithFallback({
      text: t, today: '2026-09-15', callApi: null, now: 기준시각, context: 빈맥락,
    })
    if (!파싱쓸만한가(r?.parsed || {})) 실패.push(t)
  }
  assert.deepEqual(실패, [],
    `규칙 파서가 못 읽는 예시가 있다 — 사람이 그대로 쳐 보고 실패한다:\n  ${실패.join('\n  ')}`)
})

test('**갈래가 하나로 쏠리지 않는다** — 「말만 나가는 게 아니구나」가 보여야 한다', async () => {
  const { parseWithFallback } = require('../services/llmGateway')
  const 갈래 = new Set()
  for (const t of 예시) {
    const r = await parseWithFallback({
      text: t, today: '2026-09-15', callApi: null, now: 기준시각, context: 빈맥락,
    })
    if (r?.parsed?.broadcast_type) 갈래.add(r.parsed.broadcast_type)
  }
  // 안내(text) 말고도 **최소 셋**은 더 보여야 한다(차임·배경음악·영상 같은 것).
  assert.ok(갈래.size >= 4,
    `예시가 ${갈래.size}가지 갈래뿐이다(${[...갈래].join('·')}) — `
    + '이 칸이 「예약 만드는 칸」으로만 읽힌다')
  assert.ok(갈래.has('text'), '가장 흔한 안내 방송 예시가 없다')
})

test('**돌아가는 간격이 읽을 만하다**', () => {
  const m = /const EXAMPLE_MS = (\d+)/.exec(화면)
  assert.ok(m, 'EXAMPLE_MS 를 못 찾았다')
  const ms = Number(m[1])
  // 너무 빠르면 **읽는 중에 바뀌어** 오히려 아무것도 못 읽는다. 너무 느리면 하나만
  // 있는 줄 안다(예시가 아홉이면 한 바퀴가 이미 45초다).
  assert.ok(ms >= 4000, `${ms}ms 는 짧다 — 읽다 말고 바뀐다`)
  assert.ok(ms <= 8000, `${ms}ms 는 길다 — 예시가 하나뿐인 줄 안다`)
})
