#!/usr/bin/env node
// 병합 예비 점검 — **읽기 전용**. 인덱스·작업트리·브랜치·stash 를 건드리지 않는다.
//
//   node scripts/merge-preflight.cjs [받는쪽] [주는쪽]      기본값: dev design-c
//
// 재는 것 셋:
//   ① 주는쪽이 받는쪽의 자손인가(빨리감기인가)
//   ② 받는쪽 **작업트리의 미커밋 변경**이 주는쪽이 고친 파일과 겹치는가
//      — 겹치면 git 이 체크아웃을 거부하므로, 그 세션이 먼저 커밋해야 한다
//   ③ 그 세션이 커밋한 뒤의 **진짜 충돌 덩어리 수** (`git merge-file --diff3` 를 임시 사본에)
//
// **왜 스크립트로 두나.** 2026-09-13 에 손으로 재다가 틀렸다 — `git show` 는 LF 를 주고
// 디스크 파일은 CRLF 라, 정규화를 안 하면 **멀쩡한 파일이 통째로 다르게** 보인다.
// 그때 「충돌 4파일」이라고 보고했고 실제로는 3파일이었다. 그 정규화를 여기 박아 둔다.
'use strict'

const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const 받는쪽 = process.argv[2] || 'dev'
const 주는쪽 = process.argv[3] || 'design-c'

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
// CRLF 를 평평하게. 이 한 줄이 이 스크립트가 존재하는 이유의 절반이다.
const 평 = (s) => s.replace(/\r\n/g, '\n')

// 받는쪽 브랜치가 체크아웃돼 있는 작업트리를 찾는다 — 거기가 미커밋 변경이 사는 곳이다.
function 작업트리(브랜치) {
  const 줄 = git(['worktree', 'list', '--porcelain']).split(/\r?\n/)
  let 현재 = null
  for (const l of 줄) {
    if (l.startsWith('worktree ')) 현재 = l.slice(9)
    else if (l === `branch refs/heads/${브랜치}`) return 현재
  }
  return null
}

const base = git(['merge-base', 받는쪽, 주는쪽]).trim()
const 받는HEAD = git(['rev-parse', 받는쪽]).trim()
const 앞뒤 = git(['rev-list', '--left-right', '--count', `${받는쪽}...${주는쪽}`]).trim().split(/\s+/)

console.log(`받는쪽 ${받는쪽}  ${받는HEAD.slice(0, 8)}`)
console.log(`주는쪽 ${주는쪽}  ${git(['rev-parse', 주는쪽]).trim().slice(0, 8)}`)
console.log(`공통 조상       ${base.slice(0, 8)}  ${base === 받는HEAD
  ? '→ **빨리감기** (받는쪽에 새 커밋 없음 · 커밋끼리는 충돌 0)'
  : '→ 진짜 병합'}`)
console.log(`앞선 커밋       ${받는쪽} ${앞뒤[0]}개 / ${주는쪽} ${앞뒤[1]}개\n`)

const WT = 작업트리(받는쪽)
if (!WT) {
  console.log(`${받는쪽} 브랜치가 어느 작업트리에도 체크아웃돼 있지 않다 — 미커밋 점검은 건너뛴다.`)
  process.exit(0)
}
console.log(`${받는쪽} 작업트리: ${WT}`)

const 바뀐것 = new Set(git(['diff', '--name-only', `${base}..${주는쪽}`]).trim().split('\n').filter(Boolean))
const 미커밋 = git(['status', '--porcelain'], WT).trim().split('\n').filter(Boolean)
  .map(l => ({ 표: l.slice(0, 2).trim(), 경로: l.slice(3).trim().replace(/^"|"$/g, '') }))

console.log(`${주는쪽} 가 고친 파일 ${바뀐것.size}개 · ${받는쪽} 미커밋 ${미커밋.length}개`)

const 겹침 = 미커밋.filter(x => 바뀐것.has(x.경로))
if (!겹침.length) {
  console.log('\n겹치는 파일 없음 — 미커밋 변경이 병합을 막지 않는다.')
  process.exit(0)
}

const 같음 = [], 자동 = [], 손으로 = [], 새파일 = []
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmerge_'))
const 우리 = path.join(tmp, 'ours'), 조상 = path.join(tmp, 'base'), 저쪽 = path.join(tmp, 'theirs')

for (const { 표, 경로 } of 겹침) {
  if (표 === '??') { 새파일.push(경로); continue }
  let 디스크, 그쪽, 원본
  try { 디스크 = 평(fs.readFileSync(path.join(WT, 경로), 'utf8')) } catch { continue }
  try { 그쪽 = 평(git(['show', `${주는쪽}:${경로}`])) } catch { continue }
  if (디스크 === 그쪽) { 같음.push(경로); continue }
  try { 원본 = 평(git(['show', `${base}:${경로}`])) } catch { 원본 = '' }

  fs.writeFileSync(우리, 디스크); fs.writeFileSync(조상, 원본); fs.writeFileSync(저쪽, 그쪽)
  const r = spawnSync('git', ['merge-file', '-p', '--diff3', 우리, 조상, 저쪽],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const 덩어리 = (r.stdout.match(/^<<<<<<< /gm) || []).length
  const 셈 = (a, b) => spawnSync('git', ['diff', '--numstat', '--no-index', a, b], { encoding: 'utf8' })
    .stdout.trim().split('\t')
  if (덩어리 === 0) 자동.push(경로)
  else 손으로.push({ 경로, 덩어리, 우리: 셈(조상, 우리), 저쪽: 셈(조상, 저쪽) })
}
fs.rmSync(tmp, { recursive: true, force: true })

const 줄임 = (a) => a.length > 6 ? `${a.slice(0, 6).join(' · ')} … 외 ${a.length - 6}개` : a.join(' · ')
console.log(`\n── 겹치는 ${겹침.length}개 ──`)
console.log(`  내용 같음 (잃을 것 없음)  ${같음.length}개   ${줄임(같음)}`)
console.log(`  자동 병합 (충돌 0)        ${자동.length}개   ${줄임(자동)}`)
console.log(`  미추적 새 파일            ${새파일.length}개   ${줄임(새파일)}`)
console.log(`  **사람이 갈라야 함**      ${손으로.length}개`)
for (const c of 손으로) {
  console.log(`     ${c.경로}\n        충돌 ${c.덩어리}덩어리  |  ${받는쪽} +${c.우리[0]}/-${c.우리[1]}  ${주는쪽} +${c.저쪽[0]}/-${c.저쪽[1]}`)
}
console.log(`\n합계 충돌 덩어리 ${손으로.reduce((s, c) => s + c.덩어리, 0)}개`)
console.log('\n※ 미커밋 변경이 남아 있으면 git 이 체크아웃을 거부한다. 그 작업트리의 세션이')
console.log('   먼저 커밋해야 하고, 남의 변경을 reset·checkout·stash·clean 으로 치우지 않는다.')
