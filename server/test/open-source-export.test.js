'use strict'
// **공개용 사본 · 제3자 고지** (사용자 결정 2026-10-07 — 「공개용 사본을 따로 뽑기」).
//
// 이 저장소의 이력에는 내부 기록(검수 원장·작업 메모·실명·기관 이메일·개인 PC 경로)이 있어 그대로
// 공개하지 않는다. `scripts/export-public.cjs` 가 공개해도 되는 파일만 이력 없이 뽑고, 새는 것을 훑는다.
//
// ── 이 시험이 가장 걱정하는 것 ─────────────────────────────────────────────
// **새로 쓴 코드에 개인 경로·이메일·키가 들어와도 아무도 모르는 것.** 공개는 한 번 하면 못 거둔다.
// 그래서 지금 공개 대상 파일 전부를 훑어 「막음」이 0 인지 매번 본다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const X = require('../../scripts/export-public.cjs')
// 뽑기는 저장소 밖 막을 낱말이 0개면 멈춘다 — 시험은 가명 하나를 넘긴다.
const 시험낱말 = X.로컬낱말규칙(['홍길순'])

test('**내부 기록은 빼고, 제품과 라이선스 파일은 담는다**', () => {
  for (const f of ['docs/audit/EVIDENCE_LEDGER.jsonl', '_loops/handoff/NOTE.md', '.claude/settings.json', 'CLAUDE.md',
    'tests/audit/x.test.cjs', 'docs/SETUP_MACBOOK.md', 'before.jpg', 'TASKS.md', 'review/findings.csv']) {
    assert.equal(X.빼나(f), true, `${f} 가 공개본에 들어간다`)
  }
  for (const f of ['src/main.jsx', 'server/index.js', 'LICENSE', 'NOTICE', 'LICENSES.md', 'THIRD-PARTY-NOTICES.md',
    'licenses/Supertonic-3-OpenRAIL-M.txt', 'docs/SYNTHETIC-VOICE-NOTICE.md', 'README.md', 'package.json']) {
    assert.equal(X.빼나(f), false, `${f} 가 공개본에서 빠진다`)
  }
})

test('**현장 운영값(site-baseline.json)은 빼고, .gitattributes 의 export-ignore 는 전부 공개본에서도 빠진다**', () => {
  // 검수 1회차 High: export-ignore 는 git archive 에만 걸려 이 스크립트(git ls-files)에는 효과가 없었다.
  assert.equal(X.빼나('server/config/site-baseline.json'), true, '운영 현장의 위치·방송 시각이 공개본에 들어간다')
  const 표시 = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').split(/\r?\n/)
    .filter((l) => /\sexport-ignore\b/.test(l) && !l.trim().startsWith('#')).map((l) => l.trim().split(/\s+/)[0])
  assert.ok(표시.length >= 2, '긍정 앵커: export-ignore 표시를 못 읽었다')
  for (const 경로 of 표시) {
    const 예 = 경로.endsWith('/') ? 경로 + 'x.txt' : 경로
    assert.equal(X.빼나(예), true, `.gitattributes 가 설치판에서 빼는 ${경로} 가 공개본에는 들어간다`)
  }
})

test('**공개 대상 파일 가운데 .gitignore 에 걸려 새 저장소에서 빠지는 것이 없다** (2026-10-07 Codex 공개판 검수 B8)', () => {
  // 이 저장소는 server/db/schema.js 를 예외로 추적하는데 .gitignore 는 server/db/ 를 통째로 막았다. 사본에는 복사됐지만
  // 사본에서 `git init && git add -A` 하면 빠져 — 공개 저장소를 받은 사람이 서버를 띄울 수 없었다(require 실패).
  const 파일들 = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean).filter((f) => !X.빼나(f))
  assert.ok(파일들.includes('server/db/schema.js'), '긍정 앵커: 서버 기동에 필요한 schema.js 가 공개 대상이다')
  let 걸림 = ''
  try {
    걸림 = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: 파일들.join('\n') }).toString('utf8').trim()
  } catch (e) { if (e.status !== 1) throw e }   // exit 1 = 걸린 것 없음
  assert.equal(걸림, '', `새 저장소에서 .gitignore 때문에 빠질 공개 파일:\n${걸림}`)
})

