#!/usr/bin/env node
// 방송 이력에서 "실제로 이렇게 돌고 있다"를 한 장으로 뽑는다.
//
//   node scripts/build-evidence-report.cjs [출력경로]
//   CARECAST_DB_PATH=...\carecast_20260904_0432.db node scripts/build-evidence-report.cjs
//
// 왜 만드는가: 본선 심사가 "문제 해결"에서 **구체적 결과나 근거**를 요구한다. 근거가 될
// 기록은 이미 DB에 쌓여 있는데 꺼내 보여주는 것이 없어서 말로만 남는 상태였다.
//
// **여기서 하는 일은 세는 것뿐이다.** 이 파일은 해석하지 않는다:
//   - 시스템은 **도입 후만** 안다. 도입 전(사람이 직접 방송하던 때) 수치는 DB에 없고
//     원장님만 아신다. 그것을 이 산출물이 주장하면 심사에서 가장 위험한 거짓이 된다.
//     전후 비교는 발표자료에서 사람이 붙인다(2026-09-04 사용자 결정).
//   - **기록이 없으면 "기록 없음"이라고 적는다.** 0으로 적으면 "0초 만에 준비했다"가 된다.
//
// 원본은 운영 DB다. 여기서 아는 사실을 새로 적지 않고, 읽기 전용으로만 연다.
// server/test/evidence-report.test.js가 세는 방법과 위 두 규칙을 고정한다.
//
// 현장 PC의 진짜 이력으로 뽑으려면 그 PC의 백업 하나를 겨누면 된다
// (server/db/backups/carecast_YYYYMMDD_HHMM.db — 매일 04:30에 쌓인다).
'use strict'

const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '..')
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'evidence-report.html')
const DB_PATH = process.env.CARECAST_DB_PATH || path.join(ROOT, 'server', 'db', 'database.db')

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) : null)

if (!fs.existsSync(DB_PATH)) {
  console.error('[근거 자료] DB를 못 찾았다: ' + DB_PATH)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH, { readOnly: true })
const one = (sql) => db.prepare(sql).get()
const all = (sql) => db.prepare(sql).all()

// ── 세기 ────────────────────────────────────────────────────────────────
// 세는 규칙을 화면에도 같이 적는다(아래 '어떻게 셌나'). 규칙이 안 보이면
// 숫자만 남고, 숫자만 남으면 다음 사람이 다르게 세고도 같은 표를 만든다.
// **경보는 방송이 아니다.** 같은 표에 앉지만 감시가 남긴 줄이라, 사람이 누른 적도
// 스피커에서 난 적도 없다. 게다가 언제나 success=0이라 방송으로 세면 성공률이 통째로
// 주저앉는다 — 개발 DB 68건에서 실제로 67.6%로 나왔고, 경보를 빼면 95.8%다.
// 현장 DB에서는 더 크게 벌어진다(옛 감시가 5분 넘는 방송을 전부 누락으로 찍고 있다).
// 코드도 이미 둘을 갈라 본다 — retention.js가 보관 기간을 경보 180일 · 방송 365일로 준다.
const OPS = "IFNULL(type, '') != '경보'"

// **스키마는 자란다.** 다른 PC에서 받아온 백업은 지금 저장소보다 옛날일 수 있고, 그때는
// 없던 칸을 물으면 SQL이 통째로 죽는다(2026-09-04에 실제로 그랬다 — 현장 09-01 백업에
// prep_ms가 없었다. 그 칸은 09-03 마이그레이션에서 붙었다). 옛 백업을 읽는 것이 이 도구의
// 존재 이유라, 없는 칸은 오류가 아니라 **"그 시절엔 안 재던 것"**으로 다룬다.
const columns = (table) => {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)) }
  catch { return new Set() }
}
const bcols = columns('broadcasts')
const hasPrep = bcols.has('prep_ms')

const span = one(`SELECT MIN(date) f, MAX(date) l, COUNT(*) n, COUNT(DISTINCT date) days FROM broadcasts WHERE ${OPS}`)
const total = span.n || 0
const days = span.days || 0

