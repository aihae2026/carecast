// "이 자리에서 지금 나가는 파일은 무엇인가" — 판정의 단일 출처 (2026-09-04).
//
// 왜 필요했나: 같은 판정이 세 곳에 복사돼 있었고 서로 달랐다.
//   · 실행부(`broadcastSteps.js`)는 음원을 `ORDER BY id` 첫 번째로 골랐고
//   · 화면(`referenceBadge`)은 "무작위 후보로 사용"이라 적었으며
//   · 목록은 `uploaded_at DESC`(최신 먼저)로 보여줬다.
// 즉 **화면 맨 위 카드와 실제 나가는 파일이 정반대**였다. 녹음 음원을 새로 올려 바꾼 줄
// 알았는데 예전 것이 계속 나갔다 — 사람이 바꿨다고 믿는데 안 바뀌는, 가장 나쁜 실패다.
//
// 여기서 잠그는 것:
//  1. 재생목록이 없으면 예전 그대로다(올린 순서). **기존 현장의 동작이 변하지 않는다.**
//  2. 재생목록이 있으면 그 순서가 이긴다 — 「이걸로 바꾸기」가 그 순서를 쓴다.
//  3. 음원과 영상이 같은 규칙을 쓴다(예전엔 영상만 재생목록을 봤다).
//  4. 꺼둔(active=0) 항목은 안 나간다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_pick_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { pickCategoryFile, primaryFileId, makePrimary } = require('../domain/categoryPick')

