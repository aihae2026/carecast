#!/usr/bin/env node
'use strict';
// 야간 읽기 전용 러너 — 소스를 고치지 않는다. 조회·실행·기록만 한다.
// 멈추려면 _loops/night/STOP 파일을 만든다(다음 항목을 시작하지 않는다).
// 창(22:00~07:00 Asia/Seoul)과 금지 시간대는 loop-codex.js 와 같은 규칙을 쓴다.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const OUT = path.join(ROOT, '_loops', 'night');
const STOP = path.join(OUT, 'STOP');
const LOG = path.join(OUT, 'night.log');
const REPORT = path.join(OUT, 'REPORT.md');
fs.mkdirSync(OUT, { recursive: true });

const BROADCASTS = ['07:50', '09:00', '11:10', '16:14', '18:00'];
const PAD = 30;
const WINDOW = { start: 22 * 60, end: 7 * 60 };
const ITEM_TIMEOUT_MS = 20 * 60 * 1000;

function nowMin() {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}
function forbidden(m) {
  for (const t of BROADCASTS) {
    const c = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    if (m >= c - PAD && m <= c + PAD) return t;
  }
  return null;
}
const inWindow = (m) => m >= WINDOW.start || m < WINDOW.end;
const ts = () => new Date().toISOString();
function say(s) { const line = '[' + ts() + '] ' + s; console.log(line); fs.appendFileSync(LOG, line + '\n'); }

function run(cmd, opts) {
  const t0 = Date.now();
  try {
    const out = cp.execSync(cmd, {
      cwd: ROOT, timeout: (opts && opts.timeout) || ITEM_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { AUDIT_DRY_RUN: '1', CARECAST_NO_HARDWARE: '1' }),
    }).toString();
    return { ok: true, out: out, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '') || e.message), ms: Date.now() - t0, timedOut: e.killed === true };
  }
}

