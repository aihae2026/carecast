#!/usr/bin/env node
/**
 * **라이선스를 세는 법을 한 곳에 둔다** (제출 §4.2).
 *
 * 쓰는 법: `node scripts/measure-licenses.cjs`
 *
 * ── 왜 스크립트로 두나 (V③ UI-0915-R6 지적) ─────────────────────────────────
 * 처음에는 세어 본 결과만 문서에 적었다. 검수관이 **같은 수가 안 나온다**고 했다 —
 * 그쪽은 잠금파일 기준으로 280개(이름@판본)를 셌고 나는 설치 폴더 기준으로 213개
 * (이름)를 셌다. **둘 다 맞다. 세는 단위가 달랐을 뿐이다.**
 * 그래서 **세는 법을 코드로 못 박는다** — 숫자만 적으면 다음 사람이 다시 못 맞춘다.
 *
 * ── 세는 단위 ──────────────────────────────────────────────────────────────
 *  · 대상은 **실제로 설치된 것**(`node_modules`)이다. 잠금파일이 아니다 — 잠금파일에는
 *    이 플랫폼에서 안 깔리는 것(다른 OS 용 바이너리)이 들어 있다.
 *  · **이름 기준**으로 센다. 같은 패키지의 판본이 둘이면 한 번 센다 — 라이선스를 묻는
 *    자리라서 그렇다(같은 패키지는 판본이 달라도 라이선스가 같다).
 *    판본까지 갈라 세면 수가 커지지만 **답이 달라지지는 않는다.**
 *  · **런타임**은 `dependencies` 만 따라간 전이 폐쇄다. 그것이 제품이 실제로 부르는 것이다.
 */
'use strict'

const fs = require('node:fs')
const p = require('node:path')

const ROOT = p.join(__dirname, '..')
const 뿌리들 = ['node_modules', p.join('server', 'node_modules')]

function 읽기(이름) {
  for (const b of 뿌리들) {
    const f = p.join(ROOT, b, 이름, 'package.json')
    if (fs.existsSync(f)) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
  }
  return null
}
const 라이선스 = (j) => {
  let l = j.license
  if (!l && Array.isArray(j.licenses)) l = j.licenses.map(x => x.type || x).join(' OR ')
  if (l && typeof l === 'object') l = l.type
  return l || '(명시 없음)'
}

// ── 설치된 것 전부 ──────────────────────────────────────────────────────────
const 설치됨 = new Map()
function 훑기(base) {
  if (!fs.existsSync(base)) return
  for (const n of fs.readdirSync(base)) {
    if (n === '.bin') continue
    if (n.startsWith('@')) { 훑기(p.join(base, n)); continue }
    const f = p.join(base, n, 'package.json')
    if (!fs.existsSync(f)) continue
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      const k = j.name || n
      if (!설치됨.has(k)) 설치됨.set(k, 라이선스(j))
    } catch { /* 깨진 package.json 은 건너뛴다 */ }
  }
}
for (const b of 뿌리들) 훑기(p.join(ROOT, b))

// ── 제품이 실제로 부르는 것 ────────────────────────────────────────────────
const 런타임뿌리 = []
for (const pkg of ['package.json', p.join('server', 'package.json')]) {
  const j = JSON.parse(fs.readFileSync(p.join(ROOT, pkg), 'utf8'))
  런타임뿌리.push(...Object.keys(j.dependencies || {}))
}
const 런타임 = new Map()
const 큐 = [...new Set(런타임뿌리)]
while (큐.length) {
  const n = 큐.shift()
  if (런타임.has(n)) continue
  const j = 읽기(n)
  if (!j) { 런타임.set(n, '(못 찾음)'); continue }
  런타임.set(n, 라이선스(j))
  for (const d of Object.keys(j.dependencies || {})) 큐.push(d)
}

const 세기 = (m) => {
  const c = new Map()
  for (const [, l] of m) c.set(l, (c.get(l) || 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])
}

console.log('# 라이선스 집계')
console.log(`뽑은 때: ${new Date().toISOString()}`)
console.log('세는 단위: **설치된 것**(node_modules) · **이름 기준**(판본 중복 제거)')
console.log('')
console.log(`## 설치된 것 전부 — ${설치됨.size} 개`)
세기(설치됨).forEach(([l, c]) => console.log(`  ${String(c).padStart(4)}  ${l}`))
console.log('')
console.log(`## 제품이 실제로 부르는 것 (dependencies 전이 폐쇄) — ${런타임.size} 개`)
세기(런타임).forEach(([l, c]) => console.log(`  ${String(c).padStart(4)}  ${l}`))
const 특이 = [...런타임].filter(([, l]) => !['MIT', 'ISC'].includes(l))
console.log(`  MIT·ISC 가 아닌 것: ${특이.length === 0 ? '없음' : ''}`)
특이.forEach(([k, l]) => console.log(`      ${l}  ${k}`))
console.log('')
console.log('## 만들 때만 쓰는 것 중 **조건이 붙는 것**')
for (const [k, l] of 설치됨) {
  if (런타임.has(k)) continue
  if (['MPL-2.0', 'CC-BY-4.0', 'GPL-3.0', 'LGPL-3.0', 'AGPL-3.0'].includes(l)) {
    console.log(`  ${l.padEnd(12)} ${k}`)
  }
}
console.log('')
console.log('## 조심해서 읽을 것')
console.log('  · **「배포물에 없다」와 「현장 PC 에 없다」는 다른 말이다.**')
console.log('    현장은 `npm install`(--production 아님) 뒤 `npm run build` 를 돈다')
console.log('    (`server/services/autoUpdate.js`). 그래서 **빌드 도구도 현장 디스크에 깔린다.**')
console.log('    없는 것은 **브라우저로 나가는 번들**(`dist/`)이다.')
console.log('  · 판본까지 갈라 세면 수가 커진다(같은 패키지의 판본 둘). 라이선스는 같으므로')
console.log('    **답은 안 바뀐다.** 잠금파일 기준으로 세면 또 다른 수가 나온다 —')
console.log('    거기엔 이 플랫폼에서 안 깔리는 것이 들어 있다.')
