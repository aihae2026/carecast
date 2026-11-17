// AI 승인 화면의 파일·흐름 선택기(B3)가 서버 규칙과 어긋나지 않는지 확인한다.
//
// 예전엔 승인 화면에 선택기가 없어서 AI 경로가 TTS·차임벨·BGM만 만들 수 있었다
// (text·chime·bgm). 선택기가 생기면서 그 제한을 "유형을 좁히는" 대신
// "고른 것이 실제로 재생 가능한지 보는" 검증으로 바꿨다. 두 화면(예약 모달 / AI 승인)이
// 같은 파일 필터를 쓰지 않으면 "여기선 보이는데 저기선 안 보이는 파일"이 생긴다.
'use strict'

const path = require('path')
const fs = require('fs')

const test = require('node:test')
const assert = require('node:assert/strict')

const { KNOWN_BROADCAST_TYPES, NEEDS_AUDIO_FILE_TYPES } = require('../domain/ontology')

const SRC = path.join(__dirname, '..', '..', 'src')
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

test('AI 승인 화면이 서버가 아는 모든 유형을 고를 수 있다', () => {
  // 화면이 목록을 따로 적으면(예전엔 <option>을 세 개 하드코딩했다) 서버가 유형을 늘려도
  // AI 경로에서는 영영 고를 수 없다. 공용 BROADCAST_TYPES를 쓰는지 확인한다.
  const src = read('components', 'easy', 'TTSBroadcast.jsx')
  // **앵커가 옮겨졌다**(2026-09-15): 차임벨을 고르는 자리에서만 숨기면서
  // `BROADCAST_TYPES.map(` 이 `고를수있는유형(...).map(` 이 됐다. 그 함수도 **같은 공용
  // 목록에서 나온다** — 이 시험이 막으려는 것(화면이 제 목록을 따로 적는 것)은 그대로다.
  assert.ok(src.includes('BROADCAST_TYPES.map(') || src.includes('고를수있는유형('),
    'AI 승인 화면이 공용 유형 목록을 쓰지 않는다 — 목록이 갈린다')
  // 숨기는 것은 **고르는 자리**에서일 뿐, 목록 자체가 줄면 안 된다(아래 대조가 그것을 본다).

  const utils = read('lib', 'scheduleUtils.js')
  const open = utils.indexOf('export const BROADCAST_TYPES = [')
  const block = utils.slice(open, utils.indexOf('\n]', open))
  const values = []
  for (const part of block.split("value: '").slice(1)) values.push(part.slice(0, part.indexOf("'")))

  assert.deepEqual(values.sort(), [...KNOWN_BROADCAST_TYPES].sort(),
    '화면의 유형 목록과 서버가 아는 유형이 어긋났다')
})

test('파일이 필요한 유형 목록이 서버와 같고, 화면에는 한 벌만 있다', () => {
  // 예전엔 이 목록이 화면 두 곳(TTSBroadcast · QuickSchedulePhrase)에 각각 박혀 있었고
  // 가드는 한쪽만 봤다. 다른 쪽이 어긋나도 아무도 몰랐다는 뜻이다(2026-08-31).
  const utils = read('lib', 'scheduleUtils.js')
  const open = utils.indexOf('export const NEEDS_AUDIO_FILE = [')
  assert.notEqual(open, -1, 'scheduleUtils에 NEEDS_AUDIO_FILE이 없다')
  const block = utils.slice(open, utils.indexOf(']', open))
  const values = []
  for (const part of block.split("'").slice(1)) {
    const v = part.trim()
    if (v && v !== ',' && !v.startsWith(',')) values.push(v)
  }
  const cleaned = values.filter(v => KNOWN_BROADCAST_TYPES.includes(v))

  assert.deepEqual(cleaned.sort(), [...NEEDS_AUDIO_FILE_TYPES].sort(),
    '화면이 파일을 요구하는 유형과 서버가 요구하는 유형이 어긋났다 — ' +
    '한쪽만 알면 저장은 되는데 그 시각에 무음이거나, 멀쩡한 예약이 막힌다')

  // 화면 어디에도 두 번째 벌이 없어야 한다
  for (const [name, rel] of [
    ['AI 승인 화면', ['components', 'easy', 'TTSBroadcast.jsx']],
    ['빠른 예약 입력', ['components', 'shared', 'QuickSchedulePhrase.jsx']],
  ]) {
    const src = read(...rel)
    assert.ok(!src.includes('const NEEDS_AUDIO_FILE = ['),
      `${name}이 목록을 따로 들고 있다 — scheduleUtils에서 import할 것`)
    assert.ok(src.includes('NEEDS_AUDIO_FILE'),
      `${name}이 목록을 쓰지 않는다`)
  }
})

