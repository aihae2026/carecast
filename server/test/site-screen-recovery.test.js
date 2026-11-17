// **현장 화면이 닫히면 감시 루프가 다시 연다** (현장 사고 2026-09-14).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 18:00 저녁 마무리가 **소리 없이** 지나갔다. 화면에는 재생 표시가 떴다. 환기방송도 같았다.
// `/api/health` 가 `localClients: 0` 이었다 — **현장 PC 에 localhost 로 열린 창이 하나도
// 없었다.** 예약 TTS·녹음 음원·BGM·영상은 **브라우저**가 재생하고, 그 판정은
// `src/lib/isLocal.js` 가 `['localhost','127.0.0.1']` 로 한다. 랜 주소(`192.168.0.8`)로
// 연 창은 **화면만 그리고 소리는 안 낸다.**
//
// 왜 창이 없었나: 감시 루프(`carecast-loop.bat`)가 앱 창을 **딱 한 번만** 열었다
// (`if not defined CC_OPENED`). 그 창이 닫히면 서버가 재시작해도 다시 열리지 않는다.
// 서버는 아무도 없는 곳에 계속 방송을 내보냈다.
//
// ── 이 시험의 한계 ──────────────────────────────────────────────────────────
// **소스 대조다.** bat 을 실제로 돌리려면 서버를 띄우고 브라우저를 열어야 해서, 검수 PC 에
// 실제 창이 뜬다(실부작용). 그래서 여기서는 **규칙이 파일에 남아 있는지**까지만 본다.
// 실제 재개 동작은 사람이 현장에서 확인한다(MT). 그 사실을 숨기지 않는다.
// 부정 단언 앞에는 **긍정 앵커**를 세운다 — 감시할 대상이 이 파일에 있는지부터 본다.
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const BAT  = fs.readFileSync(path.join(ROOT, 'scripts', 'carecast-loop.template.bat'), 'utf8')
const 줄들 = BAT.split(/\r?\n/).map(l => l.trim())

test('긍정 앵커 — 창을 여는 자리가 이 파일에 있다', () => {
  assert.ok(줄들.includes(':openwin'), '창을 여는 자리(:openwin)가 없다 — 시험이 볼 대상이 없다')
  const 여는줄 = 줄들.filter(l => l.startsWith('start "" "%CC_EDGE%"'))
  assert.equal(여는줄.length, 1, `창을 여는 줄이 ${여는줄.length}개다 — 한 곳이어야 규칙도 한 곳이다`)
  assert.match(여는줄[0], /--app=http:\/\/localhost:3001/,
    '현장 창을 localhost 가 아닌 주소로 연다 — 그 창은 화면만 그리고 소리를 안 낸다')
  assert.match(여는줄[0], /--autoplay-policy=no-user-gesture-required/,
    '자동재생 허용이 빠졌다 — 사람이 안 누르면 예약 방송이 안 울린다')
})

test('**한 번만 열고 마는 방식이 아니다** — 닫히면 다시 연다', () => {
  // 옛 방식: 여는 곳이 `if not defined CC_OPENED` 안에만 있었다. 그러면 그 창이 닫힌 뒤로는
  // 영영 안 열린다. 지금은 부르는 자리가 **둘**이어야 한다 — 첫 기동, 그리고 재개.
  const 부르는곳 = 줄들.filter(l => l === 'call :openwin')
  assert.ok(부르는곳.length >= 2,
    `창을 여는 호출이 ${부르는곳.length}곳뿐이다 — 창이 닫히면 아무도 다시 안 연다(2026-09-14 현장 사고)`)
})

test('**창이 없다는 판정은 서버 숫자로** 한다 — 루프가 따로 짐작하지 않는다', () => {
  assert.ok(줄들.some(l => l.startsWith('findstr') && l.includes('localClientsAlive')),
    '현장 창 유무를 안 본다 — 무엇을 보고 다시 열지가 없다')
  // 그 숫자는 health 응답에서 온다. **health 호출은 여전히 하나**여야 한다(CC-012 규칙).
  const health = 줄들.filter(l => l.startsWith('curl ') && l.includes('/api/health'))
  assert.equal(health.length, 1, 'health 호출이 늘었다 — 생존 판정 규칙이 흐려진다')
  assert.match(health[0], /-f /, '-f 없이는 503 도 성공으로 읽힌다')
  assert.match(health[0], /-o cc-health\.tmp/,
    '응답 본문을 안 받아 둔다 — 그러면 창 유무를 보려고 curl 을 한 번 더 불러야 한다')
})

test('한 번 걸렀다고 바로 열지 않는다 — 3연속이어야 한다', () => {
  // 서버가 재시작하는 동안 잠깐 0 이 된다. 그때마다 창을 열면 재시작마다 창이 하나씩 는다.
  assert.equal(줄들.filter(l => /^set \/a SFAIL=SFAIL\+1$/.test(l)).length, 1)
  assert.ok(줄들.includes('if %SFAIL% LSS 3 goto waitstop'),
    '연속 3회 확인 없이 곧바로 창을 연다')
  assert.ok(줄들.filter(l => l === 'set SFAIL=0').length >= 2,
    '창이 돌아오면 셈을 0 으로 되돌려야 한다 — 안 그러면 며칠에 걸쳐 쌓인다')
})

test('다시 연 뒤에는 **쉬어 간다** — 창이 쌓이지 않는다', () => {
  // 창은 떴는데 연결이 안 되는 경우가 있다(프로필 잠김 등). 그때 15초마다 다시 열면
  // 현장 PC 화면이 창으로 뒤덮인다 — 막으려던 것보다 나쁘다.
  assert.ok(줄들.some(l => /^set SCOOL=\d+$/.test(l) && Number(l.split('=')[1]) > 0),
    '다시 연 뒤 쉬는 구간이 없다 — 연결이 안 되면 창이 계속 쌓인다')
  assert.ok(줄들.includes('if %SCOOL% GTR 0 goto cooldown'), '쉬는 구간을 아무도 안 본다')
  assert.equal(줄들.filter(l => /^set \/a SCOOL=SCOOL-1$/.test(l)).length, 1,
    '쉬는 구간이 안 줄어든다 — 한 번 쉬면 다시는 안 연다')
})

test('여전히 ASCII 만이다 — 한글이 들어가면 5초마다 깨진다', () => {
  const 걸린줄 = []
  BAT.split(/\r?\n/).forEach((l, i) => { if ([...l].some(c => c.codePointAt(0) > 127)) 걸린줄.push(i + 1) })
  assert.deepEqual(걸린줄, [],
    'ASCII 아닌 글자가 들어갔다 — cmd 가 바이트로 세어 글자 중간에 떨어진다(2026-09-04 실측)')
})
