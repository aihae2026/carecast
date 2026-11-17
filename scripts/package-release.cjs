'use strict'
// **배포·제출용 압축을 만든다** — `npm run package` (2026-09-16).
//
// ── 왜 필요했나 ────────────────────────────────────────────────────────────
// 주최측 요구: *"누구든지 다운받아 설치가 가능한 상태의 파일들을 압축해서 올리고
// readme.md 에 그 압축파일 링크를 추가"*. 그전까지 이 저장소에는 포장 단계가 없었고,
// 설치 bat 은 `git pull` 로 시작해서 **내려받은 폴더에서는 첫 단계에 막혔다**
// (2026-09-16 에 고쳤다 — `scripts/patch-installer-nogit.cjs` 의 머리말).
//
// ── 무엇을 담나 ────────────────────────────────────────────────────────────
// **`git archive HEAD`** 를 쓴다. 곧 **커밋된 것만** 담긴다는 뜻이고, 이게 핵심이다:
//   · `.gitignore` 에 걸린 것(운영 DB·`server/.env`·음원·`node_modules`·`dist`)이
//     **자동으로 빠진다.** 목록을 손으로 적으면 언젠가 하나를 빠뜨린다.
//   · 받는 사람이 **저장소와 같은지 확인할 수 있다** — 커밋 하나에 대응한다.
//
// 그 위에 `.gitattributes` 의 `export-ignore` 로 두 가지를 더 뺀다(이유는 거기 적었다):
//   · `server/config/site-baseline.json` — **운영 현장 값**이다. 남의 PC 에 심으면
//     환기방송 예약 6건과 현장 좌표가 따라간다(`docs/PACKAGING.md` §2).
//   · `docs/audit/sandbox/` — 검수하다 남은 임시 출력이다.
//
// ── **이름이 고정이다** (사용자 지적 2026-09-16) ────────────────────────────
// *"내가 dev 파일을 패키지 만들고 나서도 수정하면 그게 패키지에 반영할 수 있도록"*
//
// 앞 판은 `carecast-20260916-605e7f05.zip` 처럼 **날짜와 커밋을 이름에 박았다.**
// 그러면 고칠 때마다 이름이 바뀌고, **README 에 적어 둔 링크가 죽는다.** 제출한 뒤에
// 한 줄만 고쳐도 링크를 다시 고쳐야 한다는 뜻이다 — 그러다 한 번 빠뜨리면 심사위원이
// **옛 판을 받는다.**
//
// 그래서 파일 이름은 `carecast.zip` **하나**다. 다시 만들어 같은 이름으로 덮어 올리면
// 링크는 그대로 산다. **판본은 이름이 아니라 압축 안에서 말한다**(아래 `릴리스정보.txt`) —
// 받은 사람이 «내가 받은 것이 어느 판인가» 를 열어 보고 알 수 있다.
//
// ── 무엇을 확인하나 ────────────────────────────────────────────────────────
// 압축을 만든 뒤 **그 안을 다시 열어** 본다. "뺐다"는 말을 믿지 않는다(CLAUDE.md).
//   1) 들어가면 안 되는 것이 정말 없는가 (DB·.env·음원·키 파일)
//   2) 설치에 필요한 것이 정말 있는가 (설치 bat·package.json·server·src)
// 하나라도 어긋나면 **압축 파일을 지우고 실패로 끝낸다** — 반쯤 맞는 산출물을 남기면
// 다음 사람이 그걸 올린다.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const 나가는곳 = path.join(ROOT, 'release')

/**
 * 폴더를 통째로 옮겨 담는다.
 *
 * **없으면 그냥 지나간다** — 런타임을 아직 안 받았거나 `dist` 를 아직 안 만든 상태에서도
 * 포장 자체는 돌아야 한다. 정말 있어야 하는 것은 아래 `필수` 목록이 따로 본다
 * (여기서 던지면 «무엇이 없어서 실패했나» 가 두 곳에서 갈린다).
 */
function 복사(원본, 사본) {
  if (!fs.existsSync(원본)) return false
  fs.cpSync(원본, 사본, { recursive: true })
  return true
}

