// 방송 민감정보 필터 — 개인정보가 스피커로 나가는 사고를 막는다.
//
// 이 테스트에서 가장 중요한 건 "막는 것"보다 **엉뚱한 걸 막지 않는 것**이다:
//  - 아침 방송은 매일 "오늘은 2026년 8월 27일입니다"를 말한다. 날짜를 전부 막으면
//    매일 나가는 자동방송이 깨진다.
//  - 이름을 한글 2~3글자로 잡으면 "김치찌개", "박수 쳐주세요"까지 걸린다.
// 그래서 오탐 케이스를 차단 케이스만큼 촘촘히 고정해둔다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { detectSensitive, withParticle } = require('../services/sensitiveInfo')

const blockedTypes = (t) => detectSensitive(t).blocked.map(b => b.type)
const warnTypes = (t) => detectSensitive(t).warnings.map(w => w.type)

// ── 차단: 주민등록번호 ─────────────────────────────────────────
test('주민등록번호는 하이픈 유무와 무관하게 차단된다', () => {
  assert.ok(blockedTypes('김철수 어르신 주민번호는 400312-1234567 입니다').includes('rrn'))
  assert.ok(blockedTypes('4003121234567').includes('rrn'))
})

test('주민등록번호처럼 안 생긴 13자리 숫자는 차단하지 않는다(월/일·성별자리 검사)', () => {
  // 월이 99, 일이 99 → 주민번호 형식 아님
  assert.ok(!blockedTypes('9999999999999').includes('rrn'))
  // 성별 자리가 9 → 주민번호 아님
  assert.ok(!blockedTypes('400312-9234567').includes('rrn'))
})

// ── 차단: 휴대폰 번호 ──────────────────────────────────────────
test('휴대폰 번호는 구분자와 무관하게 차단된다', () => {
  for (const t of ['010-1234-5678', '01012345678', '010 1234 5678', '011.234.5678']) {
    assert.ok(blockedTypes(`연락처 ${t} 로 연락주세요`).includes('phone'), `실패: ${t}`)
  }
})

// 아래 두 가지는 실제로 필터를 통과해버리던 우회 경로다.
// 스피커로는 똑같이 "공일공 일이삼사…"로 읽히므로 반드시 막아야 한다.
test('[우회 방지] 숫자 사이에 공백을 넣어도 휴대폰 번호로 차단된다', () => {
  assert.ok(blockedTypes('연락처 0 1 0 - 1 2 3 4 - 5 6 7 8 입니다').includes('phone'))
  assert.ok(blockedTypes('010 1234 5678').includes('phone'))
})

test('[우회 방지] 전각 숫자로 써도 차단된다', () => {
  assert.ok(blockedTypes('연락처 ０１０-１２３４-５６７８').includes('phone'))
  assert.ok(blockedTypes('주민번호 ４００３１２-１２３４５６７').includes('rrn'))
})

test('휴대폰이 아닌 숫자는 차단하지 않는다', () => {
  assert.ok(!blockedTypes('식사 인원은 105명입니다').includes('phone'))
  assert.ok(!blockedTypes('오후 3시 30분에 모이세요').includes('phone'))
})

// ── 차단: 생년월일 (핵심 오탐 방지) ────────────────────────────
test('[회귀] 오늘 날짜 안내는 절대 차단되지 않는다 — 매일 나가는 아침 방송', () => {
  const y = new Date().getFullYear()
  const text = `좋은 아침입니다, 어르신 여러분. 오늘은 ${y}년 8월 27일 수요일입니다.`
  assert.deepEqual(detectSensitive(text).blocked, [], '오늘 날짜가 막히면 아침 방송이 깨진다')
})

// 숫자 사이 구분자를 지우고 검사하므로, 평범한 숫자 표현이 붙어서 오탐이 나지 않는지 확인
test('[회귀] 날짜·시각이 붙은 문장이 번호로 오인되지 않는다', () => {
  const texts = [
    '오늘은 2026-08-27 목요일, 지금 시각은 10:30입니다.',
    '식사 인원은 105명, 참석은 1 2 3 명입니다.',
    '오후 3시 30분에 시작합니다.',
  ]
  for (const t of texts) {
    assert.deepEqual(detectSensitive(t).blocked, [], `오탐 발생: ${t}`)
  }
})

