// **캘린더 제목이 스피커로 나가기 전에 가려진다** (사용자 결정 2026-09-15).
//
// ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
// 아침 종합 방송(07:50)은 구글 캘린더를 **무인으로** 읽어 그 제목을 그대로 말한다.
// 직원이 자유롭게 적는 칸이라 「김영희 어르신 생신」·「박영수 보호자 면회 010-…」 같은
// 것이 들어오고, 여태 **검사가 하나도 없었다** — 그대로 음성 합성에 넘어가고 전관
// 스피커로 나가고 이력에 남았다.
//
// 되묻는 장치(`checkSensitive` 의 409)는 여기서 못 쓴다. **07:50 에 물어볼 사람이 없다.**
//
// ── 규칙 ────────────────────────────────────────────────────────────────────
//  · 주민등록번호·휴대폰번호·생년월일 → 그 일정을 **통째로 안 읽는다**
//  · 이름 → **성만 남긴다**(「김 어르신」). `○` 를 안 쓰는 이유는 **소리로 나가기 때문**이다 —
//    음성 합성기가 「동그라미」라고 읽는다.
//  · 전부 빠지면 **아무 말도 안 한다.** 「일정이 없습니다」는 거짓이다(있는데 못 읽는 것).
//  · 화면 카드는 **원본 그대로** — 직원은 누구인지 알아야 한다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_cal_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const S = require('../services/sensitiveInfo')

test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

// ── 가림 규칙 자체 ──────────────────────────────────────────────────────────

test('**이름은 성만 남는다** — 「김영희 어르신」 → 「김 어르신」', () => {
  const r = S.방송용가리기('김영희 어르신 생신')
  assert.equal(r.뺌, false)
  assert.equal(r.텍스트, '김 어르신 생신')
  assert.ok(!r.텍스트.includes('영희'), `이름이 그대로 남았다: ${r.텍스트}`)
})

test('**가림에 `○` 를 안 쓴다** — 소리로 나가면 「동그라미」로 읽힌다', () => {
  const r = S.방송용가리기('김영희 어르신 생신')
  for (const 글자 of ['○', '*', 'O', '●', 'X']) {
    assert.ok(!r.텍스트.includes(글자),
      `가림 문자 「${글자}」 가 들어갔다 — 음성 합성기가 그대로 읽는다: ${r.텍스트}`)
  }
})

test('**주민번호·전화·생년월일이 있으면 그 일정을 통째로 뺀다**', () => {
  for (const [글, 사유] of [
    ['박영수 보호자 면회 010-1234-5678', '휴대폰번호'],
    ['입소 상담 880101-1234567', '주민등록번호'],
    ['최영수 어르신 생신 1940년 3월 2일', '생년월일'],
  ]) {
    const r = S.방송용가리기(글)
    assert.equal(r.뺌, true, `안 뺐다: ${글} → ${r.텍스트}`)
    assert.equal(r.텍스트, null, '뺐다면서 문장을 돌려줬다')
    assert.ok(r.사유.includes(사유), `사유가 다르다: ${r.사유.join('·')} (기대: ${사유})`)
  }
})

test('**평범한 일정은 한 글자도 안 건드린다** — 헛가림이 잦으면 안내가 못 쓰게 된다', () => {
  for (const 글 of ['10시 음악치료', '오후 2시 체조', '가족 면회의 날', '반드시 어르신 확인']) {
    const r = S.방송용가리기(글)
    assert.equal(r.뺌, false, `멀쩡한 일정을 뺐다: ${글}`)
    assert.equal(r.텍스트, 글, `멀쩡한 일정을 고쳤다: ${글} → ${r.텍스트}`)
  }
})

test('**경보에 실명을 싣지 않는다** — 스피커를 막고 경보로 새면 막은 게 아니다', () => {
  const r = S.방송용가리기('김영희 어르신 생신')
  for (const n of r.가린이름) {
    assert.ok(!n.includes('영희'), `가린이름에 원문이 들어 있다: ${n}`)
  }
})

test('**찾는 자리가 하나다** — 경고되는 이름과 가려지는 이름이 갈리면 안 된다', () => {
  const 글 = '김영희 어르신과 이순신 어르신 산책'
  const 경고 = S.detectSensitive(글).warnings.filter(w => w.type === 'name').length
  const 가림 = S.방송용가리기(글).가린이름.length
  assert.equal(가림, 경고, `경고 ${경고}건인데 ${가림}건만 가렸다 — 두 규칙이 갈렸다`)
  assert.ok(경고 >= 2, `앵커가 약하다 — 이름을 ${경고}건만 찾았다`)
})

// ── 아침 방송 문장까지 ──────────────────────────────────────────────────────

test('**아침 방송 문장에 실명이 안 들어간다**', () => {
  const { buildSegmentText } = require('../services/morning')
  const 문장 = buildSegmentText('schedule', {
    events: [{ title: '김영희 어르신 생신' }, { title: '10시 음악치료' }],
  })
  assert.ok(문장.includes('음악치료'), `멀쩡한 일정이 사라졌다: ${문장}`)
  assert.ok(!문장.includes('영희'), `실명이 방송 문장에 있다: ${문장}`)
  assert.ok(문장.includes('김 어르신'), `성만 남기기가 안 먹었다: ${문장}`)
})

test('**차단 항목이 든 일정만 빠지고 나머지는 나간다**', () => {
  const { buildSegmentText } = require('../services/morning')
  const 문장 = buildSegmentText('schedule', {
    events: [{ title: '박영수 보호자 면회 010-1234-5678' }, { title: '오후 2시 체조' }],
  })
  assert.ok(!문장.includes('010'), `전화번호가 방송 문장에 있다: ${문장}`)
  assert.ok(!문장.includes('영수'), `실명이 방송 문장에 있다: ${문장}`)
  assert.ok(문장.includes('체조'), `멀쩡한 일정까지 뺐다: ${문장}`)
})

test('**전부 빠지면 침묵한다** — 「일정이 없습니다」는 거짓이다', () => {
  const { buildSegmentText } = require('../services/morning')
  const 문장 = buildSegmentText('schedule', {
    events: [{ title: '입소 상담 880101-1234567' }],
  })
  assert.equal(문장, '',
    `일정이 있는데 「${문장}」 라고 말한다 — 없는 것과 못 읽는 것은 다르다`)
})

test('긍정 앵커 — 평범한 날은 예전과 똑같이 말한다', () => {
  const { buildSegmentText } = require('../services/morning')
  assert.equal(
    buildSegmentText('schedule', { events: [{ title: '10시 음악치료' }, { title: '오후 2시 체조' }] }),
    '오늘의 주요 일정을 안내해 드립니다. 10시 음악치료, 오후 2시 체조 순서로 진행됩니다.')
  assert.equal(buildSegmentText('schedule', { events: [] }), '오늘 등록된 일정이 없습니다.')
})
