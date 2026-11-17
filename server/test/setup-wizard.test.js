'use strict'
// 초기 설정 마법사 가드 (UX-01 ~ UX-13, 2026-09-11).
//
// **이 검사의 진짜 목적은 UX-13 하나다** — *"기본값·검증 로직은 한 벌만 둔다"*.
// 마법사는 시스템 설정에 이미 있는 것을 다시 묻는 화면이라, 화면 쪽에 숫자·정규식·
// 기본값을 한 줄이라도 적는 순간 두 벌이 된다. 이 저장소가 같은 방식으로 세 번 다쳤다:
//   · 안내 음성 볼륨 이름이 셋이라 관리자 슬라이더가 **소리에 영향이 없었다**(2026-08-28)
//   · `repeat_broadcast` 컬럼 추가가 두 곳에 있어 한쪽만 고치면 드리프트
//   · 배포 게이트가 방송 시각을 복사해 둬서 현장 셋이 금지 구간에서 빠졌다(2026-09-06)
// 셋 다 **빨간불 없이** 갔다. 그래서 소스를 글자로 읽어 고정한다.
//
// 가드는 코드를 따라 옮긴다(CLAUDE.md 「파일을 가를 때」) — 마법사를 다른 파일로 가르면
// 아래 경로도 **같은 커밋에서** 옮긴다. 부정 단언 앞에 긍정 앵커를 먼저 세워 두었다.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 마법사 = fs.readFileSync(path.join(ROOT, 'src/components/admin/sections/SetupWizard.jsx'), 'utf8')
const 규칙원문 = fs.readFileSync(path.join(ROOT, 'src/lib/setupRules.js'), 'utf8')
const 설정라우트 = fs.readFileSync(path.join(ROOT, 'server/routes/settings.js'), 'utf8')
const 자동방송 = fs.readFileSync(path.join(ROOT, 'server/domain/autoBroadcasts.js'), 'utf8')

// 순수 모듈이라 그냥 돌려 본다 — ESM 이라 소스를 CJS 로 바꿔 평가한다.
// (이 저장소는 프런트가 ESM, 테스트가 CJS 다. 번들러를 들이지 않는 것이 규칙이라 이렇게 한다.)
function 규칙로드() {
  const src = 규칙원문
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
  const 이름들 = ['기관글자수상한', '시각형식', '시각이맞나', '기관글자검사', '갈래',
                  '연동항목', '단계목록', '마지막단계인가', '진행률', '준비상태', '마무리문구',
                  '저장해도되나']
  return new Function(`${src}\nreturn { ${이름들.join(', ')} }`)()
}
const R = 규칙로드()

// ── 긍정 앵커 — 감시할 대상이 이 파일에 있다 ─────────────────────────────
test('마법사가 실제로 여기 있다 — 아래 부정 단언의 앵커', () => {
  assert.match(마법사, /export default function SetupWizard/, '마법사 컴포넌트가 없다')
  assert.match(마법사, /from '\.\.\/\.\.\/\.\.\/lib\/setupRules'/, '규칙 모듈을 안 불러온다')
  assert.match(마법사, /from '\.\.\/\.\.\/\.\.\/lib\/api'/, '기존 api 함수를 안 쓴다')
})

