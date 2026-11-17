// **머리줄이 관리자 사이드바보다 위에 있어야 한다** (현장 버그 2026-09-15).
//
// ── 무엇이 났나 ─────────────────────────────────────────────────────────────
// 이름표에 전체 메뉴를 단 뒤, `/admin` 에서 **메뉴가 뜨는데 눌러도 안 움직였다.**
// 메뉴가 사이드바에 덮여서, 그 자리의 클릭을 사이드바가 먹고 있었다.
//
// ── 왜 z 를 올려서 될 일이 아니었나 ─────────────────────────────────────────
// `position: sticky` + `z-index` 는 **쌓임 맥락(stacking context)을 만든다.**
// 머리줄이 `z-40` 이면 그 안의 메뉴는 `z-50` 을 줘도 **40 안에 갇힌다** — 바깥의
// 사이드바(`z-50`)와는 「40 대 50」으로 비교되므로 진다.
// 그래서 **머리줄 자체**를 올렸다.
//
// ── 왜 60 인가 ──────────────────────────────────────────────────────────────
// 위: 사이드바 50. 아래로 둬야 하는 것: 알림 토스트 70 · 경보 배너 200 · 모달 9000.
// 저 셋은 **머리줄을 덮어야** 한다 — 방송이 나가거나 경보가 뜨면 그게 먼저다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** `z-40` · `z-[60]` 어느 꼴이든 숫자를 꺼낸다. */
function z값(소스, 앵커) {
  const i = 소스.indexOf(앵커)
  assert.ok(i >= 0, `앵커를 못 찾았다: ${앵커}`)
  const 조각 = 소스.slice(i, i + 400)
  const m = /\bz-(?:\[(\d+)\]|(\d+))/.exec(조각)
  assert.ok(m, `z 값을 못 찾았다: ${앵커}`)
  return Number(m[1] || m[2])
}

const 껍데기   = 읽기('src/components/home/HomeShell.jsx')
const 사이드바 = 읽기('src/components/admin/Sidebar.jsx')
const 토스트   = 읽기('src/components/broadcast/BroadcastIndicators.jsx')
const 경보     = 읽기('src/components/shared/SystemAlertBanner.jsx')

const 머리줄z = z값(껍데기, '<header ref={headerRef}')

test('긍정 앵커 — 머리줄과 사이드바가 둘 다 z 를 갖는다', () => {
  assert.ok(Number.isFinite(머리줄z) && 머리줄z > 0, `머리줄 z 가 이상하다: ${머리줄z}`)
  assert.ok(z값(사이드바, '<aside className=') > 0, '사이드바 z 를 못 읽었다')
})

test('**머리줄 > 사이드바** — 아니면 /admin 에서 메뉴가 덮여 안 눌린다', () => {
  const 사이드바z = z값(사이드바, '<aside className=')
  assert.ok(머리줄z > 사이드바z,
    `머리줄 z-${머리줄z} ≤ 사이드바 z-${사이드바z} — 이름표 메뉴가 사이드바에 덮인다`)
})

test('**머리줄 < 알림·경보** — 방송과 경보는 머리줄을 덮어야 한다', () => {
  const 토스트z = z값(토스트, 'fixed top-4 left-1/2')
  const 경보z   = z값(경보, 'fixed top-0 inset-x-0')
  assert.ok(머리줄z < 토스트z, `머리줄 z-${머리줄z} ≥ 알림 z-${토스트z} — 방송 알림이 가려진다`)
  assert.ok(머리줄z < 경보z,   `머리줄 z-${머리줄z} ≥ 경보 z-${경보z} — 경보 배너가 가려진다`)
})

test('**메뉴는 머리줄 안에 있다** — 그래서 머리줄 z 가 곧 메뉴 z 다', () => {
  // 이 사실이 위 세 시험의 전제다. 메뉴를 포털로 뽑아내면 전제가 무너지므로 같이 본다.
  const i = 껍데기.indexOf('<header')
  const j = 껍데기.indexOf('</header>')
  assert.ok(i >= 0 && j > i, '머리줄을 못 찾았다')
  assert.match(껍데기.slice(i, j), /<HomeBrandMenu\s/, '메뉴가 머리줄 밖으로 나갔다')
  const 메뉴 = 읽기('src/components/home/HomeBrandMenu.jsx')
  assert.doesNotMatch(메뉴, /createPortal/,
    '메뉴가 포털로 나갔다 — 그러면 머리줄 z 가 메뉴를 대변하지 않는다')
})
