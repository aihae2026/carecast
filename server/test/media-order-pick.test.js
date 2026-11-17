// 영상 단계도 폴더에서 랜덤·차례로 고른다 (사용자 지시 2026-09-21 「영상도 마찬가지로」).
//
// 고정하는 것:
//   1) 차례를 안 고르면 예전과 **같은 파일**(맨 앞) — 기존 현장 동작이 그대로다
//   2) 차례로는 틀 때마다 한 칸씩 밀리고, 연결(폴더)마다 자리를 따로 센다
//   3) 랜덤은 그 폴더 안의 것만 고른다
//   4) 자동방송 단계의 mediaOrder 가 실행부 옵션으로 넘어간다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_mediaorder_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { pickSourceFile, pickSourceFileByOrder, sourceCandidates } = require('../domain/categoryPick')

const db = () => getDB()
test.before(() => { initDB() })
test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

const 폴더 = (name) => Number(db().prepare("INSERT INTO content_folders (category, name, created_at) VALUES ('lunch-video', ?, ?)")
  .run(name, new Date().toISOString()).lastInsertRowid)
let n = 0
function 영상(folderId, name) {
  n += 1
  const id = Number(db().prepare(`INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id)
    VALUES ('lunch-video', ?, ?, 60, ?, ?)`).run(`v${n}.mp4`, name, new Date().toISOString(), folderId).lastInsertRowid)
  db().prepare("INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES ('lunch-video', ?, ?, 1)").run(id, n)
  return id
}

let A, B
test.before(() => {
  A = 폴더('자연 영상'); B = 폴더('동요 영상')
  영상(A, '바다'); 영상(A, '숲'); 영상(A, '산'); 영상(B, '동요')
})

test('차례를 안 고르면 예전과 같은 파일(맨 앞)', () => {
  const r = { kind: 'folder', category: 'lunch-video', folderId: A }
  assert.equal(pickSourceFile(db(), r, 0).original_name, '바다')
  assert.deepEqual(sourceCandidates(db(), r).map(f => f.original_name), ['바다', '숲', '산'])
})

test('차례로 — 틀 때마다 한 칸, 폴더마다 자리를 따로', () => {
  const a = { kind: 'folder', category: 'lunch-video', folderId: A }
  const b = { kind: 'folder', category: 'lunch-video', folderId: B }
  const 들은것 = []
  for (let i = 0; i < 4; i++) {
    들은것.push(pickSourceFileByOrder(db(), a, 'seq').original_name)
    pickSourceFileByOrder(db(), b, 'seq')        // 다른 폴더가 끼어들어도 a 의 자리는 안 밀린다
  }
  assert.deepEqual(들은것, ['바다', '숲', '산', '바다'])
})

test('랜덤 — 그 폴더 안의 것만', () => {
  const a = { kind: 'folder', category: 'lunch-video', folderId: A }
  const 나온것 = new Set()
  for (let i = 0; i < 30; i++) 나온것.add(pickSourceFileByOrder(db(), a, 'random').original_name)
  for (const x of 나온것) assert.ok(['바다', '숲', '산'].includes(x), `다른 폴더 영상이 나왔다: ${x}`)
  assert.ok(나온것.size > 1, '서른 번 모두 같은 영상 — 섞지 않는다')
})

test('비었거나 연결이 없으면 없음', () => {
  assert.equal(pickSourceFileByOrder(db(), { kind: 'none' }, 'random'), undefined)
  assert.equal(pickSourceFileByOrder(db(), { kind: 'folder', category: 'dinner-video', folderId: null }, 'seq'), undefined)
})

test('자동방송 단계의 mediaOrder 가 실행부 옵션으로 넘어간다', () => {
  const { stepOpts } = require('../services/broadcastSteps')
  assert.equal(stepOpts({ mediaOrder: 'seq' }).mediaOrder, 'seq')
  assert.equal(stepOpts({}).mediaOrder, undefined)
})