const autoN = one(`SELECT COUNT(*) n FROM broadcasts WHERE ${OPS} AND user = '자동'`).n
const okN = one(`SELECT COUNT(*) n FROM broadcasts WHERE ${OPS} AND success = 1`).n
const alertN = one("SELECT COUNT(*) n FROM broadcasts WHERE type = '경보'").n
// 경보 문구는 앞머리에 대괄호로 종류를 달고 나온다([방송누락] · [재생실패] · [방송단계] …).
// watchdog·시퀀서가 붙이는 것이라 여기서 새로 분류하지 않고 그대로 읽는다.
// "경보 20건"만으로는 좋은 소식인지 나쁜 소식인지 못 읽는다 — 방송이 안 나간 것과
// 브라우저가 재생을 막은 것은 고칠 곳이 서로 다르다.
const byAlert = all(`
  SELECT CASE WHEN content LIKE '[%]%' THEN substr(content, 2, instr(content, ']') - 2)
              ELSE '(분류 없음)' END kind,
         COUNT(*) n
  FROM broadcasts WHERE type = '경보' GROUP BY kind ORDER BY n DESC`)
const prep = hasPrep
  ? one(`SELECT COUNT(prep_ms) n, AVG(prep_ms) avg FROM broadcasts WHERE ${OPS} AND prep_ms IS NOT NULL`)
  : { n: 0, avg: null }
const prepN = prep.n || 0
const prepSec = prepN > 0 ? (prep.avg / 1000).toFixed(1) : null

const autoPct = pct(autoN, total)
const okPct = pct(okN, total)
const perDay = days > 0 ? (total / days).toFixed(1) : null

const activeSchedules = columns('schedules').has('active')
  ? one('SELECT COUNT(*) n FROM schedules WHERE active = 1').n
  : one('SELECT COUNT(*) n FROM schedules').n
const byType = all(`SELECT type, COUNT(*) n, SUM(success) ok FROM broadcasts WHERE ${OPS} GROUP BY type ORDER BY n DESC`)
const byUser = all(`SELECT user, COUNT(*) n FROM broadcasts WHERE ${OPS} GROUP BY user ORDER BY n DESC`)

let checkins = 0
try { checkins = one('SELECT COUNT(*) n FROM checkin_runs').n } catch { /* 옛 DB에는 이 표가 없다 */ }

// ── 한 장으로 ───────────────────────────────────────────────────────────
// 데이터-* 속성은 테스트가 읽는 자리다. 사람이 보는 숫자와 **같은 값**이어야 하므로
// 같은 변수에서 낸다 — 따로 계산하면 화면과 검사가 갈린다.
const card = (label, value, unit, note, attr) => `
  <div class="card"${attr ? ' ' + attr : ''}>
    <b>${esc(label)}</b>
    <em>${value === null ? '기록 없음' : esc(value)}${value === null ? '' : `<i>${esc(unit)}</i>`}</em>
    <p>${esc(note)}</p>
  </div>`

