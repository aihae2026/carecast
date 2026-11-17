// 방송 유형 온톨로지(server/domain/ontology.js) — 문장의 낱말을 scheduler가 실행할 수 있는
// broadcast_type으로 잇는 사전.
//
// 이 사전이 틀리면 두 가지 방식으로 조용히 망가진다.
//  - 유형을 못 읽으면(false negative) TTS가 "차임벨 울려줘"라는 문장을 그대로 읽는다.
//  - 유형을 잘못 읽으면(false positive) 나가야 할 안내 방송 대신 음악만 나간다.
// 어느 쪽도 현장에서는 원인을 알기 어려우므로, 두 방향을 다 테스트로 고정한다.
'use strict'

const fs = require('fs')
const path = require('path')

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CONCEPTS,
  KNOWN_BROADCAST_TYPES,
  NEEDS_AUDIO_FILE_TYPES,
  isKnownBroadcastType,
  needsAudioFile,
  detectBroadcastType,
  detectFlow,
  detectVolume,
} = require('../domain/ontology')

// ── 매체를 읽어낸다 ───────────────────────────────────────────
test('재생 동작이 함께 있으면 유형을 확신(strong)한다', () => {
  const cases = [
    ['저녁 6시에 차임벨 울려줘',        'chime'],
    ['매일 12시에 안내 음원 틀어줘', 'audio'],
    ['점심때 체조 영상 틀어줘',         'video'],
    ['오후 3시에 클래식 음악 틀어줘',    'bgm'],
  ]
  for (const [text, expected] of cases) {
    const r = detectBroadcastType(text)
    assert.equal(r?.broadcastType, expected, `"${text}" → ${expected}`)
    assert.equal(r.confidence, 'strong', `"${text}"는 재생 동작이 있으니 strong이어야 한다`)
  }
})


test('"음원"은 BGM이 아니라 음원 재생으로 읽는다(우선순위)', () => {
  assert.equal(detectBroadcastType('녹음 음원 틀어줘').broadcastType, 'audio')
  assert.equal(detectBroadcastType('노래 틀어줘').broadcastType, 'bgm')
})

// ── 안 읽어야 할 것은 안 읽는다 ───────────────────────────────
test('평범한 안내 방송은 유형을 바꾸지 않는다', () => {
  for (const text of ['매일 오후 3시에 산책 안내', '평일 오전 9시 30분 체조 안내', '내일 오후 2시 면회 안내']) {
    assert.equal(detectBroadcastType(text), null, `"${text}"는 TTS 안내 방송이어야 한다`)
  }
})

test('매체 낱말이 방송 주제로만 쓰인 문장은 유형을 바꾸지 않는다', () => {
  // "음악"이 들어있지만 BGM을 틀어달라는 게 아니라 음악 프로그램을 안내하는 방송이다.
  // 여기서 bgm으로 새면 안내 방송이 통째로 사라지고 음악만 나간다.
  assert.equal(detectBroadcastType('오후 2시 음악 감상 프로그램 안내'), null)
  assert.equal(detectBroadcastType('내일 영상 상영 프로그램 공지'), null)
})

test('낱말만 있고 재생 동작이 없으면 유형은 잡되 weak으로 알린다', () => {
  const r = detectBroadcastType('저녁 6시에 차임벨')
  assert.equal(r.broadcastType, 'chime')
  assert.equal(r.confidence, 'weak', '확신이 없으면 사람이 확인하도록 weak이어야 한다')
})

test('빈 값·비문자열은 null로 안전하게 처리한다', () => {
  for (const v of ['', '   ', null, undefined, 123, {}, []]) {
    assert.equal(detectBroadcastType(v), null)
  }
})

// ── 내용에서 걷어낼 조각 ──────────────────────────────────────
test('매체 낱말과 재생 동작을 내용에서 걷어낼 수 있게 돌려준다', () => {
  const r = detectBroadcastType('저녁 6시에 차임벨 울려줘')
  assert.deepEqual(r.strip, ['차임벨', '울려줘'], '꼬리말(줘)까지 걷어내야 "줘"가 제목에 남지 않는다')
})

