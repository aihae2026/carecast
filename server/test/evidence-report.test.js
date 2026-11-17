// 근거 산출물이 숫자를 지어내지 않는다 (2026-09-04).
//
// 본선 심사가 "문제 해결"에서 **구체적 결과나 근거**를 요구한다. 그 근거는 이미 DB에
// 쌓여 있는 방송 이력인데, 꺼내 보여주는 산출물이 없어서 말로만 남는 상태였다.
// scripts/build-evidence-report.cjs가 그것을 한 장으로 뽑는다.
//
// **이 테스트가 지키는 것은 정확함이 아니라 정직함이다.** 심사 자료에서 가장 위험한
// 실패는 틀린 계산이 아니라 **없는 것을 있다고 적는 것**이다. 그래서:
//  1. 세는 방법이 손으로 센 것과 같다 (총 건수 · 자동 비율 · 성공률 · 준비 시간)
//  2. **기록이 없으면 "기록 없음"이라고 적는다** — 0으로 적으면 "0초 만에 준비했다"가 된다
//  3. 도입 전 수치를 지어내지 않는다 — 시스템은 도입 후만 안다(사용자 결정: 실측만 낸다)
//  4. 수치의 출처(DB 경로 · 기간)를 산출물에 적는다 — "이 숫자 어디서 났나"에 답할 수 있어야 한다
//  5. 운영 DB를 읽기만 한다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')
const { execFileSync } = require('child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT   = path.join(__dirname, '..', '..')
const SCRIPT = path.join(ROOT, 'scripts', 'build-evidence-report.cjs')

// 손으로 센 값이 나오도록 만든 표본.
//   방송 5건 · 기간 2026-01-05~07(3일) · 자동 3건(60.0%) · 성공 4건(80.0%)
//   준비 시간은 2건만 기록됨 → 평균 (1500+2500)/2 = 2000ms = 2.0초
// 자동 비율과 성공률을 **일부러 다르게** 만들었다 — 같으면 한쪽만 맞아도 통과한다.
const ROWS = [
  ['2026-01-05', '07:00', '예약', '아침 안내',   '자동',      '전체', 1, 1500],
  ['2026-01-05', '12:00', '예약', '점심 안내',   '자동',      '전체', 1, 2500],
  ['2026-01-06', '07:00', '예약', '아침 안내',   '자동',      '전체', 0, null],
  ['2026-01-06', '15:00', 'TTS',  '가족 방문',   '방송담당',  '전체', 1, null],
  ['2026-01-07', '09:00', 'TTS',  '프로그램 안내', '방송담당', '전체', 1, null],
]

// 감시가 남긴 경보. **같은 표에 앉지만 방송이 아니다** — 사람이 누른 적도, 스피커에서 난
// 적도 없다. 언제나 success=0이라 방송으로 세면 성공률이 통째로 주저앉는다.
// 코드도 이미 둘을 갈라 본다: retention.js가 보관 기간을 경보 180일 · 방송 365일로 따로 준다.
const ALERT_ROWS = [
  ['2026-01-05', '07:55', '경보', '[방송누락] 아침 종합 방송(07:50)이 나가지 않았습니다.', '자동', '전체', 0, null],
  ['2026-01-06', '09:05', '경보', '[방송누락] 국민체조(09:00)이 나가지 않았습니다.',       '자동', '전체', 0, null],
  ['2026-01-07', '11:20', '경보', '[재생실패] 환기방송이 재생되지 않았습니다.',            '자동', '전체', 0, null],
]

function makeDB(dir, rows) {
  const p = path.join(dir, 'test.db')
  const db = new DatabaseSync(p)
  db.exec(`CREATE TABLE broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, time TEXT, type TEXT, content TEXT,
    user TEXT, target TEXT, success INTEGER, prep_ms INTEGER DEFAULT NULL, run_key TEXT)`)
  db.exec(`CREATE TABLE schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, scheduled_time TEXT, active INTEGER DEFAULT 1,
    broadcast_type TEXT, repeat_weekdays TEXT)`)
  db.exec('CREATE TABLE checkin_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT, result TEXT, note TEXT, checked_at TEXT)')
  const ins = db.prepare('INSERT INTO broadcasts (date,time,type,content,user,target,success,prep_ms) VALUES (?,?,?,?,?,?,?,?)')
  for (const r of rows) ins.run(...r)
  db.prepare("INSERT INTO schedules (title, scheduled_time, active, broadcast_type) VALUES ('아침 안내','07:00',1,'아침')").run()
  db.prepare("INSERT INTO schedules (title, scheduled_time, active, broadcast_type) VALUES ('점심 안내','12:00',1,'점심')").run()
  db.prepare("INSERT INTO schedules (title, scheduled_time, active, broadcast_type) VALUES ('옛 예약','20:00',0,'기타')").run()
  db.close()
  return p
}

function run(dbPath, outPath) {
  execFileSync(process.execPath, [SCRIPT, outPath], {
    env: { ...process.env, CARECAST_DB_PATH: dbPath },
    stdio: 'pipe', timeout: 30000, encoding: 'utf8',
  })
  return fs.readFileSync(outPath, 'utf8')
}

test('센 값이 손으로 센 것과 같다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-evidence-'))
  const html = run(makeDB(dir, ROWS), path.join(dir, 'out.html'))

  assert.match(html, /데이터-총건수="5"/, '총 방송 건수가 5가 아니다')
  assert.match(html, /데이터-기록일수="3"/, '기록이 있는 날이 3일이 아니다')
  assert.match(html, /데이터-자동비율="60.0"/, '자동 비율이 60.0%가 아니다(자동 3 / 전체 5)')
  assert.match(html, /데이터-성공률="80.0"/, '성공률이 80.0%가 아니다(성공 4 / 전체 5)')
  assert.match(html, /데이터-준비시간초="2.0"/, '준비 시간 평균이 2.0초가 아니다((1500+2500)/2)')
  assert.match(html, /데이터-준비시간표본="2"/, '준비 시간이 기록된 건수가 2가 아니다')
  // 켜져 있는 예약만 센다 — 꺼 둔 옛 예약을 세면 "매일 3번 나간다"고 부풀려진다
  assert.match(html, /데이터-활성예약="2"/, '활성 예약이 2건이 아니다(꺼 둔 것 1건 제외)')
})

