// server/domain/captions.js 고정 테스트.
//
// 자막은 "틀려도 소리는 나므로" 조용히 망가지기 쉽다 — 어절이 하나 밀리면 노래방 색칠이
// 계속 한 박자 앞서는데, 로그에는 아무것도 안 남는다. 그래서 원문 복원과 단조성을 여기서 잠근다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { wordsToLines, alignSttToText, draftFromText, distributeEvenly, normalize, durationOf, FORMAT_VERSION, MAX_CHARS } =
  require('../domain/captions')

// 실제 옛 인터넷 합성 엔진(ko-KR-InJoonNeural)가 낸 어절 시각을 그대로 옮겨 적었다.
// 엔진이 구두점을 떼고 준다는 것이 이 표의 핵심이다 — "여러분," 이 아니라 "여러분" 이다.
const REAL_TEXT = '어르신 여러분, 안녕하세요. 오늘도 좋은 하루 보내시기 바랍니다.'
const REAL_WORDS = [
  [0.106, 0.675, '어르신'],
  [0.689, 1.300, '여러분'],
  [1.494, 2.425, '안녕하세요'],
  [2.800, 3.412, '오늘도'],
  [3.425, 3.900, '좋은'],
  [3.912, 4.400, '하루'],
  [4.412, 5.300, '보내시기'],
  [5.312, 6.062, '바랍니다'],
]

test('어절에서 떨어져 나간 구두점을 원문에서 되살린다', () => {
  const cues = wordsToLines(REAL_TEXT, REAL_WORDS)
  const shown = cues.lines.map((l) => l.text).join(' ')

  assert.ok(shown.includes('여러분,'), `쉼표가 사라졌다: ${shown}`)
  assert.ok(shown.includes('안녕하세요.'), `마침표가 사라졌다: ${shown}`)
  assert.equal(shown.replace(/\s+/g, ''), REAL_TEXT.replace(/\s+/g, ''),
    '원문 글자가 자막과 달라졌다')
})

// 한 줄이 두 문장에 걸치면 앞 문장 꼬리와 뒤 문장 머리가 한 화면에 붙어 읽기 나쁘다.
// (문장이 상한보다 길면 여러 줄이 되는 것은 정상이다 — 그건 아래 길이 테스트가 본다.)
test('한 줄이 두 문장에 걸치지 않는다', () => {
  const cues = wordsToLines(REAL_TEXT, REAL_WORDS)
  for (const line of cues.lines) {
    const 문장끝 = line.text.search(/[.!?][^.!?]/)
    assert.equal(문장끝, -1, `한 줄에 문장이 둘 이상 들어갔다: ${line.text}`)
  }
  assert.ok(cues.lines[0].text.startsWith('어르신 여러분,'))
})

test('줄과 어절 시각이 실제 오디오 타임라인과 같다', () => {
  const cues = wordsToLines(REAL_TEXT, REAL_WORDS)
  assert.equal(cues.lines[0].s, 0.106)
  assert.equal(cues.lines[0].w[1][2], '여러분,')
  assert.equal(durationOf(cues), 6.062)
})

test('같은 낱말이 반복돼도 시간이 거꾸로 가지 않는다', () => {
  // 전역 검색으로 위치를 잡으면 뒤의 "네"가 앞자리를 집어 시간이 뒤집힌다.
  const cues = wordsToLines('네, 네 알겠습니다.', [
    [0.0, 0.4, '네'],
    [0.5, 0.9, '네'],
    [1.0, 1.8, '알겠습니다'],
  ])
  const times = cues.lines.flatMap((l) => l.w.map((w) => w[0]))
  assert.deepEqual(times, [...times].sort((a, b) => a - b), '어절 시각이 뒤집혔다')
})

test('원문에 없는 어절은 자막을 어긋내지 않고 빠진다', () => {
  // 엔진이 숫자를 펴서 읽으면("3" → "삼") 원문에 그 글자가 없다.
  const cues = wordsToLines('오늘은 3일입니다.', [
    [0.0, 0.5, '오늘은'],
    [0.6, 0.9, '삼'],
    [1.0, 1.5, '일입니다'],
  ])
  assert.ok(cues.lines[0].text.startsWith('오늘은'))
  assert.ok(cues.lines[0].w.every((w) => w[1] >= w[0]))
})

// 자막 글씨는 화면 높이의 6분의 1만 하다. 한 줄이 넘치면 줄바꿈이 일어나 3줄 배치가
// 무너지고, 반대로 토막 줄이 생기면 그 줄이 통째로 낭비다. 두 쪽 다 막는다.
const linesOf = (text) => {
  const words = text.replace(/[,.]/g, '').split(/\s+/).map((w, i) => [i * 0.5, i * 0.5 + 0.45, w])
  return wordsToLines(text, words).lines.map((l) => l.text)
}

