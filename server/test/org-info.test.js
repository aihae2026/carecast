// 기관 이름·표어 — 방송 대기화면의 큰 글씨 (2026-09-05).
//
// 여기서 잠그는 것 넷:
//  1. **기본값은 비어 있다.** 남의 기관 이름이 기본값이면 설치하자마자 그 이름이 홀 TV에
//     걸린다 — 도입 가이드가 "이것만으로 못 쓴다"고 적어 둔 바로 그 문제다.
//  2. 저장한 값이 그대로 돌아온다(앞뒤 공백은 떼고, 40자에서 자른다).
//  3. 깨진 글자(U+FFFD)는 400으로 막는다. 홀 TV에 가장 크게 걸리는 글자라 네모가 섞이면
//     화면이 통째로 망가져 보인다.
//  4. **화면이 기관 이름을 자기가 갖고 있지 않다.** 이게 없으면 나중에 누가 글자를 다시
//     박아 넣어도 아무도 모른다(auto-broadcast-names.test.js가 쓰는 방식과 같다).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_org_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')

// 라우터를 통째로 띄우지 않고 핸들러만 부른다 — 이 저장소에는 supertest가 없고,
// 새 테스트 하네스를 들이지 않는 것이 회귀 규칙이다(tests/regression/README.md).
const router = require('../routes/settings')

function findRoute(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack[0].handle
}

function call(handler, { body = {}, query = {}, params = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, body: b }) },
    }
    handler({ body, query, params }, res)
  })
}

test.before(() => { initDB() })
test.after(() => { try { fs.unlinkSync(TEST_DB_PATH) } catch { /* 이미 없으면 됐다 */ } })

test('기본값은 비어 있다 — 남의 기관 이름이 홀 TV에 걸리면 안 된다', async () => {
  const { status, body } = await call(findRoute('get', '/org'))
  assert.equal(status, 200)
  assert.equal(body.name, '')
  assert.equal(body.slogan, '')
})

test('저장한 값이 그대로 돌아온다 — 앞뒤 공백은 뗀다', async () => {
  const saved = await call(findRoute('post', '/org'),
    { body: { name: '  예시 요양원  ', slogan: ' 함께하는 하루 ' } })
  assert.equal(saved.status, 200)

  const { body } = await call(findRoute('get', '/org'))
  assert.equal(body.name, '예시 요양원')
  assert.equal(body.slogan, '함께하는 하루')
})

test('40자를 넘기면 자른다 — 넘치면 홀 화면에서 줄이 깨진다', async () => {
  await call(findRoute('post', '/org'), { body: { name: '가'.repeat(60), slogan: '' } })
  const { body } = await call(findRoute('get', '/org'))
  assert.equal(body.name.length, 40)
})

test('깨진 글자는 저장하지 않는다 — 홀 TV에 네모가 걸린다', async () => {
  const bad = await call(findRoute('post', '/org'), { body: { name: '예시 �요양원', slogan: '' } })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error, /기관 이름/)

  // 막힌 저장이 앞의 값을 지우지도 않았다
  const { body } = await call(findRoute('get', '/org'))
  assert.notEqual(body.name, '예시 �요양원')
})

test('[구조] 화면이 기관 이름·표어를 자기가 갖고 있지 않다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'broadcast', 'BroadcastIndicators.jsx'), 'utf8')
  // 기관 이름처럼 보이는 글자(…마을·…요양원)를 따옴표 안에 박아 두면 모든 도입 기관 화면에 그 이름이 뜬다.
  assert.doesNotMatch(src, /['"`][^'"`\n]*(마을|요양원)['"`]/, 'BroadcastIndicators가 기관 이름을 다시 박아 넣었다')
  assert.match(src, /getOrgInfo/, 'BroadcastIndicators가 설정에서 받아 오지 않는다')
})

test('[구조] 기관 이름·표어 입력 칸에 예시 문구가 없다 — 한 기관의 이름이 모든 도입 기관 화면에 보인다', () => {
  // 2026-10-17 사용자 결정: 입력 칸 예시는 비워 둔다. 예전엔 처음 운영한 기관의 이름·표어가 예시로 들어 있었다.
  const 읽기 = (p) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', p), 'utf8')
  const 마법사 = 읽기('SetupWizard.jsx')
  for (const 값 of ['이름초안', '표어초안']) {
    const 줄 = 마법사.split('\n').find((l) => l.includes(`value={${값}}`))
    assert.ok(줄, `마법사에서 ${값} 칸을 못 찾았다 — 이 시험의 전제가 무너졌다`)
    assert.doesNotMatch(줄, /placeholder=/, `마법사 ${값} 칸에 예시 문구가 다시 들어갔다`)
  }
  const 설정 = 읽기('systemSettingsBroadcast.jsx')
  for (const 값 of ['orgName', 'orgSlogan']) {
    const i = 설정.indexOf(`value={${값}}`)
    assert.ok(i > 0, `설정 화면에서 ${값} 칸을 못 찾았다`)
    const 칸 = 설정.slice(i, 설정.indexOf('/>', i))
    assert.doesNotMatch(칸, /placeholder=/, `설정 화면 ${값} 칸에 예시 문구가 다시 들어갔다`)
  }
})
