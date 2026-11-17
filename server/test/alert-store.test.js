// 경보 배너가 무엇을 보여줄지 정하는 순수 로직(src/lib/alertStore.js).
//
// 왜 여기(server/test)에 있나: 이 저장소에는 프론트엔드 테스트 러너가 없다(playwright는
// devDependencies에만 있고 테스트 파일은 0개). node --test가 유일한 러너라서, 화면에서
// 떼어낼 수 있는 판정 로직만 순수 함수로 뽑아 여기서 덮는다. 렌더링·SSE 수신은 이 파일이
// 덮지 못하므로 브라우저로 직접 확인해야 한다 — 그 사실을 감추지 않는다.
//
// Node v24는 CJS에서 ESM을 require할 수 있어서 src/의 ESM 모듈을 그대로 불러온다.
//
// 이 로직이 왜 중요한가: 경보는 "확인" 전까지 안 사라져야 하고(그래야 직원이 본다),
// 동시에 같은 경보가 SSE와 새로고침 복원 양쪽에서 와도 두 번 뜨면 안 된다(그러면 잔소리가
// 되고 사람이 무시하기 시작한다). 그 둘을 가르는 것이 id 규칙이다.
'use strict'

const path = require('path')
const test   = require('node:test')
const assert = require('node:assert/strict')

const store = require(path.join(__dirname, '..', '..', 'src', 'lib', 'alertStore.js'))

// localStorage가 없는 환경(node)에서도 동작해야 한다 — 주입식으로 만든 이유
function fakeStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    _data: data,
  }
}

// ── id 규칙 ────────────────────────────────────────────────────

test('같은 날 같은 경보는 출처가 달라도 같은 id를 갖는다 — SSE와 새로고침 복원이 겹쳐도 한 번만 뜬다', () => {
  const fromRow = store.fromBroadcastRow({
    id: 12, date: '2026-08-29', time: '11:20', type: '경보',
    content: '[방송누락] 점심 식사 전 방송(11:15)이 나가지 않았습니다.',
  })
  const fromEvent = store.fromSSE({
    kind: '방송누락',
    message: '점심 식사 전 방송(11:15)이 나가지 않았습니다.',
  }, '2026-08-29')

  assert.equal(fromRow.id, fromEvent.id)
  assert.equal(fromRow.kind, '방송누락')
  assert.equal(fromRow.message, '점심 식사 전 방송(11:15)이 나가지 않았습니다.')
})

test('날짜가 다르면 다른 경보다 — 어제 확인한 것이 오늘 것을 덮으면 안 된다', () => {
  const a = store.fromSSE({ kind: '방송누락', message: '저녁 마무리(18:00)이 나가지 않았습니다.' }, '2026-08-29')
  const b = store.fromSSE({ kind: '방송누락', message: '저녁 마무리(18:00)이 나가지 않았습니다.' }, '2026-08-30')
  assert.notEqual(a.id, b.id, '매일 같은 문구로 나는 경보를 하루치 확인으로 영영 묻으면 안 된다')
})

test('경보가 아닌 이력 행은 걸러낸다', () => {
  assert.equal(store.fromBroadcastRow({ id: 1, date: '2026-08-29', type: '예약', content: '점심 안내' }), null)
  assert.equal(store.fromBroadcastRow({ id: 2, date: '2026-08-29', type: '자동', content: '아침 방송' }), null)
})

test('kind 표기가 없는 경보도 버리지 않는다', () => {
  const a = store.fromBroadcastRow({ id: 3, date: '2026-08-29', time: '10:00', type: '경보', content: '알 수 없는 문제' })
  assert.ok(a, '형식이 어긋난다고 경보를 삼키면 그게 더 나쁘다')
  assert.equal(a.message, '알 수 없는 문제')
})

// ── 병합·정렬 ──────────────────────────────────────────────────

