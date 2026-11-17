// server/db/database.db 의 실제 스키마를 db/schema.expected.json과 대조한다.
// 누락 컬럼(실패) / 미선언 컬럼(경고) / 누락 테이블(실패)을 구분해서 출력하고 exit code로 결과를 알린다.
// node:sqlite (DatabaseSync) 사용 — 이 프로젝트는 better-sqlite3 등 외부 드라이버를 쓰지 않는다.
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const DB_PATH = path.join(__dirname, '..', 'server', 'db', 'database.db')
const expected = require('../db/schema.expected.json')

let failed = false

let db
try {
  db = new DatabaseSync(DB_PATH)
} catch {
  console.error(`[DB NOT FOUND] ${DB_PATH} — 서버를 한 번 실행해서 초기화해주세요 (node server/index.js)`)
  process.exit(1)
}

for (const [table, spec] of Object.entries(expected)) {
  const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)

  if (actual.length === 0) {
    console.error(`[MISSING TABLE] ${table}`)
    failed = true
    continue
  }

  const missing = spec.columns.filter(c => !actual.includes(c))
  const extra = actual.filter(c => !spec.columns.includes(c))

  if (missing.length) {
    console.error(`[MISSING COLUMN] ${table}: ${missing.join(', ')}`)
    failed = true
  }
  if (extra.length) {
    console.warn(`[UNDECLARED COLUMN] ${table}: ${extra.join(', ')} (schema.expected.json에 추가 필요)`)
  }
}

if (failed) {
  console.error('\n[verify:db] FAIL — 코드가 기대하는 스키마와 실제 DB가 다릅니다.')
  process.exit(1)
}

console.log('[verify:db] PASS')