/**
 * 화면을 **담는 커밋의 사본(`폴더`) 안에서** 새로 빌드한다(2026-09-26 Codex 검수 Medium 둘).
 *
 * 처음엔 남아 있던 `dist` 를 그대로 담아, 옛 커밋에서 빌드한 화면이 새 서버와 새 커밋 번호를 달고 나갔다.
 * 그다음 판은 작업 트리에서 빌드했는데, `--dirty` 로 만들면 **미커밋 화면**이 HEAD 서버와 섞였다
 * (안내는 「미커밋 변경은 안 들어간다」고 하면서). 그래서 git archive 로 풀어 둔 바로 그 사본을 빌드한다 —
 * 서버와 화면이 언제나 같은 커밋이다. 그 사본은 `release/` 아래(저장소 안)라 node_modules 를 위쪽에서 찾는다
 * (2026-09-26 실측: HEAD 사본에서 vite build exit 0).
 * npm 을 거치지 않고 node 로 vite 를 바로 부른다 — Windows 에서 npm.cmd 는 셸이 필요하다.
 */
function 화면빌드(폴더) {
  console.log('화면을 새로 빌드합니다(담는 커밋의 사본에서 vite build)…')
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    { cwd: 폴더, stdio: 'inherit' })
}

/**
 * 폴더를 zip 으로 만든다.
 *
 * `git archive` 로 바로 못 만드는 이유: **폴더를 통째로 못 넣는다**(`--add-file` 은
 * 파일 하나씩, 그것도 맨 위에 놓인다). 그래서 한 번 펴고 여기서 다시 압축한다.
 *
 * PowerShell 의 `Compress-Archive` 가 아니라 **.NET 을 직접 부른다** — 수백 MB·수만 개
 * 파일에서 `Compress-Archive` 는 몇 분씩 걸린다(파일마다 파이프라인을 태운다).
 */
function 압축(폴더, 나올파일) {
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `[System.IO.Compression.ZipFile]::CreateFromDirectory(`,
    `'${폴더.replace(/'/g, "''")}',`,
    `'${나올파일.replace(/'/g, "''")}',`,
    // `Optimal` — 받는 사람의 내려받기 시간이 압축 시간보다 비싸다.
    // 마지막 인자 `$true` 는 «폴더 이름을 압축 안에 한 겹 더 만든다» 는 뜻이다.
    `[System.IO.Compression.CompressionLevel]::Optimal, $true)`,
  ].join(' ')
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' })
}

/** zip 을 폴더로 편다 — 위 `압축()` 과 같은 이유로 .NET 을 직접 부른다. */
function 펴기(zip, 나갈곳) {
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    '[System.IO.Compression.ZipFile]::ExtractToDirectory(',
    `'${zip.replace(/'/g, "''")}',`,
    `'${나갈곳.replace(/'/g, "''")}')`,
  ].join(' ')
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' })
}

/**
 * 압축 안의 **파일 이름에서 역슬래시를 슬래시로** 바꾼다.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────
 * ZIP 규격은 경로 구분자가 **슬래시**다. 그런데 PowerShell 5.1 이 쓰는 .NET Framework
 * 의 `ZipFile.CreateFromDirectory` 는 Windows 에서 **역슬래시**로 적는다(.NET Core 에서
 * 고쳐졌지만 이 PC 에는 PowerShell 7 이 없다).
 *
 * 윈도우 탐색기는 그걸 알아서 풀어 주지만, **다른 도구는 아니다** — `unzip` 은 경고를
 * 내고, 도구에 따라 `carecast\server\index.js` 라는 **이름 하나짜리 파일**을 만든다.
 * 심사위원이 어떤 도구로 풀지 우리가 못 정하므로, 규격대로 고쳐 둔다.
 *
 * ── 왜 이렇게 고치나 ──────────────────────────────────────────────────────
 * 역슬래시(0x5C)와 슬래시(0x2F)는 **한 바이트씩**이라 이름 길이가 안 바뀐다. 그래서
 * 파일 안의 어떤 위치값도 안 흔들린다 — zip 을 다시 만들 필요 없이 **이름 칸의 바이트만**
 * 바꾸면 된다. zip 인코더를 새로 쓰는 것보다 훨씬 덜 위험하다.
 *
 * 이름은 두 곳에 적혀 있고 **둘 다** 고쳐야 한다: 파일마다 붙는 지역 머리(0x04034b50)와
 * 끝의 중앙목록(0x02014b50). 한쪽만 고치면 도구에 따라 다르게 보인다.
 */
