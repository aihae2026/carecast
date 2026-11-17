'use strict'
// 서버가 **JSON 이 아닌 것**을 200 으로 줄 때 화면이 무엇을 말하나 (2026-09-12).
//
// 이 시스템의 서버는 모르는 주소에 **SPA 화면(HTML)을 200 으로** 돌려준다
// (`server/index.js` 의 마지막 catch-all — 새로고침해도 주소가 살아 있게 하는 장치다).
// 그래서 없는 엔드포인트를 부르면 `res.ok` 가 참인데 본문이 HTML 이고,
// `res.json()` 이 `Unexpected token '<', "<!doctype "... is not valid JSON` 을 던진다.
//
// **그 문구가 현장 직원 화면에 그대로 나갔다.** 실제로 날 수 있는 상황이다 — 자동
// 업데이트가 서버를 바꾼 뒤 아직 새로고침 안 한 창이 옛 주소를 부르면 정확히 이 모양이다
// (CLAUDE.md: 자동 새로고침으로 가는 단서 둘이 모두 조건부다).
//
// 2026-09-12 에 SwitchBot 장치 목록을 브라우저로 확인하다 **실제로 이 문구를 봤다.**
// 그 자리만 고치면 같은 오류가 다른 동작에서만 나고, 그게 더 나쁘다 — "조회는 되는데
// 저장만 이상한 글이 뜬다"가 되어 원인을 엉뚱한 데서 찾는다. 그래서 헬퍼 한 곳에서 고친다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', '..', 'src', 'lib', 'api.js')
const 원본 = () => fs.readFileSync(SRC, 'utf8')

// 순수 함수가 아니라 `res` 를 받는 함수라, 가짜 응답을 만들어 **진짜 함수를 돌린다.**
// 소스 글자만 보면 "문구가 있다"까지만 알 수 있고 실제로 던지는지는 모른다.
async function 본문JSON불러오기() {
  const src = 원본()
  const m = /async function 본문JSON\(res, path\) \{[\s\S]*?\n\}/.exec(src)
  assert.ok(m, '본문JSON 을 못 찾았다 — 이 가드를 옮길 것')
  // 의존성이 없는 함수 하나만 떼어 돌린다 — 이 저장소의 다른 lib 검사와 같은 방법이다.
  return new Function(`${m[0]}; return 본문JSON`)()
}

const 가짜응답 = (text, status = 200) => ({ status, text: async () => text })

test('HTML 을 받으면 새로고침하라고 말한다 — 파서 오류를 그대로 내지 않는다', async () => {
  const 본문JSON = await 본문JSON불러오기()
  await assert.rejects(
    () => 본문JSON(가짜응답('<!doctype html><html><body>앱</body></html>'), '/api/없는것'),
    (e) => {
      assert.ok(!/Unexpected token|valid JSON/.test(e.message),
        `원시 파서 오류가 그대로 나간다: ${e.message}`)
      assert.match(e.message, /새로고침/, '다음에 뭘 하면 되는지를 안 말한다')
      assert.match(e.message, /\/api\/없는것/, '어느 주소였는지를 안 말한다')
      assert.equal(e.notJson, true, '부르는 쪽이 이 경우를 가릴 표식이 없다')
      return true
    })
})

test('HTML 이 아닌 이상한 본문도 사람 말로 바꾼다', async () => {
  const 본문JSON = await 본문JSON불러오기()
  await assert.rejects(
    () => 본문JSON(가짜응답('그냥 글자'), '/api/x'),
    (e) => {
      assert.ok(!/Unexpected token|valid JSON/.test(e.message), e.message)
      assert.match(e.message, /알 수 없는 형식/)
      return true
    })
})

test('정상 JSON 은 그대로 지난다 — 위 가드가 전부를 막지 않는다', async () => {
  const 본문JSON = await 본문JSON불러오기()
  assert.deepEqual(await 본문JSON(가짜응답('{"ok":true,"n":3}'), '/api/x'), { ok: true, n: 3 })
  // 본문이 빈 응답(204 따위)도 오류가 아니다 — 예전 `res.json()` 은 여기서도 던졌다.
  assert.deepEqual(await 본문JSON(가짜응답(''), '/api/x'), {})
})

test('헬퍼 다섯이 모두 같은 규칙을 쓴다 — 한 곳만 고치면 동작마다 다르게 말한다', () => {
  const src = 원본()
  for (const 이름 of ['apiGet', 'apiPost', 'apiPut', 'apiDelete', 'apiPatch']) {
    const i = src.indexOf(`export async function ${이름}(`)
    assert.notEqual(i, -1, `${이름} 이 없다 — 이 가드를 옮길 것`)
    const 본문 = src.slice(i, src.indexOf('\n}', i))
    assert.match(본문, /본문JSON\(res, path\)/,
      `${이름} 이 본문JSON 을 안 쓴다 — 이 동작에서만 원시 파서 오류가 나간다`)
    assert.ok(!/return res\.json\(\)/.test(본문),
      `${이름} 이 아직 res.json() 을 그대로 돌려준다`)
  }
})

