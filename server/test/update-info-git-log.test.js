'use strict'
// **`/api/update/info` 가 판 정보를 돌려준다** (2026-10-17, Windows Sandbox 설치 시험 c12).
//
// 소스로 깐 PC 에서 `/api/update/info` 가 `{"gitRepo":true,"commit":null}` 만 돌려줬다.
// `git log -1 --format=%h|||%s|||%cd` 를 `exec` 로 넘기면 Windows 에서는 cmd.exe 를 거치는데,
// 따옴표 없는 `|` 를 cmd 가 **파이프**로 읽어 `||%s` 같은 없는 명령을 부르고 실패했다.
// 셸을 거치지 않게(execFile) 바꾼 뒤 이 시험이 통과한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const express = require('express')

const 저장소 = path.join(__dirname, '..', '..')

test('git 저장소에서 /info 가 커밋·제목·날짜를 돌려준다', { skip: !fs.existsSync(path.join(저장소, '.git')) && '.git 이 없는 판' }, async () => {
  const app = express()
  app.use('/api/update', require('../routes/update'))
  const server = app.listen(0)
  try {
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/api/update/info`)
    const body = await res.json()
    assert.equal(body.gitRepo, true)
    assert.match(String(body.commit), /^[0-9a-f]{7,}$/, `커밋이 비었다: ${JSON.stringify(body)}`)
    assert.ok(body.subject && !body.subject.includes('|||'), '제목이 갈리지 않았다')
    assert.match(String(body.date), /^\d{4}-\d{2}-\d{2}$/)
  } finally {
    server.close()
  }
})
