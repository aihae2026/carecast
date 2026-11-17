#!/usr/bin/env node
/**
 * **공개용 사본을 뽑는다** (사용자 결정 2026-10-07 — 「공개용 사본을 따로 뽑기」).
 *
 * 쓰는 법: `npm run export:public -- <새 폴더>`
 *          (= `node scripts/export-public.cjs <새 폴더>`) — 폴더는 저장소 **밖**, 비어 있거나 없어야 한다.
 *
 * ── 왜 사본인가 ──────────────────────────────────────────────────────────────
 * 이 저장소의 **이력**에는 검수 원장(명령 전문·개인 PC 경로)·작업 메모·실명·기관 이메일이 들어 있다.
 * 지금 파일에서 지워도 이력에는 남아, 저장소를 그대로 공개하면 다 보인다. 이력을 고쳐 쓰는 것은
 * 되돌릴 수 없는 일이라 하지 않는다. 대신 **공개해도 되는 파일만 골라 이력 없는 새 폴더로** 뽑는다.
 * 그 폴더를 새 저장소로 올리는 것(git init·push)은 **사람이 한다** — 이 스크립트는 하지 않는다.
 *
 * ── 하는 일 ──────────────────────────────────────────────────────────────────
 *  1. `git ls-files`(추적 파일만 — `.env`·`*.db` 는 애초에 없다)에서 `빼는것` 을 뺀다.
 *  2. 복사한 사본의 글을 `막는것` 으로 훑는다. **하나라도 걸리면 exit 1** — 공개하면 안 되는 것.
 *     `알리는것` 은 막지 않고 보고만 한다(사설 IP·기관 이름처럼 판단이 필요한 것).
 *  3. 사본의 package.json 에서 `test:audit`(빠진 검수 폴더를 도는 시험)을 걷는다 — 공개본의 verify 가
 *     없는 폴더를 찾다 실패하지 않게. 저장소의 package.json 은 그대로다.
 *  4. 빠진 폴더를 읽는 서버 시험을 보고한다 — 공개본에서는 그 시험이 깨질 수 있다.
 *
 * 저장소에는 **아무것도 쓰지 않는다**(읽기만). 보고는 화면과 사본의 `PUBLIC-EXPORT-REPORT.txt`.
 */
'use strict'

const fs = require('node:fs')
const p = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = p.join(__dirname, '..')

// ── 공개본에서 빼는 것 — 내부 작업 기록 ─────────────────────────────────────
// 이 저장소를 만드는 **과정**의 기록이지 제품이 아니다. 개인 PC 경로·명령 전문·실명·기관 이메일이 섞여 있다.
const 빼는것 = [
  /^docs\/audit\//, /^_loops\//, /^review\//, /^\.claude\//, /^\.ai\//, /^tests\/audit\//,
  /^docs\/submission\//, /^docs\/journal\//, /^docs\/archive\//, /^docs\/superpowers\//,
  /^docs\/HANDOFF_[^/]*\.md$/, /^docs\/LOOP_TASK\.md$/,
  /^docs\/SETUP_MACBOOK\.md$/,            // 개발자 개인 PC 세팅(기관 이메일)
  /^docs\/ui-ux-requirements\.md$/,       // 사용자 피드백 원문 경로·내부 진행표
  /^(HANDOFF|TASKS|REPORT|TECH_DEBT|BASELINE|ROLLBACK|CLAUDE|AGENTS)\.md$/,
  /^(before|main)\.jpg$/,                 // 현장 화면 캡처
  // 운영 현장 값(위치·방송 시각·문안) — `make-site-baseline.cjs` 머리말: 「공개로 전환할 때는 반드시
  // 이 파일을 제외할 것」. 없어도 개발·verify 는 돈다(같은 머리말). `.gitattributes` 의 export-ignore 는
  // git archive 에만 걸려 여기서는 효과가 없다 — 그래서 아래에 따로 적고, 시험이 두 목록을 대조한다.
  /^server\/config\/site-baseline\.json$/,
  /^docs\/audit\/sandbox\//,
]
const 빼나 = (f) => 빼는것.some((re) => re.test(f))

