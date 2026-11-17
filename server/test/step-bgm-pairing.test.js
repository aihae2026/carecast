'use strict'
// BGM 을 TTS 단계 안으로 접는 규칙 (UX-16, 2026-09-11).
//
// **이 검사가 지키는 것은 하나다 — 화면만 접고 방송은 안 바뀐다.**
// 자동방송 5종은 현장에서 매일 나간다. 편집기가 헷갈린다는 이유로 단계 배열을 건드리면
// 고치려던 것보다 훨씬 비싼 것을 바꾸게 된다. 그래서 아래 첫 두 검사가 제일 중요하다:
// 입력 배열이 그대로인가, 원소가 **같은 객체**인가.
//
// 원소를 사본으로 뜨면 조용히 망가진다 — 호출부가
// `steps.map(s => s.id === id ? {...s, x} : s)` 로 갱신하는데 화면이 다른 객체를 들고 있으면
// **화면은 바뀌는데 저장은 안 되는** 종류의 어긋남이 난다. 빨간불도 안 뜬다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

// ESM 모듈을 CJS 로 바꿔 평가한다(이 저장소는 프런트가 ESM, 테스트가 CJS 다).
// **`export` 를 지우기 전에 그 낱말이 코드 밖에 없는지 먼저 본다** — 주석·문자열 안의
// `export` 까지 지우면 엉뚱한 것을 평가하고도 초록이 난다.
function 모듈로드(상대경로, 이름들) {
  const src = fs.readFileSync(path.join(ROOT, 상대경로), 'utf8')
  const 줄들 = src.split('\n')
  const export줄 = 줄들.filter((l) => /^export (const|function) /.test(l))
  assert.ok(export줄.length >= 2, `${상대경로} 에서 export 를 못 찾았다 — 이 가드를 옮길 것`)
  const 평가본 = src.replace(/^export (const|function) /gm, '$1 ')
  return new Function(`${평가본}\nreturn { ${이름들.join(', ')} }`)()
}
const { 카드묶기, 카드이동, bgm요약 } =
  모듈로드('src/lib/stepBgmPairing.js', ['카드묶기', '카드이동', 'bgm요약'])

// 화면 쪽 판별 함수와 **같은 규칙**을 쓴다. 사본을 만들지 않으려고 실제 소스에서 읽는다.
const CONST_SRC = fs.readFileSync(
  path.join(ROOT, 'src/components/admin/sections/morningEditorConst.js'), 'utf8')
const BGM_IDS = new Set(
  /const BGM_STEP_IDS = new Set\(\[([^\]]*)\]/.exec(CONST_SRC)[1]
    .match(/'([^']+)'/g).map((s) => s.slice(1, -1)))
const isBgm = (s) => BGM_IDS.has(s.id)

// **`isTts` 도 실제 소스에서 읽는다** (2026-09-11 독립 검수 지적).
//
// 처음엔 손으로 쓴 정규식(`/_tts\d?$|^date_weather_schedule$|_prayer_intro$/`)을 뒀다.
// 위 머리말이 "사본을 만들지 않으려고 실제 소스에서 읽는다"고 적어 두고 **결정적인 술어
// 하나를 사본으로 뜬 것**이다. 그리고 그 사본이 틀렸다 — `TTS_STEP_KEYS` 에
// **`date_weather_schedule` 이 없다**. 그래서 이 검사는 프로덕션이 만들지 않는 짝
// (`bgm → date_weather_schedule`)을 정답으로 고정했고, 그 가짜로 읽은 사실이
// 모듈 주석과 커밋 메시지에까지 옮겨 적혔다. CLAUDE.md 「가드는 따라 옮긴다」가 말하는
// **조용한 초록**의 교과서적인 예다.
const TTS_IDS = new Set(
  /const TTS_STEP_KEYS = new Set\(\[([^\]]*)\]/.exec(CONST_SRC)[1]
    .match(/'([^']+)'/g).map((s) => s.slice(1, -1)))
const isTts = (s) => TTS_IDS.has(s.id) || s.customType === 'tts' || s.customType === 'message'

// 사본이 아니라는 것을 검사 자체로 고정한다 — 다시 손으로 쓰면 여기서 걸린다.
test('판별 술어를 사본으로 뜨지 않는다 — 실제 소스에서 읽는다', () => {
  assert.ok(TTS_IDS.has('morning_prayer_intro'), 'TTS_STEP_KEYS 를 못 읽었다')
  assert.ok(!TTS_IDS.has('date_weather_schedule'),
    'date_weather_schedule 이 TTS 로 잡힌다 — 프로덕션 hasTtsInline 과 어긋난다')
  assert.ok(TTS_IDS.size >= 12, `TTS 키가 ${TTS_IDS.size}개뿐이다 — 읽는 규칙이 어긋났다`)
})