test('**README·개발자 안내의 링크가 공개판 안의 파일을 가리킨다** — 공개판 README 다 (2026-10-07 Codex 공개판 검수 B10)', () => {
  // README 는 AI 챌린지 제출서였다(팀 구성·체크리스트·「오픈소스 공개 예정」). 제출서는 docs/submission/ 으로 옮기고
  // 공개판에 맞는 README 를 새로 썼다. 공개판에서 빠지는 파일(제출 문서·현장 캡처·CLAUDE.md)을 가리키면 깨진 링크다.
  const 대상 = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter((f) => f && !X.빼나(f)))
  대상.add('README.md')   // 커밋 전이라도 본다
  for (const 문서 of ['README.md', 'docs/DEVELOPER.md']) {
    const 글 = fs.readFileSync(path.join(ROOT, 문서), 'utf8')
    const 링크 = [...글.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:)/.test(u))
    const 깨짐 = 링크.filter((u) => {
      const 자리 = path.posix.normalize(path.posix.join(path.posix.dirname(문서), decodeURI(u))).replace(/\/$/, '')
      return !(대상.has(자리) || [...대상].some((f) => f.startsWith(자리 + '/')))
    })
    assert.deepEqual(깨짐, [], `${문서} 가 공개판에 없는 파일을 가리킨다`)
  }
  const 공개README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  assert.match(공개README, /Apache-2\.0/, '공개판 README 에 라이선스가 없다')
  assert.match(공개README, /Open RAIL-M/, '음성 모델의 별도 조건을 README 에서 안 알린다')
  // **제출서 양식을 막던 줄을 뒤집었다**(2026-10-23 사용자 결정): 「챌린지 README 를 기본으로, 구성은 틀지 말고
  // 배포판 내용을 반영」. 그래서 이제는 제출 구성(팀·임팩트·체크리스트)을 그대로 두되 **공개판임을 밝히는지**를 본다.
  assert.match(공개README, /오픈소스\(Apache-2\.0\)로 공개한 판/, '제출서 그대로다 — 공개판이라는 머리말이 없다')
  assert.doesNotMatch(공개README, /Edge TTS\(신경망 음성 합성\)|현장은 gemini-2\.5-flash로 설정해 사용/,
    '제출 당시 사실(인터넷 음성 합성·2.5 고정)이 지금 사실처럼 남아 있다')
})

test('**git status -z 의 이름 바꾸기(두 칸)를 바로 읽는다**', () => {
  const 글 = ['R  새/이름.js', 'docs/audit/옛이름.md', ' M src/a.js', '?? b.txt'].join('\0') + '\0'
  assert.deepEqual(X.상태읽기(글), ['새/이름.js', 'docs/audit/옛이름.md', 'src/a.js', 'b.txt'])
})