// 2026-09-04에 실제로 틀렸던 것을 고정한다. 첫 판은 표의 모든 행을 방송으로 셌는데,
// 개발 DB에서 68건 중 20건이 경보였다 — 성공률이 67.6%로 나왔고 경보를 빼면 95.8%다.
// **현장 DB에서는 이게 훨씬 크게 벌어진다**: 현장은 아직 옛 감시라 5분 넘는 방송을 전부
// 누락으로 찍고 있어서, 거짓 경보가 그대로 "실패한 방송"으로 집계된다. 심사에 낼 숫자가
// 실제보다 나쁘게 나오는 방향의 오류라 더 위험하다 — 스스로를 과소평가하는 거짓말도 거짓말이다.
test('경보를 방송으로 세지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-evidence-'))
  const html = run(makeDB(dir, [...ROWS, ...ALERT_ROWS]), path.join(dir, 'out.html'))

  assert.match(html, /데이터-총건수="5"/,
    '경보가 방송 건수에 섞였다 — 감시가 남긴 줄은 사람이 누른 적도 스피커에서 난 적도 없다')
  assert.match(html, /데이터-성공률="80.0"/,
    '경보가 성공률을 끌어내렸다 — 경보는 언제나 success=0이라 세면 성공률이 주저앉는다')
  assert.match(html, /데이터-자동비율="60.0"/, '경보가 자동 비율을 흔들었다')
  assert.match(html, /데이터-경보="3"/,
    '경보 건수를 따로 세지 않는다 — 빼기만 하고 안 보여주면 감시가 몇 번 울렸는지 사라진다')
})

// "경보 20건"만으로는 좋은 소식인지 나쁜 소식인지 못 읽는다. 방송이 안 나간 것과
// 브라우저가 재생을 막은 것과 한 단계가 실패한 것은 **고칠 곳이 서로 다르다.**
// 문구 앞머리의 대괄호가 이미 그 분류를 달고 있으니(watchdog·시퀀서가 붙인다) 그대로 쓴다.
test('경보를 종류별로 갈라 보여준다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-evidence-'))
  const html = run(makeDB(dir, [...ROWS, ...ALERT_ROWS]), path.join(dir, 'out.html'))

  assert.match(html, /경보종류="방송누락"[^>]*>[\s\S]{0,120}?2</,
    '[방송누락] 2건이 종류별 표에 안 나온다')
  assert.match(html, /경보종류="재생실패"[^>]*>[\s\S]{0,120}?1</,
    '[재생실패] 1건이 종류별 표에 안 나온다')
})

