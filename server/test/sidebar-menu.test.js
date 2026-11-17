'use strict'
// **사이드바 메뉴의 모양** (사용자 지시 2026-09-16).
//
// *"초기설정~개발일지 이렇게 있잖아, 어차피 초기설정에 있는 내용들이니 초기설정보다
//   한 칸 띄움으로 위계를 잡으면 어떨까?"*
// *"개발일지 삭제하고(대신에 DB는 보관하고 있어야지)"*
// *"데이터 출처 저기다 집어넣으니까 뭔가 이상하잖아. 그냥 따로 시스템 운영 메뉴 하나로"*
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
// 메뉴는 **고치기 쉽고 이유가 먼저 사라지는** 자리다. 여기 적는 것은 모양이 아니라
// 왜 그 모양이어야 하는가다 — 특히 **「지웠다」와 「없앴다」의 차이**:
// 개발 일지는 **입구만** 걷었고 화면과 글은 그대로 살아 있어야 한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const SIDEBAR = 읽기('src/components/admin/Sidebar.jsx')
const 코드만 = SIDEBAR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const ADMIN = 읽기('src/pages/AdminMode.jsx')

test('**초기 설정 아래 둘이 한 칸 들어간다** — 마법사가 묻는 바로 그것들이다', () => {
  const 목록 = /const menuItems = \[([\s\S]*?)\n\]/.exec(코드만)
  assert.ok(목록, 'menuItems 를 못 찾았다 — 이 시험의 전제가 무너졌다')
  const 표 = 목록[1]

  for (const id of ['systemSettings', 'apiSettings']) {
    const 줄 = 표.split('\n').find(l => l.includes(`id: '${id}'`))
    assert.ok(줄, `${id} 항목이 없다`)
    assert.match(줄, /하위: true/, `${id} 가 초기 설정 아래로 안 들어갔다`)
  }

  // **비상 방송 관리는 안 들인다** — 설정이 아니라 운영이고, 마법사의 단계도 아니다.
  // 들이면 「초기 설정에 딸린 것」으로 읽혀 급할 때 찾는 길이 흐려진다.
  const 비상 = 표.split('\n').find(l => l.includes("id: 'emergencyBroadcast'"))
  assert.ok(비상 && !/하위: true/.test(비상),
    '비상 방송 관리가 초기 설정 아래로 들어갔다 — 그것은 설정이 아니라 운영이다')

  // 들여쓰기가 **실제로 그려져야** 한다. 표시만 있고 안 그리면 아무 일도 안 난다.
  assert.match(코드만, /item\.하위 \? 'pl-7 pr-3' : 'px-3'/, '들여쓰기가 화면에 안 그려진다')
})

test('**개발 일지는 입구만 걷었다** — 화면과 글은 그대로 산다', () => {
  // 사용자 지시: *"개발일지 삭제하고(대신에 DB는 보관하고 있어야지)"*
  assert.ok(!/id: 'devLog'/.test(코드만), '사이드바에 개발 일지 입구가 남아 있다')
  // **화면은 살아 있어야 한다.** 저장해 둔 링크가 죽으면 그것은 「입구를 걷은 것」이
  // 아니라 「없앤 것」이다.
  assert.match(ADMIN, /devLog:\s*\{ Component: DevLog/,
    '개발 일지 화면까지 없앴다 — 지시는 입구만 걷는 것이었다(글은 보관)')
  assert.ok(fs.existsSync(path.join(ROOT, 'src/components/admin/sections/DevLog.jsx')),
    '개발 일지 화면 파일이 사라졌다')
})

test('**데이터 출처는 제 메뉴다** — 사이드바 푸터의 글이 아니다', () => {
  assert.match(코드만, /id: 'dataCredits'/, '데이터 출처 메뉴가 없다')
  // 푸터에 붙여 두던 부품은 걷혔다 — 메뉴가 아닌 것이 메뉴 자리에 앉아 있었다.
  assert.ok(!/<DataCredits\s*\/>/.test(코드만), '사이드바 푸터에 아직 붙어 있다')
  assert.match(ADMIN, /dataCredits:\s*\{ Component: DataCreditsPage/, '그릴 화면이 없다')
})

test('**메뉴가 가리키는 곳이 전부 그릴 수 있는 화면이다** — 누르면 빈 화면이 아니다', () => {
  const 목록 = /const menuItems = \[([\s\S]*?)\n\]/.exec(코드만)[1]
  const ids = [...목록.matchAll(/id: '([a-zA-Z]+)'/g)].map(m => m[1])
  assert.ok(ids.length >= 8, `메뉴가 ${ids.length}개뿐이다 — 훑기가 헛돌고 있다`)
  for (const id of ids) {
    assert.ok(new RegExp(`${id}:\\s*\\{ Component:`).test(ADMIN),
      `메뉴 「${id}」 가 가리키는 화면이 없다 — 누르면 대시보드로 떨어진다`)
  }
})

test('**이 PC 에 관한 것은 소리 화면에 없다** — 시스템 설정으로 옮겼다', () => {
  // 사용자 지시: *"모바일 마이크는 시스템 설정으로 가도되고, 이 pc의 역할은 시스템 설정으로"*
  const 소리 = 읽기('src/components/admin/sections/systemSettingsAudio.jsx')
  const 소리코드 = 소리.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/모바일 마이크/.test(소리코드), '모바일 마이크가 아직 소리 화면에 있다')
  assert.ok(!/handleSavePcRole/.test(소리코드), 'PC 역할을 **정하는** 자리가 아직 소리 화면에 있다')

  // 옮긴 자리에 실제로 있어야 한다 — 걷기만 하면 기능을 잃은 것이다.
  const 시스템 = 읽기('src/components/admin/sections/SystemSettings.jsx')
  assert.match(시스템, /<SystemSettingsPc \/>/, '시스템 설정에 안 달렸다 — 갈 곳이 없어졌다')
  const pc = 읽기('src/components/admin/sections/systemSettingsPc.jsx')
  assert.match(pc, /savePcRole/, '옮긴 화면이 역할을 저장하지 못한다')
  assert.match(pc, /generateSSLCert/, '옮긴 화면이 인증서를 만들지 못한다')
})