test('같은 경보를 두 번 넣어도 목록에는 하나다', () => {
  const a = store.fromSSE({ kind: '서버', message: '비정상 종료' }, '2026-08-29')
  const merged = store.mergeAlerts([a], [a])
  assert.equal(merged.length, 1)
})

test('여러 경보는 최신이 위로 온다', () => {
  const list = store.mergeAlerts([], [
    { id: 'x1', kind: 'A', message: 'a', at: '2026-08-29T01:00:00.000Z' },
    { id: 'x2', kind: 'B', message: 'b', at: '2026-08-29T03:00:00.000Z' },
    { id: 'x3', kind: 'C', message: 'c', at: '2026-08-29T02:00:00.000Z' },
  ])
  assert.deepEqual(list.map(a => a.id), ['x2', 'x3', 'x1'])
})

test('경보가 아무리 많아도 화면에 쌓이는 수를 제한한다', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    id: `k${i}`, kind: 'T', message: `m${i}`, at: `2026-08-29T00:00:${String(i).padStart(2, '0')}.000Z`,
  }))
  assert.ok(store.mergeAlerts([], many).length <= store.MAX_VISIBLE)
})

// ── 확인(ack) ──────────────────────────────────────────────────

test('확인한 경보는 다시 뜨지 않는다 — 새로고침해도', () => {
  const s = fakeStorage()
  const a = store.fromSSE({ kind: '방송누락', message: '국민체조(09:00)이 나가지 않았습니다.' }, '2026-08-29')

  assert.equal(store.isAcked(a.id, s), false)
  store.ack(a.id, s)
  assert.equal(store.isAcked(a.id, s), true, '확인 표시가 저장돼야 새로고침 후에도 안 뜬다')

  // 다른 저장소 인스턴스로 다시 읽어도(=새 탭) 유지된다
  const s2 = fakeStorage(s._data)
  assert.equal(store.isAcked(a.id, s2), true)
})

test('확인하지 않은 경보만 걸러 준다', () => {
  const s = fakeStorage()
  const a = store.fromSSE({ kind: 'A', message: 'a' }, '2026-08-29')
  const b = store.fromSSE({ kind: 'B', message: 'b' }, '2026-08-29')
  store.ack(a.id, s)
  assert.deepEqual(store.unacked([a, b], s).map(x => x.kind), ['B'])
})

test('확인 기록이 무한히 쌓이지 않는다', () => {
  const s = fakeStorage()
  for (let i = 0; i < 500; i++) store.ack(`id-${i}`, s)
  const saved = JSON.parse(s.getItem(store.ACK_KEY))
  assert.ok(saved.length <= store.MAX_ACK, `확인 기록 ${saved.length}건 — localStorage를 무한히 채우면 안 된다`)
  assert.equal(store.isAcked('id-499', s), true, '최근 것은 남아 있어야 한다')
})

// ── 저장소가 없는/망가진 환경 ──────────────────────────────────

test('localStorage가 없거나 던져도 배너는 동작한다 — 사생활 모드·용량 초과', () => {
  const broken = {
    getItem() { throw new Error('SecurityError') },
    setItem() { throw new Error('QuotaExceededError') },
  }
  assert.doesNotThrow(() => store.ack('x', broken))
  assert.equal(store.isAcked('x', broken), false, '못 읽으면 "확인 안 함"으로 본다 — 경보를 숨기는 쪽으로 실패하면 안 된다')
  assert.doesNotThrow(() => store.unacked([{ id: 'x', kind: 'A', message: 'a' }], broken))
})

// ── 배너에 안 띄우는 종류 ──────────────────────────────────────
//
// 2026-08-30, 사용자 요청: "방송누락 보기 싫다. 그냥 꺼놔."
// 감시(watchdog.js)는 그대로 돌고 기록도 그대로 남는다 — 화면 배너에만 안 띄운다.
// 왜 배너만 끄나: 이 배너는 "확인"을 누를 때까지 안 사라지는 설계라, 방송을 실제로는 안
// 내보내는 PC(개발 PC 등)에서는 매일 반드시 거짓 경보가 쌓인다. 잔소리가 되면 사람이
// 진짜 경보까지 안 읽기 시작한다 — 배너의 존재 이유가 무너진다.
// 다시 켜려면 alertStore.js의 HIDDEN_KINDS에서 '방송누락'을 빼면 된다.

