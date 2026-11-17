#!/usr/bin/env node
// U+FFFD(글자 깨짐)가 박힌 행을 복원한다. 2026-08-31 1회성.
//
// 원인: Windows(Git Bash)에서 curl로 한글 JSON을 POST하면 본문이 CP949로 나가고, 서버는
// UTF-8로 읽어서 한 글자가 U+FFFD로 바뀐다. 요청은 200 OK라 아무도 모른다 —
// 화면에서 "???"를 볼 때까지. 복원은 되돌리기가 아니라 **다시 쓰기**다: U+FFFD는 정보를
// 잃은 자리라 원문 바이트가 남아 있지 않다(실측: efbfbd가 연속으로 박혀 있다).
//
// 그래서 근거가 확실한 것만 고친다. 근거는 각 항목의 why에 적었다 — 살아남은 ASCII 조각,
// 같은 사건을 가리키는 다른 표의 행, TASKS.md의 그날 기록.
//
//   node scripts/repair-mojibake-rows.cjs --dry   (무엇을 바꿀지만 보여준다)
//   node scripts/repair-mojibake-rows.cjs
'use strict'

const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const DB_PATH = process.env.CARECAST_DB_PATH || path.join(__dirname, '..', 'server', 'db', 'database.db')
const DRY = process.argv.includes('--dry')
const FFFD = '�'

const FIXES = [
  {
    table: 'checkin_runs', id: 7, col: 'note',
    to: '고도화 리스트 승인 항목 2건 구현 - server/test/api-shape.test.js, tts-audio-path.test.js 추가(8건), 전체 70건 PASS',
    why: '살아남은 ASCII가 파일명·건수를 그대로 담고 있고, item_name("API 응답 형태 검증 + TTS·오디오 실행 경로 자동 테스트")이 멀쩡하다.',
  },
  {
    table: 'checkin_runs', id: 18, col: 'item_name',
    to: '고도화 #10 비상 방송 음성이 실제 비상방송에 적용되지 않던 것',
    why: 'note의 ASCII가 tts_voice_normal→tts_voice_emergency와 EmergencyBroadcast.jsx를 가리킨다. improvement_proposals의 2026-08-26 "TTS 설정의 \'비상 방송 음성\'이 실제 비상방송에 적용되지 않음"과 같은 건이다.',
  },
  {
    table: 'checkin_runs', id: 18, col: 'note',
    to: 'server/routes/tts.js: loadTTSDefaults(db, { priority })에 priority=true일 때 tts_voice_normal 대신 tts_voice_emergency를 읽도록 수정. /api/tts/broadcast가 그 값을 useVoice 기본값으로 쓴다. EmergencyBroadcast.jsx(이미 priority:true로 호출 중)는 그대로. ※ 한글 원문은 인코딩 사고로 유실됐고 2026-08-31에 남은 코드 조각을 근거로 다시 썼다.',
    why: '위와 같은 근거. 다시 쓴 사실을 본문에 남긴다 — 복원본을 원본으로 착각하면 안 된다.',
  },
  {
    table: 'broadcasts', id: 14, col: 'content',
    to: 'kim cheolsu 선생님을 찾습니다',
    why: '2026-08-27 즉시방송(TTS) 시험 행. 살아남은 "kim cheolsu"와 이 시설의 호출 방송 문형이 근거다.',
  },
  { table: 'broadcasts', id: 23, col: 'content', to: '[C1스모크] 차임벨 vol25', why: 'TASKS.md 2026-08-28 "C1 스모크 — chime 예약 2건(main_volume 25 / 95)을 trigger해 사용자가 직접 청취". 살아남은 vol25/vol95가 그 값이다.' },
  { table: 'broadcasts', id: 24, col: 'content', to: '[C1스모크] 차임벨 vol95', why: '위와 같음' },
  { table: 'broadcasts', id: 25, col: 'content', to: '[C1스모크] 차임벨 vol25', why: '위와 같음' },
  { table: 'broadcasts', id: 26, col: 'content', to: '[C1스모크] 차임벨 vol95', why: '위와 같음' },
]

const db = new DatabaseSync(DB_PATH)
let changed = 0, skipped = 0
try {
  for (const fix of FIXES) {
    const row = db.prepare(`SELECT "${fix.col}" AS v FROM "${fix.table}" WHERE id = ?`).get(fix.id)
    if (!row) { console.log(`- ${fix.table}#${fix.id}.${fix.col}: 행이 없다 — 건너뜀`); skipped++; continue }
    if (!String(row.v || '').includes(FFFD)) {
      console.log(`- ${fix.table}#${fix.id}.${fix.col}: 이미 깨끗하다 — 건너뜀(두 번 돌려도 안전)`)
      skipped++; continue
    }
    console.log(`${DRY ? '[dry] ' : ''}${fix.table}#${fix.id}.${fix.col}`)
    console.log(`   전: ${String(row.v).slice(0, 60)}`)
    console.log(`   후: ${fix.to.slice(0, 60)}`)
    console.log(`   근거: ${fix.why}`)
    if (!DRY) db.prepare(`UPDATE "${fix.table}" SET "${fix.col}" = ? WHERE id = ?`).run(fix.to, fix.id)
    changed++
  }
} finally { db.close() }
console.log(`\n${DRY ? '바꿀 것' : '바꾼 것'} ${changed}건 · 건너뜀 ${skipped}건`)