// ── UX-13 — 로직을 복사하지 않는다 ────────────────────────────────────────
test('마법사는 저장·조회를 스스로 만들지 않는다 — lib/api.js 만 쓴다', () => {
  assert.doesNotMatch(마법사, /\bfetch\s*\(/, '마법사가 직접 fetch 한다 — api.js 를 거쳐야 한다')
  assert.doesNotMatch(마법사, /\/api\/settings\//, '마법사에 API 경로가 박혀 있다')
})

test('마법사에 기본값·상한 숫자를 다시 적지 않는다', () => {
  // 40 은 기관 글자수 상한이다. 마법사는 `기관글자수상한` 을 불러 쓸 뿐 숫자를 안 쓴다.
  assert.match(마법사, /기관글자수상한/, '상한을 규칙 모듈에서 안 가져온다')
  assert.doesNotMatch(마법사, /maxLength=\{40\}|slice\(0,\s*40\)/, '마법사에 40 이 박혀 있다')
  // 목소리는 2026-09-17 전체 화면 개편에서 마법사 밖(음량 및 TTS)으로 나갔다 — 그래도 이름을 박지 않는다.
  assert.doesNotMatch(마법사, /ko-KR-\w+Neural/, '마법사에 목소리 이름이 박혀 있다')
})

test('마법사가 시각 형식을 스스로 판정하지 않는다', () => {
  // 자동 종료 시각은 마법사 밖으로 나갔다(아래 「장 구성」). 다시 들어오더라도 정규식을 박지 않는다.
  assert.doesNotMatch(마법사, /\[01\]\\d|2\[0-3\]/, '마법사에 HH:MM 정규식이 박혀 있다')
})

// ── 전체 화면 · 한 장에 한 질문 (사용자 확정 시안 2026-09-16, N3·N4) ──────────────────────
test('**사이드바 없는 전체 화면이다** — 관리자 껍데기 안 작은 칸으로 뜨지 않는다 (N3)', () => {
  assert.match(마법사, /className="fixed inset-0 z-\[\d+\]/,
    '마법사가 화면 전체를 덮지 않는다 — 관리자 사이드바 안 작은 칸으로 뜬다(N3 신고)')
  assert.match(마법사, /나중에 설정하기/, '빠져나갈 길이 없다 — 급할 때 방송을 못 한다')
})

test('**소리 시험이 스피커 바로 뒤다** · 실제로 차임을 울린다 (N4)', () => {
  const 순서 = R.단계목록.map((s) => s.id)
  // 2026-10-07 사용자 결정으로 준비물 다음에 「이용 조건(terms)」이 들어왔다 — 「처음 설정 화면에서 동의, 막지 않는다」.
  assert.deepEqual(순서, ['org', 'ready', 'terms', 'speaker', 'sound', 'api', 'address', 'done'],
    `장 순서가 확정 시안과 다르다: ${순서.join(' → ')}`)
  assert.match(마법사, /fireChime\('general'\)/, '소리 시험이 차임을 안 울린다 — 귀로 확인할 수 없다')
  for (const s of R.단계목록) {
    assert.ok(s.질문 && s.도움, `${s.id} 장에 큰 질문·설명이 없다 — 화면이 문구를 지어낸다`)
  }
})

test('**키 셋은 기존 저장 창구로만 간다** — 새 저장 경로를 만들지 않는다', () => {
  const 창구 = { apiKeys: 'saveAPIKey', kma: 'saveKmaSettings' }
  // (외부 동영상 키는 2026-09-21 걷어냈다 — 배경음악·영상은 이 PC 에 올린 파일이다)
  assert.deepEqual(R.연동항목.map((x) => x.id), ['gemini', 'kma'], '확정 시안 순서(AI · 기상청)가 아니다')
  for (const 항목 of R.연동항목) {
    assert.ok(창구[항목.저장], `${항목.id} 의 저장 방식 '${항목.저장}' 을 모른다`)
    assert.match(마법사, new RegExp(`${창구[항목.저장]}\\(`), `${항목.id} 를 ${창구[항목.저장]} 로 저장하지 않는다`)
    assert.ok(항목.쓰임, `${항목.id} 밑에 회색 한 줄(쓰임)이 없다`)
  }
})

// ── 서버와 사본이 어긋나지 않는가 ─────────────────────────────────────────
//
// 화면 쪽 사본은 "미리 알려주기" 용이고 최종 판정은 서버가 한다. 그래도 어긋나면
// 사람이 40자를 넘겨 입력하고 나서야 400 을 본다 — 그래서 두 숫자를 대조한다.
test('기관 글자수 상한이 서버와 같다', () => {
  const m = /const ORG_TEXT_MAX = (\d+)/.exec(설정라우트)
  assert.ok(m, '서버의 ORG_TEXT_MAX 를 못 찾았다 — 이 가드를 옮길 것')
  assert.equal(R.기관글자수상한, Number(m[1]),
    `상한이 갈렸다 — 화면 ${R.기관글자수상한}, 서버 ${m[1]}`)
})

test('시각 형식이 서버와 같은 정규식이다', () => {
  const m = /const HHMM = (\/.*\/)\s*$/m.exec(자동방송)
  assert.ok(m, '서버의 HHMM 을 못 찾았다 — 이 가드를 옮길 것')
  assert.equal(String(R.시각형식), m[1], `시각 형식이 갈렸다 — 화면 ${R.시각형식}, 서버 ${m[1]}`)
})

test('빈 시각은 유효하다 — 끄기는 정상적인 선택이다 (AP-0012)', () => {
  assert.equal(R.시각이맞나(''), true, '빈 값을 막으면 자동종료를 끌 수가 없다')
  assert.equal(R.시각이맞나('18:21'), true)
  assert.equal(R.시각이맞나(' 09:00'), false, '공백이 섞인 값을 받으면 발동부와 어긋난다')
  assert.equal(R.시각이맞나('25:00'), false)
})

// ── UX-01 — 단계 규칙 ─────────────────────────────────────────────────────
test('마지막 단계 전에는 "완료"가 아니다', () => {
  const 앞 = R.단계목록.slice(0, -1)
  for (const s of 앞) assert.equal(R.마지막단계인가(s.id), false, `${s.id} 가 마지막으로 잡힌다`)
  assert.equal(R.마지막단계인가(R.단계목록[R.단계목록.length - 1].id), true)
})

test('진행률이 단계와 함께 늘고 마지막이 1 이다', () => {
  const 값 = R.단계목록.map((s) => R.진행률(s.id))
  for (let i = 1; i < 값.length; i++) assert.ok(값[i] > 값[i - 1], `${i}번째에서 안 늘었다`)
  assert.equal(값[값.length - 1], 1)
  assert.equal(R.진행률('없는단계'), 0, '모르는 단계는 0 이어야 한다')
})

// ── UX-03 — 인증을 만들지 않는다 ──────────────────────────────────────────
//
// 이 시스템은 로그인을 **일부러** 두지 않았다(PROJECT_PROFILE §1-1, CA-011 WONTFIX).
// 마법사가 그 전제를 혼자 뒤집으면, 사람은 잠긴 줄 아는데 실제로는 아무것도 안 막힌다 —
// 그게 인증이 없는 것보다 나쁘다.
// **그 단계는 2026-09-16 에 걷었다**(사용자 지시: *"초기설정 에서도 방송관리자 삭제하고"*).
// 아무것도 저장하지 않는 안내문 한 장이었고, 첫 설정을 하는 사람에게는 여섯 걸음 중
// 하나가 "지금은 아무것도 안 합니다" 인 것이 길만 늘렸다.
//
// **지키는 것은 그대로다** — 걷었다고 감시를 놓지 않는다. 지켜야 할 것은 「그 단계가
// 보류다」가 아니라 **「마법사가 비밀번호를 받지 않는다」**였다. 단계가 되살아나든
// 다른 자리에 생기든, 값을 받기 시작하면 빨간불이 나야 한다.
test('마법사는 비밀번호를 받지 않는다 — 인증은 일부러 안 만든 것이다', () => {
  assert.equal(R.단계목록.find((s) => s.id === 'admin'), undefined,
    '「방송 관리자」 단계가 되살아났다 — 값을 받기 시작했는지 먼저 확인할 것')
  // **`type="password"` 자체를 막지 않는다.** API 키 칸이 그것을 쓴다(키를 가리려고) —
  // 막으면 키를 평문으로 보이게 만드는 셈이라 오히려 나쁘다. 실제로 이 가드를 그렇게
  // 조였다가 곧바로 빨간불이 났고, **가드가 아니라 내가 틀렸다.**
  // 가르는 것은 **무엇을 받느냐**다: 비밀번호를 받거나, 관리자 계정을 저장하려 하면 막는다.
  // **주석을 걷고 본다** — 이 파일 머리말이 걷어 낸 단계를 설명하며 그 낱말을 쓴다.
  // 안 걷으면 고쳐 놓고도 빨간불이 난다(실제로 그랬다).
  const 코드만 = 마법사.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(코드만, /비밀번호|savePassword|saveAdmin|adminPassword/,
    '마법사가 비밀번호·관리자 계정을 받으려 한다 — 사람은 잠긴 줄 아는데 아무것도 안 막힌다')
})

test('단계 번호가 1부터 빈 칸 없이 이어진다 — 걷어 낸 뒤 번호가 뛰지 않는다', () => {
  const 번호들 = R.단계목록.map((s) => s.번호)
  assert.deepEqual(번호들, 번호들.map((_, i) => i + 1),
    `단계 번호가 이어지지 않는다(${번호들.join('·')}) — 화면에 「1 2 4 5」로 뜬다`)
})

// ── UX-05 — 키가 없어도 끝난다 ────────────────────────────────────────────
test('연동 항목은 모두 건너뛸 수 있다 — 필수 키가 마법사를 막지 않는다', () => {
  const api단계 = R.단계목록.find((s) => s.id === 'api')
  assert.equal(api단계.건너뛰기, true, 'API 단계를 못 건너뛰면 키 없이 설치를 못 끝낸다')
  const 제미나이 = R.연동항목.find((x) => x.id === 'gemini')
  assert.equal(제미나이.필수, true, '권장 표시가 사라졌다')
  assert.ok(제미나이.없으면, '없을 때 무슨 일이 나는지 안 적혀 있다')
})

test('연동 항목마다 발급 링크와 갈래가 있다 (UX-04·UX-07)', () => {
  for (const 항목 of R.연동항목) {
    assert.match(항목.발급링크, /^https:\/\//, `${항목.id} 에 발급 링크가 없다`)
    assert.ok(R.갈래[항목.갈래], `${항목.id} 의 갈래 '${항목.갈래}' 가 네 갈래 밖이다`)
    assert.ok(항목.없으면, `${항목.id} 에 "없으면 무슨 일이 나나"가 없다`)
  }
})

test('저장 가능한 키 이름은 서버 화이트리스트 안에 있다 (ISSUE-005)', () => {
  const 목록 = /const AI_API_KEYS = \{([\s\S]*?)\}/.exec(설정라우트)
  assert.ok(목록, '서버의 AI_API_KEYS 를 못 찾았다 — 이 가드를 옮길 것')
  for (const 항목 of R.연동항목.filter((x) => x.키)) {
    assert.ok(목록[1].includes(항목.키),
      `'${항목.키}' 는 서버가 받지 않는다 — 저장하면 400 이 난다`)
  }
})

// ── UX-12 — 실패를 성공처럼 보여주지 않는다 ───────────────────────────────
const 다됨 = { org: { name: '예시요양원' }, device: '스피커 (Realtek)', sound: '들림',
  keys: { gemini: true, youtube: false, kma: true }, address: 'http://192.168.0.8:3001' }

test('검사하지 않은 것은 "확인 불가"다 — 안 해 본 것을 됐다고 적지 않는다', () => {
  const 줄 = R.준비상태({})
  assert.ok(줄.length >= 5, '마무리 표가 비어 있다')
  for (const r of 줄) assert.equal(r.상태, '확인 불가', `${r.id} 가 확인도 없이 판정됐다`)
  assert.match(R.마무리문구(줄), /확인하지 못한/)
})

test('**안 들렸다는 것은 실패다** — 다른 것이 다 정상이어도 성공 문구를 쓰지 않는다', () => {
  const 줄 = R.준비상태({ ...다됨, sound: '안 들림' })
  assert.equal(줄.find((r) => r.id === 'sound').상태, '실패')
  assert.match(R.마무리문구(줄), /연결하지 못한|확인해 주세요/, '소리가 안 들렸는데 성공 문구가 나갔다')
})

test('다 채워지면 준비 끝이라고 말한다 · 키는 「저장됨」까지만 말한다', () => {
  const 줄 = R.준비상태(다됨)
  assert.ok(줄.every((r) => r.상태 === '정상'), JSON.stringify(줄))
  assert.match(R.마무리문구(줄), /방송 준비가 끝났습니다/)
  const 키 = 줄.find((r) => r.id === 'api')
  assert.match(키.문구, /저장됨/)
  assert.doesNotMatch(키.문구, /연결됨|연결되었/, '검사하지 않은 키를 연결됐다고 적는다')
})

test('빈 값과 "안 해 봤음"을 가른다 — 기관 이름이 비면 미설정 · 스피커 빈 값은 기본 장치', () => {
  const 줄 = R.준비상태({ org: { name: '', slogan: '' }, device: '' })
  assert.equal(줄.find((r) => r.id === 'org').상태, '미설정')
  assert.equal(줄.find((r) => r.id === 'speaker').상태, '미설정')
  assert.match(줄.find((r) => r.id === 'speaker').문구, /기본 장치/)
  assert.equal(줄.find((r) => r.id === 'sound').상태, '확인 불가', 'null 인 칸이 미설정으로 샜다')
})

// ── UX-11 — 저장과 실행을 가른다 ──────────────────────────────────────────
test('마법사가 PC 를 끄지 않는다 — 자동 종료는 마법사 밖으로 나갔다', () => {
  assert.match(마법사, /saveTTSSettings\(\{ audioDevice/, '긍정 앵커: 스피커 저장이 안 보인다 — 이 가드를 옮길 것')
  assert.doesNotMatch(마법사, /shutdown\s*\/s|scheduleAutoShutdown|\/api\/system\/shutdown/,
    '마법사가 종료를 실행하려 한다')
})

// ── 사이드바·라우팅에 실제로 붙었는가 ─────────────────────────────────────
test('사이드바와 라우팅에 붙어 있다 — 만들고 안 잇는 일이 없게', () => {
  const sidebar = fs.readFileSync(path.join(ROOT, 'src/components/admin/Sidebar.jsx'), 'utf8')
  const admin = fs.readFileSync(path.join(ROOT, 'src/pages/AdminMode.jsx'), 'utf8')
  assert.match(sidebar, /id: 'setupWizard'/, '사이드바에 없다')
  assert.match(admin, /setupWizard:\s*\{ Component: SetupWizard/, 'sectionMap 에 없다')
  assert.match(admin, /import SetupWizard/, 'import 가 없다')
})

// ── 2026-09-11 독립 검수(VERDICT FAIL)가 잡은 것 셋 ────────────────────────
//
// 앞선 19건이 왜 못 봤나: **API 응답의 모양을 대조하는 검사가 하나도 없었다.**
// 소스에 `키현황?.[id]` 라고 적혀 있는 것까지는 보는데, 그 값이 객체라서 언제나
// truthy 라는 사실은 서버 파일을 함께 읽어야 안다. 아래가 그 자리를 메운다.

test('조회에 실패했으면 저장하지 않는다 — 빈 값이 멀쩡한 설정을 덮는다', () => {
  // `tts_voice_normal = ''` 이 들어가면 `getSetting` 의 `?? 기본값` 을 **빈 문자열이
  // 통과하지 못해** 기본 목소리로 안 돌아간다. 그 뒤 안내 방송의 합성이 무너진다.
  // `auto_shutdown_time = ''` 은 현장의 18:21 을 조용히 지운다.
  // 스피커: 빈 초안이 현장 스피커 이름을 지우면 Windows 기본 장치로 떨어져 엉뚱한 데서 소리가 난다.
  const 실패 = R.저장해도되나('speaker', { 장치: '' }, { org: {}, tts: null })
  assert.equal(실패.ok, false, '지금 스피커를 못 읽었는데 저장이 열려 있다')
  assert.match(실패.이유, /못 읽었습니다/, '왜 막혔는지 사람에게 말하지 않는다')

  const org실패 = R.저장해도되나('org', { 이름: '', 표어: '' }, { org: null, tts: {} })
  assert.equal(org실패.ok, false, '기관 정보를 못 읽었는데 저장이 열려 있다')

  // 읽었으면 빈 값도 저장할 수 있어야 한다 — 사람이 일부러 「Windows 기본 장치」를 고르는 것은 정상이다
  assert.equal(R.저장해도되나('speaker', { 장치: '' }, { org: {}, tts: { audioDevice: '스피커' } }).ok, true,
    '읽기에 성공했는데도 막는다 — 기본 장치를 고를 수가 없다')
  assert.equal(R.저장해도되나('org', { 이름: '', 표어: '' }, { org: {}, tts: {} }).ok, true)
})

test('키 저장은 조회 실패와 무관하다 — 더하기만 하므로 덮을 것이 없다', () => {
  assert.equal(R.저장해도되나('api', { 키들: { gemini: 'AIza...' } }, { org: null, tts: null }).ok, true,
    '키는 더하기만 하는데 조회 실패로 막았다')
  assert.equal(R.저장해도되나('api', { 키들: { gemini: '   ', youtube: '', kma: '' } }, { org: {}, tts: {} }).ok, false,
    '빈 키를 보내려 한다')
})

test('저장 여부를 화면이 스스로 판정하지 않는다', () => {
  assert.match(마법사, /저장해도되나\(/, '규칙 모듈의 판정을 안 쓴다')
  assert.match(마법사, /const 저장가능 = 저장판정\.ok/, '저장가능 을 화면이 다시 계산한다')
  assert.ok(!/단계 === 'org'\s+\? !이름오류/.test(마법사),
    '화면에 옛 삼항 판정이 남아 있다 — 조회 성공 여부가 빠진 그 판정이다')
  // 막힌 이유를 사람에게 보여주는가 — 버튼만 잠그면 왜인지 모른다
  assert.match(마법사, /저장판정\.이유/, '저장이 막힌 이유를 화면에 안 적는다')
})

test('키 현황을 응답 모양대로 읽는다 — [object Object] 를 찍지 않는다', () => {
  // `GET /api/settings/api-keys` 는 `{ set, masked }` 객체를 준다.
  // **객체는 키가 없어도 항상 truthy** 라, 그냥 보면 새 PC 에서도 "저장됨" 이 뜬다.
  const m = /out\[name\] = \{([^}]*)\}/.exec(설정라우트)
  assert.ok(m, '서버의 api-keys 응답 모양을 못 찾았다 — 이 가드를 옮길 것')
  assert.match(m[1], /set:/, '응답에 set 이 없다')
  assert.match(m[1], /masked:/, '응답에 masked 가 없다')

  assert.match(마법사, /키현황\?\.\[항목\.id\]\?\.set/,
    '키가 있는지를 객체 자체로 판정한다 — 없어도 "저장됨" 이 뜬다')
  assert.match(마법사, /키현황\[항목\.id\]\.masked/,
    '마스킹된 값 대신 객체를 그대로 찍는다 — [object Object] 가 보인다')
})

// ── **지금 값을 못 읽었어도 입력을 말없이 버리지 않는다** (적대적 검증 T-32-2, 2026-09-17) ─────────
// 서버가 늦게 떠 기관 정보·스피커 조회가 실패(null)하면, 앞 판은 바뀜=false 로 저장 없이 넘어갔고
// 「못 읽었습니다」 안내도 안 보였다. 화면의 「바뀜」 식을 떼어 실제 값으로 돌려 본다.
test('조회 실패(null) 상태에서 적거나 고른 것은 「바뀜」이다 — 그래야 저장 규칙이 막고 이유가 뜬다', () => {
  const 시작 = 마법사.indexOf('const 바뀜 = ')
  const 끝 = 마법사.indexOf("\n    || (단계 === 'api'", 시작)
  assert.ok(시작 > 0 && 끝 > 시작, '바뀜 식을 못 찾았다')
  const 식 = 마법사.slice(시작 + 'const 바뀜 = '.length, 끝)
  const 바뀜 = (v) => new Function('단계', 'org', 'tts', '이름초안', '표어초안', '장치초안', `return !!(${식})`)(
    v.단계, v.org ?? null, v.tts ?? null, v.이름 ?? '', v.표어 ?? '', v.장치 ?? '')
  assert.strictEqual(바뀜({ 단계: 'org', 이름: '예시요양원' }), true, '기관 조회 실패인데 적은 이름을 버린다')
  assert.strictEqual(바뀜({ 단계: 'org' }), false, '아무것도 안 적었는데 바뀜이다')
  assert.strictEqual(바뀜({ 단계: 'speaker', 장치: '스피커 (Realtek)' }), true, '스피커 조회 실패인데 고른 장치를 버린다')
  assert.strictEqual(바뀜({ 단계: 'org', org: { name: 'A', slogan: '' }, 이름: 'A' }), false, '읽은 값 그대로인데 바뀜이다')
  assert.strictEqual(바뀜({ 단계: 'org', org: { name: 'A', slogan: '' }, 이름: 'B' }), true)
  // 막힌 이유가 실제로 그려지는 조건이 바뀜에 걸려 있다 — 그래서 위 식이 true 여야 안내가 뜬다
  assert.match(마법사, /\{바뀜 && !저장판정\.ok && 저장판정\.이유 && \(/)
  assert.ok(마법사.indexOf('if (!저장가능) return') > 마법사.indexOf('if (!바뀜) return 옆으로(1)'),
    '바뀜이면 저장 규칙이 막아야 한다 — 순서가 뒤집혔다')
})

// ── **떠 있는 동안 뒤 화면이 스크롤되면 안 된다** (현장 지적 2026-09-18) ──────────────────
// 마법사는 `fixed inset-0` 이라 화면을 다 덮는데 **뒤의 관리자 화면은 그대로 스크롤됐다.**
// 창을 줄인 노트북·태블릿(세로가 짧을 때)에서는 뒤 화면이 넘쳐 스크롤 막대가 생기고, 휠을 굴리면
// **막대만 움직이고 앞은 그대로**라 「스크롤이 안 먹는다」로 보인다. 그 상태에서 아래쪽을 누르면
// 있어야 할 자리에 아무것도 없어 빈 곳을 누르게 된다. 전체화면에서는 뒤가 안 넘쳐 증상이 안 났다.
// 사용자 원문: *"스크롤이 한계때문에 그런가 약간 위에 빈화면을 눌리는 것 같더라고"*
test('초기 설정이 떠 있는 동안 **뒤 화면을 잠그고, 닫을 때 자리를 되돌린다**', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/admin/sections/SetupWizard.jsx'), 'utf8')

  const i = src.indexOf('보통으로고정(true)')
  assert.ok(i > 0, '긍정 앵커 — 마법사가 뜰 때 도는 effect 가 이 파일에 있다')
  const 창 = src.slice(i, i + 700)

  assert.match(창, /style\.overflow\s*=\s*'hidden'/,
    '뒤 화면을 안 잠근다 — 창을 줄인 PC 에서 스크롤 막대만 움직이고 앞은 그대로다')
  assert.match(창, /window\.scrollTo\(0,/,
    '닫을 때 스크롤 자리를 안 되돌린다 — 관리자 화면이 맨 위로 튄다')
  assert.match(창, /있던overflow/,
    '원래 overflow 를 기억하지 않는다 — 닫은 뒤 다른 화면의 스크롤까지 막을 수 있다')
})

// ── **이 시설의 위치를 처음 설정에서 묻는다** (2026-09-18) ──────────────────────────────
// `weather.js:371,533` 이 Open-Meteo 를 부를 때 `location_lat`·`location_lon` 을 읽는데, 그 값을
// **쓰는 곳이 어디에도 없었다.** 화면에서 위경도를 넣고 「격자 계산」을 눌러도 격자만 저장됐다.
// 그래서 기상청이 막혀 Open-Meteo 로 넘어가면 **어느 기관이든 기본값 위치의 날씨**가 나갔다 —
// 오류도 경고도 없이. 저장 경로를 만들고, 처음 설정의 「연결」 장에서 함께 묻는다.
test('설정 저장 API 가 **위도·경도를 받아 저장**한다 — 숫자가 아니면 막는다', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, '../routes/settings.js'), 'utf8')

  const i = src.indexOf("router.post('/kma'")
  assert.ok(i > 0, '긍정 앵커 — 기상청 설정 저장 라우트가 있다')
  const 창 = src.slice(i, i + 2200)

  assert.match(창, /uvAreaNo,\s*lat,\s*lon\s*\}\s*=\s*req\.body/, '요청 본문에서 lat·lon 을 안 꺼낸다(주석만으로는 통과하지 않게 구조분해를 본다)')
  assert.match(창, /'location_lat'/, 'location_lat 을 저장하지 않는다 — Open-Meteo 가 만든 곳 좌표를 쓴다')
  assert.match(창, /'location_lon'/, 'location_lon 을 저장하지 않는다')
  assert.match(창, /Number\.isFinite/, '숫자인지 안 본다 — 글자가 들어가면 날씨 조회가 조용히 깨진다')

  // 읽기 쪽도 실어 보내야 화면이 지금 값을 보여 준다. **기본값을 흉내 내지 않는다.**
  const g = src.indexOf("router.get('/kma'")
  const 읽기창 = src.slice(g, src.indexOf("router.post('/kma'"))
  assert.match(읽기창, /lat:\s*getSetting\(db, 'location_lat', ''\)/, '읽기 응답에 lat 이 없거나 기본값을 채워 보낸다')
  assert.match(읽기창, /lon:\s*getSetting\(db, 'location_lon', ''\)/, '읽기 응답에 lon 이 없거나 기본값을 채워 보낸다')
})

test('초기 설정 「연결」 장이 **이 시설의 위치**를 묻고, 좌표를 격자와 함께 저장한다', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/admin/sections/SetupWizard.jsx'), 'utf8')

  assert.match(src, /이 시설은 어디에 있나요\?/, '위치를 묻는 자리가 없다')
  assert.match(src, /기본값\(서울\) 날씨가 나갑니다/, '안 넣으면 어떻게 되는지 화면이 말하지 않는다')
  assert.match(src, /navigator\.geolocation/, '「지금 위치」 로 넣는 길이 없다')
  assert.match(src, /좌표저장 = \{ lat:/, '좌표를 저장 꾸러미로 안 만든다')
  assert.match(src, /await saveKmaSettings\(보낼것\)/, '좌표를 서버로 안 보낸다')
  assert.match(src, /격자로\(la, lo\)/, '격자를 계산하지 않는다 — 사람이 격자 번호를 찾게 만든다')
  assert.match(src, /격자범위밖/, '좌표가 뒤바뀌어도 그대로 저장한다')

  // **계산 규칙을 두 벌로 두지 않는다** — 관리자 화면과 같은 모듈을 쓴다.
  assert.match(src, /from '\.\.\/\.\.\/\.\.\/lib\/kmaGrid'/, '격자 계산을 따로 구현했다(사본 금지)')

  // 키를 안 넣고 좌표만 넣어도 저장되어야 한다 — 「바뀜」 판정에 좌표가 들어 있는지.
  const b = src.indexOf('const 바뀜 =')
  assert.ok(b > 0, '긍정 앵커 — 바뀜 판정이 있다')
  assert.match(src.slice(b, b + 600), /위도초안/, '좌표만 넣으면 저장을 건너뛴다')
})
