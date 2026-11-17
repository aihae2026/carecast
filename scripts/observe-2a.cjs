// 2-a 관찰 — **한 줄로 현재 상태를 본다.**
//
//   node scripts/observe-2a.cjs
//
// 왜 필요한가(2026-09-06): 3단계(트리거에서 TTS 제거)는 되돌리기 어렵고, 착수 조건이
// "판단"이 아니라 **측정**으로 정해져 있다. 그런데 그 측정을 매번 손으로 하면 안 본다.
// 여러 파일을 열어야 알 수 있으면 더 안 본다. 그래서 한 명령으로 끝낸다.
//
// 세는 단위는 **날이 아니라 회차**다(2026-09-06 변경).
//
// 왜 바꿨나: 개발 PC 는 항상 켜져 있지 않다. 작업할 때만 켜고 18:00 저녁 마무리 방송까지 켜 둘
// 이유가 없다. "3일 연속"으로 세면 **관측없음만 쌓이고 3일이 무한정 늘어난다** —
// 기준이 사실상 "PC 를 사흘 내내 켜 두기"가 되어 버린다. 그건 재려던 것이 아니다.
//
// 그래서 **정상 관측 12회 연속**으로 센다. 며칠에 걸치든 상관없다.
//   통과     — 그 회차가 기준을 만족(송출됨 + 지연 상한 이내)
//   실패     — 기준 미달 → **0부터 다시 센다**
//   관측없음 — 그 시각에 서버가 안 떠 있었다. **세지도 초기화하지도 않는다.**
'use strict'

const path = require('path')
const fs   = require('fs')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '..')
const args = process.argv.slice(2)
const dbIdx = args.indexOf('--db')
const DB_PATH = dbIdx >= 0 ? args[dbIdx + 1]
  : (process.env.CARECAST_DB_PATH || path.join(ROOT, 'server', 'db', 'database.db'))
const DAYS = Number(process.env.CARECAST_OBSERVE_DAYS) || 30

// ── 기준 (사용자 승인 2026-09-06, 지연상한 2026-09-07 개정) ──
//
// 지연의 정의: **예정 시각(설정값) → 첫 소리**. 첫 소리는 TTS 재생 지시가 나간 순간이고
// (broadcastSteps.js:133 markFirstAudio), BGM 시작은 세지 않는다. laneTiming.js 가 계산한다.
//
// 왜 3초에서 4초로 올렸나(2026-09-07 사용자 결정): 첫 실측 회차가 3.46초로 실패였는데
// 원인이 TTS 합성이 아니었다 — 캐시가 있었고 즉시렌더도 없었다([FACT] EV-000939·EV-000941).
// "BGM 시작 → 안내" 순서인 레인은 단계 간 0.8초 간격 두 번(broadcastSequencer.js:400)과
// BGM 단계의 외부 검색(당시)이 앞에 놓여 **구조적으로 3.4초쯤**이 된다. 그 0.8초는 어르신
// 대상 방송이라 필요한 텀이라 줄이지 않고, 측정 시작점도 바꾸지 않고, **합격선만 올렸다.**
const 기준 = {
  연속통과회차: 12,       // **날이 아니라 회차다.** 며칠에 걸치든 상관없다
  지연상한ms: 4000,       // 이걸 넘으면 그 회차는 실패 (2026-09-07: 3000 → 4000)
  지연기록선ms: 1000,     // 넘으면 통과여도 목록에 남긴다
  실시각최소: 1,          // 압축으로만 채우면 안 된다 — 실제 시각 관측이 최소 이만큼
}
const 정적레인 = ['exercise', 'lunch', 'dinner', 'evening_prayer']
const 레인이름 = { exercise: '국민체조', lunch: '점심', dinner: '저녁', evening_prayer: '저녁 마무리' }

if (!fs.existsSync(DB_PATH)) {
  console.error(`[관찰] DB 가 없습니다: ${DB_PATH}`)
  process.exit(1)
}
const db = new DatabaseSync(DB_PATH, { readOnly: true })

const cols = db.prepare('PRAGMA table_info(broadcasts)').all().map((c) => c.name)
const 계측있음 = cols.includes('delay_ms') && cols.includes('content_source')

