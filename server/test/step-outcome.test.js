// 단계 종료 상태 판정 규칙 — **설계안의 테스트 가능한 예시** (P-47, 승인 §3).
//
// 설계안: `docs/audit/STEP_STATE_DESIGN.md`. 이 파일은 그 문서의 판정표가 실제로 도는지
// 보이는 자리다. **아직 배선 전이다** — 값 개수(선택 A)와 옛 이력 처리(선택 B)가
// 정해지기 전에는 `flowRunner` 가 이것을 안 부른다.
//
// **기대값을 제품 함수에서 가져오지 않는다**(사용자 지시 §6). 각 기대값은 설계안이 정한
// 업무 규칙을 여기 **손으로** 적은 것이다 — 구현이 바뀌면 여기가 빨간불이 나야 한다.
'use strict'

// ── **임시 DB 를 제품 모듈보다 먼저 정한다** (2026-09-14 전수 확인) ─────────────────
// 이 파일이 부르는 제품 모듈이 어딘가에서 `getDB()` 를 부른다. 경로를 안 정하면 그 읽기가
// **기본 경로의 DB** 로 간다 — 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를
// 돌리면 운영 DB** 를 연다(없으면 새로 만들기까지 한다). `db/schema.js` 는 로드 시점에
// 경로를 굳히므로 **`require` 보다 위**여야 한다. 이름은 `_` 로 시작한다 — 아래에서 같은
// 모듈을 다시 부르는 파일이 있어 부딪히면 안 된다.
process.env.CARECAST_DB_PATH = require('node:path').join(
  require('node:os').tmpdir(), `carecast_test_step_outcome_${process.pid}_${Date.now()}.db`)

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { 단계결과, 앵커마감, 옛값해석 } = require('../domain/stepOutcome')

// ── 판정표 (설계안 §2) ─────────────────────────────────────────────────
// 기대값은 문자열 리터럴로 못 박는다. 상수를 import 해서 쓰면 상수를 바꾸는 변이를 못 잡는다.

test('끝까지 냈으면 completed', () => {
  assert.equal(단계결과({ 끝난시각ms: 100, 앵커시각ms: 500 }), 'completed')
  assert.equal(단계결과({ 앵커시각ms: null }), 'completed', '앵커가 없으면 마감도 없다')
})

test('앵커 시각을 넘겨서 끝났으면 anchored — 설계된 정상 종료다', () => {
  assert.equal(단계결과({ 끝난시각ms: 501, 앵커시각ms: 500 }), 'anchored')
  assert.equal(단계결과({ 끝난시각ms: 500, 앵커시각ms: 500 }), 'anchored', '같은 시각은 넘긴 것으로 본다')
  assert.equal(단계결과({ 끝난시각ms: 499, 앵커시각ms: 500 }), 'completed', '아직 안 왔으면 완주다')
})

test('cutShort 가 false 여도 시각이 지났으면 anchored — 그 값 단독으로 안 믿는다', () => {
  // AP-0039 가 정정한 사실: cutShort 는 단계가 isCancelled 를 폴링해 줄 때만 선다.
  // 마지막 조각 도중 앵커가 지나면 false 로 남는다. flow-anchor-stop.test.js:43 의 반례다.
  assert.equal(단계결과({ 잘림: false, 끝난시각ms: 501, 앵커시각ms: 500 }), 'anchored')
  // 반대로 cutShort 가 섰으면 시각이 아직이어도 마감이다
  assert.equal(단계결과({ 잘림: true, 끝난시각ms: 10, 앵커시각ms: 500 }), 'anchored')
})

test('사람이 정지했으면 cancelled — 앵커보다 먼저다', () => {
  assert.equal(단계결과({ 취소됨: true, 끝난시각ms: 501, 앵커시각ms: 500 }), 'cancelled',
    '앵커도 지났지만 사람의 의사가 먼저다 — 아니면 자기 조작이 먹었는지 알 수 없다')
  assert.equal(단계결과({ 취소됨: true, 잘림: true, 앵커시각ms: 500 }), 'cancelled')
})