test('어떤 줄도 목표 길이를 넘지 않는다 — 넘치면 큰 글씨가 줄바꿈된다', () => {
  const 긴것 = [
    '선생님들께 안내드립니다. 식사 후 투약 시 반드시 어르신의 성함과 얼굴을 확인하고, 성함을 직접 호명한 후 투약해 주시기 바랍니다.',
    '오늘도, 정성스레 마련해주신 이 음식에 감사드리며 늘 기쁘고 건강하게 지내시고, 어르신들 진지 맛있게 드십시오.',
    '오늘은 날씨가 매우 맑고 바람도 잔잔하니, 산책하기에 아주 좋은 날입니다.',
  ]
  for (const text of 긴것) {
    for (const line of linesOf(text)) {
      assert.ok(line.length <= MAX_CHARS, `${MAX_CHARS}자를 넘었다(${line.length}): ${line}`)
    }
  }
})

// 앞줄부터 꽉 채우는 그리디는 "…투약해 주시기 / 바랍니다." 처럼 마지막에 토막을 남긴다.
// 줄을 하나 낼 때마다 남은 것으로 다시 계획해서 고르게 나눈다.
test('마지막 줄에 토막을 남기지 않는다 — 줄 길이가 고르다', () => {
  const lines = linesOf('식사 후 투약 시 반드시 어르신의 성함과 얼굴을 확인하고, 성함을 직접 호명한 후 투약해 주시기 바랍니다.')
  assert.ok(lines.length >= 3, `한 줄로 뭉쳤다: ${JSON.stringify(lines)}`)
  const 짧은줄 = lines.filter((l) => l.length < MAX_CHARS * 0.4)
  assert.deepEqual(짧은줄, [], `토막 줄이 남았다: ${JSON.stringify(lines)}`)
})

test('쉼표는 줄 끝에 오게 한다 — 사람이 읽을 때 쉬는 자리다', () => {
  const lines = linesOf('오늘은 날씨가 매우 맑고 바람도 잔잔하니, 산책하기에 아주 좋은 날입니다.')
  assert.ok(lines.length >= 2, '한 줄로 뭉쳤다')
  assert.ok(lines.some((l) => l.endsWith(',')),
    `쉼표가 줄 가운데 묻혔다: ${JSON.stringify(lines)}`)
})

test('어절이 없으면 null — 자막 없이 소리만 나가야 한다', () => {
  assert.equal(wordsToLines('안녕하세요', []), null)
  assert.equal(wordsToLines('', REAL_WORDS), null)
  assert.equal(wordsToLines('안녕하세요', null), null)
})

test('distributeEvenly는 글자 수에 비례해 나누고 전체 길이를 지킨다', () => {
  const cues = distributeEvenly(['짧은 줄', '이것은 훨씬 더 긴 줄입니다'], 10)
  assert.equal(cues.src, 'prefill')
  assert.equal(cues.lines[0].s, 0)
  assert.ok(Math.abs(durationOf(cues) - 10) < 1e-9, '전체 길이가 안 맞는다')
  assert.ok(cues.lines[1].e - cues.lines[1].s > cues.lines[0].e - cues.lines[0].s,
    '긴 줄이 더 오래 떠 있어야 한다')
})

test('normalize가 겹친 줄을 잘라 두 줄이 동시에 켜지지 않게 한다', () => {
  const cues = normalize({
    v: 1, src: 'manual',
    lines: [{ s: 0, e: 5, text: '앞줄' }, { s: 3, e: 8, text: '뒷줄' }],
  })
  assert.equal(cues.lines[0].e, 3)
})

test('normalize가 순서를 바로잡고 빈 줄을 버린다', () => {
  const cues = normalize({
    v: 1, src: 'manual',
    lines: [{ s: 5, e: 6, text: '나중' }, { s: 1, e: 2, text: '  ' }, { s: 0, e: 1, text: '먼저' }],
  })
  assert.deepEqual(cues.lines.map((l) => l.text), ['먼저', '나중'])
  assert.equal(cues.v, FORMAT_VERSION)
})

test('normalize는 못 고칠 자막을 조용히 통과시키지 않는다', () => {
  assert.throws(() => normalize(null), /비어/)
  assert.throws(() => normalize({ v: 1, lines: '아님' }), /lines/)
  assert.throws(() => normalize({ v: 1, lines: [{ s: 0, e: 1, text: '' }] }), /하나도/)
})

// ── 받아쓰기 시각을 정본에 붙이기 ──────────────────────────────
//
// 받아쓰기는 글자를 틀리게 듣는다. 여기 음원은 안내 멘트라 정확한 문구가 이미 코드에 있으니,
// 시각만 가져오고 글자는 정본을 쓴다 — 잘못 들은 낱말도 화면에는 바르게 나와야 한다.
// 아래 표는 실제 faster-whisper(small)가 낸 결과의 시각과 틀린 글자 꼴(한 글자 바뀜)을 본떠,
// 문구만 중립 안내문으로 바꾼 것이다.

