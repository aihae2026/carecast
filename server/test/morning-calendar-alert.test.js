// 아침방송의 캘린더 조회 실패가 아무에게도 전달되지 않는 것(CC-043).
//
// morning.js의 getMorningData()는 getTodayEvents()를 `try { ... } catch {}`로 감싸서,
// 캘린더 연동이 깨져도(토큰 만료·네트워크 오류) 오류 한 줄 없이 일정 안내만 조용히 빠진다.
// 직원은 "오늘은 일정이 없나 보다"라고 믿게 되는데, 이것이 이 시스템에서 가장 찾기 어려운
// 실패 유형이다 — services/alert.js가 존재하는 이유 그 자체(실패는 반드시 사람에게 전달).
//
// 기대 동작: 캘린더 조회 실패 시 최소한 console.error 로그와 alert.raise() 경보를 남긴다.
// getTodayEvents는 외부(구글) 의존이라 행동 테스트 대신 소스 대조로 고정한다
// (fetch-timeout.test.js·audio-backend.test.js와 같은 방식).
'use strict'

const path = require('path')
const fs = require('fs')

const test = require('node:test')
const assert = require('node:assert/strict')

const MORNING_PATH = path.join(__dirname, '..', 'services', 'morning.js')

test('getTodayEvents 실패를 삼키는 빈 catch가 없다', () => {
  const src = fs.readFileSync(MORNING_PATH, 'utf8')

  const callIdx = src.indexOf('await getTodayEvents')
  assert.ok(callIdx >= 0, '전제: getMorningData 안에 getTodayEvents 호출이 있어야 한다')

  // 호출 직후 500자 안의 catch 블록을 본다 — `} catch {}` / `} catch (e) {}` 류는 실격
  const after = src.slice(callIdx, callIdx + 500)
  assert.ok(!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(after),
    '캘린더 조회 실패가 빈 catch로 삼켜진다 — 일정 안내가 조용히 빠져도 아무도 모른다')
})

test('캘린더 조회 실패 시 alert.raise로 경보를 남긴다', () => {
  const src = fs.readFileSync(MORNING_PATH, 'utf8')

  assert.ok(/require\(['"](\.\/|\.\.\/services\/)alert['"]\)/.test(src),
    'morning.js가 경보 통로(services/alert.js)를 아예 부르지 않는다')

  const callIdx = src.indexOf('await getTodayEvents')
  assert.ok(callIdx >= 0, '전제: getTodayEvents 호출이 있어야 한다')
  const after = src.slice(callIdx, callIdx + 800)
  assert.ok(/\braise\s*\(/.test(after),
    'getTodayEvents의 catch에서 raise()를 부르지 않는다 — 실패가 DB·화면·로그 어디에도 남지 않는다')
  assert.ok(/console\.error/.test(after),
    'getTodayEvents의 catch에 console.error조차 없다')
})
