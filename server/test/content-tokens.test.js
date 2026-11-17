// 문안 토큰 사전과 가변/정적 판정 — 추측을 두지 않는다.
//
// 왜 이 파일이 있나: 렌더 시점(정적=등록 즉시 1회, 가변=T-10분)과 폴백 정책(가변은 이전
// 캐시 재사용 금지)이 **이 판정 하나**에 달려 있다. 낱말로 추정하면 오판이 조용히 어제
// 날씨를 방송한다 — 무인 운영에는 정정할 사람이 없다. 그래서 판정은 정규식 한 번이고,
// 같은 문안은 언제 봐도 같은 답이 나와야 한다.
'use strict'

// ── **임시 DB 를 제품 모듈보다 먼저 정한다** (2026-09-14 전수 확인) ─────────────────
// 이 파일이 부르는 제품 모듈이 어딘가에서 `getDB()` 를 부른다. 경로를 안 정하면 그 읽기가
// **기본 경로의 DB** 로 간다 — 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를
// 돌리면 운영 DB** 를 연다(없으면 새로 만들기까지 한다). `db/schema.js` 는 로드 시점에
// 경로를 굳히므로 **`require` 보다 위**여야 한다. 이름은 `_` 로 시작한다 — 아래에서 같은
// 모듈을 다시 부르는 파일이 있어 부딪히면 안 된다.
process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_content_tokens_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')

const {
  TOKENS, TOKEN_RE, listTokens, findTokens, unknownTokens,
  classifyContent, hasTimeToken, isVariable,
} = require('../domain/contentTokens')

test('토큰 사전이 단일 출처다 — 화면·치환기·판정기가 같은 목록을 본다', () => {
  const names = listTokens().map((t) => t.name)
  for (const 필수 of ['날씨', '기온', '미세먼지', '날짜', '요일', '시각']) {
    assert.ok(names.includes(필수), `${필수} 토큰이 사전에 있어야 한다`)
  }
  // 사전에 있는 모든 토큰은 스스로 정규식에 걸려야 한다 — 사전과 정규식이 갈리면
  // "목록에는 있는데 저장이 거부되는" 토큰이 생긴다.
  for (const t of listTokens()) {
    assert.deepEqual(findTokens(`앞 {{${t.name}}} 뒤`), [t.name], `${t.name} 이 정규식에 안 걸린다`)
  }
})

test('판정은 정규식 한 번 — 낱말 추정이 없다', () => {
  // "날씨"라는 낱말이 있어도 토큰이 없으면 정적이다
  assert.equal(classifyContent('오늘 날씨가 좋습니다. 산책 나가세요.'), 'manual')
  assert.equal(classifyContent('점심 식사 시간입니다.'), 'manual')
  // 토큰이 하나라도 있으면 가변이다
  assert.equal(classifyContent('오늘은 {{날씨}} 입니다.'), 'manual_template')
  assert.equal(classifyContent('{{날짜}} {{요일}} 안내드립니다.'), 'manual_template')
  // 빈 문안은 정적으로 본다(렌더할 것이 없다)
  assert.equal(classifyContent(''), 'manual')
  assert.equal(classifyContent(null), 'manual')
})

test('같은 문안은 몇 번을 판정해도 같은 답이다', () => {
  const 문안 = '오늘 {{날짜}} 날씨는 {{날씨}} 입니다.'
  const 답들 = new Set()
  for (let i = 0; i < 50; i++) 답들.add(classifyContent(문안))
  assert.equal(답들.size, 1, '판정이 흔들리면 렌더 시점이 흔들린다')
})

test('알 수 없는 토큰을 집어낸다 — 저장 거부의 근거', () => {
  assert.deepEqual(unknownTokens('{{날씨}} 입니다'), [])
  assert.deepEqual(unknownTokens('{{날시}} 입니다'), ['날시'])
  assert.deepEqual(unknownTokens('{{날씨}}와 {{습도}}'), ['습도'])
  // 공백이 섞여도 같은 토큰으로 본다 — 사람이 손으로 치는 자리다
  assert.deepEqual(unknownTokens('{{ 날씨 }} 입니다'), [])
})

