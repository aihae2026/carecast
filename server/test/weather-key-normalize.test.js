// 공공데이터포털이 "인코딩"/"디코딩" 두 형태의 서비스키를 같이 발급하는데, URLSearchParams(자동 인코딩)와
// 문자열 템플릿(수동 인코딩)이 섞여 쓰이면서 "인코딩 키 + 자동 인코딩"이 겹쳐 이중 인코딩 401/403이 났던 버그.
// normalizeServiceKey()가 항상 디코딩(원본) 형태로 되돌려주는지, getKmaConfig()가 이를 실제로 적용하는지 검증.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_kmakey_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { normalizeServiceKey, getKmaConfig } = require('../services/weather')

// 픽스처는 **반드시 가짜 키**여야 한다.
//
// 2026-08-30까지 여기에 공공데이터포털 실서비스키가 그대로 박혀 있었다(server/.env의 KMA_* 4개와
// 문자열이 일치). 저장소가 비공개라 외부로 새지는 않았지만, 커밋 히스토리에는 영구히 남고
// 저장소를 공개로 바꾸거나 협업자를 추가하면 그대로 딸려간다. server/.env를 gitignore해 둔 의미도
// 없어진다 — 같은 값이 테스트 파일로 우회해 들어와 있었던 셈이다.
//
// 실키일 이유가 애초에 없다. normalizeServiceKey는 URL 인코딩을 되돌리는 순수 문자열 함수라,
// 아래 두 성질만 지키면 어떤 문자열이든 똑같이 검증된다.
//   · 디코딩하면 '/'가 나올 것  (%2F — 자동 인코딩과 겹쳐 이중 인코딩 401/403을 냈던 그 문자)
//   · 디코딩하면 '=='로 끝날 것 (%3D%3D — base64 패딩)
// 공공데이터포털 키와 같은 길이(base64 88자)로 맞춰 둔다.
const FAKE_KEY_ENCODED = 'DUMMYtestkeyNOTREAL0000000000000000%2F0000000000000000000000000000000000000000000000000%3D%3D'
const FAKE_KEY_DECODED = decodeURIComponent(FAKE_KEY_ENCODED)

test.before(() => {
  initDB()
})

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('normalizeServiceKey: 인코딩된 키(%2F, %3D%3D 포함)는 디코딩된 원본으로 돌아온다', () => {
  const encoded = FAKE_KEY_ENCODED
  const result = normalizeServiceKey(encoded)
  assert.equal(result, decodeURIComponent(encoded))
  assert.ok(result.includes('/'), '디코딩되면 / 문자가 그대로 있어야 한다')
  assert.ok(result.endsWith('=='), '디코딩되면 == 패딩이 그대로 있어야 한다')
})

test('normalizeServiceKey: 이미 디코딩된 키(원본, % 없음)는 그대로 반환한다', () => {
  const decoded = FAKE_KEY_DECODED
  assert.equal(normalizeServiceKey(decoded), decoded)
})

test('normalizeServiceKey: 빈 값은 빈 문자열을 반환한다', () => {
  assert.equal(normalizeServiceKey(''), '')
  assert.equal(normalizeServiceKey(null), '')
  assert.equal(normalizeServiceKey(undefined), '')
})

test('normalizeServiceKey: 잘못된 % 시퀀스가 있어도 예외 없이 원본을 반환한다', () => {
  const malformed = 'abc%zz123'
  assert.equal(normalizeServiceKey(malformed), malformed)
})

test('getKmaConfig: DB에 인코딩된 키가 저장돼 있어도 정규화(디코딩)된 값을 반환한다', () => {
  const db = getDB()
  const encoded = FAKE_KEY_ENCODED
  for (const key of ['kma_api_key', 'kma_apihub_key', 'kma_living_api_key']) {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, encoded)
  }
  const cfg = getKmaConfig()
  const decoded = decodeURIComponent(encoded)
  assert.equal(cfg.apiKey, decoded)
  assert.equal(cfg.apihubKey, decoded)
  assert.equal(cfg.livingApiKey, decoded)
})