test('방송누락은 배너에 안 뜬다 — 감시·이력은 그대로다', () => {
  const merged = store.mergeAlerts([], [
    store.fromSSE({ kind: '방송누락', message: '국민체조(09:00)이 나가지 않았습니다.' }, '2026-08-30'),
  ])
  assert.equal(merged.length, 0)
})

test('다른 종류의 경보는 그대로 뜬다 — 방송누락만 가린다', () => {
  const merged = store.mergeAlerts([], [
    store.fromSSE({ kind: '방송누락', message: '국민체조(09:00)이 나가지 않았습니다.' }, '2026-08-30'),
    store.fromSSE({ kind: '재생실패', message: '음원 파일을 찾을 수 없습니다.' },       '2026-08-30'),
  ])
  assert.deepEqual(merged.map(a => a.kind), ['재생실패'])
})

test('가려진 경보가 표시 슬롯을 잡아먹지 않는다', () => {
  const incoming = []
  for (let i = 0; i < 3; i++) {
    incoming.push(store.fromSSE({ kind: '방송누락', message: `누락 ${i}` }, '2026-08-30'))
  }
  for (let i = 0; i < 3; i++) {
    incoming.push(store.fromSSE({ kind: '재생실패', message: `실패 ${i}` }, '2026-08-30'))
  }
  const merged = store.mergeAlerts([], incoming)
  assert.equal(merged.length, store.MAX_VISIBLE)
  assert.ok(merged.every(a => a.kind === '재생실패'),
    '가린 것을 먼저 자르지 않으면 진짜 경보가 상한에 밀려 안 보인다')
})

test('새로고침 복원 경로(이력 행)에서도 방송누락은 가려진다', () => {
  const row = store.fromBroadcastRow({
    id: 9, date: '2026-08-30', time: '09:05', type: '경보',
    content: '[방송누락] 국민체조(09:00)이 나가지 않았습니다.',
  })
  assert.ok(row, '경보 객체 자체는 만들어져야 한다 — 이력 화면은 계속 보여준다')
  assert.equal(store.mergeAlerts([], [row]).length, 0)
})

// 2026-09-01, 사용자 결정: "멈췄다만 배너로."
// 가린 것은 '방송누락'(시작조차 안 함 — 방송을 안 내보내는 PC에서는 매일 뜬다)뿐이고,
// '방송멈춤'(시작해 놓고 안 끝남)은 사람이 지금 가 봐야 하는 일이라 배너로 떠야 한다.
test('방송멈춤은 배너에 뜬다 — 가리는 것은 방송누락뿐이다', () => {
  const merged = store.mergeAlerts([], [
    store.fromSSE({ kind: '방송누락', message: '국민체조(09:00)이 나가지 않았습니다.' }, '2026-09-01'),
    store.fromSSE({ kind: '방송멈춤', message: '저녁 마무리(18:00) 방송이 시작됐는데 60분이 지나도 끝나지 않았습니다.' }, '2026-09-01'),
  ])
  assert.deepEqual(merged.map(a => a.kind), ['방송멈춤'])
})

test('새로고침 복원 경로에서도 방송멈춤은 살아남는다', () => {
  const row = store.fromBroadcastRow({
    id: 11, date: '2026-09-01', time: '19:00', type: '경보',
    content: '[방송멈춤] 저녁 마무리(18:00) 방송이 시작됐는데 60분이 지나도 끝나지 않았습니다.',
  })
  assert.equal(row.kind, '방송멈춤')
  assert.equal(store.mergeAlerts([], [row]).length, 1)
})
