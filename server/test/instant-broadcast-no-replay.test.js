// **즉시 방송이 「매일 그 시각에 나가는 예약」을 남기지 않는다**
// (사용자 신고 2026-09-14: *"지금 방송으로 한 번 내보냈는데 몇 분 뒤 다시 나왔다"*).
//
// ── 무엇이 잘못됐나 ──────────────────────────────────────────────────────────
// 「지금 말하기」는 초안을 `emptySchedule()` 위에 얹어 만든다. 그런데 그 기본값은
// **새 예약을 만들 때의 기본값**이다:
//   · `scheduled_time` = `다음자리시각()` → **다음 5분 자리**(지금이 13:01 이면 13:05)
//   · `repeat_weekdays` = `[0..6]` → **매일**
// 즉시 방송은 그 초안으로 예약을 만들고 **수동 트리거**로 쏘는데,
// `finishScheduleFire` 는 `_manual` 이면 `last_fired` 도 안 찍고 `active=0` 도 안 한다
// (수동재생이 예약을 지우면 안 되므로 — 그 자체는 옳다).
//
// 그래서 예약 행이 **활성 · 매일 · 몇 분 뒤 시각**으로 살아남는다:
//   ① 1~5분 뒤 그 시각이 되면 스케줄러가 **같은 방송을 다시 쏜다** ← 사용자가 본 증상
//   ② 그것으로 끝이 아니다 — **내일도 모레도 같은 시각에 나간다**
//
// 문장 파서 경로는 이미 옳게 하고 있었다(`schedulePhrase.js:331,403`):
// 즉시면 `scheduled_time = 지금`, `repeat_weekdays = []`. **두 경로가 갈려 있었다.**
//
// ── 이 시험이 보는 것 ────────────────────────────────────────────────────────
// 소스를 읽지 않는다. **제품 함수를 실제로 돌려** 초안을 만들고, 그 초안이 스케줄러의
// 판정(`shouldRunToday` · 시각 일치 · `active`)에 걸리는지 **계산한다.**
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { shouldRunToday, isOneTime } = require('../services/repeatSchedule')

/**
 * ESM 을 이어 붙여 CJS 로 돌린다.
 *
 * **아이콘만 대역으로 세운다.** `scheduleUtils` 는 최상위에서 `lucide-react` 아이콘을 표에
 * 담는데, 우리가 보는 계산(시각·반복·활성)은 그것을 **한 번도 안 쓴다.** 그래서 이름만
 * 있으면 된다. 다른 import 는 세우지 않는다 — 필요한 것을 대역으로 덮으면 **제품이 아니라
 * 내 대역을 시험하게 된다**(이 저장소가 여러 번 데인 가짜 오라클).
 */
function 모듈(경로들, 이름들) {
  const 원본 = 경로들.map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n')
  const 아이콘 = [...원본.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*'lucide-react'/gm)]
    .flatMap(m => m[1].split(',').map(s => s.trim()).filter(Boolean))
  const 대역 = 아이콘.length ? `const ${[...new Set(아이콘)].map(n => `${n} = null`).join(', ')}\n` : ''
  const src = 대역 + 원본
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/\bexport\s+(async\s+)?(function|const|let|class)\b/g, '$1$2')
  return new Function(src + '\n; return { ' + 이름들.join(', ') + ' }')()
}

const { emptySchedule, 다음자리시각 } =
  모듈(['src/lib/scheduleUtils.js'], ['emptySchedule', '다음자리시각'])
const { 빠른초안 } = 모듈(['src/lib/quickStart.js'], ['빠른초안'])

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const 오늘 = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 스케줄러가 이 예약을 "지금 쏠 것"으로 고르는가 — 조회 조건을 그대로 계산한다. */
function 스케줄러가쏘나(초안, 시각) {
  if (!초안.active) return false                       // WHERE active = 1
  if (초안.scheduled_time !== 시각) return false        // AND scheduled_time = ?
  return shouldRunToday({ ...초안, repeat_start_date: 초안.repeat_start_date ?? 오늘() })
}

test('긍정 앵커 — 빠른 단추가 즉시 초안을 만든다', () => {
  const 초안 = 빠른초안('tts', emptySchedule(), new Date(2026, 8, 14, 13, 1))
  assert.ok(초안, '즉시 초안이 안 만들어진다 — 이 시험의 전제가 깨졌다')
  assert.equal(초안.immediate, true, '즉시 표식이 없다')
  assert.equal(초안.broadcast_type, 'text', '안내 음성이 아니다')
})

test('즉시 방송은 **1회성**이다 — 매일 반복으로 남으면 내일도 나간다', () => {
  const 초안 = 빠른초안('tts', emptySchedule(), new Date(2026, 8, 14, 13, 1))
  assert.equal(isOneTime(초안), true,
    `즉시 방송이 매일 반복으로 만들어진다(repeat_weekdays=${JSON.stringify(초안.repeat_weekdays)}) `
    + '— 한 번 누른 시험 방송이 **매일 같은 시각에** 나간다')
})

test('즉시 방송은 **미래 시각으로 예약되지 않는다** — 몇 분 뒤 다시 나오는 길', () => {
  // **시계를 주입해서 묻는다**(V③ REPLAY-R2). 벽시계로 비교하면 자정 경계나 분이 넘어가는
  // 순간에 흔들린다 — 그건 제품이 아니라 시험이 흔들리는 것이다.
  const 시계 = new Date(2026, 8, 14, 13, 1)
  const 초안 = 빠른초안('tts', emptySchedule(), 시계)
  assert.equal(초안.scheduled_time, hhmm(시계),
    `즉시 방송의 예약 시각이 「지금」이 아니다(${초안.scheduled_time}) `
    + '— 미래 시각이면 그때 스케줄러가 같은 방송을 한 번 더 쏜다')
})