// ── 가장 중요한 둘 — 방송이 안 바뀐다 ──────────────────────────────────────
test('입력 배열을 건드리지 않는다 — 나가는 순서는 그대로다', () => {
  const steps = [
    { id: 'bgm', enabled: true, order: 0 },
    { id: 'exercise_tts', enabled: true, order: 1 },
    { id: 'exercise_video', enabled: true, order: 2 },
  ]
  const 원본 = JSON.parse(JSON.stringify(steps))
  카드묶기(steps, isBgm, isTts)
  assert.deepEqual(steps, 원본, '접기가 단계 배열을 바꿨다 — 방송 순서가 달라진다')
})

test('카드가 원소를 사본으로 뜨지 않는다 — 갱신이 조용히 안 먹는 일이 없게', () => {
  const tts = { id: 'exercise_tts', enabled: true }
  const bgm = { id: 'bgm', enabled: true }
  const 카드 = 카드묶기([bgm, tts], isBgm, isTts)
  assert.equal(카드[0].step, tts, 'TTS 원소가 다른 객체다')
  assert.equal(카드[0].bgm, bgm, 'BGM 원소가 다른 객체다')
})

// ── 짝짓기 ────────────────────────────────────────────────────────────────
test('BGM 은 자기 뒤의 첫 TTS 에 붙고, 목록에서는 사라진다', () => {
  const 카드 = 카드묶기([
    { id: 'bgm' }, { id: 'exercise_tts' }, { id: 'exercise_video' },
  ], isBgm, isTts)
  assert.equal(카드.length, 2, 'BGM 이 접히지 않아 카드가 셋이다')
  assert.equal(카드[0].step.id, 'exercise_tts')
  assert.equal(카드[0].bgm.id, 'bgm', 'BGM 이 TTS 에 안 붙었다')
  assert.equal(카드[1].step.id, 'exercise_video')
  assert.equal(카드[1].bgm, null)
})

test('붙어 있는 BGM 만 접는다 — 사이에 다른 단계가 끼면 안 접는다', () => {
  // **아침 방송의 실제 모양이다**([FACT] EV-003907).
  // `date_weather_schedule` 은 TTS 가 아니라(`TTS_STEP_KEYS` 에 없다) 첫 BGM 과
  // `morning_prayer_intro` 사이에 **끼어 있다.** 그래서 첫 BGM 은 **접히지 않고** 제 카드로 남는다.
  //
  // 기대값이 두 번 바뀐 자리다. 처음엔 가짜 술어가 만든 `bgm→date_weather_schedule`,
  // 다음엔 건너뛰기 규칙이 만든 `bgm→morning_prayer_intro`. **둘 다 틀렸다.**
  // 건너뛰면 카드 순서가 배열 순서를 거짓으로 보여주고, 카드를 옮길 때마다 BGM 이
  // 날씨 안내 뒤로 밀린다(EV-003906). 아래 '카드 순서 = 배열 순서' 검사가 그것을 막는다.
  const 카드 = 카드묶기([
    { id: 'bgm' }, { id: 'date_weather_schedule' }, { id: 'morning_prayer_intro' },
    { id: 'morning_prayer' },
    { id: 'bgm_after' }, { id: 'medication_tts' },
  ], isBgm, isTts)
  const 붙은것 = 카드.filter((c) => c.bgm).map((c) => [c.step.id, c.bgm.id])
  assert.deepEqual(붙은것, [['medication_tts', 'bgm_after']],
    '떨어져 있는 BGM 을 접었다 — 카드 순서가 배열 순서를 거짓으로 보여준다')
  // 안 접힌 BGM 은 제 카드로 **남아 있어야** 한다. 사라지면 방송에는 나가는데 화면엔 없다.
  assert.ok(카드.some((c) => c.step.id === 'bgm'), '안 접힌 BGM 이 화면에서 사라졌다')
  // 접힌 쪽은 카드로 두 번 나오면 안 된다
  assert.ok(!카드.some((c) => c.step.id === 'bgm_after'), '접힌 BGM 이 카드로도 남아 두 번 보인다')
})