// 2026-09-04 실제 사고. 현장에서 받아온 백업이 09-01자라 prep_ms 컬럼이 생기기 전이었고
// (그 컬럼은 09-03 마이그레이션 0018에서 붙었다), 스크립트가 SQL 오류로 죽었다.
// **다른 PC·옛 백업을 읽는 것이 이 도구의 존재 이유다** — 거기서 깨지면 아무 쓸모가 없다.
// 스키마는 앞으로도 자란다. 없는 칸은 "그 시절엔 안 재던 것"이지 오류가 아니다.
test('옛 백업 — 없는 칸이 있어도 읽는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-evidence-'))
  const p = path.join(dir, 'old.db')
  const db = new DatabaseSync(p)
  // prep_ms도 run_key도 없던 시절의 표
  db.exec(`CREATE TABLE broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, time TEXT, type TEXT, content TEXT,
    user TEXT, target TEXT, success INTEGER)`)
  db.exec('CREATE TABLE schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, scheduled_time TEXT, active INTEGER DEFAULT 1)')
  const ins = db.prepare('INSERT INTO broadcasts (date,time,type,content,user,target,success) VALUES (?,?,?,?,?,?,?)')
  for (const r of ROWS) ins.run(...r.slice(0, 7))
  db.prepare("INSERT INTO schedules (title, scheduled_time, active) VALUES ('아침 안내','07:00',1)").run()
  db.close()

  const html = run(p, path.join(dir, 'out.html'))
  assert.match(html, /데이터-총건수="5"/, '옛 백업의 방송을 못 셌다')
  assert.match(html, /데이터-성공률="80.0"/, '옛 백업의 성공률이 틀렸다')
  assert.match(html, /데이터-준비시간표본="0"/, '없는 칸을 표본 0으로 안 적는다')
  assert.match(html, /기록 없음/, '없는 칸을 "기록 없음"이라 말하지 않는다')
  // 점검 이력 표가 통째로 없는 것도 견뎌야 한다
  assert.match(html, /데이터-점검이력="0"/, 'checkin_runs 표가 없으면 죽는다')
})

test('기록이 없으면 "기록 없음"이라 적는다 — 0으로 적지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-evidence-'))
  // 준비 시간이 하나도 안 쌓인 DB(개발 PC가 지금 딱 이 상태다 — 68건 전부 비어 있다)
  const rows = ROWS.map(r => [...r.slice(0, 7), null])
  const html = run(makeDB(dir, rows), path.join(dir, 'out.html'))

  assert.match(html, /데이터-준비시간표본="0"/, '표본이 0으로 안 적힌다')
  assert.ok(!/데이터-준비시간초="0(\.0)?"/.test(html),
    '준비 시간을 0으로 적었다 — "0초 만에 준비했다"로 읽힌다. 없는 것은 없다고 적어야 한다')
  assert.match(html, /기록 없음/, '없는 값을 "기록 없음"이라고 말하지 않는다')
})

test('도입 전 수치를 지어내지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-evidence-'))
  const html = run(makeDB(dir, ROWS), path.join(dir, 'out.html'))
  // 시스템은 도입 후만 안다. 도입 전은 사람만 아는 값이라 산출물이 주장하면 안 된다
  // (사용자 결정 2026-09-04: 실측만 내고 전후 비교는 발표자료에서 사람이 붙인다).
  for (const bad of ['도입 전', '개선율', '절감률', '이전 대비', '감소했']) {
    assert.ok(!html.includes(bad),
      `"${bad}"를 적었다 — DB에 없는 것을 주장한다. 심사에서 가장 위험한 종류의 거짓이다`)
  }
})

test('수치의 출처를 산출물에 적는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-evidence-'))
  const dbPath = makeDB(dir, ROWS)
  const html = run(dbPath, path.join(dir, 'out.html'))
  assert.ok(html.includes(path.basename(dbPath)), '어느 DB를 읽었는지 안 적혀 있다')
  assert.match(html, /2026-01-05/, '집계 기간의 시작이 안 적혀 있다')
  assert.match(html, /2026-01-07/, '집계 기간의 끝이 안 적혀 있다')
})

test('운영 DB를 읽기만 한다', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  assert.match(src, /readOnly:\s*true/,
    'DB를 읽기 전용으로 열지 않는다 — 운영 DB가 원본이라 쓰기 경로가 있으면 안 된다')
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(src.replace(/^\s*\/\/.*$/gm, '')),
    '쓰기 SQL이 들어 있다')
})
