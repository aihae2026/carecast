// 구성도 라우트 — 개발 콘솔의 「구성도」 탭이 읽는 곳.
// 확인하는 것: 목록이 코드 안 표에서만 나온다(요청이 파일명을 정하지 않는다), 없는 그림은 404,
// 있는 그림은 HTML로 나간다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { startTestApp } = require('./helpers/testApp')
const archRoutes = require('../routes/archViews')

let app
test.before(async () => { app = await startTestApp({ '/api/dev/arch': archRoutes }) })
test.after(async () => { await app.close() })

test('목록은 그림 4장을 돌려준다 — 합본만 여기서 다시 만들 수 있다', async () => {
  const r = await fetch(app.baseUrl + '/api/dev/arch')
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.deepEqual(d.views.map(v => v.key),
    ['system-map', 'structure', 'flow-reserve', 'flow-broadcast'])
  assert.equal(d.views.filter(v => v.buildable).map(v => v.key).join(','), 'system-map')
  for (const v of d.views) assert.ok(v.title && v.detail, `${v.key}에 제목·설명이 있어야 한다`)
})

test('모르는 이름은 404 — 파일 경로를 요청이 정하지 못한다', async () => {
  for (const bad of ['nope', '../package.json', '..%2f..%2fpackage.json']) {
    const r = await fetch(app.baseUrl + '/api/dev/arch/' + encodeURIComponent(bad) + '/html')
    assert.equal(r.status, 404, `${bad}는 404여야 한다`)
  }
})

test('있는 그림은 HTML로, 없는 그림은 404로 나간다', async () => {
  const list = await (await fetch(app.baseUrl + '/api/dev/arch')).json()
  for (const v of list.views) {
    const r = await fetch(app.baseUrl + `/api/dev/arch/${v.key}/html`)
    if (v.exists) {
      assert.equal(r.status, 200, `${v.key}는 파일이 있으니 200이어야 한다`)
      assert.match(r.headers.get('content-type') || '', /html/)
    } else {
      assert.equal(r.status, 404, `${v.key}는 파일이 없으니 404여야 한다`)
    }
  }
})

test('그림 파일 목록은 docs/arch 안만 가리킨다', () => {
  const dir = path.join(__dirname, '..', '..', 'docs', 'arch')
  for (const v of archRoutes.VIEWS) {
    assert.equal(path.dirname(path.resolve(dir, v.file)), path.resolve(dir),
      `${v.key}의 파일이 docs/arch 밖을 가리킨다`)
    assert.equal(v.file.endsWith('.html'), true)
  }
  assert.ok(fs.existsSync(dir), 'docs/arch 폴더가 있어야 한다')
})

test('다시 만들기 상태는 처음엔 멈춰 있다', async () => {
  const r = await fetch(app.baseUrl + '/api/dev/arch/rebuild/status')
  const d = await r.json()
  assert.equal(d.running, false)
})