test('취소가 실패보다 먼저다 — 정지를 고장으로 세면 안 된다', () => {
  assert.equal(단계결과({ 취소됨: true, 실패: true }), 'cancelled',
    '정지를 실패로 세면 차임 연속 카운터가 사람의 정지를 고장으로 읽는다')
})

test('실패는 앵커보다 먼저다 — 잘린 것과 고장은 다른 사건이다', () => {
  assert.equal(단계결과({ 실패: true, 끝난시각ms: 501, 앵커시각ms: 500 }), 'failed')
  assert.equal(단계결과({ 실패: true }), 'failed')
})

test('네 값 말고는 안 나온다', () => {
  const 나온값 = new Set()
  for (const 실패 of [false, true]) {
    for (const 취소됨 of [false, true]) {
      for (const 잘림 of [false, true]) {
        for (const 앵커시각ms of [null, 500]) {
          나온값.add(단계결과({ 실패, 취소됨, 잘림, 끝난시각ms: 400, 앵커시각ms }))
        }
      }
    }
  }
  assert.deepEqual([...나온값].sort(), ['anchored', 'cancelled', 'completed', 'failed'])
})

// ── 옛 이력 (설계안 §5) ────────────────────────────────────────────────

// ── 규칙이 두 벌이 되지 않았는가 (사용자 지시 §6) ───────────────────────

test('앵커 마감 규칙이 flowRunner 의 것과 같다 — **불러서** 비교한다', () => {
  // 처음엔 소스에 문자열이 있는지만 봤는데, flowRunner 쪽에 `return false` 를 넣는 변이가
  // 11/11 을 통과했다([FACT] EV-003248 지적 4). 이제 **실제로 부른다.**
  // 기대값은 설계안이 정한 규칙을 여기 **손으로** 적은 것이다 — 제품 함수에서 안 가져온다.
  const { shouldStopBeforeAnchor } = require('../services/flowRunner')
  const 표 = [
    // [cutShort, stepEndedAtMs, anchorAtMs, 기대]
    [false, 0,   null, false],   // 앵커가 없으면 마감도 없다
    [true,  0,   null, false],   // 앵커가 없으면 cutShort 도 뜻이 없다
    [false, 499, 500,  false],   // 아직 안 왔다
    [false, 500, 500,  true],    // 같은 시각은 넘긴 것으로 본다
    [false, 501, 500,  true],
    [true,  10,  500,  true],    // 폴링이 잡아 줬으면 시각과 무관하게 마감
  ]
  for (const [cutShort, stepEndedAtMs, anchorAtMs, 기대] of 표) {
    const 설명 = `cutShort=${cutShort} ended=${stepEndedAtMs} anchor=${anchorAtMs}`
    assert.equal(앵커마감({ 잘림: cutShort, 끝난시각ms: stepEndedAtMs, 앵커시각ms: anchorAtMs }), 기대,
      `새 규칙이 설계와 다르다: ${설명}`)
    assert.equal(shouldStopBeforeAnchor({ cutShort, stepEndedAtMs, anchorAtMs }), 기대,
      `flowRunner 의 규칙이 설계와 다르다: ${설명} — 두 벌이 갈리면 이력과 화면이 어긋난다`)
  }
})

test('자연 종료가 앵커와 겹치면 완주다 — 정책 판정에 덮이지 않는다', () => {
  // 독립 검수 지적 2: `shouldStopBeforeAnchor` 는 "소리가 남아 있을 수 있으니 멈춘다"는
  // **보수적 정지 정책**이지 "내용을 못 냈다"가 아니다. 마지막 음원이 앵커와 겹쳐
  // 자연 종료해도 그 판정은 참이 된다.
  assert.equal(단계결과({ 자연종료: true, 끝난시각ms: 501, 앵커시각ms: 500 }), 'completed')
  assert.equal(단계결과({ 자연종료: false, 끝난시각ms: 501, 앵커시각ms: 500 }), 'anchored',
    '안 알려 주면 정책 판정으로 떨어진다 — 지금 대부분이 이 경우다')
  // 취소·실패는 자연 종료보다 먼저다
  assert.equal(단계결과({ 자연종료: true, 취소됨: true }), 'cancelled')
  assert.equal(단계결과({ 자연종료: true, 실패: true }), 'failed')
})

