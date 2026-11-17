// 흐름 복제 — 비슷한 방송을 하나 더 만들려고 **빈 화면부터 단계를 다시 쌓던 것**.
//
// 복제에서 조용히 틀어지기 쉬운 것 두 가지를 못박는다:
//   1) **원본과 복사본이 같은 행을 공유하면 안 된다.** 단계를 새로 넣지 않고 참조만
//      바꾸면, 복사본을 고쳤을 때 원본 방송이 함께 바뀐다 — 매일 저절로 나가는 방송이라
//      사람이 알아채는 것은 방송이 이상하게 나간 다음이다.
//   2) **이름이 겹치면 안 된다.** 목록에서 같은 이름이 둘이면 어느 것을 예약에 걸었는지
//      고를 수 없다.
//
// 운영 DB를 건드리지 않도록 CARECAST_DB_PATH로 임시 DB를 쓴다(flow-sequences.test.js와 같은 방식).
'use strict'

const path = require('path')
const { editorSource } = require('./helpers/editorSource')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_flowdup_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { loadFlowWithSteps, replaceSteps, duplicateFlow } = require('../routes/flows')

test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

const STEPS = [
  { step_type: 'group', label: '아침 인사',  config: {} },
  { step_type: 'tts',   label: '인사말',     config: { text: '안녕하세요', volume: 70 } },
  { step_type: 'delay', label: '잠깐 대기',  config: { seconds: 5 } },
  { step_type: 'audio', label: '녹음 음원',  config: { audio_id: 12, at_time: '07:55' } },
]

function makeFlow(name, steps = STEPS) {
  const db = getDB()
  const now = new Date().toISOString()
  const id = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(name, now, now).lastInsertRowid
  replaceSteps(db, id, steps)
  return id
}

test('복제하면 단계 수·순서·설정이 원본과 똑같다', () => {
  const db = getDB()
  const srcId = makeFlow('아침 방송 흐름')

  const copyId = duplicateFlow(db, srcId)
  assert.ok(copyId, '복제가 새 흐름 id를 돌려줘야 한다')
  assert.notEqual(copyId, srcId)

  const src  = loadFlowWithSteps(db, srcId)
  const copy = loadFlowWithSteps(db, copyId)

  assert.equal(copy.steps.length, src.steps.length)
  assert.deepEqual(
    copy.steps.map(s => [s.sort_order, s.step_type, s.label, s.config]),
    src.steps.map(s => [s.sort_order, s.step_type, s.label, s.config]),
    '순서·유형·이름·설정이 그대로여야 한다 — 예약 시각(at_time)까지 포함',
  )
})

test('복사본을 고쳐도 원본은 안 바뀐다 — 행을 공유하면 매일 나가는 방송이 함께 바뀐다', () => {
  const db = getDB()
  const srcId  = makeFlow('점심 흐름')
  const copyId = duplicateFlow(db, srcId)

  replaceSteps(db, copyId, [{ step_type: 'chime', label: '차임벨만', config: {} }])

  const src = loadFlowWithSteps(db, srcId)
  assert.equal(src.steps.length, STEPS.length, '원본 단계가 사라졌다 — 같은 행을 공유하고 있다')
  assert.equal(src.steps[1].label, '인사말')
})

test('이름이 겹치지 않는다 — 같은 흐름을 두 번 복제하면 (복사본), (복사본 2)', () => {
  const db = getDB()
  const srcId = makeFlow('저녁 흐름')

  const first  = loadFlowWithSteps(db, duplicateFlow(db, srcId))
  const second = loadFlowWithSteps(db, duplicateFlow(db, srcId))

  assert.equal(first.name,  '저녁 흐름 (복사본)')
  assert.equal(second.name, '저녁 흐름 (복사본 2)')
})

test('이름을 지정하면 그 이름으로 만든다', () => {
  const db = getDB()
  const srcId  = makeFlow('체조 흐름')
  const copy = loadFlowWithSteps(db, duplicateFlow(db, srcId, '  일요일 체조 흐름  '))
  assert.equal(copy.name, '일요일 체조 흐름', '앞뒤 공백은 다듬어야 한다')
})