test('{{시각}} 토큰은 유예 30초의 유일한 근거다 — 낱말로 추정하지 않는다', () => {
  assert.equal(hasTimeToken('지금 시각은 {{시각}} 입니다.'), true)
  // "시각"이라는 낱말만 있는 것은 아니다
  assert.equal(hasTimeToken('시각을 확인해 주세요.'), false)
  assert.equal(hasTimeToken('{{날씨}} 입니다.'), false)
})

test('isVariable — 가변이면 이전 캐시를 못 쓰는 그 판정이다', () => {
  assert.equal(isVariable('manual'), false)
  // settings 의 고정 문안(자동 5종 중 체조·점심·저녁·저녁 마무리)도 정적이다.
  // 이게 빠져 있으면 정적 4종이 매일 재합성된다 — 2026-09-06에 실제로 빠져 있었다.
  assert.equal(isVariable('system_static'), false)
  assert.equal(isVariable('manual_template'), true)
  assert.equal(isVariable('system_template'), true)
  // llm 은 외부 데이터 참조 여부로 갈린다. 모르면 **가변으로 본다** —
  // 틀린 정보를 확신 있게 말하느니 다시 만드는 편이 낫다.
  assert.equal(isVariable('llm'), true)
  // 모르는 값도 가변으로 본다(안전한 쪽)
  assert.equal(isVariable('알수없음'), true)
  assert.equal(isVariable(null), true)
})

test('TOKEN_RE 는 여러 번 써도 같은 결과를 낸다 — lastIndex 함정 없음', () => {
  const s = '{{날씨}} {{기온}}'
  const 첫번째 = s.match(TOKEN_RE)
  const 두번째 = s.match(TOKEN_RE)
  assert.deepEqual(첫번째, 두번째)
  assert.equal(findTokens(s).length, 2)
  assert.equal(findTokens(s).length, 2)   // 두 번 불러도 같아야 한다
})

test('사전에 각 토큰의 설명과 예시가 있다 — 화면 칩이 이걸 그대로 쓴다', () => {
  for (const t of listTokens()) {
    assert.equal(typeof t.name, 'string')
    assert.ok(t.label && t.label.length > 0, `${t.name}: 화면에 보일 이름이 있어야 한다`)
    assert.ok(t.example && t.example.length > 0, `${t.name}: 예시가 있어야 한다`)
  }
  assert.ok(TOKENS && typeof TOKENS === 'object')
})

test('기존 예약 분류 — managed_by 두 값이 서로 다른 뜻이다', () => {
  const { classifyExistingSchedule } = require('../domain/contentTokens')
  // 자동방송순서편집기가 소유한 행 = 시스템 서식
  assert.equal(classifyExistingSchedule({ content: '점심입니다', managed_by: 'morning_editor' }), 'system_template')
  // 자연어 초안에서 승인돼 만들어진 행 = LLM 문안. system_template 이 아니다.
  assert.equal(classifyExistingSchedule({ content: '점심입니다', managed_by: 'ai' }), 'llm')
  // 사람이 손으로 만든 행
  assert.equal(classifyExistingSchedule({ content: '점심입니다', managed_by: null }), 'manual')
  assert.equal(classifyExistingSchedule({ content: '점심입니다' }), 'manual')
  // 토큰이 있으면 managed_by 보다 앞선다 — 가변인 것이 먼저다
  assert.equal(classifyExistingSchedule({ content: '{{날씨}}', managed_by: 'ai' }), 'manual_template')
  assert.equal(classifyExistingSchedule({ content: '{{날씨}}', managed_by: 'morning_editor' }), 'manual_template')
})

test('허용되는 managed_by 값은 둘뿐이다 — 코드와 분류기가 갈리지 않게 고정', () => {
  const { MANAGED_BY_VALUES } = require('../services/scheduleStore')
  assert.deepEqual([...MANAGED_BY_VALUES].sort(), ['ai', 'morning_editor'])
})

test('마이그레이션 SQL 과 schema.js 가 같은 분류를 쓴다 — 두 곳이 갈리면 조용히 어긋난다', () => {
  const fs = require('fs')
  const path = require('path')
  const root = path.join(__dirname, '..', '..')
  for (const f of ['db/migrations/0024_broadcast_pipeline.sql', 'server/db/schema.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8')
    assert.match(src, /managed_by = 'morning_editor'/, `${f}: morning_editor 분기가 없다`)
    assert.match(src, /'llm'/, `${f}: ai → llm 분기가 없다`)
  }
})
