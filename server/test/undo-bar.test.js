// 「방금 추가했습니다 · 취소」 띠 — 되돌리기의 규칙 (2026-09-13 사용자 결정).
//
// ── 왜 시험이 있나 ──────────────────────────────────────────────────────────
// 이 띠는 **예약을 지울 수 있는 단추**를 달고 있다. 그래서 세 가지가 동시에 참이어야 한다:
//
//   ① 스스로 사라진다      — 없으면 새로고침할 때까지 남아 화면에 눌어붙는다.
//   ② 치우는 길이 따로 있다 — 예전에는 띠를 치우는 **유일한** 단추가 「취소」였다.
//      알림만 없애려고 누르면 방금 만든 예약이 지워진다. 그건 안내가 아니라 **덫**이다.
//   ③ 손이 닿으면 멈춘다   — 「취소」를 누르러 가는 중에 닫히면 그것이 사고다.
//      멈출 수 있으니 5초로 짧게 둘 수 있다(3초는 제목을 읽고 판단하기에 짧다).
//
// 셋 중 하나만 빠져도 나머지가 위험해진다 — ①만 있고 ③이 없으면 손이 닿는 중에 닫히고,
// ①만 있고 ②가 없으면 급한 사람이 「취소」를 눌러 예약을 잃는다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n')
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const P = 'src/components/shared/QuickSchedulePhrase.jsx'

test('감시할 대상이 그 자리에 있다', () => {
  assert.ok(fs.existsSync(path.join(ROOT, P)), `${P} 가 없다 — 옮겼으면 이 시험도 같이 옮긴다`)
  assert.match(codeOnly(read(P)), /예약을 추가했습니다/, '되돌리기 띠가 없다 — 시험이 낡았다')
})

test('① 띠는 스스로 사라진다 — 사람이 안 치워도 된다', () => {
  const code = codeOnly(read(P))
  const m = code.match(/const UNDO_MS = (\d+)/)
  assert.ok(m, '머무는 시간이 상수로 없다 — 값이 코드 곳곳에 흩어지면 게이지와 어긋난다')
  const ms = Number(m[1])
  // 아래 위아래 선은 **취향이 아니라 근거**다. 3초 미만이면 제목을 읽고 판단하기 전에
  // 닫히고, 30초를 넘으면 "사라지는 알림"이라기보다 눌어붙은 것에 가깝다.
  assert.ok(ms >= 3000, `머무는 시간이 ${ms}ms — 제목을 읽고 판단하기에 짧다`)
  assert.ok(ms <= 30000, `머무는 시간이 ${ms}ms — 이만큼 남으면 화면에 눌어붙는다`)
  assert.match(code, /setJustAdded\(null\)[\s\S]{0,40}\}\s*\}, 80\)|남 === 0.*setJustAdded\(null\)/,
    '시간이 다 돼도 띠를 안 내린다')
})

test('② 치우는 길과 지우는 길이 다르다 — 이것이 이 시험의 핵심이다', () => {
  const code = codeOnly(read(P))

  // 알림만 닫는 단추가 있다. 그리고 그것은 **취소 함수를 부르지 않는다.**
  const m = code.match(/onClick=\{\(\) => \{ setJustAdded\(null\); setCancelError\(''\) \}\}/)
  assert.ok(m, '알림만 닫는 단추가 없다 — 치우려면 「취소」를 눌러 예약을 지우는 수밖에 없다')

  // 낭독기·마우스 올렸을 때 **무엇이 안 일어나는지**를 말해 준다.
  assert.match(code, /aria-label="이 알림 닫기 \(예약은 그대로 둡니다\)"/,
    '닫기 단추가 "예약은 그대로 둔다"를 안 밝힌다 — 「취소」 옆이라 반드시 갈라 말해야 한다')

  // 되돌리기 단추는 여전히 진짜로 취소한다(닫기와 뒤바뀌지 않았나).
  assert.match(code, /onClick=\{handleCancelJustAdded\}/, '「취소」가 취소를 안 부른다')
  assert.match(code, /cancelAiSchedule\(justAdded\.id\)/, '취소가 예약을 안 지운다')
})