// ── 항목 정의 ────────────────────────────────────────────────────────────
// 각 항목은 { id, 이름, fn } 이고 fn 은 { 요약, 본문, 이상 } 을 낸다.
// '이상' 이 true 인 것만 아침 보고 위쪽에 실린다.
const ITEMS = [
  { id: 1, name: 'COMPLETED 기능 TC 재실행(드라이런)', fn: () => {
    const r = run('npm run test:server --silent');
    // fail 만 세면 안 된다 — 타임아웃은 cancelled 로 잡히고 fail 은 0 이다.
    // 그래서 '실패 0건'이라 적으면서 이상 표시를 다는 모순이 났다(2026-09-09).
    const num = (k) => { const m = new RegExp(k + ' ([0-9]+)').exec(r.out); return m ? Number(m[1]) : null; };
    const fail = num('fail');
    const cancelled = num('cancelled');
    const pass = num('pass');
    const bad = (fail || 0) + (cancelled || 0);
    const 요약 = fail === null
      ? (r.ok ? '서버 테스트 통과(집계 못 읽음)' : '서버 테스트 실행 실패 — 집계 못 읽음')
      : '통과 ' + pass + ' · 실패 ' + fail + ' · 취소(타임아웃 등) ' + cancelled;
    return { 요약: 요약, 본문: r.out.split('\n').slice(-40).join('\n'), 이상: !r.ok || bad > 0 };
  } },
  { id: 2, name: 'golden 재생성 diff', fn: () => {
    const has = fs.existsSync(path.join(ROOT, 'tests', 'golden')) || fs.existsSync(path.join(ROOT, 'server', 'test', 'golden'));
    if (!has) return { 요약: 'golden 폴더 없음 — 건너뜀', 본문: '', 이상: false };
    const r = run('git status --porcelain -- "*golden*"');
    return { 요약: r.out.trim() ? 'golden 변경 있음' : 'golden 변경 없음', 본문: r.out, 이상: !!r.out.trim() };
  } },
  { id: 3, name: 'npm audit (HIGH 이상, 설치 안 함)', fn: () => {
    const r = run('npm audit --json --audit-level=high');
    // npm audit 은 취약점을 찾으면 비정상 종료한다 — 그건 정상이다. 조회 자체가
    // 실패한 것과 구분해야 한다. 못 읽었으면 '0건'이 아니라 '확인 못 함'이다
    // (2026-09-09 독립 검수 지적: 조용히 이상 없음으로 넘어갔다).
    // JSON 으로 읽히는 것과 '집계가 있는 것'은 다르다. npm 은 오프라인일 때도
    // {error:{...}} 라는 멀쩡한 JSON 을 낸다 — metadata 를 빈 객체로 갈음하면
    // 그 실패가 '0건'이 된다(2026-09-09 독립 검수 지적, 앞 수정이 여기까지 못 갔다).
    let high = null, crit = null, why = '';
    try {
      const j2 = JSON.parse(r.out);
      if (j2 && j2.error) why = 'npm 이 오류를 냈다: ' + String(j2.error.code || j2.error.summary || '알 수 없음').slice(0, 80);
      else {
        const v = j2 && j2.metadata && j2.metadata.vulnerabilities;
        if (!v || typeof v.high !== 'number' || typeof v.critical !== 'number') why = '집계(metadata.vulnerabilities)가 없다';
        else { high = v.high; crit = v.critical; }
      }
    } catch { why = '결과를 JSON 으로 읽지 못했다'; }
    const 못읽음 = high === null;
    return { 요약: 못읽음 ? '확인 못 함 — ' + (why || '조회 실패') : 'HIGH ' + high + ' · CRITICAL ' + crit,
             본문: r.out.slice(0, 4000), 이상: 못읽음 || (high + crit) > 0 };
  } },
  { id: 4, name: 'selftest 전체', fn: () => {
    const r = run('node .claude/hooks/selftest.js');
    const m = new RegExp('FAIL ([0-9]+)건').exec(r.out);
    // 실행 자체가 실패하면 집계가 없다 — 그때 '통과'로 넘기면 안 된다.
    const 못돌았다 = !m;
    return { 요약: 못돌았다 ? '확인 못 함 — selftest 를 못 돌렸다' : '47건 검사 · FAIL ' + m[1] + '건',
             본문: r.out.split(String.fromCharCode(10)).slice(-25).join(String.fromCharCode(10)),
             이상: 못돌았다 || Number(m[1]) > 0 };
  } },
  { id: 6, name: 'metrics report --days 7', fn: () => {
    const p = path.join(ROOT, '.claude', 'hooks', 'metrics.js');
    if (!fs.existsSync(p)) return { 요약: 'metrics.js 없음 — 건너뜀', 본문: '', 이상: false };
    const r = run('node .claude/hooks/metrics.js report --days 7');
    return { 요약: r.ok ? '조회 완료' : '조회 실패', 본문: r.out.slice(0, 6000), 이상: !r.ok };
  } },
  { id: 7, name: 'OPEN·DEFERRED 이슈 나이순', fn: () => {
    const p = path.join(ROOT, 'docs', 'audit', 'ISSUES.md');
    if (!fs.existsSync(p)) return { 요약: 'ISSUES.md 없음', 본문: '', 이상: true };
    // 표 행만 본다 — 범례 줄에도 'OPEN / FIXING / ...' 이 있어 줄 전체를 훑으면 걸린다.
    // 상태 칸은 'OPEN (MT-009 대기...)' 처럼 뒤에 말이 붙고 굵게 표시되기도 한다.
    // 2026-09-09: 이 둘을 못 봐서 OPEN 이 있는데 0건이라고 보고했다.
    const rows = [];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (line.indexOf('| ISSUE-') !== 0) continue;
      const c = line.split('|').map((x) => x.trim());
      const status = String(c[7] || '').split('*').join('').trim();
      if (!/^(OPEN|DEFERRED)/.test(status)) continue;
      const m = new RegExp('([0-9]{4}-[0-9]{2}-[0-9]{2})').exec(String(c[8] || ''));
      const age = m ? Math.floor((Date.now() - Date.parse(m[1])) / 86400000) : null;
      rows.push({ id: c[1], age: age, status: status.slice(0, 60) });
    }
    rows.sort((x, y) => (y.age === null ? -1 : y.age) - (x.age === null ? -1 : x.age));
    const old = rows.filter((r) => r.age !== null && r.age > 30);
    return { 요약: 'OPEN·DEFERRED ' + rows.length + '건, 30일 초과 ' + old.length + '건',
             본문: rows.map((r) => '  ' + (r.age === null ? '  ?' : String(r.age).padStart(3)) + '일  ' + r.id + '  ' + r.status + (r.age !== null && r.age > 30 ? '   [30일 초과]' : '')).join('\n'),
             이상: old.length > 0 };
  } },
];

