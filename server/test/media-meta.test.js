'use strict'
// 음원·영상 목록의 작은 표시(길이·용량·올린 때) — **진짜 함수를 돌린다**.
//
// 소스 글자만 보는 검사로는 이 종류의 결함을 못 잡는다. 여기서 특히 지키는 것은 하나다:
// **모르는 것을 0으로 적지 않는다.** `duration` 은 업로드 직후 0이고(브라우저만 길이를 안다),
// `size_bytes` 는 파일이 지워졌으면 null 이다. 그것을 `0:00`·`0 MB` 로 적으면 목록에서
// "길이가 0인 파일"로 읽힌다 — 이 저장소에서 가장 비싼 실패가 조용한 오독이다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const SRC = path.join(__dirname, '..', '..', 'src', 'lib', 'mediaMeta.js')
// ESM 을 CJS 검사에서 돌리는 방법은 `media-browse.test.js` 와 같다.
const load = () => import('node:url').then(({ pathToFileURL }) => import(pathToFileURL(SRC).href))

test('길이: 분:초, 한 시간이 넘으면 시:분:초', async () => {
  const { 길이글 } = await load()
  assert.equal(길이글(7), '0:07')
  assert.equal(길이글(67), '1:07')
  assert.equal(길이글(187), '3:07')
  assert.equal(길이글(3723), '1:02:03')
})

test('길이: 모르는 것을 0:00 으로 적지 않는다', async () => {
  const { 길이글 } = await load()
  assert.equal(길이글(0), null, '0을 0:00으로 적으면 "길이 0인 파일"로 읽힌다')
  assert.equal(길이글(null), null)
  assert.equal(길이글(undefined), null)
  assert.equal(길이글('몰라'), null)
  assert.equal(길이글(-5), null)
})

test('길이: 반올림하지 않고 버린다 — 목록과 재생기가 어긋나 보이면 안 된다', async () => {
  const { 길이글 } = await load()
  assert.equal(길이글(59.7), '0:59', '59.7을 1:00으로 올리면 재생기와 갈린다')
  assert.equal(길이글(119.9), '1:59')
})

test('용량: 1024 로 센다 — 윈도 탐색기와 같은 숫자여야 한다', async () => {
  const { 용량글 } = await load()
  assert.equal(용량글(512), '512 B')
  assert.equal(용량글(2048), '2 KB')
  assert.equal(용량글(1024 * 1024), '1.0 MB')
  assert.equal(용량글(4.25 * 1024 * 1024), '4.3 MB')
  assert.equal(용량글(50 * 1024 * 1024), '50 MB', '10MB 넘으면 소수를 안 붙인다')
  assert.equal(용량글(2 * 1024 * 1024 * 1024), '2.0 GB')
})

test('용량: 모르는 것은 null — 0 MB 라고 하지 않는다', async () => {
  const { 용량글 } = await load()
  assert.equal(용량글(null), null)
  assert.equal(용량글(undefined), null)
  assert.equal(용량글('몰라'), null)
  assert.equal(용량글(-1), null)
  assert.equal(용량글(0), '0 B', '진짜 빈 파일은 0 B 가 맞다 — 모르는 것과 다르다')
})

test('올린 때: 오늘·어제는 시각, 올해는 월일, 지난해는 연도까지', async () => {
  const { 올린때글 } = await load()
  const 지금 = new Date(2026, 8, 12, 15, 0, 0)   // 2026-09-12 15:00
  assert.equal(올린때글(new Date(2026, 8, 12, 9, 4).toISOString(), 지금), '오늘 09:04')
  assert.equal(올린때글(new Date(2026, 8, 11, 22, 30).toISOString(), 지금), '어제 22:30')
  assert.equal(올린때글(new Date(2026, 2, 3, 8, 0).toISOString(), 지금), '3월 3일')
  assert.equal(올린때글(new Date(2025, 11, 25, 8, 0).toISOString(), 지금), '2025. 12. 25.')
  assert.equal(올린때글(null, 지금), null)
  assert.equal(올린때글('말이 안 되는 값', 지금), null)
})

test('작은 표시: 아는 것만 담는다 — 빈칸을 만들지 않는다', async () => {
  const { 작은표시 } = await load()
  const 지금 = new Date(2026, 8, 12, 15, 0, 0)
  const 올린때 = new Date(2026, 8, 12, 9, 4).toISOString()
  assert.deepEqual(작은표시({ duration: 187, size_bytes: 4.25 * 1024 * 1024, uploaded_at: 올린때 }, 지금),
    ['3:07', '4.3 MB', '오늘 09:04'])
  // 갓 올린 파일 — 길이를 아직 아무도 안 쟀다
  assert.deepEqual(작은표시({ duration: 0, size_bytes: 1024 * 1024, uploaded_at: 올린때 }, 지금),
    ['1.0 MB', '오늘 09:04'])
  // 유튜브 링크 — 우리 쪽에 파일이 없다
  assert.deepEqual(작은표시({ duration: 0, size_bytes: null, uploaded_at: 올린때 }, 지금),
    ['오늘 09:04'])
  assert.deepEqual(작은표시({}, 지금), [], '아무것도 모르면 아무것도 안 적는다')
  assert.deepEqual(작은표시(null, 지금), [])
})
