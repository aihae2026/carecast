// **사용 설명서가 화면과 어긋나지 않는다** (제출 07, 2026-09-15).
//
// ── 왜 이 시험이 필요한가 ────────────────────────────────────────────────────
// 설명서는 **한 번 쓰고 잊힌다.** 화면이 바뀌어도 아무도 고치러 오지 않고, 그러면
// 현장 선생님이 **없는 단추를 찾아 헤맨다.** 틀린 설명서는 없느니만 못하다.
//
// 이 저장소는 같은 실패를 이미 겪었다 — `CLAUDE.md` 가 *"자동 업데이트는 서버만 바꾸고
// 창은 옛 코드 그대로다"* 라고 **6주 동안 틀리게** 적고 있었다(ISSUE-011).
//
// ── 무엇을 보나 ─────────────────────────────────────────────────────────────
// 설명서가 **이름을 대서 말한 것**이 화면에 실제로 있는지만 본다.
// 설명의 내용이 맞는지는 이 시험이 판단할 수 없다 — 그건 사람이 읽어야 한다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 설명서 = 읽기('docs/MANUAL-USER.md')

test('긍정 앵커 — 설명서가 있다', () => {
  assert.ok(설명서.length > 2000, '설명서가 비었거나 너무 짧다')
})

test('**설명서가 말한 단추가 화면에 있다**', () => {
  const 빠른시작 = 읽기('src/lib/quickStart.js')
  // 빠른 단추 넷의 이름 — 설명서가 그림으로 그려 놓은 그것이다.
  for (const 이름 of ['지금 방송', '예약 방송', '배경음악', '순서']) {
    assert.ok(설명서.includes(이름), `설명서에 「${이름}」이 없다`)
    assert.ok(빠른시작.includes(`이름: '${이름}'`),
      `화면에 「${이름}」 단추가 없다 — 설명서가 없는 단추를 가리킨다`)
  }
})

test('**상단은 둘이다** — 설명서의 표와 화면이 같다', () => {
  const shell = 읽기('src/components/home/HomeShell.jsx')
  const 블록 = shell.slice(shell.indexOf('const TABS = ['), shell.indexOf('\n]', shell.indexOf('const TABS = [')))
  const 탭 = [...블록.matchAll(/label: '([^']+)'/g)].map(m => m[1])
  // 2026-09-15 오후 정정: 탭은 **다섯**이고 좁은 화면에서만 둘로 줄어든다
  // (*"저건 모바일에서만 적용하라고"*). 사용 설명서는 **휴대폰을 쓰는 선생님**을 주로
  // 보므로, 설명서가 이름을 대는 것은 **좁은 화면에 남는 둘**이다.
  assert.deepEqual(탭, ['간편', '캘린더', '자동순서', '업로드', '설정'],
    `머리줄 탭이 바뀌었다(${탭.join('·')}) — 설명서 §1 의 표를 같이 고칠 것`)
  for (const 이름 of ['간편', '캘린더']) {
    assert.ok(설명서.includes(`**${이름}**`), `설명서에 「${이름}」 설명이 없다`)
  }
})

test('**설명서가 그대로 옮겨 적은 문구**가 화면에 있다', () => {
  // 사람이 화면에서 보고 이 문서를 찾아오는 말들이다. 글자가 어긋나면 못 찾는다.
  //
  // ── **주석에서 찾으면 안 된다** (V③ UI-0915-R6 지적) ────────────────────────
  // 앞 판은 「누르고 말하기」를 `HomeMode.jsx` 에서 찾았는데 **거기 있는 것은 주석**이었고
  // 진짜 단추는 `InstantBroadcast.jsx` 에 있다. 검수관이 그 JSX 문구만 바꾸는 변이에서
  // 시험 여섯이 **전부 통과**하는 것을 보였다 — 가짜 오라클이다.
  // 그래서 **주석을 걷고** 찾는다.
  const 코드만 = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const 짝 = [
    ['http://localhost:3001',        'src/components/shared/SiteScreenWarning.jsx'],
    ['화면을 눌러 소리를 켜 주세요',   'src/components/broadcast/BroadcastIndicators.jsx'],
    ['휴대폰 마이크 쓰기 — 여기를 누르세요',  'src/components/easy/InstantBroadcast.jsx'],
    ['자세히 수정',                   'src/components/shared/QuickSchedulePhrase.jsx'],
    ['모니터링 창',                   'src/components/home/MonitorOpenButton.jsx'],
    // **단추가 실제로 사는 파일**을 가리킨다(`HomeMode` 는 그것을 얹기만 한다).
    ['누르고 말하기',                 'src/components/easy/InstantBroadcast.jsx'],
  ]
  for (const [문구, 파일] of 짝) {
    assert.ok(설명서.includes(문구), `설명서에 「${문구}」가 없다`)
    assert.ok(코드만(읽기(파일)).includes(문구),
      `${파일} 의 **코드**에 「${문구}」가 없다(주석은 안 센다) — `
      + '화면 글자가 바뀌었으면 설명서도 같이 고칠 것')
  }
})

test('**차임벨은 소리가 난다고 적혀 있다** — 설정으로 설명하면 안 된다', () => {
  // 2026-09-15 에 뒤집힌 부분이다. 설명서가 옛 동작을 적고 있으면 사람이 모르고 누른다.
  assert.match(설명서, /누르면 그 자리에서 소리가 납니다|누르면 바로 나갑니다/,
    '차임벨을 「설정」으로 설명하고 있다 — 지금은 누르면 소리가 난다(2026-09-15)')
  const 카드 = 읽기('src/components/shared/QuickSchedulePhrase.jsx')
  assert.ok(카드.includes('누르면 지금 바로 나갑니다'),
    '화면 쪽 문구가 바뀌었다 — 설명서도 같이 볼 것')
})

test('**못 하는 것을 적어 뒀다** — 기대만 키우지 않는다', () => {
  assert.match(설명서, /## 7\. 이 시스템이 \*\*못 하는 것\*\*/,
    '「못 하는 것」 절이 사라졌다 — 기대했다 안 되는 것이 더 불편하다')
  // 가장 비싼 한계는 반드시 남는다.
  assert.match(설명서, /소리가 실제로 났는지는 시스템이 100% 알지 못합니다/,
    '「기록은 성공인데 소리가 안 날 수 있다」를 뺐다 — 2026-09-14 에 실제로 겪은 일이다')
})