test('**재현** — 발사 뒤 그 시각이 와도 스케줄러가 다시 쏘지 않는다', () => {
  const 초안 = 빠른초안('tts', emptySchedule(), new Date(2026, 8, 14, 13, 1))
  // 수동 트리거는 `_manual` 이라 `last_fired`·`active` 를 안 건드린다(그 규칙은 안 바꾼다).
  const 발사뒤 = { ...초안 }
  assert.equal(스케줄러가쏘나(발사뒤, 초안.scheduled_time), false,
    `예약 시각(${초안.scheduled_time})이 되면 스케줄러가 **같은 방송을 다시 쏜다** — `
    + `active=${발사뒤.active} · 1회성=${isOneTime(발사뒤)} · 시각=${발사뒤.scheduled_time}`)
})

test('내일도 안 나간다 — 하루가 지나도 살아남지 않는다', () => {
  const 시계 = new Date(2026, 8, 14, 13, 1)
  const 초안 = 빠른초안('tts', emptySchedule(), 시계)
  const 내일 = new Date(시계.getTime() + 24 * 3600 * 1000)
  const 살아있나 = !!초안.active &&
    shouldRunToday({ ...초안, repeat_start_date: 초안.repeat_start_date ?? 오늘() }, 내일)
  assert.equal(살아있나, false,
    '한 번 누른 즉시 방송이 **내일도** 같은 시각에 나간다')
})

test('다른 빠른 단추(차임·BGM·순서)도 같다 — 안내 음성만의 문제가 아니다', () => {
  for (const id of ['chime', 'bgm', 'flow']) {
    const 초안 = 빠른초안(id, emptySchedule(), new Date(2026, 8, 14, 13, 1))
    assert.equal(isOneTime(초안), true, `${id} 즉시 초안이 매일 반복이다`)
    assert.equal(!!초안.active, false, `${id} 즉시 초안이 활성으로 남아 스케줄러에 잡힌다`)
  }
})

test('예약(즉시 아님) 기본값은 안 건드린다 — 새 예약은 여전히 다음 5분 자리·매일', () => {
  const 기본 = emptySchedule()
  assert.equal(기본.scheduled_time, 다음자리시각(),
    '새 예약의 기본 시각이 바뀌었다 — 즉시 방송만 고치는 것이 이번 범위다')
  assert.deepEqual(기본.repeat_weekdays, [0, 1, 2, 3, 4, 5, 6],
    '새 예약의 기본 반복이 바뀌었다')
  assert.equal(기본.active, 1, '새 예약이 비활성으로 만들어진다')
})

// ── **검색으로 채운 즉시 초안도 예약으로 안 남는다** (V③ R7 지적, 2026-09-14) ────────
// 빠른 단추만 고쳤더니 **다른 문이 열려 있었다.** 검색창(`run`)은 `emptySchedule()` 위에
// 서버 결과를 얹는데, 그 기본값은 **새 예약의 것**이라 `active: 1` · 다음 5분 자리 ·
// 매일 반복이 되살아난다. 즉시 카드에서 "지금 안내방송 해줘"를 검색하면 **활성 예약으로
// 저장**되고 — **그것이 2026-09-14 현장 신고 그 자체다.**
//
// 규칙이 두 곳에 각자 적혀 있으면 이렇게 한쪽만 고쳐진다. 이제 `즉시실행값` 한 곳이 정한다.
const { 즉시실행값 } = 모듈(['src/lib/quickStart.js'], ['즉시실행값'])

test('**검색이 얹은 즉시 초안**도 1회성·비활성이다 — 다른 문으로 되살아나지 않는다', () => {
  const 시계 = new Date(2026, 8, 14, 13, 1)
  // 검색 경로가 하는 일 그대로: 밑바탕 위에 서버가 읽은 값을 얹는다
  const 합친 = { ...emptySchedule(), title: '즉시 안내방송', immediate: true, broadcast_type: 'text' }
  assert.equal(합친.active, 1, '긍정 앵커 — 밑바탕은 활성이다(그래서 맞춰 줘야 한다)')

  const 초안 = 즉시실행값(합친, 시계)
  assert.equal(초안.scheduled_time, hhmm(시계),
    '검색으로 채운 즉시 방송이 **미래 시각**으로 예약된다 — 그때 한 번 더 나간다')
  assert.deepEqual(초안.repeat_weekdays, [], '매일 반복으로 남는다 — 내일도 나간다')
  assert.equal(!!초안.active, false, '활성 예약으로 남는다 — 스케줄러가 그 시각에 다시 쏜다')
  assert.equal(초안.broadcast_type, 'text', '유형을 잃었다')
  assert.equal(스케줄러가쏘나(초안, 초안.scheduled_time), false,
    '스케줄러가 이 초안을 다시 쏜다')
})

test('예약(즉시 아님)은 이 맞춤을 **안 지난다** — 지나면 영영 안 울린다', () => {
  const 예약 = { ...emptySchedule(), immediate: false }
  assert.equal(예약.active, 1, '예약은 활성으로 남아야 한다')
  assert.equal(예약.scheduled_time, 다음자리시각(), '예약의 기본 시각이 바뀌었다')
})