// ── 걸리면 공개하지 않는다 ───────────────────────────────────────────────────
// **규칙 글자를 이 파일에 그대로 쓰지 않는다**(Codex·Claude 검수 1회차, 2026-10-07). 이 파일도 공개 대상이라
// 그대로 쓰면 스캐너가 **자기 소스에 걸리고**, Codex 제출 전 민감정보 검사도 이 줄을 진짜 비밀로 보고 멈춘다.
// 그래서 조각을 이어 만든다. `제외` 는 그 규칙을 적용하지 않는 파일이다.
const 조각 = (...xs) => new RegExp(xs.join(''), 'i')
const 막는것 = [
  // 한 글자(`C:\Users\X\…`)는 시험의 자리 표시라 뺀다 — 실제 사용자 이름은 두 글자 이상이다.
  { 이름: '개인 PC 사용자 경로', re: /[A-Za-z]:[\\/]+Users[\\/]+(?!\.\.\.|Public\b|<|\$|%)[^\\/\s"'`]{2,}/ },
  // 실명·PC 사용자 이름·기관 메일 도메인처럼 **그 자체가 개인정보인 낱말**은 이 파일에 적지 않는다(조각으로 나눠도
  // 이어 붙이면 읽힌다 — 오픈소스 출시 검수 2026-10-17). 저장소 밖 값으로 받는다 → 아래 `로컬낱말규칙`.
  // 비속어·욕설 (사용자 지시 2026-10-07 「주석에 비속어나 욕설 들어가 있는지 확인」). 사용자 말을 인용한 주석에
  // 섞여 들어왔다(아이콘에 대한 한마디). 낱말은 조각·글자 코드로 — 이 파일 자체가 걸리지 않게. 「꺼져」(전원이 꺼져 있다)처럼
  // 평범한 말과 겹치는 것은 넣지 않는다.
  { 이름: '비속어', re: new RegExp(['씨' + '발', '시' + '발', 'ㅅ' + 'ㅂ', 'ㅆ' + 'ㅂ', 'ㅂ' + 'ㅅ', '\\u3144', '병' + '신', '븅' + '신',
    '개' + '새', '새' + '끼', String.fromCharCode(0xC886), '존' + '나', '지' + '랄', '미친' + '놈', '미친' + '년', '또' + '라이', '염' + '병',
    'f' + 'uck', 's' + 'hit\\b', 'b' + 'itch'].join('|'), 'i') },
  // 제3자 라이선스 전문의 저작권자 이메일은 **지우면 안 되는 고지**다 — 그 생성 파일은 이 규칙에서 뺀다.
  // 기관 자체 메일 도메인은 `로컬낱말규칙` 으로 넣는다(여기 적으면 도메인이 공개된다).
  { 이름: '개인 이메일', re: 조각('[A-Za-z0-9._%+-]+@(?:gm', 'ail\\.com|naver\\.com|daum\\.net|hanmail\\.net)'),
    // licenses/ 는 받아 둔 외부 원문(ONNX Runtime 제3자 고지 등)이라 같은 이유로 뺀다(Codex 3회차 뒤).
    제외: (f) => f === 'THIRD-PARTY-NOTICES.md' || f.startsWith('licenses/') },
  { 이름: 'Google API 키 모양', re: new RegExp('AI' + 'za(?![0-9A-Za-z_-]*(?:TEST|OTHER|DUMMY|FAKE|EXAMPLE))[0-9A-Za-z_-]{35}') },
  { 이름: 'GitHub 토큰', re: new RegExp('gh[pousr]' + '_[0-9A-Za-z]{30,}') },
  { 이름: 'Anthropic·OpenAI 키', re: new RegExp('s' + 'k-(?:ant-)?[0-9A-Za-z_-]{30,}') },
  { 이름: 'Slack 토큰', re: new RegExp('xo' + 'x[abpr]-[0-9A-Za-z-]{10,}') },
  { 이름: '개인 키 블록', re: new RegExp('-----BEGIN (?:RSA |EC |OPENSSH )?PRIV' + 'ATE KEY-----') },
]
// ── 알리기만 한다 — 사람이 판단한다 ──────────────────────────────────────────
const 알리는것 = [
  { 이름: '사설 IP(공유기 안쪽 주소)', re: /\b192\.168\.\d{1,3}\.\d{1,3}\b/ },
]

// ── 저장소 밖에서 받는 막을 낱말 ─────────────────────────────────────────────
// 실명·PC 사용자 이름·기관 메일 도메인 같은 것. 규칙에 그 낱말을 적는 순간 공개본에 그 낱말이 실리므로
// **저장소에 두지 않는다.** 둘 중 아무 데나 한 줄에 하나씩(쉼표도 됨) 적는다:
//   · 환경변수 `CARECAST_EXPORT_BLOCK_TERMS`
//   · `scripts/export-public.local.txt` (.gitignore 에 올라 있다 — 커밋되지 않는다)
// 대소문자는 가리지 않고 글자 그대로 찾는다(정규식 아님). `#` 으로 시작하는 줄은 주석이다.
const 로컬낱말파일 = p.join(__dirname, 'export-public.local.txt')
function 로컬낱말() {
  let 글 = process.env.CARECAST_EXPORT_BLOCK_TERMS || ''
  try { 글 += '\n' + fs.readFileSync(로컬낱말파일, 'utf8') } catch { /* 없으면 환경변수만 */ }
  return [...new Set(글.split(/[\r\n,]+/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')))]
}
const 정규식글자 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function 로컬낱말규칙(낱말들 = 로컬낱말()) {
  return 낱말들.map((w) => ({ 이름: '로컬 지정 낱말(실명·사용자 이름·기관 도메인 등)', re: new RegExp(정규식글자(w), 'i') }))
}

/** 글 하나를 훑는다 → [{ 종류: '막음'|'알림', 이름, 줄, 글 }]. `파일` 은 규칙별 제외를 볼 때 쓴다. */
function 훑기(글, 파일 = '', 로컬규칙 = 로컬낱말규칙()) {
  const 결과 = []
  const 줄들 = 글.split(/\r?\n/)
  const 규칙들 = [...막는것, ...로컬규칙].filter((r) => !(r.제외 && r.제외(파일)))
  줄들.forEach((줄, i) => {
    for (const r of 규칙들) if (r.re.test(줄)) 결과.push({ 종류: '막음', 이름: r.이름, 줄: i + 1, 글: 줄.trim().slice(0, 160) })
    for (const r of 알리는것) if (r.re.test(줄)) 결과.push({ 종류: '알림', 이름: r.이름, 줄: i + 1, 글: 줄.trim().slice(0, 160) })
  })
  return 결과
}

const 글파일인가 = (buf) => !buf.subarray(0, 8000).includes(0)

function 커밋() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString('utf8').trim() } catch { return '(모름)' }
}

function 추적파일() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  return out.toString('utf8').split('\0').filter(Boolean)
}

/** 사본의 package.json — 빠진 검수 시험을 verify 에서 걷는다. */
function 공개용packageJson(글) {
  const j = JSON.parse(글)
  if (j.scripts) {
    delete j.scripts['test:audit']
    if (j.scripts.verify) j.scripts.verify = j.scripts.verify.replace(/\s*&&\s*npm run test:audit\b/, '')
  }
  return JSON.stringify(j, null, 2) + '\n'
}

/**
 * 공개본에 들어갈 경로 중 **커밋 안 된 변경**. 추적 파일만 복사하므로 새로 만든 파일(예: LICENSE)은
 * 커밋 전엔 빠지고, 고친 파일은 커밋 안 된 내용이 실린다 — 어느 쪽이든 「어느 판인가」를 말할 수 없다.
 * (`package-release.cjs` 도 같은 이유로 멈춘다.) 내부 기록 폴더의 변경은 공개본과 무관해 센다지 않는다.
 */
function 커밋안된것() {
  const out = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  return 상태읽기(out.toString('utf8')).filter((f) => !빼나(f))
}

/**
 * `git status --porcelain -z` → 경로들. **이름 바꾸기·복사(R·C)는 두 칸**이다: `XY 새경로\0옛경로\0` —
 * 둘째 칸에는 XY 접두가 없다(검수 1회차 Low: 일괄 `slice(3)` 이 옛 경로 앞 세 글자를 잘랐다).
 */
function 상태읽기(글) {
  const 칸 = 글.split('\0').filter(Boolean)
  const 경로 = []
  for (let i = 0; i < 칸.length; i++) {
    const xy = 칸[i].slice(0, 2)
    경로.push(칸[i].slice(3))
    if (/[RC]/.test(xy)) { if (칸[i + 1]) 경로.push(칸[i + 1]); i++ }
  }
  return 경로.filter(Boolean)
}

// 로컬 낱말이 하나도 없으면 멈춘다. 예전에는 실명 등을 저장소 안 규칙이 늘 막았는데, 저장소 밖으로 옮긴 뒤로는
// 그 값을 안 넣은 PC 에서 「막음 0건」으로 조용히 통과했다(독립 검수 2026-10-17). 정말 없어도 되는 경우만
// `--allow-no-local-terms`(함수는 `로컬낱말없어도: true`)로 넘긴다.
const 로컬낱말없음안내 = '저장소 밖 막을 낱말(실명·PC 사용자 이름·기관 메일 도메인)이 0개입니다.\n'
  + '  scripts/export-public.local.txt 에 한 줄에 하나씩 적거나 환경변수 CARECAST_EXPORT_BLOCK_TERMS 로 넣으세요.\n'
  + '  정말 막을 낱말이 없으면 --allow-no-local-terms 를 붙여 다시 실행하세요.'

function 뽑기(대상, { 파일들 = 추적파일(), 변경 = 커밋안된것(), 로컬규칙 = 로컬낱말규칙(), 로컬낱말없어도 = false } = {}) {
  if (!로컬규칙.length && !로컬낱말없어도) throw new Error(로컬낱말없음안내)
  if (변경.length) {
    throw new Error(`커밋 안 된 변경이 ${변경.length}개 있습니다 — 커밋한 뒤 다시 뽑으세요(새 파일은 커밋 전엔 빠집니다):\n  `
      + 변경.slice(0, 20).join('\n  ') + (변경.length > 20 ? `\n  … 외 ${변경.length - 20}개` : ''))
  }
  const 절대 = p.resolve(대상)
  const 상대 = p.relative(ROOT, 절대)
  // `..` 로 **시작하는 이름**(`..public`)은 저장소 안 폴더다 — 부모로 올라가는 것은 `..` 자체이거나 `..\` 로
  // 시작할 때뿐이다(Codex 2회차 Medium). 다른 드라이브면 relative 가 절대 경로를 돌려준다.
  const 밖이다 = 상대 === '..' || 상대.startsWith('..' + p.sep) || 상대.startsWith('../') || p.isAbsolute(상대)
  if (!밖이다) throw new Error(`대상은 저장소 밖이어야 합니다: ${절대}`)
  if (fs.existsSync(절대) && fs.readdirSync(절대).length) throw new Error(`대상 폴더가 비어 있지 않습니다: ${절대}`)

  const 담을것 = 파일들.filter((f) => !빼나(f))
  const 걸림 = []
  let 복사 = 0
  for (const f of 담을것) {
    const src = p.join(ROOT, f)
    if (!fs.existsSync(src)) continue   // 추적되지만 지금 지워진 파일
    let buf = fs.readFileSync(src)
    if (f === 'package.json') buf = Buffer.from(공개용packageJson(buf.toString('utf8')))
    if (글파일인가(buf)) for (const h of 훑기(buf.toString('utf8'), f, 로컬규칙)) 걸림.push({ 파일: f, ...h })
    const dst = p.join(절대, f)
    fs.mkdirSync(p.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, buf)
    복사++
  }

  // 빠진 폴더를 읽는 서버 시험 — 공개본에서 깨질 수 있다.
  const 깨질시험 = 담을것.filter((f) => /^server\/test\/.*\.test\.js$/.test(f)).filter((f) => {
    try { return /docs\/audit|\.claude\/|_loops|tests\/audit|site-baseline\.json/.test(fs.readFileSync(p.join(ROOT, f), 'utf8')) } catch { return false }
  })

  const 막음 = 걸림.filter((x) => x.종류 === '막음')
  const 알림 = 걸림.filter((x) => x.종류 === '알림')
  const 보고 = [
    `CareCast 공개용 사본 — ${new Date().toISOString()}`,
    // 원본 **경로**는 적지 않는다 — 이 보고서도 공개 사본에 들어가고, 경로에 PC 사용자 이름이 있다(Codex 2회차 High).
    `원본 커밋: ${커밋()} (git 추적 ${파일들.length}개 중 ${복사}개 복사, ${파일들.length - 담을것.length}개는 내부 기록이라 뺌)`,
    // 낱말 자체는 적지 않는다 — 이 보고서도 공개 사본에 들어간다. 개수만 적는다.
    `저장소 밖 막을 낱말: ${로컬규칙.length}개${로컬규칙.length ? '' : ' (경고: 실명·사용자 이름·기관 도메인을 검사하지 않았습니다)'}`,
    '',
    `[막음] ${막음.length}건 — 0 이 아니면 공개하지 마세요`,
    ...막음.map((x) => `  ${x.파일}:${x.줄}  (${x.이름})  ${x.글}`),
    '',
    `[알림] ${알림.length}건 — 공개해도 되는지 사람이 판단`,
    ...알림.map((x) => `  ${x.파일}:${x.줄}  (${x.이름})  ${x.글}`),
    '',
    `[공개본에서 깨질 수 있는 시험] ${깨질시험.length}개 — 빠진 내부 폴더를 읽는다`,
    ...깨질시험.map((f) => `  ${f}`),
    '',
    '다음: 이 폴더에서 git init → 새 저장소로 push 는 사람이 합니다. 운영 DB·.env 는 들어 있지 않습니다(추적 파일만 복사).',
  ].join('\n')
  fs.writeFileSync(p.join(절대, 'PUBLIC-EXPORT-REPORT.txt'), 보고 + '\n')
  // 보고서도 사본의 일부다 — **만든 뒤 같은 규칙으로 다시 훑는다**. 걸리면 막음에 더한다.
  for (const h of 훑기(보고, 'PUBLIC-EXPORT-REPORT.txt', 로컬규칙)) if (h.종류 === '막음') 막음.push({ 파일: 'PUBLIC-EXPORT-REPORT.txt', ...h })
  return { 복사, 뺌: 파일들.length - 담을것.length, 막음, 알림, 깨질시험, 보고 }
}

if (require.main === module) {
  const 인자 = process.argv.slice(2)
  const 로컬낱말없어도 = 인자.includes('--allow-no-local-terms')
  const 대상 = 인자.find((a) => !a.startsWith('--'))
  if (!대상) { console.error('쓰는 법: npm run export:public -- <저장소 밖의 새 폴더> [--allow-no-local-terms]'); process.exit(2) }
  try {
    const r = 뽑기(대상, { 로컬낱말없어도 })
    console.log(r.보고)
    process.exit(r.막음.length ? 1 : 0)
  } catch (e) { console.error(e.message); process.exit(2) }
}

module.exports = { 빼나, 훑기, 공개용packageJson, 뽑기, 빼는것, 상태읽기, 로컬낱말규칙 }