test('파일 필터 규칙은 한 곳(scheduleUtils)에만 있다', () => {
  // 예약 모달과 AI 승인 화면이 각자 필터를 들고 있으면 한쪽만 고쳐진다.
  const utils = read('lib', 'scheduleUtils.js')
  assert.ok(utils.includes('export function filesForBroadcastType('),
    '공용 파일 필터가 없다')

  for (const [name, rel] of [
    ['예약 모달', ['components', 'shared', 'ScheduleModal.jsx']],
    ['AI 승인 화면', ['components', 'easy', 'TTSBroadcast.jsx']],
  ]) {
    const src = read(...rel)
    assert.ok(src.includes('filesForBroadcastType('),
      `${name}이 공용 파일 필터를 쓰지 않는다`)
    assert.ok(!src.includes('af.source_type !== ') || src.includes('filesForBroadcastType('),
      `${name}에 필터 로직이 복사돼 있다`)
  }
})

test('승인 화면이 고른 파일·흐름을 서버로 보낸다', () => {
  // 선택기만 있고 payload에 안 실으면 화면에서는 골랐는데 저장은 파일 없이 된다.
  const src = read('components', 'easy', 'TTSBroadcast.jsx')
  assert.ok(src.includes('audio_file_id:    draft.audio_file_id'),
    '고른 파일이 승인 요청에 안 실린다')
  assert.ok(src.includes('flow_sequence_id: draft.flow_sequence_id'),
    '고른 흐름이 승인 요청에 안 실린다')
})

// ── **차임벨은 고르는 자리에서만 숨는다** (사용자 지시 2026-09-15) ──────────────────
// *"차임벨 같은 경우에도 자세히 유형이 사실 안 들어갔으면 좋겠어, 어차피 예약도
//   하지도 않는 건데."*
//
// 차임은 **누르면 그 자리에서 나가는 것**이고(검색창 밑 「차임벨」 단추), 「몇 시에 차임만
// 울리게 예약」하는 일은 없다. 고를 수 있는데 아무도 안 쓰는 칸은 고르는 사람만 헷갈린다.
//
// **그런데 지우면 안 된다.** 이 표는 **이름표를 찾는 표**이기도 하고(빼면 기존 차임
// 예약이 화면에 「chime」으로 뜬다), 2026-09-14 지시가 *"기존 차임 예약·저장된 순서·
// API 기능은 삭제하지 않는다"* 였다.
test('**차임벨은 목록에 남아 있다** — 이름표를 찾는 표이기도 하다', () => {
  const { BROADCAST_TYPES } = require('../../src/lib/scheduleUtils.js')
  const chime = BROADCAST_TYPES.find(t => t.value === 'chime')
  assert.ok(chime, '차임벨을 목록에서 지웠다 — 기존 차임 예약이 「chime」 으로 뜬다')
  assert.equal(chime.label, '차임벨', '이름표가 사라졌다')
  assert.equal(chime.숨김, true, '차임벨이 아직 고르는 자리에 나온다')
})

test('**고르는 자리에서는 안 보인다 — 다만 이미 그 값이면 남는다**', () => {
  const { 고를수있는유형 } = require('../../src/lib/scheduleUtils.js')
  const 새로 = 고를수있는유형('text').map(t => t.value)
  assert.ok(!새로.includes('chime'), '새 예약을 만들 때 차임벨이 아직 보인다')
  assert.ok(새로.length >= 5, `고를 수 있는 유형이 ${새로.length}가지뿐이다 — 너무 많이 숨겼다`)

  // **이미 차임인 예약을 고치러 열었을 때는 남아야 한다.** 목록에 없으면 `<select>` 가
  // 첫 항목으로 튀고, 사람이 유형을 건드리지도 않았는데 저장하는 순간 **차임이 안내
  // 음성으로 바뀐다.** 조용한 오독 중에서도 나쁜 쪽이다.
  const 고치기 = 고를수있는유형('chime').map(t => t.value)
  assert.ok(고치기.includes('chime'),
    '기존 차임 예약을 고칠 때 유형이 목록에 없다 — 저장하면 다른 유형으로 바뀐다')
})

test('**세 화면 모두 숨김을 지킨다** — 한 곳만 고치면 갈린다', () => {
  for (const p of [
    ['components', 'shared', 'ScheduleModal.jsx'],
    ['components', 'shared', 'QuickSchedulePhrase.jsx'],
    ['components', 'easy', 'TTSBroadcast.jsx'],
  ]) {
    const src = read(...p)
    const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(코드만.includes('고를수있는유형('),
      `${p.join('/')} 가 아직 전체 목록을 그대로 내놓는다 — 차임벨이 거기서만 보인다`)
    assert.ok(!/BROADCAST_TYPES\.map\(/.test(코드만),
      `${p.join('/')} 가 아직 BROADCAST_TYPES 를 그대로 돈다`)
  }
})
