'use strict'
// **2026-09-18 저녁 현장 신고 넷** — 설치판 실기에서 사용자가 찾은 것.
//
//  ① *"브라우저 크게 해서 캘린더 보니까 저렇게 바깥으로 나가버리잖아"*
//     크게 보기는 `<html>` 에 `zoom` 을 거는데, 캘린더 쪽지는 확대 전 좌표(`innerWidth`·`clientX`)로
//     자리를 셌다. 1.25배·창 1689 에서 오른쪽 끝 날짜를 누르면 **407px 이 화면 밖**(브라우저 실측).
//     같은 모양이 물음표 도움말(`HelpTip`)에도 있었다.
//  ② *"초기설정하고 나서 완료되면 왜 바로 처음 안내 다시보기 나와"* — 끝낼 때 **언제나** 안내를 켰다.
//  ③ *"방송화면은 자막 중간값이 기초 설정으로"* — 새로 깐 PC 만. 현장은 기본값을 따라가고 있어서
//     기본값을 바꾸면 현장 방송 글자가 작아진다(2026-09-18 현장 사본 확인).
//  ④ *"소프트업데이트 설치판으로 하라고 했는데 왠 소프트웨어 업데이트"* — 설치판엔 `.git` 이 없다.
//
// 화면 좌표 계산은 이 저장소의 다른 시험처럼 **소스를 읽어** 고정한다. 실제 넘침은 브라우저로 쟀다
// (창 1689·1024·834 × 배율 1·1.25·1.5 = 27 회, 넘침 0px). 여기서는 그 장치가 빠지지 않게만 지킨다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// ── ① 확대 배율 ──────────────────────────────────────────────────────────────
test('① 배율을 읽는 자리는 bigView 하나다 — 실제로 먹은 zoom 을 읽는다', () => {
  const src = 읽기('src/lib/bigView.js')
  assert.match(src, /export function 먹은배율\(\)/, '먹은배율() 이 없다')
  assert.match(src, /getComputedStyle\(document\.documentElement\)\.zoom/, '실제로 먹은 zoom 을 안 읽는다')
})

