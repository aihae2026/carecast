// 자동방송이 **저장된 BGM 음원을 실제로 쓰는가** (2026-09-05).
//
// 음원 관리의 BGM 폴더에는 "식사시간 배경음악"이라고만 적혀 있었다. 그런데 자동방송의 BGM은
// 유튜브 키워드 검색이라 그 폴더를 아예 안 본다(services/broadcastSteps.js는 'auto'·'local'일
// 때만 로컬을 뒤진다). 사람은 음원을 올려 두고 왜 안 나오는지 알 길이 없었다 — 화면 어디에도
// 그 말이 없었기 때문이다.
//
// **키워드 검색이 의도다(사용자 결정 2026-09-05).** 그전까지 BGM 단계 10개 중 아침의
// "BGM 재시작 (식사 안내 후)" 하나만 'auto'였는데, 그건 고른 것이 아니라 그 단계에만 bgmSource가
// 빠져서 기본값으로 떨어진 자리였다. 같은 커밋에서 아침 키워드로 맞췄다.
//
// 화면에 **고정 문구를 박지 않는다.** 편집기에서 방식을 바꾸면 그 문구가 그날부터 새 거짓말이
// 된다. 그래서 지금 설정을 세어 주고 화면은 그 숫자를 읽는다.
//
// **2026-09-21: 뒤집혔다.** 외부 동영상 연동을 걷어내며 모든 BGM 단계가 이 PC 음원이 됐다(사용자 지시).
// 이제 알려 줄 것은 「쓰나 안 쓰나」가 아니라 **어느 폴더(방송용·식사용)를 보나**다. 여기서 잠그는 것:
//  1. 기본 상태에서 켜진 BGM 단계는 전부 이 PC 음원이고, 폴더는 서버 실행부와 같은 규칙이다
//  2. 단계에 폴더를 골라 두면 그것이 보이고, **어느 단계인지** 이름을 댄다
//  3. 꺼 놓은 방송은 안 센다 — 안 나가는 방송이 "여기 음원을 쓴다"고 세어지면 그것도 거짓이다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmusage_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { writeSetting } = require('../domain/settingsRead')

// 라우터를 통째로 띄우지 않고 핸들러만 부른다(이 저장소에는 supertest가 없다).
const router = require('../routes/settings')

function findRoute(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack[0].handle
}

function call(handler) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, body: b }) },
    }
    handler({ body: {}, query: {}, params: {} }, res)
  })
}

test.before(() => { initDB() })
test.after(() => { try { fs.unlinkSync(TEST_DB_PATH) } catch { /* 이미 없으면 됐다 */ } })

test('기본 상태에서 켜진 BGM 단계는 전부 이 PC 음원이고, 폴더는 서버 규칙 그대로다', async () => {
  const { 기본역할 } = require('../domain/bgmRoles')
  const { status, body } = await call(findRoute('get', '/bgm-usage'))
  assert.equal(status, 200)
  assert.ok(body.total > 0, 'BGM 단계를 하나도 못 찾았다 — 이 검사의 전제가 바뀌었다')
  assert.equal(body.usingLocal, body.total, '이 PC 음원이 아닌 BGM 단계가 남아 있다')
  for (const b of body.broadcasts) {
    for (const st of b.steps) {
      assert.equal(st.role, 기본역할(b.id), `${b.id}「${st.label}」 이 실행부와 다른 폴더를 가리킨다`)
    }
  }
})

test('단계에 폴더를 골라 두면 그 폴더가 보이고, 어느 단계인지 이름을 댄다', async () => {
  const { DEFAULT_STEPS } = require('../services/broadcastSequencer')
  const steps = DEFAULT_STEPS.morning.map(st =>
    String(st.id || '').startsWith('bgm') ? { ...st, bgmSource: 'local', bgmRole: 'meal' } : st)
  const bgmCount = steps.filter(st => String(st.id || '').startsWith('bgm')).length
  assert.ok(bgmCount > 0, '아침 방송에 BGM 단계가 없다 — 전제가 바뀌었다')

  writeSetting(getDB(), 'morning_steps', JSON.stringify(steps))
  const { body } = await call(findRoute('get', '/bgm-usage'))
  const morning = body.broadcasts.find(b => b.id === 'morning')
  assert.deepEqual([...new Set(morning.steps.map(st => st.source))], ['local'])
  assert.deepEqual([...new Set(morning.steps.map(st => st.role))], ['meal'], '단계에 고른 폴더가 안 보인다')
  assert.equal(morning.steps.filter(st => st.usesLocal).length, bgmCount)
  // 몇 개인지만 알면 어디를 고쳐야 하는지는 여전히 모른다
  assert.equal(body.localSteps.length, body.usingLocal)
  assert.match(body.localSteps[0], /「.+」/, '방송 이름과 단계 이름을 함께 줘야 한다')
})

test('꺼 놓은 방송은 안 센다 — 안 나가는 방송이 세어지면 그것도 거짓이다', async () => {
  const before = await call(findRoute('get', '/bgm-usage'))
  const morningLocal = before.body.broadcasts
    .find(b => b.id === 'morning').steps.filter(st => st.usesLocal).length
  assert.ok(morningLocal > 0, '앞 검사가 켜 둔 로컬 단계가 없다 — 순서가 바뀌었다')

  writeSetting(getDB(), 'morning_enabled', 'false')
  const after = await call(findRoute('get', '/bgm-usage'))
  assert.equal(after.body.usingLocal, before.body.usingLocal - morningLocal,
    '꺼 놓은 아침 방송이 아직 세어진다')
  assert.equal(after.body.broadcasts.find(b => b.id === 'morning').enabled, false,
    '목록에는 남되 꺼져 있다고 알려 줘야 한다')
})
