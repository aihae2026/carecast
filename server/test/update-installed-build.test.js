'use strict'
// **설치판과 소스 설치를 업데이트 라우트가 제대로 가르는가 — 실제로 불러 본다** (2026-09-18).
//
// 독립 QA 가 보인 가장 위험한 변이: `/info` 의 `if (!git저장소인가())` 를 뒤집으면 **소스로 깐 현장 PC 가
// 「설치판」으로 읽혀 업데이트 단추가 사라진다.** 앞 판의 시험은 소스 글자만 봐서 그 변이에도 초록이었다.
//
// 그래서 `server/routes/update.js` 를 **임시 폴더에 그대로 복사**해(프로젝트 뿌리 = 그 임시 폴더) `.git` 이
// 있는 판·없는 판을 만들고 라우트를 직접 부른다.
//  · 자동 업데이트 모듈은 **가짜**로 바꾼다 — git·npm·재시작이 절대 안 돈다.
//  · 업데이트를 실제로 시작할 수 있는 `POST /start` 는 **막히는 쪽(설치판)에서만** 부른다.
//    소스 설치 쪽은 막히지 않으므로 `runUpdate()` 가 돌 수 있다 — 그래서 거기서는 `/info` 만 본다.
//  · 복사본에서 바꾸는 것은 `require('express')` 경로 한 줄뿐이다(임시 폴더엔 node_modules 가 없다). 판정 로직은 글자 그대로다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 원본 = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'update.js'), 'utf8')
const express경로 = require.resolve('express', { paths: [path.join(ROOT, 'server')] })

const 가짜자동업데이트 = `'use strict'
module.exports = {
  getAutoStatus: () => ({ lastCheck: null, lastUpdate: null, lastError: null, log: [] }),
  saveLastUpdate: () => {},
  restartWhenIdle: () => { throw new Error('시험 중 재시작 호출 — 절대 안 된다') },
  isUpdating: () => false,
  currentBlockedReason: () => null,
}
`

const 임시들 = []
test.after(() => { for (const d of 임시들) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 그만 */ } } })

/** 임시 프로젝트를 만든다. git: 'dir'(폴더) | 'file'(워크트리처럼 파일) | null(설치판) */
function 만들기({ git, 릴리스정보 }) {
  const 뿌리 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-upd-'))
  임시들.push(뿌리)
  fs.mkdirSync(path.join(뿌리, 'server', 'routes'), { recursive: true })
  fs.mkdirSync(path.join(뿌리, 'server', 'services'), { recursive: true })
  const 복사 = 원본.replace("require('express')", `require(${JSON.stringify(express경로)})`)
  assert.notEqual(복사, 원본, '긍정 앵커 — express 경로를 바꿨다')
  fs.writeFileSync(path.join(뿌리, 'server', 'routes', 'update.js'), 복사)
  fs.writeFileSync(path.join(뿌리, 'server', 'services', 'autoUpdate.js'), 가짜자동업데이트)
  if (git === 'dir') fs.mkdirSync(path.join(뿌리, '.git'))
  if (git === 'file') fs.writeFileSync(path.join(뿌리, '.git'), 'gitdir: ../elsewhere\n')
  if (릴리스정보) fs.writeFileSync(path.join(뿌리, '릴리스정보.txt'), 릴리스정보, 'utf8')
  return require(path.join(뿌리, 'server', 'routes', 'update.js'))
}

function 부르기(router, 방식, 경로) {
  const layer = router.stack.find(l => l.route?.path === 경로 && l.route.methods[방식])
  assert.ok(layer, `긍정 앵커 — ${방식.toUpperCase()} ${경로} 가 있다`)
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(v) { resolve(v) } }
    layer.route.stack[0].handle({ body: {} }, res, () => resolve(null))
  })
}

const 실제양식 = 'CareCast 설치판\n\n만든 날: 2026-09-18\n대응 커밋: 7e2a5c83 (main)\n함께 담긴 것: Node.js 24\n'

test('설치판(.git 없음) — 「설치판」이라 알리고 판 정보를 릴리스정보.txt 에서 읽는다', async () => {
  const r = 만들기({ git: null, 릴리스정보: 실제양식 })
  const 답 = await 부르기(r, 'get', '/info')
  assert.equal(답.gitRepo, false)
  assert.equal(답.commit, '7e2a5c83')
  assert.equal(답.date, '2026-09-18')
})

test('설치판 — 「지금 업데이트」 요청은 git 을 부르기 전에 거절한다', async () => {
  const r = 만들기({ git: null, 릴리스정보: 실제양식 })
  const 답 = await 부르기(r, 'post', '/start')
  assert.equal(답.ok, false)
  assert.match(답.msg, /새 설치 파일/)
  // 거절 뒤에도 잠금이 안 남는다 — 다음 요청이 「이미 업데이트 중」으로 막히면 안 된다
  const 다시 = await 부르기(r, 'post', '/start')
  assert.match(다시.msg, /새 설치 파일/, '앞 거절이 잠금을 남겼다')
})

test('**소스 설치(.git 폴더) — 「설치판」으로 읽히지 않는다**(현장 PC 의 업데이트 단추가 살아 있어야 한다)', async () => {
  const r = 만들기({ git: 'dir', 릴리스정보: null })
  const 답 = await 부르기(r, 'get', '/info')
  assert.equal(답.gitRepo, true, '현장 PC(소스 설치)가 설치판으로 읽혔다 — 업데이트 단추가 사라진다')
})

test('git 워크트리(.git 이 파일) — 역시 소스 설치로 읽는다', async () => {
  const r = 만들기({ git: 'file', 릴리스정보: null })
  const 답 = await 부르기(r, 'get', '/info')
  assert.equal(답.gitRepo, true, '워크트리를 설치판으로 오판했다')
})

test('설치판인데 릴리스정보.txt 가 없거나 모양이 달라도 죽지 않는다 — 판 정보만 비운다', async () => {
  const 없음 = await 부르기(만들기({ git: null, 릴리스정보: null }), 'get', '/info')
  assert.deepEqual([없음.gitRepo, 없음.commit, 없음.date], [false, null, null])
  const 딴말 = await 부르기(만들기({ git: null, 릴리스정보: 'hello\n' }), 'get', '/info')
  assert.deepEqual([딴말.gitRepo, 딴말.commit], [false, null])
})
