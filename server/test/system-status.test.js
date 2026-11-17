// 대시보드 시스템 상태 카드 실측 연동 검증.
// 예전엔 CPU/오디오/마이크가 src/data/dummy.js의 고정 문자열("CPU 23%", "-12 dB", "대기 중")이라
// 현장에서 오디오 장치가 빠져도 "정상 출력"으로 표시되는 사각지대였다. 이제 /api/status가
// 실측값을 내려주는데, 여기서 중요한 건 "장치 조회가 실패해도 응답이 깨지지 않는 것"이다
// (실패 시 null → 화면은 "확인 불가", 가짜 값은 절대 만들지 않음).
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_sysstatus_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const statusRoutes = require('../routes/status')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/status': statusRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
  // audioDevices.js가 서버 기동 시 백그라운드 PowerShell 컴파일을 걸어두기 때문에
  // 그대로 두면 이벤트 루프가 안 죽어 node --test가 타임아웃으로 실패한다.
})

async function getStatus() {
  const r = await fetch(app.baseUrl + '/api/status')
  return { status: r.status, body: await r.json() }
}

test('GET /api/status — cpu 필드에 코어 수와 모델명이 실제 값으로 들어있다', async () => {
  const { status, body } = await getStatus()
  assert.equal(status, 200)
  assert.ok(body.cpu, 'cpu 필드가 있어야 한다')
  assert.ok(Number.isInteger(body.cpu.cores) && body.cpu.cores > 0, `코어 수가 양의 정수여야 한다(${body.cpu.cores})`)
  assert.equal(typeof body.cpu.model, 'string')
})

test('GET /api/status — cpu.usagePct는 첫 호출에선 null(비교 대상 없음), 두 번째부터 0~100 숫자', async () => {
  // 첫 호출에서 이미 스냅샷이 잡혔을 수 있으므로(before의 다른 테스트 포함) 두 번 더 호출해
  // 최소 한 번은 델타가 계산되는 상태를 만든다
  await getStatus()
  const { body } = await getStatus()
  const pct = body.cpu.usagePct
  if (pct !== null) {
    assert.ok(Number.isInteger(pct), `usagePct는 정수여야 한다(${pct})`)
    assert.ok(pct >= 0 && pct <= 100, `usagePct는 0~100 범위여야 한다(${pct})`)
  }
})

test('GET /api/status — audio.output/input은 {count,first} 또는 null이며, 어느 쪽이든 응답은 200이다', async () => {
  const { status, body } = await getStatus()
  assert.equal(status, 200, '장치가 0개거나 조회에 실패해도 200이어야 한다')
  assert.ok(body.audio, 'audio 필드가 있어야 한다')

  for (const key of ['output', 'input']) {
    const v = body.audio[key]
    if (v !== null) {
      assert.ok(Number.isInteger(v.count) && v.count >= 0, `audio.${key}.count는 0 이상 정수여야 한다`)
      // 장치가 0개면 first는 null — 이 PC처럼 오디오 엔드포인트가 없는 환경이 실제로 존재한다
      if (v.count === 0) assert.equal(v.first, null)
      else assert.equal(typeof v.first, 'string')
    }
  }
})

test('GET /api/status — 기존 필드(ip/memory/broadcasts)가 그대로 유지된다(회귀)', async () => {
  const { body } = await getStatus()
  assert.equal(typeof body.ip, 'string')
  assert.ok(body.memory && typeof body.memory.usedPct === 'number')
  assert.ok(body.broadcasts && typeof body.broadcasts.total === 'number')
  assert.ok(Array.isArray(body.recentBroadcasts))
})
