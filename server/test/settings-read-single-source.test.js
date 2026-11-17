// settings 표를 읽는 문장이 다시 흩어지지 않게 막는다(TD-13).
//
// 왜 필요했나: TD-04에서 `getSetting`이라는 **이름을 가진** 사본 12벌을 domain/settingsRead로
// 모았다. 그런데 인벤토리가 이름 있는 것만 셌기 때문에, 같은 조회가 인라인으로 31곳 더
// 남아 있었다. 흩어져 있으면 사용자가 정한 읽기 실패 규칙("설정 하나 때문에 방송이 멈추면
// 안 된다 — 대신 흔적은 남긴다")이 그 자리들에는 적용되지 않는다.
//
// 이 테스트는 목록을 세지 않는다. **허용된 자리 밖에 있으면 실패**시킨다 — 개수를 세면
// 새로 하나 늘고 하나 줄었을 때 통과해 버린다.
'use strict'

const fs   = require('fs')
const path = require('path')
const test   = require('node:test')
const assert = require('node:assert/strict')

const SERVER = path.join(__dirname, '..')

// 여기만 인라인 조회가 남아 있어도 된다. 각각 이유가 있다.
const ALLOWED = new Map([
  // 읽기의 단일 출처 그 자체
  ['domain/settingsRead.js', '읽기를 실제로 수행하는 곳'],
  // 아래 넷은 **행이 있느냐**를 묻는다. rawSetting은 "값 또는 null"을 주므로 값이 빈
  // 문자열일 때 판정이 뒤집힌다. 이 자리들은 1회성 시딩·보정의 재실행 여부를 가르기 때문에
  // 뒤집히면 사용자가 조정한 값이 지워지거나 현장 DB가 다시 고쳐진다.
  ['db/schema.js', '부팅 시딩 — if (!row) 형태의 행 존재 검사'],
  ['config/mealFlowAnchorFix.js', '1회성 보정 완료 마커 — 행 존재 검사'],
  ['config/siteBaseline.js', 'SELECT 1 존재 확인(값을 읽지 않는다)'],
])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test' || e.name === 'public') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

test('settings 읽기 문장이 허용된 자리 밖에 없다', () => {
  const offenders = []
  for (const file of walk(SERVER)) {
    const rel = path.relative(SERVER, file).split(path.sep).join('/')
    if (ALLOWED.has(rel)) continue
    const src = fs.readFileSync(file, 'utf8')
    src.split(/\r?\n/).forEach((line, i) => {
      if (/SELECT\s+(value|1)\s+FROM\s+settings/i.test(line)) offenders.push(`${rel}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [],
    `settings를 직접 읽고 있다 — domain/settingsRead의 rawSetting/rawSettings를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('허용 목록이 실제로 존재하는 파일만 가리킨다', () => {
  for (const rel of ALLOWED.keys()) {
    assert.ok(fs.existsSync(path.join(SERVER, rel)), `허용 목록에 죽은 경로가 있다: ${rel}`)
  }
})
