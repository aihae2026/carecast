// 오픈소스 공개 전 전문가 1차 검토(2026-11-01 반영)와 같은 관점의 추가 점검을 고정한다.
//
// 항목 번호는 검토 문서(「AI챌린지해_해뜨는마을_1차 수정」)의 번호다. 소스 대조로만 잠그면
// 글자만 바꿔 통과하므로, 동작으로 볼 수 있는 것은 핸들러를 직접 불러 본다 — 이 저장소에는
// supertest 가 없고 새 테스트 도구를 들이지 않는다(audio-subtitle-routes.test.js 와 같은 방식).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

process.env.CARECAST_DB_PATH = path.join(os.tmpdir(), `carecast_test_expert1_${process.pid}_${Date.now()}.db`)
delete process.env.CARECAST_EXTRA_ORIGINS

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { initDB } = require('../db/schema')
initDB()

function handlerOf(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method])
  assert.ok(layer, `${method.toUpperCase()} ${routePath} 라우트가 없다`)
  return layer.route.stack[0].handle
}

// res 흉내 — status/type/send/json 만 받는다
function 가짜응답() {
  let 끝
  const done = new Promise(r => { 끝 = r })
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    status(c) { this.statusCode = c; return this },
    type(t) { this.headers['content-type'] = t; return this },
    send(b) { this.body = b; 끝(this); return this },
    json(b) { this.body = b; 끝(this); return this },
    writeHead() { throw new Error('등록되면 안 되는 연결이 등록됐다') },
  }
  return { res, done }
}

// ── 1-1 캘린더 콜백: 오류 문자열을 HTML 에 넣지 않는다 ─────────────────────
test('1-1 캘린더 콜백은 error 원문을 돌려주지 않고 고정 안내문(text/plain)만 보낸다', async () => {
  const cb = handlerOf(require('../routes/calendar'), 'get', '/callback')
  const { res, done } = 가짜응답()
  cb({ query: { error: '<script>alert(1)</script>' } }, res)
  await done
  assert.equal(res.statusCode, 400)
  assert.equal(res.headers['content-type'], 'text/plain')
  assert.doesNotMatch(String(res.body), /script|alert/)
  assert.doesNotMatch(read('server/routes/calendar.js'), /\$\{\s*(error|err\.message)\s*\}/,
    '콜백 HTML 에 오류 문자열을 끼워 넣는 자리가 남아 있다')
})

// ── 추가: OAuth state ────────────────────────────────────────────────────
test('추가 OAuth: 발급하지 않은 state 로 돌아온 code 는 교환하지 않는다, 발급한 state 는 한 번만 통과', async () => {
  const cal = require('../services/calendar')
  const cb  = handlerOf(require('../routes/calendar'), 'get', '/callback')
  const { res, done } = 가짜응답()
  cb({ query: { code: '공격자가-받은-code', state: '아무거나' } }, res)
  await done
  assert.equal(res.statusCode, 400)
  assert.equal(cal.consumeAuthState(undefined), false)

  const { getDB } = require('../db/schema')
  getDB().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_client_id', 'test-client')").run()
  const url = new URL(cal.generateAuthUrl(getDB()))
  const state = url.searchParams.get('state')
  assert.match(state, /^[0-9a-f]{32}$/)
  assert.equal(cal.consumeAuthState(state), true)
  assert.equal(cal.consumeAuthState(state), false, '같은 state 를 두 번 쓸 수 있다')
})

// ── 1-2 SSE: 허용되지 않은 출처는 등록 전에 403 ───────────────────────────
test('1-2 SSE 는 * 를 허용하지 않고, 외부 출처는 연결을 등록하기 전에 403 으로 돌려보낸다', async () => {
  assert.doesNotMatch(read('server/services/sse.js'), /'Access-Control-Allow-Origin':\s*'\*'/)
  const sse = require('../services/sse')
  const 전 = sse.clientCount()
  const get = handlerOf(require('../routes/events'), 'get', '/')
  const { res, done } = 가짜응답()
  get({ headers: { origin: 'https://evil.example.com' }, query: {} }, res)
  await done
  assert.equal(res.statusCode, 403)
  assert.equal(sse.clientCount(), 전, '거부된 연결이 이벤트 수신자로 등록됐다')
})

// ── 1-3 날씨: 키를 HTTP 로 보내지 않는다 ─────────────────────────────────
test('1-3 공공데이터 요청은 전부 https 다(되돌림도 없다)', () => {
  for (const f of ['server/services/weather.js', 'server/routes/weather.js', 'server/routes/weatherAlert.js']) {
    assert.doesNotMatch(read(f), /http:\/\/apis\.data\.go\.kr/, `${f} 에 http:// 요청이 남아 있다`)
  }
})