// 가짜 비밀값은 **실행 중에 조립한다** — 이 시험 파일도 공개본에 들어가고 Codex 제출 전 검사도 받는다.
// 글자 그대로 두면 스캐너와 그 검사가 이 파일 자체를 「새는 것」으로 본다(2026-10-07 1회차가 그렇게 멈췄다).
const 이어 = (...xs) => xs.join('')
test('**새는 것을 잡고, 시험용 가짜 값은 잡지 않는다**', () => {
  const 막음 = (s, f) => X.훑기(s, f).filter((h) => h.종류 === '막음')
  assert.equal(막음(이어('const p = "C:', '\\', 'Users', '\\', 'Hong Gil', '\\', 'Desktop"')).length > 0, true, '개인 사용자 경로를 못 잡는다')
  const 메일 = 이어('git config user.email "someone@', 'gmail.com"')
  assert.equal(막음(메일).length > 0, true, '이메일을 못 잡는다')
  // 제3자 고지의 원저작자 이메일은 지우면 안 되는 글이다 — 그 파일에서만 이메일 규칙을 안 건다.
  assert.equal(막음(메일, 'THIRD-PARTY-NOTICES.md').length, 0, '제3자 고지의 저작권자 이메일을 막는다')
  assert.equal(막음(메일, 'licenses/onnxruntime-1.28.2-ThirdPartyNotices.txt').length, 0, '받아 둔 외부 원문의 저작권자 이메일을 막는다')
  // 제외는 **이메일 규칙만**이다 — 같은 파일이라도 개인 경로·키는 막는다.
  assert.ok(막음(이어('C:', '\\', 'Users', '\\', 'Hong Gil', '\\', 'x'), 'licenses/a.txt').length > 0, 'licenses/ 의 개인 경로를 안 막는다')
  assert.equal(막음(메일, 'src/a.js').length > 0, true, '제외가 다른 파일까지 번졌다')
  assert.equal(막음(이어('key=AI', 'zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q')).length > 0, true, '진짜 모양의 Google 키를 못 잡는다')
  assert.equal(막음(이어('-----BEGIN PRIV', 'ATE KEY-----')).length > 0, true)
  // 시험의 자리 표시·가짜 키는 막지 않는다 — 막으면 공개본을 영영 못 뽑는다.
  assert.equal(막음(이어("const 옛집 = 'C:", '\\', 'Users', '\\', 'X', '\\', "AppData'")).length, 0, '한 글자 자리 표시를 막는다')
  assert.equal(막음(이어("'AI", "zaSyTESTKEY_00000000000000000000'")).length, 0, '시험용 가짜 키를 막는다')
  assert.equal(막음('`C:\\Users\\...\\.cache`').length, 0, '생략 표시(...)를 막는다')
  // 실명·PC 사용자 이름·기관 메일 도메인은 **저장소 밖 값**(환경변수·로컬 파일)으로 받아 막는다 — 규칙에 그 낱말을
  // 적으면 공개본에 실린다(오픈소스 출시 검수 2026-10-17). 여기서는 가명으로 그 길을 확인한다.
  const 가명규칙 = X.로컬낱말규칙(['홍길순', 'example-org.or.kr'])
  assert.ok(X.훑기('| 팀장 | 홍길순 | 행정팀 |', 'docs/a.md', 가명규칙).some((h) => h.종류 === '막음'), '로컬 지정 실명을 막지 않는다')
  assert.ok(X.훑기('메일 a@EXAMPLE-ORG.or.kr', 'docs/a.md', 가명규칙).some((h) => h.종류 === '막음'), '대소문자가 다르면 놓친다')
  assert.equal(X.훑기('| 팀장 | 홍길동 |', 'docs/a.md', 가명규칙).filter((h) => h.종류 === '막음').length, 0, '지정 안 한 이름까지 막는다')
  const 옛값 = process.env.CARECAST_EXPORT_BLOCK_TERMS
  process.env.CARECAST_EXPORT_BLOCK_TERMS = '홍길순, 가나다'
  try {
    assert.ok(막음('담당: 가나다').length > 0, '환경변수로 넣은 낱말을 막지 않는다')
  } finally {
    if (옛값 === undefined) delete process.env.CARECAST_EXPORT_BLOCK_TERMS
    else process.env.CARECAST_EXPORT_BLOCK_TERMS = 옛값
  }
  // 비속어는 막는다(사용자 지시 2026-10-07). 「전원이 꺼져 있다」 같은 평범한 말은 안 막는다.
  assert.equal(막음(이어('// 사용자: "아이콘 ', String.fromCharCode(0x3144), '같아"')).length > 0, true, '비속어를 안 막는다')
  assert.equal(막음('// PC 가 꺼져 있으면 건너뛴다 · 0바이트 쓰레기 · 기준에 못 미친다').length, 0, '평범한 말을 비속어로 막는다')
  // 사설 IP 는 알리기만 한다.
  const h = X.훑기('connect("192.168.0.8")')
  assert.ok(h.length === 1 && h[0].종류 === '알림')
})

