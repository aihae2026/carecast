#!/usr/bin/env node
// 코칭 하루 전에 코치에게 보낼 자료 한 장을 만든다.
//
//   node scripts/build-coach-packet.cjs [출력경로]
//
// 왜 자동이 아니라 손으로 부르는가: 코칭 날짜가 정해질 때만 필요하고, 그 시점의 상태가
// 담겨야 한다. 주기적으로 만들어 두면 언제 것인지 모르는 파일이 쌓인다.
//
// 원본은 관리자 화면 '고도화 제안'(코칭 브리프)이다. 이 파일은 거기서 읽어 **보내기 좋은
// 한 장**으로 추릴 뿐이고, 여기서만 아는 사실을 새로 적지 않는다.
'use strict'

const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '..')
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'coach-packet.html')
const DB_PATH = process.env.CARECAST_DB_PATH || path.join(ROOT, 'server', 'db', 'database.db')

// 공개 저장소와, 저장소 안에 함께 있는 설계도(docs/arch/system-map.html — 기본 출력 docs/ 기준 상대 경로).
const REPO = process.env.CARECAST_REPO_URL || 'https://github.com/jung-svg/carecast'
const MAP = 'arch/system-map.html'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 체크리스트 문항 라벨은 **DB가 단일 출처다**(마이그레이션 0019, 고도화 제안 #23).
//
// 2026-09-05까지 이 자리에는 화면 소스(ImprovementProposals.jsx)에서 CHECKLIST_SETS 상수를
// 정규식으로 긁는 함수가 있었다. 그 상수는 0019에서 DB로 옮겨갔는데 여기만 안 따라와서,
// `if (!block) return []`로 **조용히 빈 목록**을 돌려주고 있었다 — 코치 자료에 문항 대신
// "항목 0"·"항목 1"이 찍혔다. 아무 오류도 안 나서 아무도 몰랐다.

if (!fs.existsSync(DB_PATH)) {
  console.error('[코치 자료] DB를 못 찾았다: ' + DB_PATH)
  process.exit(1)
}
const db = new DatabaseSync(DB_PATH, { readOnly: true })
const all = (q, ...a) => db.prepare(q).all(...a)

const week = db.prepare('SELECT * FROM checklist_weeks WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get()
const entries = week ? all('SELECT * FROM checklist_entries WHERE week_id = ?', week.id) : []
const checks = entries.filter(e => e.kind === 'checklist').sort((a, b) => Number(a.item_key) - Number(b.item_key))
const scores = entries.filter(e => e.kind === 'score')
const questions = all('SELECT question, context FROM coach_questions ORDER BY sort_order, id')
const openItems = all("SELECT title, description FROM improvement_proposals WHERE status IN ('추천','승인') ORDER BY id DESC LIMIT 6")
// 문항은 값과 다른 표에 산다(checklist_items). item_key로 값과 이어진다 — 그 열쇠는 한 번
// 정하면 안 바뀐다(domain/checklistItems.js 머리말).
const items = week ? all('SELECT item_key, label FROM checklist_items WHERE week_id = ? ORDER BY sort_order', week.id) : []
db.close()

const labels = Object.fromEntries(items.map(i => [String(i.item_key), i.label]))
const done = checks.filter(c => Number(c.value) === 1).length
const SCORE_LABEL = {
  importance: '문제 중요도', ai_need: 'AI 솔루션 필요성', feasibility: '실현 가능성',
  tech_ready: '기술 준비도', impact: '기대 효과',
}

const page = `<title>CareCast — 코칭 자료</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@600;800&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap">
<style>
:root{--bg:#EDF0F3;--surface:#fff;--surface-2:#F5F7F9;--ink:#141A22;--muted:#5B6774;--faint:#8794A2;
 --line:#D7DDE4;--accent:#0B6E5F;--accent-soft:#E1EFEB;--amber:#96580A;--amber-soft:#F6EEE0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0D1116;--surface:#141A21;--surface-2:#1A212A;
 --ink:#E7EDF3;--muted:#9BA8B6;--faint:#77848F;--line:#242D38;--accent:#3FB79F;--accent-soft:#12302B;
 --amber:#D2932F;--amber-soft:#2C2315}}
:root[data-theme="dark"]{--bg:#0D1116;--surface:#141A21;--surface-2:#1A212A;--ink:#E7EDF3;--muted:#9BA8B6;
 --faint:#77848F;--line:#242D38;--accent:#3FB79F;--accent-soft:#12302B;--amber:#D2932F;--amber-soft:#2C2315}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans KR",system-ui,"Malgun Gothic",sans-serif;font-size:15.5px;line-height:1.72}
.wrap{max-width:78ch;margin:0 auto;padding:44px 24px 64px}
h1{font-family:"Gothic A1",sans-serif;font-weight:800;font-size:30px;margin:0 0 8px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0 0 6px}
.stamps{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 34px}
.stamp{font-size:12.5px;padding:5px 11px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted)}
.stamp b{color:var(--ink);font-weight:600}
h2{font-family:"Gothic A1",sans-serif;font-weight:600;font-size:19px;margin:38px 0 10px}
p{margin:0 0 12px}
ul{margin:0;padding:0;list-style:none}
li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 15px;margin-bottom:9px}
li b{display:block;font-weight:600}
li span{color:var(--muted);font-size:14px}
li.q{border-left:3px solid var(--accent)}
li.open{border-left:3px solid var(--amber)}
.chk{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.chk span{font-size:13px;padding:5px 12px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-weight:500}
.chk span.off{background:transparent;color:var(--muted);border:1px dashed var(--line);font-weight:400}
.sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.sc div{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.sc b{display:flex;justify-content:space-between;font-weight:600;font-size:14.5px}
.sc i{font-style:normal;color:var(--accent);font-variant-numeric:tabular-nums}
.sc p{margin:6px 0 0;font-size:13px;color:var(--muted)}
a{color:var(--accent)}
footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--faint);font-size:13.5px}
</style>
<div class="wrap">
<h1>CareCast — 코칭 자료</h1>
<p class="sub">요양원 자동 방송 시스템. 아침 방송·국민체조·식사 전 체조·저녁 마무리 방송이 매일 같은 시각에 무인으로 나갑니다.</p>
<div class="stamps">
  <span class="stamp">주차 <b>${esc(week?.week_label ?? '-')}</b></span>
  <span class="stamp">자체 점검 <b>${done}/${checks.length}</b></span>
  <span class="stamp">만든 때 <b>${new Date().toISOString().slice(0, 10)}</b></span>
</div>

<h2>먼저 봐 주시면 좋은 것</h2>
<ul>
  <li class="q"><b><a href="${REPO}">저장소</a></b><span>${esc(REPO)}</span></li>
  <li class="q"><b><a href="${MAP}">구성도 — 개발자용 설계도</a></b><span>전체 설계도 · 예약하기 · 방송하기 그림 세 장 (저장소의 docs/arch/system-map.html)</span></li>
</ul>

<h2>여쭙고 싶은 것</h2>
<ul>
${questions.map(q => `  <li class="q"><b>${esc(q.question)}</b>${q.context ? `<span>${esc(q.context)}</span>` : ''}</li>`).join('\n')}
</ul>

<h2>지금 열려 있는 작업</h2>
<ul>
${openItems.map(o => `  <li class="open"><b>${esc(o.title)}</b><span>${esc((o.description || '').slice(0, 160))}</span></li>`).join('\n')}
</ul>

<h2>자체 점검 — ${esc(week?.week_label ?? '')}</h2>
<div class="chk">
${checks.map(c => `  <span class="${Number(c.value) === 1 ? '' : 'off'}">${esc(labels[String(c.item_key)] || ('항목 ' + c.item_key))}</span>`).join('\n')}
</div>
<div class="sc">
${scores.map(s => `  <div><b>${esc(SCORE_LABEL[s.item_key] || s.item_key)}<i>${esc(s.value)} / 5</i></b><p>${esc(s.note)}</p></div>`).join('\n')}
</div>

<footer>
이 자료는 관리자 화면 &lsquo;고도화 제안&rsquo;(코칭 브리프)에서 추린 것입니다. 원본은 그 화면이고,
다시 만들려면 <code>node scripts/build-coach-packet.cjs</code>.
</footer>
</div>
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, page, 'utf8')
console.log('[코치 자료] ' + OUT + ' (' + (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB, 질문 ' + questions.length + '건 · 열린 작업 ' + openItems.length + '건)')
