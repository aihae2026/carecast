// TTS 가 끝난 뒤 BGM 을 몇 초 더 흘리는가 — **읽는 코드는 있는데 쓰는 코드가 없었다**
// (UX-17, 2026-09-11).
//
// ── 무엇을 막나 ────────────────────────────────────────────────────────────
// `services/broadcastConfig.js` 가 `schedule.bgm_end_delay` 를 읽어 화면으로 실어 보내고,
// `src/hooks/useScheduledBroadcast.js` 가 그 초만큼 기다렸다 BGM 을 멈춘다.
// **그런데 `schedules` 에 그 칸이 아예 없었다** — 언제나 `undefined ?? 0`, 즉 안내가
// 끝나는 순간 BGM 도 뚝 끊겼다. 대시보드의 옛 "즉시" 칸과 같은 모양이다(세는 코드만 있고
// 쓰는 코드가 0건이라 구조적으로 언제나 0).
//
// **그래서 이 검사는 배선을 끝에서 끝까지 실제로 돌린다.** 소스에 글자가 있는지만 보면
// 같은 함정을 또 못 잡는다.
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// 운영 DB 를 절대 안 건드리게 **require 보다 먼저** 임시 경로를 세운다.
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bgmtail-'))
process.env.CARECAST_DB_PATH = path.join(TMPDIR, 'test.db')
process.env.CARECAST_NO_HARDWARE = '1'

const { getDB, initDB } = require('../db/schema')
const { insertSchedule } = require('../services/scheduleStore')

initDB()
// BGM 이 실제로 풀리게 곡을 심는다 — 빈 폴더면 resolveBGM 이 null 이다(아무거나 틀지 않는다)
require('./helpers/localBgmFixture').로컬BGM심기(require('../db/schema').getDB())
const db = () => getDB()

const 예약만들기 = (over = {}) => insertSchedule({
  title: '프로그램 안내', content: '안내드립니다', scheduled_time: '14:00',
  repeat_start_date: '2026-09-11', repeat_weekdays: [],
  // `preset` 은 유튜브 API 키가 있어야 풀린다(`broadcastConfig.js:52-53`).
  // 이 검사는 **네트워크 없이** 배선만 보려는 것이라 영상 ID 를 직접 주는 유형을 쓴다.
  bgm_enabled: 1, bgm_type: 'youtube', bgm_value: 'dQw4w9WgXcQ',
  ...over,
})
const 읽기 = (id) => db().prepare('SELECT * FROM schedules WHERE id = ?').get(Number(id))

test('컬럼이 실제로 생긴다 — 마이그레이션이 initDB 에 반영됐다', () => {
  const cols = db().prepare('PRAGMA table_info(schedules)').all().map(c => c.name)
  assert.ok(cols.includes('bgm_end_delay'),
    'schedules.bgm_end_delay 가 없다 — broadcastConfig 가 읽는 값이 영원히 0 이 된다')
})

test('**DB 기본값은 0 이다** — 기존 예약의 소리 길이를 그 자리에서 바꾸지 않는다', () => {
  // ALTER 의 DEFAULT 를 5 로 주면 기존 행이 전부 5 가 되어, 현장에서 이미 돌고 있는
  // 방송의 BGM 이 5초씩 더 나간다. CLAUDE.md 의 0024 함정과 같은 자리다.
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.js'), 'utf8')
  const 줄 = sql.split('\n').find(l => l.includes('ADD COLUMN bgm_end_delay'))
  assert.ok(줄, 'schema.js 에 bgm_end_delay ALTER 가 없다 — 이 가드를 옮길 것')
  assert.match(줄, /DEFAULT 0/,
    'ALTER 의 DEFAULT 가 0 이 아니다 — 기존 예약이 그 값으로 채워져 소리 길이가 바뀐다')
})

test('**새 예약은 5초를 받는다** — 사용자가 요구한 타임라인', () => {
  const id = 예약만들기()
  assert.equal(읽기(id).bgm_end_delay, 5,
    '새 예약의 기본이 5가 아니다 — 안내가 끝나는 순간 BGM 이 끊긴다')
})

test('사람이 정한 값이 그대로 저장된다 — 0 도 유효한 값이다', () => {
  assert.equal(읽기(예약만들기({ bgm_end_delay: 12 })).bgm_end_delay, 12)
  assert.equal(읽기(예약만들기({ bgm_end_delay: 0 })).bgm_end_delay, 0,
    '0(즉시 정지)을 falsy 로 버리면 사람이 고른 값이 기본값으로 되돌아간다')
})

