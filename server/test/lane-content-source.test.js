// 자동 5종의 문안 성격(contentSource) — 렌더 시점과 폴백 정책이 여기서 갈린다.
//
// 왜 LANES 에 두는가: 자동 5종은 `schedules` 에 행이 없다(broadcastSequencer 는 그 표를
// 읽지 않는다). 그래서 예약처럼 DB 컬럼에 성격을 적을 자리가 없다. 새 표를 만들거나
// 가짜 행을 넣는 대신, "5종이 서로 다른 지점"을 모아 둔 그 표에 적었다.
//
// 이 테스트가 지키는 것:
//   1) 다섯 개 모두 성격이 있다 — 빠지면 그 방송만 조용히 판정 밖으로 샌다
//   2) 아침만 가변이다 — 날씨·미세먼지를 보는 것은 아침뿐이다
//   3) 나머지 넷은 정적이다 — settings 의 고정 문안이라 매일 다시 만들 이유가 없다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_lane_cs_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { LANES } = require('../services/broadcastSequencer')
const { AUTO_BROADCASTS } = require('../domain/autoBroadcasts')
const { isVariable } = require('../domain/contentTokens')

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

test('자동 5종 모두 contentSource 가 있다 — 빠지면 그 방송만 판정 밖으로 샌다', () => {
  const 없는것 = Object.entries(LANES).filter(([, lane]) => !lane.contentSource).map(([k]) => k)
  assert.deepEqual(없는것, [], `성격이 없는 레인: ${없는것.join(', ')}`)
})

test('LANES 와 AUTO_BROADCASTS 가 같은 다섯을 가리킨다 — 갈리면 한쪽만 렌더된다', () => {
  const laneIds = Object.keys(LANES).sort()
  const specIds = AUTO_BROADCASTS.map((s) => s.id).sort()
  assert.deepEqual(laneIds, specIds)
})

test('아침만 가변이다 — 외부 데이터를 보는 것은 아침뿐이다', () => {
  assert.equal(LANES.morning.contentSource, 'system_template')
  // 아침만 prepare() 로 날씨·일정을 받아 온다. 그 사실과 성격이 어긋나면 안 된다.
  assert.equal(typeof LANES.morning.prepare, 'function',
    '아침이 외부 데이터를 안 받는데 가변으로 돼 있다 — 둘 중 하나가 틀렸다')
})

test('나머지 넷은 정적이다 — settings 의 고정 문안이라 매일 다시 만들 이유가 없다', () => {
  for (const id of ['exercise', 'lunch', 'dinner', 'evening_prayer']) {
    assert.equal(LANES[id].contentSource, 'system_static', `${id} 가 정적이 아니다`)
    assert.equal(LANES[id].prepare, undefined,
      `${id} 가 외부 데이터를 받기 시작했다면 성격을 system_template 로 바꿔야 한다`)
  }
})

test('가변 판정이 contentTokens 와 같은 답을 낸다 — 두 곳이 갈리면 정적 4종이 매일 재합성된다', () => {
  // 아침은 가변 — 렌더 실패 시 이전 캐시를 쓰면 어제 날씨가 나간다
  assert.equal(isVariable(LANES.morning.contentSource), true)
  // 나머지 넷은 정적 — 매일 다시 만들 이유가 없다
  for (const id of ['exercise', 'lunch', 'dinner', 'evening_prayer']) {
    assert.equal(isVariable(LANES[id].contentSource), false,
      `${id}(${LANES[id].contentSource}) 가 가변으로 판정된다 — 매일 재합성된다`)
  }
})
