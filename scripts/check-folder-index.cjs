#!/usr/bin/env node
// `audio_files.folder_id` 인덱스가 **실제로 필요한지** 실행계획으로 본다.
//
// 사용자 조건 7(2026-09-13): *"실제 질의 조건과 실행계획을 확인한 뒤에만 인덱스를 더해라."*
// 그래서 값을 먼저 잰다 — 더하기로 정하면 문서의 "SQL 변경 없음"도 같이 고친다.
//
// 쓰는 법:  node scripts/check-folder-index.cjs
'use strict'

const os = require('os'), path = require('path'), fs = require('fs')
const DB_PATH = path.join(os.tmpdir(), `carecast_idx_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const { getDB, initDB } = require('../server/db/schema')
initDB()
const db = getDB()

// 새 코드가 실제로 거는 질의 넷 — 베끼지 말고 여기 한 곳에서만 적는다.
const 질의들 = [
  ['폴더 안 파일 고르기 (재생목록 없음)',
   'SELECT * FROM audio_files WHERE category = ? AND folder_id = ? ORDER BY id'],
  ['폴더 안 파일 고르기 (재생목록)',
   `SELECT af.* FROM audio_playlist ap JOIN audio_files af ON af.id = ap.audio_file_id
    WHERE ap.category = ? AND ap.active = 1 AND af.folder_id = ? ORDER BY ap.sort_order`],
  ['폴더 삭제 전 파일 검사 (기존 코드 audio.js:224)',
   'SELECT COUNT(*) as c FROM audio_files WHERE folder_id = ?'],
  ['폴더별 파일 수 한꺼번에 (새 usage API)',
   'SELECT folder_id, COUNT(*) AS c FROM audio_files WHERE folder_id IS NOT NULL GROUP BY folder_id'],
]

const 계획 = (sql) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail).join(' / ')

// 실제 현장 규모에 가깝게 채운다. 현장 음원은 수십 개 규모다(카테고리 12칸 × 파일 몇 개).
// **비교를 위해 넉넉한 쪽도 같이 잰다** — 폴더를 쓰기 시작하면 늘어날 수 있어서.
function 채우기(n, folders = 20) {
  db.prepare('DELETE FROM audio_files').run()
  db.prepare('DELETE FROM content_folders').run()
  const insF = db.prepare('INSERT INTO content_folders (category, parent_id, name, created_at) VALUES (?, NULL, ?, ?)')
  for (let i = 0; i < folders; i++) insF.run('misc-audio', `폴더${i}`, '2026-01-01')
  const ins = db.prepare(
    `INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, source_type, folder_id)
     VALUES ('misc-audio', ?, ?, 100, '2026-01-01', 'file', ?)`)
  for (let i = 0; i < n; i++) ins.run(`f${i}.mp3`, `파일 ${i}.mp3`, (i % folders) + 1)
}

function 재기(라벨) {
  console.log(`\n── ${라벨} ─────────────────────────`)
  for (const [이름, sql] of 질의들) console.log(`  ${이름}\n    ${계획(sql)}`)
  // 시간도 잰다 — 계획이 스캔이어도 행이 적으면 값이 안 변한다는 것을 보여야 한다.
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < 2000; i++) {
    db.prepare('SELECT * FROM audio_files WHERE category = ? AND folder_id = ? ORDER BY id').all('misc-audio', (i % 20) + 1)
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`  → 2000회 조회 ${ms.toFixed(1)}ms (1회 ${(ms / 2000).toFixed(3)}ms)`)
}

for (const n of [60, 5000]) {
  채우기(n)
  console.log(`\n\n######## audio_files ${n}행 ########`)
  재기('인덱스 없음')
  db.exec('CREATE INDEX IF NOT EXISTS idx_audio_files_folder ON audio_files (folder_id)')
  재기('idx_audio_files_folder 있음')
  db.exec('DROP INDEX IF EXISTS idx_audio_files_folder')
}

console.log('\n\n[참고] 이 PC 개발 DB 의 실제 규모')
try {
  const { DatabaseSync } = require('node:sqlite')
  const real = new DatabaseSync(path.join(__dirname, '..', 'server', 'db', 'database.db'), { readOnly: true })
  for (const t of ['audio_files', 'content_folders', 'audio_playlist']) {
    console.log(`  ${t}: ${real.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}행`)
  }
  real.close()
} catch (e) { console.log('  못 읽음:', e.message) }

for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_PATH + s) } catch { /* 없으면 무시 */ } }
