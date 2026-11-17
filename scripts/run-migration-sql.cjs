// 마이그레이션 SQL 파일 하나를 지정한 DB에 실행한다. up/down 둘 다 이걸로 돈다.
//
// 왜 러너가 따로 필요한가: 이 저장소는 스키마를 schema.js 의 initDB() 안 ALTER 로 반영하고,
// db/migrations/*.sql 은 "무엇이 언제 바뀌었나"를 사람이 읽는 이력이다(db/migrations/README.md).
// 그 방식에는 **되돌릴 방법이 없다.** down 을 쓰려면 SQL 을 직접 실행할 도구가 필요하다.
//
// 안전장치:
//   1. --db 는 필수다. 기본값을 두지 않는다 — 기본값이 있으면 언젠가 운영 DB에 떨어진다.
//   2. 운영 DB(server/db/database.db)는 --allow-operational 없이는 거부한다.
//   3. 문장 단위로 실행하고, 하나라도 실패하면 그 자리에서 멈추고 무엇이 실패했는지 알린다.
//
// 쓰는 법:
//   node scripts/run-migration-sql.cjs db/migrations/0024_broadcast_pipeline.down.sql --db /tmp/copy.db
'use strict'

const fs   = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const args = process.argv.slice(2)
const sqlFile = args.find((a) => !a.startsWith('--'))
const dbIdx = args.indexOf('--db')
const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : null
const allowOperational = args.includes('--allow-operational')
const dryRun = args.includes('--dry-run')

if (!sqlFile || !dbPath) {
  console.error('사용법: node scripts/run-migration-sql.cjs <파일.sql> --db <DB경로> [--allow-operational] [--dry-run]')
  process.exit(1)
}

const OPERATIONAL = path.resolve(__dirname, '..', 'server', 'db', 'database.db')
if (path.resolve(dbPath) === OPERATIONAL && !allowOperational) {
  console.error('[거부] 운영 DB 입니다. 정말 필요하면 --allow-operational 을 붙이세요.')
  console.error('       그 전에 백업했는지 확인하세요 — checkpoint/rewind 는 DB를 못 되돌립니다(CLAUDE.md).')
  process.exit(2)
}
if (!fs.existsSync(dbPath)) {
  console.error(`[없음] DB 파일이 없습니다: ${dbPath}`)
  process.exit(3)
}

// 주석과 빈 줄을 걷어내고 세미콜론으로 자른다. 이 저장소의 마이그레이션은 문자열 안에
// 세미콜론을 쓰지 않는다 — 쓰게 되면 이 자르기를 다시 봐야 한다.
const raw = fs.readFileSync(sqlFile, 'utf8')
const statements = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

console.log(`[대상] ${dbPath}`)
console.log(`[파일] ${sqlFile} — 문장 ${statements.length}개`)
if (dryRun) {
  statements.forEach((s, i) => console.log(`  ${i + 1}. ${s.split('\n')[0].slice(0, 80)}`))
  console.log('[dry-run] 실행하지 않았습니다.')
  process.exit(0)
}

const db = new DatabaseSync(dbPath)
let 성공 = 0
try {
  for (const s of statements) {
    try {
      db.exec(s)
      성공 += 1
    } catch (e) {
      // 이미 있는 컬럼/없는 컬럼은 이 저장소의 기존 방식(try/catch ALTER)과 같은 이유로 넘긴다.
      // 그 외 오류는 삼키지 않는다 — 조용히 반쯤 적용되는 것이 가장 나쁘다.
      const 넘길만한 = /duplicate column|no such column|no such table|already exists/i.test(e.message)
      if (넘길만한) {
        console.log(`  · 넘김: ${s.split('\n')[0].slice(0, 60)} — ${e.message}`)
      } else {
        console.error(`[실패] ${s.split('\n')[0].slice(0, 80)}`)
        console.error(`       ${e.message}`)
        throw e
      }
    }
  }
  console.log(`[완료] ${성공}/${statements.length} 문장 적용`)
} finally {
  db.close()
}
