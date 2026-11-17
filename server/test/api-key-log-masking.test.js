// API 키가 로그에 평문으로 남지 않는가 (P-14, 2026-09-08)
//
// 왜 이 파일이 있나:
//   `weather.js` 는 로그를 낼 때 이미 마스킹을 **하고 있었다** —
//     `console.log('[날씨 API] 초단기실황:', url.replace(logKey, logKey.slice(0, 6) + '...'))`
//   그런데 2026-09-07 로그에 기상청 키가 **평문으로 199회** 남아 있었다
//   ([FACT] EV-001598 — authKey= 53회 · serviceKey= 146회, [FACT] EV-001599 — 새는 줄이
//   정확히 저 마스킹하는 줄들이었다).
//
//   원인: **값으로 지우려 했는데 URL 안의 값이 다르다.**
//     · `normalizeServiceKey` 가 `decodeURIComponent(raw)` 로 **디코딩된** 키를 만든다
//     · URL 은 `new URLSearchParams({ serviceKey: apiKey })` 가 **다시 인코딩**한다
//     · 키에 `+`·`/`·`=` 가 있으면(base64 계열 키는 대부분 그렇다) 두 문자열이 달라진다
//     · `String.replace` 는 **못 찾아도 오류를 안 낸다** — 그대로 원본 URL 이 찍힌다
//
//   이 저장소가 가장 경계하는 조용한 실패다. "마스킹 코드가 있다"가 "마스킹된다"의
//   근거가 아니었다.
//
// 그래서 값이 아니라 **파라미터 이름**으로 지운다. 인코딩과 무관하게 동작한다.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { maskApiKeysInUrl } = require('../domain/weatherCodes')

test('인코딩된 키도 마스킹된다 — 값이 아니라 파라미터 이름으로 지우기 때문', () => {
  // 실제로 새던 형태: URLSearchParams 가 인코딩한 base64 계열 키
  const raw = 'abc+def/ghi=='
  const url = `http://apis.data.go.kr/1360000/X?${new URLSearchParams({ serviceKey: raw, nx: '60' })}`

  // 전제 확인 — URL 안의 값은 원본과 다르다(이것이 옛 마스킹이 실패한 이유)
  assert.ok(!url.includes(raw), '이 테스트의 전제가 깨졌다 — URLSearchParams 가 인코딩을 안 했다')

  const masked = maskApiKeysInUrl(url)
  assert.ok(!masked.includes('abc'), `키 조각이 남았다: ${masked}`)
  assert.match(masked, /serviceKey=\*\*\*/, '파라미터가 마스킹 표시로 바뀌지 않았다')
  assert.match(masked, /nx=60/, '다른 파라미터까지 지웠다')
})

test('authKey·serviceKey·apiKey 를 대소문자 구분 없이 지운다', () => {
  for (const name of ['authKey', 'serviceKey', 'apiKey', 'AUTHKEY']) {
    const masked = maskApiKeysInUrl(`https://x.kr/a?${name}=SECRETVALUE123&b=2`)
    assert.ok(!masked.includes('SECRETVALUE123'), `${name} 이 안 지워졌다: ${masked}`)
    assert.match(masked, /b=2/, `${name}: 다른 파라미터가 사라졌다`)
  }
})

test('키가 없는 URL·빈 값·null 에도 던지지 않는다', () => {
  assert.equal(maskApiKeysInUrl('https://x.kr/a?b=2'), 'https://x.kr/a?b=2')
  assert.equal(maskApiKeysInUrl(''), '')
  assert.equal(maskApiKeysInUrl(null), '')
  assert.equal(maskApiKeysInUrl(undefined), '')
})

// ── 소스 대조 — 옛 방식이 되살아나지 않았는가 ─────────────────────────────
//
// 값으로 지우는 방식(`url.replace(logKey, …)`)이 다시 들어오면 같은 조용한 실패가 난다.

test('weather.js 는 URL 을 로그로 낼 때 값이 아니라 파라미터 이름으로 지운다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services/weather.js'), 'utf8')

  // 긍정 앵커 — 이 파일이 정말 URL 을 로그로 내는 자리인가
  assert.ok(/console\.log\('\[날씨 API\]/.test(src), 'weather.js 가 URL 로그를 안 낸다 — 이 가드를 옮길 것')
  assert.ok(src.includes('maskApiKeysInUrl'), 'weather.js 가 maskApiKeysInUrl 을 안 쓴다')

  assert.doesNotMatch(src, /url\.replace\(\s*(logKey|key|livingApiKey|apiKey|apihubKey)\b/,
    'weather.js 에 값으로 지우는 마스킹이 남아 있다 — URL 안의 값은 인코딩돼 있어 못 찾고, '
    + 'String.replace 는 못 찾아도 오류를 안 낸다(P-14 가 그렇게 199회 샜다)')
})
