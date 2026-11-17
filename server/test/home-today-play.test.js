// 오늘 일과의 **수동재생** — 되돌릴 수 없는 것을 어떻게 내보내나 (2026-09-13).
//
// 사용자 지시: *"오늘일과방송에 수동재생 버튼 구현해놔"*.
// 한 번 사라졌던 기능이다 — 독립검수가 *"재생 아이콘인데 실제로는 화면 이동"* 이라고 잡았을 때
// **라벨이 아니라 기능을 없애는 쪽으로** 풀어서 요구받은 버튼이 통째로 빠졌다.
// 되살리면서 지키는 것 셋을 여기 고정한다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT    = path.join(__dirname, '..', '..')
const TODAY   = path.join(ROOT, 'src', 'components', 'home', 'HomeToday.jsx')
const TRIGGER = path.join(ROOT, 'src', 'lib', 'broadcastTrigger.js')
const DIALOG  = path.join(ROOT, 'src', 'components', 'shared', 'ConfirmDialog.jsx')
const MINI    = path.join(ROOT, 'src', 'components', 'easy', 'ScheduledBroadcastMini.jsx')

const read = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n')
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

test('감시할 대상이 있다 — 오늘 목록에 「지금 내보내기」 단추가 있다', () => {
  assert.ok(fs.existsSync(TRIGGER), 'lib/broadcastTrigger.js 가 없다')
  assert.ok(fs.existsSync(DIALOG), 'shared/ConfirmDialog.jsx 가 없다')
  const code = codeOnly(read(TODAY))
  assert.match(code, /aria-label=\{`\$\{r\.label\} 지금 내보내기`\}/,
    '줄 끝 단추가 「지금 내보내기」가 아니다 — 사용자가 요구한 기능이 또 빠졌다')
})

test('**새 발사 경로를 만들지 않는다** — 기존 것만 부른다', () => {
  // 소리를 내는 길이 하나 늘면 정지·겹침·이력 규칙을 그만큼 또 지켜야 한다.
  // 여기 있는 것은 전부 `ScheduledBroadcastMini` 가 이미 쓰던 경로다.
  const t = codeOnly(read(TRIGGER))
  // **부를 때만** api 를 가져온다 — 맨 위에서 가져오면 이 파일이 브라우저 전용이 되어
  // 아래 판단 규칙을 시험이 실제로 못 돌린다(가짜 오라클이 된다).
  assert.match(t, /await import\('\.\/api\.js'\)/, '발사 경로를 api 에서 안 가져온다')
  const 부르는것 = [...t.matchAll(/'(trigger[A-Za-z]+)'/g)].map(m => m[1])
  const 허용 = new Set([
    'triggerMorningBroadcast', 'triggerExerciseBroadcast',
    'triggerLunchBroadcast', 'triggerDinnerBroadcast', 'triggerEveningPrayerBroadcast',
  ])
  assert.equal(부르는것.length, 5, `자동방송 발사 경로가 다섯이 아니다: ${부르는것.join(', ')}`)
  for (const f of 부르는것) {
    assert.ok(허용.has(f),
      `모르는 발사 경로를 부른다: ${f} — 새 길을 만들면 정지·겹침 규칙을 또 지켜야 한다`)
  }
  assert.match(t, /api\.triggerSchedule\(item\.id\)/, '예약 발사가 기존 경로가 아니다')
  // 화면이 api 를 직접 부르지 않는다 — 어느 경로로 나가는지의 판단은 한 곳이다
  const today = codeOnly(read(TODAY))
  assert.doesNotMatch(today, /triggerSchedule|triggerMorningBroadcast/,
    '화면이 발사 API 를 직접 부른다 — 판단이 두 벌이 된다')
  assert.match(today, /triggerRow\(ask\)/, '화면이 공용 발사 규칙을 안 쓴다')
})

