#!/usr/bin/env node
// HC-009 무인 검수 루프 — 보호 파일 3건을 한 번에 적용한다.
//
//   node scripts/apply-hc009.cjs            무엇을 바꿀지 보여만 준다(기본, 안전)
//   node scripts/apply-hc009.cjs --apply    실제로 적용한다
//   node scripts/apply-hc009.cjs --revert   되돌린다
//
// 왜 스크립트인가: 이 셋은 `.claude/hooks/**` 와 `harness.config.json` 이라 **보호 경로**다
// (AI 가 Edit/Write 로 못 고친다). 손으로 코드 블록을 삽입하는 것이 부담스러워서, 사람이
// 한 줄만 치면 끝나게 만들었다. 하는 일은 아래 세 가지가 전부이고 전부 **멱등**이다 —
// 두 번 실행해도 같은 결과이고, 이미 적용돼 있으면 건너뛴다.
//
//   1) docs/audit/HC-009/loop.js  →  .claude/hooks/loop.js         (상태 CLI)
//   2) .claude/hooks/guard-bash.js 끝에 블록 하나 삽입              (자체 승인을 장치로 막는다)
//   3) docs/audit/harness.config.json 의 protected_paths 2줄 + 예산 9
//
// 되돌리기는 `--revert`. 그때 만들어 둔 .bak 파일로 되돌리고, 없으면 git 으로 되돌리라고 안내한다.
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const P = (...p) => path.join(ROOT, ...p)

const APPLY = process.argv.includes('--apply')
const REVERT = process.argv.includes('--revert')

const 표식 = '// 7) 무인 루프(HC-009)'          // 삽입 여부를 이것으로 판정한다
const 보호경로추가 = ['docs/audit/LOOP_MODE.md', 'docs/audit/LOOP_CONFIG.json']
const 예산값 = 9

// guard-bash.js 끝의 `process.exit(0);` **앞에** 넣을 블록.
// 루프가 도는 동안(LOOP_STATE.json 이 살아 있을 때)만 동작하고, 루프 밖에서는 아무 일도 안 한다.
const 블록 = `${표식} RUNNING 중 Default-Deny — LOOP_STATE.json 이 살아 있을 때만 동작한다.
//    막는 것: ① 워킹트리를 바꾸는 git ② 파일 쓰기 셸 ③ **승인 큐 상태 전이(loop.js approve|reject)**.
//    ③ 이 핵심이다 — 자체 승인 금지(LOOP_MODE 0-2)를 "하지 말라"가 아니라 "Claude 의 Bash 로는
//    할 수 없다"로 만든다. 사용자는 자기 터미널에서 승인한다.
//    docs/audit 아래 append 는 통과시킨다(루프의 정당한 기록). 루프 밖에서는 아무것도 안 한다.
{
  const pathMod = require('path');
  const loopState = L.loadJSON(pathMod.join(L.AUDIT_DIR, 'LOOP_STATE.json'), null);
  const loopOn = loopState && !loopState.end_reason
    && ['RUNNING', 'COMMITTED', 'IDLE'].includes(loopState.cycle_status);
  if (loopOn) {
    const lc = L.loadJSON(pathMod.join(L.AUDIT_DIR, 'LOOP_CONFIG.json'), {});
    const deny = P(((lc.loop_mode_deny_patterns || {}).patterns) || []);
    const writesToAudit = /docs\\/audit\\//.test(cmd.replace(/\\\\/g, '/'));
    const isAppendish = (src) => src.startsWith('>>') || src.includes('[^0-9&>=-]');
    for (const re of deny) {
      if (re.test(cmd) && !(writesToAudit && isAppendish(re.source))) {
        L.denyTool('[guard-bash] 무인 루프 RUNNING 중 차단(LOOP_MODE 0-1/0-2/2절): /' + re.source + '/. '
          + "필요한 작업이면 'node .claude/hooks/loop.js pending <json>' 으로 승인 큐에 넣고 다음 대상으로 가세요. "
          + '승인(approve/reject)은 사용자 터미널에서만 됩니다.');
      }
    }
  }
}
`

const 결과 = []
const 적음 = (상태, 무엇) => 결과.push({ 상태, 무엇 })

function 백업(파일) {
  const bak = 파일 + '.hc009.bak'
  if (!fs.existsSync(bak)) fs.copyFileSync(파일, bak)
}

// ── 1) loop.js 복사 ────────────────────────────────────────────────────────
function 단계1() {
  const 원본 = P('docs', 'audit', 'HC-009', 'loop.js')
  const 대상 = P('.claude', 'hooks', 'loop.js')
  if (REVERT) {
    if (fs.existsSync(대상)) { if (APPLY) fs.unlinkSync(대상); 적음('되돌림', '.claude/hooks/loop.js 삭제') }
    else 적음('건너뜀', '.claude/hooks/loop.js 없음')
    return
  }
  if (!fs.existsSync(원본)) { 적음('실패', `원본이 없다: ${원본}`); return }
  if (fs.existsSync(대상) && fs.readFileSync(대상, 'utf8') === fs.readFileSync(원본, 'utf8')) {
    적음('이미됨', '.claude/hooks/loop.js (내용 같음)')
    return
  }
  if (APPLY) fs.copyFileSync(원본, 대상)
  적음(APPLY ? '적용' : '할일', '.claude/hooks/loop.js 로 복사')
}