// ── 1-4 CSV 수식 ────────────────────────────────────────────────────────
test('1-4 CSV 글자 칸은 수식으로 읽히지 않고, 진짜 숫자는 숫자로 남는다', () => {
  const { csvCell } = require('../domain/csvCell')
  assert.equal(csvCell('=1+1'), `"'=1+1"`)
  assert.equal(csvCell('+SUM(A1)'), `"'+SUM(A1)"`)
  assert.equal(csvCell('-1+2'), `"'-1+2"`)
  assert.equal(csvCell('@cmd'), `"'@cmd"`)
  assert.equal(csvCell('  =HYPERLINK("x")'), `"'  =HYPERLINK(""x"")"`)
  assert.equal(csvCell('\t=1'), `"'\t=1"`)
  assert.equal(csvCell('점심 안내'), '"점심 안내"')
  assert.equal(csvCell(1.5), '1.5')
  assert.match(read('server/routes/broadcasts.js'), /csvCell/)
})

// ── 1-5 정지 뒤 늦은 시작 ───────────────────────────────────────────────
test('1-5 마이크 시작은 await 마다 회차를 확인하고, 음원 1.3초 타이머는 정지·언마운트에서 걷힌다', () => {
  const ib = read('src/components/easy/InstantBroadcast.jsx')
  assert.match(ib, /const 회차 = \(방송회차\.current \+= 1\)/)
  // 늦은 시작은 **자기가 만든 것을 전부** 닫고, ref 는 아직 자기 것일 때만 비운다(새 시작을 끊지 않게)
  assert.match(ib, /내것\.stream\?\.getTracks\(\)\.forEach\(t => t\.stop\(\)\)/, '늦게 생긴 마이크 스트림을 닫지 않는다')
  assert.match(ib, /const 비우기 = \(ref, v\) => \{ if \(v && ref\.current === v\) ref\.current = null \}/,
    'ref 를 남의 것인지 보지 않고 비운다')
  const 시작부 = ib.slice(ib.indexOf('const startBroadcast'), ib.indexOf('const stopBroadcast'))
  assert.doesNotMatch(시작부, /if \(늦었나\(\)\) return\s*\n/, '자원을 닫지 않고 그냥 물러나는 분기가 있다')
  for (const k of ['stream', 'ctx', 'silent', 'lock', 'vis', 'ws']) {
    assert.ok(시작부.includes(`내것.${k} = `), `${k} 를 내것에 적지 않아 늦었을 때 못 닫는다`)
  }
  assert.match(ib, /useEffect\(\(\) => \(\) => \{ 방송회차\.current \+= 1; cleanup\(\) \}/,
    '화면을 떠날 때 시작 회차를 무효화하지 않는다')
  const mp = read('src/components/easy/MusicPlayer.jsx')
  assert.doesNotMatch(mp, /setTimeout\(\(\) => \{ playURL\(url, name\) \}, 1300\)/, '취소할 수 없는 1.3초 타이머가 남아 있다')
  assert.ok((mp.match(/clearTimeout\(녹음시작Ref\.current\)/g) || []).length >= 3,
    '1.3초 타이머를 걷는 자리(새 재생·정지·언마운트)가 모자란다')
})

// ── 1-6 개발 서버 ───────────────────────────────────────────────────────
test('1-6 Vite 개발 서버 WS 는 출처를 검사하고, 임시 검증 서버는 저장소에 없다', () => {
  const v = read('vite.config.js')
  assert.match(v, /isAllowedUpgrade\(req\)/)
  assert.ok(!fs.existsSync(path.join(ROOT, 'server/verify-harness.tmp.cjs')))
  const h = read('.verify-harness.cjs')
  assert.match(h, /if \(!process\.env\.VERIFY_DB\)/)
  for (const r of ['settings', 'schedules', 'broadcasts', 'audio']) {
    assert.match(h, new RegExp(`읽기만\\('${r}'\\)`), `검증 하네스의 ${r} 쓰기가 열려 있다`)
  }
})

// ── 2-1·3-1·3-2·4-3 문서 ────────────────────────────────────────────────
test('2-1 문서·프롬프트 CC BY 4.0 이 LICENSES.md·README·LICENSE-DOCS 에 있다', () => {
  assert.match(read('LICENSES.md'), /CC BY 4\.0/)
  assert.match(read('README.md'), /\[CC BY 4\.0\]\(LICENSE-DOCS\)/)
  assert.match(read('LICENSE-DOCS'), /creativecommons\.org\/licenses\/by\/4\.0/)
})
test('3-1·3-2·4-3 안내문이 사실과 맞다', () => {
  assert.doesNotMatch(read('README.md'), /검사중지|해시\(Hash\) 예외/)
  assert.doesNotMatch(read('docs/MANUAL-USER.md'), /이 기기에서만/)
  assert.match(read('docs/MANUAL-ADMIN.md'), /설정 저장/)
  for (const f of ['docs/ADOPT.md', 'docs/adopt-published.html']) {
    assert.doesNotMatch(read(f), /개인정보를 다루지 않습니다/)
  }
  assert.doesNotMatch(read('README.md'), /개인정보를 수집하지 않아 \*\*별도 동의 절차 없음\*\*/)
  assert.doesNotMatch(read('src/components/admin/sections/StepList.jsx'), /홀 스피커로는 나가지 않습니다/)
})

// ── 4-1 흐름 TTS 개인정보 ───────────────────────────────────────────────
test('4-1 흐름 저장: TTS 문안의 휴대폰번호는 400, 이름은 409 로 되묻고, 확인하면 통과', () => {
  const { checkFlowText } = require('../routes/flows')
  const 단계 = (content) => [{ step_type: 'tts', config: { content } }]
  assert.equal(checkFlowText(단계('보호자 연락처 010-1234-5678')).status, 400)
  // 한글 IME 전각 모드 — 숫자와 하이픈이 함께 전각으로 들어온다(2026-11-01 검수 High)
  assert.equal(checkFlowText(단계('보호자 연락처 ０１０－１２３４－５６７８')).status, 400)
  assert.equal(checkFlowText(단계('900101－1234567')).status, 400)
  assert.equal(checkFlowText(단계('010−1234−5678')).status, 400)
  assert.equal(checkFlowText(단계('오늘은 김철수 어르신 생신입니다')).status, 409)
  assert.equal(checkFlowText(단계('오늘은 김철수 어르신 생신입니다'), true).ok, true)
  assert.equal(checkFlowText(단계('점심 식사 시간입니다')).ok, true)
  assert.equal(checkFlowText([{ step_type: 'chime', config: {} }]).ok, true)
})
test('4-1 흐름 실행: 차단 항목이 든 TTS 단계는 합성하기 전에 멈춘다', () => {
  const src = read('server/services/flowRunner.js')
  const 검사 = src.indexOf('detectSensitive(text)')
  const 합성 = src.indexOf('generateTTSWithRetry({ text')
  assert.ok(검사 > 0 && 합성 > 0 && 검사 < 합성, '실행 직전 검사가 없거나 합성보다 뒤에 있다')
})
test('추가: 일과방송 안내 문구 저장도 개인정보 검사를 거친다', () => {
  const src = read('server/routes/settings.js')
  const at = src.indexOf("router.post('/broadcast-schedule'")
  assert.ok(at > 0)
  const body = src.slice(at, src.indexOf('\nrouter.', at + 10))
  assert.match(body, /checkSensitive\(/)
  assert.ok(body.indexOf('checkSensitive(') < body.indexOf("setSetting(db, 'lunch_tts'"), '검사가 저장보다 뒤에 있다')
  assert.match(read('src/lib/api.js'), /saveBroadcastSchedule = \(data\) => postWithConfirm/)
})

// ── 4-2 AI 전송 전 번호 가림 ─────────────────────────────────────────────
test('4-2 전각·띄어 쓴 번호도 가리고, 날짜는 건드리지 않는다', () => {
  const { 글가리기, 가리기 } = require('../services/promptPrivacy')
  const 가림 = (s) => 글가리기(s, new Map()).글
  assert.equal(가림('연락 010-1234-5678 주세요'), '연락 [전화번호] 주세요')
  assert.equal(가림('연락 ０１０－１２３４－５６７８'), '연락 [전화번호]')
  assert.equal(가림('연락 0 1 0 - 1 2 3 4 - 5 6 7 8 요'), '연락 [전화번호] 요')
  assert.equal(가림('방 3 010-1234-5678'), '방 3 [전화번호]')
  assert.equal(가림('주민 ９００１０１ １２３４５６７'), '주민 [주민등록번호]')
  assert.equal(가림('오늘 2026-11-01 12:30 점심'), '오늘 2026-11-01 12:30 점심')
  const r = 가리기(JSON.stringify({ text: '연락 ０１０ １２３４ ５６７８' }))
  assert.doesNotMatch(r.본문, /[0-9０-９]{4}/)
  assert.equal(!!r.보류, false)
  // 보류 그물은 가리기 규칙과 **다른** 판정이어야 한다 — 가리기가 못 본 표기에서 켜진다
  for (const 남는것 of ['010·1234·5678', '010_1234_5678', '010/1234/5678', '900101·1234567']) {
    assert.equal(가리기(JSON.stringify({ text: 남는것 })).보류, true, `${남는것} 를 그대로 보낸다`)
  }
  for (const 정상 of ['오늘 2026-11-01 12:30 점심', '11월 01일 점심', '201호 어르신 07:50',
    '2층 201, 202, 203, 204호 어르신 목욕', '3층 301 302 303 304호 어르신', '1층 101호 102호 103호 104호']) {
    assert.equal(!!가리기(JSON.stringify({ text: 정상 })).보류, false, `${정상} 를 헛보류한다`)
  }
  // 두 경계가 같은 번호 찾기 하나를 쓴다(복제하면 한쪽만 고쳐진다 — 2차 검토 4-1 에서 `번호찾기` 로 모음)
  assert.match(read('server/services/promptPrivacy.js'), /번호찾기 \} = require\('\.\/sensitiveInfo'\)/)
  assert.match(read('server/services/geminiClient.js'), /if \(보류\)/, '보류 신호를 보고 전송을 멈추는 자리가 없다')
})

test('추가: 기도문의 「하나님」은 이름으로 잡지 않는다(일과방송 저장마다 헛 확인창)', () => {
  const { checkSensitive } = require('../services/sensitiveInfo')
  assert.equal(checkSensitive('하나님 아버지 오늘 양식에 감사드립니다').ok, true)
  assert.equal(checkSensitive('김철수 어르신 생신입니다').status, 409)
})

// ── 추가: 장치 이름 PowerShell 주입 ──────────────────────────────────────
test('추가: 장치 이름의 둥근 홑따옴표는 저장 때 막고, 이미 저장된 값도 모든 따옴표를 겹쳐 쓴다', () => {
  const { sanitizeDeviceName } = require('../services/audioDevices')
  assert.equal(sanitizeDeviceName('x’); Start-Process calc; #').ok, false)
  assert.equal(sanitizeDeviceName("John's 스피커").ok, true)
  assert.match(read('server/services/audioDeviceWatcher.js'), /replace\(\/\['‘’‚‛\]\/g/)
})

// ── 추가: 기상특보 진단 키 가림 ───────────────────────────────────────────
test('추가: 기상특보 진단은 응답 원문·메시지·오류의 키를 가린 다음에 자른다', () => {
  const src = read('server/routes/weatherAlert.js')
  assert.match(src, /rawBody: 키가리기\(text, key, '\*\*\*'\)\.slice\(0, 800\)/)
  assert.match(src, /error: 키가리기\(err\.message, key/)
  assert.doesNotMatch(src, /rawBody: text\.slice/)
  const { 키가리기 } = require('../domain/keyMask')
  assert.equal(키가리기('serviceKey=abcd1234efgh5678ij', 'abcd1234efgh5678ij', '***'), 'serviceKey=***')
})

// ── 추가: Host 검사(DNS 리바인딩) ────────────────────────────────────────
test('추가: 랜 주소가 아닌 Host 로 온 요청은 막고, 랜·localhost 는 통과한다', async () => {
  const { isAllowedHost, hostGuard } = require('../services/corsOrigin')
  for (const h of ['localhost:3001', '127.0.0.1:3001', '192.168.0.8:3443', '[::1]:3001', 'DESKTOP-AB12:3001', 'carecast.local', undefined]) {
    assert.equal(isAllowedHost(h, { extra: [] }), true, `${h} 를 막았다`)
  }
  for (const h of ['evil.com', '192.168.0.8.evil.com:3001']) {
    assert.equal(isAllowedHost(h, { extra: [] }), false, `${h} 를 통과시켰다`)
  }
  assert.equal(isAllowedHost('pc.lan:3001', { extra: ['https://pc.lan:3443'] }), true, '안전 밸브가 안 듣는다')
  const { res, done } = 가짜응답()
  let 넘김 = false
  hostGuard({ headers: { host: 'evil.com' } }, res, () => { 넘김 = true })
  await done
  assert.equal(res.statusCode, 403)
  assert.equal(넘김, false)
  assert.match(read('server/index.js'), /app\.use\(require\('\.\/services\/corsOrigin'\)\.hostGuard\)/)
})
