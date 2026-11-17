// **묶음 예약(환기방송 1차·2차)도 간편 화면에서 내보낼 수 있다**
// (V③ ENTRY-R1, HIGH, 2026-09-14).
//
// ── 무엇이 잘못됐나 ──────────────────────────────────────────────────────────
// 현관을 간편 화면으로 옮기면서 **옛 화면에만 있던 실행 경로가 숨겨졌다.**
// 옛 쉬운 화면(`ScheduledBroadcastMini`)은 묶음 줄에 **1차·2차 뱃지가 곧 단추**라
// 사람이 어느 차수를 낼지 골라 내보냈다. 간편 화면의 `HomeToday` 는 그 자리가 없다 —
// `todayRows.groupItems` 가 묶음 줄을 만들 때 **`id` 를 안 싣고**(`_isGroup` 만 싣는다),
// `broadcastTrigger.canTriggerRow` 가 `id == null` 을 거절하기 때문이다.
//
// **내가 "「지금 방송」으로 /calendar 에서 되니 중복 구현하지 않는다"고 적었던 것은 틀렸다.**
// 그 단추는 `ScheduledBroadcast.jsx:244` 에서 **`_isAuto` 일 때만** 그려진다. 일반 예약은
// 토글·수정·삭제뿐이다. 검수관이 실행으로 잡았고(더미 묶음 2건으로 `canTriggerRow=false`),
// 브라우저에서 내가 본 「지금 방송」은 **자동방송 줄의 것**이었다.
//
// 현장의 예약 6건은 **전부 환기방송이고 3쌍의 묶음**이다. 즉 이 화면에서 예약을 손으로
// 다시 내보낼 길이 **하나도 없었다.**
//
// ── 이 시험이 보는 것 ────────────────────────────────────────────────────────
// 화면을 렌더하지 않고 **판단하는 함수들을 실제로 돌린다** — 묶음을 만들고, 그 줄의
// 각 차수가 내보낼 수 있는 것으로 나오는지 본다. 소스 대조가 아니다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

/**
 * ESM 파일 몇 개를 이어 붙여 CJS 로 돌려 받는다 — 이 저장소는 번들러를 시험에 안 들인다.
 * **의존 파일을 함께 실어야 한다**(`todayRows` 가 `scheduleBatch` 를 부른다). 안 실으면
 * `batchSchedules is not defined` 로 죽는데, 그건 제품 결함이 아니라 이 하네스의 구멍이다.
 */
function 모듈(경로들, 이름들) {
  const src = 경로들.map(p => fs.readFileSync(path.join(ROOT, p), 'utf8'))
    .join('\n')
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/\bexport\s+(async\s+)?(function|const|let|class)\b/g, '$1$2')
  return new Function(src + '\n; return { ' + 이름들.join(', ') + ' }')()
}

const { groupItems }    = 모듈(['src/lib/scheduleBatch.js', 'src/lib/todayRows.js'], ['groupItems'])
const { canTriggerRow } = 모듈(['src/lib/broadcastTrigger.js'], ['canTriggerRow'])

/**
 * 현장 모양 그대로 — 환기방송 한 쌍(1차 09:10 · 2차 09:20).
 * 묶는 열쇠는 **`group_id`**(밑줄)다. `groupId` 로 적으면 안 묶이고, 그러면 이 시험이
 * 「묶음이 아니라서 통과」하는 가짜 초록이 된다 — 실제로 한 번 그렇게 걸렸다.
 */
const 환기한쌍 = () => ([
  { kind: 'schedule', id: 12, group_id: 'g1', time: '09:10', label: '환기방송', type: 'text', status: 'pending' },
  { kind: 'schedule', id: 17, group_id: 'g1', time: '09:20', label: '환기방송', type: 'text', status: 'pending' },
])

test('긍정 앵커 — 묶이지 않은 예약 한 건은 내보낼 수 있다', () => {
  const rows = groupItems([환기한쌍()[0]])
  assert.equal(rows.length, 1, '줄이 하나여야 한다')
  assert.equal(canTriggerRow(rows[0]), true,
    '홑 예약조차 못 내보낸다 — 이 시험의 전제가 깨졌다')
})

test('환기 한 쌍은 한 줄로 묶인다 — 화면 규칙은 그대로다', () => {
  const rows = groupItems(환기한쌍())
  assert.equal(rows.length, 1, '두 차수가 한 줄로 안 묶였다')
  assert.equal(rows[0]._isGroup, true, '묶음 표식이 없다')
  assert.equal(rows[0]._items.length, 2, '묶음이 두 차수를 안 들고 있다')
})

test('**묶음의 각 차수를 내보낼 수 있다** — 손으로 다시 낼 길이 있어야 한다', () => {
  const rows = groupItems(환기한쌍())
  const 차수들 = rows[0]._items
  for (const [i, item] of 차수들.entries()) {
    assert.equal(canTriggerRow(item), true,
      `${i + 1}차(${item.time})를 못 내보낸다 — 환기방송이 안 나갔을 때 손으로 다시 낼 길이 없다`)
  }
})

test('묶음 줄 자체에는 발사 단추를 달지 않는다 — 어느 차수인지 모른다', () => {
  const rows = groupItems(환기한쌍())
  assert.equal(canTriggerRow(rows[0]), false,
    '묶음 줄 통째로 내보낼 수 있게 돼 있다 — 1차인지 2차인지 안 물어보고 나간다')
})

test('화면이 그 차수들을 실제로 그린다 — 규칙만 있고 단추가 없으면 소용없다', () => {
  const T = fs.readFileSync(path.join(ROOT, 'src/components/home/HomeToday.jsx'), 'utf8')
  const 코드 = T.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드, /_isGroup/, '묶음 줄을 가르는 자리가 화면에 없다')
  assert.match(코드, /_items\.map\(/, '묶음의 차수들을 하나씩 그리지 않는다')
  assert.match(코드, /setAsk\(/, '긍정 앵커 — 확인 한 단계를 거치는 자리가 있다')
  // **확인 없이 나가는 길을 만들지 않는다**(G-42) — 차수 단추도 같은 문을 지나야 한다.
  assert.doesNotMatch(코드, /onClick=\{\(\)\s*=>\s*triggerRow\(/,
    '확인창을 건너뛰고 바로 발사하는 자리가 생겼다')
})
