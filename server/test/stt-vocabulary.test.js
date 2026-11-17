'use strict'
// **받아쓰기와 AI 다듬기가 같은 낱말을 안다** (사용자 신고 2026-09-16).
//
// 방송 문안 속 드문 낱말을 받아쓰기가 흔한 낱말로 틀리게 적었고, AI 다듬기도 못 고쳤다.
//
// ── 무엇이 잘못됐었나 ──────────────────────────────────────────────────────
// 두 자리가 똑같이 어휘를 모르고 있었다:
//   · `caption_stt.py` 가 `initial_prompt` 없이 들었다 — whisper 는 무슨 방송인지
//     모르니 드문 낱말보다 흔한 낱말로 간다.
//   · `POLISH_PROMPT` 가 낱말을 하나도 안 줬다 — AI 에게도 고칠 근거가 없다.
//
// 시설 고유 어휘(종교 어휘 등)는 저장소 밖 설정 파일에서 더한다(2026-10-17). 그 모양과 합치는
// 규칙을 아래 시험이 본다 — 파일 없이 `합치기()` 에 설정을 직접 준다.
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
// 고치는 방법은 쉬웠다. **어려운 것은 두 자리가 다시 갈리지 않게 하는 것**이다.
// 받아쓰기가 아는 낱말과 다듬기가 아는 낱말이 달라지면, 받아쓰기가 새로 틀리는 낱말을
// 다듬기가 못 고친다 — 그리고 그건 **소리를 들어 봐야만** 드러난다.
// 그래서 「같은 곳에서 온다」를 소스 대조로 고정한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const V = require('../domain/sttVocabulary')
const { 합치기, 앞말, 다듬기안내 } = V

// 시설 설정 예시 — 실제 시설 어휘가 아니라 모양을 보는 가짜 값이다.
const 시설설정 = { 설명: '예시 시설의 안내 방송입니다.', 낱말들: ['예시안내문', '  ', 3], 자주틀리는짝: [['예시 안내뭄', '예시안내문'], ['짝이', '아님', '셋'], 'x'] }

test('**기본 낱말은 어느 요양원에나 나오는 말이다** — 시설 고유 종교 어휘를 코드에 박지 않는다', () => {
  assert.ok(V.기본낱말.includes('어르신') && V.기본낱말.includes('식사 안내'), '기본 낱말이 비었다')
  // 한 시설의 전례 어휘가 코드에 다시 들어오면 그 시설이 드러나고 다른 시설에는 맞지 않는다.
  // 기본 낱말은 요양원 안내 낱말만(기본 문안 종교 중립, 2026-10-17) — 기도 낱말은 시설 설정 파일로.
  assert.ok(!V.기본낱말.some(w => w.includes('기도')), '기본 낱말에 기도 낱말이 들어왔다 — 시설 설정 파일로 옮긴다')
  assert.ok(V.기본낱말.length <= 15, `기본 낱말이 ${V.기본낱말.length}개다 — 시설 고유 어휘는 설정 파일로 옮긴다`)
  // 낱말은 조각으로 잇는다 — 이 시험 파일이 공개 트리 검색에서 「종교 표기」로 잡히지 않게.
  const 종교표기 = new RegExp(['천주' + '교', '가톨' + '릭', '카톨' + '릭'].join('|'))
  assert.ok(!종교표기.test(읽기('server/domain/sttVocabulary.js')), '어휘 모듈이 특정 종교를 밝힌다')
})

test('**설정 파일의 낱말·짝이 합쳐지고, 깨진 칸은 버린다**', () => {
  const 어휘 = 합치기(시설설정)
  assert.ok(어휘.낱말들.includes('예시안내문'), '설정의 낱말이 안 합쳐졌다')
  assert.ok(어휘.낱말들.includes('어르신'), '설정을 더하자 기본 낱말이 사라졌다')
  assert.ok(!어휘.낱말들.includes('') && !어휘.낱말들.includes(3), '빈 칸·숫자를 낱말로 받았다')
  assert.deepEqual(어휘.자주틀리는짝, [['예시 안내뭄', '예시안내문']], '모양이 틀린 짝을 받았다')
  assert.equal(어휘.설명, '예시 시설의 안내 방송입니다.')
  assert.deepEqual(합치기(null).낱말들, V.기본낱말, '설정이 없으면 기본 낱말만이어야 한다')
})