test('① 캘린더 쪽지는 순수 계산(popupPlace)에 **지금 먹은 배율**을 넘긴다 — 계산 자체는 popup-place.test.js 가 숫자로 본다', () => {
  const src = 읽기('src/components/admin/sections/scheduleCalendarPopups.jsx')
  const i = src.indexOf('function usePopupPosition(')
  assert.ok(i > 0, '긍정 앵커 — 자리 계산 함수가 있다')
  const 몸 = src.slice(i, i + 900)
  assert.match(몸, /쪽지자리\(\{/, '순수 계산을 안 부른다 — 부품 안에 계산을 다시 적었다(시험이 못 본다)')
  assert.match(몸, /z:\s*typeof window === 'undefined' \? 1\s*:\s*먹은배율\(\)/, '배율을 안 넘긴다 — 크게 보기에서 다시 넘친다')
  assert.match(몸, /vw:\s*typeof window === 'undefined' \? 1280 : window\.innerWidth/, '창 폭을 안 넘긴다')
  assert.match(src, /width: pos\.폭/, '줄인 폭을 쪽지에 안 쓴다')
})

test('① 물음표 도움말도 같은 규칙 — 잰 자리를 배율로 나눠 넣는다', () => {
  const src = 읽기('src/components/shared/HelpTip.jsx')
  const i = src.indexOf('const place = () =>')
  assert.ok(i > 0, '긍정 앵커 — 말풍선 자리 계산이 있다')
  const 몸 = src.slice(i, src.indexOf('\n  }\n', i))
  assert.match(몸, /먹은배율\(\)/, '배율을 안 읽는다')
  // 창 안에 맞추는 판정은 **그려질 폭**(확대된 폭)으로 해야 한다 — 확대 전 폭으로 하면 오른쪽 끝에서 넘친다(QA 변이 D)
  assert.match(몸, /const 그려질폭 = BUBBLE_W \* z/, '말풍선 폭에 배율을 안 곱한다 — 크게 보기에서 오른쪽으로 넘친다')
  assert.match(몸, /window\.innerWidth - 그려질폭 - 8/, '창 안에 맞출 때 그려질 폭을 안 쓴다')
  assert.match(몸, /left:\s*Math\.max\(8,\s*left\)\s*\/\s*z/, 'left 를 배율로 안 나눈다')
  assert.match(몸, /top:\s*\(r\.bottom \+ 8\)\s*\/\s*z/, 'top 을 배율로 안 나눈다')
})

// ── ② 처음 안내 · ③ 자막 크기 ─────────────────────────────────────────────────
const 마법사 = () => 읽기('src/components/admin/sections/SetupWizard.jsx')

test('② 처음 안내는 **처음 설정일 때만** 켠다 — 「처음인가」를 들어올 때 읽는다', () => {
  const src = 마법사()
  assert.match(src, /getSetupState\(\)\.then\(\(s\) => \{ 처음설정\.current = !!s\?\.처음인가 \}\)/,
    '「처음인가」를 안 읽는다(「끝냈나」만 보면 현장 PC 가 처음으로 읽힌다 — 현장은 setup_done_at 이 비어 있다)')
  assert.match(src, /const 처음설정 = useRef\(false\)/, '못 읽었을 때 처음으로 보면 쓰던 PC 의 자막이 작아진다')
  // 실패 처리에서 「처음」으로 바꾸면 같은 사고다(QA 변이 C) — catch 안에서 처음설정을 건드리지 않는다
  const 읽기줄 = src.slice(src.indexOf('getSetupState().then('), src.indexOf('getSetupState().then(') + 220)
  assert.match(읽기줄, /\.catch\(\(\) => \{ \/\* 못 읽으면 처음이 아니다 \*\/ \}\)/, '읽기 실패 때 무언가를 한다 — 처음으로 바꾸면 현장 자막이 작아진다')
  assert.doesNotMatch(읽기줄.slice(읽기줄.indexOf('.catch')), /처음설정\.current\s*=\s*true/, '읽기 실패를 「처음」으로 본다')
  assert.match(src, /if \(처음안내 && 첫설정\) \{ try \{ localStorage\.setItem\('carecast:tour-pending'/,
    '다시 들어와 끝내도 처음 안내가 켜진다')
})

test('③ 새로 깐 PC 의 첫 설정에서만 자막을 「중간」으로 — 기본값(크게)은 그대로 둔다', () => {
  const src = 마법사()
  assert.match(src, /if \(첫설정\) \{ try \{ await saveOrgInfo\(\{ textSize: 'medium' \}\)/, '첫 설정에서 중간을 안 넣는다')
  // 기본값을 바꾸면 현장(값을 저장 안 해 둔 PC) 방송 글자가 다음 업데이트에 작아진다
  const 서버 = 읽기('server/domain/broadcastTextSize.js')
  assert.match(서버, /const 기본 = 'large'/, '기본값이 바뀌었다 — 현장 방송 화면이 작아진다')
  const 화면 = 읽기('src/lib/broadcastTextSize.js')
  assert.match(화면, /export const 기본글자크기 = 'large'/, '화면 기본값이 바뀌었다')
})

test('③ 자막만 보내도 기관 이름·표어가 안 지워진다(P-115) — 마법사가 기대는 전제', () => {
  const src = 읽기('server/routes/settings.js')
  const i = src.indexOf("router.post('/org'")
  assert.ok(i > 0, '긍정 앵커 — 기관 정보 저장 라우트가 있다')
  const 몸 = src.slice(i, i + 2400)
  assert.match(몸, /보냈나\(req\.body, 'name'\)\s*\?\s*req\.body\.name\s*:\s*지금\('org_name'\)/, '이름을 안 보내면 지워진다')
})

// ── ④ 설치판 업데이트 ────────────────────────────────────────────────────────
test('④ 업데이트 정보가 git 저장소 여부를 알리고, 설치판이면 git 을 안 부른다', () => {
  const src = 읽기('server/routes/update.js')
  assert.match(src, /const git저장소인가 = \(\) => fs\.existsSync\(path\.join\(PROJECT_DIR, '\.git'\)\)/, 'git 저장소 판정이 없다')
  const i = src.indexOf("router.get('/info'")
  assert.ok(i > 0, '긍정 앵커 — /info 가 있다')
  const 몸 = src.slice(i, src.indexOf("router.get('/auto-status'", i))
  // git log 는 셸 없이 execFile 로 부른다(2026-10-17 — cmd 가 `|` 를 파이프로 읽던 문제, update-info-git-log.test.js)
  const 부름 = 몸.indexOf('execFile(')
  assert.ok(부름 > 0, '긍정 앵커 — /info 가 git log 를 execFile 로 부른다')
  assert.ok(몸.indexOf('git저장소인가()') < 부름, '설치판에서도 git log 를 먼저 부른다')
  assert.match(몸, /gitRepo: false/, '설치판이라고 안 알린다')
})

test('④ 설치판에서 「지금 업데이트」 요청을 서버가 막는다 — **업데이트를 시작하기 전에**', () => {
  const src = 읽기('server/routes/update.js')
  const i = src.indexOf("router.post('/start'")
  assert.ok(i > 0, '긍정 앵커 — /start 가 있다')
  // 고정 창으로 자르지 않는다 — 라우트 끝(다음 `router.` 또는 파일 끝)까지 본다(독립 검수 지적 2026-09-18).
  const 끝 = src.indexOf('\nrouter.', i + 10)
  const 몸 = src.slice(i, 끝 > 0 ? 끝 : undefined)
  assert.match(몸, /if \(!git저장소인가\(\)\) \{\s*return res\.json\(\{ ok: false/, '설치판에서도 git pull 을 시도한다')
  const 막음 = 몸.indexOf('git저장소인가()'), 시작 = 몸.indexOf('runUpdate(')
  assert.ok(시작 > 0, '긍정 앵커 — /start 가 업데이트를 부른다')
  assert.ok(막음 < 시작, '막음이 업데이트 시작보다 뒤에 있다 — git pull 이 먼저 돈다')
})

test('④ 간편 화면 상태 칸은 설치판에서 예전처럼 업데이트 칸을 안 띄운다', () => {
  const src = 읽기('src/components/easy/SystemStatusCompact.jsx')
  assert.match(src, /if \(data\.commit && data\.gitRepo !== false\) setGitInfo\(data\)/,
    '설치판에 제목 없는 빈 업데이트 칸이 뜬다')
})

test('④ 설정 화면이 설치판이면 새 설치 파일 안내를 보여 준다(README 「업데이트」와 같은 문구)', () => {
  const src = 읽기('src/components/admin/sections/systemSettingsEtc.jsx')
  assert.match(src, /if \(commitInfo\?\.gitRepo === false\) \{/, '설치판을 가르지 않는다')
  assert.match(src, /「기록을 그대로 두고 설치」/, 'README 와 같은 안내가 없다')
  const readme = 읽기('README.md')
  assert.match(readme, /「기록을 그대로 두고 설치」/, 'README 문구가 바뀌었다 — 화면과 맞출 것')
})
