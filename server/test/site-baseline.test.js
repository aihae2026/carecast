// 현장 PC 설정을 다른 PC의 기초값으로 심는 장치. (2026-08-30)
//
// 왜 필요했나: `server/db/`는 gitignore라 PC를 옮기면 따라오지 않는다. 개발 PC의 DB에는
// 예약(환기방송 포함)·연속 방송 흐름·유튜브 즐겨찾기가 **한 번도 있던 적이 없는데**,
// 화면은 그걸 "없어졌다"로 보여준다. 같은 뿌리로 최소 세 번 헛걸음했다 —
// 백로그 유실(08-29), BGM 안 나옴, 환기방송 없어짐. 매번 원인만 다시 찾고 고치진 않았다.
//
// 여기서 고정하는 것 셋:
//   1) **비밀키가 저장소로 새지 않는다.** 결과 JSON은 git에 커밋된다. 한 번 올라가면
//      비공개 저장소여도 되돌리기 어렵다(CC-001에서 기상청 실키로 이미 겪었다).
//   2) **있는 값을 덮지 않는다.** 현장 PC에서 돌아도 아무 일이 안 일어나야 하고,
//      개발 PC에서 손으로 바꾼 값이 재시작마다 되돌아가면 안 된다.
//   3) **반쯤 찬 표에 덧붙이지 않는다.** 예약이 중복되면 어르신이 같은 방송을 두 번 듣는다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_baseline_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { applyBaseline, seedSettings, seedTable } = require('../config/siteBaseline')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 무시 */ }
  }
})

function writeBaseline(obj) {
  const p = path.join(os.tmpdir(), `carecast_baseline_${process.pid}_${Date.now()}_${Math.random()}.json`)
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8')
  return p
}

// ── 1) 있는 값을 덮지 않는다 ──────────────────────────────────

test('이미 있는 설정은 절대 덮어쓰지 않는다 — 현장 PC에서 돌아도 아무 일이 없어야 한다', () => {
  const db = getDB()
  db.prepare("INSERT INTO settings (key, value) VALUES ('lunch_broadcast_time','11:15') ON CONFLICT(key) DO UPDATE SET value='11:15'").run()

  const n = seedSettings(db, { lunch_broadcast_time: '09:99', 아주새로운키: '새값' })

  assert.equal(db.prepare("SELECT value FROM settings WHERE key='lunch_broadcast_time'").get().value, '11:15',
    '현장에서 맞춰 둔 시각이 기초값으로 되돌아가면 방송 시각이 바뀐다')
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='아주새로운키'").get().value, '새값')
  assert.equal(n, 1, '새로 채운 것만 센다')
})

// ── 2) 반쯤 찬 표에 덧붙이지 않는다 ───────────────────────────

test('표에 한 행이라도 있으면 통째로 건너뛴다 — 예약이 중복되면 방송이 두 번 나간다', () => {
  const db = getDB()
  db.prepare(`INSERT INTO schedules (title, content, target, scheduled_time, active, repeat_start_date, repeat_weekdays, broadcast_type)
              VALUES ('기존예약','','전체','10:00',1,'2026-08-28','[]','text')`).run()

  const n = seedTable(db, 'schedules', [
    { title: '환기방송', content: '', target: '전체', scheduled_time: '14:00', active: 1,
      repeat_start_date: '2026-08-28', repeat_weekdays: '[]', broadcast_type: 'text' },
  ])
  assert.equal(n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM schedules WHERE title='환기방송'").get().c, 0)
})

test('없는 표를 만나도 던지지 않는다 — 버전이 다른 DB에서 뽑았을 수 있다', () => {
  assert.doesNotThrow(() => seedTable(getDB(), '있을리없는표', [{ a: 1 }]))
  assert.equal(seedTable(getDB(), '있을리없는표', [{ a: 1 }]), 0)
})

// ── 3) 흐름 id를 새로 연결한다 ────────────────────────────────

test('연속 방송을 심을 때 단계와 예약이 새 id로 다시 연결된다', () => {
  // 이 검증만 깨끗한 DB가 필요하다 — 위 테스트가 schedules에 행을 넣어 뒀다
  const p2 = path.join(os.tmpdir(), `carecast_test_baseline2_${process.pid}_${Date.now()}.db`)
  const { DatabaseSync } = require('node:sqlite')
  const src = getDB()
  // 같은 스키마의 빈 DB를 만든다
  const ddl = src.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").all()
  const db2 = new DatabaseSync(p2)
  for (const r of ddl) { try { db2.exec(r.sql) } catch { /* 일부는 재생성 불가 — 무시 */ } }

  const file = writeBaseline({
    settings: {},
    flow_sequences: [{ id: 77, name: '아침 흐름', created_at: 'x', updated_at: 'x' }],
    flow_sequence_steps: [{ id: 5, flow_sequence_id: 77, sort_order: 0, step_type: 'chime' }],
    schedules: [{
      id: 9, title: '흐름예약', content: '', target: '전체', scheduled_time: '07:50', active: 1,
      repeat_start_date: '2026-08-28', repeat_weekdays: '[]', broadcast_type: 'flow', flow_sequence_id: 77,
    }],
  })

  const done = applyBaseline(db2, file)
  assert.equal(done.flow_sequences, 1)

  const newFlow = db2.prepare('SELECT id FROM flow_sequences').get()
  assert.notEqual(newFlow.id, 77, '옛 id를 그대로 쓰면 다른 흐름에 붙을 수 있다')

  const step = db2.prepare('SELECT flow_sequence_id FROM flow_sequence_steps').get()
  assert.equal(step.flow_sequence_id, newFlow.id, '단계가 새 흐름을 가리켜야 한다')

  const sch = db2.prepare('SELECT flow_sequence_id, last_fired FROM schedules').get()
  assert.equal(sch.flow_sequence_id, newFlow.id, '예약도 새 흐름을 가리켜야 한다')
  assert.ok(!sch.last_fired, '남의 PC의 "오늘 나갔다" 기록을 가져오면 오늘 방송이 안 나간다')

  db2.close()
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(p2 + s) } catch { /* 무시 */ } }
})

