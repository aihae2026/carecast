// **배포 문서가 설치 파일·코드와 어긋나지 않는다** (제출 06, 2026-09-15).
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────────
// `docs/DEPLOY.md` 는 DEP-01~10 에 답하면서 **포트·주기·경로·설치 절차**를 그대로
// 옮겨 적는다. 이런 값은 코드에서 조용히 바뀌고, 바뀐 줄 모르는 사람은 **틀린 절차로
// 새 기관에 설치한다.**
//
// ── 이 문서에서 가장 중요한 주장 둘 ─────────────────────────────────────────
// ① 설치 파일은 **이미 복제된 PC 를 전제한 업데이트 도구**다(`git pull` 로 시작한다).
// ② 자동 업데이트가 **기관을 구분하지 않는다**(모두 같은 `main` 을 따라간다).
//
// 이 둘이 「새 기관 배포 패키지」가 왜 미착수인지의 진짜 이유다. 설치 파일이 바뀌어
// 전제가 달라지면 **문서의 결론부터 틀리게 된다** — 그래서 근거를 시험으로 묶어 둔다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 문서 = 읽기('docs/DEPLOY.md')

test('긍정 앵커 — 배포 문서가 있다', () => {
  assert.ok(문서.length > 3000, '배포 문서가 비었거나 너무 짧다')
})

test('**설치 파일은 아직 `git pull` 로 시작한다** — 문서의 첫 결론이 여기 걸려 있다', () => {
  const bat = 읽기('CareCast-설치.bat')
  assert.match(bat, /git pull origin main/,
    '설치 파일이 더는 git pull 로 받지 않는다 — DEPLOY.md §① 의 결론을 다시 쓸 것')
  // 첫 복제 단계가 생기면 이 문서의 「새 기관은 설치할 수 없다」가 틀린 말이 된다.
  assert.doesNotMatch(bat, /git clone/,
    '설치 파일에 git clone 이 생겼다 — 새 기관이 설치할 수 있게 됐는지 보고 DEPLOY.md §① 을 고칠 것')
  assert.match(문서, /새 기관이 설치할 수 없습니다/,
    'DEPLOY.md 가 §① 의 결론을 적고 있지 않다')
})

test('**자동 업데이트 주기·대상이 문서와 같다**', () => {
  const au = 읽기('server/services/autoUpdate.js')
  const 분 = au.match(/const CHECK_INTERVAL_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/)?.[1]
  assert.ok(분, 'autoUpdate.js 의 주기를 못 찾았다')
  assert.ok(문서.includes(`**${분}분**마다`),
    `배포 문서의 확인 주기가 코드(${분}분)와 다르다`)
  // 기관을 가르는 장치가 생기면 §② 의 경고를 다시 써야 한다.
  assert.match(au, /origin\/main/,
    'autoUpdate 가 더는 origin/main 을 보지 않는다 — DEPLOY.md §② 를 다시 쓸 것')
})

test('**포트가 문서와 같다**', () => {
  const idx = 읽기('server/index.js')
  // 2026-09-16 에 포트가 `포트읽기('CARECAST_PORT', 3001)` 이 됐다(격리 사본을 띄워
  // 재 보려고 연 환경변수 — 기본값은 그대로 3001 이다). **지키는 사실은 그대로**라
  // 「기본값」을 집도록 정규식만 넓힌다.
  const http  = idx.match(/const HTTP_PORT\s*=\s*(?:[^(\n]*\(\s*[^,\n]+,\s*)?(\d+)/)?.[1]
  const https = idx.match(/const HTTPS_PORT\s*=\s*(?:[^(\n]*\(\s*[^,\n]+,\s*)?(\d+)/)?.[1]
  assert.ok(http && https, 'server/index.js 의 포트를 못 찾았다')
  assert.ok(문서.includes(`**${http}**(HTTP)`),
    `배포 문서의 HTTP 포트가 코드(${http})와 다르다`)
  assert.ok(문서.includes(`${https}(HTTPS`),
    `배포 문서의 HTTPS 포트가 코드(${https})와 다르다`)
})

test('**음원이 사는 곳이 문서와 같고, 백업은 DB 만 한다**', () => {
  // 「음원은 백업 안 된다」가 이 문서의 구멍 지적 중 하나다. 근거를 둘 다 묶는다.
  const paths = 읽기('server/domain/audioPaths.js')
  assert.match(paths, /'public',\s*'audio'/,
    '음원 폴더가 server/public/audio 가 아니게 됐다 — DEPLOY.md §DEP-04 를 고칠 것')
  assert.ok(문서.includes('server/public/audio/'),
    '배포 문서가 음원 위치를 안 적고 있다')

  const backup = 읽기('server/services/backup.js')
  assert.match(backup, /VACUUM INTO/,
    '백업 방식이 VACUUM INTO 가 아니게 됐다 — DEPLOY.md 를 다시 볼 것')
  // 긍정 앵커를 세운 뒤의 부정 단언이다(파일이 비어도 통과하는 것을 막는다).
  assert.doesNotMatch(backup, /public[\\/]audio|audioPaths/,
    '백업이 음원까지 뜨게 됐다 — DEPLOY.md 의 「음원 백업 없음」 지적을 지울 것')
})

test('**DEP-09 를 「했다」고 적지 않는다** — 깨끗한 환경 점검은 안 했다', () => {
  // 이 문서에서 가장 부풀리기 쉬운 칸이다. 안 해 본 것을 한 것처럼 적는 순간
  // 새 기관이 그 말을 믿고 설치를 시작한다.
  assert.match(문서, /실제 수행 결과: 없습니다/,
    'DEP-09 가 「실제 수행 결과 없음」을 안 적고 있다 — 실제로 해 봤다면 결과를 적을 것')
  assert.match(문서, /처음부터 설치해 본 적이 없습니다/,
    'DEP-09 의 근거 문장이 사라졌다')
})

test('**단계 배포 계획을 측정값으로 적지 않는다**', () => {
  assert.match(문서, /위 표는 \*\*전부 목표\*\*입니다/,
    '단계 배포 표가 목표임을 밝히고 있지 않다 — 목표와 측정값을 섞지 않는다')
})