test('③ 손이 닿으면 게이지가 멈춘다 — 누르러 가는 중에 닫히지 않는다', () => {
  const code = codeOnly(read(P))
  assert.match(code, /onMouseEnter=\{\(\) => set멈춤\(true\)\}/,  '마우스를 올려도 안 멈춘다')
  assert.match(code, /onMouseLeave=\{\(\) => set멈춤\(false\)\}/, '손을 떼도 다시 안 간다')
  // 키보드로 쓰는 사람도 같아야 한다 — 초점이 안쪽 단추로 들어오면 멈춘다.
  assert.match(code, /onFocusCapture=\{\(\) => set멈춤\(true\)\}/, '초점이 들어와도 안 멈춘다')
  assert.match(code, /onBlurCapture=\{\(\) => set멈춤\(false\)\}/, '초점이 나가도 다시 안 간다')
  // 멈추면 **남은 시간부터** 이어가야 한다. 처음부터 다시 세면 영영 안 닫힌다.
  assert.match(code, /const 처음 = 남은ms\.current/,
    '멈췄다 이어갈 때 남은 시간을 안 본다 — 처음부터 다시 세면 손만 올려도 영영 안 닫힌다')
})

test('게이지와 사라지는 시점은 **같은 시계**를 본다', () => {
  const code = codeOnly(read(P))
  // 게이지를 CSS 애니메이션으로 따로 돌리면 둘이 어긋나고, 움직임을 줄인 기기에서는
  // 애니메이션이 죽어 `animationend` 가 영영 안 와 **띠가 안 사라진다.**
  assert.doesNotMatch(code, /animationend|onAnimationEnd/,
    '게이지를 CSS 애니메이션 끝으로 닫는다 — 움직임을 줄인 기기에서 영영 안 닫힌다')
  assert.match(code, /set게이지\(남 \/ UNDO_MS\)/, '게이지가 남은 시간에서 안 나온다')

  // **투명도 수식어를 쓰지 않는다.** `--ds-v3-*` 는 `var()` 색이라 Tailwind v3 에서
  // 투명도가 안 먹고 **오류 없이 조용히 투명해진다** — 실제로 `bg-ds-v3-bgm/70` 으로
  // 뒀다가 화면에서 게이지가 안 보였다(2026-09-13).
  const 게이지줄 = code.match(/role="progressbar"[\s\S]{0,400}?\/>/)
  assert.ok(게이지줄, '게이지를 못 찾았다')
  assert.doesNotMatch(게이지줄[0], /bg-ds-v3-[\w-]+\/\d/,
    '게이지 색에 투명도 수식어를 썼다 — var() 색에는 안 먹어 조용히 투명해진다')

  // 남은 시간을 **눈으로만** 알리지 않는다 — 낭독기에도 진행률로 준다.
  assert.match(게이지줄[0], /aria-valuenow=\{Math\.round\(게이지 \* 100\)\}/,
    '게이지가 낭독기에 진행률을 안 알린다')
})

test('띠를 띄우는 문은 하나다 — 시계를 안 감고 띄우는 길이 없다', () => {
  const code = codeOnly(read(P))
  assert.match(code, /const 띠띄우기 = \(값\) => \{[\s\S]{0,200}?남은ms\.current = UNDO_MS/,
    '띄우기와 시계 감기가 한 곳에 없다')
  // `setJustAdded({...})` 로 **직접** 띄우는 길이 남아 있으면 그 길은 시계를 안 감아,
  // 남은 시간이 0 인 채로 떠서 **곧바로 사라진다.**
  assert.doesNotMatch(code, /setJustAdded\(\{/,
    '시계를 안 감고 띠를 띄우는 길이 있다 — 그 띠는 뜨자마자 사라진다')
})
