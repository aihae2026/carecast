'use strict'
// **「BGM 재생」을 묻는 자리는 그 값이 실제로 읽히는 유형뿐이다** (사용자 결정 2026-09-15).
//
// ── 무엇이 문제였나 ────────────────────────────────────────────────────────
// 「순서」(`flow`) 예약에도 「방송 전 YouTube BGM」 체크박스가 떴다. 그런데 **서버는
// 흐름 갈래에서 그 값을 안 읽는다** — `scheduler.js` 의 `broadcastType === 'flow'` 는
// `runFlow()` 를 부르고 **그 자리에서 return** 하고, BGM 을 푸는 `resolveBGM()` 은
// 그 아래에 있어서 아예 안 지난다.
//
// 그래서 사람이 체크하고 저장하면 **그 시각에 아무 음악도 안 나간다.** 오류도 안 난다 —
// 이 저장소가 가장 비싸게 치는 **조용한 오독**이다.
//
// ── 사용자 결정: 묻지 않는다 ───────────────────────────────────────────────
// *"그냥 BGM 토글을 순서에서 없애는 게 낫지 않아?"*
//
// 맞다. 안 먹는 칸을 남겨 두면 다음 사람이 또 켠다. 그리고 흐름의 BGM 은 **흐름 안에**
// 「BGM 시작」 단계로 이미 있다 — 한 가지를 두 곳에서 설정하게 만들지 않는다(볼륨에서
// 세운 원칙과 같다).
//
// ── 「안 묻는 것」이지 「지우는 것」이 아니다 ───────────────────────────────
// 이미 저장된 `bgm_enabled` 는 안 건드린다. 화면이 물음을 감춘다고 값을 0 으로
// 되돌리면, 카드를 한 번 열었다 닫은 것만으로 남의 설정이 사라진다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { BGM물음이있나 } = require('../../src/lib/scheduleUtils.js')

test('**BGM 이 실제로 읽히는 유형에서는 그대로 묻는다**', () => {
  // 이 넷은 「이 방송 앞에 반주를 깔까」가 성립하는 유형이다.
  for (const t of ['text', 'audio', 'video', 'youtube-tv']) {
    assert.equal(BGM물음이있나(t), true, `${t} 에서 BGM 물음이 사라졌다`)
  }
  // 유형이 아직 안 정해졌으면 기본은 안내 음성이다.
  assert.equal(BGM물음이있나(undefined), true, '유형이 비면 물음이 사라진다')
  assert.equal(BGM물음이있나(''), true)
})

test('**순서(flow)에서는 안 묻는다** — 서버가 그 값을 안 읽는다', () => {
  assert.equal(BGM물음이있나('flow'), false,
    '순서에 BGM 을 물어본다 — 체크해도 아무 음악이 안 나간다')
})

test('배경음악(bgm)에서도 안 묻는다 — 음악 앞에 음악을 깔지 묻는 꼴이다', () => {
  assert.equal(BGM물음이있나('bgm'), false)
})

// ── 이 시험의 **전제**를 소스로 고정한다 ───────────────────────────────────
// 「순서에서는 안 묻는다」가 맞는 이유는 **서버가 안 읽기 때문**이다. 서버가 읽도록
// 바뀌면 이 결정을 다시 해야 하므로, 그때 빨간불이 나야 한다.
test('**전제** — 스케줄러의 흐름 갈래는 BGM 을 풀기 전에 빠져나간다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/services/scheduler.js'), 'utf8')
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  const 흐름 = 코드만.indexOf("if (broadcastType === 'flow')")
  assert.ok(흐름 > 0, '흐름 갈래를 못 찾았다 — 이 시험의 전제가 무너졌다')

  const 해석 = 코드만.indexOf('resolveBGM(', 흐름)
  assert.ok(해석 > 0, 'resolveBGM 을 못 찾았다 — 이 시험의 전제가 무너졌다')

  // 흐름 갈래 안에 `return` 이 있고, 그것이 resolveBGM 보다 **앞**이어야 한다.
  const 빠져나감 = 코드만.indexOf('return', 흐름)
  assert.ok(빠져나감 > 0 && 빠져나감 < 해석,
    '흐름 갈래가 이제 BGM 해석까지 내려간다 — 「순서에서는 안 묻는다」를 다시 판단할 것')

  // 흐름 갈래 안에서 bgm_enabled 를 읽기 시작했으면 그것도 신호다.
  const 갈래본문 = 코드만.slice(흐름, 해석)
  assert.ok(!갈래본문.includes('bgm_enabled'),
    '흐름 갈래가 bgm_enabled 를 읽기 시작했다 — 화면에서 다시 물어야 할 수도 있다')
})

test('**두 화면이 같은 규칙을 쓴다** — 한 곳만 고치면 거기서만 뜬다', () => {
  for (const p of [
    ['components', 'shared', 'ScheduleModal.jsx'],
    ['components', 'shared', 'QuickSchedulePhrase.jsx'],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8')
    const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(코드만.includes('BGM물음이있나('),
      `${p.join('/')} 가 공용 규칙을 안 쓴다 — 거기서만 순서에 BGM 이 뜬다`)
  }
})

test('**값을 지우지는 않는다** — 화면이 0 으로 되돌리지 않는다', () => {
  // 물음을 감추면서 `bgm_enabled: 0` 을 써 넣으면, 카드를 한 번 열었다 닫은 것만으로
  // 남의 설정이 사라진다. 볼륨에서 세운 원칙과 같다(되돌릴 상태를 만들지 않는다).
  for (const p of [
    ['components', 'shared', 'ScheduleModal.jsx'],
    ['components', 'shared', 'QuickSchedulePhrase.jsx'],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8')
    const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(!/BGM물음이있나\([^)]*\)\s*\?[^:]*:\s*\{[^}]*bgm_enabled:\s*0/.test(코드만),
      `${p.join('/')} 가 물음을 감추면서 값을 0 으로 되돌린다`)
  }
})
