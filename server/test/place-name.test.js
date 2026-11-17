'use strict'
// **좌표 → 지역 이름**(초기 설정 시설 위치, 2026-09-18 밤). 네트워크는 안 나간다 — fetch 를 주입한다.
// 이용 규칙(초당 1건 · 앱 이름 밝힘 · 받아 두기 · 출처 표시)이 코드에서 빠지면 여기서 빨간불이 난다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const 모듈 = require('../services/placeName')

const 응답 = (address, status = 200) => async () => ({ ok: status === 200, status, json: async () => ({ address }) })
const 용산 = { quarter: '원효로2가', suburb: '원효로1동', borough: '용산구', city: '서울특별시', country: '대한민국' }
const 시골 = { village: '예시리', city: '예시군', province: '예시도', country: '대한민국' }

test('주소 조각을 「광역 시군구 동」 순서로 잇는다 — 서울·경기 실제 응답 모양', () => {
  assert.equal(모듈.이름짓기(용산), '서울특별시 용산구 원효로1동')
  assert.equal(모듈.이름짓기(시골), '예시도 예시군')
  assert.equal(모듈.이름짓기({ province: '경기도', city: '수원시', borough: '장안구', suburb: '조원동' }), '경기도 수원시 장안구 조원동')
  assert.equal(모듈.이름짓기({}), '')
})

test('이름을 돌려주고 출처(OpenStreetMap)를 함께 싣는다', async () => {
  모듈._비우기()
  const r = await 모듈.지역이름(37.5346, 126.9611, { fetchImpl: 응답(용산), 쉬기: async () => {} })
  assert.deepEqual(r, { ok: true, 이름: '서울특별시 용산구 원효로1동', 출처: '지역 이름 © OpenStreetMap 기여자' })
})

test('앱 이름을 밝히고(User-Agent) 한국어로 묻고 제한시간을 건다', async () => {
  모듈._비우기()
  let 본것 = null
  await 모듈.지역이름(37.2, 126.9, { fetchImpl: async (url, opts) => { 본것 = { url, opts }; return 응답(시골)() }, 쉬기: async () => {} })
  assert.match(본것.url, /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/)
  assert.match(본것.url, /accept-language=ko/)
  assert.match(본것.opts.headers['User-Agent'], /^CareCast\//)
  assert.ok(본것.opts.signal instanceof AbortSignal, '제한시간이 없다 — 응답이 없으면 화면이 멈춘다')
})

test('같은 곳은 다시 묻지 않는다(받아 두기)', async () => {
  모듈._비우기()
  let 횟수 = 0
  const f = async () => { 횟수++; return 응답(용산)() }
  await 모듈.지역이름(37.5346, 126.9611, { fetchImpl: f, 쉬기: async () => {} })
  await 모듈.지역이름(37.5347, 126.9612, { fetchImpl: f, 쉬기: async () => {} })   // 약 10m 차이
  assert.equal(횟수, 1)
})

test('연달아 누르면 1.1초 간격을 지킨다(초당 1건 규칙)', async () => {
  모듈._비우기()
  let 시계 = 10_000
  const 쉰것 = []
  const 옵션 = { fetchImpl: 응답(용산), 지금: () => 시계, 쉬기: async (ms) => { 쉰것.push(ms); 시계 += ms } }
  await 모듈.지역이름(37.10, 127.10, 옵션)
  시계 += 300
  await 모듈.지역이름(35.10, 129.10, 옵션)
  assert.deepEqual(쉰것, [800])
})

test('동시에 온 3건은 1.1초씩 차례로 나간다 — 한꺼번에 깨어나지 않는다(코드 검수 재현 0·1115·1115)', async () => {
  모듈._비우기()
  const 쉰것 = []
  const 옵션 = { fetchImpl: 응답(용산), 지금: () => 50_000, 쉬기: async (ms) => { 쉰것.push(ms) } }
  await Promise.all([
    모듈.지역이름(36.1, 127.1, 옵션),
    모듈.지역이름(36.2, 127.2, 옵션),
    모듈.지역이름(36.3, 127.3, 옵션),
  ])
  assert.deepEqual(쉰것, [1100, 2200])
})

test('같은 곳을 동시에 물으면 바깥 조회는 한 번이다', async () => {
  모듈._비우기()
  let 횟수 = 0
  const 옵션 = { fetchImpl: async () => { 횟수++; return 응답(용산)() }, 쉬기: async () => {} }
  const [가, 나] = await Promise.all([모듈.지역이름(37.5346, 126.9611, 옵션), 모듈.지역이름(37.5346, 126.9611, 옵션)])
  assert.equal(횟수, 1)
  assert.equal(가.이름, 나.이름)
})

test('빈 칸은 (0,0) 으로 새지 않는다 — 바깥으로 안 나간다', async () => {
  모듈._비우기()
  const 옵션 = { fetchImpl: async () => { throw new Error('불리면 안 된다') }, 쉬기: async () => {} }
  for (const [la, lo] of [['', ''], [' ', '127'], [undefined, 127], ['37', null]]) {
    const r = await 모듈.지역이름(la, lo, 옵션)
    assert.equal(r.ok, false, `${la},${lo}`)
    assert.match(r.msg, /비어/)
  }
})

test('실패해도 던지지 않고 이유를 말한다 — 좌표 저장을 막지 않는다', async () => {
  모듈._비우기()
  const 실패 = await 모듈.지역이름(37.3, 127.3, { fetchImpl: 응답(용산, 503), 쉬기: async () => {} })
  assert.equal(실패.ok, false)
  assert.match(실패.msg, /503/)
  const 끊김 = await 모듈.지역이름(37.4, 127.4, { fetchImpl: async () => { throw new TypeError('fetch failed') }, 쉬기: async () => {} })
  assert.equal(끊김.ok, false)
  const 이상 = await 모듈.지역이름('abc', 127, { fetchImpl: async () => { throw new Error('불리면 안 된다') } })
  assert.equal(이상.ok, false)
})

test('초기 설정 화면이 이름·관측소·출처를 보이고, 오차 안내를 적는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/components/admin/sections/SetupWizard.jsx'), 'utf8')
  assert.match(src, /getPlaceName\(좌표\.la, 좌표\.lo\)/, '지역 이름을 안 묻는다')
  assert.match(src, /자외선 관측소 \$\{uv\.이름\}/, '관측소를 안 보인다')
  assert.match(src, /\{지역\.출처\}/, 'OpenStreetMap 출처를 안 보인다(ODbL 조건)')
  assert.match(src, /위치에 오차가 있다면 설정 → AI · API 연동에서 위도·경도를 직접 입력해 주세요/)
  assert.match(src, /setTimeout\(\(\) => \{\s*getPlaceName\([^)]*\)[\s\S]{0,300}?\}, 800\)/, '칠 때마다 묻는다 — 이용 규칙(자동 완성 금지)')
  const 라우트 = fs.readFileSync(path.join(__dirname, '..', 'routes/settings.js'), 'utf8')
  assert.match(라우트, /router\.get\('\/place-name'/, '서버 창구가 없다')
})
