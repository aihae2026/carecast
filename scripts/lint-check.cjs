// eslint을 돌리되, baseline.json에 등록된 기존 위반은 무시하고
// "신규로 새로 생긴" 위반만 실패로 취급한다 (CLAUDE.md 6번 규칙).
// 사용법:
//   node scripts/lint-check.cjs            — baseline과 대조해서 신규 위반만 검사
//   node scripts/lint-check.cjs --update    — 지금 상태를 새 baseline으로 저장 (사람이 검토 후 의도적으로 실행)
'use strict'

const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const BASELINE_PATH = path.join(ROOT, 'baseline.json')

function runEslint() {
  // npx.cmd는 Windows에서 execFileSync(shell 없이)로 못 찾으므로, 로컬 eslint 바이너리를 직접 실행한다
  const eslintBin = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')
  try {
    const out = execFileSync(process.execPath, [eslintBin, '.', '--format', 'json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
    return JSON.parse(out)
  } catch (err) {
    // eslint는 위반이 있으면 exit 1로 종료하지만 stdout에는 여전히 JSON을 낸다
    if (err.stdout) return JSON.parse(err.stdout)
    throw err
  }
}

// file+rule의 "몇 번째 발생인지"로 서명을 만든다 (줄 번호 자체는 안 씀).
// 줄 번호 기반 서명은 그 파일의 다른 곳에 몇 줄만 추가/삭제돼도 그 아래 있는
// 기존 위반들이 전부 "새 위반"으로 오탐되는 문제가 있어서, 발생 순서(occurrence
// index)로 바꿨다 — 같은 파일에 같은 rule이 net으로 몇 건 있는지만 보므로
// 편집으로 인한 줄 밀림에는 안정적이고, 실제로 위반이 늘어난 경우만 잡아낸다.
function toSignatures(results) {
  const sigs = new Set()
  for (const file of results) {
    const rel = path.relative(ROOT, file.filePath).split(path.sep).join('/')
    const countByRule = {}
    // eslint는 메시지를 줄 순서대로 주므로, 등장 순서 그대로 카운트하면 된다
    for (const msg of file.messages) {
      const rule = msg.ruleId || msg.message
      countByRule[rule] = (countByRule[rule] || 0) + 1
      sigs.add(`${rel}::${rule}::${countByRule[rule]}`)
    }
  }
  return sigs
}

const results = runEslint()
const current = toSignatures(results)

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify([...current].sort(), null, 2) + '\n')
  console.log(`[lint:check] baseline.json 갱신함 — 기존 위반 ${current.size}건을 기준선으로 저장`)
  process.exit(0)
}

let baseline = new Set()
if (fs.existsSync(BASELINE_PATH)) {
  baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')))
}

const fresh = [...current].filter(s => !baseline.has(s))

if (fresh.length > 0) {
  console.error(`[lint:check] FAIL — baseline에 없는 신규 lint 위반 ${fresh.length}건:`)
  for (const s of fresh) console.error('  ' + s)
  process.exit(1)
}

console.log(`[lint:check] PASS — 신규 위반 없음 (baseline 기존 부채 ${baseline.size}건은 그대로 존재, 이번 작업 범위 아님)`)
