// 다른 기관이 따라 할 수 있는 상태인가 (2026-09-04).
//
// 본선 심사의 '임팩트' 항목이 **"다른 기관의 활용을 돕는 설명이나 가이드가 마련되어
// 있는가"**를 본다. 가이드는 사람이 읽는 것이라 대부분 기계가 못 채점하지만,
// **틀렸다는 것만은 기계가 잡을 수 있다** — 없는 파일을 안내하거나, 코드와 다른
// 포트를 적거나, 실행하면 글자가 깨지는 설치 파일을 남겨 두는 것.
//
// 다른 기관 사람은 막히면 물어볼 데가 없다. 그래서 여기서 거른다:
//  1. 설치 파일이 실행됐을 때 글자가 안 깨진다 (bat이 chcp 65001과 짝이 맞는 UTF-8이다)
//  2. 가이드가 가리키는 파일이 실재한다 (없는 파일을 안내하지 않는다)
//  3. 가이드가 적은 숫자가 코드와 같다 (포트·의존)
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT  = path.join(__dirname, '..', '..')
const GUIDE = path.join(ROOT, 'docs', 'ADOPT.md')
const read  = (p) => fs.readFileSync(p, 'utf8')

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'backups', 'db'])
function walk(dir, hit = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), hit)
    } else if (e.name.toLowerCase().endsWith('.bat')) {
      hit.push(path.join(dir, e.name))
    }
  }
  return hit
}

test('설치 파일이 실행될 때 글자가 안 깨진다 — bat은 UTF-8이다', () => {
  const bats = walk(ROOT)
  assert.ok(bats.length > 0, 'bat을 하나도 못 찾았다 — 검사가 헐거워졌다')
  const broken = []
  for (const p of bats) {
    const buf = fs.readFileSync(p)
    // UTF-8로 읽었다가 다시 UTF-8로 적었을 때 바이트가 같은가. CP949(완성형)로 저장된
    // 한글은 여기서 U+FFFD가 되어 되돌아오지 않는다. 순수 ASCII는 통과한다.
    if (Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) !== 0) {
      broken.push(path.relative(ROOT, p))
    }
  }
  assert.deepEqual(broken, [],
    `bat이 UTF-8이 아니다(${broken.join(' ')}) — 이 저장소의 bat은 전부 첫 줄에서 `
    + '`chcp 65001`로 콘솔을 UTF-8로 바꾼다. 파일이 CP949면 실행하는 사람은 '
    + '`��ġ`처럼 깨진 글자를 본다. 다른 기관이 처음 만나는 화면이 그것이면 안 된다')
})

// 저장소에는 없지만 **설치 bat이 현장 PC에 만들어 주는** 파일. 없다고 실패시키면 안 되지만,
// 그냥 통과시키면 옛 install.bat 사고(없는 파일을 안내)가 이 구멍으로 되돌아온다.
// 그래서 "설치 bat이 진짜로 이 이름을 만드는가"를 대신 확인한다(바로 아래 테스트).
const GENERATED_AT_INSTALL = new Set(['carecast-start.bat'])

