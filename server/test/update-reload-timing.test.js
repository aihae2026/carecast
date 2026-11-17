// **업데이트 뒤 새로고침은 「서버가 새로 뜬 뒤」에 한다** (현장 지적 2026-09-15).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 업데이트가 끝나면 화면이 **흰 채로 멈췄고 F5 를 눌러야** 돌아왔다. 두 번 겪었다.
//
// 자동 새로고침은 걸려 있었다 — **너무 일찍** 돌았다.
// 서버는 `server_update` 를 보내고 **1.5초 뒤에** 죽는다(`autoUpdate` 의 `restart`).
// 그런데 화면은 그 표식을 본 **다음 성공 응답에서 바로** 새로고침했다. 그 사이에
// 걸리면 화면 파일(`/assets/index-*.js`)을 받아오는 도중에 서버가 내려가 **흰 화면**이 된다.
// 제목만 뜨고 본문이 비는 그 모양이 정확히 그것이다.
//
// ── 고친 방법 ───────────────────────────────────────────────────────────────
// **프로세스가 실제로 새로 떴는지**를 보고 새로고침한다. `/api/status` 의 `procUptime`
// 이 줄어들면 새 프로세스다. `uptime` 으로는 못 본다 — 그건 **PC 부팅** 기준이라
// 서버가 재시작해도 안 줄어든다. 이 구분이 이 수정의 핵심이다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_reload_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')

const 훅 = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useConnectionWatch.js'), 'utf8')
const 코드만 = 훅.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/status': require('../routes/status') })
})
test.after(async () => {
  if (app) await app.close()
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

test('**`/api/status` 가 프로세스 가동 시간을 준다**', async () => {
  const body = await (await fetch(`${app.baseUrl}/api/status`)).json()
  assert.equal(typeof body.procUptime, 'number',
    'procUptime 이 없다 — 화면이 「서버가 새로 떴는지」를 알 방법이 없어진다')
  assert.ok(body.procUptime >= 0)
  // **PC 부팅 시간과 다른 값이어야 한다.** 같은 값을 보내면 재시작을 못 가린다.
  assert.equal(typeof body.uptime, 'number', 'uptime 이 사라졌다 — 화면 다른 곳이 쓴다')
  assert.notEqual(body.procUptime, body.uptime,
    'procUptime 과 uptime 이 같다 — PC 부팅 기준을 보내면 재시작을 영영 못 본다')
})

test('**프로세스 시간은 늘어난다** — 줄어들면 새로 뜬 것이다', async () => {
  const a = (await (await fetch(`${app.baseUrl}/api/status`)).json()).procUptime
  await new Promise(r => setTimeout(r, 1100))
  const b = (await (await fetch(`${app.baseUrl}/api/status`)).json()).procUptime
  assert.ok(b >= a, `가동 시간이 줄었다(${a} → ${b}) — 같은 프로세스에서는 늘어야 한다`)
})

test('**화면이 표식만 보고 바로 새로고침하지 않는다**', () => {
  // 이 한 줄이 그날의 흰 화면이었다. 되살아나면 같은 일이 난다.
  assert.match(코드만, /cc_update_proc_uptime/,
    '새 프로세스인지 보는 기준값을 안 두고 있다 — 표식만 보고 바로 새로고침한다')
  assert.match(코드만, /procUp < 기준/,
    '가동 시간이 줄었는지를 안 본다')
  // 표식이 있고 끊김을 못 본 상태에서 **곧바로** reload 하는 길이 없어야 한다.
  const 성급한 = /업데이트대기 && !wasOffline\.current\)[\s\S]{0,200}?window\.location\.reload\(\)/.exec(코드만)
  assert.ok(!성급한 || /procUp == null/.test(성급한[0]),
    '업데이트 표식만 보고 바로 새로고침하는 길이 남아 있다')
})

test('**옛 서버에서는 예전 규칙으로 간다** — 영영 새로고침 못 하면 더 나쁘다', () => {
  // `procUptime` 을 안 주는 서버(업데이트 전 판)에 붙었을 때, 새 규칙을 못 지킨다고
  // 새로고침을 아예 안 하면 화면이 옛 코드로 남는다 — 고치려던 것보다 나쁘다.
  assert.match(코드만, /if \(procUp == null\)[\s\S]{0,200}?window\.location\.reload\(\)/,
    '옛 서버에서의 폴백이 없다')
})

test('**끊김을 본 경우는 예전 그대로 바로 새로고침한다**', () => {
  // 그때는 이미 죽었다 살아난 것이라 기다릴 이유가 없다. 이 길까지 막으면
  // 진짜 재시작에서 화면이 안 돌아온다.
  assert.match(코드만, /if \(wasOffline\.current\)[\s\S]{0,220}?window\.location\.reload\(\)/,
    '끊김 뒤 복구 새로고침이 사라졌다')
})