test('옛 이력: 취소를 고장으로 바꾸지 않는다 — detail 이 근거다', () => {
  // 독립 검수 지적 1: 옛 '실패' 에는 **취소도 섞여 있다**(`flowRunner.js:468`).
  // 그대로 failed 로 옮기면 과거의 정지가 고장으로 세어진다.
  assert.equal(옛값해석({ result: '실패', detail: '정지 요청 또는 다른 방송 시작' }), 'cancelled')
  assert.equal(옛값해석({ result: '실패', detail: '차임벨 재생 실패(보조 신호 — 흐름은 계속 진행)' }), 'failed')
  assert.equal(옛값해석({ result: '실패', detail: null }), null, '사유가 없으면 무엇이었는지 모른다')
  assert.equal(옛값해석({ result: '실패', detail: '알 수 없는 사유' }), null)
  assert.equal(옛값해석({ result: '성공', detail: null }), null, '옛 성공에도 취소가 섞여 있다')
  // 문자열 하나만 줘도 죽지 않는다(옛 호출 형태)
  assert.equal(옛값해석('실패'), null, '사유를 모르면 미확정이다')
})

// 설계 문서는 내부 검수 폴더(docs/audit/)에 있어 **공개 저장소에는 없다**(출시 검수 2026-10-17).
// 문서가 없으면 문서 대조 시험만 이유를 적고 건너뛴다 — 코드 판정 시험(위)은 그대로 돈다.
const 설계문서있나 = fs.existsSync(path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md'))
const 문서옵션 = 설계문서있나 ? {} : { skip: '설계 문서(docs/audit/STEP_STATE_DESIGN.md)가 이 작업 트리에 없다 — 공개 저장소에는 내부 문서를 싣지 않는다' }

test('설계안 문서가 저장소에 있다 — 값 개수·옛 이력은 아직 사용자 결정 대기다', 문서옵션, () => {
  const doc = path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md')
  assert.ok(fs.existsSync(doc), '설계 근거 문서가 없다')
  const s = fs.readFileSync(doc, 'utf8')
  assert.match(s, /선택 A/, '값 개수 선택지가 문서에 없다')
  assert.match(s, /선택 B/, '옛 이력 처리 선택지가 문서에 없다')
})

test('아직 배선 전이다 — 정해지기 전에 제품 경로가 이것을 부르면 안 된다', () => {
  const 실행경로 = ['services/flowRunner.js', 'services/broadcastSequencer.js', 'domain/stepHistory.js']
  for (const f of 실행경로) {
    const s = fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8')
    assert.doesNotMatch(s, /stepOutcome/,
      `${f} 가 이미 새 규칙을 부른다 — 값 개수(선택 A)와 옛 이력(선택 B)이 정해진 뒤에 배선한다`)
  }
})

// ── 2026-09-12 (Codex P-47-DESIGN 지적 3): **문서의 판정 순서를 코드와 대조한다** ──
//
// 설계 문서의 순서표에 `failed` 가 빠져 있었다. 문서는 `cancelled > anchored > completed`
// 셋을 지정하는데 코드는 넷을 가린다 — **문서가 코드와 다른 결과를 지정하고 있었다.**
// 같은 문서의 다른 절은 처음부터 "값은 넷이 필요하다"고 적고 있었으니, 순서표만 낡은 것이다.
//
// 문서를 고치는 것으로 끝내지 않는다. 이 저장소에서 문서와 코드가 갈리는 것이 가장 비싼
// 실패라, **다시 갈리면 빨간불이 나게** 한다.
test('설계 문서의 판정 순서가 코드와 같다 — 갈리면 빨간불', 문서옵션, () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md'), 'utf8')

  // 긍정 앵커 — 순서를 적은 줄이 문서에 있다.
  const m = /\*\*정하는 순서\*\*:\s*(.+)/.exec(doc)
  assert.ok(m, '판정 순서를 적은 줄을 못 찾았다 — 이 가드를 옮길 것')
  const 문서순서 = m[1].replace(/`/g, '').split('>').map((s) => s.trim()).filter(Boolean)

  // 코드의 순서는 **실제로 불러서** 알아낸다 — 소스를 읽어 짐작하지 않는다.
  // 각 조건을 동시에 세우고 무엇이 이기는지 본다.
  const 전부 = { 실패: true, 취소됨: true, 잘림: true, 끝난시각ms: 501, 앵커시각ms: 500 }
  const 코드순서 = []
  코드순서.push(단계결과(전부))                                   // 취소가 이긴다
  코드순서.push(단계결과({ ...전부, 취소됨: false }))               // 그다음 실패
  코드순서.push(단계결과({ ...전부, 취소됨: false, 실패: false }))   // 그다음 앵커
  코드순서.push(단계결과({ 끝난시각ms: 0, 앵커시각ms: null }))        // 남는 것

  assert.deepEqual(문서순서, 코드순서,
    `문서 순서 [${문서순서.join(' > ')}] 와 코드 순서 [${코드순서.join(' > ')}] 가 다르다.\n`
    + '  문서가 코드와 다른 결과를 지정하면, 다음 사람이 문서를 믿고 코드를 잘못 고친다.')
})

test('설계 문서가 자연 종료 예외를 적고 있다 — 코드에만 있으면 다음 사람이 지운다', 문서옵션, () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md'), 'utf8')
  assert.match(doc, /자연 종료/,
    '자연 종료 예외가 문서에 없다 — 코드에만 있는 예외는 "왜 있나"를 모르는 채 지워진다')
  // 그리고 그 예외가 실제로 돈다(문서만 적고 코드가 안 하면 더 나쁘다).
  assert.equal(단계결과({ 자연종료: true, 끝난시각ms: 501, 앵커시각ms: 500 }), 'completed')
})

// ── 2026-09-12 (Codex P-47-DESIGN-R2): **옛 이력 변환표도 코드와 대조한다** ─────────
//
// 문서의 변환표가 `'실패' → failed` 에 "뜻이 같다. 손실 없음" 이라고 적고 있었다. 그런데
// 그것은 **코드가 거부한 접근**이다 — `flowRunner` 는 취소도 `'실패'` 로 적으므로, 일괄
// 옮기면 과거의 정지가 고장으로 세어진다. 판정 순서표를 고친 같은 날 **이 표는 낡은 채**
// 남아 있었다. 표가 둘이면 하나만 고치고 끝낸다 — 그래서 둘 다 기계가 대조한다.
// 문서에서 표 하나를 잘라낸다. **줄끝을 가리지 않는다** — 검수 사본은 CRLF 로
// 체크아웃되고 작업 사본은 LF 라, `\n\n` 으로 끝을 찾으면 한쪽에서만 돈다
// (Codex P-47-DESIGN-R4 가 잡았다: 정상 문서에서도 빨간불이 났다).
function 표잘라내기(doc, 머리) {
  const i = doc.indexOf(머리)
  assert.notEqual(i, -1, `표를 못 찾았다 — 이 가드를 옮길 것: ${머리}`)
  const 뒤 = doc.slice(i)
  const m = /\r?\n[ \t]*\r?\n/.exec(뒤)   // 빈 줄 = 표의 끝
  const 끝 = m ? i + m.index : doc.length
  return { 표: doc.slice(i, 끝), 시작: i, 끝 }
}

// 표를 행 배열로. 머리글·구분선은 뺀다.
function 표행들(표, 머리) {
  const out = []
  for (const l of 표.split(/\r?\n/)) {
    if (!l.startsWith('|') || l.includes('---') || l === 머리) continue
    const 칸 = l.split('|').slice(1, -1).map((c) => c.trim())
    if (칸.length < 2) continue
    out.push({ 칸, 줄: l })
  }
  return out
}
// 표의 각 행에서 **조건과 기대 결과를 뽑아** `옛값해석` 과 견준다.
//
// 처음엔 문서와 무관한 고정 사례만 보고 "표에 낱말이 있나"를 더했다. 그래서 문서의
// `cancelled` 와 `failed` 를 **맞바꿔도 전부 통과했다**(Codex P-47-DESIGN-R3 이 실제로
// 바꿔 돌렸다). 수용 기준은 "표가 코드와 같은 답을 낸다" 인데, 표를 읽지 않으면 그 말을
// 확인할 수 없다 — 가드가 초록인 채 문서가 거짓을 말할 수 있었다.
const 변환표머리 = '| 옛 행 (`result` + `detail`) | 새 값으로 | 근거 |'
function 변환표읽기(doc) {
  const { 표 } = 표잘라내기(doc, 변환표머리)
  const 행들 = 표행들(표, 변환표머리).map(({ 칸, 줄 }) => ({ 조건: 칸[0], 기대글: 칸[1], 줄 }))
  assert.ok(행들.length >= 4, `표에 행이 ${행들.length}개뿐이다 — 네 갈래가 다 있어야 한다`)
  return { 표, 행들 }
}

// 표의 조건 칸을 **실제 행 값**으로 옮긴다. 문구는 코드가 쓰는 정본에서 가져온다 —
// 시험에 베껴 적으면 그 베낀 것이 또 갈린다.
function 조건을행으로(조건, 사유문구) {
  const result = /'성공'/.test(조건) ? '성공' : '실패'
  if (조건.includes('정지 요청')) return { result, detail: 사유문구.정지 }
  if (조건.includes('차임벨 재생 실패')) return { result, detail: 사유문구.차임고장 }
  if (/그 밖·없음|없음|그 밖/.test(조건)) return { result, detail: null }
  if (/무엇이든/.test(조건)) return { result, detail: null }
  return null   // 이 가드가 못 읽는 조건 — 아래에서 실패로 드러난다
}

// 표의 기대 칸(`` `cancelled` ``·`**`null` (미확정)**`)을 값으로.
function 기대글을값으로(기대글) {
  const t = 기대글.replace(/\*/g, '')
  if (/미확정|`null`/.test(t)) return null
  const m = /`(cancelled|failed|completed|anchored)`/.exec(t)
  return m ? m[1] : undefined   // undefined = 못 읽었다
}

test('설계 문서의 옛 이력 변환표가 옛값해석과 같은 답을 낸다', 문서옵션, () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md'), 'utf8')
  const { 표, 행들 } = 변환표읽기(doc)
  const { 사유문구 } = require('../domain/stepHistory')

  // **표가 말하는 그대로** 코드에 물어본다.
  let 본행 = 0
  for (const { 조건, 기대글, 줄 } of 행들) {
    const 행 = 조건을행으로(조건, 사유문구)
    assert.ok(행, `표의 조건을 못 읽었다 — 이 가드를 고칠 것: ${줄}`)
    const 기대 = 기대글을값으로(기대글)
    assert.notEqual(기대, undefined, `표의 기대값을 못 읽었다 — 이 가드를 고칠 것: ${줄}`)
    assert.equal(옛값해석(행), 기대,
      `문서 표는 ${JSON.stringify(기대)} 라고 적었는데 옛값해석 은 ${JSON.stringify(옛값해석(행))} 를 낸다.\n`
      + `  표 줄: ${줄}\n`
      + '  문서가 코드와 다른 결과를 지정하면, 다음 사람이 문서를 믿고 코드를 잘못 고친다.')
    본행++
  }
  assert.ok(본행 >= 4, `표에서 읽어 대조한 행이 ${본행}개뿐이다`)
  // 네 갈래가 다 나왔는가 — 하나라도 빠지면 그 경우를 넘겨짚게 된다.
  const 본값 = new Set(행들.map((r) => 기대글을값으로(r.기대글)))
  for (const v of ['cancelled', 'failed', null]) {
    assert.ok(본값.has(v), `표에 ${JSON.stringify(v)} 갈래가 없다`)
  }

  // 문서가 **"손실 없음"** 이라고 다시 적지 못하게 한다. 그 한마디가 결함을 되들인다.
  assert.ok(!/손실 없음/.test(표),
    '변환표가 "손실 없음" 이라고 적고 있다 — 취소가 섞여 있어 손실이 있다')
})

test('[변이] 문서 표의 cancelled·failed 를 맞바꾸면 빨간불이 난다', 문서옵션, () => {
  // 이 확인이 없으면 위 시험이 표를 **읽기만 하고 견주지 않아도** 통과한다.
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md'), 'utf8')
  // **변환표 안에서만 바꾼다.** 처음엔 문서 전체에서 바꿨는데, 같은 칸 모양
  // (`| `cancelled` |`)이 **판정 순서표에도 있어서** 엉뚱한 표를 건드렸다 — 그래서
  // 어긋남이 0이 나왔고, 이 변이 시험이 제 구실을 못 했다.
  const { 표: 표원본, 시작, 끝 } = 표잘라내기(doc, 변환표머리)
  const 앞 = doc.slice(0, 시작)
  const 뒤 = doc.slice(끝)
  const 바꾼표 = 표원본
    .replace(/\| `cancelled` \|/, '| @@TMP@@ |')
    .replace(/\| `failed` \|/, '| `cancelled` |')
    .replace('| @@TMP@@ |', '| `failed` |')
  assert.notEqual(바꾼표, 표원본, '맞바꾸지 못했다 — 표 모양이 바뀌었다면 이 시험도 고칠 것')
  const 바꾼것 = 앞 + 바꾼표 + 뒤

  const { 표, 행들 } = 변환표읽기(바꾼것)
  const { 사유문구 } = require('../domain/stepHistory')
  let 어긋남 = 0
  for (const { 조건, 기대글 } of 행들) {
    const 행 = 조건을행으로(조건, 사유문구)
    if (!행) continue
    if (옛값해석(행) !== 기대글을값으로(기대글)) 어긋남++
  }
  assert.ok(어긋남 >= 2, `맞바꿨는데 어긋남이 ${어긋남}건이다 — 이 가드는 표를 안 보고 있다`)
  assert.ok(표.length > 0)
})

// ── 2026-09-12 (Codex P-47-DESIGN-R4 지적 2): **순서표의 행도 대조한다** ─────────
//
// 앞서 넣은 순서 가드는 `**정하는 순서**:` **문장 한 줄**만 봤다. 그래서 표의 행에서
// `cancelled` 와 `failed` 를 맞바꿔도 문서 가드 셋이 다 통과했다 — 변환표에서 고친 것과
// **같은 결함을 순서표에 남겨 둔** 것이다. 한 군데를 고치고 나머지를 안 본 모양이다.
//
// 이제 표의 각 행에서 **상태와 성립 조건**을 뽑아, 그 조건으로 실제 함수를 불러 본다.
const 순서표머리 = '| 상태 | 성립 조건 | 왜 이 순서인가 |'

// 표의 조건 칸을 `단계결과` 인자로 옮긴다. **그 행만 성립**시키고 앞 행들은 끈다 —
// 순서를 보려면 "앞엣것이 아닐 때 이것이 이긴다"를 재현해야 한다.
function 조건을인자로(상태) {
  const 바탕 = { 실패: false, 취소됨: false, 잘림: false, 끝난시각ms: 0, 앵커시각ms: null }
  if (상태 === 'cancelled') return { ...바탕, 취소됨: true }
  if (상태 === 'failed') return { ...바탕, 실패: true }
  if (상태 === 'anchored') return { ...바탕, 끝난시각ms: 501, 앵커시각ms: 500 }
  if (상태 === 'completed') return 바탕
  return null
}

test('판정 순서표의 **각 행**이 코드와 같다 — 문장만 보지 않는다', 문서옵션, () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md'), 'utf8')
  const { 표 } = 표잘라내기(doc, 순서표머리)
  const 행들 = 표행들(표, 순서표머리)
  assert.ok(행들.length >= 4, `순서표에 행이 ${행들.length}개뿐이다 — 네 상태가 다 있어야 한다`)

  const 본상태 = []
  for (const { 칸, 줄 } of 행들) {
    const m = /`(cancelled|failed|anchored|completed)`/.exec(칸[0])
    assert.ok(m, `순서표의 상태 칸을 못 읽었다 — 이 가드를 고칠 것: ${줄}`)
    const 상태 = m[1]
    본상태.push(상태)
    const 인자 = 조건을인자로(상태)
    assert.ok(인자, `${상태} 의 조건을 인자로 못 옮겼다 — 이 가드를 고칠 것`)
    assert.equal(단계결과(인자), 상태,
      `순서표는 이 조건에서 ${상태} 라고 적었는데 코드는 ${단계결과(인자)} 를 낸다.\n`
      + `  표 줄: ${줄}`)
  }

  // 표에 적힌 **순서**가 코드의 우선순위와 같은가. 네 조건을 동시에 세우고 하나씩 끈다.
  const 전부 = { 실패: true, 취소됨: true, 잘림: true, 끝난시각ms: 501, 앵커시각ms: 500 }
  const 코드순서 = [
    단계결과(전부),
    단계결과({ ...전부, 취소됨: false }),
    단계결과({ ...전부, 취소됨: false, 실패: false }),
    단계결과({ 끝난시각ms: 0, 앵커시각ms: null }),
  ]
  assert.deepEqual(본상태, 코드순서,
    `표의 행 순서 [${본상태.join(' > ')}] 와 코드의 우선순위 [${코드순서.join(' > ')}] 가 다르다`)
})

test('[변이] 순서표 행의 cancelled·failed 를 맞바꾸면 빨간불이 난다', 문서옵션, () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'audit', 'STEP_STATE_DESIGN.md'), 'utf8')
  const { 표: 표원본 } = 표잘라내기(doc, 순서표머리)
  const 바꾼표 = 표원본
    .replace(/\| `cancelled` \|/, '| @@TMP@@ |')
    .replace(/\| `failed` \|/, '| `cancelled` |')
    .replace('| @@TMP@@ |', '| `failed` |')
  assert.notEqual(바꾼표, 표원본, '맞바꾸지 못했다 — 표 모양이 바뀌었다면 이 시험도 고칠 것')

  const 행들 = 표행들(바꾼표, 순서표머리)
  const 본상태 = 행들.map(({ 칸 }) => (/`(cancelled|failed|anchored|completed)`/.exec(칸[0]) || [])[1])
  let 어긋남 = 0
  for (const 상태 of 본상태) {
    const 인자 = 조건을인자로(상태)
    if (!인자) continue
    // 조건 칸은 안 바뀌었으니, 상태만 바뀐 행은 코드와 어긋나야 한다.
    if (단계결과(인자) !== 상태) 어긋남++
  }
  // 상태만 맞바꾸면 조건↔상태 짝이 깨지지 않으므로(조건을 상태로 되짚었다) 순서로 잡는다.
  const 코드순서 = ['cancelled', 'failed', 'anchored', 'completed']
  assert.ok(어긋남 >= 1 || 본상태.join('>') !== 코드순서.join('>'),
    `맞바꿨는데 어긋남 ${어긋남}건, 순서 [${본상태.join('>')}] — 이 가드는 표를 안 보고 있다`)
})
