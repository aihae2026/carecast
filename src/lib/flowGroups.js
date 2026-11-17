// 흐름 단계 묶음(폴더)의 순수 규칙 — 화면(FlowBuilder.jsx)이 쓰고, 테스트가 여기를 고정한다.
//
// 묶음은 별도 테이블·컬럼이 아니라 **단계 하나**(step_type: 'group')다. 머리글 뒤에 이어지는
// 단계들이 그 묶음에 속하고, 다음 머리글이 나오면 거기서 끊긴다. 저장 구조(flow_sequence_steps)와
// 실행 순서(sort_order)는 그대로라, 실행기는 머리글을 그냥 건너뛰기만 하면 된다.
// 계층은 한 겹만 둔다 — 중첩을 허용하면 드래그가 손쓸 수 없이 어려워지고 현장에서 쓰지 않는다.
//
// 이 파일에 로직을 따로 뺀 이유: 아래 moveBlock이 틀리면 **사람이 저장해 둔 방송 순서가 조용히
// 뒤바뀐다.** 화면에서 눈으로만 확인하기엔 위험해서 테스트로 고정한다.

export const GROUP_COLORS = {
  violet:  { dot: 'bg-ds-v3-flow',  head: 'bg-ds-v3-flow-bg',  text: 'text-ds-v3-flow',  rail: 'bg-ds-v3-flow-bg'  },
  sky:     { dot: 'bg-ds-v3-tts',     head: 'bg-ds-v3-tts-bg',     text: 'text-ds-v3-tts',     rail: 'bg-ds-v3-tts-bg'     },
  emerald: { dot: 'bg-ds-v3-ink-2', head: 'bg-ds-v3-surface-2', text: 'text-ds-v3-ink-2', rail: 'bg-ds-v3-surface-2' },
  amber:   { dot: 'bg-ds-v3-ink-2',   head: 'bg-ds-v3-surface-2',   text: 'text-ds-v3-ink-2',   rail: 'bg-ds-v3-surface-2'   },
}

export const GROUP_COLOR_KEYS = Object.keys(GROUP_COLORS)

export const groupColor = (key) => GROUP_COLORS[key] ?? GROUP_COLORS.violet

// i번째 줄을 끌 때 함께 움직일 개수. 묶음 머리글이면 다음 머리글 직전까지(= 그 묶음 전체).
export function blockLength(steps, i) {
  if (steps[i]?.step_type !== 'group') return 1
  let end = i + 1
  while (end < steps.length && steps[end].step_type !== 'group') end++
  return end - i
}

// 각 줄을 지배하는 묶음 머리글의 인덱스(묶음 밖이면 -1). 들여쓰기·접기 판단에 쓴다.
export function ownerGroupIndexes(steps) {
  let owner = -1
  return steps.map((s, i) => {
    if (s.step_type === 'group') { owner = i; return -1 }
    return owner
  })
}

// from 위치의 줄(묶음이면 그 묶음 전체)을 to 위치로 옮긴 새 배열과, 옮긴 뒤의 시작 인덱스.
// 옮길 수 없는 경우(제자리, 자기 묶음 안)에는 null을 돌려준다 — 호출부가 아무것도 안 하면 된다.
export function moveBlock(steps, from, to) {
  if (from === null || from === undefined || from === to) return null
  const len = blockLength(steps, from)
  if (to > from && to < from + len) return null   // 묶음을 자기 자신 안으로 떨어뜨릴 수는 없다

  // 접힌 묶음 머리글 위로 "끌어내리는" 경우: 머리글과 첫 멤버 사이는 화면에 없는 자리라,
  // 거기 넣으면 단계가 시야에서 사라진다("어디 갔지?" 사고). 접힌 묶음은 한 덩어리로 보고
  // 그 **뒤**에 놓는다. 위로 끌어올릴 때(from > to)는 머리글 앞(보이는 자리)이므로 그대로 둔다.
  // 펼친 묶음은 안이 보이니 기존대로 안으로 들어간다.
  let target = to
  if (to > from && steps[to]?.step_type === 'group' && steps[to]?.config?.collapsed) {
    target = to + blockLength(steps, to) - 1
  }

  const next = [...steps]
  const moved = next.splice(from, len)
  const insertAt = target > from ? target - len + 1 : target
  next.splice(insertAt, 0, ...moved)
  return { steps: next, index: insertAt }
}
