// 단계 실패의 **사유**가 이력에 남는다 (P-57, 2026-09-10).
//
// **무엇이 문제였나**: `runCustomExtraStep` 이 결과를 boolean 으로 뭉갰다. 그래서 셋이
// 이력에서 **글자 그대로 같은 줄**로 보였다 —
//   ① 차임 장치가 안 울렸다  ② 사람이 정지했다  ③ 이 단계에 실행할 것이 없다.
// 부르는 쪽(`runStepGuarded`)은 취소인지를 `isCancelled(tok)` 로 **다시 추측**해 복원했는데,
// 되짚기라서 틈이 생긴다: **진짜 차임 고장 직후에 다른 방송이 밀어내면** 그 순간
// `isCancelled` 가 참이 되어 **그 실패가 기록 없이 사라진다.**
//
// 흐름(flowRunner)은 처음부터 셋을 갈라 적고 있었다. 자동방송만 안 그랬다 —
// 오늘 §6 에서 정리한 "같은 규칙이 두 곳, 한쪽만 고침"(FP-0005)의 또 한 건이다.
//
// ── 이 검사가 기대값을 어디서 가져오나 ────────────────────────────────────
// **사유 문구는 `domain/stepHistory` 의 정본을 쓴다** — 문구 자체는 이 검사의 판정 대상이
// 아니라 "쓰는 곳과 읽는 곳이 같은가"의 문제라, 여기 베껴 적으면 그게 다시 두 벌이 된다.
// **가르는 규칙(무엇이 무엇으로 적히는가)은 손으로 적는다** — 그게 승인된 수용 기준이다.
'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_stepreason_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const stepHistory = require('../domain/stepHistory')
const { 단계사유, 사유문구, 이력판정 } = stepHistory

initDB()
test.after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없으면 무시 */ } }
})

// ── 판정 규칙 — 승인된 수용 기준을 손으로 적는다 ─────────────────────────

test('취소는 적지 않는다 — 정지 버튼을 누른 사람에게 실패를 보이지 않는다', () => {
  assert.equal(이력판정(단계사유.취소), null,
    '취소가 이력에 남으면 "소리가 안 났을 수 있습니다"라고 거짓말하는 행이 생긴다')
})

test('차임 고장과 "실행할 것 없음"이 다른 줄로 남는다 — 이것이 P-57 의 요지다', () => {
  const 고장 = 이력판정(단계사유.차임고장)
  const 없음 = 이력판정(단계사유.없음)
  assert.equal(고장.result, '실패')
  assert.equal(없음.result, '실패')
  assert.notEqual(고장.detail, 없음.detail,
    '차임 장치 고장과 빈 단계가 같은 줄로 남는다 — 사람이 무엇을 고쳐야 할지 알 수 없다')
  assert.equal(고장.detail, 사유문구.차임고장)
  assert.equal(없음.detail, 사유문구.없음)
})

test('아무것도 안 돌려주면 성공이다 — 대부분의 단계가 그렇다', () => {
  // undefined 를 실패로 보면 멀쩡한 방송이 전부 실패로 찍힌다.
  assert.deepEqual(이력판정(undefined), { result: '성공', detail: null })
  assert.deepEqual(이력판정(null), { result: '성공', detail: null })
  assert.equal(이력판정('아무 값').result, '성공', '모르는 값을 실패로 단정하지 않는다')
})

test('옛 규약(false)도 조용히 성공으로 둔갑하지 않는다', () => {
  const r = 이력판정(false)
  assert.equal(r.result, '실패')
  assert.equal(r.detail, 사유문구.알수없음)
})

test('사유 값 넷이 서로 다르다 — 하나라도 겹치면 판정이 뭉개진다', () => {
  const 값들 = Object.values(단계사유)
  assert.equal(new Set(값들).size, 값들.length, `사유 값이 겹친다: ${값들.join(', ')}`)
  const 문구들 = Object.values(사유문구)
  assert.equal(new Set(문구들).size, 문구들.length, `사유 문구가 겹친다: ${문구들.join(' / ')}`)
})

// ── 실제 경로 — 자동방송과 흐름이 **같은 어휘**를 나르는가 ────────────────

