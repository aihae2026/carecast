// 자연어 파싱의 3차 폴백 — LLM 이 안 될 때 **기존 규칙 파서**를 쓴다.
//
// 왜 새 파서를 안 만드나: `services/schedulePhrase.js` 가 이미 있다
// (쉬운 화면의 "예약 추가" 문장 입력이 그것을 쓴다). 같은 일을 두 번 구현하면
// 두 곳이 갈리고, 갈린 쪽이 조용히 틀린 예약을 만든다.
//
// 이 테스트가 지키는 것:
//   ① 규칙 파서 결과가 **초안이 쓰는 필드 이름**으로 옮겨진다(scheduled_time vs time)
//   ② 못 읽은 것은 **조용히 정하지 않는다** — ambiguous 로 남아 사람에게 되묻는다
//   ③ LLM 이 되면 그쪽을 쓰고, 안 되면 규칙으로 간다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')

const { parseWithFallback, toDraftShape } = require('../services/llmGateway')

test('규칙 파서 결과를 초안 필드 이름으로 옮긴다 — 이름이 다르면 값이 통째로 샌다', () => {
  const 규칙결과 = {
    scheduled_time: '15:00',
    title: '산책 안내',
    content: '산책 안내',
    broadcast_type: 'text',
    ambiguous: [],
  }
  const d = toDraftShape(규칙결과, '2026-09-07')
  assert.equal(d.time, '15:00', 'scheduled_time → time 매핑이 빠졌다')
  assert.equal(d.title, '산책 안내')
  assert.equal(d.content, '산책 안내')
  assert.equal(d.broadcast_type, 'text')
  assert.equal(d.date, '2026-09-07')
})

test('규칙 파서가 못 읽은 것은 ambiguous 로 넘어간다 — 조용히 정하지 않는다', () => {
  const d = toDraftShape({ scheduled_time: null, ambiguous: ['time_missing'] }, '2026-09-07')
  assert.deepEqual(d.ambiguous, ['time_missing'],
    '못 읽은 항목이 사라졌다 — 화면이 되물을 근거가 없어진다')
})

// 2026-09-06 순서가 뒤집혔다(규칙 먼저). 아래 셋은 **AI 가 불리는 유일한 경우**,
// 즉 규칙이 시각을 못 읽는 문장으로 다시 썼다. 통과시키려 고친 것이 아니라 규약이 바뀐 것이다.

test('규칙이 못 읽은 문장을 LLM 이 읽으면 그 결과를 쓴다', async () => {
  const r = await parseWithFallback({
    text: '내일 그쯤에 프로그램 안내 좀',      // 규칙이 시각을 못 읽는 문장
    today: '2026-09-06',
    callApi: async () => ({ date: '2026-09-07', time: '14:00', title: '프로그램 안내', content: '프로그램 안내', broadcast_type: 'text' }),
  })
  assert.equal(r.via, 'api')
  assert.equal(r.parsed.time, '14:00')
})

test('LLM 이 던져도 규칙 결과를 준다 — **던지지 않는다**', async () => {
  const r = await parseWithFallback({
    text: '언젠가 산책 안내',
    today: '2026-09-06',
    callApi: async () => { throw new Error('503') },
  })
  assert.equal(r.via, 'rule')
  assert.ok(r.parsed.time, '아무 시각도 안 줬다 — 화면이 빈손이 된다')
  assert.match(r.reason, /503/)
})

test('규칙이 읽은 문장은 AI 응답과 무관하다 — 애초에 안 부른다', async () => {
  const r = await parseWithFallback({
    text: '저녁 6시에 차임벨 울려줘',
    today: '2026-09-06',
    callApi: async () => ({ date: null, time: null }),
  })
  assert.equal(r.via, 'rule')
  assert.equal(r.parsed.time, '18:00')
  assert.equal(r.parsed.broadcast_type, 'chime', '차임벨을 못 알아봤다')
})

test('API 경로가 없어도 규칙이 읽으면 그대로 된다 — 키가 없는 현장이 그렇다', async () => {
  const r = await parseWithFallback({ text: '평일 오전 9시 30분 체조 안내', today: '2026-09-06' })
  assert.equal(r.via, 'rule')
  assert.equal(r.parsed.time, '09:30')
})

test('어떤 경우에도 던지지 않고 parsed 를 돌려준다', async () => {
  const 경우들 = [
    { text: '', today: '2026-09-06' },
    { text: '뭐시기', today: '2026-09-06', callApi: async () => { throw new Error('x') } },
    { text: null, today: '2026-09-06' },
  ]
  for (const 경우 of 경우들) {
    const r = await parseWithFallback(경우)
    assert.ok(r.parsed, `parsed 가 없다: ${JSON.stringify(경우)}`)
    assert.ok(['api', 'rule'].includes(r.via), `모르는 단계 이름: ${r.via}`)
  }
})

test('새 파서를 만들지 않았다 — 기존 schedulePhrase 를 쓴다', () => {
  const fs = require('fs')
  const src = fs.readFileSync(require.resolve('../services/llmGateway'), 'utf8')
  assert.match(src, /schedulePhrase/, '규칙 파서를 안 쓰고 따로 만들었다 — 두 곳이 갈린다')
})

