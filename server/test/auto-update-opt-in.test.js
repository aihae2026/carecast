'use strict'
// **자동 업데이트는 켜겠다고 적은 PC 에서만 돈다** (공개판 검수 지적 4, 2026-10-17).
//
// 공개 저장소를 README 대로 `git clone` 하면 main 가지다. 예전 판은 그 PC 를 현장으로 보고 10분마다
// `git checkout -- .` → `git pull origin main` → 재시작을 했다 — 받아 쓰는 사람이 고친 파일이 조용히
// 지워지고, 상류의 새 코드가 동의 없이 실행된다. 이 시험은 「기본 꺼짐」과 「켜는 길 두 개」를 고정한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const { 자동업데이트켜짐 } = require('../services/autoUpdate')

test('아무것도 안 적으면 꺼져 있다 — clone 만 한 PC 가 스스로 당겨 오지 않는다', () => {
  assert.equal(자동업데이트켜짐({ env: {}, 설정값: null }), false)
  assert.equal(자동업데이트켜짐({ env: {}, 설정값: '' }), false)
  assert.equal(자동업데이트켜짐({ env: { CARECAST_AUTO_UPDATE: '0' }, 설정값: '0' }), false)
  assert.equal(자동업데이트켜짐({ env: {}, 설정값: '아무거나' }), false, '모르는 값을 켬으로 읽었다')
})

test('설정 값이나 환경변수로 켤 수 있다', () => {
  assert.equal(자동업데이트켜짐({ env: {}, 설정값: '1' }), true)
  assert.equal(자동업데이트켜짐({ env: {}, 설정값: ' true ' }), true)
  assert.equal(자동업데이트켜짐({ env: { CARECAST_AUTO_UPDATE: '1' }, 설정값: null }), true)
})

test('켜는 스위치가 실제로 시작 경로 맨 앞에서 걸린다 — 가지 판정보다 먼저', () => {
  const src = 읽기('server/services/autoUpdate.js')
  const i = src.indexOf('module.exports = function startAutoUpdate')
  assert.ok(i > 0, 'startAutoUpdate 를 못 찾았다')
  const 몸 = src.slice(i, src.indexOf('\n}', i))
  const 스위치 = 몸.indexOf('자동업데이트켜짐()')
  const 가지 = 몸.indexOf('git rev-parse --abbrev-ref HEAD')
  assert.ok(스위치 > 0, '시작 경로가 켜짐 여부를 안 본다')
  assert.ok(가지 > 스위치, '가지를 먼저 보고 켜짐 여부를 나중에 본다 — 꺼져 있어도 git 을 부른다')
  assert.match(몸.slice(스위치, 가지), /return/, '꺼져 있을 때 멈추지 않는다')
})

test('켜는 법이 .env 예시·임포트 표·README 에 같은 이름으로 있다', () => {
  const { ENV_TO_SETTING_KEY } = require('../config/importEnvSettings')
  assert.equal(ENV_TO_SETTING_KEY.AUTO_UPDATE_ENABLED, 'auto_update_enabled')
  assert.match(읽기('server/.env.example'), /^AUTO_UPDATE_ENABLED=$/m, '.env 예시에 켜는 칸이 없거나 미리 켜져 있다')
  const readme = 읽기('README.md')
  assert.match(readme, /AUTO_UPDATE_ENABLED=1/, 'README 에 켜는 법이 없다')
  assert.match(readme, /기본(으로)? 꺼져/, 'README 가 기본 꺼짐을 말하지 않는다')
})