function 경로구분자고치기(파일) {
  const buf = fs.readFileSync(파일)
  const BS = 0x5c, FS_ = 0x2f
  let 바꾼수 = 0

  const 이름칸고치기 = (시작, 길이) => {
    for (let i = 시작; i < 시작 + 길이; i++) {
      if (buf[i] === BS) { buf[i] = FS_; 바꾼수++ }
    }
  }

  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip 의 중앙목록을 못 찾았다')

  const 개수 = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < 개수; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('중앙목록 항목이 깨졌다')
    const 이름길이 = buf.readUInt16LE(p + 28)
    const 여분길이 = buf.readUInt16LE(p + 30)
    const 주석길이 = buf.readUInt16LE(p + 32)
    const 지역위치 = buf.readUInt32LE(p + 42)

    이름칸고치기(p + 46, 이름길이)

    // 지역 머리 쪽도 같이 — 한쪽만 고치면 도구마다 다르게 읽는다.
    if (buf.readUInt32LE(지역위치) !== 0x04034b50) throw new Error('지역 머리가 깨졌다')
    이름칸고치기(지역위치 + 30, buf.readUInt16LE(지역위치 + 26))

    p += 46 + 이름길이 + 여분길이 + 주석길이
  }

  fs.writeFileSync(파일, buf)
  return 바꾼수
}

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

// ── 들어가면 안 되는 것 ────────────────────────────────────────────────────
// 「있으면 안 되는 것」만 적는다. 모양으로 거르므로 새 파일이 생겨도 걸린다.
// `.env.example` 같은 **빈 서식**은 설치하는 사람에게 필요하다. 다만 **이름만 믿지
// 않는다** — 아래 `서식이비었나()` 가 값이 실제로 비었는지 확인하고, 한 줄이라도 값이
// 들어 있으면 그때는 금지 목록에 걸린 것과 똑같이 실패시킨다.
const 서식이름 = /(^|\/)\.env\.(example|sample|template)$/i

