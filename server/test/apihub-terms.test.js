'use strict'
// **기상청 API허브 약관을 지키는 근거를 고정한다** (2026-09-16 조사).
//
// ── 왜 이 시험이 있나 ──────────────────────────────────────────────────────
// `apihub.kma.go.kr` 는 `apis.data.go.kr` 와 **다른 서비스이고 약관도 따로**다.
// 2026-09-16 에 원문(`https://apihub.kma.go.kr/policy.do`)을 읽었고, 우리에게 걸리는
// 조항은 없었다. 다만 **「걸리지 않는다」가 코드의 어떤 사실에 기대고 있는지**가
// 문제다 — 그 사실이 조용히 바뀌면 약관 위반이 되는데 빨간불은 안 난다.
//
//   제11조 5항 ⑫  "주기적/지속적인 접속을 시도하여 과부하를 발생시키는 … 행위"
//   제11조 5항 ⑬  "제공 한도를 초과하여 서비스를 이용하는 행위"
//   제5조  3항    "하나의 어플리케이션 등에는 하나의 인증키만이 발급될 수 있습니다"
//
// 우리가 그것을 지키는 근거는 **캐시 하나**다. 화면이 아무리 자주 물어도 서버는
// 10분에 한 번만 API허브를 부른다. 그러니 **캐시가 짧아지거나, 타이머가 캐시를
// 비우기 시작하면** 호출량이 곧바로 늘어난다.
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
//   1) `CACHE_TTL` 이 10분 아래로 내려가지 않는다 (호출 상한의 근거).
//   2) 캐시를 비우는 파일 어디에도 **타이머가 없다** — 비우는 것은 사람이 누를 때뿐이다.
//   3) API허브 인증키를 **설정 이름 하나**로만 읽는다 (제5조 3항).
//
// ── 여기서 고정하지 않는 것 ────────────────────────────────────────────────
// `/api/weather/uv` 와 `/api/weather/apparent` 는 **불릴 때마다 캐시를 통째로 비운다**
// (관리자 설정의 「테스트」 버튼 자리라 일부러 그렇게 돼 있다). 지금은 화면이 그
// 버튼에서만 부르므로 문제가 없다. **그러나 누군가 그 주소를 주기로 부르기 시작하면**
// 캐시가 계속 깨져 호출량이 늘어난다. 그 배선까지 소스로 좇는 시험은 화면 구조가
// 조금만 바뀌어도 깨지는 종류라 만들지 않았다 — 대신 그 위험을 제출 문서 §4.2 에
// 적어 두었다. 2) 가 잡는 것은 **서버 안의 타이머**까지다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const WEATHER = 'server/services/weather.js'

test('**10분 캐시가 호출 상한의 근거다** — 짧아지면 API허브 호출이 그만큼 늘어난다', () => {
  const src = 읽기(WEATHER)
  const m = src.match(/const\s+CACHE_TTL\s*=\s*([^\n/]+)/)
  assert.ok(m, 'CACHE_TTL 을 못 찾았다 — 이 시험의 전제가 무너졌다')

  // 제품이 적어 둔 식을 그대로 계산한다. 기대값은 제품이 아니라 **약관 조사 결과**에서
  // 온다 — 10분이면 항목당 시간당 6회이고, 그 숫자로 「과부하가 아니다」라고 적었다.
  const 식 = m[1].trim()
  assert.match(식, /^[\d\s*+]+$/, `CACHE_TTL 이 상수 계산이 아니다: ${식}`)
  const 밀리초 = Function(`"use strict";return (${식})`)()
  assert.ok(밀리초 >= 10 * 60 * 1000,
    `CACHE_TTL 이 ${Math.round(밀리초 / 1000)}초로 10분보다 짧다 — 제출 문서 §4.2 의 `
    + '「시간당 6회」 근거가 깨진다. 줄이려면 약관 한도를 다시 확인하고 그 문서도 같이 고칠 것')
})

test('**캐시를 비우는 것은 사람이 누를 때뿐이다** — 서버 안에 타이머가 없다', () => {
  // 부르는 파일을 목록으로 적지 않고 **훑어서 찾는다.** 목록으로 두면 새 파일이
  // 생겼을 때 조용히 빠진다(CLAUDE.md 「파일을 가를 때」 ③).
  const 뒤질곳 = ['server/routes', 'server/services', 'server/domain']
  const 부르는파일 = []
  for (const 폴더 of 뒤질곳) {
    for (const 이름 of fs.readdirSync(path.join(ROOT, 폴더))) {
      if (!이름.endsWith('.js')) continue
      const rel = `${폴더}/${이름}`
      const src = 읽기(rel)
      // 정의한 자리(weather.js)는 빼고 **부르는 자리**만 본다.
      if (/clearWeatherCache\s*\(/.test(src) && rel !== WEATHER) 부르는파일.push(rel)
    }
  }

  // 긍정 앵커 — 감시할 대상이 실제로 있다. 없으면 아래 부정 단언이 조용히 통과한다.
  assert.ok(부르는파일.length >= 2,
    `캐시를 비우는 자리가 ${부르는파일.length}곳뿐이다 — 훑기가 헛돌고 있다`)

  for (const rel of 부르는파일) {
    const src = 읽기(rel)
    assert.ok(!/setInterval\s*\(/.test(src),
      `${rel} 에 setInterval 이 생겼다 — 캐시를 주기로 비우면 API허브 호출이 늘어난다`)
    assert.ok(!/setTimeout\s*\(/.test(src),
      `${rel} 에 setTimeout 이 생겼다 — 캐시를 미뤄 비우는 것도 같은 결과다`)
  }
})

test('**인증키는 설정 이름 하나로만 읽는다** — 제5조 3항(앱 하나에 키 하나)', () => {
  const src = 읽기(WEATHER)
  // **이름의 생김새로 찾지 않는다.** 처음엔 `kma_*apihub*` 로 훑었는데, 변이로
  // `kma_apihub_key2` 를 넣었더니 **초록으로 지나갔다** — 글자 묶음에 숫자가 빠져
  // 있었다. 이름을 맞히는 방식은 다음 사람이 무슨 이름을 지을지에 기댄다.
  // 그래서 **그 값이 만들어지는 줄**을 통째로 보고, 거기서 설정을 몇 개나 읽는지 센다.
  const 줄 = src.match(/^\s*apihubKey:\s*(.*)$/m)
  assert.ok(줄, 'apihubKey 를 만드는 줄을 못 찾았다 — 이 시험의 전제가 무너졌다')

  const 읽는이름 = [...줄[1].matchAll(/get\(\s*'([^']+)'\s*\)/g)].map(m => m[1])
  assert.deepEqual(읽는이름, ['kma_apihub_key'],
    `API허브 인증키를 설정 ${읽는이름.length}곳에서 읽는다(${읽는이름.join(' · ')}) — `
    + '키를 여러 개 두고 돌려 쓰면 제5조 3항과 제11조 5항 ⑮에 걸린다')
})