test('**확인 없이 나가는 길이 없다** (G-42)', () => {
  const code = codeOnly(read(TODAY))
  // 단추는 묻기만 한다 — 누르는 순간 나가지 않는다
  assert.match(code, /onClick=\{\(\) => setAsk\(r\)\}/,
    '줄 끝 단추가 곧바로 발사한다 — 아이콘 하나로 전관 방송이 나간다')
  // 실제 발사는 확인 대화의 onConfirm 안에서만 일어난다
  const i = code.indexOf('<ConfirmDialog')
  assert.ok(i >= 0, '확인 대화가 없다')
  assert.ok(code.indexOf('triggerRow(ask)') > i,
    '발사가 확인 대화 밖에 있다')
  // 문구는 **무엇이·어디로**를 적는다
  assert.match(code, /전관 스피커로 내보냅니다/, '어디로 나가는지 안 적는다')
  assert.match(code, /되돌릴 수 없습니다/, '되돌릴 수 없다는 사실을 안 적는다')
  assert.match(code, /confirmLabel="지금 방송"/, '실행 단추 글자가 하는 일과 다르다')
})

test('확인 대화의 기본 초점은 「취소」다 — 엔터 한 번에 방송이 나가지 않는다', () => {
  // ── 가드가 코드를 따라간다 (2026-09-13) ────────────────────────────────────
  // 초점·Escape·`aria-modal` 은 창 열셋에 제각각 흩어져 있던 것을 **공용 부품 둘**로
  // 모았다(`ModalShell` + `useDialogA11y`). 그 전에는 여덟이 Escape 로 안 닫혔고
  // 초점이 돌아오는 것은 하나뿐이었다.
  //
  // 이 시험은 그 뒤로도 `ConfirmDialog.jsx` **한 파일만** 보며 옛 글자를 찾고 있었다 —
  // 동작은 멀쩡한데 빨간불이었다(CLAUDE.md "파일을 가를 때 — 가드는 따라 옮긴다").
  // 그래서 **두 층으로 나눠** 본다: 이 대화가 무엇을 부탁하는가 · 공용 부품이 그것을 하는가.
  const code = codeOnly(read(DIALOG))

  // ① 이 대화는 **「취소」를 첫 초점으로 지목한다**
  assert.match(code, /const cancelRef = useRef\(null\)/, '취소 단추를 가리킬 자리가 없다')
  assert.match(code, /첫초점=\{cancelRef\}/,
    '기본 초점이 취소가 아니다 — 실수로 엔터를 치면 방송이 나간다')
  assert.match(code, /<button ref=\{cancelRef\}[\s\S]{0,400}취소/,
    '첫 초점으로 지목한 것이 「취소」 단추가 아니다')
  assert.doesNotMatch(code, /window\.confirm/,
    'window.confirm 을 쓴다 — 문구를 못 고치고 기본 초점이 「확인」이다')

  // ② **공용 부품이 실제로 그 일을 한다** — 배선의 반대편(안 보면 부탁만 하고 끝난다)
  const shell = codeOnly(read(path.join(ROOT, 'src', 'components', 'shared', 'ModalShell.jsx')))
  const a11y  = codeOnly(read(path.join(ROOT, 'src', 'components', 'shared', 'useDialogA11y.js')))
  assert.match(code,  /<ModalShell/, '이 대화가 공용 창 부품을 안 쓴다')
  assert.match(shell, /aria-modal="true"/, '대화가 모달로 안 잡힌다')
  assert.match(a11y,  /첫초점\?\.current/, '공용 부품이 지목한 첫 초점을 안 쓴다')
  assert.match(a11y,  /e\.key !== 'Escape'|e\.key === 'Escape'/, 'Escape 로 못 닫는다')
})