// ── 2026-09-06: 순서를 뒤집었다 — 규칙 먼저, 못 읽으면 AI ────────────────
//
// 왜: 제미나이 **10.5초**([FACT] EV-000755) vs 규칙 파서 **밀리초**. 그리고 현장 말투
// ("매일 오후 3시에 산책 안내")는 규칙이 이미 정확히 읽는다. 예전 순서는 **빠르고 정확한
// 쪽을 10초 기다린 뒤에야** 썼다.
//
// 여기서 잠그는 것 넷:
//  1. 규칙이 읽으면 **AI 를 아예 안 부른다**(10초를 안 쓴다).
//  2. AI 를 부르는 조건은 **시각을 못 읽었을 때뿐**이다. "애매한 게 있으면"으로 넓히면
//     오전/오후 같은 흔한 애매함마다 10초를 쓰고, 그건 모델도 모르는 것이라 얻는 게 없다.
//  3. `09:00` 기본값에 속지 않는다 — 규칙은 시각을 못 읽어도 그 값을 채운다.
//  4. AI 가 시각을 읽어도 **규칙이 읽은 나머지(반복·볼륨·흐름)는 살린다.**

test('규칙이 읽으면 AI 를 아예 안 부른다 — 10초를 쓰지 않는다', async () => {
  let 불림 = 0
  const r = await parseWithFallback({
    text: '매일 오후 3시에 산책 안내',
    today: '2026-09-06',
    callApi: async () => { 불림++; return { time: '15:00' } },
  })
  assert.equal(r.via, 'rule')
  assert.equal(불림, 0, '규칙이 읽었는데 AI 를 불렀다 — 그만큼 사람이 기다린다')
  assert.equal(r.parsed.time, '15:00')
})

test('규칙이 시각을 못 읽으면 그때만 AI 를 부른다', async () => {
  let 불림 = 0
  const r = await parseWithFallback({
    text: '뭔가 알려줘',              // 시각이 없는 문장
    today: '2026-09-06',
    callApi: async () => { 불림++; return { date: '2026-09-07', time: '14:00', title: '안내' } },
  })
  assert.equal(불림, 1, '규칙이 못 읽었는데 AI 를 안 불렀다')
  assert.equal(r.via, 'api')
  assert.equal(r.parsed.time, '14:00')
})

test('규칙의 09:00 기본값에 속지 않는다 — 못 읽은 것을 성공으로 보면 AI 를 영영 안 부른다', async () => {
  const { 파싱쓸만한가 } = require('../services/llmGateway')
  // 규칙 파서는 시각을 못 읽어도 09:00 을 채우고 time_missing 을 남긴다
  assert.equal(파싱쓸만한가({ time: '09:00', ambiguous: ['time_missing'] }), false)
  assert.equal(파싱쓸만한가({ time: '09:00', ambiguous: [] }), true)
})

test('AI 가 시각을 읽어도 규칙이 읽은 나머지는 살린다 — 모델은 흐름·볼륨 표를 본 적이 없다', () => {
  const { applyApiTime } = require('../services/llmGateway')
  const 규칙 = {
    scheduled_time: '09:00', repeat_weekdays: [1, 2, 3, 4, 5],
    broadcast_type: 'flow', flow_sequence_id: 7, bgm_volume: 30,
    ambiguous: ['time_missing', 'ampm_guess'],
  }
  const 합친것 = applyApiTime(규칙, { time: '14:00', date: '2026-09-07' })
  assert.equal(합친것.scheduled_time, '14:00', 'AI 가 읽은 시각이 안 들어갔다')
  assert.deepEqual(합친것.repeat_weekdays, [1, 2, 3, 4, 5], '반복이 날아갔다')
  assert.equal(합친것.flow_sequence_id, 7, '흐름 id 가 날아갔다')
  assert.equal(합친것.bgm_volume, 30, '볼륨이 날아갔다')
  assert.deepEqual(합친것.ambiguous, ['ampm_guess'],
    '시각을 읽었는데 그 되물음이 남았거나, 다른 애매함까지 지웠다')
})

test('AI 도 못 읽으면 규칙 결과를 **애매한 채로** 준다 — 조용히 정하지 않는다', async () => {
  const r = await parseWithFallback({
    text: '뭔가 알려줘',
    today: '2026-09-06',
    callApi: async () => ({ time: null }),
  })
  assert.equal(r.via, 'rule')
  assert.ok((r.parsed.ambiguous || []).includes('time_missing'),
    '못 읽었다는 표시가 사라졌다 — 화면이 되물을 근거가 없어진다')
})

test('규칙에 문맥을 넘긴다 — 안 넘기면 흐름 이름·볼륨 낱말이 통째로 빠진다', async () => {
  const r = await parseWithFallback({
    text: '내일 오후 2시에 아침 인사 흐름 실행해줘',
    today: '2026-09-06',
    context: { flows: [{ id: 7, name: '아침 인사' }], autoTimes: [], volumeLevels: undefined },
  })
  assert.equal(r.via, 'rule')
  assert.equal(r.raw?.flow_sequence_id, 7,
    `문맥을 안 넘겨 흐름을 못 알아봤다: ${JSON.stringify(r.raw)}`)
})

test('두 입력창이 같은 함수를 쓴다 — 사본을 만들면 갈린다', () => {
  const fs = require('fs')
  const a = fs.readFileSync(require.resolve('../routes/schedules'), 'utf8')
  const b = fs.readFileSync(require.resolve('../routes/scheduleDrafts'), 'utf8')
  assert.match(a, /parseWithFallback/, 'parse-phrase 가 아직 규칙만 쓴다')
  assert.match(b, /parseWithFallback/, '초안 경로가 게이트웨이를 안 쓴다')
  // 문맥을 읽는 자리도 하나여야 한다
  assert.match(a, /readPhraseContext/)
  assert.match(b, /readPhraseContext/)
})
