// BGM 「재생 시간」은 단계 칸 하나가 정한다 — 숨은 분 설정을 걷는다 (사용자 지시 2026-09-24).
//
// ── 무엇이 함정이었나 ─────────────────────────────────────────────────────────
// 방송 편집 화면의 BGM 단계마다 「재생 시간(초)」 칸이 있고 재생은 그 칸이 먼저다(MusicPlayer.jsx 자동 정지).
// 그런데 칸을 **0 으로 두면 「끝까지」가 아니라 숨은 설정** `<방송>_bgm_duration`(분, 화면에 칸 없음)이 먹었다 —
// 점심·저녁 기본 15분, 기초값 파일은 30분. 화면엔 0 인데 음악이 중간에 꺼진다.
//
// 사용자 결정: *"0은 끝까지 트는걸로 하되 디폴트는 15분으로"* · 이미 저장된 것은 *"지금 멈추는 시간을 칸에 옮겨 적기"*.
//
// ── 이 파일이 고정하는 것 ─────────────────────────────────────────────────────
//   ① 재생은 단계 칸만 본다 — 0 이면 끝까지, 숨은 분 설정은 안 읽는다
//   ② 기본 단계의 첫 BGM 은 15분(900초), 저장된 칸이 0 이면 0 이 남는다(병합이 덮지 않는다)
//   ③ 한 번짜리 옮겨 적기: 새 규칙의 결과가 지금 실제 멈추는 시간과 다르면 그 값을 칸에 적는다 — 현장 소리는 그대로
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_bgmdur_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
initDB()
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')
const 옮겨적기 = DATA_FIXES.filter(f => f.key === 'datafix_bgm_duration_to_step_20260924')

test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

const db = () => getDB()
const put = (k, v) => db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
const get = (k) => db().prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value
const 지우기 = () => db().prepare("DELETE FROM settings WHERE key LIKE '%_steps' OR key LIKE '%_bgm_duration' OR key LIKE 'datafix_bgm_duration%'").run()
const 첫BGM = (tab) => {
  // 실행부가 쓰는 바로 그 읽기(getSteps — 저장된 단계를 기본 단계 위에 병합)
  return require('../services/broadcastSequencer').getSteps(db(), tab).find(s => s.id === 'bgm')
}

// ── ① 재생 경로 ──────────────────────────────────────────────────────────────
test('① 재생은 숨은 분 설정을 읽지 않는다 — 네 방송의 첫 BGM 도 단계 칸만 본다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  // 긍정 앵커 — 네 방송이 BGM 을 실제로 시작한다
  for (const lane of ['morning', 'exercise', 'lunch', 'dinner']) {
    assert.match(src, new RegExp(`stepBGMStart\\(db, '${lane}'`), `${lane} 의 BGM 시작을 못 찾았다 — 이 가드를 옮길 것`)
  }
  assert.doesNotMatch(src, /getSetting\(db, '(?:morning|exercise|lunch|dinner)_bgm_duration'/,
    '숨은 분 설정을 아직 읽는다 — 화면 0 인데 음악이 중간에 꺼진다')
})

// ── ② 기본값과 병합 ──────────────────────────────────────────────────────────
test('② 저장된 단계가 없으면 첫 BGM 은 기본 15분(900초)이다', () => {
  지우기()
  for (const lane of ['morning', 'exercise', 'lunch', 'dinner']) assert.equal(Number(첫BGM(lane).durationSec), 900, lane)
})

test('② 저장된 칸이 0 이면 0(끝까지)이 남는다 — 기본 15분이 덮지 않는다. 칸이 없으면 15분', () => {
  지우기()
  put('lunch_steps', JSON.stringify([{ id: 'bgm', enabled: true, order: 6, durationSec: 0 }]))
  put('dinner_steps', JSON.stringify([{ id: 'bgm', enabled: true, order: 4 }]))
  assert.equal(Number(첫BGM('lunch').durationSec), 0)
  assert.equal(Number(첫BGM('dinner').durationSec), 900)
})