test('**카드 순서 = 배열 순서.** 카드를 그대로 펼치면 원래 배열이 나온다', () => {
  // 이 저장소에서 가장 중요한 불변식이다. 이것이 깨지면 `카드이동` 이 덩어리를
  // 재조립할 때 **건드리지도 않은 앞쪽이 바뀌고, 나가는 소리가 달라진다**(EV-003906).
  // 붙어 있을 때만 접으면 카드 하나가 배열의 **연속한 구간**이 되어 구조적으로 보장된다.
  const 경우들 = [
    ['아침', ['bgm', 'date_weather_schedule', 'morning_prayer_intro', 'morning_prayer',
              'breakfast_prayer_tts', 'bgm_after', 'medication_tts', 'morning_video']],
    ['체조', ['bgm', 'exercise_tts', 'exercise_video']],
    ['떨어진 BGM 둘', ['bgm', 'morning_prayer', 'bgm_after', 'medication_tts']],
    ['BGM 이 맨 뒤', ['exercise_tts', 'bgm']],
    ['BGM 연속', ['bgm', 'bgm_after', 'exercise_tts']],
  ]
  for (const [이름, ids] of 경우들) {
    const steps = ids.map((id) => ({ id }))
    const 카드 = 카드묶기(steps, isBgm, isTts)
    const 펼침 = 카드.flatMap((c) => (c.bgm ? [c.bgm, c.step] : [c.step]))
    assert.deepEqual(펼침.map((s) => s.id), ids,
      `[${이름}] 카드를 펼치면 배열과 달라진다 — 카드 순서가 거짓말을 한다`)
    // `시작` 도 그 불변식 위에서만 뜻이 있다: 접혔으면 바로 앞칸이다
    for (const c of 카드) {
      assert.equal(c.시작, c.bgm ? c.index - 1 : c.index,
        `[${이름}] ${c.step.id} 의 시작 이 카드의 첫 줄이 아니다`)
    }
  }
})

test('BGM 둘이 TTS 하나 앞에 몰려 있어도 겹쳐서 사라지지 않는다', () => {
  // 이 검사의 뜻: **어느 BGM도 화면에서 사라지지 않는다.** 사라진 쪽은 방송에는 계속 나간다.
  // 어느 쪽이 접히는지는 규칙에 따라 달라진다 — 붙어 있는 쪽(`bgm_after`)이 접히고
  // 떨어진 쪽(`bgm`)은 제 카드로 남는다.
  const 카드 = 카드묶기([
    { id: 'bgm' }, { id: 'bgm_after' }, { id: 'exercise_tts' },
  ], isBgm, isTts)
  assert.equal(카드.find((c) => c.step.id === 'exercise_tts').bgm.id, 'bgm_after',
    '붙어 있는 BGM 이 안 접혔다')
  assert.ok(카드.some((c) => c.step.id === 'bgm'),
    '떨어진 BGM 이 화면에서 사라졌다 — 방송에는 나간다')
})

test('카드가 원래 배열 번호를 실어 준다 — 드래그·삽입이 그 번호로 돈다', () => {
  // 접혀서 짧아진 카드 목록의 번호를 화면이 쓰면 **엉뚱한 자리로 옮겨진다.**
  // 화면에서만 접는다는 전제가 깨지는 유일한 자리다.
  const 카드 = 카드묶기([
    { id: 'bgm' },                   // 0 — 다음이 TTS 가 아니라 **안 접힌다**
    { id: 'date_weather_schedule' }, // 1 — TTS 가 아니다
    { id: 'morning_prayer_intro' },  // 2
    { id: 'bgm_after' },             // 3 — 바로 뒤가 TTS 라 접힌다
    { id: 'medication_tts' },        // 4
  ], isBgm, isTts)
  assert.deepEqual(카드.map((c) => c.index), [0, 1, 2, 4],
    '접힌 뒤의 카드가 원래 배열 번호를 잃었다 — 순서 바꾸기가 어긋난다')
})

test('뒤에 TTS 가 없으면 접지 않는다 — 억지로 앞에 붙이지 않는다', () => {
  const 카드 = 카드묶기([
    { id: 'exercise_tts' }, { id: 'exercise_video' }, { id: 'bgm' },
  ], isBgm, isTts)
  assert.equal(카드.length, 3, '붙을 곳이 없는데 접었다')
  assert.equal(카드[2].step.id, 'bgm')
  assert.equal(카드[0].bgm, null, '앞쪽 TTS 에 거꾸로 붙었다')
})

