#!/usr/bin/env node
// 이미 깨진 채로 저장된 음원·영상 이름(audio_files.original_name)을 되돌린다.
//
// 왜 생겼나: multipart 업로드의 파일 이름은 multer(busboy)가 Latin-1로 읽어 주는데,
// 예전 server/routes/audio.js는 되돌린 결과에 완성형 한글(가-힣)이 보일 때만 인정했다.
// 그래서 맥·아이폰이 보내는 자모 분리(NFD) 이름·자모만 있는 이름·일본어·악센트 라틴이
// 조건에 안 걸려 "êµ­ë¯¼ì²´ì¡°.mp4" 같은 모양으로 DB에 들어앉았다. 2026-09-01에
// domain/text.js의 repairMojibake로 규칙을 바꿔 새 업로드는 막았지만, **이미 들어간 행은
// 그대로 남아 화면·재생목록·방송 로그에 계속 보인다.** 이 스크립트가 그것들을 되돌린다.
//
// U+FFFD와 달리 이 깨짐은 바이트가 살아 있어 되돌릴 수 있다 — 다시 쓰는 게 아니라 되돌리기다.
// 되돌릴 수 없는 행(U+FFFD가 박힌 행)은 건드리지 않고 목록으로만 알려준다.
//
//   node scripts/repair-audio-filenames.cjs          (무엇을 바꿀지만 보여준다 — 기본)
//   node scripts/repair-audio-filenames.cjs --apply  (실제로 고친다. 고치기 전 스냅샷을 남긴다)
'use strict'

const path = require('path')
const fs   = require('fs')
const { DatabaseSync } = require('node:sqlite')
const { repairMojibake } = require('../server/domain/text')

const DB_PATH = process.env.CARECAST_DB_PATH || path.join(__dirname, '..', 'server', 'db', 'database.db')
const APPLY   = process.argv.includes('--apply')
const FFFD    = '\uFFFD'

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB가 없다: ${DB_PATH}`)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH)
try {
  const rows = db.prepare('SELECT id, category, original_name FROM audio_files ORDER BY id').all()
  const fixable = []
  const lost    = []

  for (const row of rows) {
    const name = String(row.original_name ?? '')
    if (name.includes(FFFD)) { lost.push(row); continue }
    const fixed = repairMojibake(name)
    if (fixed !== name) fixable.push({ ...row, fixed })
  }

  console.log(`DB: ${DB_PATH}`)
  console.log(`음원·영상 ${rows.length}건 중 되돌릴 이름 ${fixable.length}건, 되돌릴 수 없는 행 ${lost.length}건\n`)

  for (const f of fixable) {
    console.log(`${APPLY ? '' : '[미리보기] '}#${f.id} (${f.category})`)
    console.log(`    이전: ${JSON.stringify(f.original_name)}`)
    console.log(`    이후: ${JSON.stringify(f.fixed)}`)
  }
  for (const l of lost) {
    console.log(`#${l.id} (${l.category}) — U+FFFD가 박혀 되돌릴 수 없다: ${JSON.stringify(l.original_name)}`)
    console.log('    화면(음원 및 동영상 관리)에서 이름 바꾸기로 손수 고쳐야 한다.')
  }

  if (fixable.length === 0) {
    console.log('\n되돌릴 것이 없다. (두 번 돌려도 안전하다)')
  } else if (!APPLY) {
    console.log('\n실제로 고치려면: node scripts/repair-audio-filenames.cjs --apply')
  } else {
    // 고치기 전 스냅샷 — VACUUM INTO는 WAL까지 반영된 일관된 사본을 만든다(파일 복사와 다르다).
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const snap  = path.join(path.dirname(DB_PATH), `database.backup-before-filename-repair-${stamp}.db`)
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`)
    console.log(`\n스냅샷: ${snap}`)

    const update = db.prepare('UPDATE audio_files SET original_name = ? WHERE id = ?')
    for (const f of fixable) update.run(f.fixed, f.id)
    console.log(`${fixable.length}건 되돌렸다. 화면을 새로고침하면 바뀐 이름이 보인다.`)
  }
} finally {
  db.close()
}
