// 화면이 자동방송을 **이름 글자가 아니라 식별자로** 알아본다 (2026-09-05).
//
// 예전에는 5종의 제목이 세 곳에 글자 그대로 복사돼 있었다:
//   · server/services/broadcastSequencer.js  LANES.title      (보내는 쪽)
//   · src/hooks/useScheduledBroadcast.js     OVERLAY_TITLES   (가림막을 띄울지 판단)
//   · src/components/broadcast/BroadcastIndicators.jsx TITLE_LABEL (배지에 쓸 짧은 이름)
//
// 보내는 쪽 제목을 한 자만 고치면 나머지 둘이 **조용히** 안 맞는다 — 가림막이 안 뜨거나 배지에
// 긴 제목이 그대로 나오는데, 아무 오류도 안 난다. 실제로 '저녁 마무리'(AUTO_BROADCASTS)와
// '저녁 마무리'(LANES)가 이미 갈려 있었다.
//
// 이제 서버가 식별자(tab)를 실어 보내고 화면은 그것만 본다. 이름은 표시에만 쓴다.
// 여기서 잠그는 것:
//  1. broadcast_started에 tab이 실린다 — 안 실리면 가림막이 영영 안 뜬다
//  2. 방송 도중 접속한 창이 받는 스냅샷에도 실린다
//  3. 화면 둘이 5종 제목을 다시 글자로 갖고 있지 않다
//  4. 배지 라벨의 열쇠 다섯 = LANES의 tab 다섯 (한쪽만 늘면 여기서 걸린다)
'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_tab_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

// SSE를 가로챈다 (broadcastGate require 전에 심어야 한다)
const sent = []
const ssePath = require.resolve('../services/sse')
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: {
    broadcastSSE: (type, payload) => { sent.push({ type, payload }) },
    addClient: () => {}, clientCount: () => 0,
  },
}

const ROOT = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

test.after(() => { try { fs.unlinkSync(TEST_DB_PATH) } catch { /* 이미 없으면 됐다 */ } })

test('broadcast_started에 식별자가 실린다', () => {
  sent.length = 0
  const { broadcastStart } = require('../services/broadcastGate')
  broadcastStart('아침 종합 방송', 'morning')
  const started = sent.find(s => s.type === 'broadcast_started')
  assert.ok(started, 'broadcast_started를 안 쏜다')
  assert.equal(started.payload.tab, 'morning',
    '식별자가 없으면 화면은 다시 이름 글자로 판단할 수밖에 없다')
  assert.equal(started.payload.title, '아침 종합 방송', '이름도 그대로 보내야 배지에 쓸 수 있다')
})

test('방송 도중 접속한 창이 받는 스냅샷에도 식별자가 실린다', () => {
  const src = read('server', 'routes', 'events.js')
  assert.match(src, /tab: state\.broadcast\.tab/,
    '스냅샷에 식별자가 빠지면, 방송 중에 새로 연 창만 가림막이 안 뜬다')
})

test('시퀀서가 자기 tab을 넘긴다', () => {
  const src = read('server', 'services', 'broadcastSequencer.js')
  assert.match(src, /broadcastStart\(lane\.title, lane\.tab\)/,
    '식별자를 안 넘기면 서버는 늘 null을 보낸다')
})

test('화면이 5종 제목을 다시 글자로 갖고 있지 않다', () => {
  const TITLES = ['아침 종합 방송', '점심 식사 전 방송', '저녁 식사 전 방송']
  for (const rel of [
    ['src', 'hooks', 'useScheduledBroadcast.js'],
    ['src', 'components', 'broadcast', 'BroadcastIndicators.jsx'],
  ]) {
    const src = read(...rel)
    for (const t of TITLES) {
      assert.ok(!src.includes(`'${t}'`),
        `${rel[rel.length - 1]}이 "${t}"를 다시 글자로 갖고 있다 — 서버에서 제목을 고치면 조용히 어긋난다`)
    }
  }
})

test('배지 라벨의 열쇠 다섯이 LANES의 tab 다섯과 같다', () => {
  const ui = read('src', 'components', 'broadcast', 'BroadcastIndicators.jsx')
  const block = ui.slice(ui.indexOf('const TAB_LABEL'), ui.indexOf('const TAB_LABEL') + 400)
  const keys = [...block.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]).sort()

  const seq = read('server', 'services', 'broadcastSequencer.js')
  const tabs = [...seq.matchAll(/tab: '(\w+)'/g)].map(m => m[1]).sort()

  assert.deepEqual(keys, tabs,
    '한쪽에만 방송이 늘었다 — 배지에 짧은 이름 대신 긴 제목이 그대로 나온다')
})