test('생년월일 맥락어가 있으면 차단된다', () => {
  assert.ok(blockedTypes('생년월일 1940년 3월 2일').includes('birth'))
  assert.ok(blockedTypes('생일이 1955-07-01 이신 어르신').includes('birth'))
})

test('맥락어가 없어도 명백한 과거 연도면 차단된다', () => {
  assert.ok(blockedTypes('1940년 3월 2일생 어르신').includes('birth'))
})

test('가까운 연도의 날짜는 맥락어가 없으면 차단하지 않는다(행사 안내 등)', () => {
  const y = new Date().getFullYear()
  assert.ok(!blockedTypes(`${y}년 9월 1일에 가을 행사가 있습니다`).includes('birth'))
  assert.ok(!blockedTypes(`${y - 1}년 12월 25일 성탄절 행사 사진`).includes('birth'))
})

// ── 경고: 이름 ────────────────────────────────────────────────
test('성씨+이름+호칭이면 경고한다', () => {
  assert.ok(warnTypes('김철수 어르신을 찾습니다').includes('name'))
  assert.ok(warnTypes('이영희 님 보호자분 오셨습니다').includes('name'))
  assert.ok(warnTypes('박민수 씨 면회 오셨습니다').includes('name'))
})

test('[오탐 방지] 일상 단어는 이름으로 잡지 않는다', () => {
  for (const t of [
    '오늘 점심은 김치찌개입니다',
    '다같이 박수 쳐주세요',
    '이번 주 일정을 안내드립니다',
    '정말 좋은 날씨입니다',
    '안전에 유의해 주시기 바랍니다',
  ]) {
    assert.deepEqual(warnTypes(t), [], `오탐 발생: ${t}`)
  }
})

// 아래 세 문장은 실제 자동방송 문구에서 실제로 오탐이 났던 것들이다.
// 헛경고가 반복되면 직원이 확인창을 습관적으로 눌러 진짜 이름을 놓치게 되므로 고정해둔다.
test('[오탐 방지] 실제 자동방송 문구가 이름으로 잡히지 않는다', () => {
  for (const t of [
    '좋은 아침입니다, 어르신 여러분. 오늘 하루도 활기차게 시작하겠습니다.',
    '선생님들께 안내드립니다. 식사 후 투약 시 반드시 어르신의 성함과 얼굴을 확인해 주세요.',
    '어르신 여러분, 잠시 후 점심 식사가 준비됩니다.',
  ]) {
    assert.deepEqual(warnTypes(t), [], `오탐 발생: ${t}`)
  }
})

test('이름은 경고일 뿐 차단하지 않는다 — 어르신 찾는 방송은 나가야 한다', () => {
  const r = detectSensitive('김철수 어르신을 찾습니다. 보신 분은 알려주세요.')
  assert.deepEqual(r.blocked, [])
  assert.ok(r.warnings.length > 0)
})

// ── 종합 ──────────────────────────────────────────────────────
test('차단과 경고가 함께 있으면 둘 다 보고한다', () => {
  const r = detectSensitive('김철수 어르신 연락처는 010-1234-5678 입니다')
  assert.ok(r.blocked.some(b => b.type === 'phone'))
  assert.ok(r.warnings.some(w => w.type === 'name'))
})

test('빈 값·비문자열은 조용히 빈 결과를 준다', () => {
  for (const v of ['', null, undefined, 123, {}]) {
    const r = detectSensitive(v)
    assert.deepEqual(r.blocked, [])
    assert.deepEqual(r.warnings, [])
  }
})

test('안내문 조사가 받침에 맞게 붙는다 — "이름이 / 휴대폰번호가"', () => {
  assert.equal(withParticle('이름', '이', '가'), '이름이')
  assert.equal(withParticle('휴대폰번호', '이', '가'), '휴대폰번호가')
})

test('차단 항목은 원본 전체를 그대로 담지 않는다(로그 유출 방지)', () => {
  const r = detectSensitive('010-1234-5678')
  const phone = r.blocked.find(b => b.type === 'phone')
  assert.ok(phone.label, '사람이 읽을 유형 이름이 있어야 한다')
  assert.ok(!/1234-5678/.test(JSON.stringify(phone)), '민감값 전체가 그대로 노출되면 안 된다')
})
