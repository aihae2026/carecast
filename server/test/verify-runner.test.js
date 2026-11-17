'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { summarizeVerifyResult } = require('../services/verifyRunner')

test('summarizeVerifyResult: 에러가 없으면 auto_verified로 판정한다', () => {
  const r = summarizeVerifyResult(null, '... PASS ...', '')
  assert.strictEqual(r.result, 'auto_verified')
})

test('summarizeVerifyResult: 에러가 있으면 failed로 판정한다', () => {
  const r = summarizeVerifyResult(new Error('Command failed'), '', 'FAIL something')
  assert.strictEqual(r.result, 'failed')
})

test('summarizeVerifyResult: note는 출력의 마지막 15줄만 담는다', () => {
  const longOutput = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n')
  const r = summarizeVerifyResult(null, longOutput, '')
  assert.strictEqual(r.note.split('\n').length, 15)
  assert.strictEqual(r.note.split('\n')[14], 'line49')
})

test('summarizeVerifyResult: 출력이 비어있어도 빈 note를 남기지 않는다', () => {
  const passed = summarizeVerifyResult(null, '', '')
  assert.strictEqual(passed.note, 'npm run verify 통과')
  const failed = summarizeVerifyResult(new Error('x'), '', '')
  assert.strictEqual(failed.note, 'npm run verify 실패')
})
