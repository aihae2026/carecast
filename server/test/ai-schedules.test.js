// 자연어로 만든 예약의 소유 표시(managed_by='ai')와 "아까 등록한 거 취소" 경로.
//
// 왜 표시가 필요한가: 취소 요청이 무엇을 지울지 고를 근거가 있어야 한다. 근거 없이 "최근 것"을
// 지우면 사람이 손으로 만든 예약이나 자동방송 순서 편집기가 소유한 행(managed_by='morning_editor')이
// 휩쓸린다. 일과방송(아침 방송·국민체조 등)은 애초에 schedules 행이 아니라 settings 기반이라
// 이 경로로는 손댈 수 없다 — 그건 구조가 이미 막아준다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_aisched_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB } = require('../db/schema')
const { startTestApp } = require('./helpers/testApp')
const schedulesRoutes = require('../routes/schedules')
const { MANAGED_BY_AI, MANAGED_BY_VALUES } = require('../services/scheduleStore')

let app

test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/schedules': schedulesRoutes })
})

test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

async function req(method, p, body) {
  const r = await fetch(app.baseUrl + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

const base = {
  title: 'AI 예약 테스트', target: '전체', broadcast_type: 'text', content: '안내드립니다',
  scheduled_time: '10:00', repeat_start_date: '2026-08-28', repeat_weekdays: [],
}

test('모르는 소유자 이름은 400으로 막는다 — 오타는 다시 찾을 수 없는 행을 만든다', async () => {
  for (const bad of ['AI', 'ai ', 'gemini', 'claude', '사람']) {
    const r = await req('POST', '/api/schedules', { ...base, managed_by: bad })
    assert.equal(r.status, 400, `"${bad}"은 거부되어야 한다(실제 ${r.status})`)
  }
})

test('아는 소유자와 빈 값은 그대로 통과한다', async () => {
  for (const good of [...MANAGED_BY_VALUES, null, undefined, '']) {
    const r = await req('POST', '/api/schedules', { ...base, managed_by: good })
    assert.equal(r.status, 200, `${JSON.stringify(good)}은 저장되어야 한다(실제 ${r.status})`)
  }
})

test('AI 목록은 AI가 만든 예약만, 최근 것부터 돌려준다', async () => {
  const mine = []
  for (const t of ['08:00', '08:01']) {
    const r = await req('POST', '/api/schedules', {
      ...base, title: `AI ${t}`, scheduled_time: t, managed_by: MANAGED_BY_AI,
    })
    mine.push(r.body.id)
  }
  await req('POST', '/api/schedules', { ...base, title: '사람이 만든 것', scheduled_time: '08:02' })
  await req('POST', '/api/schedules', {
    ...base, title: '순서 편집기 것', scheduled_time: '08:03', managed_by: 'morning_editor',
  })

  const list = await req('GET', '/api/schedules/ai')
  assert.equal(list.status, 200)

  const owners = new Set(list.body.map(r => r.managed_by))
  assert.deepEqual([...owners], [MANAGED_BY_AI],
    'AI 목록에 다른 소유자의 행이 섞이면 취소가 엉뚱한 예약을 지운다')

  const ids = list.body.map(r => r.id)
  assert.deepEqual([...ids].sort((a, b) => b - a), ids, '최근 것부터 정렬되어야 한다')
  for (const id of mine) assert.ok(ids.includes(id), `AI가 만든 ${id}가 목록에 없다`)
})

test('AI 취소 경로는 AI가 만든 예약만 지운다', async () => {
  const ai = await req('POST', '/api/schedules', {
    ...base, title: '지울 AI 예약', scheduled_time: '09:00', managed_by: MANAGED_BY_AI,
  })
  const ok = await req('DELETE', `/api/schedules/ai/${ai.body.id}`)
  assert.equal(ok.status, 200)

  const after = await req('GET', '/api/schedules/ai')
  assert.ok(!after.body.some(r => r.id === ai.body.id), '지웠는데 목록에 남아 있다')
})

test('순서 편집기·사람이 만든 예약은 AI 취소 경로로 지워지지 않는다', async () => {
  const protectedRows = []
  const human = await req('POST', '/api/schedules', {
    ...base, title: '사람 예약', scheduled_time: '09:10',
  })
  protectedRows.push(human.body.id)
  const editor = await req('POST', '/api/schedules', {
    ...base, title: '순서 편집기 예약', scheduled_time: '09:11', managed_by: 'morning_editor',
  })
  protectedRows.push(editor.body.id)

  for (const id of protectedRows) {
    const r = await req('DELETE', `/api/schedules/ai/${id}`)
    assert.equal(r.status, 403, `${id}은 이 경로로 지워지면 안 된다(실제 ${r.status})`)
  }

  const all = await req('GET', '/api/schedules')
  for (const id of protectedRows) {
    assert.ok(all.body.some(r => r.id === id), `${id}이 실제로 지워졌다 — 보호가 뚫렸다`)
  }
})

test('없는 예약을 취소하면 404 — 조용히 성공하면 안 된다', async () => {
  const r = await req('DELETE', '/api/schedules/ai/999999')
  assert.equal(r.status, 404)
})

// ── 드리프트 방어 ─────────────────────────────────────────────
test('화면이 보내는 소유자 이름이 서버가 아는 목록 안에 있어야 한다', async () => {
  // QuickSchedulePhrase가 문자열 리터럴로 값을 실어 보낸다. 서버가 허용 목록을 바꾸면
  // 화면의 저장이 400으로 죽는데, 화면에는 "알 수 없는 예약 소유자입니다"만 뜬다.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'QuickSchedulePhrase.jsx'), 'utf8')
  const m = src.match(/managed_by:\s*'([^']+)'/)
  assert.ok(m, 'QuickSchedulePhrase.jsx에서 managed_by를 찾지 못했다 — AI 마킹이 빠지면 취소 목록에 안 뜬다')
  assert.ok(MANAGED_BY_VALUES.includes(m[1]),
    `화면이 보내는 '${m[1]}'이 서버 허용 목록(${MANAGED_BY_VALUES.join(', ')})에 없다`)
})

test('AI 표시는 저장 호출부가 아니라 draft 객체에 붙어 있어야 한다', async () => {
  // 저장 경로가 둘이다 — 확인 카드에서 바로 저장(createSchedule(draft))과 "자세히 수정"으로
  // 열리는 ScheduleModal(자체적으로 createSchedule(form)을 부른다). 모달은 draft를 통째로
  // 펼쳐 쓰므로 표시가 draft에 있어야 두 경로 모두 실린다. 호출부에만 붙이면 모달로 저장한
  // 예약은 표시 없이 저장돼서 취소 목록에 안 나온다 — 화면상으론 아무 이상이 없어 보인다.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'QuickSchedulePhrase.jsx'), 'utf8')
  // 2026-09-14: 카드마다 초안을 따로 갖게 되면서(`초안들[모드]`) 이 자리가
  // `setDraft({...})` 에서 **초안 객체를 짓고 그 칸에 넣는** 모양으로 바뀌었다.
  // **지켜야 할 사실은 그대로다** — 표시는 호출부가 아니라 **초안 객체**에 붙는다.
  // 모양만 보고 빨간불을 내면 사실이 아니라 글자를 지키는 시험이 된다.
  const i = src.indexOf("managed_by: 'ai'")
  assert.notEqual(i, -1, 'AI 표시를 아예 안 붙인다 — 취소 목록에 안 뜬다')
  const 줄시작 = src.lastIndexOf('\n', i) + 1
  const 그줄 = src.slice(줄시작, src.indexOf('\n', i))
  // 2026-09-14(2차): 즉시 초안의 실행값을 맞추면서 이 자리가 **두 줄로 갈렸다** —
  // 먼저 `{ ...기본, ...fields, managed_by: 'ai' }` 를 만들고, 즉시면 `즉시실행값` 을 지난다.
  // **지켜야 할 사실은 그대로다**: 표시는 호출부가 아니라 **서버가 읽은 값과 함께 초안에**
  // 붙는다. 그래서 `emptySchedule()` 이라는 글자가 아니라 **`...fields` 와 같은 줄인가**를 본다.
  assert.match(그줄, /\.\.\.fields/,
    'AI 표시가 초안 객체가 아니라 다른 자리에 붙었다 — "자세히 수정"으로 저장하면 표시가 사라진다. 실제: ' + 그줄)
  // 그 객체가 실제로 **초안이 된다**는 것도 본다 — 이름만 같고 버려지면 뜻이 없다.
  // 2026-09-14(3차·4차): 이 자리의 **모양**이 두 번 바뀌었다 — 즉시 판정 근거가 파서에서
  // 고른 카드로 옮겨졌고(V③ R12), 맞추는 일이 `실행방식맞추기` 한 곳으로 모였다(V③ R17).
  // 앞 판들은 조건식과 호출 모양을 글자로 박아 둬서 **지켜야 할 사실은 그대로인데 빨간불**이
  // 났다. **사실은 하나다 — 표시를 붙인 `합친` 이 그대로 초안이 된다.**
  // 그 한 가지만 본다. 맞추는 방법은 바뀔 수 있고, 바뀔 때마다 막아서면 글자를 지키는 시험이다.
  assert.match(src, /const \{ 초안 \} = 실행방식맞추기\([^\n]*, 합친,/,
    '표시를 붙인 객체가 초안으로 안 간다')
  // 저장 호출부에 직접 얹는 길이 다시 생기면 두 경로가 갈린다.
  assert.doesNotMatch(src, /createSchedule\([^)]*managed_by/,
    '저장 호출부에 표시를 직접 얹었다 — 모달로 저장한 예약에는 안 붙는다')
})
