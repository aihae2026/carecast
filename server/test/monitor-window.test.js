// 모니터링 창을 여는 규칙은 **한 곳**이다 (2026-09-14).
//
// ── 왜 이 시험이 있나 ────────────────────────────────────────────────────────
// 통합 홈(`/simple`)으로 오면서 **모니터링 진입점이 통째로 빠졌다** — 옛 쉬운 화면의
// 머리줄(`easy/TopBar.jsx`)에만 있었고 새 머리줄에 안 따라왔다. 사용자가 그것을 짚었다:
// *"원격에서 볼 수 있도록 모니터링 화면도 빠졌어"*.
//
// 되살리면서 **창 여는 줄을 복사하지 않았다.** 주소·창 이름·크기가 두 곳에 박히면
// 한쪽만 고쳐지는 날이 온다 — 이 저장소가 볼륨 기본값·음원 경로·식사 안내 문구에서
// 이미 세 번 겪은 실패다(CLAUDE.md 의 각 단일 출처 절).
//
// **창 이름이 특히 중요하다.** 같은 이름이어야 두 번 눌러도 창이 하나다.
// 이름이 갈리면 누르는 자리마다 새 창이 뜬다.
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

let M
test.before(async () => {
  M = await import('file:///' + path.join(ROOT, 'src', 'lib', 'monitorWindow.js').replace(/\\/g, '/'))
})

test('모니터 창은 /monitor 를 고정된 창 이름으로 연다', () => {
  const 부른것 = []
  const 결과 = M.모니터창열기({ open: (...a) => { 부른것.push(a); return { focus() {} } } })

  assert.equal(부른것.length, 1, '창을 한 번만 열어야 한다')
  const [주소, 이름, 옵션] = 부른것[0]
  assert.equal(주소, '/monitor', '모니터링 주소가 아니다')
  assert.equal(이름, M.모니터창이름, '창 이름이 상수와 다르다 — 누르는 자리마다 새 창이 뜬다')
  assert.match(이름, /\S/, '창 이름이 비어 있다 — 빈 이름은 매번 새 창이다')
  assert.match(옵션 || '', /width=\d+/, '가로 크기를 안 준다')
  assert.match(옵션 || '', /height=\d+/, '세로 크기를 안 준다')
  assert.ok(결과, '연 창 손잡이를 안 돌려준다')
})

test('창이 막히면 조용히 지나가지 않는다', () => {
  // 팝업 차단이면 `window.open` 이 null 을 준다. 아무 일도 안 일어난 것처럼 두면
  // 사람은 "눌렀는데 안 열린다"만 겪는다 — 부르는 쪽이 알 수 있어야 한다.
  const 결과 = M.모니터창열기({ open: () => null })
  assert.equal(결과, null, '막힌 것을 열린 것처럼 돌려준다')
})

// ── 2026-09-14: **한 겹 더 모았다** ──────────────────────────────────────────
// 그전에는 화면들이 `모니터창열기()` 를 **각자** 불렀다. 창 여는 규칙은 하나였지만 **단추
// 자체는 사본**이라, 팝업 차단 안내가 한쪽에만 붙고 문구도 갈릴 수 있었다.
// 지금은 단추까지 `MonitorOpenButton` 한 부품이고, 화면들은 그것을 꽂아 쓴다.
// 그래서 이 시험이 보는 것도 한 겹 올라간다 — **부품을 쓰는가**, 그리고 **창 여는 줄을
// 제 안에 다시 적지 않았는가**.
test('화면들이 **같은 부품**을 쓴다 — 단추도 창 여는 줄도 복사하지 않았다', () => {
  for (const 파일 of [
    ['src', 'components', 'easy', 'TopBar.jsx'],
    ['src', 'components', 'easy', 'SystemStatusCompact.jsx'],
    ['src', 'pages', 'HomeMode.jsx'],
  ]) {
    const 글 = 읽기(...파일)
    const 이름 = 파일[파일.length - 1]
    assert.match(글, /MonitorOpenButton/, `${이름} 이 공용 부품을 안 쓴다`)
    // 부정 단언 앞의 긍정 앵커는 위 줄이다 — 감시할 대상이 이 파일에 있다.
    assert.ok(!/window\.open\(\s*['"]\/monitor['"]/.test(글),
      `${이름} 이 창 여는 줄을 제 안에 다시 적었다 — 주소·크기·창 이름이 두 벌이 된다`)
  }
  // 그 부품은 여전히 **창 여는 단일 출처**를 쓴다
  const 부품 = 읽기('src', 'components', 'home', 'MonitorOpenButton.jsx')
  assert.match(부품, /모니터창열기\(\)/, '부품이 공용 함수를 안 쓴다')
  assert.ok(!/window\.open\(\s*['"]\/monitor['"]/.test(부품),
    '부품이 창 여는 줄을 제 안에 다시 적었다')
})