test('BGM 단독 방송은 접지 않는다 — 그 자체로 하나의 방송이다', () => {
  const 카드 = 카드묶기([
    { id: 'custom1', customType: 'bgm' }, { id: 'exercise_tts' },
  ], isBgm, isTts)
  assert.equal(카드.length, 2)
  assert.equal(카드[0].step.customType, 'bgm', '단독 BGM 이 TTS 안으로 접혔다')
  assert.equal(카드[1].bgm, null)
})

test('빈 배열·잘못된 입력에서 죽지 않는다', () => {
  assert.deepEqual(카드묶기([], isBgm, isTts), [])
  assert.deepEqual(카드묶기(null, isBgm, isTts), [])
  assert.deepEqual(카드묶기(undefined, isBgm, isTts), [])
})

// ── 요약 배지 ─────────────────────────────────────────────────────────────
// 2026-09-21: 요약은 소스가 아니라 **폴더(용도)** 를 말한다 — BGM 은 늘 이 PC 음원이다(BGM_ROLE_OPTIONS 와 같은 모양)
const 소스목록 = [{ id: 'broadcast', label: '방송용 BGM' }, { id: 'meal', label: '식사용 BGM' }]

test('꺼진 BGM 은 꺼졌다고 먼저 말한다', () => {
  assert.equal(bgm요약({ enabled: false, bgmRole: 'meal', durationSec: 30 }, 소스목록),
    'BGM 꺼짐', '꺼진 BGM 이 켜진 것처럼 보인다')
})

test('켜진 BGM 은 폴더와 시간을 말한다', () => {
  assert.equal(bgm요약({ enabled: true, bgmRole: 'meal', durationSec: 30 }, 소스목록),
    '식사용 BGM · 30초')
  // 폴더를 안 고른 단계는 서버가 방송 종류로 정한다 — 요약이 짐작해 적지 않는다
  assert.equal(bgm요약({ enabled: true, durationSec: 0 }, 소스목록), 'BGM',
    '0초(무제한)인데 "0초"라고 적었다')
  assert.equal(bgm요약(null, 소스목록), '')
})

// ── 화면이 실제로 이 모듈을 쓰는가 (긍정 앵커) ─────────────────────────────
test('StepList 가 이 규칙을 쓴다 — 만들어 놓고 안 잇는 일이 없게', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  // `assert.match` 를 안 쓴다 — 실패하면 6만 자짜리 파일 전문을 출력에 쏟아붓는다.
  assert.ok(/from '\.\.\/\.\.\/\.\.\/lib\/stepBgmPairing'/.test(src), '짝짓기 모듈을 안 불러온다')
  assert.ok(/카드묶기\(/.test(src), '짝짓기를 안 쓴다')
  // **짝짓기 규칙을 화면에 다시 적지 않는다** — 두 벌이 되면 곧 갈린다.
  // (파일 전체에서 `for (let j = i + 1` 을 금지하지 않는다 — 드래그 정렬이 쓰는
  //  무관한 루프가 이미 `:542` 에 있다. 좁혀서 "짝짓기를 다시 하는가"만 본다.)
  assert.equal((src.match(/카드묶기\(/g) || []).length, 1,
    '짝짓기를 두 자리에서 부른다 — 한 번만 묶고 그 결과를 쓴다')
  assert.ok(!/hasBgmInline\([^)]*\)\s*&&\s*hasTtsInline/.test(src),
    '화면이 BGM·TTS 를 직접 훑어 짝을 다시 만든다')
})

