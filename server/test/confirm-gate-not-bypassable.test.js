// **애매하게 읽힌 예약은 어느 길로도 확인 없이 저장되지 않는다** (V③ R6 지적, 2026-09-14).
//
// ── 무엇이 뚫려 있었나 ──────────────────────────────────────────────────────
// 자연어로 만든 초안에 애매한 항목이 있으면(오전/오후, 유형 후보 둘 등) 확인 카드가
// 그것을 문장으로 띄우고 **「확인했습니다」를 체크해야 「예약 확정」이 눌린다.**
// 그런데 **「자세히 수정」 단추는 무조건 열렸다.** 그 모달의 저장은 확인 여부를 **안 본다**
// (`ScheduleModal.handleSave` → `createSchedule`). 즉 **확정 버튼만 잠근 셈**이었고,
// 미확인 시각·후보를 그대로 저장하는 길이 옆에 남아 있었다.
//
// 이 저장소의 규칙은 *"사람의 명시적 확정 없이 자동 저장하지 않는다"* 이고,
// 조용한 오독이 현장에서 가장 찾기 어려운 실패다(`CLAUDE.md` 「AI 자동 생성 결과물 규칙」).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')

/** `{` 부터 짝이 맞는 `}` 까지. */
function 블록(글, 여는곳) {
  let 깊이 = 0
  for (let k = 여는곳; k < 글.length; k++) {
    if (글[k] === '{') 깊이++
    else if (글[k] === '}') { 깊이--; if (깊이 === 0) return 글.slice(여는곳 + 1, k) }
  }
  assert.fail('블록의 끝을 못 찾았다')
}

/** 「자세히 수정」 단추의 onClick 몸통 — **제품 소스 그대로**. */
function 자세히수정몸통() {
  const i = SRC.indexOf('자세히 수정(BGM·음원 등)')
  assert.ok(i > 0, '긍정 앵커 — 「자세히 수정」 단추가 이 화면에 있다')
  const j = SRC.lastIndexOf('onClick={', i)
  assert.ok(j > 0, '그 단추의 onClick 을 못 찾았다')
  return 블록(SRC, SRC.indexOf('{', SRC.indexOf('=>', j)))
}

function 돌리기({ notes, acked }) {
  const st = { 열렸나: false, 오류: '' }
  const env = {
    notes, acked,
    setAdvanced: (v) => { st.열렸나 = !!v },
    setSaveError: (v) => { st.오류 = v },
  }
  const 이름들 = Object.keys(env)
  new Function(...이름들, `(() => {${자세히수정몸통()}})()`)(...이름들.map(k => env[k]))
  return st
}

test('긍정 앵커 — 확인할 것이 없으면 **그냥 열린다**', () => {
  const r = 돌리기({ notes: [], acked: false })
  assert.equal(r.열렸나, true, '확인 항목이 없는데도 막는다 — 멀쩡한 길을 닫으면 안 된다')
})

test('확인을 **이미 했으면** 열린다', () => {
  const r = 돌리기({ notes: ['오전인지 오후인지'], acked: true })
  assert.equal(r.열렸나, true, '확인을 했는데도 막는다')
})

test('**확인이 남아 있으면 안 열린다** — 확정 버튼만 잠그면 옆길이 남는다', () => {
  const r = 돌리기({ notes: ['오전인지 오후인지'], acked: false })
  assert.equal(r.열렸나, false,
    '미확인 항목이 있는데 「자세히 수정」이 열린다 — 그 모달의 저장은 확인 여부를 안 보므로'
    + ' **확인 없이 저장하는 길**이 된다')
  assert.match(r.오류, /확인/,
    '막기만 하고 왜 못 여는지 안 말한다 — 막다른 길이 되면 사람이 다른 길을 찾는다')
})

// **모달 쪽 사실도 함께 못 박는다** — 위 판정이 「모달이 안 막는다」는 전제에 기대고 있다.
// 그 전제가 바뀌면(모달이 스스로 막게 되면) 이 시험의 근거도 바뀌어야 한다.
test('전제 확인 — `ScheduleModal` 의 저장은 확인 여부를 보지 않는다', () => {
  const 모달 = fs.readFileSync(path.join(ROOT, 'src/components/shared/ScheduleModal.jsx'), 'utf8')
  const i = 모달.indexOf('const handleSave')
  assert.ok(i > 0, '긍정 앵커 — 모달의 저장 함수를 못 찾았다')
  const 몸통 = 모달.slice(i, i + 2000)
  assert.doesNotMatch(몸통, /\backed\b/,
    '모달이 스스로 확인을 보기 시작했다 — 그렇다면 위쪽에서 막는 규칙을 다시 볼 것')
})
