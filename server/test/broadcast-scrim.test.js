'use strict'
// **방송 바탕(그라디언트)은 방송 내내 켜져 있다** (사용자 지시 2026-09-15).
//
// ── 무엇이 문제였나 ────────────────────────────────────────────────────────
// *"왜 그라디언트가 자막 있을 때마다 켜지고 또 잠깐 꺼지고 켜지고 반복해
//   정신사납게. 그냥 자동방송시간에는 쭉 켜놔, 그리고 자동방송 1분전에는 켜놔."*
//
// 어두운 바탕이 **자막 부품 안에** 있었다. 그 부품은 읽을 줄이 없으면 통째로
// 사라지므로(`if (!cue || idx < 0) return null`), **줄과 줄 사이마다** 바탕이 같이
// 꺼졌다 켜졌다 했다 — 방송 한 번에 수십 번이다.
//
// 바탕을 자막 부품에서 **떼어 냈다.** 다만 「방송 내내」로 넓혔다가 설정 화면까지
// 어두워지는 사고가 났고(아래 §범위를 좁혔다), 지금은 **자막 한 판**에 묶여 있다.
//
// ── 아래 「1분 전」 시험들은 **규칙만 지킨다** ────────────────────────────────
// `lib/scrimRules.곧나가나` 는 사용자 지시(*"자동방송 1분전에는 켜놔"*)를 담은 규칙이고
// **계산은 맞다.** 다만 그 예열을 **모든 화면**에 걸 수는 없어서(설정 화면까지 어두워진다)
// 지금은 어디에도 안 물려 있다. 방송 화면만 가려낼 방법이 생기면 그때 다시 쓴다.
// **규칙을 지우지 않는 이유**: 지우면 그 지시가 있었다는 사실까지 사라진다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 곧나가나, 미리켜는초 } = require('../../src/lib/scrimRules.js')

const 때 = (s) => new Date(s)
const 줄 = (time, status = 'pending') => ({ time, status, kind: 'auto', label: '아침 종합 방송' })

test('**1분 전부터 켠다** — 사용자 지시가 1분이다', () => {
  assert.equal(미리켜는초, 60)
  assert.equal(곧나가나([줄('07:50')], 때('2026-09-15T07:49:05')), true, '1분 전인데 안 켜진다')
  assert.equal(곧나가나([줄('07:50')], 때('2026-09-15T07:49:59')), true, '1초 전인데 안 켜진다')
})

test('**1분보다 이르면 아직 안 켠다** — 하루 종일 어두우면 뜻이 없다', () => {
  assert.equal(곧나가나([줄('07:50')], 때('2026-09-15T07:48:59')), false)
  assert.equal(곧나가나([줄('07:50')], 때('2026-09-15T06:00:00')), false)
})

test('**시각이 지나면 이 판정은 끝난다**', () => {
  // 예열은 「아직 안 나간 방송」을 위한 것이다. 시각이 지나면 소리가 나기 시작한다.
  assert.equal(곧나가나([줄('07:50')], 때('2026-09-15T07:50:00')), false)
  assert.equal(곧나가나([줄('07:50')], 때('2026-09-15T07:50:30')), false)
})

test('**이미 끝났거나 놓친 방송 앞에는 안 켠다**', () => {
  // 서버 판정을 그대로 쓴다 — 화면이 따로 세면 watchdog 경보와 갈린다.
  assert.equal(곧나가나([줄('07:50', 'done')],   때('2026-09-15T07:49:30')), false)
  assert.equal(곧나가나([줄('07:50', 'missed')], 때('2026-09-15T07:49:30')), false)
})

test('여럿 중 하나라도 곧이면 켠다', () => {
  const 오늘 = [줄('07:50', 'done'), 줄('09:00'), 줄('11:15')]
  assert.equal(곧나가나(오늘, 때('2026-09-15T08:59:30')), true)
  assert.equal(곧나가나(오늘, 때('2026-09-15T10:00:00')), false)
})

test('이상한 값이 와도 안 죽는다', () => {
  assert.equal(곧나가나(null), false)
  assert.equal(곧나가나(undefined), false)
  assert.equal(곧나가나([{ time: null, status: 'pending' }], 때('2026-09-15T07:49:30')), false)
  assert.equal(곧나가나([{ time: '이상함', status: 'pending' }], 때('2026-09-15T07:49:30')), false)
})