test('접힌 BGM 이 화면에서 사라지는 자리가 없다 — 사라져도 방송에는 나간다', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')

  // ① TTS 단계를 꺼도 BGM 칸이 남는가.
  //    `showTts && step.enabled` 게이트 **안에** 넣으면 TTS 를 끄는 순간 사라진다.
  //    그 게이트는 파일에서 딱 한 번 열리므로, 토글이 그보다 **앞**에 있으면 밖이다.
  const 토글자리 = src.indexOf('aria-label="이 안내에 BGM 재생"')
  const 게이트자리 = src.indexOf('{showTts && step.enabled && (')
  assert.ok(토글자리 > 0, 'BGM 토글을 못 찾았다 — 이 가드를 옮길 것')
  assert.ok(게이트자리 > 0, 'showTts 게이트를 못 찾았다 — 이 가드를 옮길 것')
  assert.ok(토글자리 < 게이트자리,
    'BGM 칸이 TTS 활성화 게이트 안에 있다 — TTS 를 끄면 사라지는데 방송에는 나간다')
  assert.ok(/이 안내는 꺼져 있지만/.test(src),
    'TTS 가 꺼졌는데 BGM 만 켜진 상태를 화면이 말하지 않는다')

  // ② 카드가 접혀 있을 때 요약에 나오는가.
  assert.ok(/\{!isExpanded && \(summary \|\| 접힌BGM\)/.test(src),
    '카드가 접혀 있으면 BGM 이 어디에도 안 보인다')

  // ③ BGM 설정 UI 가 두 벌이 아닌가 — 부품 하나를 양쪽이 쓴다.
  assert.equal((src.match(/^function BgmSourceFields\(/gm) || []).length, 1,
    'BGM 설정 부품이 하나가 아니다')
  assert.ok((src.match(/<BgmSourceFields \{\.\.\.bgm속성\(/g) || []).length >= 2,
    '부품을 만들어 놓고 한 자리에서만 쓴다 — 나머지가 사본으로 남았을 수 있다')
  // 2026-09-22: 폴더 버튼 줄이 아래로 펼치는 목록(BgmFolderSelect, 즉시방송·예약과 같은 부품)으로 바뀌었다.
  assert.equal((src.match(/<BgmFolderSelect /g) || []).length, 1,
    'BGM 폴더 목록이 두 벌이다 — 곧 갈린다')
})

test('토글이 BGM 단계의 enabled 만 건드린다 — 새 저장 규칙을 만들지 않는다', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  const m = /aria-label="이 안내에 BGM 재생"/.exec(src)
  assert.ok(m, 'BGM 토글을 못 찾았다 — 이 가드를 옮길 것')
  // 토글은 기존 `toggleStep`(= enabled 뒤집기) 하나만 부른다.
  assert.ok(/onClick=\{e => \{ e\.stopPropagation\(\); toggleStep\(접힌BGM\.id\) \}\}/.test(src),
    '토글이 toggleStep 이 아닌 다른 저장 경로를 쓴다 — 실행 모델이 바뀐다')
})

test('기본 순서 5종에서 어느 BGM도 화면에서 사라지지 않는다', () => {
  // **이 검사의 전제를 한 번 고쳤다.** 처음엔 "붙박이 BGM 은 예외 없이 짝을 찾는다"를
  // 고정했는데, 그것은 수용 기준이 아니라 **건너뛰기 규칙의 부산물**이었다.
  // 진짜 수용 기준은 *"BGM은 TTS 단계 안의 토글이다"* + 이 저장소의 상위 규칙
  // **"화면에서 사라진 것이 방송에는 나가면 안 된다"** 다.
  // 붙어 있을 때만 접으면 아침 첫 BGM 은 짝이 없다 — 그래도 **제 카드로 보인다.**
  // 그것이 맞는 결과다(EV-003907).
  const m = /const DEFAULT_STEPS = \{([\s\S]*?)\n\}/.exec(CONST_SRC)
  assert.ok(m, 'DEFAULT_STEPS 를 못 찾았다 — 이 가드를 옮길 것')
  const 방송들 = m[1].split(/\n {2}\w+: \[/).slice(1)
  assert.ok(방송들.length >= 5, `방송이 ${방송들.length}종뿐이다 — 읽는 규칙이 어긋났다`)

  let 붙박이BGM = 0
  let 접힘 = 0
  let 제카드 = 0
  for (const 본문 of 방송들) {
    const steps = (본문.match(/\{ id: '([^']+)'/g) || []).map((s) => ({ id: /'([^']+)'/.exec(s)[1] }))
    const 카드 = 카드묶기(steps, isBgm, isTts)
    붙박이BGM += steps.filter(isBgm).length
    접힘 += 카드.filter((c) => c.bgm).length
    제카드 += 카드.filter((c) => isBgm(c.step)).length

    // **핵심 단언**: 접힌 것 + 제 카드로 남은 것 = 배열에 있는 BGM 전부.
    // 하나라도 모자라면 그 BGM 은 화면에서 사라진 채 방송에는 나간다.
    const 보이는BGM = 카드.filter((c) => c.bgm).map((c) => c.bgm.id)
      .concat(카드.filter((c) => isBgm(c.step)).map((c) => c.step.id)).sort()
    assert.deepEqual(보이는BGM, steps.filter(isBgm).map((s) => s.id).sort(),
      'BGM 하나가 화면에서 사라졌다 — 방송에는 나간다')

    // **카드 순서 = 배열 순서** 도 5종 전부에서 본다(위 검사는 만든 예시, 여기는 실제 데이터).
    const 펼침 = 카드.flatMap((c) => (c.bgm ? [c.bgm, c.step] : [c.step])).map((s) => s.id)
    assert.deepEqual(펼침, steps.map((s) => s.id),
      '카드를 펼치면 배열과 달라진다 — 카드를 옮길 때마다 방송 순서가 조용히 바뀐다')
  }
  // 10 = 아침 2(bgm·bgm_after) + 체조 1 + 점심 2(bgm_start·bgm) + 저녁 2(bgm_start·bgm)
  //      + 저녁 마무리 3(bgm·bgm_closing·bgm_final). [FACT] morningEditorConst.js 직독 10건.
  assert.equal(붙박이BGM, 10, `붙박이 BGM 이 ${붙박이BGM}개다 — 기본 순서가 바뀌었다`)
  assert.equal(접힘 + 제카드, 10, `보이는 BGM 이 ${접힘 + 제카드}개다 — ${10 - 접힘 - 제카드}개가 사라졌다`)
  // [FACT] EV-003907 — 아침 첫 BGM 만 안 접힌다(날씨 안내가 끼어 있다). 나머지 9개는 접힌다.
  assert.equal(접힘, 9, `접힌 것이 ${접힘}개다 — 붙어 있는 짝의 수가 바뀌었다`)
  assert.equal(제카드, 1, `제 카드로 남은 BGM 이 ${제카드}개다 — 아침 첫 BGM 하나여야 한다`)
})

// ── 접기가 만든 구멍 둘 — 검수를 기다리지 않고 스스로 찾은 것 ──────────────

test('카드를 옮기면 접힌 BGM 이 따라간다 — 남으면 엉뚱한 안내에 반주가 달린다', () => {
  const steps = [
    { id: 'bgm' },                   // 0 — morning_prayer_intro 에 접힘
    { id: 'morning_prayer_intro' },  // 1
    { id: 'morning_prayer' },        // 2
    { id: 'medication_tts' },        // 3
  ]
  // TTS(1)를 medication_tts(3) 자리로 옮긴다. BGM 은 함께 가야 한다.
  const 결과 = 카드이동(steps, 1, 3, isBgm, isTts)
  assert.deepEqual(결과.map((s) => s.id),
    ['morning_prayer', 'medication_tts', 'bgm', 'morning_prayer_intro'],
    'BGM 이 원래 자리에 남았다 — 다음 TTS 에 가서 붙는다')
  // 옮긴 뒤에도 짝이 유지되는가
  const 카드 = 카드묶기(결과, isBgm, isTts)
  assert.equal(카드.find((c) => c.step.id === 'morning_prayer_intro').bgm.id, 'bgm',
    '옮긴 TTS 가 반주를 잃었다')
  assert.equal(카드.find((c) => c.step.id === 'medication_tts').bgm, null,
    '엉뚱한 안내에 반주가 붙었다')
})

test('카드이동이 원본을 안 바꾸고, 옮길 것이 없으면 원본 그대로 준다', () => {
  const steps = [{ id: 'bgm' }, { id: 'exercise_tts' }, { id: 'exercise_video' }]
  const 원본 = JSON.parse(JSON.stringify(steps))
  const r = 카드이동(steps, 1, 2, isBgm, isTts)
  assert.deepEqual(steps, 원본, '이동이 입력 배열을 건드렸다')
  assert.notEqual(r, steps, '옮겼는데 같은 배열을 돌려줬다')
  // 접힌 BGM 자체의 번호(0)를 주면 아무것도 안 한다 — 짝이 깨진다
  assert.equal(카드이동(steps, 0, 2, isBgm, isTts), steps, '접힌 BGM 을 따로 옮겼다')
  assert.equal(카드이동(steps, 1, 1, isBgm, isTts), steps, '제자리인데 새 배열을 만들었다')
})

test('화면이 카드 단위로 옮긴다 — 배열을 직접 splice 하지 않는다', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  const m = /const moveStep = \(from, to\) => \{([\s\S]*?)\n {2}\}/.exec(src)
  assert.ok(m, 'moveStep 을 못 찾았다 — 이 가드를 옮길 것')
  assert.ok(/카드이동\(steps, from, to, hasBgmInline, hasTtsInline\)/.test(m[1]),
    'moveStep 이 카드이동을 안 쓴다 — 접힌 BGM 이 제자리에 남는다')
  assert.ok(!/next\.splice\(/.test(m[1]),
    'moveStep 이 배열을 직접 splice 한다 — 한 줄만 움직인다')
})

test('BGM 설정 부품이 모듈 최상단에 있다 — 안에 두면 글자마다 포커스가 튄다', () => {
  // 컴포넌트 본문에서 만든 컴포넌트는 렌더마다 **새 타입**이라 React 가 같은 것으로 못 본다.
  // 그러면 키워드 입력칸이 글자 하나 칠 때마다 언마운트·리마운트되어 한 글자밖에 못 친다.
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  const 최상단 = src.indexOf('\nfunction BgmSourceFields(')
  const StepList시작 = src.indexOf('\nfunction StepList(')
  assert.ok(최상단 > 0, 'BgmSourceFields 가 모듈 최상단 함수 선언이 아니다')
  assert.ok(최상단 < StepList시작,
    'BgmSourceFields 가 StepList 뒤/안에 있다 — 렌더마다 새 타입이 된다')
  // 입력칸이 그 부품 안에 있어야 이 검사가 뜻이 있다 (긍정 앵커) — 시작·재생 시간 숫자 칸
  const 본문 = src.slice(최상단, StepList시작)
  assert.ok(/type="number"/.test(본문) && /onDelay\(/.test(본문),
    '숫자 입력칸이 이 부품 안에 없다 — 이 가드를 옮길 것')

  // **밖으로 뺐다는 것만으로는 부족하다** — 안쪽에 **래퍼 컴포넌트**가 남아 있으면
  // 그 래퍼가 렌더마다 새 타입이라 아래를 통째로 리마운트한다. 결과는 안 고친 것과 같다.
  // [FACT] EV-003916 — 실제로 그랬다. 브라우저에서 한 글자씩 쳐 보고서야 알았다
  // (여섯 글자 모두 `같은노드=false · 포커스유지=false`). 소스만 보면 "됐다"로 읽힌다.
  // 주석에 "예전엔 이랬다"고 적는 것은 괜찮다 — **코드 줄**만 본다.
  const StepList본문 = src.slice(StepList시작)
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  const 안쪽컴포넌트 = StepList본문.match(/const [A-Z]\w*\s*=\s*\(?\{?[^)]*\)?\s*=>\s*\(?\s*</g) || []
  assert.deepEqual(안쪽컴포넌트, [],
    `StepList 안에 컴포넌트가 정의돼 있다(${안쪽컴포넌트.join(', ')}) — 렌더마다 새 타입이라 `
    + '그 아래 입력칸이 글자마다 리마운트된다. 속성 묶음(bgm속성 같은 것)만 만들어라.')
})

// ── 순서 조작 전부가 카드 기준인가 (2026-09-11 독립 검수 지적) ─────────────
//
// `카드이동` 은 `moveStep` 만 고쳤다. 검수가 **↑↓ 버튼과 ＋ 삽입도 같은 규칙을 봐야
// 한다**고 짚었고 맞았다 — 배열 번호로 두면:
//   · 첫 카드의 번호가 1 이라 ↑ 가 살아 있고, 눌러도 **화면은 그대로인데 배열만 바뀐다**
//   · ＋ 가 접힌 BGM 과 TTS **사이**로 끼어들어 새 단계가 그 BGM 을 가져간다

test('카드가 배열에서 시작하는 자리를 알려준다 — ＋ 가 카드 위에 넣도록', () => {
  const 카드 = 카드묶기([
    { id: 'date_weather_schedule' },// 0 — TTS 아님. 제 카드
    { id: 'bgm_after' },            // 1 — 바로 뒤가 TTS 라 접힘
    { id: 'medication_tts' },       // 2 — bgm_after 가 여기 붙는다
  ], isBgm, isTts)
  const 붙은카드 = 카드.find((c) => c.step.id === 'medication_tts')
  assert.equal(붙은카드.index, 2, 'index 는 TTS 의 자리다')
  assert.equal(붙은카드.시작, 1, '시작 이 접힌 BGM 의 자리가 아니다 — ＋ 가 카드 안으로 들어간다')
  // 접힌 BGM 이 없으면 둘이 같다
  const 민카드 = 카드.find((c) => c.step.id === 'date_weather_schedule')
  assert.equal(민카드.시작, 민카드.index)
  // **＋ 자리가 카드 순서대로 늘어난다** — 어긋나면 위쪽 ＋ 가 아래쪽에 넣는다
  const 시작들 = 카드.map((c) => c.시작)
  assert.deepEqual(시작들, [...시작들].sort((a, b) => a - b), 'ㅡ 자리가 뒤죽박죽이다')
})

test('화면의 순서 조작이 전부 카드 기준이다 — 배열 번호를 직접 쓰지 않는다', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  // 긍정 앵커 — 카드 목록을 한 번만 만들어 쓴다
  assert.equal((src.match(/카드묶기\(steps, hasBgmInline, hasTtsInline\)/g) || []).length, 1,
    '카드 목록을 두 번 만든다 — 렌더마다 갈릴 수 있다')

  assert.ok(/disabled=\{ci === 0\}/.test(src),
    '↑ 가 배열 번호로 잠긴다 — 첫 카드에서 살아 있어 화면 없이 방송만 바뀐다')
  assert.ok(/disabled=\{ci === 카드목록\.length - 1\}/.test(src), '↓ 가 배열 번호로 잠긴다')
  assert.ok(/moveStep\(i, 카드목록\[ci - 1\]\.index\)/.test(src), '↑ 가 앞 카드가 아니라 앞 줄로 간다')
  assert.ok(/moveStep\(i, 카드목록\[ci \+ 1\]\.index\)/.test(src), '↓ 가 뒤 카드가 아니라 뒤 줄로 간다')
  assert.ok(/\{renderInserter\(시작\)\}/.test(src),
    '＋ 가 카드 안(접힌 BGM 과 TTS 사이)에 넣는다')
  // 옛 모양이 남아 있지 않은가
  assert.ok(!/disabled=\{i === 0\}/.test(src), '옛 ↑ 조건이 남아 있다')
  assert.ok(!/moveStep\(i, i - 1\)|moveStep\(i, i \+ 1\)/.test(src), '옛 ↑↓ 목적지가 남아 있다')
})

test('드래그가 옮긴 뒤 실제 자리를 다시 잡는다', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  const m = /const onDragOver = \(e, i\) => \{([\s\S]*?)\n {2}\}/.exec(src)
  assert.ok(m, 'onDragOver 를 못 찾았다 — 이 가드를 옮길 것')
  assert.ok(/setDragIdx\(next\.indexOf\(끌던것\)\)/.test(m[1]),
    '목적지 번호를 그대로 쓴다 — 카드가 두 줄이면 다음 dragover 가 엉뚱한 것을 집는다')
})

// ── UX-16 ① 토글 안에서 **시작**도 정한다 (2026-09-11) ────────────────────
//
// 수용 기준은 *"토글을 켜면 **시작·종료 시간**을 그 자리에서 정한다"* 인데, 화면에는
// **재생 시간(종료)만** 있었다. 시작을 정할 자리가 없어서 반쪽이었다.
//
// 값은 새로 만들지 않았다 — `bgm_delay` 가 **이미 서버까지 이어져 있다**
// (`broadcastSteps.js` 가 커스텀 BGM 단계에 실어 보내고 `flowRunner.js` 가 그 초만큼
// 기다린 뒤 안내를 낸다). 화면에만 없었다. 그래서 **이름도 서버가 읽는 것을 그대로 쓴다** —
// 화면 전용 이름을 새로 만들면 저장할 때 한 번 더 옮겨 적어야 하고, 그 자리가 어긋난다.
test('UX-16 — BGM 토글 안에 시작(선행 초)과 재생 시간이 둘 다 있다', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/sections/StepList.jsx'), 'utf8')
  const m = /function BgmSourceFields\(\{([^}]*)\}\)([\s\S]*?)\n\}/.exec(src)
  assert.ok(m, 'BgmSourceFields 를 못 찾았다 — 이 가드를 옮길 것')

  assert.match(m[1], /onDelay/, '시작을 바꿀 창구가 없다 — 종료만 정할 수 있다')
  assert.match(m[2], /bgm\.bgm_delay/, '시작 값을 안 읽는다')
  assert.match(m[2], /durationSec/, '재생 시간(종료)이 사라졌다 — 있던 것을 잃으면 안 된다')

  // 이름이 서버와 같은가. 화면 전용 이름을 만들면 저장 경로에서 한 번 더 옮겨야 한다.
  assert.match(src, /bgm_delay: v/, '바꾼 값을 서버가 읽는 이름으로 안 넣는다')

  // 기본값은 서버의 `|| 5` 와 같아야 한다 — 화면과 실제가 갈리면 사람이 본 숫자와
  // 나가는 소리가 다르다(이 저장소가 볼륨에서 겪은 그 실패다).
  assert.match(m[2], /bgm\.bgm_delay \?\? 5/, '화면 기본값이 서버 기본값(5초)과 다르다')
  const runner = fs.readFileSync(path.join(ROOT, 'server/services/flowRunner.js'), 'utf8')
  assert.match(runner, /Number\(item\.bgm_delay\) \|\| 5/,
    '서버의 선행 기본값이 바뀌었다 — 화면 기본값도 같이 봐야 한다')
})
