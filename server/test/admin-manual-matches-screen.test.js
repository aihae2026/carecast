// **관리 설명서가 화면·코드와 어긋나지 않는다** (제출 07, 2026-09-15).
//
// ── 왜 따로 두나 ────────────────────────────────────────────────────────────
// `manual-matches-screen.test.js` 는 **사용 설명서**(방송을 내보내는 선생님용)를 본다.
// 이 시험은 **관리 설명서**(시스템을 맡은 담당자용)를 본다. 둘은 가리키는 화면이
// 다르다 — 한쪽은 간편 화면, 한쪽은 `/admin` 과 서랍의 「관리」 줄이다.
//
// ── 이 설명서가 특히 잘 썩는 이유 ───────────────────────────────────────────
// 관리 설명서는 **숫자와 경로를 그대로 옮겨 적는다**(유예 5분·60분, 백업 04:30·30일,
// 자동 업데이트 10분, `/api/health` 의 칸 이름). 이런 값은 코드에서 조용히 바뀌고,
// 바뀐 줄 모르는 담당자는 **틀린 숫자로 고장을 진단한다.** 그래서 값을 코드에서
// 직접 읽어 대조한다 — 문서에 적힌 숫자가 근거가 되지 않도록.
//
// 초안을 쓸 때 실제로 **길을 틀리게 적었다** — 자동 순서·업로드·설정을 머리줄 탭으로
// 적었는데 그 셋은 2026-09-15 에 **서랍의 「관리」 줄**로 내려갔다. 없는 탭을 찾게
// 만드는 설명서다. 그 오류를 잡은 것이 아래 '길' 시험이다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
// 주석에 있는 말은 화면에 없는 말이다. 앞 판이 이것으로 한 번 속았다(V③ UI-0915-R6).
const 코드만 = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const 설명서 = 읽기('docs/MANUAL-ADMIN.md')

test('긍정 앵커 — 관리 설명서가 있다', () => {
  // 부정 단언(§아래)이 **대상 없는 파일에서도 통과**하는 것을 막는 앵커다.
  assert.ok(설명서.length > 3000, '관리 설명서가 비었거나 너무 짧다')
})

test('**설명서가 가리킨 길이 실제로 있다** — 서랍의 「관리」 줄', () => {
  const 링크 = 코드만(읽기('src/components/home/HomeAdminLinks.jsx'))
  // 이름과 도착지를 함께 본다. 이름만 보면 링크가 엉뚱한 곳을 가리켜도 통과한다.
  const 짝 = [
    ['전체 예약 관리', '/calendar?view=list'],
    ['자동 순서',      '/flow'],
    ['업로드',         '/upload'],
    ['설정',           '/admin?section=systemSettings'],
  ]
  for (const [이름, 도착지] of 짝) {
    assert.ok(링크.includes(`'${이름}'`),
      `서랍 「관리」 줄에 「${이름}」이 없다 — 설명서 §1 이 없는 단추를 가리킨다`)
    assert.ok(링크.includes(`'${도착지}'`),
      `「${이름}」의 도착지가 ${도착지} 가 아니다 — 설명서를 같이 고칠 것`)
    // 설명서가 그 이름을 **어디선가** 대고 있으면 된다. 굵게 쓰라고 강요하지 않는다 —
    // 2026-09-15 오후에 탭이 다섯으로 돌아오면서 서랍 목록을 한 줄로 합쳤고, 그때
    // 이 시험이 **굵은 글씨만 찾다가** 빨간불이 났다. 시험이 문장 모양까지 묶으면
    // 글을 고칠 때마다 걸린다 — 봐야 하는 것은 **그 이름이 설명서에 있느냐**다.
    assert.ok(설명서.includes(이름), `설명서에 「${이름}」 이 안 나온다`)
  }
})