test('흐름과 자동방송이 같은 어휘를 쓴다 — 값을 베껴 적으면 대소문자 하나로 판정이 죽는다', () => {
  const flow = require('../services/flowRunner')
  assert.equal(flow.CANCELLED, 단계사유.취소, '흐름의 취소 값이 정본과 다르다')
  assert.equal(flow.CHIME_FAILED, 단계사유.차임고장, '흐름의 차임 고장 값이 정본과 다르다')
})

test('실행할 것이 없는 단계는 사유를 그대로 돌려준다 — boolean 으로 뭉개지 않는다', async () => {
  const { runCustomExtraStep } = require('../services/broadcastSteps')
  const { newBroadcastToken } = require('../services/broadcastGate')
  const tok = newBroadcastToken()
  // 내용이 빈 커스텀 tts — 시퀀서의 default 분기가 stepTTS 로 안 보내고 여기로 흘린다.
  const r = await runCustomExtraStep(getDB(), { customType: 'tts', content: '   ', label: '빈 단계' }, tok)
  assert.equal(r, 단계사유.없음,
    `${JSON.stringify(r)} 를 돌려줬다 — false 로 뭉개면 차임 고장과 같은 줄로 남는다`)
  assert.equal(이력판정(r).detail, 사유문구.없음)
})

test('코드에 없는 옛 단계 id 도 같은 대우다', async () => {
  const { runCustomExtraStep } = require('../services/broadcastSteps')
  const { newBroadcastToken } = require('../services/broadcastGate')
  const r = await runCustomExtraStep(getDB(), { customType: '옛날단계', label: '옛 단계' }, newBroadcastToken())
  assert.equal(r, 단계사유.없음)
})

// ── 되짚기가 사라졌는가 — 이 결함의 급소 ──────────────────────────────────

test('부르는 쪽이 취소 여부를 다시 추측하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSequencer.js'), 'utf8')
  const i = src.indexOf('async function runStepGuarded')
  assert.ok(i >= 0, 'runStepGuarded 가 사라졌다 — 이 검사의 앵커가 무너졌다')
  const LF = String.fromCharCode(10)
  // 주석은 뺀다 — 이 저장소는 머리말에 옛 동작을 그대로 인용하는 관례가 있다.
  const 본문 = src.slice(i, src.indexOf('} catch (err)', i))
    .split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)
  assert.match(본문, /이력판정\(/, '판정을 단일 출처에서 안 가져온다')
  assert.doesNotMatch(본문, /outcome === false/,
    'boolean 으로 다시 갈라 본다 — 사유를 나르는 의미가 없어진다')
  // 되짚기 자체가 사라졌는지: 결과 경로에서 isCancelled 를 다시 묻지 않는다.
  // (catch 절의 isCancelled 는 별개다 — 위 slice 가 거기까지 안 간다)
  assert.doesNotMatch(본문, /isCancelled\(tok\)/,
    '취소를 다시 추측한다 — 진짜 차임 고장 직후에 다른 방송이 밀어내면 그 실패가 사라진다')
})

// ── **틀 파일이 없는 단계도 사유를 남긴다** (V③ R18·R19 지적 2, 2026-09-14) ─────────────
//
// P-57 이 `runCustomExtraStep` 을 고쳤는데 **`stepAudioFile`·`stepVideoFile` 은 그대로였다.**
// 연결한 폴더에 틀 파일이 하나도 없으면 `"음원 없음 — 스킵"` 을 찍고 **맨 `return`**
// (= `undefined`)이었고, `이력판정` 의 마지막 줄이 그것을 **「성공·사유 없음」**으로 읽었다.
//
// 그래서 **방송이 아무 소리도 안 냈는데 이력에는 성공으로 남았다.** 오류도 경보도 없다 —
// 이 저장소가 가장 경계하는 조용한 실패다. 어휘(`단계사유.없음`)도 판정도 **이미 있었고**,
// 바로 윗줄(`단계사유.연결끊김`)은 제대로 쓰고 있었다. 이 자리만 빠뜨린 것이다.
test('연결한 폴더가 비어 있으면 「실행할 것 없음」으로 남는다 — 성공으로 둔갑하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'broadcastSteps.js'), 'utf8')
  const LF = String.fromCharCode(10)
  const 주석없이 = (s) => s.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)

  // **글자로만 보지 않는다** (V③ R23 지적 1, 2026-09-14). 소스 대조는 보조 앵커로만 남기고,
  // 아래에서 **진짜 단계를 불러 반환값을 본다** — 그게 이력에 무엇으로 적히는지의 근거다.
  const 코드 = 주석없이(src)
  for (const [앵커, 무엇] of [['음원 없음', '음원 단계'], ['영상 없음', '영상 단계']]) {
    const i = 코드.indexOf(앵커)
    assert.ok(i >= 0, `${무엇}의 "파일 없음" 자리를 못 찾았다 — 이 검사의 앵커가 무너졌다`)
    assert.match(코드.slice(i, i + 120), /return 단계사유\.없음/,
      `${무엇}에서 틀 파일이 없을 때 사유 없이 돌아간다 — 이력에 「성공」으로 남아 아무도 못 알아챈다`)
  }

  // **판정 쪽은 안 건드렸는지** 확인한다 — `undefined` 를 실패로 바꾸면 멀쩡한 단계가 전부
  // 실패로 찍힌다(대부분의 단계는 아무것도 안 돌려준다). 고칠 자리는 부르는 쪽이다.
  assert.deepEqual(이력판정(undefined), { result: '성공', detail: null },
    '아무것도 안 돌려준 단계를 실패로 바꿨다 — 멀쩡한 방송이 전부 실패로 찍힌다')
  assert.deepEqual(이력판정(단계사유.없음), { result: '실패', detail: 사유문구.없음 },
    '「실행할 것 없음」이 실패로 안 적힌다')
})

