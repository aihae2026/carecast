'use strict'
// **설치본에 개발·검수·제출 작업 문서를 싣지 않는다** (2026-09-17 제출 전 점검 B-3).
//
// 설치 폴더에 `CLAUDE.md`·`TASKS.md`(사용자 원문 인용)·`.claude/`·제출 서류 초안·결정 일지가 그대로
// 깔리고 있었다. 이 시험은 `scripts/package-installer.cjs` 의 `뺄것` 목록을 읽어 두 방향을 본다 —
// ① 빼야 할 것이 들어 있다 ② **서버가 실행 중에 읽는 것은 빼지 않았다**(빼면 안내도·매뉴얼이 빈 화면이 된다).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 원문 = fs.readFileSync(path.join(ROOT, 'scripts', 'package-installer.cjs'), 'utf8')
const 덩어리 = 원문.match(/const 뺄것 = \[([\s\S]*?)\n\]/)
const 뺄것 = 덩어리
  ? [...덩어리[1].replace(/^\s*\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  : []

test('긍정 앵커 — 뺄것 목록을 읽었다', () => {
  assert.ok(뺄것.length >= 10, `뺄것이 ${뺄것.length}개다 — 목록 모양이 바뀌었나`)
})

test('**내부 작업 문서는 뺀다**', () => {
  for (const p of ['.claude', 'CLAUDE.md', 'AGENTS.md', 'TASKS.md', 'HANDOFF.md', 'docs/audit', 'docs/submission', 'docs/journal']) {
    assert.ok(뺄것.includes(p), `「${p}」 가 설치본에 실린다`)
  }
})

test('**서버가 읽는 문서는 빼지 않는다** — 안내도·매뉴얼', () => {
  for (const p of ['docs', 'docs/arch', 'docs/flows', 'docs/MANUAL-USER.md', 'docs/MANUAL-ADMIN.md', 'server', 'dist']) {
    assert.ok(!뺄것.includes(p), `「${p}」 를 빼면 서버가 읽을 파일이 없다`)
  }
})