test('**지금 공개 대상 파일에 막을 것이 0 건이다** — 새 코드가 개인 경로·이메일·키를 들여오면 빨간불', () => {
  // **아직 커밋 안 된 새 파일도 훑는다**(검수 1회차 High). 추적 파일만 보면 새로 만든 파일이 커밋 전엔
  // 안 보여, verify 는 초록인데 커밋하는 순간 빨간불이 났다(THIRD-PARTY-NOTICES.md 가 그랬다 — 조용한 초록).
  const 목록 = (args) => execFileSync('git', args, { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean)
  const 파일들 = [...new Set([...목록(['ls-files', '-z']), ...목록(['ls-files', '-z', '--others', '--exclude-standard'])])]
  const 대상 = 파일들.filter((f) => !X.빼나(f))
  assert.ok(대상.length > 500, `공개 대상이 ${대상.length}개뿐이다 — 훑기가 헛돌고 있다`)
  const 걸림 = []
  for (const f of 대상) {
    let buf; try { buf = fs.readFileSync(path.join(ROOT, f)) } catch { continue }
    if (buf.subarray(0, 8000).includes(0)) continue
    for (const h of X.훑기(buf.toString('utf8'), f)) if (h.종류 === '막음') 걸림.push(`${f}:${h.줄} (${h.이름})`)
  }
  assert.deepEqual(걸림, [], '공개 대상 파일에 막을 것이 있다')
})

test('**사본의 verify 는 빠진 검수 시험을 부르지 않는다** — 저장소 package.json 은 그대로', () => {
  const 원본 = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  const j = JSON.parse(X.공개용packageJson(원본))
  assert.equal(j.scripts['test:audit'], undefined)
  assert.doesNotMatch(j.scripts.verify, /test:audit/)
  assert.match(j.scripts.verify, /test:server/, '긍정 앵커: 나머지 게이트는 그대로다')
  // 공개 저장소는 이미 사본이라 처음부터 test:audit 이 없다. 「저장소의 verify 에 test:audit 이 있다」를
  // 단언하면 공개 저장소에서 늘 빨간불이었다(출시 검수 2026-10-17). 대신 아래에서 꾸민 입력으로 확인한다.
  const 원래verify = JSON.parse(원본).scripts.verify
  if (/test:audit/.test(원래verify)) assert.notEqual(j.scripts.verify, 원래verify, '사본의 verify 가 원본 그대로다')
})

test('**공개용packageJson: test:audit 을 걷고 나머지는 그대로 둔다** — 저장소 파일과 무관하게 늘 도는 확인', () => {
  // 같은 파일을 두 번 읽어 비교하던 단언은 늘 통과했다(독립 검수 2026-10-17). 꾸민 입력으로 직접 본다.
  const 입력 = {
    name: 'x',
    scripts: { 'test:audit': 'node a', 'test:server': 'node s', verify: 'npm run lint && npm run test:server && npm run test:audit' },
    dependencies: { a: '1' },
  }
  const 입력글 = JSON.stringify(입력, null, 2)
  const j = JSON.parse(X.공개용packageJson(입력글))
  assert.equal(j.scripts['test:audit'], undefined, 'test:audit 이 남았다')
  assert.equal(j.scripts.verify, 'npm run lint && npm run test:server', 'verify 에서 test:audit 만 걷어야 한다')
  assert.equal(j.scripts['test:server'], 'node s', '다른 스크립트를 건드렸다')
  assert.deepEqual(j.dependencies, 입력.dependencies, '의존성을 건드렸다')
  assert.equal(입력글, JSON.stringify(입력, null, 2), '입력 글이 바뀌었다')
})

test('**저장소 밖 막을 낱말이 0개면 뽑기가 멈춘다** — 조용히 「막음 0건」으로 통과하지 않는다 (독립 검수 2026-10-17)', () => {
  const 대상 = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-pub-'))
  try {
    assert.throws(() => X.뽑기(대상, { 파일들: ['LICENSE'], 변경: [], 로컬규칙: [] }), /막을 낱말.*0개/)
    assert.equal(fs.readdirSync(대상).length, 0, '멈추기 전에 파일을 썼다')
    const r = X.뽑기(대상, { 파일들: ['LICENSE'], 변경: [], 로컬규칙: [], 로컬낱말없어도: true })
    assert.match(r.보고, /저장소 밖 막을 낱말: 0개 \(경고/, '보고서에 경고가 없다')
  } finally { fs.rmSync(대상, { recursive: true, force: true }) }
})

test('**사본 전체(보고서 포함)에 막을 것이 없다 · 저장소 안의 「..이름」 폴더는 밖이 아니다** (Codex 2회차)', () => {
  // High: 보고서가 원본 PC 의 절대 경로(사용자 이름 포함)를 공개 사본에 다시 적었다 — 복사 대상만 훑었다.
  const 대상 = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-pub-'))
  try {
    X.뽑기(대상, { 파일들: ['LICENSE', 'NOTICE'], 변경: [], 로컬규칙: 시험낱말 })
    const 걸림 = []
    const 돌기 = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name)
        if (e.isDirectory()) { 돌기(f); continue }
        for (const h of X.훑기(fs.readFileSync(f, 'utf8'), path.relative(대상, f).replace(/\\/g, '/'))) if (h.종류 === '막음') 걸림.push(`${e.name}:${h.줄} ${h.이름}`)
      }
    }
    돌기(대상)
    // 이 PC 의 저장소 경로 자체도 보고서에 없어야 한다(사용자 이름이 그 안에 있다).
    const 보고 = fs.readFileSync(path.join(대상, 'PUBLIC-EXPORT-REPORT.txt'), 'utf8')
    assert.ok(!보고.includes(ROOT), '보고서에 원본 저장소의 절대 경로가 있다')
    assert.deepEqual(걸림, [], '공개 사본(보고서 포함)에 막을 것이 있다')
  } finally { fs.rmSync(대상, { recursive: true, force: true }) }
  // Medium: `startsWith('..')` 가 저장소 안의 `..public` 폴더를 「밖」으로 쳤다.
  assert.throws(() => X.뽑기(path.join(ROOT, '..public'), { 파일들: ['LICENSE'], 변경: [], 로컬규칙: 시험낱말 }), /저장소 밖/)
  assert.ok(!fs.existsSync(path.join(ROOT, '..public')), '저장소 안에 폴더를 만들었다')
})

