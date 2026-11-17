// 기존 예약의 content_source 분류 결과를 사람에게 보고한다. **읽기 전용이다 — 아무것도 안 고친다.**
//
// 왜 필요한가(2026-09-06 지시): 마이그레이션이 기존 행의 content_source 를 결정론적으로
// 채우는데, 그 분류가 맞는지는 **사람만 안다**. 특히 토큰 없이 "오늘 날씨는 맑습니다" 처럼
// 써 둔 문안은 코드로 가릴 수 없다 — 낱말로 추정하면 오판이 조용히 어제 날씨를 방송한다.
// 그래서 애매한 건은 자동 판단하지 않고 여기서 **목록으로 뽑아** 사람이 정하게 한다.
//
// 쓰는 법:  node scripts/report-content-source.cjs [--db <경로>]
'use strict'

const path = require('path')
const fs   = require('fs')
const { DatabaseSync } = require('node:sqlite')

const args = process.argv.slice(2)
const dbIdx = args.indexOf('--db')
const DB_PATH = dbIdx >= 0
  ? args[dbIdx + 1]
  : (process.env.CARECAST_DB_PATH || path.join(__dirname, '..', 'server', 'db', 'database.db'))

if (!fs.existsSync(DB_PATH)) {
  console.error(`[없음] DB 파일이 없습니다: ${DB_PATH}`)
  process.exit(1)
}

const { findTokens, unknownTokens, classifyExistingSchedule } = require('../server/domain/contentTokens')

// 사람 눈으로 다시 볼 후보를 고르는 낱말. **이 목록은 판정에 쓰이지 않는다** —
// 오직 "사람에게 보여줄 것"을 고르는 데만 쓴다. 판정에 쓰면 그게 낱말 추정이 된다.
const 살펴볼낱말 = ['날씨', '기온', '온도', '미세먼지', '자외선', '오늘', '내일', '현재 시각', '지금 시각']

const db = new DatabaseSync(DB_PATH, { readOnly: true });

(function main() {
  const cols = db.prepare('PRAGMA table_info(schedules)').all().map((c) => c.name)
  const 컬럼있음 = cols.includes('content_source')

  console.log('='.repeat(72))
  console.log('예약 문안 분류 리포트 (읽기 전용)')
  console.log(`대상 DB: ${DB_PATH}`)
  console.log('='.repeat(72))

  const rows = db.prepare(
    `SELECT id, title, content, broadcast_type, managed_by${컬럼있음 ? ', content_source, urgency' : ''} FROM schedules`
  ).all()

  console.log(`\n[1] 예약 총 ${rows.length}건`)
  if (!컬럼있음) {
    console.log('    ⚠ content_source 컬럼이 아직 없습니다(마이그레이션 전). 분류 예상치만 보여줍니다.')
  }

  // ── 분류 집계 ───────────────────────────────────────────────
  const 예상 = (r) => classifyExistingSchedule(r)
  const 집계 = {}
  for (const r of rows) {
    const v = 컬럼있음 ? (r.content_source || '(비어 있음)') : 예상(r)
    집계[v] = (집계[v] || 0) + 1
  }
  console.log('\n[2] 분류 결과')
  for (const [k, v] of Object.entries(집계)) console.log(`    ${k.padEnd(18)} ${v}건`)
  console.log('    분류 근거: ① {{토큰}} → manual_template  ② managed_by=morning_editor → system_template  ③ managed_by=ai → llm  ④ 그 외 manual')

  // ── {{ 스캔 (지시: 보고만, 자동 수정 금지) ───────────────────
  const 중괄호 = rows.filter((r) => String(r.content || '').includes('{{'))
  console.log(`\n[3] 문안에 "{{" 가 든 예약: ${중괄호.length}건`)
  if (중괄호.length === 0) {
    console.log('    → 0건입니다. 기존 문안에 토큰 표기가 우연히 들어간 건이 없습니다.')
  } else {
    for (const r of 중괄호) {
      const 모름 = unknownTokens(r.content)
      console.log(`    #${r.id} "${String(r.title).slice(0, 30)}"`)
      console.log(`        토큰: ${findTokens(r.content).join(', ') || '(없음)'}`)
      if (모름.length) console.log(`        ⚠ 사전에 없는 토큰: ${모름.join(', ')}  ← 자동 수정하지 않았습니다`)
    }
    console.log('    ※ 기존 레코드는 저장 검증 대상이 아닙니다. 위는 보고일 뿐 아무것도 바꾸지 않았습니다.')
  }

  // ── 애매한 건 (사람이 정할 것) ───────────────────────────────
  const 애매 = rows.filter((r) => {
    const c = String(r.content || '')
    if (!c.trim()) return false
    if (findTokens(c).length > 0) return false      // 토큰이 있으면 이미 가변으로 확정
    if (r.managed_by) return false                  // 시스템 관리면 이미 확정
    return 살펴볼낱말.some((w) => c.includes(w))
  })
  console.log(`\n[4] 사람이 정해야 할 애매한 건: ${애매.length}건`)
  if (애매.length === 0) {
    console.log('    → 0건입니다.')
  } else {
    console.log('    아래는 **manual(정적)으로 두었습니다** — 오늘과 똑같이 동작합니다.')
    console.log('    바꿔야 할 것이 있으면 알려주세요. 자동으로 판단하지 않았습니다.')
    for (const r of 애매) {
      console.log(`    #${r.id} "${String(r.title).slice(0, 30)}"`)
      console.log(`        문안: ${String(r.content).replace(/\s+/g, ' ').slice(0, 70)}`)
    }
  }

  // ── urgency ────────────────────────────────────────────────
  if (컬럼있음) {
    const u = {}
    for (const r of rows) u[r.urgency || '(비어 있음)'] = (u[r.urgency || '(비어 있음)'] || 0) + 1
    console.log('\n[5] urgency (유예 판정 1순위)')
    for (const [k, v] of Object.entries(u)) console.log(`    ${String(k).padEnd(18)} ${v}건`)
    console.log('    긴급(emergency)은 유예 없이 성공까지 재시도하므로 사람이 명시적으로만 지정합니다.')
  }

  console.log('\n' + '='.repeat(72))
  db.close()
})()
