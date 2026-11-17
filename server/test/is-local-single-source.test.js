// "이 창이 현장(메인) PC에서 열렸는가" 판정은 한 곳에서만 만든다 (2026-09-02)
//
// 왜: 이 값은 **소리를 낼 창을 고르는 데** 쓰인다. 갈라지면 아무 데서도 안 나거나 겹쳐
// 난다 — src/lib/tabId.js 머리말에 그 사고가 적혀 있고, 서버가 소리 담당을 정하게 바꾼
// 것도 같은 이유였다.
//
// 실제로 갈라져 있었다. 2026-09-01에 App.jsx를 쪼개며 `src/lib/isLocal.js`를 만들었지만
// **입주자가 둘뿐**이었고, MusicPlayer·YouTubeBGM·InstantBroadcast(한 파일 안에서 두 번)는
// 각자 같은 식을 들고 있었다. 담당 판정은 새 파일, 실제 재생 게이트는 옛 사본을 보는
// 상태였다 — 한쪽만 고치면 소리가 죽는다. 2026-09-02에 넷을 모두 합쳤다.
//
// 같은 날 같은 종류의 사고를 하나 더 겪었다: 정지 신호를 수동 재생기만 듣고 방송 재생기는
// 안 들어서, 정지를 눌러도 음악이 계속 흘렀다. **"같은 일을 하는 둘이 갈라져 있는 것"**이
// 이 저장소에서 반복되는 실패 유형이다. 그래서 규칙을 주석이 아니라 여기에 둔다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'src')
const ALLOWED = 'lib/isLocal.js'

/** src/ 아래 모든 .js/.jsx 파일 경로(SRC 기준 상대, 슬래시 통일) */
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name)) out.push(path.relative(SRC, p).split(path.sep).join('/'))
  }
  return out
}

test('현장 PC 판정을 스스로 만드는 사본이 없다 — 갈라지면 소리가 죽는다', () => {
  // 판정식 그 자체만 찾는다. `window.location.hostname`을 주소 만드는 데 쓰는 곳
  // (InstantBroadcast의 HTTPS 안내 등)은 정상이므로 걸면 안 된다.
  const RE = /\[\s*'localhost'\s*,\s*'127\.0\.0\.1'\s*\]\s*\.includes\(\s*window\.location\.hostname\s*\)/

  const offenders = []
  for (const rel of walk(SRC)) {
    if (rel === ALLOWED) continue
    if (RE.test(fs.readFileSync(path.join(SRC, rel), 'utf8'))) offenders.push(rel)
  }
  assert.deepEqual(offenders, [],
    `현장 PC 판정 사본이 남아 있다 — ${ALLOWED}에서 가져다 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('단일 출처 파일은 그대로 있고 실제로 그 판정을 내놓는다', () => {
  const src = fs.readFileSync(path.join(SRC, ALLOWED), 'utf8')
  assert.match(src, /export const _IS_LOCAL/,
    '단일 출처가 값을 안 내보낸다 — 위 가드가 통과해도 아무도 못 쓴다')
  assert.match(src, /window\.location\.hostname/,
    '단일 출처가 판정을 안 한다 — 껍데기만 남았다')
})