test('**화면 폭에 따라 탭이 갈린다** — 설명서가 둘 다 적는다', () => {
  // 2026-09-15 오전에 다섯을 둘로 줄였다가, 오후에 사용자가 정정했다 —
  // ***"저건 모바일에서만 적용하라고."*** 그래서 지금은 **넓은 화면 다섯 · 좁은 화면 둘**이다.
  //
  // 관리 설명서는 **담당자가 PC 앞에서** 보는 문서라, 넓은 화면 기준을 먼저 적어야 한다.
  // 그런데 폰으로 볼 때는 셋이 안 보이므로 **그 사실도 적어야** 없는 탭을 찾지 않는다.
  const shell = 읽기('src/components/home/HomeShell.jsx')
  const 시작 = shell.indexOf('const TABS = [')
  const 블록 = shell.slice(시작, shell.indexOf('\n]', 시작))
  const 탭 = [...블록.matchAll(/label: '([^']+)'/g)].map(m => m[1])
  assert.deepEqual(탭, ['간편', '캘린더', '자동순서', '업로드', '설정'],
    `머리줄 탭이 바뀌었다(${탭.join('·')}) — 관리 설명서 §1 을 같이 고칠 것`)
  // 좁은 화면에서 감추는 규칙이 살아 있어야 그 설명이 참이 된다.
  assert.match(shell, /hidden tablet:inline-flex/,
    '좁은 화면에서 감추는 규칙이 없다 — 설명서의 「휴대폰에서는 둘」이 거짓이 된다')
  assert.match(설명서, /휴대폰에서는/,
    '설명서가 휴대폰에서 탭이 줄어든다는 사실을 안 적고 있다')
})

test('**사이드바 메뉴 이름이 설명서의 표와 같다**', () => {
  const sidebar = 읽기('src/components/admin/Sidebar.jsx')
  const 이름들 = [...sidebar.matchAll(/label: '([^']+)'/g)].map(m => m[1])
  // 설명서 §1 이 표로 적어 둔 것들. 화면에서 이 글자를 보고 문서를 찾아온다.
  for (const 이름 of ['대시보드', '방송 로그', '음량 및 TTS', '즐겨찾기 버튼',
                      '초기 설정', '시스템 설정', 'AI · API 연동', '비상 방송 관리']) {
    assert.ok(이름들.includes(이름),
      `사이드바에 「${이름}」이 없다 — 설명서 §1 의 표를 같이 고칠 것`)
    assert.ok(설명서.includes(이름), `설명서에 「${이름}」이 없다`)
  }
})

test('**「사용자 권한 관리」를 준비 중이라고 적지 않는다**', () => {
  // 화면은 "일부러 안 만들었습니다"라고 말한다. 설명서가 "준비 중"이라고 적으면
  // 기다리면 생기는 것으로 읽힌다 — 생기지 않는다.
  const admin = 코드만(읽기('src/pages/AdminMode.jsx'))
  assert.ok(admin.includes('일부러 안 만들었습니다'),
    '화면의 문구가 바뀌었다 — 설명서 §1 의 안내를 같이 고칠 것')
  assert.match(설명서, /일부러 안 만들었습니다/,
    '설명서가 「사용자 권한 관리」를 일부러 안 만든 것으로 적고 있지 않다')
})

test('**설명서의 유예 숫자가 코드의 기본값과 같다**', () => {
  const wd = 읽기('server/services/watchdog.js')
  const 뽑기 = (이름) => {
    const m = wd.match(new RegExp(`const ${이름}\\s*=\\s*(\\d+)`))
    assert.ok(m, `watchdog.js 에서 ${이름} 을 못 찾았다`)
    return Number(m[1])
  }
  const 안나감 = 뽑기('DEFAULT_GRACE_MIN')
  const 안끝남 = 뽑기('DEFAULT_RUN_GRACE_MIN')
  assert.ok(설명서.includes(`| ${안나감}분 |`),
    `설명서 §8 의 「안 나감」 유예가 코드(${안나감}분)와 다르다`)
  assert.ok(설명서.includes(`| ${안끝남}분 |`),
    `설명서 §8 의 「안 끝남」 유예가 코드(${안끝남}분)와 다르다`)
})

test('**설명서의 백업 시각·보관 기간이 코드와 같다**', () => {
  const bk = 읽기('server/services/backup.js')
  const 시각 = bk.match(/const DEFAULT_TIME\s*=\s*'([^']+)'/)?.[1]
  const 보관 = bk.match(/const DEFAULT_KEEP_DAYS\s*=\s*(\d+)/)?.[1]
  assert.ok(시각 && 보관, 'backup.js 의 기본값을 못 찾았다')
  assert.ok(설명서.includes(시각),
    `설명서 §11 의 백업 시각이 코드(${시각})와 다르다`)
  assert.ok(설명서.includes(`${보관}일치`),
    `설명서 §11 의 보관 기간이 코드(${보관}일)와 다르다`)
})

test('**설명서가 말한 자동 업데이트 주기가 코드와 같다**', () => {
  const au = 읽기('server/services/autoUpdate.js')
  const m = au.match(/const CHECK_INTERVAL_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/)
  assert.ok(m, 'autoUpdate.js 의 주기를 못 찾았다')
  assert.ok(설명서.includes(`${m[1]}분마다`),
    `설명서 §10 의 확인 주기가 코드(${m[1]}분)와 다르다`)
})