test('**뽑기: 저장소 밖 빈 폴더에만 · 커밋 안 된 변경이 있으면 멈춘다 · 보고서를 남긴다**', () => {
  const 대상 = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-pub-'))
  const 파일들 = ['LICENSE', 'NOTICE', 'package.json', 'docs/audit/PROGRESS.md', 'src/lib/licenseNotice.js']
  try {
    const 로컬규칙 = 시험낱말
    assert.throws(() => X.뽑기(대상, { 파일들, 변경: ['LICENSE'], 로컬규칙 }), /커밋 안 된 변경/)
    assert.throws(() => X.뽑기(path.join(ROOT, 'tmp-pub'), { 파일들, 변경: [], 로컬규칙 }), /저장소 밖/)
    const r = X.뽑기(대상, { 파일들, 변경: [], 로컬규칙 })
    assert.equal(r.복사, 4)
    assert.ok(fs.existsSync(path.join(대상, 'LICENSE')))
    assert.ok(!fs.existsSync(path.join(대상, 'docs/audit/PROGRESS.md')), '내부 기록이 사본에 들어갔다')
    assert.match(fs.readFileSync(path.join(대상, 'PUBLIC-EXPORT-REPORT.txt'), 'utf8'), /\[막음\] 0건/)
    assert.throws(() => X.뽑기(대상, { 파일들, 변경: [], 로컬규칙 }), /비어 있지 않습니다/, '이미 찬 폴더에 덮어쓴다')
  } finally { fs.rmSync(대상, { recursive: true, force: true }) }
})

