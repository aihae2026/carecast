'use strict'
// **이용 조건 동의 · 고지문 인쇄 · 출처 표기 · 공개 라이선스** (사용자 지시 2026-10-07).
//
// *"설치할때 오픈소스 슈퍼토닉 3 이용약관 등 고지 게시하는거 있잖아 그거 약관 동의 할 수 있게
//   만들어주고, 실제 게시문 뽑아서 출력할 수 있도록 따로 설정에서 만들어주면 좋을듯"*
// *"오픈소스로 열렸을 때 문제 없을 수 있도록"* · *"날씨 매트로도 포함될걸?"*(Open-Meteo)
//
// 사용자 결정(같은 날): 동의는 **처음 설정 마법사 + 미동의 현장은 알림 띠만** — 방송은 막지 않는다.
// 저작권자 「jung-svg」 · Apache-2.0. Open-Meteo 는 동작 그대로, 출처 표기만.
//
// ── 이 시험이 가장 걱정하는 것 ─────────────────────────────────────────────
// ① **동의 장치가 방송을 막는 것.** 동의 안 한 현장도 방송은 그대로 나가야 한다.
// ② 지켜야 할 고지가 **조용히 사라지는 것**(한 줄짜리 글·목록 한 칸이다).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const TEST_DB_PATH = path.join(require('node:os').tmpdir(), `carecast_test_consent_${process.pid}_${Date.now()}.db`)

// ── 서버: 동의 기록 ──────────────────────────────────────────────────────────
test('**동의는 누가·언제·어느 판에 했는지 남는다** · 처음엔 없다 · 틀린 입력은 400', async () => {
  const 이전경로 = process.env.CARECAST_DB_PATH
  process.env.CARECAST_DB_PATH = TEST_DB_PATH
  const { initDB, getDB } = require('../db/schema')
  const { startTestApp } = require('./helpers/testApp')
  const settingsRoutes = require('../routes/settings')
  initDB()
  const app = await startTestApp({ '/api/settings': settingsRoutes })
  const 주소 = `${app.baseUrl}/api/settings/license-consent`
  const 보내기 = (body) => fetch(주소, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.deepEqual(await (await fetch(주소)).json(), { consent: null }, '아무도 동의 안 했는데 동의 기록이 있다')

    const r = await 보내기({ version: '2026-10-07', by: '  행정팀 홍길동  ' })
    assert.equal(r.status, 200)
    const 받음 = (await (await fetch(주소)).json()).consent
    assert.equal(받음.version, '2026-10-07')
    assert.equal(받음.by, '행정팀 홍길동', '앞뒤 공백을 안 걷었다')
    assert.ok(!Number.isNaN(Date.parse(받음.at)), `동의 시각이 시각이 아니다: ${받음.at}`)

    // 틀린 입력은 저장하지 않는다 — 기록이 그대로여야 한다.
    for (const [이름, body] of [
      ['판 없음', { by: '홍길동' }],
      ['이름 없음', { version: '2026-10-07', by: '   ' }],
      ['판 형식', { version: '아무거나<script>', by: '홍길동' }],
      ['이름 너무 김', { version: '2026-10-07', by: '가'.repeat(41) }],
      ['깨진 글자', { version: '2026-10-07', by: '홍�동' }],
    ]) {
      const x = await 보내기(body)
      assert.equal(x.status, 400, `${이름} 인데 저장을 받았다`)
    }
    assert.equal((await (await fetch(주소)).json()).consent.by, '행정팀 홍길동', '틀린 입력이 기록을 덮었다')

    // 설정 쓰기의 단일 통로를 탔는가 — 변경 기록이 남는다.
    const 이력 = getDB().prepare("SELECT COUNT(*) AS n FROM settings_history WHERE key LIKE 'license_consent%'").get().n
    assert.ok(이력 > 0, '동의가 설정 변경 기록에 안 남았다 — writeSetting 을 안 거쳤다')
  } finally {
    await app.close?.()
    process.env.CARECAST_DB_PATH = 이전경로
  }
})