// ── ③ 한 번짜리 옮겨 적기 ────────────────────────────────────────────────────
test('③ 현장처럼 칸이 0 이고 분 설정이 30 이면 1800초를 칸에 적는다 — 소리 그대로', () => {
  지우기()
  put('lunch_bgm_duration', '30')
  put('lunch_steps', JSON.stringify([{ id: 'bgm', enabled: true, order: 6, durationSec: 0 }, { id: 'lunch_tts', enabled: true, order: 0 }]))
  applyDataFixes(db(), 옮겨적기)
  const steps = JSON.parse(get('lunch_steps'))
  assert.equal(steps.find(s => s.id === 'bgm').durationSec, 1800)
  assert.ok(steps.find(s => s.id === 'lunch_tts'), '다른 단계를 잃었다')
  assert.equal(Number(첫BGM('lunch').durationSec), 1800)
})

test('③ 사람이 적어 둔 칸(>0)은 건드리지 않는다', () => {
  지우기()
  put('dinner_bgm_duration', '30')
  put('dinner_steps', JSON.stringify([{ id: 'bgm', enabled: true, order: 4, durationSec: 120 }]))
  applyDataFixes(db(), 옮겨적기)
  assert.equal(JSON.parse(get('dinner_steps')).find(s => s.id === 'bgm').durationSec, 120)
})

test('③ 저장된 단계가 없는 PC(새 PC)에는 쓰지 않는다 — 사용자가 정한 기본 15분으로 시작하고, 기초값이 들어올 자리를 막지 않는다', () => {
  // 처음 판은 여기서도 칸을 만들었다. 그러면 같은 부팅의 기초값 심기(applyBaseline — 「있는 키는 손대지 않는다」)가
  // `*_steps` 를 건너뛰어 점심·저녁 동요 순서가 통째로 빠졌다(2026-09-24 검수 High). 새 PC 는 옮길 「지금 소리」도 없다.
  지우기()
  put('morning_bgm_duration', '30')
  applyDataFixes(db(), 옮겨적기)
  for (const tab of ['morning', 'exercise', 'lunch', 'dinner']) {
    assert.equal(get(`${tab}_steps`), undefined, `${tab}: 저장된 단계가 없는데 만들었다`)
    assert.equal(Number(첫BGM(tab).durationSec), 900, `${tab}: 기본 15분`)
  }
})

test('③ 칸이 null·빈 글자여도 재생과 같은 식으로 본다 — 병합이 그 값을 덮어 재생은 끝까지가 된다', () => {
  for (const 칸 of [null, '']) {
    지우기()
    put('lunch_steps', JSON.stringify([{ id: 'bgm', enabled: true, order: 6, durationSec: 칸 }]))   // 분 설정 없음 → 옛 결과 15분
    applyDataFixes(db(), 옮겨적기)
    assert.equal(JSON.parse(get('lunch_steps')).find(s => s.id === 'bgm').durationSec, 900, `칸 ${JSON.stringify(칸)}: 15분에 멈추던 것을 지킨다`)
  }
})

test('③ 빈 DB 의 실제 부팅 순서(보정 전부 → 기초값)에서 기초값의 방송 순서가 그대로 들어온다', () => {
  const { applyBaseline, BASELINE_PATH } = require('../config/siteBaseline')
  if (!fs.existsSync(BASELINE_PATH)) return   // 설치판처럼 기초값 파일이 없으면 볼 것이 없다
  const 기초 = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  const 기초점심 = 기초.settings && 기초.settings.lunch_steps
  if (!기초점심) return
  db().prepare('DELETE FROM settings').run()
  applyDataFixes(db())
  applyBaseline(db())
  assert.equal(get('lunch_steps'), 기초점심, '보정이 먼저 lunch_steps 를 만들어 기초값이 못 들어왔다')
})

test('③ 한 번만 돈다 — 두 번째 부팅에는 사람이 고친 0 을 다시 덮지 않는다', () => {
  지우기()
  put('lunch_bgm_duration', '30')
  put('lunch_steps', JSON.stringify([{ id: 'bgm', enabled: true, order: 6, durationSec: 0 }]))
  applyDataFixes(db(), 옮겨적기)
  put('lunch_steps', JSON.stringify([{ id: 'bgm', enabled: true, order: 6, durationSec: 0 }]))   // 사람이 화면에서 0(끝까지)으로
  applyDataFixes(db(), 옮겨적기)
  assert.equal(JSON.parse(get('lunch_steps')).find(s => s.id === 'bgm').durationSec, 0)
})

test('③ 저장된 단계가 깨져 있으면 건드리지 않고 기동을 막지 않는다', () => {
  지우기()
  put('dinner_steps', '{ 깨짐')
  assert.doesNotThrow(() => applyDataFixes(db(), 옮겨적기))
  assert.equal(get('dinner_steps'), '{ 깨짐')
})
