// 오늘 일과방송 목록을 **줄로 접고, 다음에 나갈 항목을 고르는 규칙** — 순수 모듈.
//
// **왜 화면에서 떼어 냈나**: 이 계산이 `HomeToday.jsx` 안에 있었을 때는 JSX 라서 노드에서
// 못 돌렸고, 그래서 회귀 시험이 **소스를 글자로 읽는 것**뿐이었다. V③ Codex 검수가
// 2026-09-13 에 그 시험을 깨뜨려 보였다 — `findNextItem` 의 **본문**을 `return null` 로
// 바꿔도, 완료 항목을 고르도록 바꿔도 **시험 5건이 전부 통과**했다. 규칙의 이름과 부르는
// 자리만 보고 있었지 **무엇을 고르는지는 한 번도 안 봤다.** 가짜 오라클이다.
// `guideMap.js`·`scheduleBatch.js` 와 같은 결로 순수 모듈로 내려서 실제로 돌려 본다.
//
// 묶는 규칙 자체는 `scheduleBatch` 를 그대로 쓴다 — 화면마다 복사하면 같은 방송이
// 화면에 따라 한 줄로도 두 줄로도 보인다.
import { batchSchedules } from './scheduleBatch.js'

/**
 * 항목 목록을 화면에 그릴 **줄**로 접는다.
 *
 * 한 건짜리 줄에도 `_items` 를 달아 둔다 — "이 줄이 그 항목을 담고 있나"를 묶음이든
 * 아니든 **한 규칙으로** 묻기 위해서다(`_items.includes`).
 *
 * @param {object[]} items 서버가 시각 순으로 준 오늘 항목
 * @returns {object[]} 줄 목록
 */
export function groupItems(items) {
  return batchSchedules(items, 'time').map(batch => {
    if (batch.items.length === 1) return { ...batch.items[0], _items: [batch.items[0]] }
    const sorted = batch.items
    return {
      _isGroup: true, key: `group_${batch.groupId}`, _items: sorted,
      time: sorted[0].time, _time_end: sorted[sorted.length - 1].time,
      label: sorted[0].label, kind: sorted[0].kind, type: sorted[0].type,
      // 묶음의 상태 — 하나라도 안 나갔으면 그게 보여야 한다(누락 > 대기 > 완료)
      status: sorted.some(i => i.status === 'missed') ? 'missed'
            : sorted.some(i => i.status === 'pending') ? 'pending'
            : sorted.some(i => i.status === 'unknown') ? 'unknown'
            : 'done',
    }
  })
}

/**
 * 다음에 나갈 **항목**을 찾는다. 묶은 줄이 아니라 항목에서 찾는 것이 핵심이다.
 *
 * 묶은 줄의 상태는 "누락 > 대기 > 완료"로 덮어쓰기 때문에, 09:10 이 안 나가고 09:20 이
 * 아직 남은 묶음은 줄 전체가 `missed` 가 된다. 줄에서 `pending` 을 찾으면 **그 묶음이
 * 통째로 건너뛰어져** "오늘 남은 방송 없음"이 뜬다 — 아직 나갈 방송이 있는데도.
 * 반대로 09:10 이 나가고 09:20 이 남은 묶음은 줄의 시각(09:10)을 "다음"으로 보여 준다.
 * 둘 다 **사람에게 틀린 말을 하는 것**이라 항목 단위로 찾는다.
 * (V③ Codex 검수 2026-09-13, medium)
 *
 * 서버가 이미 시각 순으로 준다 — 여기서 다시 정렬하지 않는다.
 *
 * @param {object[]} items 서버가 시각 순으로 준 오늘 항목
 * @returns {object|null} 아직 `pending` 인 첫 항목. 없으면 null
 */
export function findNextItem(items) {
  return (items ?? []).find(i => i.status === 'pending') || null
}

/**
 * `findNextItem` 이 고른 항목을 **담고 있는 줄**을 찾는다.
 *
 * 줄과 항목을 잇는 자리를 여기 한 곳에 둔다 — 화면이 `_items` 의 생김새를 직접 알면
 * 줄 만드는 규칙이 바뀔 때 조용히 어긋난다.
 */
export function findRowOf(rows, item) {
  if (!item) return null
  return (rows ?? []).find(r => r._items?.includes(item)) || null
}
