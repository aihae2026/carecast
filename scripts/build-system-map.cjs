#!/usr/bin/env node
// 전체 설계도 · 기능별 흐름 2종 · 코칭 브리프를 한 장으로 합친 "시스템 지도"를 만든다.
//
// 왜 합치나: 세 가지가 따로 있으면 사람이 세 군데를 열어야 하고, 그중 하나만 낡아도 아무도
// 모른다(코칭 브리프가 외부 아티팩트로 따로 살다가 앱 안으로 합쳐진 것과 같은 이유).
//
// 소스는 docs/arch/*.json(archify)과 DB의 코칭 브리프 표들이고, 이 파일은 산출물만 만든다.
// 다이어그램은 archify가 낸 HTML을 iframe srcdoc으로 통째로 넣는다 — SVG만 뽑아 오면
// archify의 190KB짜리 :root 테마 변수가 이 페이지의 색과 싸운다.
//
//   node scripts/build-system-map.cjs [출력경로]
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'arch', 'system-map.html')

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')

function frame(file, title) {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'arch', file), 'utf8')
  return '<iframe class="diagram" title="' + attr(title) + '" srcdoc="' + attr(html) + '"></iframe>'
}

// 이 지도는 **그림만** 다룬다. 코칭 브리프와 남은 검수 항목은 관리자 화면 '고도화 제안'이
// 원본이고, 사본을 여기 두면 같은 것을 두 군데서 보게 된다(2026-09-01 사용자 결정).
// 그래서 이 생성기는 DB도 review/findings.csv도 읽지 않는다 — 어느 PC에서 만들어도 결과가 같다.

// 머리줄 도장은 손으로 적지 않는다. 예전에는 "기준 2026-08-31 · verify 886/886"이 문자열로
// 박혀 있어서 다시 만들 때마다 낡은 사실을 그대로 옮겼다.
const stamp = (() => {
  let branch = '?', commit = '?'
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim()
    const m = head.match(/^ref: refs\/heads\/(.+)$/)
    branch = m ? m[1] : head.slice(0, 7)
    commit = require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  } catch { /* git이 없으면 물음표로 둔다 — 그림은 그대로 나온다 */ }
  return { branch, commit, builtAt: new Date().toISOString().slice(0, 16).replace('T', ' ') }
})()

