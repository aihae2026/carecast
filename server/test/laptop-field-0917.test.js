'use strict'
// **노트북 설치본 실기 신고 셋** (사용자 신고 2026-09-17 16시)
//
// ① *"차임벨 울리고 가는게 아니라, 차임벨이랑 거의 TTS 랑 같이 나오는 버그"*
// ② *"좀비처럼 꺼도 꺼도 계속 브라우저 창 열리는건 무슨 버그야"*
// ③ *"휴대폰 권한설정하면 … 도스창 저따구로 뜨면서 안돼고 … 권한 주소로 들어가면 먹통"*
//
// 실제 스피커·방화벽·Edge 는 건드리지 않는다. ①은 대기 함수를 가짜 시계 없이 짧은 값으로 돌려 보고,
// ②③은 스크립트 글자를 대조한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('① 차임이 **늦게 울리기 시작하면** 안내는 「시작 + 여유」까지 기다린다 · 빨리 울리면 예전 기본 대기 그대로', async () => {
  const { 차임시작표지, 차임뒤대기 } = require('../services/chimeTiming')
  // 늦게 시작: 기본 100ms, 시작 신호는 250ms 뒤 → 최소 250 + 1800 까지 기다려야 한다
  {
    const 표지 = 차임시작표지(), t0 = Date.now()
    setTimeout(표지.onStart, 250)
    let 잔시간 = null
    await 차임뒤대기({ 신호옴: true, 표지, t0, 기본ms: 100, 잠자기: async (ms) => { 잔시간 = ms } })
    const 끝 = Date.now() + 잔시간
    assert.ok(끝 - t0 >= 250 + 1800 - 30, `차임 시작 ${250}ms 뒤인데 ${끝 - t0}ms 만에 안내를 낸다 — 겹친다`)
  }
  // 빨리 시작: 기본 3000, 시작 10ms → 기본 대기가 더 길다 → 3000 이 이긴다(빠른 PC 박자 유지)
  {
    const 표지 = 차임시작표지(), t0 = Date.now()
    표지.onStart()
    let 잔시간 = null
    await 차임뒤대기({ 신호옴: true, 표지, t0, 기본ms: 3000, 잠자기: async (ms) => { 잔시간 = ms } })
    assert.ok(잔시간 >= 2900, `빠른 PC 에서 기본 대기가 줄었다: ${잔시간}ms`)
  }
  // 신호를 못 주는 경로(스텁·맥): 예전과 같이 기본 대기만
  {
    const 표지 = 차임시작표지(), t0 = Date.now()
    let 잔시간 = null
    const 시작 = Date.now()
    await 차임뒤대기({ 신호옴: false, 표지, t0, 기본ms: 50, 잠자기: async (ms) => { 잔시간 = ms } })
    assert.ok(Date.now() - 시작 < 40, '신호를 못 주는 경로에서 시작 신호를 기다린다 — 안내가 늦어진다')
    assert.ok(잔시간 <= 50)
  }
})