// ── **실패 응답의 본문도 버리지 않는다** (V③ R19 지적 6, 2026-09-14) ──────────────────
//
// 위는 **성공(200)인데 JSON 이 아닌 것**을 다룬다. 반대쪽이 뚫려 있었다 —
// `res.json().catch(() => ({ error: res.statusText }))` 라, 서버가 **실패**를 JSON 이 아닌
// 것으로 알리면 그 문장을 통째로 버리고 `Service Unavailable` 같은 껍데기만 남겼다.
// 검수관 실측: 503 본문 `disk unavailable: retry later` 가 POST·PUT·DELETE 세 곳에서 사라졌다.
// 서버가 유일하게 알려 준 단서를 화면이 삼키면 현장에서 원인을 못 찾는다.
async function 오류본문불러오기() {
  const src = 원본()
  const m = /async function 오류본문\(res, 기본\) \{[\s\S]*?\n\}/.exec(src)
  assert.ok(m, '오류본문 을 못 찾았다 — 이 가드를 옮길 것')
  return new Function(`${m[0]}; return 오류본문`)()
}
const 가짜실패 = (text, status = 503, statusText = 'Service Unavailable') =>
  ({ status, statusText, text: async () => text })

test('실패 응답이 평문이면 **그 문장을** 전한다 — statusText 로 덮지 않는다', async () => {
  const 오류본문 = await 오류본문불러오기()
  const r = await 오류본문(가짜실패('disk unavailable: retry later'))
  assert.equal(r.error, 'disk unavailable: retry later',
    '서버가 알려 준 진짜 이유를 버렸다 — 현장에서 원인을 못 찾는다')
})

test('실패 응답이 JSON 이면 그대로 — error·data 를 쓰는 기존 호출부가 그대로 돈다', async () => {
  const 오류본문 = await 오류본문불러오기()
  const r = await 오류본문(가짜실패('{"error":"지금 쓰고 있어 지울 수 없습니다","usedBy":[{"tab":"morning"}]}', 409))
  assert.equal(r.error, '지금 쓰고 있어 지울 수 없습니다')
  assert.deepEqual(r.usedBy, [{ tab: 'morning' }], 'usedBy 가 사라지면 어디서 쓰는지 못 보여준다')
})

test('HTML·빈 본문은 버리고 기본 문구로 — 오류 페이지 원문은 사람에게 쓸모가 없다', async () => {
  const 오류본문 = await 오류본문불러오기()
  assert.equal((await 오류본문(가짜실패('<!doctype html><html>...</html>'))).error, 'Service Unavailable')
  assert.equal((await 오류본문(가짜실패(''))).error, 'Service Unavailable')
  assert.equal((await 오류본문(가짜실패('   '))).error, 'Service Unavailable')
  // 기본 문구를 준 자리(미리듣기 등)는 그것을 쓴다
  assert.equal((await 오류본문(가짜실패('', 500, ''), '서버 오류')).error, '서버 오류')
})

test('본문을 **한 번만** 읽는다 — 두 번 읽으면 스트림이 비어 이유가 사라진다', async () => {
  const 오류본문 = await 오류본문불러오기()
  let 읽은횟수 = 0
  const res = {
    status: 503, statusText: 'Service Unavailable',
    text: async () => { 읽은횟수 += 1; return 읽은횟수 === 1 ? 'disk full' : '' },
  }
  assert.equal((await 오류본문(res)).error, 'disk full')
  assert.equal(읽은횟수, 1, '본문을 두 번 읽었다 — 두 번째는 언제나 비어 있다')
})

test('POST·PUT·DELETE 가 모두 오류본문 을 쓴다 — 한 곳만 고치면 동작마다 다르게 말한다', () => {
  const src = 원본()
  for (const 이름 of ['apiPost', 'apiPut', 'apiDelete']) {
    const i = src.indexOf(`export async function ${이름}(`)
    const 본문 = src.slice(i, src.indexOf('\n}', i))
    assert.match(본문, /await 오류본문\(res/, `${이름} 이 오류본문 을 안 쓴다`)
  }
  // 주석에 남긴 옛 모양은 세지 않는다 — 코드 줄에만 없어야 한다
  const 코드줄 = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
  assert.ok(!코드줄.some(l => /res\.json\(\)\.catch/.test(l)),
    '아직 res.json().catch 로 오류 본문을 버리는 자리가 남아 있다')
})