const 설정 = (k, d = '') => {
  try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d } catch { return d }
}

// 레인 이름 → 이력 content 문구(LANES.logContent). 소스에서 읽어 사본을 안 만든다.
const logContentOf = (() => {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'services', 'broadcastSequencer.js'), 'utf8')
    const map = {}
    for (const lane of 정적레인) {
      const re = new RegExp(`${lane}:\\s*\\{[\\s\\S]*?logContent:\\s*'([^']+)'`)
      const m = re.exec(src)
      if (m) map[lane] = m[1]
    }
    return map
  } catch { return {} }
})()
const 레인of = (content) => Object.keys(logContentOf).find((k) => logContentOf[k] === content)

// 이 레인의 **실제(현장) 시각**. 압축 관측인지 가리는 데 쓴다.
const 실시각 = {}
try {
  const { AUTO_BROADCASTS } = require(path.join(ROOT, 'server', 'domain', 'autoBroadcasts'))
  for (const s of AUTO_BROADCASTS) 실시각[s.id] = 설정(s.timeKey, s.defaultTime)
} catch { /* 못 읽으면 압축 구분만 못 한다 */ }

// ── 회차 모으기 ───────────────────────────────────────────────
// 한 회차 = 자동방송 한 편(성공이든 실패든). 오래된 것부터 본다.
const 시작일 = new Date(); 시작일.setDate(시작일.getDate() - DAYS)
const 날짜문자 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const rows = db.prepare(
  "SELECT * FROM broadcasts WHERE type = '자동' AND date >= ? ORDER BY date ASC, id ASC"
).all(날짜문자(시작일))

const 회차 = []
for (const r of rows) {
  const lane = 레인of(r.content)
  if (!lane) continue                       // 오류 줄·아침 방송은 이 관찰의 대상이 아니다
  // **지연을 못 잰 회차는 세지 않는다.** 계측이 붙기 전(2026-09-06 이전) 이력이 여기 섞이는데,
  // 그건 고치기 **전**의 방송이다. 그것으로 12회를 채우면 개선을 잰 것이 아니라
  // 옛 데이터로 통과를 만든 것이 된다 — 이 관찰이 존재하는 이유가 사라진다.
  if (!계측있음 || r.delay_ms == null) {
    회차.push({
      date: r.date, time: r.time, lane, laneName: 레인이름[lane],
      delayMs: null, verdict: '미측정', reason: '계측 이전 이력', 압축: null,
    })
    continue
  }

  const 미달 = []
  if (!r.success) 미달.push('실패로 끝남')
  if (r.delay_ms > 기준.지연상한ms) 미달.push(`지연 ${(r.delay_ms / 1000).toFixed(1)}초`)
  // 압축 관측인가 — 예정 시각의 시:분이 그 레인의 실제 시각과 다르면 압축이다.
  // 별도 컬럼을 두지 않는 이유: 파생할 수 있는 값을 저장하면 둘이 갈린다.
  let 압축 = null
  if (계측있음 && r.scheduled_at && 실시각[lane]) {
    const hhmm = new Date(r.scheduled_at).toTimeString().slice(0, 5)
    압축 = hhmm !== 실시각[lane]
  }
  회차.push({
    date: r.date, time: r.time, lane, laneName: 레인이름[lane],
    delayMs: 계측있음 ? r.delay_ms : null,
    verdict: 미달.length ? '실패' : '통과',
    reason: 미달.join(', '),
    압축,
  })
}

// ── 연속 통과 회차 세기 ───────────────────────────────────────
// 통과만 센다. 실패는 0으로 초기화. (관측없음은 애초에 이력이 없어 여기 안 들어온다 —
// 그래서 "세지도 초기화하지도 않는다"가 저절로 지켜진다.)
let 연속 = 0
let 마지막실패 = null
for (const o of 회차) {
  if (o.verdict === '미측정') continue          // 계측 이전 — 세지도 초기화하지도 않는다
  if (o.verdict === '통과') 연속 += 1
  else { 연속 = 0; 마지막실패 = o }
}

const 실시각통과 = 회차.filter((o) => o.verdict === '통과' && o.압축 === false).length
const 압축통과   = 회차.filter((o) => o.verdict === '통과' && o.압축 === true).length
const 지연전부   = 회차.filter((o) => o.delayMs != null && o.delayMs > 기준.지연기록선ms)