test('① 세 호출자 모두 시작 신호로 기다린다 · 파이썬이 재생 직전에 신호를 찍는다', () => {
  assert.match(읽기('server/routes/tts.js'), /await 차임뒤대기\(\{ 신호옴, 표지, t0, 기본ms: CHIME_LEAD_MS \}\)/)
  assert.match(읽기('server/services/flowRunner.js'), /await 차임뒤대기\(\{ 신호옴, 표지, t0, 기본ms: 3000,/)
  assert.match(읽기('server/routes/mic.js'), /if \(신호옴\) await Promise\.race\(\[표지\.약속, 재생끝,/)
  const py = 읽기('server/services/carecast_chime.py')
  assert.ok(py.indexOf('print("CHIME_PLAYING", flush=True)') > 0 &&
    py.indexOf('print("CHIME_PLAYING", flush=True)') < py.indexOf('winmm.waveOutWrite('), '재생 직전에 신호를 찍지 않는다')
})

test('② 방송 화면을 사람이 거듭 닫으면 **다시 여는 간격을 늘린다** · 연결되면 초기화 · 종료가 창도 닫는다', () => {
  const loop = 읽기('scripts/carecast-loop.template.bat')
  assert.match(loop, /set \/a REOPEN=REOPEN\+1/)
  assert.match(loop, /if %REOPEN% GEQ 2 set SCOOL=120/)
  assert.match(loop, /if %REOPEN% GEQ 3 set SCOOL=360/)
  assert.match(loop, /:screenok\r?\nset SFAIL=0\r?\nset REOPEN=0/, '화면이 연결돼도 간격이 안 돌아온다 — 고장 난 창이 30분 동안 안 열린다')
  const stop = 읽기('scripts/installer/CareCast-Stop.ps1')
  assert.match(stop, /\$_.Name -ieq 'msedge\.exe'/, '종료가 방송 화면 창을 안 닫는다')
  assert.match(stop, /Join-Path \$appRoot 'browser-profile'/, '직원의 다른 Edge 창까지 닫을 수 있다 — 이 설치의 프로필로만 거른다')
})

test('③ 설치본의 bat 파일은 **영문자만·CRLF** — 명령창이 줄 중간부터 읽지 않게', () => {
  const 목록 = [
    'scripts/installer/CareCast-방화벽-열기.bat',
    'scripts/installer/carecast-start.bat',
    'scripts/carecast-loop.template.bat',
  ]
  for (const p of 목록) {
    const d = fs.readFileSync(path.join(ROOT, p))
    assert.ok(![...d].some((b) => b > 127), `${p} 에 한글 등 비ASCII 바이트가 있다`)
    const lf = d.toString('latin1').split('\n').length - 1
    const crlf = d.toString('latin1').split('\r\n').length - 1
    assert.equal(lf, crlf, `${p} 에 LF 만 있는 줄이 ${lf - crlf}개 — cmd 가 goto 자리를 잘못 잡는다`)
  }
  assert.match(읽기('.gitattributes'), /^\*\.bat text eol=crlf$/m, '다른 PC 에서 받으면 LF 로 바뀔 수 있다')
})

test('③ HTTPS 가 꺼진 PC 에서는 **안 열린 3443 주소로 보내지 않는다**', () => {
  const src = 읽기('src/components/easy/InstantBroadcast.jsx')
  assert.match(src, /if \(d && d\.httpsEnabled === false\) \{ setHttps꺼짐\(true\); return \}/)
  assert.match(src, /https꺼짐\s*\n\s*\? '휴대폰 마이크는 보안 접속\(HTTPS\)이 필요한데/)
})

// 2026-09-21: 합성 엔진이 바뀌었다(옛 파이썬 합성 스크립트는 걷어냈다). **같은 규칙이 새 엔진에도 산다** —
// 윈도우 음성(마지막 대비)은 설치 폴더의 고정 스크립트를 부르고, 합성마다 임시 폴더에 새 스크립트를 쓰지 않는다.
test('④ 음성 합성은 **고정 스크립트**로 돌린다 — 임시 폴더에 매번 새 스크립트를 쓰지 않는다(백신 검사 반복)', () => {
  const sapi = 읽기('server/services/ttsEngines/sapi.js')
  assert.match(sapi, /const SCRIPT = path\.join\(__dirname, '\.\.', 'carecast_sapi\.ps1'\)/)
  assert.match(sapi, /'-File', SCRIPT/)
  assert.ok(!/writeFileSync\([^)]*\.ps1/.test(sapi), '합성마다 임시 .ps1 을 만든다')
  assert.match(sapi, /fs\.writeFileSync\(글파일, text, 'utf8'\)/, '긍정 앵커 — 합성마다 쓰는 것은 문장 파일(.txt)뿐이다')
  assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', 'services', 'carecast_sapi.ps1')))
  assert.ok(!require('fs').existsSync(require('path').join(__dirname, '..', 'services', 'carecast_tts.py')), '걷어낸 옛 합성 스크립트가 남았다')
})

test('⑤ 휴대폰 마이크 인증서 — openssl 없이 PowerShell 로 만들고, 예전 pem 은 그대로 먼저 쓴다 · 시험 중엔 안 만든다', () => {
  const os = require('node:os')
  const 인증서 = require('../services/httpsCert')
  const 폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cert-'))
  try {
    assert.equal(인증서.인증서읽기(폴더), null)
    // Windows 가 아니면 만들지 않는다
    assert.equal(인증서.인증서만들기(['192.168.0.5'], { platform: 'darwin', 폴더, spawnSync: () => { throw new Error('부르면 안 된다') } }), false)
    // Windows — 주소가 SAN 으로 들어가고, 파일이 생기면 성공
    let 인자 = null
    const ok = 인증서.인증서만들기(['192.168.0.5', 'fe80::1'], { platform: 'win32', 폴더, log: {},
      spawnSync: (cmd, args) => { 인자 = args; fs.writeFileSync(path.join(폴더, 'cert.pfx'), 'x'); return { status: 0 } } })
    assert.equal(ok, true)
    const sans = 인자[인자.indexOf('-Sans') + 1]
    assert.equal(sans, 'IPAddress=127.0.0.1&IPAddress=192.168.0.5&DNS=localhost', 'IPv6·중복을 거르지 않거나 주소가 빠졌다')
    assert.ok(인자.some((a) => /carecast_cert\.ps1$/.test(a)), '고정 스크립트를 안 쓴다')
    assert.deepEqual(Object.keys(인증서.인증서읽기(폴더)), ['pfx', 'passphrase'])
    // 예전 pem 이 있으면 그것을 먼저 쓴다(현장 PC 인증서를 바꾸지 않는다)
    fs.writeFileSync(path.join(폴더, 'key.pem'), 'k'); fs.writeFileSync(path.join(폴더, 'cert.pem'), 'c')
    assert.deepEqual(Object.keys(인증서.인증서읽기(폴더)), ['key', 'cert'])
  } finally { fs.rmSync(폴더, { recursive: true, force: true }) }
  assert.equal(인증서.자동생성해도되나(), false, '시험 중에 PC 인증서 저장소를 건드린다')
  const idx = 읽기('server/index.js')
  assert.match(idx, /인증서\.자동생성해도되나\(\)/)
  assert.match(idx, /httpsServer = https\.createServer\(tls, app\)/)
})

test('⑥ 접속 주소를 **QR** 로 보여 준다 — 초기 설정·접속 안내 · innerHTML 없이 SVG 로', () => {
  const qr = 읽기('src/components/shared/AddressQR.jsx')
  assert.match(qr, /import qrcode from 'qrcode-generator'/)
  const 코드만 = qr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/dangerouslySetInnerHTML|createSvgTag|innerHTML/.test(코드만), '라이브러리가 만든 HTML 을 끼워 넣는다')
  assert.match(읽기('src/components/admin/sections/SetupWizard.jsx'), /<AddressQR url=\{주소\.url\}/)
  assert.match(읽기('src/components/shared/ConnectionGuide.jsx'), /row\.recommended && <AddressQR/)
  // 라이브러리가 실제로 그 주소를 담은 QR 을 만든다(칸 수가 버전에 맞게 나온다)
  const lib = require('qrcode-generator')
  const q = lib(0, 'M'); q.addData('http://192.168.0.5:3001'); q.make()
  assert.ok(q.getModuleCount() >= 21, 'QR 이 만들어지지 않았다')
  // 오픈소스 표기는 README 가 아니라 package.json 이 정본이다 — README 는 2026-09-18 부터 사용자가 직접 쓴 판(「React 등 MIT」로 묶어 적음)
  assert.match(읽기('package.json'), /"qrcode-generator"/, '의존성 목록에 QR 라이브러리가 없다')
})

test('⑦ 설치본은 방송 화면을 **저절로 다시 열지 않는다**(바탕화면 아이콘으로 연다) · 현장 소스 설치는 그대로 다시 연다', () => {
  const loop = 읽기('scripts/carecast-loop.template.bat')
  const 끔 = loop.indexOf('if "%CC_AUTO_REOPEN%"=="0" (')
  const 엶 = loop.indexOf('call :openwin', loop.indexOf('set SFAIL=0', loop.indexOf('no site screen')))
  assert.ok(끔 > 0 && 끔 < 엶, '끄는 스위치가 다시 여는 자리보다 앞에 없다')
  assert.match(읽기('scripts/installer/carecast-start.bat'), /set "CC_AUTO_REOPEN=0"\r?\ncall "carecast-loop\.bat"/)
  assert.ok(!/CC_AUTO_REOPEN/.test(읽기('CareCast-설치.bat')), '현장 소스 설치까지 다시 열기를 끈다 — 9월 14일 무음 사고 방지 장치가 사라진다')
  // 아이콘을 누르면 이미 돌고 있을 때 창만 연다
  assert.match(loop, /Already running on port 3001 - opening the screen\.\r?\n\s*call :openwin/)
})

// ── 2026-09-17 저녁 노트북 검수 2차 ─────────────────────────────────────────────

test('⑧ 차임이 **시작 신호 없이 끝나면** 안내는 상한 5초를 더 기다리지 않는다', async () => {
  const { 차임시작표지, 차임뒤대기 } = require('../services/chimeTiming')
  const 표지 = 차임시작표지(), t0 = Date.now()
  setTimeout(표지.끝남, 30)   // 장치 열기 실패 — 신호 없이 끝남
  const 시작 = Date.now()
  await 차임뒤대기({ 신호옴: true, 표지, t0, 기본ms: 60, 잠자기: async () => {} })
  assert.ok(Date.now() - 시작 < 1000, `신호 없이 끝난 차임을 ${Date.now() - 시작}ms 기다렸다`)
  assert.match(읽기('server/routes/tts.js'), /표지\.끝남\(\)/)
  assert.match(읽기('server/services/flowRunner.js'), /표지\.끝남\(\)/)
})

test('⑨ 차임 파형을 **저장해 두고 다시 읽는다** · 서버가 켜질 때 소리 없이 미리 만든다', () => {
  const py = 읽기('server/services/carecast_chime.py')
  assert.match(py, /carecast_chime_pcm_/)
  // 미리 만들기는 재생 코드(ctypes)에 닿기 전에 끝나야 한다 — 소리가 나면 안 된다
  const 끝냄 = py.indexOf("os.environ.get('CARECAST_CHIME_PREPARE') == '1'")
  assert.ok(끝냄 > 0 && 끝냄 < py.indexOf('import ctypes'), '미리 만들기가 재생 뒤에 있다 — 켤 때 차임이 울린다')
  const cp = 읽기('server/services/chimePlayer.js')
  assert.match(cp, /function 차임미리만들기\(\) \{\r?\n\s*if \(!IS_WINDOWS \|\| hardwareDisabled\(\)\) return false/)
  assert.match(읽기('server/index.js'), /차임미리만들기\(\)/)
})

test('⑩ 안내 음성 재생은 **고정 스크립트** — 재생마다 임시 .py 를 안 쓴다', () => {
  const be = 읽기('server/services/audioBackend.js')
  assert.ok(!/writeFileSync/.test(be), '재생마다 임시 스크립트를 쓴다 — 백신이 매번 검사한다')
  assert.ok(fs.existsSync(path.join(ROOT, 'server/services/carecast_mci_play.py')))
})

test('⑪ 「지금 방송」 카드가 떠 있는 동안 **음성을 미리 만든다** — 소리·이력 없이, 확인 필요 문구는 안 보낸다', () => {
  const r = 읽기('server/routes/tts.js')
  const 부분 = r.slice(r.indexOf("router.post('/prepare'"), r.indexOf("router.post('/broadcast'"))
  assert.ok(부분.length > 0, '미리 만들기 길이 없다')
  assert.match(부분, /hardwareDisabled\(\)/)
  assert.match(부분, /checkSensitive\(text, \{ acknowledged: false/)
  assert.ok(!/enqueue|playChime|시작기록|broadcastSSE/.test(부분), '미리 만들기가 소리·이력·신호를 낸다')
  assert.match(읽기('src/components/shared/QuickSchedulePhrase.jsx'), /prepareTTS\(\{ text: 미리문구/)
})

test('⑫ 누르고 말하기 — 차임이 이미 울리고 있으면 여유 1.8초만 기다린다', () => {
  assert.match(읽기('server/routes/mic.js'), /울리는중: 표지\.시각\(\) != null/)
  assert.match(읽기('src/components/easy/InstantBroadcast.jsx'), /setTimeout\(r, 울리는중 \? 1800 : 2600\)/)
})

test('⑬ 초기 설정은 **이 PC 에서 연 화면에서만** 뜬다 · 마이크용 QR 은 뺐다', () => {
  const home = 읽기('src/pages/HomeMode.jsx')
  assert.match(home, /if \(첫확인끝 \|\| !_IS_LOCAL\) return false/)
  assert.match(home, /if \(!_IS_LOCAL\) return\r?\n\s*try \{ if \(sessionStorage\.getItem\('carecast:setup-checked'\)\)/)
  assert.ok(!/마이크url/.test(읽기('src/components/admin/sections/SetupWizard.jsx')), '초기 설정에 마이크용 QR 이 남아 있다')
})

test('⑬ 휴대폰 폭에서는 크게 보기를 안 먹이고 단추도 숨긴다', () => {
  const bv = 읽기('src/lib/bigView.js')
  assert.match(bv, /export function 지금배율\(\) \{ return \(보통고정 \|\| 휴대폰폭\(\)\) \? 1/)
  assert.match(bv, /const v = \(보통고정 \|\| \(!root && 휴대폰폭\(\)\)\) \? 1 : 정리\(배율\)/)
  assert.match(읽기('src/components/home/BigViewButton.jsx'), /'hidden tablet:flex min-h-\[40px\]/)
})

test('⑭ 안내는 **한 번 누름에 한 장** — 장이 바뀐 직후 누름·키 반복·밝힌 자리 클릭은 넘기지 않는다', () => {
  const t = 읽기('src/components/home/HomeTour.jsx')
  assert.match(t, /const 다음 = \(\) => \{\r?\n\s*if \(막넘김\(\)\) return/)
  assert.match(t, /if \(e\.repeat && e\.key !== 'Tab'\)/)
  const 코드 = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const 막 = 코드.slice(코드.indexOf('data-cc-tour-layer'), 코드.indexOf('cc-tour-hole'))
  assert.ok(!/다음\(\)/.test(막), '밝힌 자리를 누르면 넘어간다 — 가상 마우스를 따라 누르면 두 장이 넘어간다')
})

// ── 2026-09-17 밤 노트북 검수 3차 ───────────────────────────────────────────────

test('⑯ 차임은 **떠 있는 재생 프로세스**로 먼저 낸다 — 새 파이썬을 안 띄운다(설치판 백신 검사 지연)', () => {
  const cp = 읽기('server/services/chimePlayer.js')
  assert.match(cp, /require\('\.\/audioPlayer'\)\.playPcm16\(raw, 44100\)/)
  assert.match(cp, /if \(!상주로울리기\(t, vol, onDone, onStart\)\) playViaWaveOut\(python, t, vol, onDone, onStart\)/,
    '상주 플레이어보다 새 프로세스를 먼저 띄운다')
  assert.match(cp, /carecast_chime_pcm_\$\{t\}_\$\{tag\}\.raw/, '파이썬이 남기는 파형 이름과 다르다')
  const ap = 읽기('server/services/audioPlayer.js')
  assert.match(ap, /function playPcm16\(pcm16, sr = 44100\) \{\r?\n\s*if \(!IS_WINDOWS \|\| hardwareDisabled\(\)\) return false/)
  // 마이크가 뒤따라 들어와도 차임이 끊기지 않게 표본율마다 핸들을 따로 둔다
  const py = 읽기('server/services/carecast_player.py')
  assert.match(py, /_handles = \{\}/)
  assert.ok(!/waveOutClose\(_wo_handle\)/.test(py), '표본율이 바뀌면 핸들을 닫는다 — 차임 여운이 끊긴다')
})

test('⑰ 스피커 목록 — PowerShell 이 막히면 파이썬으로 **같은 함수**를 불러 찾는다 · 초기 설정에 새로 고침', () => {
  const ad = 읽기('server/services/audioDevices.js')
  assert.match(ad, /if \(목록 && 목록\.length > 0\) return 목록/, 'PowerShell 결과가 있어도 파이썬으로 덮는다 — 현장 PC 동작이 바뀐다')
  const py = 읽기('server/services/carecast_devices.py')
  assert.match(py, /waveOutGetDevCapsW/)
  assert.match(py, /encode\('utf-8'\)/, '콘솔 코드페이지를 타면 한글 장치 이름이 깨진다')
  assert.match(읽기('src/components/admin/sections/SetupWizard.jsx'), /목록 새로 고침/)
})

test('⑱ 방화벽 — 공용 네트워크 노트북에서도 열리되 **같은 망 주소만** 받는다', () => {
  const bat = 읽기('scripts/installer/CareCast-방화벽-열기.bat')
  assert.match(bat, /localport=3001,3443 profile=any remoteip=localsubnet/)
  assert.ok(!/profile=private,domain/.test(bat), '개인 네트워크에만 연다 — 공용으로 잡힌 노트북에서 휴대폰이 못 들어온다')
})

test('⑲ 설치 안내에 SmartScreen·V3 넘기는 법이 있다', () => {
  // README 는 사용자가 직접 쓴 판이라 문구가 다르다(「V3 등 백신은 첫 실행 때 검사」) — 핵심 두 낱말만 본다.
  const readme = 읽기('README.md')
  assert.match(readme, /추가 정보/, 'README 에 「추가 정보」 안내가 없다')
  assert.match(readme, /V3/, 'README 에 V3 안내가 없다')
  const adopt = 읽기('docs/ADOPT.md')
  assert.match(adopt, /추가 정보/, 'ADOPT 에 「추가 정보」 안내가 없다')
  assert.match(adopt, /앱 격리 검사/, 'ADOPT 에 V3 안내가 없다')
})

test('⑳ 설치 파일에 **받은 압축 원본(node.zip·py.zip)을 안 담는다** — 실행기 폴더와 파이썬 표준 라이브러리 zip 은 담는다', () => {
  const src = 읽기('scripts/package-release.cjs')
  assert.match(src, /filter: \(원본\) => !\(path\.dirname\(원본\) === 런타임경로\(\) && \/\\.zip\$\/i\.test\(원본\)\)/)
  assert.ok(!/복사\(런타임경로\(\), path\.join\(뿌리, 'runtime'\)\)/.test(src), '런타임을 통째로 복사한다 — 47MB 가 딸려 간다')
  // 실행에 필요한 것은 여전히 확인 목록에 있다
  assert.match(src, /'runtime\/node\/node\.exe'/)
  assert.match(src, /'runtime\/python\/python\.exe'/)
})

// 2026-09-26(Codex 통합 검수 SOLO-0917B Medium): 시작 신호를 기다리는 두 대기가 그냥 setTimeout 이라
// 흐름 방송을 정지해도 차임 신호를 최대 기본 3초 + 상한 5초 동안 못 보고 기다렸다. 취소를 여기서도 본다.
test('⑩ 차임 시작 신호를 기다리는 동안에도 **정지하면 바로 빠져나온다**', async () => {
  const { 차임시작표지, 차임뒤대기 } = require('../services/chimeTiming')
  const 표지 = 차임시작표지(), t0 = Date.now()   // 신호도 끝도 안 온다 — 늦게 뜨는 차임 프로세스
  let 정지 = false
  setTimeout(() => { 정지 = true }, 100)
  const 시작 = Date.now()
  await 차임뒤대기({ 신호옴: true, 표지, t0, 기본ms: 3000, 잠자기: async () => {}, 취소됨: () => 정지 })
  assert.ok(Date.now() - 시작 < 1000, `정지한 뒤에도 차임 신호를 ${Date.now() - 시작}ms 기다렸다`)
  assert.match(읽기('server/services/flowRunner.js'), /await 차임뒤대기\(\{[^}]*취소됨: isCancelled/,
    '흐름 실행기가 취소 여부를 넘기지 않는다 — 정지해도 차임 신호를 끝까지 기다린다')
})
