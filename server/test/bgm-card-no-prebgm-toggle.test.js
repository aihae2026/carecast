// 배경음악 카드에는 **「BGM 재생」가 없다** (사용자 지시 2026-09-14).
//
// ── 왜 ───────────────────────────────────────────────────────────────────────
// 그 토글은 *"이 방송 **앞에** 반주를 깔까"* 를 묻는 것이다. 그런데 배경음악 방송은
// **그 자체가 반주**다 — 음악 앞에 음악을 깔지 묻는 셈이라 뜻이 없다.
// 안내 음성(`text`)·예약처럼 그 물음이 성립하는 카드에서는 **그대로 둔다.**
//
// ── 지우는 것이 아니라 **안 묻는 것**이다 ────────────────────────────────────
// 이미 저장된 예약의 `bgm_enabled` 값을 건드리지 않는다(사용자 지시: *"숨기는 과정에서
// 저장된 방송 설정을 지우지 마라"*). 화면이 안 물을 뿐, 값은 그대로 실려 간다.
// 그래서 `setDraft(... bgm_enabled: 0 ...)` 같은 **되돌리기를 심지 않는다** —
// 이 저장소가 볼륨에서 세운 원칙과 같다(되돌릴 상태를 만들지 않는다).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = fs.readFileSync(path.join(ROOT, 'src/components/shared/QuickSchedulePhrase.jsx'), 'utf8')
const 코드만 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('긍정 앵커 — 그 토글이 이 카드에 있다', () => {
  assert.match(코드만, /BGM 재생/, '토글 자체가 사라졌다 — 다른 카드에서도 못 쓰게 됐다')
  assert.match(코드만, /bgm_enabled: e\.target\.checked \? 1 : 0/, '토글의 동작이 바뀌었다')
})

// **앵커가 옮겨졌다**(2026-09-15). 조건이 화면에 박힌 식에서 공용 규칙
// `BGM물음이있나()` 로 바뀌었다 — 같은 날 **순서(flow)** 에서도 안 묻기로 하면서,
// 두 화면(빠른 카드·예약 모달)이 같은 규칙을 봐야 했기 때문이다.
//
// **약하게 한 것이 아니다.** 이 시험이 막으려는 것(배경음악 카드에서 묻는 것)은
// 그대로이고, 규칙 자체는 `bgm-toggle-scope.test.js` 가 **값으로** 문다
// (`BGM물음이있나('bgm') === false`). 여기서는 **화면이 그 규칙을 지나는지**만 본다.
test('배경음악 방송일 때는 그 토글을 **안 그린다**', () => {
  const i = 코드만.indexOf('BGM 재생')
  const 앞 = 코드만.slice(Math.max(0, i - 1600), i)
  assert.match(앞, /BGM물음이있나\(draft\.broadcast_type\) && \(/,
    '배경음악 방송에서도 「BGM 재생」를 묻는다 — 음악 앞에 음악을 깔지 묻는 꼴이다')

  // 그 규칙이 실제로 배경음악을 거르는지 **불러서** 확인한다. 화면이 규칙을 지나도
  // 규칙이 무르면 소용없다 — 소스 대조만으로는 그것을 못 본다.
  const { BGM물음이있나 } = require('../../src/lib/scheduleUtils.js')
  assert.equal(BGM물음이있나('bgm'), false, '규칙이 배경음악을 안 거른다')
})

test('안내 음성·예약 카드에서는 그대로 묻는다 — 범위를 넘지 않는다', () => {
  // 규칙이 좁아지면 예약의 다른 유형(음원·영상 등)에서 물음이 사라진다.
  const { BGM물음이있나 } = require('../../src/lib/scheduleUtils.js')
  for (const t of ['text', 'audio', 'video', 'youtube-tv']) {
    assert.equal(BGM물음이있나(t), true,
      `${t} 에서 물음이 사라졌다 — 음원·영상 예약에서 반주를 못 고르게 된다`)
  }
})

test('값을 지우는 되돌리기를 심지 않는다 — 저장된 설정은 그대로다', () => {
  assert.doesNotMatch(코드만, /bgm_enabled:\s*0\s*\}\)\s*\)?\s*\}?\s*,?\s*\[/,
    '유형이 바뀔 때 bgm_enabled 를 0 으로 되돌리는 자리가 생겼다')
  const 되돌림 = [...코드만.matchAll(/bgm_enabled:\s*0/g)].length
  assert.equal(되돌림, 0, `bgm_enabled 를 0 으로 쓰는 자리가 ${되돌림}군데 있다 — 저장된 설정을 지운다`)
})
