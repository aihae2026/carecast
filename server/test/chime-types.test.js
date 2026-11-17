// 차임벨 유형 드리프트 방어.
//
// 왜 필요했나: chimePlayer.playChime()이 오랫동안 `(type === 'end') ? 'end' : 'general'`로
// 모르는 값을 전부 general로 접고 있었다. 그 사이 scheduler.js와 flowRunner.js는 'meal'을
// 넘기고 있었는데, 소리가 나긴 하니(general 음색) 아무도 눈치채지 못했다. 오타든 폐기된
// 이름이든 "조용히 다른 소리가 난다"가 되는 구조라, 세 곳(호출부 / JS 목록 / 파이썬 PATTERNS)을
// 서로 붙여 둔다.
const { test } = require('node:test')
const assert   = require('node:assert')
const fs       = require('fs')
const path     = require('path')

const { CHIME_TYPES, normalizeChimeType } = require('../services/chimePlayer')

const SERVICES = path.join(__dirname, '..', 'services')

// 서버 코드에서 차임 유형 문자열을 넘기는 자리를 전부 긁어온다.
function collectChimeTypeLiterals() {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(p); continue }
      if (!entry.name.endsWith('.js')) continue
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/playChime\(\s*'([^']+)'/g)) {
        found.push({ file: path.basename(p), type: m[1], where: 'playChime' })
      }
      for (const m of src.matchAll(/broadcastSSE\(\s*'chime_play'\s*,\s*\{\s*type:\s*'([^']+)'/g)) {
        found.push({ file: path.basename(p), type: m[1], where: 'chime_play SSE' })
      }
    }
  }
  walk(path.join(__dirname, '..'))
  return found
}

test('파이썬 PATTERNS와 JS의 CHIME_TYPES가 같은 목록이어야 한다', () => {
  // 실제로 소리를 만드는 쪽은 carecast_chime.py다. JS 목록이 더 넓으면 그 유형은 파이썬에서
  // general로 폴백되고(=조용한 오독), 더 좁으면 낼 수 있는 소리를 못 쓰게 된다.
  const py = fs.readFileSync(path.join(SERVICES, 'carecast_chime.py'), 'utf8')
  const block = py.match(/PATTERNS\s*=\s*\{([\s\S]*?)\n\}/)
  assert.ok(block, 'carecast_chime.py에서 PATTERNS를 찾지 못했다')
  const pyTypes = [...block[1].matchAll(/'([^']+)'\s*:/g)].map(m => m[1])

  assert.ok(pyTypes.length >= 2, `PATTERNS를 제대로 읽지 못했다: ${JSON.stringify(pyTypes)}`)
  assert.deepEqual(
    [...pyTypes].sort(), [...CHIME_TYPES].sort(),
    '파이썬이 낼 수 있는 차임음과 JS가 아는 목록이 어긋났다',
  )
})

test('차임벨을 호출하는 모든 자리가 아는 유형만 넘겨야 한다', () => {
  const literals = collectChimeTypeLiterals()
  assert.ok(literals.length >= 3, `호출부를 제대로 읽지 못했다: ${JSON.stringify(literals)}`)

  for (const { file, type, where } of literals) {
    assert.ok(
      CHIME_TYPES.includes(type),
      `${file}의 ${where}가 모르는 차임 유형 '${type}'을 넘긴다 — ` +
      `general로 접혀서 의도와 다른 소리가 난다. 아는 유형: ${CHIME_TYPES.join(', ')}`,
    )
  }
})

test('모르는 유형은 general로 재생하되 조용히 넘어가지 않는다', () => {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    assert.equal(normalizeChimeType('meal'), 'general')
  } finally {
    console.warn = original
  }
  assert.equal(warnings.length, 1, '모르는 유형인데 경고가 없다 — 다음 오타도 조용히 지나간다')
  assert.match(warnings[0], /meal/)
})

test('아는 유형은 그대로 통과하고 경고하지 않는다', () => {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    for (const t of CHIME_TYPES) assert.equal(normalizeChimeType(t), t)
  } finally {
    console.warn = original
  }
  assert.deepEqual(warnings, [], '정상 유형에 경고가 뜨면 잔소리가 된다')
})
