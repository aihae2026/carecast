'use strict'
// UX-09 — **AI 는 안내·추천까지만 한다.** 인증·권한·기기 제어와 실제 설정 적용은
// 검증된 연동 코드가 한다 (2026-09-12).
//
// 키가 프롬프트로 새지 않는 쪽은 `gemini-boundary.test.js` 가 30건으로 덮는다.
// 이 파일이 보는 것은 **반대 방향**이다: AI 가 만든 것이 운영 데이터나 기기에
// **곧바로 닿는 길이 있는가.**
//
// 지금은 없다 — AI 경로는 자기 초안 표(`schedule_drafts`·체크리스트)만 쓰고, 실제 예약은
// 사람이 승인할 때 `insertSchedule()` 이 넣는다(CLAUDE.md 검토 게이트).
// **그 사실이 유지되는지를 고정한다.** 나중에 누가 "편하니까" AI 라우트에서 설정을 바로
// 저장하면, 그 순간 초안→승인 게이트가 우회된다. 오류도 안 나고 화면도 그대로라
// 사람이 알아챌 방법이 없다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROUTES = path.join(__dirname, '..', 'routes')
const SERVICES = path.join(__dirname, '..', 'services')

// AI 가 만든 것을 다루는 경로들. **목록을 줄이면 감시가 조용히 헐거워지므로**,
// 파일이 없어지면 그 사실로 실패한다(CLAUDE.md 「파일을 가를 때」 규칙 2).
const AI경로 = [
  ['routes', 'ai.js'],
  ['routes', 'scheduleDrafts.js'],
  ['routes', 'coachingBrief.js'],
  ['services', 'geminiClient.js'],
  ['services', 'llmGateway.js'],
]

// AI 가 직접 써서는 안 되는 표. 운영이 곧바로 달라지는 것들이다.
const 금지표 = ['settings', 'schedules', 'audio_files', 'audio_subtitles', 'flow_sequences']

const 읽기 = ([종류, 이름]) => {
  const p = path.join(종류 === 'routes' ? ROUTES : SERVICES, 이름)
  assert.ok(fs.existsSync(p), `${이름} 이 없다 — 이 가드가 볼 대상을 잃었다. 옮겼으면 목록을 고칠 것`)
  return fs.readFileSync(p, 'utf8')
}
/** 주석을 지운다 — 주석이 금지 형태를 설명하느라 그 형태를 그대로 적는다 */
const 주석제거 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('UX-09: AI 경로가 운영 표에 직접 쓰지 않는다 — 초안→승인 게이트를 우회하지 않는다', () => {
  for (const 항목 of AI경로) {
    const src = 주석제거(읽기(항목))
    for (const 표 of 금지표) {
      const 쓰기 = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${표}\\b`, 'i')
      assert.ok(!쓰기.test(src),
        `${항목[1]} 이 ${표} 에 직접 쓴다 — AI 결과가 사람 승인 없이 운영에 들어간다`)
    }
  }
})

test('UX-09: AI 경로가 기기·방송을 직접 건드리지 않는다', () => {
  // 이름으로 본다. 이 저장소에서 실제 효과를 내는 경계들이다.
  const 금지모듈 = ['switchbot', 'audioQueue', 'chimePlayer', 'audioPlayer',
    'volumeControl', 'audioDevices', 'autoShutdown', 'autoUpdate']
  for (const 항목 of AI경로) {
    const src = 주석제거(읽기(항목))
    for (const mod of 금지모듈) {
      assert.ok(!new RegExp(`require\\([^)]*${mod}`, 'i').test(src),
        `${항목[1]} 이 ${mod} 을 부른다 — AI 경로는 기기·소리를 직접 건드리지 않는다`)
    }
  }
})

test('UX-09: 초안은 초안 표에만 들어간다 — 승인은 다른 코드가 한다', () => {
  const 초안 = 주석제거(읽기(['routes', 'scheduleDrafts.js']))
  // 긍정 앵커 — 이 파일이 실제로 초안을 만든다
  assert.match(초안, /INSERT INTO schedule_drafts/,
    '초안을 만드는 자리가 없다 — 이 가드를 옮길 것')
  // 승인 경로는 `schedules.js` 의 함수를 부른다(표에 직접 쓰지 않는다).
  assert.match(초안, /insertSchedule/,
    '승인 시 검증된 삽입 함수를 안 쓴다 — 표에 직접 쓰면 검증이 통째로 빠진다')
})

test('UX-09: 이 가드가 진짜 위반을 잡는다 — 규칙이 너무 좁지 않다', () => {
  // 규칙을 먼저 시험한다. 통과만 하는 가드는 초록이 아무 뜻이 없다.
  const 가짜 = "db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(v, k)"
  assert.ok(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+settings\b/i.test(가짜),
    '운영 표 쓰기를 못 잡는다')
  assert.ok(/require\([^)]*switchbot/i.test("const x = require('../services/switchbot')"),
    '기기 모듈 부르기를 못 잡는다')
  // 그리고 멀쩡한 것은 안 잡는다
  assert.ok(!/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+settings\b/i.test(
    "db.prepare('SELECT value FROM settings WHERE key = ?')"),
  '읽기까지 잡는다 — AI 경로도 설정을 읽을 수는 있어야 한다')
})
