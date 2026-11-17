// 아침 안내 조각을 둘로 나누는 규칙 — 07:50 임계 구간에서 무엇을 미리 만들 수 있나.
//
// 왜 이 테스트가 있나: 현장은 07:49 부팅 → 07:50 방송이다. 그 60초 안에 아침 안내문
// 전부를 합성하면 늦는다. 날짜·인사는 **외부 API 를 안 기다려도 문안이 정해지므로** 더
// 일찍 만들어 둘 수 있고, 그러면 임계 구간에 남는 것은 날씨 문장 하나다.
// (합성 자체는 어느 조각이든 네트워크를 쓴다 — 가르는 것은 "문안이 언제 정해지는가"다.)
// 이 분류가 틀리면 그 이점이 사라지거나 **어제 날씨가 나간다**(외부 조각을 고정으로 오분류).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const {
  SEGMENT_KIND, isKnownEarly, splitSegments, gapMs, GAP_DEFAULT_MS, GAP_SETTING_KEY,
} = require('../domain/morningSegments')

test('외부 API 를 안 기다려도 문안이 정해지는 조각 — 인사·날짜·글귀', () => {
  for (const id of ['greeting', 'date', 'quote']) {
    assert.equal(isKnownEarly(id), true, `${id} 는 시계만 보므로 미리 만들 수 있다`)
  }
})

test('외부 데이터를 보는 조각은 미리 못 만든다 — 여기 틀리면 어제 날씨가 나간다', () => {
  for (const id of ['weather', 'dust', 'alert', 'schedule']) {
    assert.equal(isKnownEarly(id), false, `${id} 를 미리 만들면 옛 데이터가 방송된다`)
  }
})

test('모르는 조각은 **외부로 본다** — 안전한 쪽', () => {
  assert.equal(isKnownEarly('새로운조각'), false)
  assert.equal(isKnownEarly(undefined), false)
})

test('나눌 때 순서가 유지된다 — "오늘은 9월 6일" 다음에 날씨가 와야 말이 된다', () => {
  const { early, external } = splitSegments(['date', 'weather', 'dust', 'alert', 'schedule'])
  assert.deepEqual(early, ['date'])
  assert.deepEqual(external, ['weather', 'dust', 'alert', 'schedule'])
})

test('간격은 설정으로 맞춘다 — 현장에서 들어보고 바로 고칠 수 있어야 한다', () => {
  assert.equal(gapMs(() => '500'), 500)
  assert.equal(gapMs(() => '0'), 0, '0 이면 간격 없이 이어진다')
  // 이상한 값에 방송이 멈추면 안 된다
  assert.equal(gapMs(() => 'abc'), GAP_DEFAULT_MS)
  assert.equal(gapMs(() => '-100'), GAP_DEFAULT_MS)
  assert.equal(gapMs(() => '999999'), 3000, '너무 길면 방송이 늘어진다 — 잘라 낸다')
  assert.equal(gapMs((k, d) => d), GAP_DEFAULT_MS)
})

test('실행부가 이 분류를 실제로 쓴다 — 안 쓰면 나눈 의미가 없다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  assert.match(src, /require\('\.\.\/domain\/morningSegments'\)/, '분류를 안 읽고 있다')
  assert.match(src, /splitSegments\(ids\)/)
  // 예전처럼 통째로 이어 붙이는 코드가 남아 있으면 안 된다(둘 다 있으면 어느 쪽이 도는지 모른다)
  assert.doesNotMatch(src, /segmentTexts\(db, \['date', 'weather'/,
    '옛 경로(조각을 한 번에 합성)가 남아 있다')
})

test('되돌리는 법이 코드에 적혀 있다 — 현장에서 어색하다고 하면 바로 판단해야 한다', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  assert.match(src, /되돌리는 법/, '되돌리는 방법이 안 적혀 있다')
  assert.ok(src.includes(GAP_SETTING_KEY), '간격 설정 키를 주석에 안 남겼다')
})

test('SEGMENT_KIND 는 morning.js 가 실제로 만드는 조각을 덮는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'morning.js'), 'utf8')
  // buildSegmentText 의 case 목록을 뽑아 분류표와 대조한다 — 새 조각이 생기면 여기서 걸린다
  const ids = [...src.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1])
  const 관심 = ['greeting', 'date', 'weather', 'dust', 'alert', 'schedule', 'quote']
  for (const id of 관심) {
    if (!ids.includes(id)) continue
    assert.ok(id in SEGMENT_KIND, `morning.js 에 있는 조각 '${id}' 가 분류표에 없다`)
  }
})