test('**설정 파일이 없거나 깨져도 멈추지 않는다** — 기본 낱말로 돈다', () => {
  const os = require('node:os')
  assert.equal(V.설정읽기(path.join(os.tmpdir(), `없는파일_${process.pid}.json`)), null)
  const 깨짐 = path.join(os.tmpdir(), `stt_vocab_broken_${process.pid}.json`)
  fs.writeFileSync(깨짐, '{ 깨진')
  try { assert.equal(V.설정읽기(깨짐), null) } finally { fs.unlinkSync(깨짐) }
  // 예시 파일은 실제로 읽히는 모양이어야 한다 — 복사해 쓰는 사람이 처음부터 막히면 안 된다.
  const 예시 = V.설정읽기(path.join(ROOT, 'server/config/stt-vocabulary.example.json'))
  assert.ok(예시 && Array.isArray(예시.낱말들) && Array.isArray(예시.자주틀리는짝), '예시 파일 모양이 틀렸다')
  assert.match(읽기('.gitignore'), /^server\/config\/stt-vocabulary\.local\.json$/m, '시설 어휘 파일이 저장소에 올라갈 수 있다')
})

test('**앞말에 틀린 낱말을 넣지 않는다** — 넣으면 그쪽으로 끌려간다', () => {
  // 틀린 쪽이 낱말 목록에도 들어 있는 짓궂은 설정 — 그래도 앞말에는 빠져야 한다.
  const 어휘 = 합치기({ ...시설설정, 낱말들: ['예시안내문', '예시 안내뭄'] })
  const p = 앞말(어휘)
  assert.ok(p.includes('예시안내문'), '앞말에 설정 낱말이 없다')
  for (const [틀린] of 어휘.자주틀리는짝) {
    assert.ok(!p.includes(틀린),
      `앞말에 잘못된 낱말 "${틀린}" 이 들어 있다 — whisper 가 그쪽으로 끌린다`)
  }
  // 앞말은 **문장**이어야 한다. 낱말만 늘어놓으면 덜 끌린다.
  assert.match(앞말(), /입니다|나옵니다/, '앞말이 문장이 아니다')
  // whisper 의 앞말은 대략 224 토큰에서 잘린다. 한국어는 글자당 토큰이 크니 넉넉히 잡는다.
  assert.ok(앞말().length < 600, `앞말이 ${앞말().length}자다 — 길면 뒤가 잘려 효과가 준다`)
})

test('**다듬기 안내에는 틀린 짝이 들어간다** — 고칠 근거가 된다 · 짝이 없으면 그 줄을 안 쓴다', () => {
  const 어휘 = 합치기(시설설정)
  const g = 다듬기안내(어휘)
  for (const [틀린, 맞는] of 어휘.자주틀리는짝) {
    assert.ok(g.includes(틀린) && g.includes(맞는),
      `"${틀린}" → "${맞는}" 짝이 안내에 없다`)
  }
  assert.doesNotMatch(다듬기안내(합치기(null)), /틀린 적이 있다/, '짝이 없는데 빈 「틀린 적」 줄을 쓴다')
})

test('**받아쓰기가 앞말을 실제로 넘긴다** — 목록만 있고 안 주면 소용없다', () => {
  const svc = 읽기('server/services/captionDraft.js')
  assert.match(svc, /require\('\.\.\/domain\/sttVocabulary'\)/,
    '받아쓰기가 어휘 단일 출처를 안 읽는다')
  // `execFile` 인자에 앞말이 실려야 한다 — 읽어만 두고 안 넘기면 아무 일도 안 난다.
  assert.match(svc, /execFile\(python, \[script, audioPath, outPath, 'small', 앞말\(\)\]/,
    '받아쓰기 호출에 앞말이 안 실린다')
})

test('**손으로 돌리는 도구도 같은 앞말을 쓴다** — 한쪽만 빠지면 이유를 못 찾는다', () => {
  const cli = 읽기('scripts/caption-draft.cjs')
  assert.match(cli, /sttVocabulary/, '일괄 도구가 어휘 단일 출처를 안 읽는다')
  assert.match(cli, /앞말\(\)\]/, '일괄 도구 호출에 앞말이 안 실린다')
})

test('**파이썬이 그 앞말을 whisper 에 넘긴다** — 받기만 하고 안 쓰면 그대로다', () => {
  const py = 읽기('scripts/caption_stt.py')
  assert.match(py, /initial_prompt\s*=\s*sys\.argv\[4\]/, '넷째 인자를 안 받는다')
  assert.match(py, /initial_prompt=initial_prompt/,
    'transcribe 에 initial_prompt 를 안 넘긴다 — 받아만 두고 버린다')
})

test('**AI 다듬기 프롬프트가 같은 목록을 쓴다** — 두 벌이 되면 갈린다', () => {
  const route = 읽기('server/routes/audio.js')
  assert.match(route, /sttVocabulary'\)\.다듬기안내\(\)/,
    'POLISH_PROMPT 가 어휘 단일 출처를 안 쓴다')
  // 목록을 라우트에 **다시 적지 않았는지** 본다. 두 벌이 되면 한쪽만 고쳐진다.
  assert.ok(!/'식사기도'\s*,\s*'아침기도'/.test(route),
    '라우트가 낱말 목록을 따로 들고 있다')
})