test('발사 경로 판단이 한 곳뿐이다 — 쉬운 화면도 같은 것을 본다', () => {
  // 두 벌로 두면 한쪽만 고쳐지는 날이 오고, 그때 한 화면에서는 나가고 다른 화면에서는 안 나간다.
  const mini = codeOnly(read(MINI))
  // 같은 파일에서 **확인 뒤 판단**(확인뒤발사)도 함께 가져온다 — 이름이 늘어도 출처는 하나다.
  assert.match(mini, /import \{ AUTO_TRIGGER[^}]*\} from '\.\.\/\.\.\/lib\/broadcastTrigger'/,
    '쉬운 화면이 공용 발사 규칙을 안 쓴다')
  assert.doesNotMatch(mini, /triggerMorningBroadcast|triggerEveningPrayerBroadcast/,
    '쉬운 화면이 발사 경로 사본을 다시 들고 있다')
})

test('내보낼 수 없는 줄에는 단추가 없다 — 눌러도 아무 일이 없는 단추를 두지 않는다', async () => {
  const { pathToFileURL } = require('url')
  const { canTriggerRow } = await import(pathToFileURL(TRIGGER).href)
  assert.equal(canTriggerRow({ kind: 'auto', id: 'morning' }), true)
  assert.equal(canTriggerRow({ kind: 'auto', id: 'no_such_auto' }), false,
    '모르는 자동방송에 단추가 붙는다 — 누르면 조용히 아무 일도 안 일어난다')
  assert.equal(canTriggerRow({ kind: 'schedule', id: 12 }), true)
  assert.equal(canTriggerRow({ kind: 'schedule', id: null }), false)
  assert.equal(canTriggerRow(null), false)

  const code = codeOnly(read(TODAY))
  assert.match(code, /\{canTriggerRow\(r\) && \(/, '못 내보내는 줄에도 단추를 그린다')
})

// ── **쉬운 화면도 같은 규칙을 따른다** (V③ R19 지적 3 · 사용자 결정 2026-09-14) ──────────
//
// 무엇이 뚫려 있었나: G-42 의 「확인 한 단계」는 `HomeToday` 에만 있었고,
// **선생님들이 실제로 가장 많이 쓰는 쉬운 화면**(`ScheduledBroadcastMini`)에는 없었다.
// 그 화면의 수동재생 단추는 누르는 즉시 전관 방송을 발사했다 — `confirm` 이 한 글자도 없었다.
// 같은 동작인데 한 화면에는 안전장치가 있고 다른 화면에는 없는 상태였다.
//
// 사용자 결정 2026-09-14: **맞춘다.** 급할 때 한 번 더 누르는 비용보다,
// 잘못 눌러 전관 방송이 나가는 쪽이 되돌릴 수 없어서 더 비싸다.
test('쉬운 화면의 수동재생도 **확인 한 단계**를 거친다 (G-42)', () => {
  const mini = codeOnly(read(MINI))

  // ① 단추는 **묻기만** 한다 — 누르는 순간 발사하지 않는다
  assert.ok(!/onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleTriggerAuto\(s\) \}\}/.test(mini),
    '자동방송 단추가 곧바로 발사한다 — 누르면 그대로 전관 방송이다')
  assert.ok(!/onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleTriggerManual\(s\) \}\}/.test(mini),
    '예약 단추가 곧바로 발사한다')

  // ② 확인 대화가 있고, **발사는 그 안에서만** 일어난다.
  // 발사 창구는 이제 `확인뒤발사` 에 **넘겨진다**(직접 부르지 않는다) — 그래서 그 전달이
  // 확인 대화 안에 있는지를 본다. 실제 횟수는 아래 별도 시험이 대역으로 센다.
  const i = mini.indexOf('<ConfirmDialog')
  assert.ok(i >= 0, '쉬운 화면에 확인 대화가 없다 — 홈 화면과 규칙이 갈린다')
  assert.ok(mini.indexOf('자동발사: handleTriggerAuto', i) > i,
    '자동방송 발사가 확인 대화 밖에 있다 — 확인을 지나치는 길이 남아 있다')
  assert.ok(mini.indexOf('예약발사: handleTriggerManual', i) > i,
    '예약 발사가 확인 대화 밖에 있다')

  // ③ 문구는 **무엇이·어디로·되돌릴 수 없다**를 적는다 — 홈 화면과 같은 말로
  assert.match(mini, /전관 스피커로 내보냅니다/, '어디로 나가는지 안 적는다')
  assert.match(mini, /되돌릴 수 없습니다/, '되돌릴 수 없다는 사실을 안 적는다')

  // ④ **같은 공용 부품**을 쓴다 — 두 벌로 만들면 한쪽만 고쳐진다(오늘 세 번 겪은 모양)
  assert.match(mini, /import ConfirmDialog from/, '확인 대화를 따로 만들었다 — 공용 부품을 쓴다')
})

