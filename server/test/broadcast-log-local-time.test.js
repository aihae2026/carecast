'use strict'
// **방송 로그의 「마지막 자동 정리」 시각은 이 PC 시각이다** (2026-09-17 브라우저 전수 시험)
//
// 서버는 `retention_last_run` 을 `toISOString()`(UTC) 으로 적는다(`services/retention.js`). 화면이 그 글자를
// 잘라 쓰면 한국에서는 **9시간 이른 시각**이 보인다 — 02:40 에 돈 정리가 「2026-09-16 17:40」으로 떴다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 화면 = fs.readFileSync(path.join(ROOT, 'src', 'components', 'admin', 'sections', 'BroadcastLog.jsx'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '')

test('서버가 UTC(ISO) 로 적는다 — 이 시험의 전제', () => {
  const 서버 = fs.readFileSync(path.join(ROOT, 'server', 'services', 'retention.js'), 'utf8')
  assert.match(서버, /writeSetting\(conn, KEYS\.lastRun, now\.toISOString\(\)\)/)
})

test('화면은 그 글자를 잘라 쓰지 않고 Date 로 풀어 이 PC 시각으로 보인다', () => {
  assert.match(화면, /retention\.at/, '긍정 앵커 — 마지막 정리 시각을 그리는 파일이다')
  assert.doesNotMatch(화면, /retention\.at\.slice\(/, 'UTC 글자를 잘라 쓴다 — 9시간 어긋난다')
  // 사람이 지운 기록도 같다(`routes/broadcasts.js` 가 `new Date().toISOString()` 으로 적는다)
  assert.doesNotMatch(화면, /String\(m\.at\)\.slice\(/, '수동 삭제 시각도 UTC 글자를 잘라 쓴다')
  assert.match(화면, /지역시각\(m\.at\)/)
  assert.match(화면, /지역시각\(retention\.at\)/)
  const 몸 = 화면.slice(화면.indexOf('function 지역시각('), 화면.indexOf('function daysAgoStr('))
  assert.match(몸, /new Date\(iso\)/)
  assert.match(몸, /getHours\(\)/, 'UTC 가 아니라 이 PC 시각(getHours)으로 적어야 한다')
  assert.doesNotMatch(몸, /getUTC/, 'UTC 로 적으면 고친 것이 아니다')
})
