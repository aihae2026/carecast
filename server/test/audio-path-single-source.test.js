// 음원이 사는 곳을 **한 곳만 계산한다** (2026-09-05).
//
// 2026-09-05까지 같은 경로를 네 곳이 각자 만들었다: routes/audio.js · scripts/caption-draft.cjs ·
// db/schema.js(카테고리 폴더 만들기) · index.js(정적 서빙). 넷이 같은 값을 뱉는 동안에는 아무
// 일도 없다 — 그래서 위험하다. 한 곳을 옮기면 **나머지가 조용히 다른 데를 본다**: 파일은 A에
// 저장되고 서빙은 B에서 찾아 404가 나고, 방송은 무음이 된다. 오류 로그는 안 남는다.
//
// 그래서 사본을 막는다. 주석에서 경로를 **설명하는** 것은 통과시킨다 — 막으려는 것은
// 그 경로를 코드로 다시 조립하는 것이다(category-pick.test.js가 쓰는 것과 같은 구분).
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const SINGLE_SOURCE = path.join('server', 'domain', 'audioPaths.js')

// 훑을 곳 — 서버 코드와 명령줄 스크립트. 테스트는 뺀다(자기 임시 파일 경로를 만든다).
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test' || e.name === 'public' || e.name === 'db') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(js|cjs)$/.test(e.name)) out.push(full)
  }
  return out
}

test('음원 경로를 스스로 조립하는 곳이 audioPaths.js 하나뿐이다', () => {
  const files = [
    ...walk(path.join(ROOT, 'server')),
    ...walk(path.join(ROOT, 'scripts')),
    path.join(ROOT, 'server', 'db', 'schema.js'),
  ]
  const offenders = []
  for (const file of files) {
    const rel = path.relative(ROOT, file)
    if (rel === SINGLE_SOURCE) continue
    const src = fs.readFileSync(file, 'utf8')
    // path.join(... 'public', 'audio' ...) 꼴만 본다. 주석의 설명은 안 걸린다.
    if (/['"]public['"]\s*,\s*['"]audio['"]/.test(src)) offenders.push(rel)
  }
  assert.deepEqual(offenders, [],
    `음원 경로를 스스로 만드는 곳이 있다(${offenders.join(' ')}) — domain/audioPaths.js에서 가져다 쓸 것. `
    + '사본이 갈리면 저장하는 곳과 찾는 곳이 달라져 404와 무음이 난다(오류는 안 난다)')
})

test('단일 출처가 실제로 그 폴더를 가리킨다', () => {
  const { AUDIO_DIR, audioCategoryDir, audioFilePath } = require('../domain/audioPaths')
  assert.equal(AUDIO_DIR, path.join(ROOT, 'server', 'public', 'audio'),
    '경로가 옮겨갔다 — 업로드된 음원이 있는 자리와 다르면 전부 못 찾는다')
  assert.equal(audioCategoryDir('bgm'), path.join(AUDIO_DIR, 'bgm'))
  assert.equal(audioFilePath('bgm', 'a.mp3'), path.join(AUDIO_DIR, 'bgm', 'a.mp3'))
})
