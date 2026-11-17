// 재생 배속: 저장은 배수, 화면은 퍼센트.
//
// 사용자 요청(2026-09-01): "0.5 0.75 이거 너무 성기다. 정속이 100이면 80·83·120처럼
// 퍼센트로 적게 해줘. 기본 100으로 두고 조금씩 조정하면 되지."
//
// DB 표는 안 건드렸다 — 컬럼은 여전히 배수(playback_rate 0.5~1.5)다. 바꾼 것은 화면이
// 그 값을 사람에게 보여주고 받는 방식뿐이다. 그래서 두 범위가 어긋나면 화면에서 적을 수
// 있는데 서버가 잘라 버리는(또는 그 반대의) 조용한 불일치가 생긴다. 여기서 대조한다.
'use strict'

// ── **임시 DB 를 제품 모듈보다 먼저 정한다** (2026-09-14 전수 확인) ─────────────────
// 이 파일이 부르는 제품 모듈이 어딘가에서 `getDB()` 를 부른다. 경로를 안 정하면 그 읽기가
// **기본 경로의 DB** 로 간다 — 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를
// 돌리면 운영 DB** 를 연다(없으면 새로 만들기까지 한다). `db/schema.js` 는 로드 시점에
// 경로를 굳히므로 **`require` 보다 위**여야 한다. 이름은 `_` 로 시작한다 — 아래에서 같은
// 모듈을 다시 부르는 파일이 있어 부딪히면 안 된다.
process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_rate_percent_${process.pid}_${Date.now()}.db`)

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { RATE_MIN, RATE_MAX, normalizePlaybackRate } = require('../services/scheduleStore')
const UTILS = path.join(__dirname, '../../src/lib/scheduleUtils.js')

// 정규식 대신 줄을 찾아 자른다 — 역슬래시가 전송 과정에서 반토막 나는 일을 이미 세 번 겪었다.
function clientConst(name) {
  const src = fs.readFileSync(UTILS, 'utf8')
  const NL = String.fromCharCode(10)   // 줄바꿈 리터럴을 소스에 안 적는다
  const line = src.split(NL).find(l => l.startsWith('export const ' + name + ' = '))
  assert.ok(line, `${name}을 화면 상수에서 못 찾았다`)
  const n = Number(line.split('=')[1].trim())
  assert.ok(Number.isFinite(n), `${name} 값이 숫자가 아니다`)
  return n
}

test('화면의 퍼센트 범위가 서버의 배수 범위와 같다', () => {
  assert.equal(clientConst('RATE_PCT_MIN') / 100, RATE_MIN,
    '화면 하한이 서버와 다르다 — 적을 수는 있는데 서버가 잘라 버린다')
  assert.equal(clientConst('RATE_PCT_MAX') / 100, RATE_MAX,
    '화면 상한이 서버와 다르다')
})

test('기본값은 정속 100%다', () => {
  assert.equal(clientConst('RATE_PCT_DEFAULT'), 100)
  assert.equal(clientConst('RATE_PCT_DEFAULT') / 100, 1)
})

test('퍼센트로 적은 값이 서버에서 그대로 살아남는다', () => {
  // 83%처럼 배수 버튼으로는 닿을 수 없던 값이 이 요청의 핵심이다.
  for (const pct of [50, 80, 83, 100, 117, 120, 150]) {
    const rate = pct / 100
    assert.equal(normalizePlaybackRate(rate), rate, `${pct}%가 서버에서 바뀐다`)
    assert.equal(Math.round(normalizePlaybackRate(rate) * 100), pct, `${pct}%가 되돌릴 때 어긋난다`)
  }
})

test('범위 밖은 서버가 자른다', () => {
  assert.equal(normalizePlaybackRate(0.2), RATE_MIN)
  assert.equal(normalizePlaybackRate(3), RATE_MAX)
})

test('배수 버튼 목록은 화면에서 사라졌다', () => {
  // 같은 기능이 화면마다 다른 배수 목록을 갖고 있었다 — 순서편집기 [0.5 0.75 1 1.25 1.5],
  // 예약 모달 [0.7 0.8 0.9 1.0 1.25]. 되살아나면 다시 갈라진다.
  const ROOT = path.join(__dirname, '../..')
  for (const rel of [
    'src/components/admin/sections/StepList.jsx',
    'src/components/shared/ScheduleModal.jsx',
    'src/components/broadcast/VideoPlayer.jsx',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    assert.ok(!src.includes('RATE_PRESETS'), `${rel}에 배수 목록이 남아 있다`)
    assert.ok(src.includes('RateInput'), `${rel}가 퍼센트 칸을 안 쓴다`)
  }
})