// ── **진짜 단계를 불러 반환값을 본다** (V③ R23 지적 1, 2026-09-14) ──────────────────────
//
// 위 시험은 소스를 읽는다. 검수관이 그것을 짚었다 — 글자는 멀쩡한데 동작이 다를 수 있다.
// 여기서는 **틀 파일이 하나도 없는 연결**을 주고 `stepAudioFile`·`stepVideoFile` 을 실제로
// 부른 뒤, 돌아온 값이 **이력에 무엇으로 적히는지**까지 이어서 본다.
// 그게 이 결함의 본질이었다 — 「성공·사유 없음」으로 남아 아무도 못 알아챘다.
test('빈 폴더 단계를 **실제로 불러** 이력까지 이어 본다', async () => {
  const db = getDB()
  // 아무 파일도 없는 폴더를 하나 만든다. 여기 연결된 단계는 틀 것이 없다.
  db.prepare("INSERT OR IGNORE INTO content_folders (id, category, parent_id, name) VALUES (9911, 'misc-audio', NULL, '빈 폴더')").run()
  db.prepare('DELETE FROM audio_files WHERE folder_id = 9911').run()

  const { stepAudioFile, stepVideoFile } = require('../services/broadcastSteps')
  // **제품이 실제로 넘기는 모양**을 그대로 쓴다(`domain/stepSource` 의 resolveStepSource 결과).
  // 처음엔 JSON 문자열을 넘겼는데, `연결로읽기` 는 문자열을 «그 카테고리 전체» 로 읽어서
  // 엉뚱한 카테고리 이름을 찾았다 — 시험이 제품이 안 쓰는 길을 돌면 재는 것이 달라진다.
  const 연결 = {
    kind: 'folder', origin: 'user', category: 'misc-audio',
    folderId: 9911, audioFileId: null, playlist: null, error: null,
  }

  // **진짜 토큰을 준다.** `isCancelled(tok)` 는 `_broadcastToken !== tok` 이라,
  // 앞 시험이 토큰을 하나라도 만들어 뒀으면 `null` 은 **취소로 판정**돼 단계가 일찍 빠진다
  // (그래서 처음에 `undefined` 가 돌아왔다). 제품도 언제나 토큰을 쥐고 부른다.
  const { newBroadcastToken } = require('../services/broadcastGate')
  for (const [이름, 부르기] of [
    ['음원', () => stepAudioFile(db, 연결, 0, 5, newBroadcastToken(), {})],
    ['영상', () => stepVideoFile(db, 연결, 5, newBroadcastToken(), {})],
  ]) {
    const 결과 = await 부르기()
    assert.equal(결과, 단계사유.없음,
      `${이름} 단계가 빈 폴더에서 사유를 안 돌려준다(받은 것: ${JSON.stringify(결과)})`)
    // **여기까지 이어서 본다** — 돌아온 값이 이력에 무엇으로 적히는가
    assert.deepEqual(이력판정(결과), { result: '실패', detail: 사유문구.없음 },
      `${이름} 단계가 아무 소리도 안 냈는데 이력에 성공으로 남는다`)
  }
})