const page = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CareCast — 운영 기록</title>
<style>
  :root { --ink:#201D28; --sub:#72707A; --line:#E0DEE9; --brand:#C3ACFF; --brandink:#7C58C3; --bg:#F7F6FC; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font: 15px/1.65 "Noto Sans KR", Pretendard, system-ui, sans-serif; word-break: keep-all; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 28px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  .stamps { display:flex; flex-wrap:wrap; gap:8px; margin: 14px 0 26px; }
  .stamp { background:#fff; border:1px solid var(--line); border-radius:999px; padding:6px 13px; font-size:13px; color:var(--sub); }
  .stamp b { color: var(--ink); font-weight:600; }
  h2 { font-size:17px; margin:30px 0 12px; padding-top:18px; border-top:1px solid var(--line); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px 18px; }
  .card b { display:block; font-size:13px; color:var(--sub); font-weight:600; }
  .card em { display:block; font-style:normal; font-size:30px; font-weight:700; letter-spacing:-0.03em; margin:4px 0 2px; }
  .card em i { font-style:normal; font-size:15px; font-weight:500; color:var(--sub); margin-left:3px; }
  .card p { margin:0; font-size:12.5px; color:var(--sub); line-height:1.5; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { padding:9px 13px; text-align:left; font-size:14px; border-bottom:1px solid var(--line); }
  th { background:#FAF9FE; font-size:12.5px; color:var(--sub); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  td.n, th.n { text-align:right; font-variant-numeric: tabular-nums; }
  .src { background:#fff; border:1px solid var(--line); border-left:3px solid var(--brand); border-radius:10px;
         padding:14px 16px; font-size:13px; color:var(--sub); }
  .src b { color:var(--ink); }
  .src code { background:var(--bg); padding:1px 5px; border-radius:4px; font-size:12px; word-break:break-all; }
  .src ul { margin:8px 0 0; padding-left:18px; }
  footer { margin-top:30px; font-size:12.5px; color:var(--sub); }
</style></head><body><div class="wrap">

<h1>CareCast — 운영 기록</h1>
<div class="stamps">
  <span class="stamp">집계 기간 <b>${esc(span.f || '-')} ~ ${esc(span.l || '-')}</b></span>
  <span class="stamp">기록이 있는 날 <b>${days}일</b></span>
  <span class="stamp">만든 때 <b>${new Date().toISOString().slice(0, 10)}</b></span>
</div>

<h2>방송이 어떻게 나가고 있나</h2>
<div class="grid">
${card('나간 방송', total, '건', `${esc(span.f || '-')}부터 쌓인 기록 전부`, `데이터-총건수="${total}"`)}
${card('하루 평균', perDay, '건', `기록이 있는 ${days}일로 나눈 값`, perDay === null ? '' : `데이터-하루평균="${perDay}"`)}
${card('사람 손 없이 나간 것', autoPct, '%', `${autoN}건 / ${total}건 — 예약·자동 경로로 나간 방송`, autoPct === null ? '' : `데이터-자동비율="${autoPct}"`)}
${card('성공으로 끝난 방송', okPct, '%', `${okN}건 / ${total}건`, okPct === null ? '' : `데이터-성공률="${okPct}"`)}
${card('방송 1건 준비 시간', prepSec, '초', prepN > 0
    ? `${prepN}건에 기록됨 — 누르고 소리가 나기까지`
    : '아직 쌓이지 않았다. 예약 경로로 실제 발동해야 기록된다', prepSec === null ? '' : `데이터-준비시간초="${prepSec}"`)}
${card('켜져 있는 예약', activeSchedules, '건', '꺼 둔 예약은 세지 않았다', `데이터-활성예약="${activeSchedules}"`)}
${card('감시가 울린 횟수', alertN, '건', '방송이 아니라 "안 나갔다"는 알림 — 위 건수에서 뺐다', `데이터-경보="${alertN}"`)}
</div>
<div style="display:none" 데이터-기록일수="${days}" 데이터-준비시간표본="${prepN}" 데이터-점검이력="${checkins}"></div>

<h2>무엇이 나갔나 — 유형별</h2>
<table>
  <tr><th>유형</th><th class="n">건수</th><th class="n">성공</th><th class="n">성공률</th></tr>
${byType.map(r => {
    const p = pct(r.ok || 0, r.n)
    return `  <tr><td>${esc(r.type || '(빈 값)')}</td><td class="n">${r.n}</td><td class="n">${r.ok || 0}</td><td class="n">${p === null ? '기록 없음' : p + '%'}</td></tr>`
  }).join('\n')}
</table>

${alertN > 0 ? `<h2>감시가 무엇 때문에 울렸나</h2>
<table>
  <tr><th>종류</th><th class="n">건수</th></tr>
${byAlert.map(r => `  <tr 경보종류="${esc(r.kind)}"><td>${esc(r.kind)}</td><td class="n">${r.n}</td></tr>`).join('\n')}
</table>
<p style="font-size:13px;color:var(--sub);margin:10px 0 0">
  <b>방송누락</b>은 나갔어야 할 방송이 안 나간 것, <b>재생실패</b>는 화면 쪽에서 소리가 막힌 것,
  <b>방송단계</b>는 묶음 중 한 단계가 실패한 것이다 — 고칠 곳이 서로 다르다.
  위 방송 건수에는 들어 있지 않다.
</p>
` : ''}
<h2>누가 눌렀나</h2>
<table>
  <tr><th>기록된 이름</th><th class="n">건수</th><th class="n">비중</th></tr>
${byUser.map(r => `  <tr><td>${esc(r.user || '(빈 값)')}</td><td class="n">${r.n}</td><td class="n">${pct(r.n, total)}%</td></tr>`).join('\n')}
</table>

<h2>이 숫자는 어디서 나왔나</h2>
<div class="src">
  <b>읽은 파일</b> <code>${esc(DB_PATH)}</code><br>
  <b>집계 기간</b> ${esc(span.f || '-')} ~ ${esc(span.l || '-')} (기록이 있는 날 ${days}일)
  <ul>
    <li><b>어떻게 셌나</b> — 방송 이력(<code>broadcasts</code>)에서 <b>경보를 뺀</b> 행을 셌다.
        &lsquo;사람 손 없이&rsquo;는 기록의 이름 칸이 &lsquo;자동&rsquo;인 것, &lsquo;성공&rsquo;은 성공 표시가 선 것이다.
        예약은 켜져 있는 것만 셌다.</li>
    <li><b>경보를 왜 뺐나</b> — 같은 표에 앉지만 <b>방송이 아니다</b>. 감시가
        &ldquo;안 나갔다&rdquo;고 남긴 줄이라 사람이 누른 적도 스피커에서 난 적도 없고,
        언제나 실패 표시라 방송으로 세면 성공률이 통째로 주저앉는다.
        이 시스템도 둘을 갈라 다룬다(보관 기간이 경보 180일 · 방송 365일로 다르다).
        대신 위에 <b>${alertN}건</b>으로 따로 세어 뒀다 — 빼기만 하고 안 보여주면
        감시가 몇 번 울렸는지가 사라진다.</li>
    <li><b>준비 시간</b>은 예약 경로로 나간 방송에만 기록된다(<code>scheduler.js</code>).
        ${prepN > 0
      ? `지금 ${prepN}건에 있다.`
      : hasPrep
        ? '지금 이 파일에는 한 건도 없어서 &lsquo;기록 없음&rsquo;으로 뒀다 — 0초가 아니다.'
        : '<b>이 백업에는 그 칸 자체가 없다</b> — 준비 시간을 재기 시작하기 전에 뜬 파일이다. 0초가 아니라 안 잰 것이다.'}</li>
    <li><b>여기 없는 것</b> — 이 시스템이 아는 것은 <b>쓰기 시작한 뒤</b>의 기록뿐이다.
        그전에 사람이 직접 방송하던 때의 수치는 DB에 없으므로 이 장에 적지 않았다.
        비교가 필요하면 그 값을 아는 사람이 따로 붙여야 한다.</li>
    <li><b>자체 점검 기록</b> ${checkins}건(<code>checkin_runs</code>).</li>
  </ul>
</div>

<footer>
다시 만들려면 <code>node scripts/build-evidence-report.cjs</code>.
다른 PC의 기록으로 뽑으려면 <code>CARECAST_DB_PATH</code>에 그 PC의 백업 파일을 준다.
</footer>
</div></body></html>
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, page, 'utf8')
db.close()
const say = (v, unit) => (v === null ? '기록 없음' : v + unit)
console.log(`[근거 자료] ${OUT} — 방송 ${total}건(경보 ${alertN}건 제외) · ${days}일 · 자동 ${say(autoPct, '%')} · 성공 ${say(okPct, '%')} · 준비시간 ${say(prepSec, '초')}`)