test('파일이 없으면 조용히 아무것도 안 한다', () => {
  assert.equal(applyBaseline(getDB(), path.join(os.tmpdir(), '없는파일.json')), null)
})

// ── 4) 비밀키가 새지 않는다 ───────────────────────────────────
//
// 뽑는 규칙은 scripts/make-site-baseline.cjs가 갖고 있다. 소스를 읽어 규칙이 살아 있는지
// 확인한다 — 실제 현장 DB가 없어도 규칙의 존재는 고정할 수 있고, 규칙을 지우면 잡힌다.

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'make-site-baseline.cjs'), 'utf8')

test('뽑기 스크립트가 알려진 비밀키를 이름으로 거른다', () => {
  for (const key of [
    'youtube_api_key', 'gemini_api_key', 'kma_api_key', 'kma_apihub_key',
    'switchbot_token', 'switchbot_secret',
  ]) {
    assert.ok(SCRIPT.includes(`'${key}'`), `${key}가 제외 목록에 없다 — 저장소로 새 나간다`)
  }
})

test('PC마다 달라야 하는 값도 거른다', () => {
  // auto_shutdown_time을 가져오면 개발 PC가 새벽 5시 반에 꺼진다.
  // audio_device를 가져오면 오늘 고친 출력장치 문제가 그대로 되돌아온다.
  for (const key of ['auto_shutdown_time', 'audio_device', 'pc_role']) {
    assert.ok(SCRIPT.includes(`'${key}'`), `${key}는 PC마다 달라야 하는데 제외 목록에 없다`)
  }
})

// 2026-09-06: 비밀도 아니고 PC마다 다른 것도 아니지만 **시간이 지나면 썩는** 값이 있다.
// 실제로 겪었다 — 현장의 `gemini_model`("gemini-2.5-flash")이 baseline에 실려 있었는데,
// 구글이 그 모델을 "no longer available to new users"로 닫았다. 새 PC는 새 키를 쓰므로
// **설치하자마자 404**다. 남의 PC에서 뽑은 모델 이름을 심으면 안 된다.
test('시간이 지나면 썩는 값도 거른다 — 새 PC가 설치하자마자 죽지 않게', () => {
  assert.ok(SCRIPT.includes("'gemini_model'"),
    'gemini_model이 제외 목록에 없다 — 새 PC가 이미 닫힌 모델을 물려받는다')

  // 이미 뽑아 둔 파일에도 남아 있으면 안 된다. 규칙만 고치고 파일을 안 고치면
  // 다음 사람이 그 파일을 그대로 쓴다.
  const fs = require('fs')
  const path = require('path')
  const baselinePath = path.join(__dirname, '..', 'config', 'site-baseline.json')
  if (fs.existsSync(baselinePath)) {
    const b = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    assert.ok(!('gemini_model' in (b.settings || {})),
      'site-baseline.json에 gemini_model이 아직 남아 있다')
  }
})

test('이름 생김새로도 거른다 — 새 비밀키가 생겨도 걸리게', () => {
  assert.match(SCRIPT, /key\$\/i/,   'key로 끝나는 설정을 거르는 규칙이 없다')
  assert.match(SCRIPT, /secret/i,    'secret이 든 설정을 거르는 규칙이 없다')
  assert.match(SCRIPT, /token/i,     'token이 든 설정을 거르는 규칙이 없다')
})

test('마지막 그물 — 값까지 훑어보고 비밀키처럼 생기면 파일을 안 쓴다', () => {
  assert.match(SCRIPT, /AIza/, 'Google 계열 키 모양 검사가 없다')
  assert.match(SCRIPT, /process\.exit\(2\)/, '새는 것을 발견했을 때 파일을 쓰지 않고 멈춰야 한다')
})

test('만들어진 기초 설정 파일에는 비밀키가 없다', () => {
  const p = path.join(__dirname, '..', 'config', 'site-baseline.json')
  if (!fs.existsSync(p)) return       // 아직 현장 DB를 못 받았으면 검사할 게 없다
  const raw = fs.readFileSync(p, 'utf8')
  assert.doesNotMatch(raw, /AIza[0-9A-Za-z_-]{30,}/, 'Google 계열 키가 들어 있다')
  assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{20,}/,    'OpenAI 계열 키가 들어 있다')
  for (const key of ['youtube_api_key', 'gemini_api_key', 'switchbot_token', 'switchbot_secret']) {
    assert.ok(!raw.includes(`"${key}"`), `${key}가 파일에 있다 — 저장소로 새 나간다`)
  }
})
