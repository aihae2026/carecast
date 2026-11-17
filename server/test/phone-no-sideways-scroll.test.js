// 폰에서 화면이 옆으로 밀리지 않는다 (2026-09-04).
//
// 사용자가 정한 화면 3금기 중 하나가 **횡스크롤**이다. 선생님들이 실제로 폰으로 연다.
//
// 표가 그 금기를 깨는 가장 흔한 자리다. 열이 여섯인데 폰 폭은 375px이라 반드시 넘치는데,
// 넘친 것을 **어떻게 다루느냐**가 갈린다:
//   - 감싸개가 `overflow-x-auto`  → 표만 제 안에서 옆으로 밀린다. 본문은 안 밀린다. 괜찮다.
//   - 좁은 화면에서 **열을 접는다** → 아예 안 넘친다. 제일 좋다(예약목록이 이 방식이다).
//   - 감싸개가 `overflow-hidden`  → **잘려서 안 보인다.** 스크롤도 안 되니 담당자·상태 열을
//     볼 방법이 없다. 2026-09-04에 방송로그가 이 상태였다.
//
// 세 번째가 제일 나쁘다 — 화면은 멀쩡해 보이는데 정보가 사라진다.
// 그래서 이 검사는 "표에 좁은 화면 대비가 있는가"만 본다. 어느 방식인지는 화면이 정한다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = path.join(ROOT, 'src')

function jsxFiles(dir, hit = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) jsxFiles(p, hit)
    else if (e.name.endsWith('.jsx')) hit.push(p)
  }
  return hit
}

// 좁은 화면에서 열을 접는 표시. laptop:은 2026-09-04 이관 뒤 이름이다.
const FOLDS = /hidden\s+(?:lg|laptop|md|tablet):table-cell/

test('표가 폰에서 잘리지 않는다 — 밀리거나 접히거나', () => {
  const bad = []
  for (const p of jsxFiles(SRC)) {
    const src = fs.readFileSync(p, 'utf8')
    for (const m of src.matchAll(/<table\b/g)) {
      // 표 바로 앞 구간에 감싸개가 있는가 (같은 카드 안이면 잡힌다)
      const before = src.slice(Math.max(0, m.index - 400), m.index)
      const scrolls = /overflow-x-auto|overflow-x-scroll/.test(before)
      if (!scrolls && !FOLDS.test(src)) {
        bad.push(`${path.relative(ROOT, p).replace(/\\/g, '/')}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
  }
  assert.deepEqual(bad, [],
    `좁은 화면 대비가 없는 표가 있다(${bad.join(' ')}) — 폰에서 오른쪽 열이 `
    + '잘려 나가고 스크롤도 안 된다. 감싸개에 `overflow-x-auto`를 두거나 좁은 화면에서 '
    + '열을 접을 것. 카드의 `overflow-hidden`은 모서리를 다듬는 것이지 대비가 아니다')
})

test('본문 자체가 옆으로 밀 만한 고정 폭이 없다 — 폰 화면', () => {
  // 쉬운화면은 폰에서 매일 쓰는 화면이다. 여기에 375보다 넓은 **고정** 폭이 들어오면
  // 화면 전체가 옆으로 밀린다(감싸개로도 못 막는다 — 본문이 넓어진 것이라서).
  // max-w-는 상한이라 해당 없다. 재는 것은 w-[Npx]와 min-w-[Npx]뿐이다.
  const dirs = [path.join(SRC, 'components', 'easy'), path.join(SRC, 'pages')]
  const bad = []
  for (const d of dirs) {
    for (const p of jsxFiles(d)) {
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/(?:^|[\s"'`])(min-)?w-\[(\d{3,4})px\]/g)) {
        if (Number(m[2]) > 375) {
          bad.push(`${path.basename(p)}:${m[0].trim()}`)
        }
      }
    }
  }
  assert.deepEqual(bad, [],
    `폰 폭(375)보다 넓은 고정 폭이 있다(${bad.join(' ')}) — 화면이 통째로 옆으로 밀린다. `
    + '넓어야 하는 것은 상한(max-w-)으로 적고, 좁은 폭에서는 줄어들게 둘 것')
})
