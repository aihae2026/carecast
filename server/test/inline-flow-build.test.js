// 순서(흐름)를 **그 자리에서 만든다** — 다른 화면으로 보내지 않는다 (2026-09-14).
//
// 사용자 지적: *"순서는 순서 흐름만들기가 핵심인데, 지금 나오는거로는 순서하기가 힘들잖아,
// 그래서 사진처럼 아예 입력창에서 순서를 만들 수 있게 해주면 어떨까?"*
//
// 그전에는 초안 카드가 *"「자동순서」 화면에서 먼저 만들어 주세요"* 한 줄을 띄웠다 —
// **막다른 길**이다. 순서를 쓰려고 여기까지 왔는데 다른 화면으로 보내고, 돌아오면 치던
// 문장이 사라져 있다.
//
// **이 시험의 핵심은 「만든 뒤」다.** 만들고 나서 그것이 안 골라지면, 사람은 방금 만든 것을
// 목록에서 다시 찾아야 한다 — 이름을 아직 안 외운 바로 그 순간에.
// 그 판단(`handleFlowCreated`)을 **소스에서 떼어 실제로 돌린다.**
'use strict'

const fs   = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const ASK  = path.join(ROOT, 'src', 'components', 'shared', 'QuickSchedulePhrase.jsx')
const 글 = fs.readFileSync(ASK, 'utf8')

/**
 * **주석을 걷은** 소스. 「없을 것」을 보는 단언은 반드시 이쪽으로 본다 —
 * 이 저장소는 *왜 그렇게 고쳤는지*를 주석에 길게 적는다. 그래서 옛 문구가 주석에 인용된
 * 채로 남고, 글자만 찾으면 **제 설명에 제가 걸린다**(이 시험을 쓰면서 실제로 걸렸다).
 */
const 코드만 = 글
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n')

/** `handleFlowCreated` 를 소스에서 떼어 낸다. 괄호·중괄호를 함께 세어 끝을 찾는다. */
function 만든뒤함수() {
  const 시작 = 글.indexOf('const handleFlowCreated')
  assert.ok(시작 >= 0, '긍정 앵커 — `handleFlowCreated` 가 이 화면에 있다')
  let 중 = 0, 소 = 0, 열림 = false
  for (let k = 시작; k < 글.length; k++) {
    const c = 글[k]
    if (c === '{') { 중++; 열림 = true }
    else if (c === '}') 중--
    else if (c === '(') { 소++; 열림 = true }
    else if (c === ')') 소--
    else if (c === '\n' && 열림 && 중 === 0 && 소 === 0) return 글.slice(시작, k)
  }
  assert.fail('`handleFlowCreated` 의 끝을 못 찾았다')
}

/** 한 번의 렌더를 흉내 낸다 — 제품 함수를 그대로 돌린다. */
function 돌리기(상태) {
  const 만들기 = new Function('set흐름만들기', 'getFlows', 'setFlows', 'setDraft',
    만든뒤함수() + '\n; return handleFlowCreated')
  return 만들기(
    (v) => { 상태.편집기열림 = v },
    () => ({ then: (f) => { f({ items: 상태.서버흐름 }); return { catch: () => {} } } }),
    (v) => { 상태.목록 = v },
    (f) => { 상태.초안 = typeof f === 'function' ? f(상태.초안) : f },
  )
}

const 새상태 = () => ({
  편집기열림: true,
  목록: [],
  서버흐름: [{ id: 7, name: '아침 순서' }],
  초안: { broadcast_type: 'flow', flow_sequence_id: null, title: '순서 방송' },
})

test('만들고 나면 **그것이 곧바로 골라진다**', () => {
  const 상태 = 새상태()
  돌리기(상태)(7)
  assert.equal(상태.초안.flow_sequence_id, 7,
    '만든 순서가 안 골라졌다 — 사람이 목록에서 방금 만든 것을 다시 찾아야 한다')
})

test('숫자로 넣는다 — 고르는 칸이 숫자를 쓴다', () => {
  const 상태 = 새상태()
  돌리기(상태)('7')
  assert.strictEqual(상태.초안.flow_sequence_id, 7,
    '문자열로 들어갔다 — select 의 값과 타입이 갈리면 고른 것이 화면에 안 뜬다')
})

test('만들고 나면 편집기가 접히고 목록이 다시 읽힌다', () => {
  const 상태 = 새상태()
  돌리기(상태)(7)
  assert.equal(상태.편집기열림, false, '만들었는데 편집기가 그대로 펼쳐져 있다')
  assert.deepEqual(상태.목록, [{ id: 7, name: '아침 순서' }],
    '목록을 다시 안 읽는다 — 방금 만든 것이 고르는 칸에 안 나온다')
})

test('id 를 못 받으면 고르지 않는다 — 엉뚱한 순서를 집지 않는다', () => {
  for (const 없음 of [null, undefined, 0, '']) {
    const 상태 = 새상태()
    상태.초안.flow_sequence_id = 3
    돌리기(상태)(없음)
    assert.equal(상태.초안.flow_sequence_id, 3, `${없음} 을 받고 고른 것을 건드렸다`)
    assert.equal(상태.편집기열림, false, '그래도 편집기는 접어야 한다')
  }
})

// ── 배선 — 막다른 문장이 사라지고 편집기가 붙었나 ────────────────────────────
test('막다른 안내가 사라지고 **여기서 만드는 길**이 생겼다', () => {
  assert.ok(!/「자동순서」 화면에서 먼저 만들어 주세요/.test(코드만),
    '다른 화면으로 보내는 막다른 문장이 남아 있다')
  assert.match(글, /여기서 새 순서 만들기/, '그 자리에서 만드는 단추가 없다')
  assert.match(글, /<FlowEditorModal[\s\S]{0,200}인라인/,
    '편집기를 인라인으로 안 편다 — 창이 뜨면 초안 카드를 덮는다')
})

test('편집기를 새로 만들지 않았다 — 있던 것을 가져다 쓴다', () => {
  assert.match(글, /import \{ FlowEditorModal \} from '\.\/FlowBuilder'/,
    '순서 편집기를 이 파일이 제 안에 다시 만들었다 — 만드는 화면이 두 벌이 된다')
})

test('초안을 닫으면 편집기도 접힌다', () => {
  const i = 글.indexOf('const reset =')
  assert.ok(i > 0, '긍정 앵커 — reset 이 이 파일에 있다')
  // **`reset` 의 몸통을 실제로 떼어 본다** (2026-09-14).
  // 앞 판은 `slice(i, i + 400)` 이었다. 그 창은 **줄이 하나 늘어나면 끝이 밀려난다** —
  // V③ R14 로 `set손으로고름(false)` 한 줄을 더했더니, 지키려던 사실은 그대로인데
  // 빨간불이 났다. **글자 수를 세는 시험은 무관한 변경에 걸려 넘어진다.**
  let 깊이 = 0, 끝 = -1
  const 여는곳 = 글.indexOf('{', 글.indexOf('=>', i))
  for (let k = 여는곳; k < 글.length; k++) {
    if (글[k] === '{') 깊이++
    else if (글[k] === '}') { 깊이--; if (깊이 === 0) { 끝 = k; break } }
  }
  assert.ok(끝 > 여는곳, 'reset 의 끝을 못 찾았다')
  assert.match(글.slice(여는곳, 끝), /set흐름만들기\(false\)/,
    '초안을 닫아도 편집기가 남는다 — 다음 문장을 칠 때 엉뚱한 것이 펼쳐져 있다')
})