test('**THIRD-PARTY-NOTICES.md 가 배포에 드는 부품을 전부 적는다** — 잠금파일이 바뀌면 다시 만들어야 한다', () => {
  const 글 = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  const 빠짐 = []
  for (const 잠금 of ['package-lock.json', 'server/package-lock.json']) {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 잠금), 'utf8'))
    for (const [경로, v] of Object.entries(lock.packages || {})) {
      if (!경로 || v.dev || v.devOptional) continue
      const name = v.name || 경로.slice(경로.lastIndexOf('node_modules/') + 'node_modules/'.length)
      if (!글.includes(`## ${name}@${v.version} `)) 빠짐.push(`${name}@${v.version}`)
    }
  }
  assert.deepEqual(빠짐, [], 'THIRD-PARTY-NOTICES.md 에 빠진 부품이 있다 — npm run notices')
  assert.match(글, /## react@\S+ — MIT/, '긍정 앵커: 화면 부품(React)의 고지가 있다')

  // ── 이름만 있고 고지 전문이 없는 칸이 없다 (Codex 2회차 Medium) ──────────────────
  // LICENSE 파일이 없는 부품(cookie-signature·qrcode-generator)이 「MIT」 이름만 남았다. MIT 는 저작권
  // 고지와 이용허락 문구를 **함께 넣는 것**이 조건이다. 이 PC 에 설치 안 된 것(다른 OS 전용 등)만 예외로
  // 그렇다고 적힌다.
  // 칸 제목은 `## 이름@판 — 라이선스` 모양뿐이다. 전문 안의 `## ISC License`(node-cron) 같은 줄로 나누지 않는다.
  const 칸들 = 글.split(/\n## (?=\S+@\S+ — )/).slice(1)
  assert.ok(칸들.length > 50, '긍정 앵커: 칸을 못 나눴다')
  const 전문없음 = 칸들.filter((c) => !/설치돼 있지 않아/.test(c) && !/copyright|permission is hereby granted|licensed under/i.test(c))
    .map((c) => c.split('\n')[0])
  assert.deepEqual(전문없음, [], '저작권·이용허락 문구 없이 이름만 남은 부품이 있다')
  for (const 이름 of ['cookie-signature', 'qrcode-generator']) {
    const c = 칸들.find((x) => x.startsWith(이름 + '@'))
    assert.ok(c && /Permission is hereby granted/.test(c), `${이름} 에 MIT 이용허락 전문이 없다`)
  }
})

