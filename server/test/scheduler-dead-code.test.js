// 아침방송 구현이 두 벌 있는 것(CC-046).
//
// scheduler.js의 fireMorning(약 56줄)은 호출자가 0건인 죽은 코드다 — 실제 아침방송은
// broadcastSequencer.fireMorningBroadcast()가 실행한다. 구현이 두 벌이면 다음에 아침방송을
// 고칠 때 잘못된 쪽(아무도 안 부르는 쪽)을 고치고 "고쳤는데 현장은 그대로"가 된다.
// module.exports에도 들어 있어 "쓰이는 코드"처럼 보이는 것이 함정을 키운다.
//
// 기대 동작: scheduler.js에 fireMorning 정의·export가 없다. 진짜 구현
// (broadcastSequencer.fireMorningBroadcast)은 남아 있어야 한다. 소스 대조로 고정한다.
// (\bfireMorning\b은 fireMorningBroadcast와는 매치되지 않는다 — 뒤에 단어문자 B가 이어져서.)
'use strict'

const path = require('path')
const fs = require('fs')

const test = require('node:test')
const assert = require('node:assert/strict')

const SCHEDULER_PATH = path.join(__dirname, '..', 'services', 'scheduler.js')
const SEQUENCER_PATH = path.join(__dirname, '..', 'services', 'broadcastSequencer.js')

test('scheduler.js에 죽은 fireMorning 정의·export가 없다', () => {
  const src = fs.readFileSync(SCHEDULER_PATH, 'utf8')

  assert.ok(!/function\s+fireMorning\b/.test(src),
    'scheduler.js에 아무도 안 부르는 fireMorning 정의가 남아 있다 — 아침방송 수정 시 잘못된 쪽을 고칠 위험')

  const exportsLine = src.slice(src.indexOf('module.exports'))
  assert.ok(!/\bfireMorning\b/.test(exportsLine),
    'module.exports에 fireMorning이 남아 있다 — 죽은 코드가 공개 API처럼 보인다')
})

test('진짜 아침방송 구현(broadcastSequencer.fireMorningBroadcast)은 남아 있다', () => {
  const src = fs.readFileSync(SEQUENCER_PATH, 'utf8')
  assert.ok(/fireMorningBroadcast/.test(src),
    '죽은 코드를 지우다 진짜 구현까지 지우면 안 된다')
})