test('가이드가 가리키는 파일이 실재한다', () => {
  const md = read(GUIDE)
  // 백틱 안에서 확장자가 붙은 것만 본다. `<현장 백업.db>`처럼 자리표시자가 든 것과
  // `npm run build`처럼 명령인 것은 건너뛴다.
  const tokens = [...new Set([...md.matchAll(/`([^`\n]+)`/g)].map(m => m[1].trim()))]
  const missing = []
  for (const t of tokens) {
    if (/[<>*…\s]/.test(t)) continue
    if (!/\.(bat|md|js|cjs|jsx|json|css|html|py)$/i.test(t)) continue
    if (GENERATED_AT_INSTALL.has(t)) continue
    if (!fs.existsSync(path.join(ROOT, t))) missing.push(t)
  }
  assert.deepEqual(missing, [],
    `가이드가 없는 파일을 가리킨다(${missing.join(' ')}) — 따라 하는 사람은 여기서 막히고 `
    + '물어볼 데가 없다. 옛 install.bat이 존재하지 않는 시작 파일을 안내하던 것과 같은 실패다')
})

test('가이드가 말하는 "설치가 만드는 파일"을 설치 bat이 실제로 만든다', () => {
  const bat = read(path.join(ROOT, 'CareCast-설치.bat'))
  const md  = read(GUIDE)
  const 어긋남 = []
  for (const name of GENERATED_AT_INSTALL) {
    if (!md.includes(name)) continue          // 가이드가 더 이상 안 쓰면 볼 것도 없다
    if (!bat.includes(name)) 어긋남.push(name)
  }
  assert.deepEqual(어긋남, [],
    `가이드는 ${어긋남.join(' ')}을(를) 안내하는데 설치 bat이 그 이름을 만들지 않는다 — `
    + '저장소에 없는 파일이라 "가리키는 파일이 실재한다" 검사도 못 잡는 자리다')
})

test('가이드가 적은 숫자가 코드와 같다', () => {
  const md = read(GUIDE)
  // 2026-09-16 에 포트가 `포트읽기('CARECAST_PORT', 3001)` 이 됐다(격리 사본을 띄워
  // 재 보려고 연 환경변수 — 기본값은 그대로 3001 이다). **지키는 사실은 그대로**라
  // 「기본값」을 집도록 정규식만 넓힌다.
  const port = /const HTTP_PORT\s*=\s*(?:[^(\n]*\(\s*[^,\n]+,\s*)?(\d+)/.exec(read(path.join(ROOT, 'server', 'index.js')))
  assert.ok(port, 'server/index.js에서 포트를 못 찾았다')
  assert.ok(md.includes(port[1]),
    `가이드에 서버 포트(${port[1]})가 없거나 다르다 — 접속 주소가 틀리면 아무것도 안 된다`)

  // 안내 음성은 Supertonic 3 모델에 기댄다(2026-09-21). 가이드가 모델 받는 명령을 안 적으면
  // 소스로 띄운 PC 에서 설치는 되는데 좋은 목소리가 안 난다(가장 찾기 어려운 실패다).
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
  assert.ok(pkg.scripts['setup:tts'], 'package.json 에 setup:tts 가 없다 — 이 검사의 전제가 바뀌었다')
  assert.match(md, /setup:tts/, '가이드에 안내 음성 모델 받는 명령(npm run setup:tts)이 없다')
  assert.doesNotMatch(md, /edge-tts/, '가이드가 걷어낸 옛 음성 합성을 아직 적고 있다')
})

test('가이드가 설치 파일을 실제 이름으로 안내한다', () => {
  const md = read(GUIDE)
  const installer = fs.readdirSync(ROOT).find(f => f.endsWith('.bat') && f.includes('설치') && !f.includes('개발'))
  assert.ok(installer, '현장용 설치 bat을 못 찾았다')
  assert.ok(md.includes(installer),
    `가이드가 실제 설치 파일(${installer})을 안 가리킨다`)
})

// ── 합성 음성 고지 (사용자 지시 2026-09-22: 「배포시 기관들이 알 수 있도록 고지해」) ────────────
// 안내 음성 모델 라이선스(OpenRAIL-M (e))가 기계 생성임을 밝히라고 한다. 설치하는 기관이 해야 할 일이라
// 도입 가이드 · 설치판 안내문 · 설치판 필수 목록에서 빠지면 안 된다.
test('합성 음성 고지 — 도입 가이드·설치판 안내문·게시문 견본이 함께 간다', () => {
  const 견본 = path.join(ROOT, 'docs', 'SYNTHETIC-VOICE-NOTICE.md')
  assert.ok(fs.existsSync(견본), '게시문 견본이 없다')
  assert.match(read(견본), /합성 음성입니다/)
  assert.match(read(GUIDE), /합성 음성 고지[\s\S]*SYNTHETIC-VOICE-NOTICE\.md/, '도입 가이드 4-1 에 고지가 없다')
  const pkg = read(path.join(ROOT, 'scripts', 'package-release.cjs'))
  assert.match(pkg, /'docs\/SYNTHETIC-VOICE-NOTICE\.md'/, '설치판 필수 목록에 견본이 없다')
  assert.match(pkg, /설치한 기관이 꼭 할 일/, '설치판 안내문(릴리스정보)에 고지가 없다')
  assert.match(read(path.join(ROOT, 'docs', 'adopt-published.html')), /합성 음성 고지/, '공개용 가이드에 고지가 없다')
})
