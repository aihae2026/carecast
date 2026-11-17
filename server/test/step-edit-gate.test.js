// 순서편집기 — 단계 구성은 **잠겨 있고**, 「단계 편집」을 눌러야 고칠 수 있다 (2026-09-03).
//
// 왜 필요했나(사용자 지적): 내장 자동방송의 단계 목록은 늘 만질 수 있었다. 드래그(그리고 새로
// 생긴 위/아래 버튼)로 순서가 모르는 새 바뀐 채 「설정 저장」을 누르면 그대로 저장되고, 방송
// 순서가 바뀌었다는 것은 그날 방송이 나가고 나서야 안다. 커스텀 자동순서에는 이미 이 관문이
// 있다(미리보기는 읽기 전용, 고치려면 「단계 편집」) — 같은 규칙을 내장 쪽에도 세운다.
//
// 고정하는 사실 여섯:
//   1) 잠금이 기본이다 — 편집 상태의 초기값은 false이고, 잠겼을 때 카드가 inert가 된다
//   2) inert 하나로 통째로 막는다 — 컨트롤마다 disabled를 뿌리면 빠뜨리는 곳이 생긴다
//   3) 편집을 열 때 스냅샷을 뜬다 — 「취소」가 되돌릴 자리
//   4) 「취소」는 스냅샷으로 되돌릴 뿐 서버를 안 부른다
//   5) 저장하면 다시 잠긴다 — 열어 둔 채로 두면 관문이 있으나 마나다
//   6) 탭 이동은 switchTab을 지난다 — 편집이 풀리고, 저장 안 한 변경은 먼저 묻는다
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { editorSource } = require('./helpers/editorSource')

const SRC = editorSource()

test('사실1 — 잠금이 기본이고, 다섯 탭이 모두 관문을 쓴다', () => {
  assert.match(SRC, /const \[editingSteps,\s+setEditingSteps\]\s+= useState\(false\)/,
    '편집 상태가 없거나 기본이 열린 상태다')
  // 탭 하나라도 빼먹으면 그 방송만 잠기지 않는다 — 눈으로는 다섯을 다 열어 봐야 안다.
  const cards = SRC.match(/<StepsCard gate=\{gate\}>/g) || []
  assert.equal(cards.length, 5, `단계 카드가 다섯이어야 한다(지금 ${cards.length})`)
  const passed = SRC.match(/gate=\{stepsGate\}/g) || []
  assert.equal(passed.length, 5, '탭 콘텐츠 다섯 곳에 관문을 넘겨야 한다')
})

test('사실2 — inert 하나로 통째로 막는다', () => {
  const i = SRC.indexOf('function StepsCard')
  const body = SRC.slice(i, i + 4000)
  assert.match(body, /inert=\{!editing\}/,
    'inert가 없으면 잠긴 채로도 드래그·클릭·키보드가 먹는다')
})

test('사실3 — 편집을 열 때 스냅샷을 뜬다', () => {
  const i = SRC.indexOf('const startEditSteps =')
  assert.ok(i > 0, '편집 시작 함수가 없다')
  const body = SRC.slice(i, i + 300)
  assert.match(body, /setStepsSnapshot\(JSON\.stringify\(settings\)\)/,
    '스냅샷을 안 뜨면 「취소」가 되돌릴 자리가 없다')
  assert.match(body, /setEditingSteps\(true\)/)
})

test('사실4 — 「취소」는 되돌릴 뿐 서버를 안 부른다', () => {
  const i = SRC.indexOf('const cancelEditSteps =')
  assert.ok(i > 0, '취소 함수가 없다')
  const body = SRC.slice(i, i + 500)
  assert.match(body, /setSettings\(JSON\.parse\(stepsSnapshot\)\)/, '스냅샷으로 안 되돌린다')
  assert.match(body, /setEditingSteps\(false\)/, '취소한 뒤에도 열려 있다')
  assert.doesNotMatch(body, /saveBroadcastSchedule/,
    '취소가 서버를 부르면 되돌린 값이 저장돼 버린다')
})

test('사실5 — 저장하면 다시 잠긴다', () => {
  const i = SRC.indexOf('const handleSave = async')
  const body = SRC.slice(i, SRC.indexOf("setStatus('✓ 저장 완료')", i))
  assert.match(body, /setEditingSteps\(false\)/,
    '저장 뒤에도 열려 있으면 다음 실수를 그대로 받는다')
})

test('사실6 — 탭 이동이 관문을 지난다', () => {
  const i = SRC.indexOf('const switchTab =')
  assert.ok(i > 0, '탭 전환 함수가 없다')
  const body = SRC.slice(i, i + 600)
  assert.match(body, /stepsDirty && !confirm\(/, '저장 안 한 변경을 안 묻고 버린다')
  assert.match(body, /setEditingSteps\(false\)/, '탭을 옮겨도 편집이 열린 채로 남는다')
  // 사이드바 세 곳(내장·커스텀·예약 없는 흐름)이 전부 관문을 지나야 한다
  assert.doesNotMatch(SRC, /onClick=\{\(\) => setActiveTab\(/,
    '관문을 건너뛰는 탭 버튼이 남아 있다')
})

test('사실7 — 단계를 갈아엎는 버튼은 잠겼을 때 내놓지 않는다', () => {
  const i = SRC.indexOf('단계 기본값 복원')
  const before = SRC.slice(Math.max(0, i - 700), i)
  assert.match(before, /\{editingSteps && \(/,
    '잠긴 채로 「단계 기본값 복원」이 보이면 관문이 뚫린다')
})

test('사실8 — 「단계 편집」이 커스텀 자동순서와 같은 자리·같은 모양이다', () => {
  // 커스텀 쪽(OrphanFlowPanel·CustomSequencePanel)의 버튼과 같은 알약·같은 아이콘이어야
  // 사람이 두 화면에서 같은 것을 찾는다. 자리는 둘 다 카드 머리의 오른쪽 끝이다.
  const i = SRC.indexOf('function StepsCard')
  const body = SRC.slice(i, i + 3000)
  assert.match(body, /<div className="flex items-start justify-between gap-3 mb-3">/,
    '버튼이 카드 머리 오른쪽에 있지 않다')
  // 안내 문구에도 '단계 편집'이 나오므로 **onEdit 뒤쪽**에서 찾는다(범위가 뒤집히면 빈 문자열이 된다)
  const at = body.indexOf('onClick={onEdit}')
  const btn = body.slice(at, body.indexOf('단계 편집', at) + 20)
  // **앵커가 두 번 옮겨졌다**(2026-09-16). 먼저 `text-cc-primary` → `text-ds-v3-tts`
  // (같은 #2563EB), 그다음 `bg-cc-blueBg` → `bg-ds-v3-tts-bg`(말 바탕). 뒤엣것은
  // **색이 실제로 바뀐다**(#EFF6FF → #EAF3FC) — 옛 벌을 다 걷어내기로 한 결정이다.
  // 이 시험이 지키는 것(두 화면이 **같은 모양**일 것)은 그대로다.
  assert.match(btn, /bg-ds-v3-tts-bg text-ds-v3-tts/, '커스텀 쪽과 다른 모양이다')
  assert.match(btn, /<FileText size=\{12\} \/> 단계 편집/, '커스텀 쪽과 다른 아이콘·문구다')
})
