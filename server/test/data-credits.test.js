'use strict'
// **공공데이터 출처를 화면에 밝힌다** (사용자 지시 2026-09-16).
//
// ── 왜 시험으로 고정하나 ───────────────────────────────────────────────────
// 이것은 미관이 아니라 **지켜야 하는 조건**이다. 우리가 쓰는 공공데이터는 전부
// 공공누리(KOGL) 아래에 있고 **네 유형 모두 「출처표시」가 필수**다.
//
// 그런데 2026-09-16 까지 **화면 어디에도 없었다.** 조사로 유형을 확인하고 나서야
// 알았다 — 지켜야 할 것 중 **가장 간단한 것**을 안 지키고 있었다.
//
// 이런 것은 화면을 손보다 **조용히 사라지기 쉽다**(한 줄짜리 작은 글씨다). 그래서
// 사라지면 빨간불이 나게 한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { 출처들 } = require('../../src/lib/dataCredits.js')

test('**우리가 실제로 부르는 기관이 전부 적혀 있다**', () => {
  // 코드가 부르는 주소에서 기관을 되짚는다 — 목록을 손으로 맞추면 한쪽만 바뀐다.
  const weather = fs.readFileSync(path.join(ROOT, 'server/services/weather.js'), 'utf8')
  const 적힌기관 = 출처들.map(s => s.기관).join(' ')

  // `1360000` 은 data.go.kr 의 **기상청** 기관코드다.
  if (weather.includes('/1360000/')) {
    assert.match(적힌기관, /기상청/, '기상청 데이터를 쓰는데 출처에 없다')
  }
  // `B552584` 는 **한국환경공단**(에어코리아) 기관코드다.
  if (weather.includes('/B552584/')) {
    assert.match(적힌기관, /한국환경공단|에어코리아/, '에어코리아 데이터를 쓰는데 출처에 없다')
  }
  assert.ok(출처들.length >= 3, `출처가 ${출처들.length}건뿐이다 — 셋(단기예보·생활기상지수·대기질)은 있어야 한다`)
})

test('**이용 조건까지 적는다** — 기관 이름만으로는 다음 사람이 다시 조사한다', () => {
  for (const s of 출처들) {
    assert.ok(s.조건 && s.조건.length > 4, `${s.기관} 의 이용 조건이 비었다`)
  }
})

test('**변경금지인 것은 그렇다고 적는다** — 그 한 줄이 나중에 사람을 멈춰 세운다', () => {
  // 에어코리아 대기오염정보는 **제3유형(출처표시 + 변경금지)** 이다(2026-09-16 원문 확인).
  // 지금은 그쪽이 준 등급 코드를 그쪽 이름 그대로 옮길 뿐이라 문제가 없지만,
  // 누군가 그 값을 우리 기준으로 다시 나누려 할 때 이 표기가 근거가 된다.
  const 대기질 = 출처들.find(s => /에어코리아|환경공단/.test(s.기관))
  assert.ok(대기질, '대기질 출처가 목록에 없다')
  assert.match(대기질.조건, /변경금지/,
    '대기오염정보가 변경금지(제3유형)라는 사실이 안 적혀 있다')
})

test('**등급을 우리가 매기지 않는다** — 변경금지를 지키는 근거다', () => {
  // 이 시험이 지키는 것: 누군가 `DUST_GRADE` 를 우리 기준으로 다시 나누면 빨간불.
  const codes = fs.readFileSync(path.join(ROOT, 'server/domain/weatherCodes.js'), 'utf8')
  const i = codes.indexOf('const DUST_GRADE')
  assert.ok(i > 0, 'DUST_GRADE 를 못 찾았다 — 이 시험의 전제가 무너졌다')
  const 줄 = codes.slice(i, codes.indexOf('\n', i))

  // 에어코리아가 주는 코드는 **1~4 넷**이고, 우리는 그것을 **이름만** 붙인다.
  assert.match(줄, /'1':\s*'좋음'/, '1 등급의 이름이 바뀌었다')
  assert.match(줄, /'4':\s*'매우나쁨'/, '4 등급의 이름이 바뀌었다')
  // 숫자 비교가 들어오면 **우리가 다시 나누는 것**이다.
  assert.ok(!/[<>]=?/.test(줄),
    'DUST_GRADE 에 크기 비교가 생겼다 — 등급을 우리 기준으로 다시 나누면 변경금지에 걸린다')
})

test('**화면에 실제로 달려 있다** — 파일만 만들고 안 쓰면 안 밝힌 것이다', () => {
  // ── 자리가 옮겨졌다 (사용자 지시 2026-09-16) ──────────────────────────────
  // *"데이터 출처 저기다 집어넣으니까 뭔가 이상하잖아. 그냥 따로 시스템 운영 메뉴
  //   하나로 빼면 안될까?"* — 사이드바 **푸터**에서 **제 메뉴**로 옮겼다.
  // 지키는 것은 그대로다: **어딘가에서 실제로 보여야 한다.**
  const 사이드바 = fs.readFileSync(path.join(ROOT, 'src/components/admin/Sidebar.jsx'), 'utf8')
  assert.match(사이드바.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    /id: 'dataCredits'/, '사이드바에 「데이터 출처」 메뉴가 없다 — 들어갈 길이 없다')

  const 지도 = fs.readFileSync(path.join(ROOT, 'src/pages/AdminMode.jsx'), 'utf8')
  assert.match(지도, /dataCredits:\s*\{ Component: DataCreditsPage/,
    '메뉴는 있는데 그릴 화면이 없다 — 누르면 대시보드로 떨어진다')

  const 화면 = fs.readFileSync(path.join(ROOT, 'src/components/admin/sections/DataCreditsPage.jsx'), 'utf8')
  assert.match(화면, /출처들\.map\(/, '그 화면이 목록을 안 그린다')
})

test('**부품이 그 목록을 그대로 그린다** — 적어만 두고 안 그리면 소용없다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/shared/DataCredits.jsx'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(코드만, /출처들\.map\(/, '목록을 돌지 않는다')
  assert.match(코드만, /\{s\.기관\}/, '기관을 안 그린다')
  assert.match(코드만, /\{s\.조건\}/, '이용 조건을 안 그린다')
  // **목록을 화면에 다시 적지 않는다** — 두 벌이 되면 한쪽만 고쳐진다.
  assert.ok(!코드만.includes("기관: '기상청'"), '화면이 목록을 따로 들고 있다')
})
