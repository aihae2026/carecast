// 관리자 사이드바의 "고도화 제안 (개발용)" 줄은 개발 빌드에서만 보여야 한다.
// 현장 PC는 dist(프로덕션 빌드)를 띄우고, 그 화면은 요양원 직원이 본다 — 코칭 브리프·기술부채가
// 거기 뜨면 안 된다. 그래서 import.meta.env.DEV 가드 안에 있는지 소스로 확인하고,
// 빌드 산출물이 있으면 그 문구가 실제로 빠졌는지까지 본다(가드가 형식만 갖추는 것을 막는다).
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const SIDEBAR = path.join(ROOT, 'src/components/admin/Sidebar.jsx')
const LABEL = '고도화 제안 (개발용)'

test('사이드바의 개발 콘솔 링크는 import.meta.env.DEV 가드 안에 있다', () => {
  const src = fs.readFileSync(SIDEBAR, 'utf8')
  assert.ok(src.includes(LABEL), `사이드바에 "${LABEL}" 줄이 있어야 한다`)
  assert.ok(src.includes('href="/dev-console"'), '그 줄이 /dev-console로 가야 한다')

  const guard = src.indexOf('{import.meta.env.DEV && (')
  assert.ok(guard >= 0, 'import.meta.env.DEV 가드가 있어야 한다')

  // 가드가 열린 뒤에 라벨이 나와야 한다 — 가드 밖에 또 두면 프로덕션으로 샌다.
  assert.ok(src.indexOf(LABEL) > guard, '라벨이 DEV 가드보다 뒤에 있어야 한다')
  assert.equal(src.split(LABEL).length - 1, 1, '라벨이 두 곳에 있으면 한쪽은 가드 밖이다')
})

// 개발 콘솔은 App.jsx가 주소를 보고 통째로 갈아 끼우는 별도 껍데기다. 화면 안에서 주소만
// 바꾸면(navigate) 본 앱의 Routes에 그 주소가 없어서 **빈 화면**이 된다. 실제로 그렇게
// 만들었다가 사용자가 눌러 보고 알았다. /monitor 팝업이 window.open을 쓰는 것과 같은 이유다.
test('개발 콘솔로 갈 때는 화면 안 이동(navigate)이 아니라 주소 이동이다', () => {
  const src = fs.readFileSync(SIDEBAR, 'utf8')
  assert.ok(src.includes('href="/dev-console"'), 'a href로 통째 이동해야 한다')
  assert.equal(src.includes("navigate('/dev-console')"), false,
    'navigate()로 가면 본 앱 Routes에 /dev-console이 없어 빈 화면이 된다')
})

test('App.jsx는 /dev-console 하위 주소도 개발 콘솔로 본다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8')
  // 정의 한 줄이 아니라 두 줄로 나뉘어 있으므로, 정의부터 다음 주석까지를 잘라서 본다.
  const at = src.indexOf('const _IS_DEV_CONSOLE =')
  assert.ok(at >= 0, '_IS_DEV_CONSOLE 정의를 찾지 못했다')
  const def = src.slice(at, at + 300)
  assert.ok(def.includes("startsWith('/dev-console/')"),
    '하위 주소를 안 보면 구성도 상세(/dev-console/arch/...)가 본 앱으로 떨어져 빈 화면이 된다')
  assert.ok(src.includes('path="/dev-console/arch/:view"'), '구성도 상세 라우트가 있어야 한다')
})

// 개발 콘솔 창은 소리를 담당하면 안 된다(재생 코드를 아예 안 태운다). 하위 주소도 같은 화면이다.
test('개발 콘솔 하위 주소도 소리 담당 후보에서 빠진다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/tabId.js'), 'utf8')
  assert.ok(src.includes("!p.startsWith('/dev-console')"),
    '하위 주소가 담당으로 뽑히면 아무도 소리를 안 낸다')
})

test('프로덕션 빌드 산출물에는 그 문구가 없다', (t) => {
  const assetsDir = path.join(ROOT, 'dist/assets')
  if (!fs.existsSync(assetsDir)) {
    // npm run verify는 build 뒤에 테스트를 돌리므로 정상 경로에서는 항상 존재한다.
    t.skip('dist/assets가 없다 — npm run build 후에 다시 확인할 것')
    return
  }
  const hits = fs.readdirSync(assetsDir)
    .filter(f => f.endsWith('.js'))
    .filter(f => fs.readFileSync(path.join(assetsDir, f), 'utf8').includes(LABEL))
  assert.deepEqual(hits, [], `프로덕션 번들에 "${LABEL}"가 남아 있다: ${hits.join(', ')}`)
})