const page = `<title>CareCast 시스템 지도</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@500;700;800&family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#EDF0F3; --surface:#FFFFFF; --surface-2:#F5F7F9;
  --ink:#141A22; --muted:#5B6774; --faint:#8794A2; --line:#D7DDE4;
  --accent:#0B6E5F; --accent-soft:#E1EFEB;
  --amber:#96580A; --amber-soft:#F6EEE0;
  --red:#A32E2E; --red-soft:#F5E7E7;
  --shadow:0 1px 2px rgba(16,24,32,.06), 0 8px 24px rgba(16,24,32,.05);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0D1116; --surface:#141A21; --surface-2:#1A212A;
    --ink:#E7EDF3; --muted:#9BA8B6; --faint:#77848F; --line:#242D38;
    --accent:#3FB79F; --accent-soft:#12302B;
    --amber:#D2932F; --amber-soft:#2C2315;
    --red:#E07A72; --red-soft:#31201F;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 30px rgba(0,0,0,.35);
  }
}
:root[data-theme="dark"]{
  --bg:#0D1116; --surface:#141A21; --surface-2:#1A212A;
  --ink:#E7EDF3; --muted:#9BA8B6; --faint:#77848F; --line:#242D38;
  --accent:#3FB79F; --accent-soft:#12302B;
  --amber:#D2932F; --amber-soft:#2C2315;
  --red:#E07A72; --red-soft:#31201F;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:"IBM Plex Sans KR","Gothic A1",system-ui,-apple-system,"Malgun Gothic",sans-serif;
  font-size:15.5px; line-height:1.7; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1140px; margin:0 auto; padding:0 24px}
code,.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace; font-size:.88em}
.dim{color:var(--faint); font-weight:500}
.small{font-size:13px}

header.top{border-bottom:1px solid var(--line); background:var(--surface)}
.masthead{display:flex; flex-wrap:wrap; gap:20px; align-items:flex-end; justify-content:space-between; padding:38px 0 26px}
h1{font-family:"Gothic A1",sans-serif; font-weight:800; font-size:clamp(28px,4vw,40px); letter-spacing:-.02em; margin:0; text-wrap:balance}
.sub{color:var(--muted); margin:8px 0 0; max-width:62ch}
.stamps{display:flex; gap:8px; flex-wrap:wrap}
.stamp{font-size:12.5px; padding:5px 11px; border-radius:999px; border:1px solid var(--line); background:var(--surface-2); color:var(--muted); font-variant-numeric:tabular-nums}
.stamp b{color:var(--ink); font-weight:600}
nav.jump{display:flex; gap:2px; flex-wrap:wrap; border-top:1px solid var(--line)}
nav.jump a{flex:1 1 auto; text-align:center; padding:13px 10px; color:var(--muted); text-decoration:none; font-size:14px; font-weight:500; border-bottom:2px solid transparent}
nav.jump a:hover{color:var(--accent); border-bottom-color:var(--accent); background:var(--surface-2)}
nav.jump a:focus-visible{outline:2px solid var(--accent); outline-offset:-2px}

section{padding:46px 0 8px}
.sec-head{display:flex; gap:14px; align-items:baseline; margin-bottom:6px}
.sec-num{font-family:"IBM Plex Mono",monospace; font-size:13px; color:var(--accent); letter-spacing:.08em}
h2{font-family:"Gothic A1",sans-serif; font-weight:700; font-size:24px; margin:0; letter-spacing:-.01em}
.lede{color:var(--muted); margin:0 0 22px 40px; max-width:74ch}
h3.minor{font-family:"Gothic A1",sans-serif; font-size:16px; font-weight:700; margin:30px 0 12px}
@media (max-width:640px){.lede{margin-left:0}}

.card{background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); overflow:hidden}
/* 그림 칸만 화면 폭까지 내보낸다(읽는 글은 65자 폭 유지).
   그리고 **높다.** archify 뷰어는 자기 폭 상한을 **뷰포트 높이**에서 정한다 — 실측으로
   1440x900이면 930px, 1440x1400이면 1326px로 그린다. iframe이 납작하면 글씨가 8px로
   쪼그라든다. 그래서 창 높이와 무관하게 넉넉히 높인다(페이지가 대신 스크롤된다). */
.card.wide{width:min(1880px, calc(100vw - 48px)); position:relative; left:50%; transform:translateX(-50%)}
.diagram{width:100%; height:clamp(1000px,140vh,1700px); border:0; display:block; background:var(--surface)}
@media (max-width:1200px){ .card.wide{width:100%; margin-left:0; left:0; transform:none} }
.figcap{display:flex; gap:10px; flex-wrap:wrap; justify-content:space-between; padding:12px 16px; border-top:1px solid var(--line); background:var(--surface-2); color:var(--faint); font-size:13px}

.grid{display:grid; gap:14px; margin-top:16px}
.g2{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.note{background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:10px; padding:14px 16px}
.note h3{margin:0 0 6px; font-size:14.5px; font-weight:600; font-family:"Gothic A1",sans-serif}
.note.warn{border-left-color:var(--amber)}
.note.stop{border-left-color:var(--red)}
.note ul{margin:6px 0 0; padding-left:18px; color:var(--muted); font-size:14px}
.note li{margin:3px 0}
.note li b{color:var(--ink); font-weight:600}
.note p{margin:0; color:var(--muted); font-size:14px}


footer{margin-top:56px; border-top:1px solid var(--line); background:var(--surface); color:var(--faint); font-size:13px}
footer .wrap{padding-top:22px; padding-bottom:34px}
footer b{color:var(--muted); font-weight:600}
</style>

<header class="top">
  <div class="wrap">
    <div class="masthead">
      <div>
        <h1>CareCast 시스템 지도</h1>
        <p class="sub">이 시스템이 어떻게 짜여 있고 방송 하나가 어떤 길로 나가는지. <b>그림만</b> 모았다 — 진행 상황과 남은 항목은 관리자 화면 &lsquo;고도화 제안&rsquo;이 원본이다.</p>
      </div>
      <div class="stamps">
        <span class="stamp">만든 때 <b>${stamp.builtAt}</b></span>
        <span class="stamp">브랜치 <b>${stamp.branch}</b></span>
        <span class="stamp">커밋 <b>${stamp.commit}</b></span>
      </div>
    </div>
    <nav class="jump">
      <a href="#structure">전체 설계도</a>
      <a href="#reserve">1. 예약하기</a>
      <a href="#broadcast">2. 방송하기</a>
    </nav>
  </div>
</header>

<main class="wrap">

<section id="structure">
  <div class="sec-head"><span class="sec-num">01</span><h2>전체 설계도</h2></div>
  <p class="lede">현장 PC 한 대 안에서 Node 서버와 브라우저가 같이 돈다. 네 가지 일 — <b>예약하기 · 방송하기 · 소리내기 · 지켜보기</b> — 로 묶었고,
  번호 1~8이 방송 하나가 나가는 순서다. 네모 안의 작은 글씨는 실제 파일 경로다. 모듈끼리 부를 수 있는 방향(배선 규칙)은 오른쪽 카드에 있다.</p>
  <div class="card wide">
    ${frame('structure.html', 'CareCast 전체 설계도')}
    <div class="figcap"><span>소스 <code>docs/arch/structure.json</code></span><span>더 크게 — 그림 오른쪽 아래 <b>+</b> 로 확대, 오른쪽 위 <b>Present</b>로 전체화면</span></div>
  </div>
</section>

<section id="reserve">
  <div class="sec-head"><span class="sec-num">02</span><h2>1. 예약하기</h2></div>
  <p class="lede">문장 한 줄이 예약이 되기까지. 가로줄이 누가 하는 일인지(사람 · 화면 · 서버), 왼쪽에서 오른쪽이 순서다.
  <b>AI는 초안까지만</b> 만들고, 사람이 확인 카드에서 체크하고 확정을 눌러야 예약이 된다.</p>
  <div class="card wide">
    ${frame('flow-reserve.html', 'CareCast 예약하기 흐름')}
    <div class="figcap"><span>소스 <code>docs/arch/flow-reserve.json</code></span><span>더 크게 — 그림 오른쪽 아래 <b>+</b>, 오른쪽 위 <b>Present</b>로 전체화면</span></div>
  </div>
</section>

<section id="broadcast">
  <div class="sec-head"><span class="sec-num">03</span><h2>2. 방송하기</h2></div>
  <p class="lede">그 시각에 무슨 일이 일어나는가. 발동 조건은 &lsquo;지금 분 == 예약 분&rsquo; 정확 일치 하나뿐이라,
  서버가 그 1분에 멈춰 있었으면 그 방송은 그날 안 나간다.</p>
  <div class="card wide">
    ${frame('flow-broadcast.html', 'CareCast 방송하기 흐름')}
    <div class="figcap"><span>소스 <code>docs/arch/flow-broadcast.json</code></span><span>맨 아래 줄(기록 · 감시)이 &ldquo;안 나간 방송&rdquo;을 잡는 자리다 · <b>+</b>로 확대</span></div>
  </div>
</section>

<section id="deploy">
  <div class="sec-head"><span class="sec-num">04</span><h2>이 코드가 현장에 닿는 길</h2></div>
  <p class="lede">그림 세 장이 &ldquo;어떻게 도는가&rdquo;라면 이 절은 &ldquo;어떻게 거기까지 가는가&rdquo;다. 구성의 일부라 여기 남긴다 —
  나머지(진행 상황 · 남은 검수 항목 · 코칭 브리프)는 관리자 화면 &lsquo;고도화 제안&rsquo;이 원본이고 이 지도에 사본을 두지 않는다.</p>
  <div class="grid g2">
    <div class="note warn"><h3>main 병합 = 즉시 실배포</h3><ul>
      <li>현장 PC가 <code>main</code>을 <b>10분마다</b> 자동 pull · 빌드 · 재시작한다(<code>services/autoUpdate.js</code>)</li>
      <li><code>dev</code>에서는 그 자동 업데이트가 꺼진다 — 개발 PC가 제멋대로 코드를 당겨오지 않게</li>
      <li>병합 시점은 사람이 정한다. 병합 직전에 <code>/deploy-gate</code>를 돌린다</li>
    </ul></div>
    <div class="note"><h3>자료는 코드를 따라오지 않는다</h3><ul>
      <li><code>server/db/</code>는 git 밖이다 — 예약 · 음원 · 즐겨찾기는 PC마다 따로다</li>
      <li>개발 PC에서 목록이 비어 보이는 것은 고장이 아니다. 같은 뿌리로 여러 번 헛걸음했다</li>
      <li>현장 값을 기초값으로 옮기려면 <code>scripts/make-site-baseline.cjs</code> (이미 값이 있으면 덮지 않는다)</li>
    </ul></div>
  </div>
</section>

</main>

<footer><div class="wrap">
  <b>만드는 법</b> — <code>node scripts/build-system-map.cjs</code>. 다이어그램의 소스는 <code>docs/arch/*.json</code>이고 HTML은 산출물이다(HTML을 직접 고치지 않는다).
  진행 상황과 남은 항목은 여기 없다 — 관리자 화면 &lsquo;고도화 제안&rsquo;이 원본이다.
</div></footer>
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, page, 'utf8')
console.log('[시스템 지도] ' + OUT + ' (' + (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB)')