let db
function 올림(category, name) {
  db.prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at)
              VALUES (?, ?, ?, 30, ?)`).run(category, `${name}.mp3`, `${name}.mp3`, new Date().toISOString())
  return db.prepare('SELECT id FROM audio_files ORDER BY id DESC LIMIT 1').get().id
}

test.before(() => { initDB(); db = getDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일 없으면 무시 */ }
  }
})

test('재생목록이 없으면 올린 순서 그대로 — 기존 현장의 동작이 안 변한다', () => {
  const 첫째 = 올림('lunch-prayer', '작년녹음')
  const 둘째 = 올림('lunch-prayer', '올해녹음')

  assert.equal(pickCategoryFile(db, 'lunch-prayer', 0).id, 첫째, '먼저 올린 것이 나가야 한다')
  assert.equal(pickCategoryFile(db, 'lunch-prayer', 1).id, 둘째)
  assert.equal(primaryFileId(db, 'lunch-prayer'), 첫째)
})

test('「이걸로 바꾸기」를 누르면 그 파일이 나간다', () => {
  const 둘째 = db.prepare("SELECT id FROM audio_files WHERE original_name = '올해녹음.mp3'").get().id
  makePrimary(db, 'lunch-prayer', 둘째)
  assert.equal(primaryFileId(db, 'lunch-prayer'), 둘째, '바꾼 파일이 안 나간다')
})

// 순서만 바뀔 뿐 나머지가 사라지면 안 된다 — 되돌리려면 다른 것을 다시 올려야 하는데,
// 목록에서 없어지면 되돌릴 방법이 사라진다.
test('바꿔도 나머지 파일은 목록에 남는다 — 되돌릴 수 있다', () => {
  const 전체 = db.prepare("SELECT id FROM audio_files WHERE category = 'lunch-prayer' ORDER BY id").all()
  const 목록 = db.prepare("SELECT audio_file_id FROM audio_playlist WHERE category = 'lunch-prayer'").all()
  assert.equal(목록.length, 전체.length, '바꾸면서 파일이 목록에서 사라졌다')

  const 첫째 = 전체[0].id
  makePrimary(db, 'lunch-prayer', 첫째)
  assert.equal(primaryFileId(db, 'lunch-prayer'), 첫째, '되돌리지 못한다')
})

test('꺼둔 항목은 나가지 않는다', () => {
  const 첫째 = primaryFileId(db, 'lunch-prayer')
  db.prepare('UPDATE audio_playlist SET active = 0 WHERE category = ? AND audio_file_id = ?')
    .run('lunch-prayer', 첫째)
  const 이제 = primaryFileId(db, 'lunch-prayer')
  assert.notEqual(이제, 첫째, '꺼둔 파일이 여전히 나간다')
  assert.ok(이제, '하나도 안 남았다 — 나머지가 나가야 한다')
})

// 예전엔 영상만 재생목록을 봤다. 규칙이 갈리면 "왜 영상은 바뀌는데 녹음 음원은 안 바뀌지"가 된다.
test('음원과 영상이 같은 규칙을 쓴다', () => {
  const a = 올림('exercise-video', '체조_봄')
  const b = 올림('exercise-video', '체조_여름')
  assert.equal(primaryFileId(db, 'exercise-video'), a)
  makePrimary(db, 'exercise-video', b)
  assert.equal(primaryFileId(db, 'exercise-video'), b, '영상도 같은 방법으로 바뀌어야 한다')
})

test('파일이 없으면 undefined — 그 단계는 건너뛴다', () => {
  assert.equal(pickCategoryFile(db, 'evening-prayer', 0), undefined)
  assert.equal(primaryFileId(db, 'evening-prayer'), null)
})

// 이 판정이 실행부·예상시간·화면 세 곳에서 **같은 함수**로 이뤄지는지 소스로 확인한다.
// 규칙을 두 번 쓰면 반드시 갈린다 — 실제로 그렇게 갈려 있었다.
test('실행부와 예상시간이 같은 함수를 쓴다 — 규칙을 두 번 쓰지 않는다', () => {
  const ROOT = path.join(__dirname, '..', '..')
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

  // 2026-09-13: 실행부·예상시간이 부르는 이름이 `pickCategoryFile` → **`pickSourceFile`** 로
  // 바뀌었다(연결 고르개, 설계 `design-upload-flow.md`). 단계가 카테고리만이 아니라
  // 폴더·파일도 가리킬 수 있게 되면서 인자가 "카테고리 이름"에서 "해석된 연결"로 넓어졌다.
  //
  // **지키려는 것은 그대로다** — 판정이 `domain/categoryPick` 한 곳에서만 이뤄지는가.
  // `pickSourceFile` 은 폴더가 지정되지 않으면 `pickCategoryFile` 에 **위임**하므로
  // 기존 다섯 방송의 규칙은 글자 그대로 같다(`categoryPick.js` 의 그 함수 주석 참고).
  const steps = read('server/services/broadcastSteps.js')
  assert.match(steps, /pickSourceFile\(db, 연결/, '실행부가 단일 출처를 안 쓴다')
  assert.doesNotMatch(steps, /FROM audio_files WHERE category = \? ORDER BY id/,
    '실행부에 파일 고르는 쿼리가 아직 남아 있다')

  // 예상시간의 재료 모으기는 2026-09-05에 domain/broadcastScheduleRead.js로 내려갔다(순수 이동).
  // **가드도 따라간다** — 옮긴 뒤에도 옛 파일을 보고 있으면 그 자리가 조용히 안 보이게 된다.
  const settings = read('server/domain/broadcastScheduleRead.js')
  assert.match(settings, /pickSourceFile\(db, 연결, 0\)/, '예상시간이 단일 출처를 안 쓴다')
  // 예상시간이 **카테고리 표를 다시 만들지 않는가**(2026-09-13). 예전엔 이 파일이
  // `STEP_AUDIO_CATEGORY` + 저녁 마무리 폴백을 한 벌 더 갖고 있었다 — 이제 연결 해석이
  // `domain/stepSource` 한 곳이라 그 사본이 필요 없다.
  assert.match(settings, /resolveStepSource/, '예상시간이 연결 해석을 안 쓴다')
  assert.doesNotMatch(settings, /STEP_AUDIO_CATEGORY\[/, '예상시간에 카테고리 표 사본이 되살아났다')

  const badge = read('src/components/admin/sections/musicManagementConst.js')
  assert.match(badge, /file\.is_primary/, '화면이 서버 판정을 안 쓴다')
  // 주석에서 옛 잘못을 설명하는 것은 괜찮다 — 막으려는 것은 화면에 **그렇게 적어 내보내는** 것이다.
  assert.doesNotMatch(badge, /text: [^\n]*무작위 후보/, '화면이 아직 "무작위"라고 거짓말한다')
})