test('지정한 이름이 이미 있으면 그것도 겹치지 않게 만든다', () => {
  const db = getDB()
  makeFlow('겹치는 이름')
  const srcId = makeFlow('원본 흐름')
  const copy  = loadFlowWithSteps(db, duplicateFlow(db, srcId, '겹치는 이름'))
  assert.equal(copy.name, '겹치는 이름 (복사본)')
})

// ── 화면 쪽 ────────────────────────────────────────────────
// 이 프로젝트에는 프론트 테스트 러너가 없다(무의존 원칙). 소스를 읽어 못박는 방식은
// monitor-mirror.test.js 등이 이미 쓰는 방법이다. 여기서 지키려는 것은 **조용히 어긋나는**
// 두 가지다: 화면이 부르는 주소가 서버 경로와 갈라지는 것(404가 나도 화면은 말이 없다),
// 그리고 연타로 복사본이 둘 생기는 것.
test('[화면] api.js가 부르는 주소가 서버 라우트와 같다', () => {
  const api    = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'api.js'), 'utf8')
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'flows.js'), 'utf8')
  assert.match(api, /duplicateFlow[\s\S]{0,120}\/api\/flows\/\$\{id\}\/duplicate/,
    'api.js에 duplicateFlow가 없거나 주소가 다르다')
  assert.match(routes, /router\.post\(\s*'\/:id\/duplicate'/,
    '서버에 POST /:id/duplicate가 없다 — 화면이 404를 받고도 조용하다')
})

// 목록은 2026-09-01에 자동방송순서편집기 사이드바로 옮겼다 — 사람이 실제로 방송 순서를
// 손보는 화면이 거기고, 예약방송관리에 따로 두니 같은 흐름이 화면에 따라 보였다 안 보였다 했다.
test('[화면] 사이드바에 복제 버튼이 있고, 연타로 복사본이 둘 생기지 않는다', () => {
  const src = editorSource()
  assert.match(src, /startCopy\(/, '사이드바 줄에 복제 버튼이 없다')
  assert.match(src, /if \(copying\) return/, '연타 방지 가드가 없다 — 복사본이 둘 생긴다')
  assert.match(src, /disabled=\{copying\}/, '만드는 중에는 버튼이 잠겨야 한다')
})

test('[화면] 복사본은 정지 상태로 만든다 — 복사하자마자 매일 나가기 시작하면 사고다', () => {
  const src = editorSource()
  const dup = src.slice(src.indexOf('const handleDuplicateFlow'), src.indexOf('const handleAdoptFlow'))
  assert.ok(dup.length > 0, 'handleDuplicateFlow를 못 찾았다')
  assert.match(dup, /active: 0/, '복제가 만든 예약이 켜진 채로 나온다')
})

test('[화면] 사이드바 조작 버튼은 마우스를 안 올려도 보인다', () => {
  // 현장 PC는 터치 화면이고 어르신을 돌보는 분들이 쓴다. hover에만 뜨는 버튼은
  // 터치에서 아예 존재하지 않는 것과 같다 — 복제·삭제가 그렇게 숨어 있었다.
  const src = editorSource()
  const sidebar = src.slice(src.indexOf('커스텀 자동순서</p>'), src.indexOf('새 자동순서'))
  assert.doesNotMatch(sidebar, /opacity-0 group-hover:opacity-100/,
    '사이드바 버튼이 마우스를 올려야만 보인다 — 터치 화면에서는 못 누른다')
})

test('[화면] 예약방송관리에는 흐름 목록 패널이 남아 있지 않다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'sections', 'ScheduledBroadcast.jsx'), 'utf8')
  assert.doesNotMatch(src, /<FlowBuilder \/>/, '두 화면에 목록이 둘 있으면 다시 갈라진다')
})

test('없는 흐름을 복제하면 null이고, 아무것도 만들지 않는다', () => {
  const db = getDB()
  const before = db.prepare('SELECT COUNT(*) AS n FROM flow_sequences').get().n
  assert.equal(duplicateFlow(db, 999999), null)
  const after = db.prepare('SELECT COUNT(*) AS n FROM flow_sequences').get().n
  assert.equal(after, before, '실패한 복제가 빈 흐름을 남기면 안 된다')
})