test('**고지 본문이 라이선스 이름과 맞는다 · 요약 한 줄·다른 라이선스는 실패 · 필수 부품은 전문이 있다** (Codex 3회차)', () => {
  const T = require('../../scripts/third-party-notices.cjs')
  // 경계 사례 — 3회차가 재현한 것들. 자동 추출이 이것들을 성공으로 넘겼다.
  assert.equal(T.맞는가('MIT', 'MIT'), false, 'README 의 License 절이 「MIT」 한 줄뿐인데 통과한다')
  assert.equal(T.맞는가('MIT', 'Copyright (c) X\nRedistribution and use in source and binary forms'), false, 'MIT 이름에 BSD 본문이 통과한다')
  assert.equal(T.맞는가('MIT', 'Permission is hereby granted, free of charge'), false, '저작권 줄 없는 MIT 가 통과한다')
  assert.equal(T.맞는가('Apache-2.0', 'Apache-2.0'), false, '이름만 있는 Apache 가 통과한다')
  assert.equal(T.맞는가('MIT', 'Copyright (c) 2012 X\nPermission is hereby granted, free of charge, …'), true)

  const 글 = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  const 칸들 = 글.split(/\n## (?=\S+@\S+ — )/).slice(1)
  const 어긋남 = 칸들.filter((c) => {
    const [, license] = c.split('\n')[0].split(' — ')
    return T.맞는가(license, c) === false
  }).map((c) => c.split('\n')[0])
  assert.deepEqual(어긋남, [], '라이선스 이름과 본문이 맞지 않는 칸이 있다')
  // 설치 안 된 것으로 넘어가는 칸이 없다 — 필수 부품(sherpa-onnx)은 원문을 저장소 licenses/ 에 받아 두었다.
  assert.ok(!/설치돼 있지 않아/.test(글), '전문 없이 「설치돼 있지 않아」로 남은 칸이 있다')
  const sherpa = 칸들.find((c) => c.startsWith('sherpa-onnx-win-x64@'))
  assert.ok(sherpa && /Microsoft Corporation/.test(sherpa), '플랫폼 꾸러미에 든 ONNX Runtime(MIT) 고지가 없다')
  for (const 표 of Object.values(T.확인한원문)) {
    for (const f of 표.저장소파일 || []) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} 가 저장소에 없다`)
  }
})

test('**확인한 원문은 해시로 고정된다 — 잘리거나 바뀌면 생성이 실패한다** (Codex 5회차)', () => {
  const T = require('../../scripts/third-party-notices.cjs')
  // 5회차: cookie-signature 고지를 41줄에서 잘라 **마지막 문장이 빠졌는데** 낱말 검사는 통과했다.
  const 글 = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  const cookie = 글.split(/\n## (?=\S+@\S+ — )/).find((c) => c.startsWith('cookie-signature@'))
  assert.match(cookie, /SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE\./, 'cookie-signature 고지의 마지막 문장이 빠졌다')

  for (const [열쇠, 표] of Object.entries(T.확인한원문)) {
    assert.match(표.sha256 || '', /^[0-9a-f]{64}$/, `${열쇠} 의 확인한 원문에 해시가 없다 — 내용이 바뀌어도 모른다`)
  }
  // 원문이 한 글자라도 다르면 실패한다 — 잘림·저작권자 삭제·다른 라이선스 선언 모두 같은 길로 잡힌다.
  const 표 = T.확인한원문['qrcode-generator@2.0.4']
  const 원문 = 'Copyright (c) 2009 Kazuhiko Arase\nLicensed under the MIT license'
  assert.equal(T.원문맞나(표, 원문), false, '해시가 다른 원문을 받아들인다')
  assert.equal(T.원문맞나({ ...표, sha256: require('node:crypto').createHash('sha256').update(원문).digest('hex') }, 원문), true)
})

test('**등록된 부품은 LICENSE 파일이 따로 있어도 확인한 원문·해시를 쓴다** (Codex 6회차)', () => {
  const T = require('../../scripts/third-party-notices.cjs')
  // 6회차: 등록된 부품 폴더에 (잘린) LICENSE 가 생기면 그것을 먼저 읽어 해시 검증을 건너뛰었다.
  const 폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast-tpn-'))
  try {
    const 진짜 = fs.readFileSync(path.join(ROOT, 'server/node_modules/cookie-signature/Readme.md'), 'utf8')
    const 잘린 = 진짜.replace(/\r\n/g, '\n').split('\n').slice(20, 41).join('\n')   // 21~41줄 — 마지막 문장 없음
    fs.writeFileSync(path.join(폴더, 'LICENSE'), 잘린)
    fs.writeFileSync(path.join(폴더, 'Readme.md'), 진짜)
    const 고름 = T.고지글고르기('cookie-signature@1.0.7', 폴더)
    assert.equal(고름.원문다름, false, '등록 원문(Readme.md 21~42줄)은 그대로인데 다르다고 한다')
    assert.match(고름.text, /SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE\./, 'LICENSE 파일(잘린 것)을 썼다 — 등록 원문을 건너뛰었다')
    // 등록 원문까지 바뀌면 다르다고 한다 — 생성이 실패한다.
    fs.writeFileSync(path.join(폴더, 'Readme.md'), 진짜.replace('LearnBoost', 'Someone'))
    assert.equal(T.고지글고르기('cookie-signature@1.0.7', 폴더).원문다름, true, '저작권자가 바뀐 원문을 받아들인다')
  } finally { fs.rmSync(폴더, { recursive: true, force: true }) }
})

test('**CC BY 4.0 은 라이선스 원문으로 가는 링크로 그린다** (Codex 2회차 Medium)', () => {
  const { 출처들 } = require('../../src/lib/dataCredits.js')
  const om = 출처들.find((s) => /Open-Meteo/.test(s.기관))
  assert.equal(om.조건링크, 'https://creativecommons.org/licenses/by/4.0/')
  for (const p of ['src/components/shared/DataCredits.jsx', 'src/components/admin/sections/DataCreditsPage.jsx',
    'src/components/admin/sections/LicenseNoticePage.jsx']) {
    const 코드 = fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    assert.match(코드, /s\.조건링크/, `${p} 가 라이선스 링크를 안 그린다`)
  }
})