test('실행부가 그 값을 읽어 화면으로 실어 보낸다 — 저장만 되고 끝나지 않는다', async () => {
  const { resolveBGM } = require('../services/broadcastConfig')
  const 예약 = 읽기(예약만들기({ bgm_end_delay: 9 }))
  const r = await resolveBGM(db(), 예약)
  assert.ok(r, 'BGM 설정을 해석하지 못했다')
  assert.equal(r.endDelay, 9,
    'resolveBGM 이 endDelay 를 안 싣는다 — 화면이 언제 멈출지 모른다')
})

test('칸이 없던 옛 행도 죽지 않는다 — undefined 면 0 으로 본다', async () => {
  const { resolveBGM } = require('../services/broadcastConfig')
  const 옛행 = { ...읽기(예약만들기()), bgm_end_delay: undefined }
  const r = await resolveBGM(db(), 옛행)
  assert.equal(r.endDelay, 0)
})

// ── 수정 경로 — 여기가 가장 위험하다 ────────────────────────────────────────
// 이 칸을 모르는 화면(자동 업데이트 전 번들을 띄워 둔 관리자 탭)이 제목만 고쳐 저장하면?
// 라우트가 기본값 5를 쓰면 **그 순간 모든 예약의 BGM 이 5초씩 더 나가게 된다.**
// 기존 값 보존(`bodyOrExisting`)이 그것을 막는다.
test('수정 라우트가 이 칸을 기본값으로 덮어쓰지 않는다 — 모르는 화면이 저장해도 안전', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'schedules.js'), 'utf8')
  const i = src.indexOf('UPDATE schedules')
  assert.notEqual(i, -1, 'UPDATE 문을 못 찾았다 — 이 가드를 옮길 것')
  assert.match(src.slice(i, i + 900), /bgm_end_delay = \?/,
    '수정 라우트가 이 칸을 아예 안 쓴다 — 화면에서 고쳐도 저장이 안 된다')
  assert.match(src, /bodyOrExisting\('bgm_end_delay'/,
    "기본값으로 덮어쓰고 있다 — 이 칸을 모르는 화면이 저장하는 순간 모든 예약이 바뀐다")
  // 구조를 못 박는다: PUT 의 구조분해 기본값에 이 이름이 있으면 그것이 곧 덮어쓰기다
  const put = src.slice(src.indexOf("router.put('/:id'"), i)
  assert.ok(!/bgm_end_delay\s*=\s*\d/.test(put),
    'PUT 의 기본값 목록에 bgm_end_delay 가 있다 — 몸통에 없으면 그 숫자로 덮인다')
})

test('INSERT 의 칸 수와 물음표 수가 맞는다 — 하나 어긋나면 엉뚱한 칸에 들어간다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduleStore.js'), 'utf8')
  const m = /INSERT INTO schedules\s*\(([^)]*)\)\s*VALUES \(([^)]*)\)/s.exec(src)
  assert.ok(m, 'INSERT 문을 못 찾았다 — 이 가드를 옮길 것')
  const cols = m[1].split(',').map(x => x.trim()).filter(Boolean)
  const qs = m[2].split(',').map(x => x.trim()).filter(Boolean)
  assert.equal(cols.length, qs.length, `칸 ${cols.length} 개, 물음표 ${qs.length} 개`)
  assert.ok(cols.includes('bgm_end_delay'), 'INSERT 칸 목록에 bgm_end_delay 가 없다')
})

test('화면이 이 칸을 보여주고, 무엇이 일어나는지 말한다', () => {
  const modal = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'ScheduleModal.jsx'), 'utf8')
  assert.match(modal, /bgm_end_delay/, '모달에 이 칸이 없다 — 사람이 고칠 길이 없다')
  assert.match(modal, /저절로 작아지고/,
    'TTS 중 BGM 이 자동으로 낮아진다는 설명이 없다 — 사람은 BGM 이 안내를 덮는 줄 안다')
  const utils = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lib', 'scheduleUtils.js'), 'utf8')
  assert.match(utils, /bgm_end_delay: 5/, '새 예약 기본값이 화면 쪽에도 있어야 한다')
})