// ── **글자가 아니라 발사 횟수를 센다** (V③ R23 지적 1, 2026-09-14) ─────────────────────
//
// 위 시험은 소스를 읽는다. 검수관이 짚었다 — *"확인 전후 발사 횟수를 단언하지 않는다."*
// 맞는 말이다. 그래서 판단을 `lib/broadcastTrigger` 로 내리고 **발사 창구를 대역으로 갈아
// 끼워** 실제로 센다. 지켜야 하는 것은 하나다 —
// **확인 창이 닫혀 있는 동안 전관 방송이 나가는 길이 없어야 한다.**
test('확인 전에는 한 번도 안 부르고, 확인해야 정확히 한 번 부른다', async () => {
  const T = await import(
    'file:///' + path.join(ROOT, 'src', 'lib', 'broadcastTrigger.js').replace(/\\/g, '/'))

  const 부른것 = []
  const 창구 = {
    자동발사: async (줄) => 부른것.push(['자동', 줄.id]),
    예약발사: async (줄) => 부른것.push(['예약', 줄.id]),
  }

  // ① **확인 전** — 아직 아무것도 안 고른 상태다. 한 번도 안 부른다.
  for (const 빈것 of [null, undefined, {}, { 줄: null, 자동인가: true }]) {
    const r = await T.확인뒤발사(빈것, 창구)
    assert.equal(r.부름, 0, `확인 창이 닫혔는데 방송을 내보냈다: ${JSON.stringify(빈것)}`)
  }
  assert.deepEqual(부른것, [], '확인 전에 전관 방송이 나갔다 — 되돌릴 수 없는 일이다')

  // ② **확인 뒤** — 정확히 한 번, 맞는 창구로
  const 자동 = await T.확인뒤발사({ 줄: { id: 'auto_morning' }, 자동인가: true }, 창구)
  assert.deepEqual([자동.부름, 자동.어디], [1, '자동'])
  const 예약 = await T.확인뒤발사({ 줄: { id: 42 }, 자동인가: false }, 창구)
  assert.deepEqual([예약.부름, 예약.어디], [1, '예약'])
  assert.deepEqual(부른것, [['자동', 'auto_morning'], ['예약', 42]],
    '확인했는데 엉뚱한 창구를 부르거나 두 번 불렀다')

  // ③ **화면이 그 함수를 실제로 쓴다** — 제 안에서 따로 갈라 부르면 위가 무의미해진다
  const mini = codeOnly(read(MINI))
  assert.match(mini, /확인뒤발사\(이번것, \{ 자동발사: handleTriggerAuto, 예약발사: handleTriggerManual \}\)/,
    '화면이 확인뒤발사() 를 안 쓴다 — 판단이 두 벌이 된다')
  // **단추는 묻기만 한다** — 줄 끝 단추의 onClick 에 발사가 없어야 한다.
  // (정의 자체인 `const handleTriggerAuto = …` 는 부름이 아니다)
  for (const m of mini.matchAll(/onClick=\{[^}]*\}/g)) {
    assert.ok(!/handleTrigger(Auto|Manual)\s*\(/.test(m[0]),
      `단추가 곧바로 발사한다: ${m[0].slice(0, 80)}`)
  }
})
