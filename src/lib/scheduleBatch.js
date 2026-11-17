// 같은 묶음(group_id)으로 짝지어진 예약을 **한 줄로 접는 규칙** — 화면 셋이 함께 쓴다.
//
// 환기방송은 1차·2차로 나뉘어 하루 여섯 줄(09:10·09:20·12:00·12:10·17:00·17:10)을 차지한다.
// 주간표에서는 그게 한 요일에 여섯 칸이라, 실제로 하는 일보다 훨씬 복잡해 보였다.
// 오늘방송일정은 이미 접어서 "1차/2차"로 보여주고 있었는데 그 규칙이 그 파일 안에만 있었다.
//
// **묶는 것은 서버가 이미 한다.** db/schema.js가 '환기'가 든 예약 중 20분 이내 쌍에 같은
// group_id를 넣어 둔다. 여기서 하는 것은 그것을 화면에서 접을지 말지의 판정뿐이다.
//
// **접는 판정만 한다 — 무엇을 어떻게 그릴지는 화면이 정한다.** 세 화면이 보여주는 것이
// 서로 다르다(오늘일정은 상태 배지, 주간표는 칩, 예약목록은 작업 버튼). 그리는 것까지
// 여기로 끌고 오면 세 화면의 사정이 이 파일에 다 들어온다.
//
// 규칙을 화면마다 복사하지 않는 이유: 한쪽만 고쳐지는 순간 같은 방송이 화면에 따라 한 줄로도
// 두 줄로도 보인다. flowGroups.js와 같은 이유로 순수 모듈로 두고 테스트로 고정한다.

// 이 안에 몰려 있을 때만 접는다. 아침·저녁처럼 멀리 떨어진 같은 묶음은 각각 보여야
// 언제 나가는지 알 수 있다.
export const BATCH_WINDOW_MIN = 20

export function timeToMins(t) {
  const [h, m] = String(t).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return h * 60 + m
}

/**
 * 예약 목록을 "한 줄로 보여줄 덩어리"로 나눈다.
 *
 * @param {object[]} items    예약 목록
 * @param {string}   timeKey  시각이 담긴 필드 이름. 화면마다 다르다
 *                            (오늘일정은 `time`, 주간표·예약목록은 `scheduled_time`).
 * @returns {{groupId: string|null, items: object[]}[]}
 *          첫 항목 시각 순으로 정렬. `items.length > 1`이면 접어서 보여줄 것,
 *          `groupId`가 null이면 혼자 있는 줄이다.
 */
export function batchSchedules(items, timeKey = 'time') {
  const byGroup = new Map()
  const order = []

  for (const item of items ?? []) {
    const gid = item?.group_id
    if (!gid) { order.push({ groupId: null, items: [item] }); continue }
    if (!byGroup.has(gid)) {
      const bucket = { groupId: gid, items: [] }
      byGroup.set(gid, bucket)
      order.push(bucket)
    }
    byGroup.get(gid).items.push(item)
  }

  const result = []
  for (const bucket of order) {
    if (bucket.groupId === null) { result.push(bucket); continue }

    const sorted = [...bucket.items]
      .sort((a, b) => String(a[timeKey]).localeCompare(String(b[timeKey])))
    const span = timeToMins(sorted[sorted.length - 1][timeKey]) - timeToMins(sorted[0][timeKey])

    // 혼자 있는 묶음을 "1·2차"로 보여주면 거짓말이 된다. 시각을 못 읽으면(NaN) 접지 않는다 —
    // 판정할 수 없을 때 접는 쪽으로 기울면 있지도 않은 2차가 있는 것처럼 보인다.
    if (sorted.length > 1 && span >= 0 && span <= BATCH_WINDOW_MIN) {
      result.push({ groupId: bucket.groupId, items: sorted })
    } else {
      for (const item of sorted) result.push({ groupId: null, items: [item] })
    }
  }

  return result.sort((a, b) =>
    String(a.items[0]?.[timeKey]).localeCompare(String(b.items[0]?.[timeKey])))
}
