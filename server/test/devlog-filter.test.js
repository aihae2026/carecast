'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { parseCommit, isAutoHiddenScope, clampInt } = require('../services/devlogFilter')

test('parseCommit: 스코프가 있는 커밋 메시지에서 category/scope를 추출한다', () => {
  const r = parseCommit('feat(dev-console): 무언가 추가')
  assert.strictEqual(r.category, 'feat')
  assert.strictEqual(r.scope, 'dev-console')
})

test('parseCommit: 스코프가 없는 커밋은 scope가 null이다', () => {
  const r = parseCommit('fix: 버그 수정')
  assert.strictEqual(r.category, 'fix')
  assert.strictEqual(r.scope, null)
})

test('parseCommit: 타입 자체가 없는 커밋은 category/scope 모두 null이다', () => {
  const r = parseCommit('Merge branch dev')
  assert.strictEqual(r.category, null)
  assert.strictEqual(r.scope, null)
})

test('isAutoHiddenScope: dev-console 스코프는 자동 숨김 대상이다', () => {
  assert.strictEqual(isAutoHiddenScope('dev-console'), true)
})

test('isAutoHiddenScope: 다른 스코프나 값 없음은 숨김 대상이 아니다', () => {
  assert.strictEqual(isAutoHiddenScope('schedules'), false)
  assert.strictEqual(isAutoHiddenScope(null), false)
  assert.strictEqual(isAutoHiddenScope(undefined), false)
})

test('clampInt: 정상 정수는 그대로 통과한다', () => {
  assert.strictEqual(clampInt('50', 50, 1, 200), 50)
  assert.strictEqual(clampInt('120', 50, 1, 200), 120)
})

test('clampInt: 숫자가 아니거나 비어 있으면 기본값으로 떨어진다', () => {
  assert.strictEqual(clampInt(undefined, 50, 1, 200), 50)
  assert.strictEqual(clampInt('', 50, 1, 200), 50)
  assert.strictEqual(clampInt('abc', 50, 1, 200), 50)
})

test('clampInt: git 명령에 섞여 들어갈 수 있는 값도 정수로만 남는다', () => {
  // '50; rm -rf /' 같은 입력이 그대로 셸에 실리면 안 된다
  assert.strictEqual(clampInt('50; rm -rf /', 50, 1, 200), 50)
  assert.strictEqual(clampInt('--all', 50, 1, 200), 50)
})

test('clampInt: 범위를 벗어난 값은 잘라낸다', () => {
  assert.strictEqual(clampInt('9999', 50, 1, 200), 200)
  assert.strictEqual(clampInt('-5', 0, 0, 100), 0)
})