const 정본 = '오늘도, 정성스레 마련해주신 이 음식에 우리 모두 감사드리며 드십시오.'
const 받아쓴것 = [
  [4.30, 4.80, '오늘도,'],
  [5.54, 6.18, '정성스래'],      // 틀리게 들음 (정성스레)
  [6.18, 6.94, '마련해주신'],
  [6.94, 7.10, '이'],
  [7.10, 7.80, '음식에'],
  [7.80, 8.36, '우리'],
  [8.36, 9.16, '모두'],
  [9.16, 10.08, '감사드리며,'],
  [10.20, 10.90, '드십시요.'],     // 틀리게 들음 (드십시오)
]

test('틀리게 들은 낱말도 화면에는 정본 글자로 나온다', () => {
  const { cues, matched, total } = alignSttToText(정본, 받아쓴것)
  const 나온글자 = cues.lines.map((l) => l.text).join(' ')

  assert.ok(나온글자.includes('정성스레'), `틀린 글자가 그대로 나왔다: ${나온글자}`)
  assert.ok(나온글자.includes('드십시오'),   `틀린 글자가 그대로 나왔다: ${나온글자}`)
  assert.ok(!나온글자.includes('정성스래'))
  assert.ok(!나온글자.includes('드십시요'))
  assert.equal(나온글자.replace(/\s+/g, ''), 정본.replace(/\s+/g, ''), '정본과 글자가 달라졌다')
  assert.ok(matched / total > 0.8, `글자를 너무 많이 못 맞췄다: ${matched}/${total}`)
})

test('틀리게 들은 낱말도 시각은 살아남는다', () => {
  const { cues } = alignSttToText(정본, 받아쓴것)
  const 어절 = cues.lines.flatMap((l) => l.w)
  const 정성스레 = 어절.find((w) => w[2] === '정성스레')
  assert.ok(정성스레, '어절이 통째로 빠졌다')
  // 받아쓰기가 그 자리를 5.54~6.18초로 들었다. 글자를 틀렸어도 그 언저리에 있어야 한다.
  assert.ok(정성스레[0] > 5.3 &&정성스레[0] < 6.2, `시각이 엉뚱하다: ${정성스레[0]}`)
})

test('시각은 앞으로만 간다 — 뒤집히면 자막이 튄다', () => {
  const { cues } = alignSttToText(정본, 받아쓴것)
  const 시작들 = cues.lines.map((l) => l.s)
  assert.deepEqual(시작들, [...시작들].sort((a, b) => a - b))
  for (const line of cues.lines) {
    for (const [s, e] of line.w) assert.ok(e >= s, '어절의 끝이 시작보다 앞이다')
  }
})

test('받아쓰기가 딴소리를 하면 얼마나 못 맞췄는지 알려준다', () => {
  // 사람이 "이건 못 쓰겠다"고 판단할 근거가 있어야 한다 — 조용히 엉터리 자막을 만들면 안 된다.
  const { matched, total } = alignSttToText(정본, [[0, 1, '전혀'], [1, 2, '다른'], [2, 3, '말']])
  assert.ok(matched / total < 0.3, `못 맞춘 것을 맞췄다고 한다: ${matched}/${total}`)
})

test('받아쓴 것이 없으면 null — 없는 자막을 지어내지 않는다', () => {
  assert.equal(alignSttToText(정본, []).cues, null)
  assert.equal(alignSttToText('', 받아쓴것).cues, null)
})

// ── 문구만 아는 초안 ──────────────────────────────────────────
//
// 식사 안내 녹음은 그 TTS 문구를 대신하는 것이라, 업로드 시점에 무슨 말이 들어 있는지 안다.
// 글자를 미리 깔아 두면 사람이 다시 칠 일이 없다 — 타이밍만 스페이스바로 찍으면 된다.

test('draftFromText는 평소와 같은 줄 나누기를 탄다', () => {
  const 긴문구 = '오늘도, 정성스레 마련해주신 이 음식에 감사드리며 우리 모두 늘 기쁘고 건강하게 지내기를 바랍니다.'
  const cues = draftFromText(긴문구, 30)
  assert.equal(cues.src, 'prefill')
  assert.ok(cues.lines.length > 1, '한 줄로 뭉쳤다 — 편집기에서도 화면에서도 안 들어간다')
  for (const l of cues.lines) {
    assert.ok(l.text.length <= MAX_CHARS, `${MAX_CHARS}자를 넘었다(${l.text.length}): ${l.text}`)
  }
  assert.equal(cues.lines.map(l => l.text).join(' ').replace(/\s+/g, ''), 긴문구.replace(/\s+/g, ''),
    '원문 글자가 달라졌다')
})

test('draftFromText는 주어진 길이 안에 시각을 편다', () => {
  const cues = draftFromText('하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열.', 20)
  assert.equal(cues.lines[0].s, 0)
  assert.ok(durationOf(cues) <= 20.001, '음원 길이를 넘겼다')
  const 시작들 = cues.lines.map(l => l.s)
  assert.deepEqual(시작들, [...시작들].sort((a, b) => a - b))
})

test('draftFromText: 문구나 길이가 없으면 null', () => {
  assert.equal(draftFromText('', 10), null)
  assert.equal(draftFromText('안녕하세요.', 0), null)
})
