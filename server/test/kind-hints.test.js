// 타이핑 힌트 낱말이 **서버 사전과 어긋나지 않는가** (2026-09-13).
//
// 화면은 글자를 칠 때마다 서버를 부를 수 없어서(`parse-phrase` 는 규칙이 시각을 못 읽으면
// Gemini 를 부른다 — 유료·10.5초) 힌트 낱말을 제 쪽에 들고 있다.
// **그 순간 사전이 두 벌이 된다.** 이 저장소가 가장 비싸게 겪은 실패의 모양이다
// (`Sidebar` 의 hex 사본이 UX-42 뒤로 옛 색에 남아 있었던 것과 같다).
//
// 그래서 이 시험이 **양쪽을 실제로 읽어 대조한다.** 서버에 낱말이 하나 늘면 여기가
// 빨간불이 되고, 화면 목록에도 넣어야 초록이 된다. 사람이 기억하지 않아도 된다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..', '..')
const ontology = require(path.join(ROOT, 'server', 'domain', 'ontology.js'))

/** 정규식 `/(가|나|다)/` 에서 낱말을 꺼낸다 — TTS_CUES·FLOW_CUES 가 그 모양이다. */
function 정규식낱말(src, 이름) {
  const m = src.match(new RegExp(`const ${이름} = /\\(([^)]*)\\)/`))
  assert.ok(m, `${이름} 를 못 찾았다 — 모양이 바뀌었으면 이 시험도 같이 고친다`)
  return m[1].split('|').map(s => s.trim()).filter(Boolean)
}

let 화면
test('양쪽을 불러온다', async () => {
  화면 = await import(pathToFileURL(path.join(ROOT, 'src/lib/broadcastKind.js')).href)
  assert.ok(화면.KIND_HINTS && 화면.guessKindFromText, '내보내는 것이 바뀌었다')
  assert.ok(Array.isArray(ontology.CONCEPTS) && ontology.CONCEPTS.length > 0, '서버 사전이 비었다')
})

test('음악 힌트가 서버의 음악 낱말을 빠짐없이 덮는다', () => {
  // `kindOfType` 이 'bgm' 으로 보내는 유형은 `bgm` 과 `youtube-tv` 둘이다.
  const 서버낱말 = ontology.CONCEPTS
    .filter(c => 화면.kindOfType(c.broadcastType) === 'bgm')
    .flatMap(c => c.nouns)
  assert.ok(서버낱말.length > 0, '서버에 음악 낱말이 없다 — 사전 구조가 바뀌었나')

  const 빠진것 = 서버낱말.filter(w => !화면.KIND_HINTS.bgm.includes(w))
  assert.deepEqual(빠진것, [],
    `서버 사전에 있는 음악 낱말이 화면 힌트에 없다: ${빠진것.join(', ')}\n` +
    '→ src/lib/broadcastKind.js 의 KIND_HINTS.bgm 에 더한다')

  // **반대 방향도 본다.** 화면에만 있는 낱말은 서버가 모르는 말이라, 색은 서는데
  // 확정하면 다른 종류가 되는 **거짓 힌트**가 된다.
  const 군더더기 = 화면.KIND_HINTS.bgm.filter(w => !서버낱말.includes(w))
  assert.deepEqual(군더더기, [],
    `화면 힌트에만 있는 음악 낱말: ${군더더기.join(', ')} — 서버가 모르는 말이다`)
})

test('순서·말 힌트가 서버의 단서 낱말과 같다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/domain/ontology.js'), 'utf8')
  for (const [kind, 이름] of [['flow', 'FLOW_CUES'], ['tts', 'TTS_CUES']]) {
    const 서버낱말 = 정규식낱말(src, 이름)
    assert.deepEqual([...화면.KIND_HINTS[kind]].sort(), [...서버낱말].sort(),
      `${kind} 힌트가 ${이름} 와 다르다\n` +
      `  화면: ${화면.KIND_HINTS[kind].join(', ')}\n  서버: ${서버낱말.join(', ')}`)
  }
})

test('색이 안 서는 종류에는 힌트를 두지 않는다', () => {
  // 차임벨·음원·영상은 색이 없다(G-1). 힌트 목록에 그 낱말이 들어오면
  // 색이 없는 것에 색을 주게 된다.
  const 무색낱말 = ontology.CONCEPTS
    .filter(c => 화면.kindOfType(c.broadcastType) === '')
    .flatMap(c => c.nouns)
  assert.ok(무색낱말.length > 0, '무색 유형이 없다 — 사전 구조가 바뀌었나')

  const 전부 = Object.values(화면.KIND_HINTS).flat()
  const 잘못든것 = 무색낱말.filter(w => 전부.includes(w))
  assert.deepEqual(잘못든것, [],
    `색이 없는 종류의 낱말이 힌트에 들어왔다: ${잘못든것.join(', ')} — G-1`)
})

test('단서가 없으면 색을 주지 않는다 — 아무 말에나 칠하지 않는다', () => {
  // **목업과 다른 자리다.** 목업은 아무것도 안 걸리면 `tts` 로 떨어뜨린다. 그러면
  // 글자를 치는 순간 늘 파랑이 되어 색이 아무것도 못 가리킨다(G-2).
  for (const 빈것 of ['', '   ', '11시에 점심', '내일 2시', '어르신들께'])
    assert.equal(화면.guessKindFromText(빈것), '',
      `"${빈것}" 에 색이 섰다 — 단서가 나왔을 때만 칠한다`)
})

test('짐작이 맞다 — 그리고 보는 순서가 지켜진다', () => {
  for (const [글, 기대] of [
    ['11시에 점심 안내',      'tts'],
    ['잔잔한 클래식 틀어줘',  'bgm'],
    ['아침 흐름 실행해',      'flow'],
    // **순서가 중요하다.** 말(`안내`)의 낱말이 가장 흔해서 먼저 보면 아래가 전부 파랑이 된다.
    ['음악 안내 방송',        'bgm'],
    ['순서 안내',             'flow'],
  ]) assert.equal(화면.guessKindFromText(글), 기대, `"${글}" 이 ${기대} 가 아니다`)
})
