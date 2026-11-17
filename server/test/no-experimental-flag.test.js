'use strict'
// **없어질 스위치에 서버를 걸어 두지 않는다** (2026-09-16).
//
// ── 무엇이 위험했나 ────────────────────────────────────────────────────────
// 서버 시작 명령이 `node --experimental-sqlite index.js` 였다. 그 스위치는 Node 가
// `node:sqlite` 를 **실험 기능**으로 내놓았을 때 필요했던 것인데, **Node 24 에서 정식
// 기능이 되면서 필요 없어졌다.**
//
// 정식이 됐다는 것은 곧 **Node 가 그 스위치를 없앨 날이 온다**는 뜻이다. 그런데 없는
// 스위치를 주면 Node 는 경고가 아니라 **즉사**한다:
//
//     node --experimental-없는것 -e "1"
//     → bad option: --experimental-없는것        (서버가 아예 안 뜬다)
//
// 즉 **어느 날 Node 를 올리는 순간 방송 시스템이 통째로 안 켜진다.** 고장 신호도 없다 —
// 그냥 안 뜬다. 요양원에서 가장 비싼 실패(무음)와 같은 모양이다.
//
// ── 이 시험이 지키는 것 ────────────────────────────────────────────────────
// 실험 스위치를 **실행 경로에 다시 들이지 않는다.** 새 기능을 쓰려고 또 붙이고 싶어질
// 때 이 시험이 먼저 묻는다 — 그 기능이 정식이 되면 그 스위치도 없어진다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('**서버 시작 명령에 실험 스위치가 없다** — 있으면 Node 판올림에 죽는다', () => {
  const pkg = JSON.parse(읽기('server/package.json'))
  for (const [이름, 명령] of Object.entries(pkg.scripts || {})) {
    assert.ok(!/--experimental-/.test(명령),
      `server 의 「${이름}」 에 실험 스위치가 있다: ${명령}\n`
      + '  그 기능이 정식이 되면 스위치가 사라지고, 없는 스위치를 준 Node 는 안 뜬다.')
  }
})

test('**현장이 실제로 쓰는 시작 경로에도 없다** — 거기가 진짜다', () => {
  // 현장 PC 는 `npm start` 가 아니라 감시 루프가 띄운다. 둘 중 하나만 고치면
  // **고쳤다고 믿는 쪽만 고쳐진다** — 이 저장소가 여러 번 데인 모양이다.
  const 루프 = 읽기('scripts/carecast-loop.template.bat')
  // 2026-09-16 에 실행기를 **함께 담으면서** 이 줄이 `"%CC_NODE%" server\index.js` 가 됐다.
  // 긍정 앵커는 「서버를 띄우는 줄이 있다」이지 그 줄의 생김새가 아니다 — 생김새로
  // 고정했다가 이 변경에서 빨간불이 났고, **가드가 옳게 울렸다**(모양이 바뀐 것은 사실이다).
  assert.match(루프, /server\\index\.js/, '감시 루프가 서버를 띄우는 줄을 못 찾았다')
  assert.ok(!/--experimental-/.test(루프), '감시 루프에 실험 스위치가 있다')
})

test('**스위치 없이 데이터베이스가 열린다** — 빼도 되는지 진짜로 확인한다', () => {
  // 글자만 보면 "뺐다"까지만 안다. `node:sqlite` 를 **실제로 불러** 본다 —
  // 이 시험 자체가 스위치 없이 도는 Node 에서 돌고 있으므로, 되면 되는 것이다.
  const { DatabaseSync } = require('node:sqlite')
  const 임시 = path.join(require('node:os').tmpdir(), `cc_flag_${process.pid}_${Date.now()}.db`)
  const db = new DatabaseSync(임시)
  try {
    db.exec('CREATE TABLE t (a INTEGER)')
    db.prepare('INSERT INTO t (a) VALUES (?)').run(1)
    assert.equal(db.prepare('SELECT a FROM t').get().a, 1, 'DB 가 안 돈다')
  } finally {
    db.close()
    try { fs.rmSync(임시) } catch { /* 지우기 실패는 시험 결과와 무관 */ }
  }
})

test('**안내 문구에도 낡은 명령을 남기지 않는다** — 다음 사람이 그걸 그대로 친다', () => {
  for (const f of ['scripts/backup-db.cjs', 'scripts/check-folder-index.cjs',
                   'scripts/field-compat-report.cjs']) {
    assert.ok(!/--experimental-sqlite/.test(읽기(f)),
      `${f} 의 안내에 낡은 명령이 남아 있다 — 그대로 치면 언젠가 안 돈다`)
  }
})