// ── 드리프트 방어 ─────────────────────────────────────────────
test('사전이 만드는 유형은 전부 scheduler가 실행할 줄 아는 것이어야 한다', () => {
  // scheduler.js가 실제로 분기하는 값을 소스에서 읽어 대조한다. 사전에만 유형을 추가하고
  // 실행 분기를 안 만들면(또는 그 반대) 저장은 되는데 그 시각에 아무 일도 안 일어난다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  const handled = new Set([...src.matchAll(/broadcastType === '([^']+)'/g)].map(m => m[1]))
  handled.add('text') // text는 분기 없이 함수 끝까지 흘러가는 기본 경로다

  for (const concept of CONCEPTS) {
    assert.ok(
      handled.has(concept.broadcastType),
      `사전의 '${concept.id}'가 만드는 ${concept.broadcastType}을 scheduler가 실행하지 못한다`
    )
  }
  for (const type of KNOWN_BROADCAST_TYPES) {
    assert.ok(handled.has(type), `KNOWN_BROADCAST_TYPES의 ${type}이 scheduler에 없다`)
  }
})

test('낱말에 정규식 특수문자가 없다(패턴으로 그대로 쓰기 때문)', () => {
  for (const concept of CONCEPTS) {
    for (const noun of concept.nouns) {
      assert.ok(!/[.*+?^${}()|[\]\\]/.test(noun), `'${noun}'에 정규식 특수문자가 있다 — 이스케이프가 필요하다`)
    }
  }
})

// 아무도 안 쓰는 export는 "지켜지고 있는 규칙"처럼 보인다(CC-046). SELF_CONTAINED_TYPES는
// AI 승인 화면에 파일·흐름 선택기가 없던 시절의 제한이었고, 지금은 그 자리를
// needsAudioFile() 검증(scheduleDrafts.resolveApprovedType)이 대신한다 — 프로덕션 참조 0건.
test('죽은 SELF_CONTAINED_TYPES export가 ontology에 남아 있지 않다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'domain', 'ontology.js'), 'utf8')
  assert.ok(!/SELF_CONTAINED_TYPES/.test(src),
    '아무도 참조하지 않는 SELF_CONTAINED_TYPES가 남아 있다 — 유형을 늘릴 때 여기도 고쳐야 하는 줄 알게 된다')
})

test('파일이 필요한 유형은 CONCEPTS에서 파생되고, 자립 유형과 겹치지 않는다', () => {
  assert.deepEqual([...NEEDS_AUDIO_FILE_TYPES].sort(), ['audio', 'video'])
  // 문장만으로 곧바로 실행 가능한 유형 — 파일을 고르지 않아도 소리가 난다
  for (const type of ['text', 'chime', 'bgm']) {
    assert.ok(!needsAudioFile(type), `${type}은 파일 없이 실행 가능해야 한다`)
    assert.ok(isKnownBroadcastType(type))
  }
})

test('알 수 없는 유형은 거른다', () => {
  for (const v of ['tts', 'TEXT', '', null, undefined, 'chime2']) {
    assert.equal(isKnownBroadcastType(v), false, `${v}는 알 수 없는 유형이어야 한다`)
  }
  assert.equal(isKnownBroadcastType('chime'), true)
})

// ── 근접 규칙 (재생 동작이 어느 낱말을 가리키는가) ────────────
// 문장 어디든 동작이 있으면 확신으로 치던 초기 규칙의 오탐을 고정해 둔다.
test('안내 문구를 "틀어달라"는 문장은 매체 방송으로 새지 않는다', () => {
  // '음악'과 '틀어줘'가 멀리 떨어져 있다 — '음악'은 방송 주제일 뿐이다.
  // 여기서 BGM으로 새면 안내 방송이 통째로 사라지고 음악만 나간다.
  assert.equal(detectBroadcastType('음악 감상 프로그램 안내를 틀어줘'), null)
})

test('재생 동작에 가장 가까운 낱말이 이긴다', () => {
  // 두 매체 낱말 중 '틀어줘'에 붙은 쪽이 이긴다
  assert.equal(detectBroadcastType('음악이랑 영상 틀어줘').broadcastType, 'video')
  assert.equal(detectBroadcastType('영상이랑 음악 틀어줘').broadcastType, 'bgm')
  // (외부 동영상 TV 낱말은 2026-09-21 사전에서 뺐다 — 「유튜브 영상」도 이제 그냥 영상이다)
  assert.equal(detectBroadcastType('유튜브 영상 틀어줘').broadcastType, 'video')
})

test('안내 신호가 있어도 재생 동작이 낱말에 붙어 있으면 매체로 읽는다', () => {
  // "식사 안내"는 방송 주제지만 "차임벨 울려줘"는 분명한 지시다
  const r = detectBroadcastType('식사 안내 차임벨 울려줘')
  assert.equal(r.broadcastType, 'chime')
  assert.equal(r.confidence, 'strong')
})

