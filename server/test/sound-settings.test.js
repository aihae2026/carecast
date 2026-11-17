// 소리 설정이 **한 자리에 모였는가** (UX-37 ~ UX-40, 2026-09-11).
//
// 사용자 지시: *"음량 관련된 모든건 거기서 해결할 수 있도록"*.
// 그전에는 셋에 흩어져 있었다 — 쉬운 화면 음량 패널 · 시스템설정 '오디오' · 시스템설정 'TTS'.
//
// **이 검사가 지키는 것은 "모였다"가 아니라 "옮겼지 베끼지 않았다"** 이다.
// 화면을 하나 더 만들면서 슬라이더·기본값·저장 로직을 복사하면, 그게 2026-08-28 에
// 겪은 사고다(같은 볼륨의 이름이 셋이었고 기본값이 제각각이었다).
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8')

const PAGE     = SRC('components', 'admin', 'sections', 'SoundSettings.jsx')
const SIDEBAR  = SRC('components', 'admin', 'Sidebar.jsx')
const ADMIN    = SRC('pages', 'AdminMode.jsx')

test('메뉴에 "음량 및 TTS" 가 있고 방송설정 그룹이다', () => {
  assert.match(SIDEBAR, /const menuItems = \[/, '긍정 앵커 — 이 파일이 메뉴 목록을 든다')
  const line = SIDEBAR.split('\n').find(l => l.includes("id: 'soundSettings'"))
  assert.ok(line, "사이드바에 soundSettings 메뉴가 없다")
  assert.match(line, /음량 및 TTS/, '메뉴 이름이 다르다')
  // ── 모니터링 → **방송설정**으로 옮겼다 (사용자 지시 2026-09-13) ─────────────────
  // *"방송설정에 음량 및 TTS"* — 모니터링은 **보는 것**이고 이것은 **정하는 것**이다.
  // 소리를 얼마나 크게 낼지는 설정이지 관찰이 아니라서 그룹이 틀려 있었다.
  //
  // 이 줄은 그 지시 뒤에 안 따라 고쳐져 *"사용자 지시는 «모니터링에» 넣는 것이었다"* 라는
  // **옛 지시를 근거로 새 지시를 되돌리라고** 말하고 있었다. 지시가 바뀌면 그 근거를 든
  // 가드도 같은 커밋에서 바꾼다 — 안 그러면 빨간불이 사람에게 거짓말을 한다.
  assert.match(line, /group: 'broadcast'/, '사용자 지시(2026-09-13)는 "방송설정에" 넣는 것이다')
})

test('그 메뉴가 실제 화면으로 이어진다', () => {
  assert.match(ADMIN, /soundSettings:\s*\{ Component: SoundSettings/,
    'sectionMap 에 soundSettings 가 없다 — 메뉴를 눌러도 대시보드로 떨어진다')
  assert.match(ADMIN, /from '\.\.\/components\/admin\/sections\/SoundSettings'/)
})

test('옛 링크가 새 자리로 간다 — 쉬운 화면의 바로가기가 죽지 않게', () => {
  assert.match(ADMIN, /ttsSettings:\s*\{ section: 'soundSettings'/,
    "?section=ttsSettings 가 아직 옛 아코디언을 가리킨다")
})

test('세 조각을 **불러 쓴다** — 옮겨 적지 않는다(UX-39)', () => {
  for (const [name, from] of [
    ['VolumePanel',         "'../../easy/VolumePanel'"],
    ['TTSSettings',         "'./TTSSettings'"],
    ['SystemSettingsAudio', "'./systemSettingsAudio'"],
  ]) {
    assert.ok(PAGE.includes(`from ${from}`), `${name} 을 ${from} 에서 안 가져온다`)
    assert.notEqual(PAGE.indexOf(`<${name} `), -1, `${name} 을 렌더하지 않는다`)
  }
})

test('이 화면이 값을 읽고 쓰는 코드를 스스로 들고 있지 않다 — 복사 금지', () => {
  // 조각들이 각자 서버와 이야기한다. 이 페이지는 **배치만** 한다.
  for (const 금지 of ['getVolume', 'saveVolume', 'useState', 'useEffect', 'apiPost', 'apiGet']) {
    assert.ok(!PAGE.includes(금지),
      `SoundSettings 가 '${금지}' 를 직접 쓴다 — 조각과 같은 일을 두 벌로 하게 된다`)
  }
})

test('쉬운 화면의 음량 패널이 그대로 살아 있다 — 옮긴 것이지 뺏은 것이 아니다', () => {
  const easy = SRC('pages', 'SimpleMode.jsx') + SRC('pages', 'EasyMode.jsx')
  assert.ok(/VolumePanel/.test(easy),
    '쉬운 화면에서 음량 패널이 사라졌다 — 현장 선생님이 쓰던 자리를 없애면 안 된다')
})

test('안내 음성 볼륨이 두 곳에 보인다는 사실을 화면이 말한다(UX-39)', () => {
  // 같은 값이 '종류별 음량'의 TTS 슬라이더와 'TTS 설정'의 볼륨 슬라이더 둘로 보인다.
  // 값은 하나지만(서버 domain/volume.js), **사람은 둘을 다른 것으로 읽는다.**
  assert.match(PAGE, /같은 값/,
    '두 슬라이더가 같은 값이라는 설명이 없다 — 사람이 어느 쪽이 진짜인지 묻게 된다')
})
