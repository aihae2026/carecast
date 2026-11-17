// 두 감시가 같은 규칙을 쓰는가 (P-26, 2026-09-10).
//
// **무엇이 문제였나**: `checkMissed`(자동방송 5종)와 `checkMissedSchedules`(예약)가
// **같은 일을 각자 적고** 있었다 — 하루 한 번 표식, 경보 발신, 화면용 개별 신호.
// 규칙이 갈리면 같은 상황에서 자동방송과 예약이 다르게 알린다(FP-0005).
//
// **경보 종류 어휘는 더 나쁜 모양이었다.** 서버(`watchdog.js`)가 문자열을 직접 짓고,
// 화면(`src/lib/alertStore.js`)이 가릴 목록(`HIDDEN_KINDS`)을 따로 들고 있다. 서로를 모르니
// **서버가 종류 이름을 바꾸는 날 화면이 가리던 것이 갑자기 배너로 쏟아진다** —
// 사람이 일부러 꺼 둔 잔소리가 되살아나는 것이고, 그러면 배너 자체를 안 보게 된다.
//
// 런타임으로 잇지는 않는다(서버는 CJS, 화면은 ESM이고 서로 import 하지 않는다).
// **대신 이 검사가 두 목록을 대조한다** — 사람이 한쪽만 고치는 날 여기서 빨간불이 뜬다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const LF = String.fromCharCode(10)
const 소스 = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')
const 주석뺀 = (t) => t.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)

const { 경보종류 } = require('../services/watchdog')

// ── 어휘 — 승인된 결정을 손으로 적는다 ──────────────────────────────────

test('경보 종류 셋 — 2026-09-01·09-07 사용자 결정을 손으로 적는다', () => {
  // 구현에서 가져오면 이름을 바꾸는 변이가 기대값까지 데려간다.
  assert.equal(경보종류.누락, '방송누락')
  assert.equal(경보종류.멈춤, '방송멈춤')
  assert.equal(경보종류.예약누락, '예약누락')
})

test('서버가 종류 문자열을 직접 짓지 않는다 — 어휘는 한 곳에서 나온다', () => {
  const s = 주석뺀(소스('services', 'watchdog.js'))
  assert.match(s, /경보종류\.(누락|멈춤|예약누락)/, '어휘 표를 안 쓴다 — 이 검사의 앵커가 무너졌다')
  for (const 낱말 of ["'방송누락'", "'방송멈춤'", "'예약누락'"]) {
    // 표 자체의 정의(`누락: '방송누락'`)는 남아야 하므로, **정의가 아닌 자리**의 리터럴만 센다.
    const 쓰인횟수 = s.split(낱말).length - 1
    assert.equal(쓰인횟수, 1,
      `${낱말} 이 ${쓰인횟수}번 나온다 — 표 정의 말고 다른 자리에서도 직접 적고 있다`)
  }
})

test('화면이 가리는 목록이 서버 어휘와 같은 낱말을 쓴다 — 한쪽만 고치면 배너가 쏟아진다', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'alertStore.js'), 'utf8')
  const m = /HIDDEN_KINDS\s*=\s*\[([^\]]*)\]/.exec(ui)
  assert.ok(m, '화면의 HIDDEN_KINDS 를 못 찾았다 — 이 검사의 앵커가 무너졌다')
  const 가리는것 = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)

  assert.ok(가리는것.length > 0, '가리는 목록이 비었다')
  const 서버어휘 = Object.values(경보종류)
  for (const k of 가리는것) {
    assert.ok(서버어휘.includes(k),
      `화면이 "${k}" 를 가리는데 서버는 그런 종류를 안 짓는다 — 이름이 갈렸다(서버: ${서버어휘.join(', ')})`)
  }
  // 사용자 결정: 가리는 것은 '방송누락' 하나다. '방송멈춤'은 진짜로 급해서 배너로 떠야 한다.
  assert.ok(가리는것.includes(경보종류.누락), '"방송누락" 이 가림 목록에서 빠졌다 — 잔소리가 되살아난다')
  assert.ok(!가리는것.includes(경보종류.멈춤),
    '"방송멈춤" 까지 가린다 — 방송이 중간에 멈춘 것을 아무도 못 본다')
  assert.ok(!가리는것.includes(경보종류.예약누락),
    '"예약누락" 을 가린다 — 1회성 예약은 오늘이 지나면 복구가 안 되는데 조용해진다')
})

// ── 배관 — 두 감시가 같은 것을 쓰는가 ───────────────────────────────────

test('두 감시가 하루 한 번 표식을 각자 구현하지 않는다', () => {
  const s = 주석뺀(소스('services', 'watchdog.js'))
  // 정의 한 줄은 빼고 **부르는 자리**만 센다.
  const 쓴횟수 = (s.match(/(?<!function )오늘처음알린다\(db,/g) || []).length
  assert.equal(쓴횟수, 2, `공용 배관을 ${쓴횟수}곳에서 부른다 — 자동방송·예약 둘 다여야 한다`)
  // 옛 모양(직접 읽고 직접 쓰기)이 남아 있으면 한쪽만 고치는 날 규칙이 갈린다.
  assert.doesNotMatch(s, /if \(getSetting\(db, alertedKey\) === today\) continue/,
    '표식 검사를 손으로 다시 적었다')
})

test('두 감시가 경보 발신을 각자 구현하지 않는다', () => {
  const s = 주석뺀(소스('services', 'watchdog.js'))
  const 쓴횟수 = (s.match(/(?<!function )누락을알린다\(db,/g) || []).length
  assert.equal(쓴횟수, 2, `공용 발신을 ${쓴횟수}곳에서 부른다 — 자동방송·예약 둘 다여야 한다`)
  const sse횟수 = s.split("broadcastSSE('broadcast_missed'").length - 1
  assert.equal(sse횟수, 1, `화면용 신호를 ${sse횟수}곳에서 짓는다 — 한 곳이어야 한다`)
})

test('문구는 서버가 짓고 신호에 실려 나간다 — 화면이 다시 지으면 배너에 두 줄로 뜬다', () => {
  const s = 주석뺀(소스('services', 'watchdog.js'))
  assert.match(s, /broadcastSSE\('broadcast_missed', \{ \.\.\.sse, kind, message \}\)/,
    '문구를 신호에 안 싣는다 — 경보 id 가 `날짜|종류|문구` 라 갈리면 같은 사건이 두 줄이 된다')
})
