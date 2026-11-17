'use strict'
// UX-35 — 장비 상태를 **정상 / 미설정 / 연결 끊김 / 확인 불가**로 가른다 (2026-09-11).
//
// 요구의 핵심은 *"**가짜 정상·꾸민 실패 이유를 만들지 않는다**"* 이다.
// 출력장치 카드가 그 둘을 다 하고 있었다:
//   · 가짜 정상 — `audio_device` 를 **안 정했어도** 초록 "3개" 였다. 안 정하면 방송이
//     Windows 기본 장치로 나가고 **엉뚱한 데서 소리가 난다**(CLAUDE.md 새 PC 세팅 절).
//   · 꾸민 실패 — 목록을 다 못 받은 상태에서 "없다" 고 단정하면 없는 고장을 신고한다.
//
// 규칙은 `src/lib/systemStatus.js` 한 곳이다. 여기서는 그 규칙을 **사본으로 옮겨 적지 않고**
// 실제 판정 결과를 소스 대조와 함께 본다 — ESM/CJS 경계에서 사본을 만들면 사본이 틀려도
// 초록이 된다(P-107 에서 실제로 그랬다).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/lib/systemStatus.js'), 'utf8')

// `audioCard` 본문만 떼어 함수로 만든다. 규칙 자체를 옮겨 적는 것이 아니라 **그 코드를 그대로** 쓴다.
const 본문 = /function audioCard\(live\) \{[\s\S]*?\n\}/.exec(SRC)
assert.ok(본문, 'audioCard 를 못 찾았다 — 이 가드를 옮길 것')
const audioCard = new Function(`const UNKNOWN = { status: 'unknown', value: '확인 불가', detail: '상태를 읽을 수 없습니다' };
  ${본문[0]}; return audioCard;`)()

const 카드 = (output, configuredOutput) => audioCard({ audio: { output, configuredOutput } })

test('정상 — 설정한 장치가 목록에 있다', () => {
  const r = 카드({ count: 3, first: '스피커 A', names: ['스피커 A', '현장 앰프'] }, '현장 앰프')
  assert.equal(r.status, 'online')
  assert.match(r.detail, /현장 앰프/, '어느 장치로 나가는지 안 알려준다')
})

test('**미설정** — 장치는 보이는데 아무것도 안 정했다(가짜 정상이던 자리)', () => {
  const r = 카드({ count: 3, first: '스피커 A', names: ['스피커 A'] }, '')
  assert.notEqual(r.status, 'online', '안 정했는데 초록이다 — 기본 장치로 나가 엉뚱한 데서 소리가 난다')
  assert.equal(r.value, '미설정')
  assert.match(r.detail, /기본 장치/, '왜 문제인지 안 알려준다')
})

test('**연결 끊김** — 정해 뒀는데 목록에 없다', () => {
  const r = 카드({ count: 2, first: '스피커 A', names: ['스피커 A', '헤드셋'] }, '현장 앰프')
  assert.equal(r.status, 'offline')
  assert.match(r.detail, /현장 앰프/, '무엇을 못 찾았는지 안 알려준다 — 사람이 못 고친다')
})

test('**확인 불가** — 서버가 값을 안 줬다. 가짜 값을 만들지 않는다', () => {
  assert.equal(audioCard({ audio: {} }).status, 'unknown')
  assert.equal(audioCard({}).status, 'unknown')
  assert.equal(audioCard(null).status, 'unknown')
})

test('**꾸민 실패를 만들지 않는다** — 목록을 다 못 받으면 "없다" 고 단정하지 않는다', () => {
  // `names` 가 없는 옛 응답. 첫 장치만으로는 둘째 이후에 있는지 알 수 없다.
  const r = 카드({ count: 5, first: '스피커 A' }, '현장 앰프')
  assert.notEqual(r.status, 'offline', '목록을 못 봤는데 "연결 끊김" 이라고 했다 — 없는 고장을 신고한다')
  assert.match(r.detail, /일부만|현장 앰프/, '모른다는 사실을 안 적는다')
})

test('옛 서버(설정값 자체가 없음)와 진짜 미설정을 섞지 않는다', () => {
  // `configuredOutput` 이 `undefined` = 서버가 안 보냄. `''` = 사람이 안 정함. **다른 사실이다.**
  const 옛서버 = audioCard({ audio: { output: { count: 2, first: 'A', names: ['A'] } } })
  assert.equal(옛서버.status, 'online', '옛 서버 응답에서 화면이 경고를 띄운다')
  assert.match(옛서버.detail, /확인 전/, '모른다는 사실을 안 적는다')
  assert.notEqual(옛서버.value, '미설정', '안 보낸 것을 "안 정했다" 로 바꿔 말한다')
})

test('장치가 아예 없으면 그대로 경고다 — 있던 동작이 사라지지 않았다', () => {
  const r = 카드({ count: 0, first: null, names: [] }, '현장 앰프')
  assert.equal(r.status, 'warning')
  assert.equal(r.value, '장치 없음')
})

test('서버가 이름 목록과 설정값을 실어 보낸다 — 배선의 반대편', () => {
  const st = fs.readFileSync(path.join(ROOT, 'server/routes/status.js'), 'utf8')
  assert.match(st, /configuredOutput: rawSetting\(db, 'audio_device'\)/,
    '설정한 장치 이름을 안 보낸다 — 화면이 미설정을 가를 수 없다')
  assert.match(st, /names: out\.slice\(0, 32\)\.map/,
    '이름 목록을 안 보낸다 — 첫 장치만으로는 "없다" 를 단정할 수 없다')
})