test('**설명서가 이름을 댄 진단 칸이 /api/health 에 있다**', () => {
  // 무음 진단의 1·2번이 이 두 칸에 걸려 있다. 이름이 바뀌면 담당자가 없는 값을 찾는다.
  const health = 코드만(읽기('server/routes/health.js'))
  for (const 칸 of ['localClients', 'localClientsAlive']) {
    assert.ok(health.includes(칸),
      `/api/health 에 ${칸} 이 없다 — 설명서 §9 의 진단 절차를 같이 고칠 것`)
    assert.ok(설명서.includes(칸), `설명서에 ${칸} 이 없다`)
  }
})

test('**AI 로 나가는 것을 숨기지 않는다**', () => {
  // 가장 지우고 싶어지는 절이라 고정한다(§7). 무료 티어는 입력이 모델 개선에 쓰이고
  // 사람이 읽을 수 있다 — 관리자가 그것을 모르고 어르신 성함을 적으면 안 된다.
  assert.match(설명서, /모델 개선에 쓰이고 사람이 읽을 수 있습니다/,
    '설명서 §7 이 Gemini 무료 티어의 조건을 적고 있지 않다')
  // 예전 문구 「보내기 전에 민감정보 검사를 하지 않습니다」는 geminiClient 가 가리기(promptPrivacy)를
  // 붙인 뒤로 사실이 아니게 됐다(공개판 점검 2026-10-18). 지금 사실 — 가리되 **빈틈이 있다** — 를 고정한다.
  const 코드 = 읽기('server/services/geminiClient.js')
  assert.ok(코드.includes('가리기('), 'Gemini 로 보내기 전 가리기가 없어졌다 — 설명서 §7 을 같이 고칠 것')
  assert.match(설명서, /보내기 전에 이름은 「사람1」처럼 바꾸고/,
    '설명서 §7 이 보내기 전 가리기를 적고 있지 않다')
  assert.match(설명서, /호칭 없이 이름만 적으면 그대로 나갈 수 있습니다/,
    '설명서 §7 이 가리기의 빈틈(호칭 없는 이름)을 적고 있지 않다 — 숨기지 않는 것이 이 시험의 뜻이다')
})

// ── **오늘 현장에서 배운 것이 설명서에 남아 있다** (2026-09-15) ──────────────────
// 사고로 알게 된 것은 **그날만 기억된다.** 문서에 안 적으면 다음 담당자는 같은 자리에서
// 같은 시간을 쓴다. 이 셋은 그날 실제로 사람을 헤매게 한 것들이라 고정한다.
test('**설명서가 「소리 잠김」 진단을 적고 있다**', () => {
  const health = 읽기('server/routes/health.js')
  assert.match(health, /localSoundReady/,
    '/api/health 에 localSoundReady 가 없다 — 설명서 §9 의 진단이 거짓이 된다')
  assert.ok(설명서.includes('localSoundReady'),
    '설명서가 소리 잠김을 가르는 칸을 안 알려 준다')
  assert.match(설명서, /여는 것으로는 안 낫습니다/,
    '「창을 여는 것으로는 안 낫는다」를 안 적고 있다 — 그러면 localhost 를 또 열어 보게 된다')
})

test('**랜 주소로 열면 소리가 안 난다는 것을 적고 있다**', () => {
  // 2026-09-15 에 사람이 가장 오래 헤맨 자리다. 현장 PC 에서 열었는데도 소리가 안 났다.
  assert.match(설명서, /주소가 `localhost` 여야 합니다/,
    '설명서가 주소 문제를 안 적고 있다')
  assert.match(설명서, /홈 화면에 추가/,
    '바탕화면 아이콘이 랜 주소로 만들어질 수 있다는 사실을 안 적고 있다')
})

test('**시계가 뛰면 방송이 사라진다는 것을 적고 있다**', () => {
  // 발동 규칙이 「정확히 일치」인 한 이 위험은 없어지지 않는다. 규칙을 바꾸면
  // 이 항목도 같이 바뀌어야 하므로 **규칙 쪽도 함께** 본다.
  const sch = 읽기('server/services/scheduler.js')
  assert.match(sch, /AND scheduled_time = \?/,
    '예약 발동이 더는 정확히 일치가 아니다 — 설명서 §9-1 을 다시 쓸 것')
  assert.match(설명서, /시계가 건너뛰면 그 사이 방송이 사라집니다/,
    '설명서가 시계 점프 위험을 안 적고 있다')
  assert.match(sch, /function 건너뛴분들\(/,
    '건너뜀 감지가 없다 — 설명서의 「배너로 알립니다」가 거짓이 된다')
})
