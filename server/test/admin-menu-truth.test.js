'use strict'
// UX-41 — 메뉴가 **거짓 약속을 하지 않는다** (2026-09-11).
//
// `userPermissions` 는 `Placeholder` 로 *"현재 준비 중입니다 · 다음 업데이트에서 사용할 수
// 있습니다"* 라고 말하고 있었다. **거짓이다.** 이 시스템은 **인증이 없는 것이 설계**다
// (PROJECT_PROFILE §1-1 — 방송을 내보내야 하는 순간에 로그인을 요구하면 그게 사고다).
// 기다리면 생기는 것이 아니라 일부러 안 만든 것이다.
//
// 거짓 약속은 사람을 기다리게 만들고, 기다리는 동안 그 사람은 다른 방법을 안 찾는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const ADMIN = fs.readFileSync(path.join(ROOT, 'src/pages/AdminMode.jsx'), 'utf8')
const PH = fs.readFileSync(path.join(ROOT, 'src/components/admin/sections/Placeholder.jsx'), 'utf8')

test('사용자 권한 관리가 "준비 중" 이라고 말하지 않는다', () => {
  const m = /userPermissions:\s*\{ Component:([\s\S]*?)\/>\s*\}/.exec(ADMIN)
  assert.ok(m, 'userPermissions 자리를 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /상태=/, '상태를 안 준다 — 기본 문구("준비 중")로 떨어진다')
  assert.match(m[1], /일부러 안 만들었습니다/, '무엇 때문에 없는지 안 말한다')
  assert.match(m[1], /로그인 없이/, '왜 그렇게 했는지 안 말한다 — 사람은 고장으로 읽는다')
})

test('**전제가 바뀌는 조건**도 함께 적는다 — "영영 안 한다" 와 "지금은 안 한다" 는 다르다', () => {
  const m = /userPermissions:\s*\{ Component:([\s\S]*?)\/>\s*\}/.exec(ADMIN)
  assert.match(m[1], /조건=/, '전제가 바뀌는 조건을 안 적는다')
  assert.match(m[1], /외부인|게스트|원격/, 'PROJECT_PROFILE §1-1 이 남겨 둔 조건과 다르다')
})

test('진짜 준비 중인 자리는 예전 문구 그대로다 — 있던 것을 잃지 않는다', () => {
  assert.match(PH, /상태 \?\? '현재 준비 중입니다'/, '기본 문구가 사라졌다')
  assert.match(PH, /Coming Soon/, '진짜 준비 중 표시가 사라졌다')
  // 일부러 안 만든 자리에는 "Coming Soon" 을 안 붙인다 — 그게 거짓 약속이다.
  assert.match(PH, /\{!일부러 && \(/, '일부러 안 만든 자리에도 Coming Soon 이 붙는다')
})

test('옛 링크는 그대로 이어진다 — 메뉴를 정리해도 주소가 죽지 않는다', () => {
  for (const 옛 of ['systemStatus', 'scheduledBroadcast', 'ttsSettings', 'audioSettings']) {
    // 표가 **세로로 정렬**돼 있어 `:` 뒤 공백이 여러 칸이다.
    // (이 줄을 heredoc 으로 쓰다가 역슬래시를 먹혀 `\s` 가 `s` 가 됐다 —
    //  CLAUDE.md "파일 수정은 Edit 도구로 한다" 가 적어 둔 함정이다.)
    assert.match(ADMIN, new RegExp(옛 + ':\\s+\\{\\s*section:'), `옛 링크 ${옛} 가 사라졌다`)
  }
})
