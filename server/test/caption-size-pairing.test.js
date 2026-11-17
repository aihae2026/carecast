// **자막 글씨 크기와 한 줄 글자 수는 짝이다** (사용자 요청 2026-09-15).
//
// ── 왜 이 시험이 필요한가 ───────────────────────────────────────────────────
// *"방송 자막 좀 크게 해줘"* 를 받고 글씨 크기만 키우면 **아무 변화가 없다.**
// 한 줄이 상자보다 넓어지면 `BroadcastCaption` 의 `useLayoutEffect` 가 **그 줄만 줄여서**
// 맞추기 때문에, 키운 만큼 도로 줄어든다. 실제로 정하는 것은 **한 줄에 몇 글자냐**다.
//
// 두 값이 **다른 파일**에 있다(`domain/captions.js` 의 MAX_CHARS · `BroadcastCaption.jsx`
// 의 CUR_SIZE). 그래서 한쪽만 고치기 쉽고, 고친 사람은 **왜 안 커지는지 모른다.**
// 이 시험이 그 순간에 이유를 말해 준다.
//
// ── 무엇을 재나 ─────────────────────────────────────────────────────────────
// 한글은 글씨 크기만큼 넓으므로 **글자 수 × 글씨 크기** 가 한 줄의 폭이다.
// 그것이 화면에서 쓸 수 있는 폭을 넘으면 자동 축소가 돈다 — 즉 **상한을 올려도 소용없다.**
// 넘지 않는지만 본다. 픽셀 하나까지 맞추는 시험이 아니다(글꼴마다 조금씩 다르다).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { MAX_CHARS } = require('../domain/captions')
const 자막소스 = fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'broadcast', 'BroadcastCaption.jsx'), 'utf8')

// 기준 화면. 현장 홀 TV·방송 PC 가 이 폭이다. 좁은 화면은 자동 축소가 맡는다.
const 화면폭 = 1920
// `shell` 의 `px-10` — 좌우 40px 씩.
const 좌우여백 = 80
const 상자폭 = 화면폭 - 좌우여백

/** `clamp(a, b, c)` 의 **세 번째 값**(상한)을 px 로. rem 은 16px 로 본다. */
function 상한px(선언) {
  const m = /clamp\([^,]+,[^,]+,\s*([\d.]+)(rem|px)\s*\)/.exec(선언)
  assert.ok(m, `clamp 상한을 못 읽었다: ${선언}`)
  return m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1])
}

function 선언(이름) {
  const m = new RegExp(`const ${이름}\\s*=\\s*'([^']+)'`).exec(자막소스)
  assert.ok(m, `${이름} 을 못 찾았다 — 이름이 바뀌었으면 이 시험도 같이 옮길 것`)
  return m[1]
}

test('긍정 앵커 — 두 값이 아직 제자리에 있다', () => {
  assert.ok(Number.isFinite(MAX_CHARS) && MAX_CHARS > 0, 'MAX_CHARS 가 숫자가 아니다')
  assert.ok(상한px(선언('CUR_SIZE')) > 0, 'CUR_SIZE 상한을 못 읽었다')
})

test('**한 줄이 상자보다 넓지 않다** — 넘으면 키운 글씨가 도로 줄어든다', () => {
  const 글씨 = 상한px(선언('CUR_SIZE'))
  const 한줄폭 = MAX_CHARS * 글씨
  assert.ok(한줄폭 <= 상자폭,
    `한 줄이 ${Math.round(한줄폭)}px 라 상자(${상자폭}px)를 넘는다 — `
    + `글씨를 키웠으면 MAX_CHARS 를 같이 내려야 한다. `
    + `지금: ${MAX_CHARS}자 × ${글씨}px. 안 내리면 자동 축소가 키운 만큼 도로 줄인다.`)
})

test('**상자를 너무 남기지도 않는다** — 남기면 더 키울 수 있었다는 뜻이다', () => {
  // 위 시험만 있으면 "글자 수를 잔뜩 줄이고 글씨는 그대로" 로도 통과한다.
  // 그건 자막이 **작은 채로 잘게 쪼개지는** 상태다 — 사용자가 원한 것의 반대다.
  const 글씨 = 상한px(선언('CUR_SIZE'))
  const 채움 = (MAX_CHARS * 글씨) / 상자폭
  assert.ok(채움 >= 0.8,
    `한 줄이 상자의 ${Math.round(채움 * 100)}% 밖에 안 쓴다 — `
    + '글자 수를 줄였으면 글씨를 그만큼 키워야 한다. 안 그러면 작은 글씨로 잘게 쪼개진다.')
})

test('앞뒤 줄은 지금 줄보다 **확실히 작다** — 어디를 읽는 중인지 보여야 한다', () => {
  const 지금 = 상한px(선언('CUR_SIZE'))
  const 앞뒤 = 상한px(선언('SIDE_SIZE'))
  const 비율 = 앞뒤 / 지금
  assert.ok(비율 <= 0.5,
    `앞뒤 줄이 지금 줄의 ${Math.round(비율 * 100)}% 다 — 절반을 넘으면 셋이 비슷해져 `
    + '어느 줄을 읽는 중인지 안 보인다')
  assert.ok(비율 >= 0.25,
    `앞뒤 줄이 지금 줄의 ${Math.round(비율 * 100)}% 다 — 너무 작으면 앞뒤 맥락이 안 읽힌다`)
})

test('**잘게 쪼개지지 않는다** — 실제 방송 문안으로 줄을 나눠 본다', () => {
  const { draftFromText } = require('../domain/captions')
  // 현장에서 실제로 쓰는 모양의 문안이다(환기 안내 계열).
  const 문안 = '안내 말씀드립니다. 어르신들의 쾌적한 생활환경을 위해 지금부터 10분간 환기를 실시하겠습니다.'
  const r = draftFromText(문안, 20)
  const 줄 = (r.lines || r.cues || []).map(l => (l.text ?? l))
  assert.ok(줄.length > 0, '줄이 안 나왔다')
  for (const s of 줄) {
    assert.ok(s.length <= MAX_CHARS, `${MAX_CHARS}자를 넘었다(${s.length}): ${s}`)
  }
  // **너무 짧은 줄이 많으면** "선생님들께 / 안내드립니다." 처럼 쪼개진 것이다.
  // 그 상태를 한 번 겪고 MAX_CHARS 를 12 아래로 안 내리기로 했다(captions.js 머리말).
  const 짧은줄 = 줄.filter(s => s.length < MAX_CHARS * 0.5)
  assert.ok(짧은줄.length <= 1,
    `절반도 안 채운 줄이 ${짧은줄.length}개다 — MAX_CHARS 가 너무 작다: ${짧은줄.join(' / ')}`)
})