// ── 자막이 더는 바탕을 그리지 않는다 ───────────────────────────────────────
test('**자막 부품이 제 바탕을 안 그린다** — 그것이 깜빡임의 원인이었다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/broadcast/BroadcastCaption.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  // 긍정 앵커 — 자막 부품이 그대로 있고, 읽을 줄이 없으면 사라지는 성질도 그대로다.
  assert.match(코드만, /export function BroadcastCaption/, '자막 부품이 사라졌다')
  assert.match(코드만, /if \(!cue \|\| idx < 0\) return/, '사라지는 성질이 바뀌었다 — 전제를 다시 볼 것')

  assert.ok(!/linear-gradient\(to top, rgba\(0,0,0,0\.82\)/.test(코드만),
    '자막이 아직 제 바탕을 그린다 — 줄과 줄 사이마다 깜빡인다')
})

// ── **범위를 좁혔다** (현장 신고 2026-09-16) ────────────────────────────────
// *"뭐여 지금 방송시간인데 방송중도 없고 그냥 밑에 그라데이션만 깔리는 버그 지금 실시간"*
//
// 처음엔 **방송이 시작되면** 켜지게 했다. 그런데 이 층은 `App.jsx` 에 붙어 **모든
// 화면**에 깔린다 — 설정 화면에서 일하는데 아래가 어두워졌다. 게다가 `z-9990` 이라
// **재생바(z-56)를 덮어서** 「지금 방송 중」 표시가 그 밑으로 숨었다.
//
// **바탕은 「방송 중」이 아니라 「자막이 나가는 중」을 말해야 한다.** 그것이 원래 이
// 물건이 있던 자리(자막 부품 안)의 뜻이고, 고칠 때 넓히지 말았어야 했다.
test('**바탕은 자막 한 판에 묶인다** — 줄이 아니라 판이다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/broadcast/BroadcastScrim.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  assert.match(코드만, /carecast:caption-session/, '자막 판 신호를 안 듣는다')
  assert.match(코드만, /carecast:broadcast-completed/, '끝 신호를 안 듣는다 — 놓치면 계속 깔린다')

  // **방송 시작만으로는 안 켠다.** 그러면 설정 화면에서 일하는 사람의 아래가 어두워지고
  // 재생바가 그 밑에 숨는다(2026-09-16 현장 신고).
  assert.ok(!코드만.includes('carecast:broadcast-started'),
    '방송 시작만으로 바탕을 깐다 — 자막이 없는 화면에서도 아래가 어두워진다')
  assert.ok(!코드만.includes('곧나가나'),
    '1분 전 예열이 살아 있다 — 그 예열이 설정 화면까지 어둡게 만든다')

  // **안 나갈 때는 아무것도 안 덮는다.** `opacity: 0` 으로 두면 층은 그대로 남아
  // 그 밑의 것을 가린다(포인터는 통과해도 그림은 위에 있다).
  assert.match(코드만, /if \(!나가는중\) return null/,
    '안 나갈 때도 층이 남는다 — 그 밑의 재생바가 가려진다')
})

test('**미리보기 자막은 화면을 안 덮는다** — 편집기 안의 자막이다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/broadcast/BroadcastScrim.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /embedded/, '미리보기를 안 가른다 — 편집기에서 재생하면 화면이 통째로 어두워진다')
})

test('**자막이 제 판을 알린다** — 알리는 쪽이 없으면 위 시험이 뜻이 없다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/broadcast/BroadcastCaption.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const 켬 = (코드만.match(/caption-session[^\n]*on: true/g) || []).length
  const 끔 = (코드만.match(/caption-session[^\n]*on: false/g) || []).length
  assert.ok(켬 >= 1, '자막이 「시작했다」를 안 알린다')
  assert.ok(끔 >= 2, `자막이 「끝났다」를 ${끔}곳에서만 알린다 — 끝나는 길이 여럿이다(정지·끝)`)
})

test('**화면에 실제로 달려 있다** — 부품만 만들고 안 쓰면 소용없다', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8')
  const 코드만 = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /<BroadcastScrim\s*\/>/, '바탕 층이 화면에 안 달렸다')
})
