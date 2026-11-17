// **빠른 단추는 「지금 나갈 것」과 「나중에 나갈 것」으로 묶인다** (사용자 지시 2026-09-15).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// *"내가 하다 보니 알게 됐는데 이게 예약이랑 즉시방송이랑 섞여 있어서 헷갈린 거 같아.
//   [지금방송, 배경음악, 순서] 이렇게 묶어봐 디자인적으로 구분되게, 그리고 예약방송."*
//
// 넷이 한 줄에 나란히 서 있었는데 **셋은 누르면 곧 소리가 나고 하나는 안 난다.**
// 그 차이가 이 줄에서 가장 중요한 사실인데 생김새로는 아무 데도 안 적혀 있었다 —
// 오히려 라벨 하나(「바로 시작」)가 **넷 전부**를 가리켜서 예약도 바로 나가는 것처럼 읽혔다.
//
// ── 무엇을 고정하나 ────────────────────────────────────────────────────────
//  · 묶는 근거가 **각 단추가 이미 들고 있는 `즉시`** 다 — 화면이 제 목록을 따로 안 적는다
//  · 즉시인 것과 아닌 것이 **섞이지 않는다**
//  · 단추가 **하나도 사라지지 않는다** — 묶는 것은 나누는 것이지 버리는 것이 아니다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const Q = require('../../src/lib/quickStart.js')
const 화면 = fs.readFileSync(
  path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')

test('긍정 앵커 — 묶음이 둘 나오고 둘 다 비어 있지 않다', () => {
  const g = Q.단추묶음()
  assert.equal(g.length, 2, `묶음이 ${g.length}개다 — 「지금 바로」와 「나중에」 둘이어야 한다`)
  for (const x of g) assert.ok(x.단추.length > 0, `「${x.이름}」 묶음이 비었다`)
})

test('**즉시인 것과 아닌 것이 섞이지 않는다**', () => {
  for (const 묶음 of Q.단추묶음()) {
    const 기대 = 묶음.키 === 'now'
    for (const b of 묶음.단추) {
      assert.equal(!!b.즉시, 기대,
        `「${묶음.이름}」에 ${b.이름}(즉시=${!!b.즉시})이 들어 있다 — 섞이면 묶는 뜻이 없다`)
    }
  }
})

test('**단추가 하나도 사라지지 않는다** — 나누는 것이지 버리는 것이 아니다', () => {
  const 묶인것 = Q.단추묶음().flatMap(g => g.단추.map(b => b.id)).sort()
  const 전체 = Q.빠른시작.map(b => b.id).sort()
  assert.deepEqual(묶인것, 전체, '묶는 과정에서 단추가 빠지거나 늘었다')
})

test('**묶는 근거를 화면이 따로 안 적는다** — `즉시` 한 곳에서 나온다', () => {
  const 코드만 = 화면.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /단추묶음\(\)/, '화면이 묶음을 안 쓴다')
  // 화면에 단추 id 를 손으로 적어 가르면 언젠가 갈린다.
  for (const id of ['bgm', 'flow', 'schedule']) {
    assert.doesNotMatch(코드만, new RegExp(`즉시[^\\n]*['"]${id}['"]`),
      `화면이 「${id}」 를 손으로 갈라 적고 있다`)
  }
})

test('**두 묶음이 눈으로 갈린다** — 선을 하나 긋는다', () => {
  const 코드만 = 화면.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const i = 코드만.indexOf('단추묶음()')
  assert.ok(i > 0, '묶음을 그리는 자리를 못 찾았다')
  const 블 = 코드만.slice(i, i + 900)
  assert.match(블, /border-/, '두 묶음 사이에 아무 경계가 없다 — 묶었는데 안 보인다')
  // **색으로 가르지 않는다.** 이 줄은 이미 유형 색 셋(말·음악·순서)을 쓰고 있어서,
  // 묶음까지 색으로 말하면 무엇이 무엇을 뜻하는지 갈린다.
  assert.doesNotMatch(블, /bg-ds-v3-(tts|bgm|flow)\b/,
    '묶음을 유형 색으로 칠했다 — 그 색은 「무엇이 나가는가」의 색이다')
})

test('**라벨이 묶음마다 있다** — 하나가 넷을 가리키던 것이 문제였다', () => {
  assert.doesNotMatch(화면, /바로 시작<\/span>/,
    '옛 라벨(「바로 시작」)이 남아 있다 — 그것이 넷 전부를 가리켜 예약도 바로 나가는 줄 알았다')
  assert.match(화면, /\{묶음\.이름\}/, '묶음 이름을 안 보여 준다')
  for (const g of Q.단추묶음()) {
    assert.ok(g.이름 && g.이름.length <= 6, `묶음 이름이 길다: ${g.이름}`)
  }
})