function dirSize(p) {
  let n = 0;
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { n += fs.statSync(full).size; } catch { /* 사라진 파일은 센 것에서 뺀다 */ } }
    }
  };
  walk(p);
  return n;
}
const MB = (n) => (n / 1048576).toFixed(1) + 'MB';

ITEMS.push({ id: 8, name: '로그·임시파일·sandbox 크기와 전일 대비', fn: () => {
  const targets = {
    'docs/audit/sandbox': path.join(ROOT, 'docs', 'audit', 'sandbox'),
    'server/logs': path.join(ROOT, 'server', 'logs'),
    '_loops/codex (야간 루프 자체)': path.join(ROOT, '_loops', 'codex'),
    '_loops/night (야간 루프 자체)': OUT,
    'docs/audit/reviews/_raw': path.join(ROOT, 'docs', 'audit', 'reviews', '_raw'),
  };
  const now = {};
  for (const k in targets) now[k] = fs.existsSync(targets[k]) ? dirSize(targets[k]) : 0;
  const stateF = path.join(OUT, 'sizes.json');
  const prev = fs.existsSync(stateF) ? JSON.parse(fs.readFileSync(stateF, 'utf8')) : null;
  const rows = Object.keys(now).map((k) => {
    const d = prev && prev.sizes[k] !== undefined ? now[k] - prev.sizes[k] : null;
    return '  ' + k.padEnd(32) + MB(now[k]).padStart(9) + (d === null ? '   (첫 측정)' : '   ' + (d >= 0 ? '+' : '') + MB(d));
  });
  fs.writeFileSync(stateF, JSON.stringify({ at: ts(), sizes: now }, null, 2));
  const grew = prev && Object.keys(now).some((k) => prev.sizes[k] !== undefined && now[k] - prev.sizes[k] > 50 * 1048576);
  return { 요약: prev ? '전일 대비 기록함' : '첫 측정(기준선 저장)', 본문: rows.join('\n'), 이상: !!grew };
} });

ITEMS.push({ id: 9, name: 'PROJECT_PROFILE [FACT] 대조 (BROADCAST_TIMES 필수)', fn: () => {
  const 현장 = ['07:50', '09:00', '11:10', '16:14', '18:00'];
  const 코드기본 = ['07:50', '08:40', '11:15', '16:15', '18:00'];
  const out = [];
  let 어긋남 = 0;
  // 게이트는 BROADCAST_TIMES=() 로 시작해 site-baseline.json 에서 채운다.
  // 그러니 리터럴을 찾으면 안 된다 — 2026-09-09 에 빈 배열을 읽고 '5건 어긋남'이라 거짓 보고했다.
  // 진짜 물음은 '그 baseline 이 현장 시각을 담고 있나' 이다. 못 읽으면 코드기본으로 떨어진다.
  const KEYS = ['morning_time', 'exercise_broadcast_time', 'lunch_broadcast_time', 'dinner_broadcast_time', 'evening_prayer_time'];
  const bl = path.join(ROOT, 'server', 'config', 'site-baseline.json');
  if (!fs.existsSync(bl)) {
    out.push('  BROADCAST_TIMES: site-baseline.json 없음 -> 게이트가 코드기본값 [' + 코드기본.join(' ') + '] 으로 검사한다');
    out.push('    현장 [' + 현장.join(' ') + '] 과 3건 어긋난다 (체조·점심·저녁)');
    어긋남 += 1;
  } else {
    let st = {};
    try { st = (JSON.parse(fs.readFileSync(bl, 'utf8')).settings) || {}; } catch { st = {}; }
    const got = KEYS.map((k) => st[k]).filter(Boolean).map(String);
    if (!got.length) {
      out.push('  BROADCAST_TIMES: baseline 에 시각 키가 없다 -> 게이트가 코드기본값으로 떨어진다');
      어긋남 += 1;
    } else {
      const diff = KEYS.map((k, i) => ({ k: k, want: 현장[i], got: st[k] })).filter((x) => x.got !== x.want);
      if (diff.length) {
        out.push('  BROADCAST_TIMES: baseline 이 현장과 ' + diff.length + '건 어긋난다');
        diff.forEach((x) => out.push('    ' + x.k + ': baseline=' + (x.got || '없음') + ' 현장=' + x.want));
        어긋남 += 1;
      } else {
        out.push('  BROADCAST_TIMES: baseline 이 현장 5건과 일치 [' + got.join(' ') + ']');
      }
    }
  }
  const wf = path.join(ROOT, 'server', 'services', 'weather.js');
  if (!fs.existsSync(wf)) { out.push('  weather.js 없음'); 어긋남 += 1; }
  else {
    const s = fs.readFileSync(wf, 'utf8');
    const miss = ['kma_api_key', 'kma_apihub_key', 'kma_living_api_key', 'airkorea_api_key'].filter((k) => s.indexOf(k) < 0);
    if (miss.length) { out.push('  weather.js 에 키 참조 없음: ' + miss.join(', ') + ' — PROFILE §1-2 와 어긋남'); 어긋남 += 1; }
    else out.push('  weather.js: API 키 4종 참조 확인');
  }
  return { 요약: 어긋남 ? '어긋난 항목 ' + 어긋남 + '건' : '대조한 항목 일치',
           본문: out.join('\n'), 이상: 어긋남 > 0 };
} });