test('여러 절이 이어져도 동작에 붙은 매체를 고른다', () => {
  assert.equal(detectBroadcastType('점심 안내 방송 후에 음악 틀어줘').broadcastType, 'bgm')
})

// ── 저장된 흐름 ───────────────────────────────────────────────
const FLOWS = [{ id: 1, name: '아침 방송' }, { id: 2, name: '체조' }, { id: 3, name: '저녁 마무리' }]

test('흐름 이름 + 명시적 신호가 있으면 그 흐름을 고른다', () => {
  const r = detectFlow('내일 오전 8시에 아침 방송 흐름 실행해줘', FLOWS)
  assert.equal(r.flowId, 1)
  assert.equal(r.name, '아침 방송')
})

test('띄어쓰기가 달라도 흐름 이름을 찾는다', () => {
  assert.equal(detectFlow('아침방송 순서대로 틀어줘', FLOWS).flowId, 1)
})

test('긴 이름이 짧은 이름을 이긴다', () => {
  const flows = [{ id: 1, name: '아침' }, { id: 2, name: '아침 방송' }]
  assert.equal(detectFlow('아침 방송 흐름 실행', flows).flowId, 2)
})

test('명시적 신호(흐름·순서·실행) 없이는 흐름으로 읽지 않는다', () => {
  // 흐름 이름이 "체조"라고 해서 "체조 안내 방송"까지 흐름으로 오인하면 안 된다
  assert.equal(detectFlow('체조 안내 방송', FLOWS), null)
  assert.equal(detectFlow('오후 3시 아침 방송', FLOWS), null)
})

test('한 글자 흐름 이름은 무시한다(아무 문장에나 걸린다)', () => {
  assert.equal(detectFlow('아 실행해줘', [{ id: 1, name: '아' }]), null)
})

test('흐름 목록이 없거나 형식이 어긋나도 안전하다', () => {
  for (const flows of [null, undefined, [], '아침', [null], [{ id: 'x', name: '아침 방송' }], [{ id: 1 }]]) {
    assert.equal(detectFlow('아침 방송 흐름 실행해줘', flows), null)
  }
})

test('흐름 이름에 정규식 특수문자가 있어도 터지지 않는다', () => {
  const flows = [{ id: 9, name: '아침(1)+방송' }]
  assert.doesNotThrow(() => detectFlow('아침(1)+방송 흐름 실행', flows))
  assert.equal(detectFlow('아침(1)+방송 흐름 실행', flows).flowId, 9)
})

// ── 화면 ↔ 서버 드리프트 방어 ─────────────────────────────────
// 서버가 유형을 검증하기 시작했으므로(POST/PUT /api/schedules), 화면이 고를 수 있는 유형이
// 서버가 아는 목록을 벗어나면 "저장 버튼을 눌러도 400"이 된다. 두 목록을 붙여 둔다.
test('화면의 방송 유형 목록이 서버가 아는 유형을 벗어나지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'scheduleUtils.js'), 'utf8')
  const block = src.match(/export const BROADCAST_TYPES = \[([\s\S]*?)\n\]/)
  assert.ok(block, 'scheduleUtils.js에서 BROADCAST_TYPES를 찾지 못했다')
  const values = [...block[1].matchAll(/value:\s*'([^']+)'/g)].map(m => m[1])

  assert.ok(values.length >= 5, `유형 목록을 제대로 읽지 못했다: ${JSON.stringify(values)}`)
  for (const v of values) {
    assert.ok(isKnownBroadcastType(v), `화면이 고를 수 있는 '${v}'을 서버가 거부한다`)
  }
  // 'auto'는 자동방송을 목록에 함께 보여주기 위한 화면 전용 가짜 유형이다 —
  // 저장 경로(createSchedule)에는 절대 오면 안 되므로 선택 목록에도 없어야 한다.
  assert.ok(!values.includes('auto'), "'auto'는 화면 표시용이지 저장 가능한 유형이 아니다")
})