// ── 2) guard-bash.js 블록 삽입 ─────────────────────────────────────────────
function 단계2() {
  const 파일 = P('.claude', 'hooks', 'guard-bash.js')
  let src = fs.readFileSync(파일, 'utf8')
  const 있음 = src.includes(표식)

  if (REVERT) {
    if (!있음) { 적음('건너뜀', 'guard-bash.js 에 블록 없음'); return }
    const bak = 파일 + '.hc009.bak'
    if (fs.existsSync(bak)) {
      if (APPLY) { fs.copyFileSync(bak, 파일); fs.unlinkSync(bak) }
      적음(APPLY ? '되돌림' : '할일', 'guard-bash.js 를 백업본으로 복원')
    } else {
      적음('수동', 'guard-bash.js 백업이 없다 — git checkout -- .claude/hooks/guard-bash.js')
    }
    return
  }

  if (있음) { 적음('이미됨', 'guard-bash.js 블록'); return }

  // 파일 끝의 마지막 `process.exit(0);` 앞에 넣는다. 그 자리가 모든 검사를 통과한 뒤다.
  const 끝표시 = '\nprocess.exit(0);'
  const i = src.lastIndexOf(끝표시)
  if (i < 0) { 적음('실패', 'guard-bash.js 에서 삽입 지점(process.exit(0);)을 못 찾았다'); return }

  const 새소스 = src.slice(0, i) + '\n' + 블록 + src.slice(i)
  // 넣기 전에 문법이 깨지지 않는지 본다 — 훅이 깨지면 모든 Bash 가 막힌다(fail-closed).
  try {
    new (require('vm').Script)(새소스, { filename: 파일 })
  } catch (e) {
    적음('실패', `삽입 결과가 문법 오류다(적용 안 함): ${e.message}`)
    return
  }
  if (APPLY) { 백업(파일); fs.writeFileSync(파일, 새소스, 'utf8') }
  적음(APPLY ? '적용' : '할일', 'guard-bash.js 끝에 루프 차단 블록 삽입')
}

// ── 3) harness.config.json 두 곳 ───────────────────────────────────────────
function 단계3() {
  const 파일 = P('docs', 'audit', 'harness.config.json')
  const cfg = JSON.parse(fs.readFileSync(파일, 'utf8'))
  const 바꿀것 = []

  if (REVERT) {
    const 남길것 = (cfg.protected_paths || []).filter((p) => !보호경로추가.includes(p))
    if (남길것.length !== (cfg.protected_paths || []).length) { cfg.protected_paths = 남길것; 바꿀것.push('protected_paths 2줄 제거') }
    if (cfg.budget && cfg.budget.max_subagents_per_session === 예산값) { cfg.budget.max_subagents_per_session = 5; 바꿀것.push('예산 5로 되돌림') }
  } else {
    cfg.protected_paths = cfg.protected_paths || []
    for (const p of 보호경로추가) {
      if (!cfg.protected_paths.includes(p)) { cfg.protected_paths.push(p); 바꿀것.push(`protected_paths += ${p}`) }
    }
    cfg.budget = cfg.budget || {}
    if (cfg.budget.max_subagents_per_session !== 예산값) { cfg.budget.max_subagents_per_session = 예산값; 바꿀것.push(`예산 → ${예산값}`) }
  }

  if (!바꿀것.length) { 적음('이미됨', 'harness.config.json'); return }
  if (APPLY) { 백업(파일); fs.writeFileSync(파일, JSON.stringify(cfg, null, 2) + '\n', 'utf8') }
  적음(APPLY ? '적용' : '할일', `harness.config.json — ${바꿀것.join(' · ')}`)
}

// ── 실행 ──────────────────────────────────────────────────────────────────
console.log(REVERT ? '=== HC-009 되돌리기' : '=== HC-009 적용', APPLY ? '(실제 적용)' : '(미리보기 — 아무것도 안 바꿨다)')
단계1(); 단계2(); 단계3()

console.log('')
for (const r of 결과) console.log(`  [${r.상태}] ${r.무엇}`)
console.log('')

const 실패 = 결과.filter((r) => r.상태 === '실패')
if (실패.length) {
  console.log('실패한 것이 있다 — 위 사유를 보고 사람에게 알린다. 아무것도 안 바꿨다.')
  process.exit(1)
}
if (!APPLY) {
  console.log(`실제로 적용하려면:  node scripts/apply-hc009.cjs ${REVERT ? '--revert ' : ''}--apply`)
} else {
  console.log('다음: node .claude/hooks/selftest.js        (보호 파일이 바뀌었다고 뜨는 것이 정상)')
  console.log('      node .claude/hooks/selftest.js --bless (그 변경을 기준선으로 굳힌다)')
  console.log('      node .claude/hooks/loop.js             (사용법이 뜨면 상태 CLI 준비 완료)')
}
