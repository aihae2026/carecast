// **기본 주소(`/`)로 들어오면 간편 화면이 뜬다** (사용자 지시 2026-09-14).
//
// ── 무엇이 문제였나 ──────────────────────────────────────────────────────────
// 새 간편 화면은 `/simple` 이고 `/` 는 옛 쉬운 화면(`EasyMode`)이었다. 그런데 09-13 에
// *"쉬운화면도 없애 이제, 자꾸 전으로 돌아가잖아"* 지시로 **쉬운 화면으로 가는 입구만**
// 지우고 `/` 주소는 그대로 뒀다. 그래서 원격 PC 에서 `:3001` 을 처음 열면 **입구가 없어진
// 옛 화면**이 뜨고, 탭을 눌러 `/simple` 로 가야 새 화면이 보였다. 사용자에게는 "상세설정
// 갔다가 돌아와야 적용되는 버그"로 보였다. 절반은 맞다 — 머리줄·AI 단추 같은 공용 부품은
// 옛 화면에도 들어가 있어서 **반만 바뀐 것처럼** 보인다.
//
// ── 왜 기능을 안 옮겼나 ──────────────────────────────────────────────────────
// 옮길 것이 없었다. 두 화면을 실제로 띄워 훑은 결과 **접근 불가한 기능이 없다**:
//   · 자동 5종 수동재생 → `HomeToday` 의 「지금 내보내기」(확인 한 단계)
//   · 예약(환기 묶음) 수동재생 → `/calendar` 목록 → 항목 → 「지금 방송」
//   · 즉시 TTS → 「지금 말하기」(`lib/quickStart` 의 `tts`, 유형 `text`)
//   · 차임 → 「차임벨」 · 미리듣기 → `/flow` 「전체 미리듣기」
//   · 통계·전체 기록 → `/admin` 「방송 로그」·「대시보드」
//   · BGM·음량 7채널 → 같은 부품을 그대로 쓴다
// **다른 메뉴로 닿으면 중복 구현하지 않는다**(사용자 지시).
//
// ── 이 시험이 소스를 읽는 이유 ───────────────────────────────────────────────
// 라우팅은 React 렌더러 없이는 못 돌린다. 이 저장소는 시험 프레임워크를 안 깐다(T-27).
// 그래서 **소스 대조**이고, 그 한계를 알고 쓴다 — 실제 진입은 사람이 브라우저로 확인한다.
// 대신 「없을 것」만 보지 않는다. 긍정 앵커를 먼저 세운다(가드 규칙 ②).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const APP  = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8')

/** 주석을 걷어낸 코드만 본다 — 머리말이 제 가드를 건드리는 사고를 여러 번 겪었다. */
const 코드만 = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('긍정 앵커 — 라우팅 표가 있고 간편 화면이 그 안에 있다', () => {
  assert.match(코드만, /<Routes>/, '라우팅 표를 못 찾았다 — 이 시험의 전제가 깨졌다')
  assert.match(코드만, /path="\/simple"\s+element=\{<HomeMode\s*\/>\}/,
    '`/simple` 이 간편 화면(HomeMode)을 안 그린다')
})

test('`/` 는 간편 화면으로 보낸다 — 옛 쉬운 화면이 현관이 아니다', () => {
  const m = /<Route\s+path="\/"\s+element=\{([^}]*)\}/.exec(코드만)
  assert.ok(m, '`/` 라우트를 못 찾았다')
  const 무엇 = m[1].trim()
  assert.doesNotMatch(무엇, /EasyMode/,
    `\`/\` 가 아직 옛 쉬운 화면을 그린다(${무엇}) — 원격 PC 가 처음 여는 화면이 옛 것이다`)
  assert.match(무엇, /<Navigate\s+to="\/simple"\s+replace\s*\/>|<HomeMode\s*\/>/,
    `\`/\` 가 간편 화면으로 안 간다 — 지금은 ${무엇}`)
})

test('옛 화면 코드는 지우지 않는다 — 주소만 옮긴다', () => {
  assert.match(코드만, /path="\/easy"\s+element=\{<EasyMode\s*\/>\}/,
    '옛 쉬운 화면이 라우팅 표에서 통째로 사라졌다 — 이번 범위는 **주소 변경**이지 삭제가 아니다')
  assert.match(APP, /import EasyMode/, 'EasyMode 를 더는 안 불러온다')
})

test('옛 화면으로 가는 **눈에 띄는 입구**를 만들지 않는다', () => {
  const 화면들 = ['src/components/home/HomeShell.jsx', 'src/components/admin/Sidebar.jsx']
  for (const f of 화면들) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8')
    const 코드 = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(코드, /to:\s*'\/easy'|navigate\('\/easy'\)|href="\/easy"/,
      `${f} 에 옛 화면 입구가 생겼다 — 두 디자인을 오가면 어느 쪽이 지금 것인지 사람이 못 정한다`)
  }
  // 긍정 앵커 — 이 파일들이 실제로 길을 갖고 있다(빈 파일을 보고 통과하지 않는다)
  const shell = fs.readFileSync(path.join(ROOT, 'src/components/home/HomeShell.jsx'), 'utf8')
  assert.match(shell, /to:\s*'\/simple'/, '긍정 앵커 — 탭 줄이 간편 화면으로 가는 길을 갖고 있다')
})