test('확인 카드는 파일 필요 유형 목록을 따로 들지 않는다', () => {
  // 2026-08-31까지 이 목록이 화면 두 곳(QuickSchedulePhrase · TTSBroadcast)에 각각 박혀 있었고,
  // 가드도 각자 한 벌씩(여기와 ai-approval-pickers)이었다. 두 벌이면 한쪽만 고쳐지고,
  // 그러면 저장 직전 안내가 빠지거나 멀쩡한 예약이 화면에서 막힌다.
  // 지금은 src/lib/scheduleUtils.js가 화면의 단일 출처이고, 사전과의 값 대조는
  // server/test/ai-approval-pickers.test.js 한 곳에서만 한다.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'shared', 'QuickSchedulePhrase.jsx'), 'utf8')
  assert.equal(/const NEEDS_AUDIO_FILE = \[/.test(src), false,
    '확인 카드가 목록을 따로 들고 있다 — scheduleUtils에서 import할 것')
  assert.ok(src.includes('NEEDS_AUDIO_FILE') && src.includes("lib/scheduleUtils"),
    '확인 카드가 공용 목록(scheduleUtils)을 import하지 않는다')
})

// ── 겹치는 후보는 우리가 고르지 않는다 ────────────────────────
test('문장의 다른 자리에서 다른 유형도 걸리면 후보로 함께 돌려준다', () => {
  // "음악이랑 영상 틀어줘" — '영상'이 동작에 붙어 video로 읽히지만 배경음악일 수도 있다
  const r = detectBroadcastType('음악이랑 영상 틀어줘')
  assert.equal(r.broadcastType, 'video')
  assert.deepEqual(r.alternatives.map(a => a.broadcastType), ['bgm'])
})

test('같은 자리를 가리키는 매칭은 다투는 후보가 아니다', () => {
  // '배경 음악' 안의 '음악'은 별개 후보가 아니라 같은 말이다 — 여기서 물어보면 잔소리다
  assert.deepEqual(detectBroadcastType('배경 음악 틀어줘').alternatives, [])
  assert.deepEqual(detectBroadcastType('오후 3시에 클래식 음악 틀어줘').alternatives, [])
  assert.deepEqual(detectBroadcastType('저녁 6시에 차임벨 울려줘').alternatives, [])
})

test('흐름 이름이 둘 이상 걸리면 후보로 함께 돌려준다', () => {
  const r = detectFlow('아침 방송 끝나고 체조 흐름 실행', FLOWS)
  assert.equal(r.name, '아침 방송')
  assert.deepEqual(r.alternatives.map(a => a.name), ['체조'])
})

test('흐름도 안내 방송 신호가 있고 실행 동사가 없으면 고르지 않는다', () => {
  // 흐름 이름이 "체조"라고 해서 "체조 순서 안내 방송"이 흐름이 되면 안 된다
  assert.equal(detectFlow('체조 순서 안내 방송', FLOWS), null)
  // 실행 동사가 있으면 분명한 지시다
  assert.equal(detectFlow('체조 흐름 실행', FLOWS).flowId, 2)
})

// ── 설정 수식어 (MODIFIERS) ───────────────────────────────────
// "무엇을 방송하는가"(CONCEPTS)와 다른 두 번째 축 — "어떻게 내보내는가".
const LEVELS = { quiet: 30, loud: 85 }

test('정성어를 설정에서 읽은 수치로 바꾼다', () => {
  assert.equal(detectVolume('음악 조용하게 틀어줘', LEVELS).value, 30)
  assert.equal(detectVolume('BGM 크게 틀어줘', LEVELS).value, 85)
})

test('수치는 코드에 박지 않고 주입받는다(현장에서 조정 가능해야 한다)', () => {
  // "잔잔하게"가 몇 %인지는 스피커·공간마다 다르다 — 코드 배포 없이 바뀌어야 한다
  assert.equal(detectVolume('볼륨은 잔잔하게', { quiet: 10 }).value, 10)
  assert.equal(detectVolume('볼륨은 잔잔하게', { quiet: 60 }).value, 60)
  assert.equal(detectVolume('볼륨은 잔잔하게', {}).value, null, '수치를 못 받으면 숫자를 지어내지 않는다')
})

test('"보통으로"는 숫자를 만들지 않는다(= 시스템 기본값을 쓰라는 뜻)', () => {
  const r = detectVolume('볼륨은 보통으로', LEVELS)
  assert.equal(r.level, 'normal')
  assert.equal(r.value, null)
})

test('숫자를 직접 말하면 그대로 쓴다', () => {
  assert.equal(detectVolume('볼륨 40으로 해줘', LEVELS).value, 40)
  assert.equal(detectVolume('음량은 55% 로', LEVELS).value, 55)
})

test('볼륨 이야기가 아니면 정성어를 볼륨으로 읽지 않는다', () => {
  // "어르신들 조용히 해주세요"는 방송 문구지 볼륨 지시가 아니다
  assert.equal(detectVolume('어르신들 조용히 해주세요 안내', LEVELS), null)
  assert.equal(detectVolume('매일 오후 3시에 산책 안내', LEVELS), null)
})

test('범위를 벗어난 숫자는 볼륨으로 읽지 않는다', () => {
  assert.equal(detectVolume('볼륨 150으로', LEVELS), null)
})

test('빈 값·비문자열은 null로 안전하게 처리한다(볼륨)', () => {
  for (const v of ['', '   ', null, undefined, 123, {}, []]) {
    assert.equal(detectVolume(v, LEVELS), null)
  }
})

// ── 볼륨 채널 구분 ────────────────────────────────────────────
test('어느 소리인지 짚어 말하면 그 채널로 읽는다', () => {
  assert.equal(detectVolume('안내 음성은 크게 해줘', LEVELS).channel, 'main')
  assert.equal(detectVolume('목소리 크게', LEVELS).channel, 'main')
  assert.equal(detectVolume('배경음악 잔잔하게', LEVELS).channel, 'bgm')
  assert.equal(detectVolume('음악 조용하게 틀어줘', LEVELS).channel, 'bgm')
})

test('짚어 말하지 않으면 BGM으로 두되 확신하지 않는다', () => {
  // 요양원에서 안내 방송을 작게 만드는 건 어르신이 못 듣는 결과라 훨씬 위험하다.
  // 그래서 기본은 BGM으로 두고, channelExplicit=false로 화면이 되묻게 한다.
  const r = detectVolume('볼륨은 잔잔하게', LEVELS)
  assert.equal(r.channel, 'bgm')
  assert.equal(r.channelExplicit, false)
  assert.equal(detectVolume('배경음악 잔잔하게', LEVELS).channelExplicit, true)
})

// ── 낱말과 재생 동작 사이의 조사·부사 (2026-08-29 리뷰) ──────────────────────
//
// "음악을 좀 틀어줘"가 weak으로 떨어졌다. "음악" 끝과 "틀어줘" 사이가 "을 좀 "(4자)라
// MAX_ACTION_GAP(3)을 넘기 때문이다. 정작 "음악 좀 틀어줘"(2자)는 strong이라, **조사 하나
// 붙였다고 판정이 갈렸다.** weak이면 화면이 되묻는 게이트로 넘어가므로 방송이 잘못 나가진
// 않지만, 사람이 매번 같은 문장에 다시 답해야 한다.
//
// 숫자만 올리는 처방은 끝이 없다("음악을 조금 틀어줘"는 5자). 사이에 낀 것이 조사·부사뿐인지를
// 보되, 다른 낱말이 끼면 예전처럼 끊는다 — 그쪽이 오탐 방지선이다.
test('조사·부사가 껴도 재생 동작이 낱말에 붙는다', () => {
  for (const s of [
    '음악을 좀 틀어줘',
    '음악을 조금 틀어줘',
    '음악을 한번 틀어줘',
    '음악 좀 틀어줘',
    '음악 틀어줘',
    '음악을 살짝 틀어주세요',
  ]) {
    const r = detectBroadcastType(s)
    assert.equal(r?.confidence, 'strong', `${s} — 되묻기 없이 바로 알아들어야 한다`)
    assert.equal(r?.id, 'bgm')
  }
})

test('사이에 다른 낱말이 끼면 붙지 않는다 — 이게 오탐 방지선이다', () => {
  // "방송"이 껴 있으므로 '틀어줘'가 '음악'을 가리킨다고 단정하지 않는다(예전 동작 그대로).
  assert.equal(detectBroadcastType('음악 방송 틀어줘')?.confidence, 'weak')
})

test('조사·부사만 껴도 지나치게 멀면 끊는다', () => {
  const { MAX_FILLER_GAP } = require('../domain/ontology')
  assert.ok(MAX_FILLER_GAP <= 10, '상한이 없으면 문장이 딴 데로 새도 붙는다')
  // 공백만 잔뜩 넣어 상한을 넘긴 경우
  assert.equal(detectBroadcastType(`음악${' '.repeat(MAX_FILLER_GAP + 2)}틀어줘`)?.confidence, 'weak')
})

test('안내 방송 신호가 있으면 매체 낱말이 주제로 쓰인 것으로 본다 — 이번 변경이 이걸 안 깼다', () => {
  assert.notEqual(detectBroadcastType('음악 감상 프로그램 안내 방송')?.id, 'bgm')
})