// ── 실행 ─────────────────────────────────────────────────────────────────
function main() {
  say('야간 읽기 전용 러너 시작 · pid=' + process.pid + ' · 항목 ' + ITEMS.length + '개');
  say('멈추려면: 파일 생성 ' + STOP);
  const results = [];
  for (const it of ITEMS) {
    if (fs.existsSync(STOP)) { say('종료 요청 — ' + it.id + '번부터 건너뛴다'); results.push({ id: it.id, name: it.name, skipped: '종료 요청' }); continue; }
    const m = nowMin();
    const fb = forbidden(m);
    if (fb) { say('금지 시간대(' + fb + ' 전후 ' + PAD + '분) — ' + it.id + '번 건너뜀'); results.push({ id: it.id, name: it.name, skipped: '금지 시간대 ' + fb }); continue; }
    if (!inWindow(m)) { say('실행 창(22:00~07:00) 밖 — ' + it.id + '번부터 중단'); results.push({ id: it.id, name: it.name, skipped: '창 밖' }); break; }
    say(it.id + '번 시작: ' + it.name);
    let r;
    try { r = it.fn(); } catch (e) { r = { 요약: '실행 중 예외: ' + e.message.slice(0, 120), 본문: e.stack, 이상: true }; }
    say(it.id + '번 끝: ' + r.요약 + (r.이상 ? '  [이상]' : ''));
    results.push(Object.assign({ id: it.id, name: it.name }, r));
  }
  const 이상 = results.filter((r) => r.이상);
  const md = ['# 야간 읽기 전용 결과 — ' + ts(), '',
    '## 쓰기 TASK', '', '없음. 조건(코드 파일 · SELF_FILES 미접촉 · 부작용 모듈 미접촉)을 모두',
    '만족하는 PENDING 항목이 없어 사용자 결정에 따라 0건으로 돌았다.', '',
    '## 읽기 전용 — 변경·이상만', ''];
  if (!이상.length) md.push('이상 없음.', '');
  for (const r of 이상) md.push('### ' + r.id + '. ' + r.name, '', '**' + r.요약 + '**', '', '```', String(r.본문 || '').slice(0, 3000), '```', '');
  md.push('## 전체 항목', '');
  for (const r of results) md.push('- ' + r.id + '. ' + r.name + ' — ' + (r.skipped ? '건너뜀(' + r.skipped + ')' : r.요약 + (r.이상 ? '  **[이상]**' : '')));
  md.push('', '## 이 러너가 못 한 것', '',
    '- 5번 PENDING 사전 분석 표 · 10번 SCREEN_MAP 초안 — 판단과 브라우저가 필요해 사람/세션이 한다.');
  fs.writeFileSync(REPORT, md.join('\n'));
  say('보고서: ' + REPORT + ' · 이상 ' + 이상.length + '건');
}
main();