// 마지막 관측이 언제였나 — 관찰이 멈춰 있는지 알리는 근거
const 마지막 = 회차[회차.length - 1]
const 며칠전 = 마지막
  ? Math.floor((Date.now() - new Date(`${마지막.date}T00:00:00`).getTime()) / 86400000)
  : null

const 압축켜짐 = 설정('dev_compress_enabled') === 'true'
const 회차충족 = 연속 >= 기준.연속통과회차
const 실시각충족 = 실시각통과 >= 기준.실시각최소
const 통과 = 회차충족 && 실시각충족

// ── 출력 ─────────────────────────────────────────────────────
console.log('='.repeat(66))
console.log(`2-a 관찰  ${통과 ? '✅ 조건 충족' : '진행 중'}   `
  + `연속 통과 ${연속}/${기준.연속통과회차}회   실제 시각 관측 ${실시각통과}/${기준.실시각최소}회`)
console.log('='.repeat(66))

if (!계측있음) console.log('⚠ broadcasts 에 계측 컬럼이 없습니다 — 지연을 못 잽니다(마이그레이션 0024).')
if (압축켜짐) {
  console.log(`⚙ 압축 모드 켜짐 — ${설정('dev_compress_start', '(시각 미설정)')} 부터 `
    + `${설정('dev_compress_gap_min', '3')}분 간격. **개발 PC 에서만 동작합니다.**`)
}
if (며칠전 != null && 며칠전 >= 3) {
  console.log('')
  console.log(`⚠⚠ 마지막 관측이 ${며칠전}일 전(${마지막.date})입니다 — 관찰이 멈춰 있습니다.`)
  console.log('   서버를 켜야 회차가 쌓입니다: schtasks /run /tn CareCastAuditServer')
}

console.log('')
console.log('  최근 회차 (최대 12개)')
for (const o of 회차.slice(-12)) {
  const 표 = { 통과: '통과 ', 실패: '실패 ', 미측정: '안잼 ' }[o.verdict] || '  ?  '
  const 종류 = o.압축 === true ? '압축' : o.압축 === false ? '실시각' : '  ?  '
  const 지연 = o.delayMs != null ? `${(o.delayMs / 1000).toFixed(2)}초` : '미측정'
  console.log(`   ${o.date} ${o.time}  ${표}  ${종류}  ${o.laneName.padEnd(6)} ${지연}  ${o.reason || ''}`)
}
if (회차.length === 0) console.log('   (아직 관측된 회차가 없습니다)')

console.log('')
if (통과) {
  console.log(`✅ 3단계 착수 조건을 만족합니다 — 연속 ${연속}회 + 실제 시각 ${실시각통과}회.`)
} else if (!회차충족 && 마지막실패) {
  console.log(`아직입니다. 마지막 실패: ${마지막실패.date} ${마지막실패.time} ${마지막실패.laneName} — ${마지막실패.reason}`)
} else if (!회차충족) {
  console.log(`아직입니다. 통과 ${연속}회 쌓였습니다(${기준.연속통과회차}회 필요).`)
} else {
  console.log(`회차는 채웠습니다(${연속}회). **실제 시각 관측이 ${기준.실시각최소}회 필요합니다** — `
    + `지금 ${실시각통과}회(압축 ${압축통과}회는 이 조건을 대신하지 못합니다).`)
}

console.log('')
console.log(`1초를 넘긴 지연: ${지연전부.length}건` + (지연전부.length ? '' : ' — 없음'))
for (const x of 지연전부) {
  console.log(`  ${x.date} ${x.time} ${x.laneName} ${(x.delayMs / 1000).toFixed(2)}초`
    + (x.압축 === true ? ' (압축)' : ''))
}

console.log('')
console.log(`기준: 연속 통과 ${기준.연속통과회차}회(실패 시 0부터 · 관측없음은 안 셈) · `
  + `지연 ${기준.지연상한ms / 1000}초 초과 0건 · 실제 시각 관측 ${기준.실시각최소}회 이상`)
console.log(`대상 DB: ${DB_PATH}`)
db.close()