test('**동의 여부는 방송 경로가 보지 않는다** — 동의 안 한 현장도 방송은 나간다', () => {
  // 방송을 내보내는 쪽(스케줄러·시퀀서·TTS)이 동의 설정을 읽기 시작하면, 그날부터 동의 안 한
  // 현장의 방송이 멈출 수 있다. 사용자 결정은 「알림 띠만」이다.
  for (const p of ['server/services/scheduler.js', 'server/services/broadcastSequencer.js', 'server/services/tts.js']) {
    assert.doesNotMatch(읽기(p), /license_consent|licenseConsent/, `${p} 가 동의 여부를 본다 — 방송이 동의에 묶인다`)
  }
  // 긍정 앵커: 동의 기록은 settings 라우트에 실제로 있다(위 부정 단언이 빈 파일에서 헛돌지 않게).
  assert.match(읽기('server/routes/settings.js'), /router\.get\('\/license-consent'/)
})

// ── 화면 규칙: 한 곳에서 온다 ────────────────────────────────────────────────
test('**약관 판·게시문·이용 제한은 lib/licenseNotice 한 곳에 있다** · 판이 다르면 다시 묻는다', async () => {
  const L = require('../../src/lib/licenseNotice.js')
  assert.match(L.약관판, /^\d{4}-\d{2}-\d{2}$/, '약관판은 날짜 모양이어야 한다(서버가 그 모양만 받는다)')
  assert.equal(L.동의필요(null), true, '동의 기록이 없는데 다시 묻지 않는다')
  assert.equal(L.동의필요({ version: L.약관판 }), false, '이번 판에 동의했는데 또 묻는다')
  assert.equal(L.동의필요({ version: '2000-01-01' }), true, '옛 판에 동의한 것을 이번 판 동의로 친다')

  const 글 = L.게시문('예시요양원')
  assert.match(글.본문.join('\n'), /합성 음성/, '게시문에 「합성 음성」이 없다 — Open RAIL-M (e) 고지가 핵심이다')
  assert.match(글.서명, /예시요양원/, '기관 이름이 게시문에 안 들어간다')
  assert.match(L.게시문('').서명, /○○/, '기관 이름이 없을 때 빈 서명이 된다 — 손으로 쓸 자리를 남겨야 한다')

  const 제한 = L.이용제한.map((x) => x.글).join(' ')
  for (const 낱말 of ['기계가 만든', '의료', '사칭']) {
    assert.ok(제한.includes(낱말), `이용 제한 요약에 「${낱말}」 이 없다 — 요양원에서 특히 지킬 셋이다`)
  }
  assert.ok(L.약관항목.length >= 3, '동의할 항목이 너무 적다')

  // 동의 날짜는 **이 PC 의 날짜**로 보인다 — 서버는 UTC 로 적는다. 2026-10-07 MT 에서 새벽 1시 45분
  // 동의가 「2026-10-06 에 동의했습니다」로 떴다(ISO 문자열 앞 10글자를 잘라 썼다).
  const 새벽 = new Date(2026, 9, 7, 1, 45)   // 이 PC 시각 10월 7일 01:45
  assert.equal(L.동의날짜(새벽.toISOString()), '2026-10-07', 'UTC 날짜를 그대로 보여 준다')
  assert.equal(L.동의날짜('엉터리'), '', '날짜가 아닌 값을 그대로 보여 준다')
  for (const p of ['src/components/admin/sections/LicenseNoticePage.jsx', 'src/components/admin/sections/SetupWizard.jsx']) {
    assert.doesNotMatch(코드만(읽기(p)), /\.at\)\.slice\(0,\s*10\)/, `${p} 가 UTC 날짜를 잘라 쓴다`)
    assert.match(코드만(읽기(p)), /동의날짜\(/, `${p} 가 동의날짜() 를 안 쓴다`)
  }
  // 이 화면이 요약이라는 것과 원문 자리를 밝힌다 — 요약을 원문처럼 내밀면 안 된다.
  assert.match(L.원문안내, /licenses\//)
})

// ── 마법사 ───────────────────────────────────────────────────────────────────
test('**처음 설정에 「이용 조건」 장이 있다(준비물 다음, 소리 내기 전)** · 건너뛸 수 있다 · 기존 창구로만 저장한다', () => {
  const R = require('../../src/lib/setupRules.js')
  const 장 = R.단계목록.find((s) => s.id === 'terms')
  assert.ok(장, '마법사에 이용 조건 장이 없다')
  const 순서 = R.단계목록.map((s) => s.id)
  assert.ok(순서.indexOf('terms') < 순서.indexOf('sound'), '이용 조건이 소리 시험보다 뒤다 — 목소리를 내기 전에 조건을 읽는다')
  assert.equal(장.건너뛰기, true, '이용 조건을 못 건너뛴다 — 급할 때 설치를 못 끝낸다(사용자 결정: 막지 않는다)')

  const 마법사 = 코드만(읽기('src/components/admin/sections/SetupWizard.jsx'))
  assert.match(마법사, /단계 === 'terms'/, '이용 조건 장을 그리지 않는다')
  assert.match(마법사, /saveLicenseConsent\(/, '동의를 저장하지 않는다')
  assert.match(마법사, /약관판/, '어느 판에 동의했는지 안 보낸다')
})

// ── 미동의 알림 띠 ───────────────────────────────────────────────────────────
test('**동의 안 한 현장에는 관리 화면에 알림 띠만** — 화면을 덮거나 옮기지 않는다', () => {
  const 띠 = 코드만(읽기('src/components/admin/LicenseConsentBanner.jsx'))
  assert.match(띠, /동의필요\(/, '띠가 규칙 모듈의 판정을 안 쓴다')
  assert.match(띠, /section=licenseNotice|onNavigate\?\.\('licenseNotice'\)|licenseNotice/, '띠에서 동의하러 갈 길이 없다')
  assert.doesNotMatch(띠, /fixed inset-0|navigate\(|location\.(href|assign|replace)/, '띠가 화면을 덮거나 사람을 옮긴다')
  // 조회에 실패하면 띠를 안 띄운다 — 서버가 잠깐 멎었다고 「동의 안 함」으로 겁주지 않는다.
  assert.match(띠, /catch/, '조회 실패를 처리하지 않는다')
  const 관리 = 읽기('src/pages/AdminMode.jsx')
  assert.match(관리, /<LicenseConsentBanner\b/, '관리 화면에 띠가 안 달렸다')
})

// ── 설정 「라이선스·고지」 화면 ──────────────────────────────────────────────
test('**설정에 「라이선스 · 고지」 화면이 있고, 게시문을 인쇄할 수 있다**', () => {
  const 사이드바 = 코드만(읽기('src/components/admin/Sidebar.jsx'))
  assert.match(사이드바, /id: 'licenseNotice'/, '사이드바에 메뉴가 없다')
  assert.match(읽기('src/pages/AdminMode.jsx'), /licenseNotice:\s*\{ Component: LicenseNoticePage/, '그릴 화면이 없다')

  const 화면 = 코드만(읽기('src/components/admin/sections/LicenseNoticePage.jsx'))
  assert.match(화면, /window\.print\(\)/, '인쇄 버튼이 없다')
  assert.match(화면, /게시문\(/, '게시문을 규칙 모듈에서 안 가져온다 — 화면이 글을 지어낸다')
  assert.match(화면, /getOrgInfo\(/, '기관 이름을 게시문에 안 넣는다')
  assert.match(화면, /saveLicenseConsent\(/, '이 화면에서 동의할 수 없다 — 미동의 띠가 보낼 곳이 여기다')
  assert.match(화면, /이용제한\.map\(/, '이용 제한을 안 보여 준다')
  assert.match(화면, /출처들\.map\(|<DataCredits/, '데이터 출처(Open-Meteo 포함)를 함께 안 보여 준다')

  // 인쇄하면 **게시문 한 장만** 나와야 한다 — 메뉴·버튼까지 찍히면 붙일 수 없다.
  const css = 읽기('src/index.css')
  assert.match(css, /@media print/, '인쇄용 규칙이 없다')
  assert.match(css, /\.print-only/, '인쇄할 부분을 고르는 규칙이 없다')
})

// ── 데이터 출처: Open-Meteo ──────────────────────────────────────────────────
test('**Open-Meteo 를 부르면 출처에 있고, 원문이 요구하는 링크 글이 그려진다**', () => {
  const weather = 읽기('server/services/weather.js')
  assert.match(weather, /api\.open-meteo\.com/, '긍정 앵커: weather.js 가 Open-Meteo 를 부른다(전제)')
  const { 출처들 } = require('../../src/lib/dataCredits.js')
  const om = 출처들.find((s) => /Open-Meteo/.test(s.기관))
  assert.ok(om, 'Open-Meteo 를 부르는데 출처에 없다')
  // https://open-meteo.com/en/licence (2026-10-07 확인): "Weather data by Open-Meteo.com" 링크, CC BY 4.0
  assert.equal(om.링크, 'https://open-meteo.com/')
  assert.equal(om.링크글, 'Weather data by Open-Meteo.com')
  assert.match(om.조건, /CC BY 4\.0/)
  assert.match(om.조건, /비상업/, '무료판이 비상업 이용만 된다는 조건이 안 적혔다')
  for (const p of ['src/components/shared/DataCredits.jsx', 'src/components/admin/sections/DataCreditsPage.jsx']) {
    assert.match(코드만(읽기(p)), /s\.링크/, `${p} 가 출처 링크를 안 그린다`)
  }
})

// ── 공개 라이선스 파일 ───────────────────────────────────────────────────────
test('**CareCast 자체는 Apache-2.0 · 저작권자 jung-svg** — LICENSE·NOTICE·package.json 이 같은 말을 한다', () => {
  const lic = 읽기('LICENSE')
  assert.match(lic, /Apache License\s+Version 2\.0, January 2004/)
  assert.match(lic, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/)
  assert.ok(lic.length > 9000, 'Apache-2.0 전문이 아니다(잘렸다)')
  const notice = 읽기('NOTICE')
  assert.match(notice, /Copyright 2026 jung-svg/)
  // 저작권자 표기는 개인 계정 이름 한 곳으로 모은다 — 운영 기관 이름이 다시 들어가면 시설이 특정된다.
  for (const p of ['NOTICE', 'LICENSES.md', 'README.md', 'THIRD-PARTY-NOTICES.md', 'src/components/admin/sections/LicenseNoticePage.jsx']) {
    assert.match(읽기(p), /Copyright 2026 jung-svg/, `${p} 의 저작권자 표기가 다르다`)
  }
  assert.match(notice, /Supertonic/, 'NOTICE 가 모델의 별도 조건(OpenRAIL-M)을 안 알린다')
  assert.equal(JSON.parse(읽기('package.json')).license, 'Apache-2.0')
  assert.equal(JSON.parse(읽기('server/package.json')).license, 'Apache-2.0')
  assert.doesNotMatch(읽기('LICENSES.md'), /Apache-2\.0 예정/, 'LICENSES.md 가 아직 「예정」이라고 한다')
  assert.match(읽기('LICENSES.md'), /Open-Meteo/, 'LICENSES.md 에 Open-Meteo 가 없다')
})

test('**sherpa-onnx 실행 파일 안의 espeak-ng(GPL-3.0)를 고지한다** — Apache-2.0 으로만 적으면 설치판 배포가 GPL 을 어긴다', () => {
  // 2026-10-17 검수: sherpa-onnx-c-api.dll 안에 espeak-ng 가 정적으로 들어 있다. 고지가 빠지면 설치판을 나눠 줄 때
  // GPL-3.0 고지·소스 제공 의무를 모른 채 어기게 된다.
  for (const p of ['LICENSES.md', 'NOTICE', 'THIRD-PARTY-NOTICES.md']) {
    const 글 = 읽기(p)
    assert.match(글, /espeak-ng/, `${p} 에 espeak-ng 가 없다`)
    assert.match(글, /GPL-3\.0/, `${p} 에 GPL-3.0 이 없다`)
    assert.match(글, /piper-phonemize/, `${p} 에 piper-phonemize 가 없다`)
  }
  assert.match(읽기('scripts/third-party-notices.cjs'), /espeak-ng\(GPL-3\.0\)/, '고지 생성기가 GPL 안내를 안 만든다 — 다시 만들면 사라진다')
})

test('**설치판에 라이선스 파일이 반드시 들어간다** — 빠지면 묶기가 멈춘다', () => {
  const src = 읽기('scripts/package-release.cjs')
  const 필수 = /const 필수 = \[([\s\S]*?)\]/.exec(src)
  assert.ok(필수, '필수 목록을 못 찾았다 — 이 시험의 전제가 무너졌다')
  for (const f of ['LICENSE', 'NOTICE', 'LICENSES.md', 'THIRD-PARTY-NOTICES.md', 'licenses/Supertonic-3-OpenRAIL-M.txt']) {
    assert.ok(필수[1].includes(`'${f}'`), `설치판 필수 목록에 ${f} 가 없다`)
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md')), 'THIRD-PARTY-NOTICES.md 가 저장소에 없다')
})