const 금지 = [
  { 이름: '데이터베이스', 규칙: /\.db(-wal|-shm)?$/i },
  { 이름: '환경변수 파일', 규칙: (p) => /(^|\/)\.env($|\.)/i.test(p) && !서식이름.test(p) },
  { 이름: '음원·동영상', 규칙: /(^|\/)server\/public\/audio\//i },
  { 이름: '운영 현장 기초값', 규칙: /site-baseline\.json$/i },
  { 이름: '검수 임시 출력', 규칙: /(^|\/)docs\/audit\/sandbox\//i },
  // **`server/node_modules` 는 일부러 담는다**(2026-09-16) — 그것이 있어야 설치 bat 이
  // `npm install`(5~15분)을 건너뛴다. 막는 것은 **맨 위의 것**이다: 빌드 도구까지 들어
  // 수백 MB 가 되고, 설치판은 빌드를 안 하므로 쓸 일이 없다.
  { 이름: '맨 위 node_modules(빌드 도구)', 규칙: (p) => /^node_modules\//i.test(p) },
]

// ── 없으면 설치가 안 되는 것 ───────────────────────────────────────────────
const 필수 = [
  'package.json',
  'CareCast-설치.bat',
  'server/index.js',
  'src/main.jsx',
  'vite.config.js',
  'docs/MANUAL-USER.md',
  'docs/MANUAL-ADMIN.md',
  // 판본을 말해 주는 한 장. 없으면 받은 사람이 «어느 판인가» 를 알 길이 없다.
  '릴리스정보.txt',
  // **함께 담은 런타임** — 이것이 빠지면 「설치 파일」이 아니라 다시 소스 배포가 된다.
  // 담는 코드가 있어도 실제로 안 들어갈 수 있으니(캐시가 비었거나 복사가 실패하거나)
  // 여기서 결과를 본다.
  'runtime/node/node.exe',
  'runtime/python/python.exe',
  // **안내 음성 모델** (사용자 결정 2026-09-21: 설치판에 담는다 — 인터넷 없는 현장). 없으면 먼저
  // `npm run setup:tts` 를 돌린다. 모델 가중치는 OpenRAIL-M(사용 제한 조항) — 고지는 LICENSES.md.
  // 모델 파일 **일곱 개 전부**(하나라도 빠지면 적재가 실패한다 — 목록은 합성 프로세스가 쓰는 정본에서 가져온다).
  ...Object.values(require('../server/services/ttsEngines/supertonicWorker').모델파일)
    .map((f) => `server/tts-models/supertonic-3/${f}`),
  'server/node_modules/sherpa-onnx-node/package.json',
  'LICENSES.md',
  // **공개 라이선스 묶음** (사용자 지시 2026-10-07) — Apache-2.0 은 「복사본에 LICENSE·NOTICE 를 함께」,
  // Open RAIL-M 은 「다시 나눠 줄 때 전문을 함께」를 조건으로 건다. 하나라도 빠지면 그 조건을 어긴 배포다.
  'LICENSE',
  'NOTICE',
  'THIRD-PARTY-NOTICES.md',
  'licenses/Supertonic-3-OpenRAIL-M.txt',
  // **GPL-3.0 전문** — server/node_modules 의 sherpa-onnx 실행 파일에 espeak-ng(GPL-3.0)가 들어 있어, 그것을 담은 설치판을
  // 나눠 줄 때는 전문을 함께 담아야 한다(LICENSES.md 2-1절, 검수 c6 지적 7). gnu.org 원문과 같은 바이트(sha256 3972dc97…).
  'licenses/GPL-3.0.txt',
  // 합성 음성 고지 게시문 견본 — 설치하는 기관이 **해야 할 일**이라 설치판에 반드시 함께 간다(사용자 지시 2026-09-22).
  'docs/SYNTHETIC-VOICE-NOTICE.md',
  // 화면과 서버 꾸러미 — 이것이 있어야 설치 bat 이 npm·빌드를 건너뛴다.
  'dist/index.html',
]

// 역슬래시 한 글자. **이스케이프로 적지 않는다** — 이 저장소는 셸·도구를 거치며
// 역슬래시가 먹혀 조용히 실패한 적이 여러 번이다(CLAUDE.md). 글자 코드로 만든다.
const 역슬래시 = String.fromCharCode(92)

function 사람이읽는크기(바이트) {
  return `${(바이트 / 1024 / 1024).toFixed(1)} MB`
}

// ── 압축 안의 이름을 읽는다 — **바깥 도구를 쓰지 않는다** ──────────────────
// `tar`·`unzip` 이 깔려 있는지는 PC 마다 다르다. 확인이 도구 유무에 걸리면, 없는 PC 에서
// 검사를 건너뛰고 **통과한 것처럼 보이게** 된다. zip 의 중앙목록은 직접 읽으면 된다.
function zip목록(파일) {
  const buf = fs.readFileSync(파일)
  // 끝에서 EOCD(0x06054b50)를 찾는다. 주석이 붙을 수 있어 뒤에서 훑는다.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip 의 중앙목록을 못 찾았다 — 압축이 깨졌다')
  const 개수 = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const 이름들 = []
  for (let i = 0; i < 개수; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('중앙목록 항목이 깨졌다')
    const 이름길이 = buf.readUInt16LE(p + 28)
    const 여분길이 = buf.readUInt16LE(p + 30)
    const 주석길이 = buf.readUInt16LE(p + 32)
    // **경로 구분자를 `/` 로 통일한다.** .NET 의 `ZipFile.CreateFromDirectory` 는
    // Windows 에서 **역슬래시**로 적는다(`carecast\server\index.js`). git archive 는
    // 슬래시로 적는다. 둘을 섞어 두면 아래 금지·필수 대조가 **조용히 다 어긋난다** —
    // 실제로 「설치에 필요한 것이 없다」가 아홉 줄 났고, 파일은 멀쩡히 들어 있었다.
    이름들.push(buf.toString('utf8', p + 46, p + 46 + 이름길이).split(역슬래시).join('/'))
    p += 46 + 이름길이 + 여분길이 + 주석길이
  }
  return 이름들
}

function main() {
  // 1) 어디를 담는지 분명히 한다. 미커밋 변경은 **안 담긴다** — 그 사실을 먼저 알린다.
  const sha = git('rev-parse', '--short=8', 'HEAD')
  const 가지 = git('rev-parse', '--abbrev-ref', 'HEAD')
  const 더러움 = git('status', '--porcelain')
  console.log(`포장 대상: ${가지} @ ${sha}`)

  // ── **제출용은 `main` 이다** (사용자 물음 2026-09-16) ─────────────────────
  // *"메인 기준으로 하는거야? DEV 기준으로 하는거야?"*
  //
  // 담는 것은 **지금 체크아웃돼 있는 가지**다. 그 사실이 안 보이면 **dev 판을 제출용으로
  // 올리는 일**이 생긴다. main 은 현장 PC 가 실제로 돌리는, 이미 검증된 코드다.
  // 막지는 않는다 — dev 판을 미리 만들어 시험하는 것은 정당하고, 어느 가지인지는
  // `릴리스정보.txt` 에도 적힌다.
  if (가지 !== 'main') {
    console.log('')
    console.log(`⚠ 지금 「${가지}」 가지를 담습니다 — 현장에 아직 안 간 코드입니다.`)
    console.log('  제출용 압축은 main 에서 만드세요(현장이 실제로 돌리는, 검증된 코드).')
  }

  // ── **미커밋이 있으면 멈춘다** ──────────────────────────────────────────
  // `git archive` 는 **커밋된 것만** 담는다. 고치기만 하고 커밋을 안 한 채 포장하면
  // **옛 코드가 담긴 압축을 새것인 줄 알고 올리게 된다** — 열어 보기 전에는 모른다.
  // 앞 판은 경고만 하고 만들어 줬는데, 그것은 이 파일이 세운 원칙
  // (*"반쯤 맞는 산출물을 남기지 않는다"*)과 어긋난다.
  if (더러움) {
    console.log('')
    console.log('⚠ 커밋 안 된 변경이 있습니다 — 압축에는 안 들어갑니다:')
    for (const 줄 of 더러움.split('\n').slice(0, 20)) console.log(`   ${줄}`)
    if (!process.argv.includes('--dirty')) {
      console.log('')
      console.log('멈췄습니다. 고친 것을 담으려면 먼저 커밋하세요.')
      console.log('(고친 것 없이 옛 판 그대로 만들려면: npm run package -- --dirty)')
      process.exit(1)
    }
    console.log('\n  --dirty 를 주셔서 그대로 만듭니다. 위 변경은 안 들어갑니다.\n')
  }

  fs.mkdirSync(나가는곳, { recursive: true })
  // **이름은 바뀌지 않는다**(위 머리말). 판본은 압축 안의 `릴리스정보.txt` 가 말한다.
  const 파일 = path.join(나가는곳, 'carecast.zip')
  if (fs.existsSync(파일)) fs.rmSync(파일)

  // ── **런타임을 함께 담는다** (사용자 지시 2026-09-16) ─────────────────────
  // *"그냥 깔끔하게 설치 인스톨 파일처럼 하면 안돼?"* · *"파이썬도 묶어"*
  //
  // 앞 판은 **소스 한 벌**이었다. 받는 쪽이 Node 를 깔고 `npm install`(5~15분) 과 빌드를
  // 직접 해야 했다 — 그건 「설치 파일」이 아니라 「소스 배포」다.
  //
  // 이제 Node 와 파이썬(+numpy)을 **고정 판본으로** 함께 담는다. 받는 쪽은
  // 압축을 풀고 bat 하나를 누르면 된다. 판본을 고정하는 이유는 `런타임.cjs` 머리말에.
  //
  // **안내 음성은 이 PC 안에서 만든다**(2026-09-21 — Supertonic 3 모델을 함께 담는다). 인터넷이 쓰이는 곳은
  // 날씨·미세먼지·AI 문안과, 기관이 키를 넣었을 때의 Azure 음성(선택)뿐이다. 받아쓰기 모델(460MB)은 안 담는다.
  const { 런타임경로, 준비 } = require('./runtime.cjs')
  const 런타임 = 준비()

  // 받은 사람이 «어느 판인가» 를 알 수 있게 한 장 넣는다. 압축 밖에 두면 같이 안 간다.
  const 날짜 = new Date().toISOString().slice(0, 10)
  const 정보 = [
    'CareCast 설치판',
    '',
    `만든 날: ${날짜}`,
    `대응 커밋: ${sha} (${가지})`,
    `함께 담긴 것: Node.js ${런타임.node판} · Python ${런타임.python판}(numpy 포함) · 안내 음성 모델 Supertonic 3`,
    '',
    '설치하는 법: 이 폴더의 「CareCast-설치.bat」 을 한 번 실행하세요.',
    '  Node 도 파이썬도 따로 안 깔아도 됩니다 — 함께 들어 있습니다.',
    '',
    '인터넷이 없어도 안내 음성은 나갑니다 — 이 PC 안에서 목소리를 만듭니다(Supertonic 3).',
    '인터넷이 쓰이는 곳: 날씨·미세먼지·AI 문안, 그리고 키를 넣었을 때의 Azure 음성(선택).',
    '  · 안내 음성 모델의 이용 조건(OpenRAIL-M — 동의 없는 사칭·기계 생성 미고지·의료 조언 등 금지)은 LICENSES.md 에 있습니다',
    '',
    '【설치한 기관이 꼭 할 일】 안내 방송이 컴퓨터가 만든 합성 음성이라는 것을 이용자에게 알려 주세요.',
    '  게시문 견본: docs/SYNTHETIC-VOICE-NOTICE.md — 방송을 듣는 어르신이 알아볼 수 있게 스피커 근처·게시판에 붙이세요.',
    '  (모델 라이선스의 이용 조건입니다. 의료 조언 방송과 동의 없는 사칭도 금지입니다.)',
    '  · 자막 받아쓰기는 여기 안 들어 있습니다(약 460MB) — 필요하면',
    '    초기 설정의 「준비물」 화면에서 단추 하나로 받습니다. 없어도 방송은 나갑니다',
    '',
    '들어 있지 않은 것(일부러 뺐습니다):',
    '  · 데이터베이스 · API 키 · 음원 — 설치한 PC 에서 새로 만들거나 화면에서 넣습니다',
    '  · 운영 현장 설정값 — 그 시설의 방송 시각·예약이라 남의 PC 에 심으면 안 됩니다',
    '',
  ].join('\n')

  // ── **소스는 git 에서, 런타임은 받아 둔 것에서** ──────────────────────────
  // `git archive` 로 바로 zip 을 만들면 **폴더 통째로는 못 넣는다**(`--add-file` 은
  // 파일 하나씩, 그것도 맨 위에 놓인다). 그래서 한 번 펴고 다시 압축한다.
  // **「커밋된 것만」이라는 보증은 그대로다** — 소스는 여전히 `git archive` 가 낸다.
  // **폴더 이름을 ASCII 로 둔다.** `_짐` 으로 했다가 `tar` 가 status 128 로 죽었다 —
  // Windows 의 bsdtar 는 한글 경로에서 갈린다. 이 저장소가 배치 파일에서 겪은 것과
  // 같은 계열(글자 인코딩이 도구 경계를 못 넘는다)이라, 임시 경로는 ASCII 로 쓴다.
  const 짐터 = path.join(나가는곳, '_stage')
  fs.rmSync(짐터, { recursive: true, force: true })
  fs.mkdirSync(짐터, { recursive: true })
  const 뿌리 = path.join(짐터, 'carecast')

  // **`tar` 를 안 쓴다.** 처음엔 썼다가 status 128 로 죽었다 — Windows 기본 `tar`(bsdtar)와
  // Git Bash 의 `tar`(GNU)가 **다른 프로그램**이고, Node 가 부를 때 잡히는 것이 셸에서
  // 치는 것과 달랐다. 이 파일은 이미 같은 이유로 zip 목록도 손수 읽는다
  // (「바깥 도구를 쓰지 않는다」) — 여기서도 .NET 을 직접 부른다.
  const 임시zip = path.join(나가는곳, '_src.zip')
  git('archive', '--format=zip', '--worktree-attributes', '--prefix=carecast/', '-o', 임시zip, 'HEAD')
  펴기(임시zip, 짐터)
  fs.rmSync(임시zip)

  fs.writeFileSync(path.join(뿌리, '릴리스정보.txt'), 정보, 'utf8')
  // **런타임 폴더의 받은 압축 원본(node.zip·py.zip 등)은 안 담는다** (2026-09-17 밤, 설치 파일 97MB).
  // runtime.cjs 가 그 압축을 풀어 node/·python/ 을 만든 뒤에도 원본이 캐시 맨 위에 남아, 설치 파일에 약 47MB 가 딸려 갔다.
  // 실행에 쓰는 것은 푼 폴더뿐이다. **맨 위 칸의 .zip 만** 거른다 — python/ 안의 python312.zip(표준 라이브러리)은 반드시 담는다.
  fs.cpSync(런타임경로(), path.join(뿌리, 'runtime'), {
    recursive: true,
    filter: (원본) => !(path.dirname(원본) === 런타임경로() && /\.zip$/i.test(원본)),
  })

  // **화면과 서버 꾸러미도 담는다** — 이것이 있어야 설치 bat 이 npm·빌드를 건너뛴다.
  화면빌드(뿌리)   // 뿌리/dist 가 생긴다 — 작업 트리의 dist 는 담지 않는다
  // 빌드가 사본 맨 위에 node_modules/.vite(개발용 HTTPS 인증서 캐시)를 남긴다 — 금지 항목 「맨 위 node_modules」에
  // 걸려 ZIP 이 지워졌다(2026-09-26 Codex 교차검수 2회차 High). git archive 사본에는 원래 이 폴더가 없어 걷어도 된다.
  fs.rmSync(path.join(뿌리, 'node_modules'), { recursive: true, force: true })
  복사(path.join(ROOT, 'server', 'node_modules'), path.join(뿌리, 'server', 'node_modules'))
  // 안내 음성 모델(저장소 밖 — .gitignore). 위 「필수」가 들어갔는지 본다.
  복사(path.join(ROOT, 'server', 'tts-models'), path.join(뿌리, 'server', 'tts-models'))

  압축(뿌리, 파일)
  // **규격대로 고친다** — PowerShell 5.1 은 경로를 역슬래시로 적는다(위 함수 머리말).
  const 고친수 = 경로구분자고치기(파일)
  if (고친수) console.log(`  (경로 구분자 ${고친수}자리를 규격대로 고쳤습니다)`)
  fs.rmSync(짐터, { recursive: true, force: true })

  // 3) **다시 열어 확인한다.**
  const 안에든것 = zip목록(파일).map(s => s.replace(/^carecast\//, ''))

  console.log(`\n압축 안: ${안에든것.length}개 파일`)

  const 걸린것 = []
  for (const { 이름, 규칙 } of 금지) {
    const 맞나 = typeof 규칙 === 'function' ? 규칙 : (p) => 규칙.test(p)
    const 걸림 = 안에든것.filter(맞나)
    if (걸림.length) 걸린것.push({ 이름, 걸림 })
  }

  // **빈 서식이라던 것이 정말 비었는지 확인한다.** 이름으로 봐준 것을 내용으로 되짚는다 —
  // 누군가 `.env.example` 에 진짜 키를 적어 커밋하는 날, 이름 규칙만 있으면 그대로 나간다.
  for (const p of 안에든것.filter(x => 서식이름.test(x))) {
    const 값있는줄 = fs.readFileSync(path.join(ROOT, p), 'utf8')
      .split(/\r?\n/)
      .filter(l => /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S/.test(l))
      .map(l => l.split('=')[0].trim())
    if (값있는줄.length) {
      걸린것.push({ 이름: `빈 서식이어야 할 ${p} 에 값이 들어 있다`, 걸림: 값있는줄 })
    }
  }

  const 빠진것 = 필수.filter(p => !안에든것.includes(p))

  for (const { 이름, 걸림 } of 걸린것) {
    console.log(`\n✖ 들어가면 안 되는 것 — ${이름} (${걸림.length}개)`)
    for (const p of 걸림.slice(0, 5)) console.log(`   ${p}`)
  }
  for (const p of 빠진것) console.log(`\n✖ 설치에 필요한 것이 없다 — ${p}`)

  if (걸린것.length || 빠진것.length) {
    fs.rmSync(파일)
    console.log('\n압축 파일을 지웠습니다 — 반쯤 맞는 산출물을 남기지 않습니다.')
    process.exit(1)
  }

  const 크기 = fs.statSync(파일).size
  const 지문 = crypto.createHash('sha256').update(fs.readFileSync(파일)).digest('hex')

  console.log('\nOK  들어가면 안 되는 것 없음 (DB · .env · 음원 · 기초값 · 검수 임시파일)')
  console.log(`OK  설치에 필요한 것 ${필수.length}개 모두 있음`)
  console.log(`\n만든 파일 : ${path.relative(ROOT, 파일)}`)
  console.log(`크기      : ${사람이읽는크기(크기)}`)
  console.log(`대응 커밋 : ${sha}`)
  console.log(`SHA-256   : ${지문}`)
  console.log('')
  console.log('※ 파일 이름은 늘 같습니다 — 고친 뒤 다시 만들어 **같은 이름으로 덮어 올리면**')
  console.log('  README 에 적어 둔 링크가 그대로 삽니다. 판본은 압축 안 「릴리스정보.txt」 에 있습니다.')
}

main()
