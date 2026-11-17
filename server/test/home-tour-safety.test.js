'use strict'
// **처음 안내(N18)는 아무것도 실제로 내보내지 않는다** (사용자 확정 조건 2026-09-17)
//
// *"안내 중에 밝혀진 단추를 눌러도 실제 방송이 나가지 않게 막아야 합니다 … 응 그렇게 해 기억했다가"*
//
// 안내는 **진짜 부품**(검색창·카드·순서 편집기·메뉴·크게 보기)을 움직인다. 그래서 새는 길이 셋이다 —
// ① 사람이 밝힌 단추를 눌러 진짜 단추가 눌린다 ② 안내가 부품에 시킨 동작이 저장·방송을 부른다
// ③ 그래도 새어 나간 쓰기 요청이 서버에 닿는다. 이 파일이 셋을 각각 막는 자리를 고정한다.
//
// 지키는 사실:
//  - `api.js` 의 fetchT 가 안내 중 쓰기(POST·PUT·PATCH·DELETE)를 **fetch 전에** 끊는다. 읽기는 통과한다(실행으로 확인).
//  - 모든 쓰기 창구(apiPost·apiPut·apiPatch·apiDelete)가 fetchT 를 지난다.
//  - 안내 막이 화면 전체 클릭을 받는다 — 밝힌 자리를 누르면 「다음」만 부른다.
//  - 부품이 듣는 무대 동작은 **화면 상태만** 바꾼다 — api 호출·fetch·저장 함수가 없다.
//  - 초기 설정이 세우는 표식과 간편 화면이 읽는 표식이 같은 이름이다.
const path = require('path')
const fs = require('fs')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// `시작` 위치의 여는 괄호부터 짝이 맞는 닫는 괄호까지 잘라 낸다.
// 함수면 **본문** 괄호(`) {`)부터 센다 — `body = {}` 같은 기본값 괄호에 걸리지 않게.
function 괄호덩어리(src, 시작, 함수 = false) {
  const 열기 = 함수 ? src.indexOf(') {', 시작) + 2 : src.indexOf('{', 시작)
  let 깊이 = 0
  for (let i = 열기; i < src.length; i++) {
    if (src[i] === '{') 깊이++
    else if (src[i] === '}' && --깊이 === 0) return src.slice(열기, i + 1)
  }
  throw new Error('괄호가 안 닫혔다')
}

test('**안내 중 쓰기는 fetch 전에 끊긴다** — fetchT 를 그대로 떼어 돌려 본다', async () => {
  const api = 코드만(읽기('src/lib/api.js'))
  const 시작 = api.indexOf('function fetchT(')
  assert.ok(시작 >= 0, 'fetchT 가 없다')
  const 본문 = api.slice(시작, api.indexOf(') {', 시작) + 2) + 괄호덩어리(api, 시작, true)
  // 보고 주소 표와 판정 함수도 그대로 떼어 온다(F1)
  const 표시작 = api.indexOf('const 안내중보고주소 = [')
  const 판정시작 = api.indexOf('function 안내중에도보고(')
  assert.ok(표시작 >= 0 && 판정시작 >= 0, '안내 중 보고 통과 규칙이 없다')
  const 표 = api.slice(표시작, api.indexOf('\n]', 표시작) + 2)
  const 판정 = api.slice(판정시작, api.indexOf(') {', 판정시작) + 2) + 괄호덩어리(api, 판정시작, true)
  let 켜짐 = false
  const 보낸것 = []
  const 가짜fetch = (url, o) => { 보낸것.push(`${o.method || 'GET'} ${url}`); return Promise.resolve({ ok: true }) }
  const fetchT = new Function('안내중', 'fetch', `${표}\n${판정}\n${본문}; return fetchT`)(() => 켜짐, 가짜fetch)

  켜짐 = true
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    await assert.rejects(fetchT('/api/x', { method }), (e) => e.tour === true, `${method} 가 안 막혔다`)
  }
  await fetchT('/api/steps')                         // 읽기는 통과 — 단계 목록을 보여 줘야 한다
  await fetchT('/api/steps', { method: 'GET' })
  assert.deepEqual(보낸것, ['GET /api/steps', 'GET /api/steps'], '안내 중에 쓰기가 fetch 까지 갔다')

  // **이미 나가는 방송의 보고는 통과한다** (독립 검수 F1) — 막으면 서버가 끝 알림을 상한까지 기다려 예약이 밀린다
  보낸것.length = 0
  for (const 주소 of ['/api/morning/audio-ended', '/api/morning/video-ended', '/api/morning/play-started',
    '/api/status/now-playing', '/api/broadcasts', '/api/audio/files/12/duration']) {
    await fetchT(주소, { method: 'POST' })
  }
  assert.equal(보낸것.length, 6, `안내 중에 방송 보고가 막혔다: ${보낸것.join(', ')}`)
  // 소리를 새로 내는 주소는 여전히 막힌다 — 표가 넓어지면 안 된다
  for (const 주소 of ['/api/tts/broadcast', '/api/schedules', '/api/morning/trigger', '/api/broadcasts/5', '/api/audio/files/12/duration/x', '/api/morning/audio-ended-x']) {
    await assert.rejects(fetchT(주소, { method: 'POST' }), (e) => e.tour === true, `${주소} 가 안내 중에 새어 나갔다`)
  }

  켜짐 = false
  await fetchT('/api/schedules', { method: 'POST' })
  assert.equal(보낸것.at(-1), 'POST /api/schedules', '안내가 끝났는데도 쓰기가 막힌다')
})

test('**모든 쓰기 창구가 fetchT 를 지난다** — 맨 fetch 로 쓰는 창구가 없다', () => {
  const api = 코드만(읽기('src/lib/api.js'))
  assert.match(api, /import \{ 안내중 \} from '\.\/tourStage'/)
  for (const 이름 of ['apiPost', 'apiPut', 'apiPatch', 'apiDelete']) {
    const i = api.indexOf(`export async function ${이름}(`)
    assert.ok(i >= 0, `${이름} 가 없다`)
    const 몸 = 괄호덩어리(api, i, true)
    assert.match(몸, /await fetchT\(/, `${이름} 가 fetchT 를 안 지난다`)
    assert.doesNotMatch(몸, /(^|[^\w])fetch\(/, `${이름} 가 맨 fetch 를 쓴다 — 안내 차단을 비껴간다`)
  }
})

test('**안내 막이 화면 전체 클릭을 받는다** — 밝힌 자리를 눌러도 뒤 단추가 안 눌리고, 장도 안 넘어간다', () => {
  const 안내 = 코드만(읽기('src/components/home/HomeTour.jsx'))
  const 막 = 안내.match(/<div className="fixed inset-0 z-\[9500\]" data-cc-tour-layer\s+onClick=\{\(e\) => \{([\s\S]*?)\}\}>/)
  assert.ok(막, '화면 전체를 덮는 안내 막이 없다')
  // 2026-09-17 사용자 신고 「그냥 넘어갈 때가 있어, 2·3번 같이」 — 밝힌 자리 클릭으로 넘기던 것을 뺐다.
  assert.doesNotMatch(막[1], /다음\(\)/, '밝힌 자리를 누르면 넘어간다 — 가상 마우스를 따라 누르면 두 장이 넘어간다')
  assert.doesNotMatch(막[1], /\.click\(\)|dispatchEvent/, '막이 받은 클릭을 진짜 단추로 흘려보낸다')
  assert.doesNotMatch(안내, /pointer-events-none[^"]*" data-cc-tour-layer/, '막이 클릭을 통과시킨다')
  // 켜고 끄는 자리 — 끄는 것은 되돌리기(정리하기)가 다 돈 **뒤**다
  assert.match(안내, /안내켜기\(true\)/)
  const 끝 = 안내.slice(안내.indexOf('const 끝 = useCallback'))
  assert.ok(끝.indexOf('정리하기()') >= 0 && 끝.indexOf('정리하기()') < 끝.indexOf('안내켜기(false)'), '되돌리기 전에 쓰기 차단을 푼다')
})

test('**안내 화면이 사라지면(뒤로가기·주소 이동) 쓰기 차단을 끈다** — 남으면 새로고침 전까지 저장이 다 막힌다 (점검 B-1)', () => {
  const 안내 = 코드만(읽기('src/components/home/HomeTour.jsx'))
  const 정리 = 안내.match(/useEffect\(\(\) => \(\) => \{([^}]*)\}, \[정리하기\]\)/)
  assert.ok(정리, '사라질 때 도는 정리(useEffect cleanup)가 없다')
  assert.match(정리[1], /안내켜기\(false\)/, '사라질 때 쓰기 차단을 안 끈다')
  assert.match(정리[1], /정리하기\(\)/, '사라질 때 연 카드·글씨 크기를 안 되돌린다')
})

test('**부품이 듣는 무대 동작은 화면 상태만 바꾼다** — 저장·방송·fetch 가 없다', () => {
  const 자리들 = [
    'src/components/shared/QuickSchedulePhrase.jsx', 'src/components/shared/FlowBuilder.jsx',
    'src/components/shared/ScheduleModal.jsx', 'src/components/home/HomeBrandMenu.jsx',
    'src/components/easy/InstantBroadcast.jsx', 'src/components/home/BigViewButton.jsx',
    'src/components/home/HomeShell.jsx', 'src/components/home/HomeToday.jsx', 'src/pages/HomeMode.jsx',
  ]
  let 센것 = 0
  for (const p of 자리들) {
    const src = 코드만(읽기(p))
    const i = src.indexOf('useTourStage(')
    assert.ok(i >= 0, `${p} 에 무대 듣기가 없다`)
    const 덩어리 = 괄호덩어리(src, i)
    assert.ok(덩어리.length > 20, `${p} 의 무대 동작이 비어 있다`)
    센것++
    assert.doesNotMatch(덩어리, /(^|[^\w])(fetch|api(Get|Post|Put|Patch|Delete))\(|navigator\.mediaDevices|저장\(|save[A-Z]\w*\(|onSave|onConfirm|확정|fire\w*\(|trigger\w*\(|navigate\(/,
      `${p} 의 무대 동작이 저장·방송·이동을 부른다`)
  }
  assert.equal(센것, 자리들.length)
  // 순서 편집기는 **펼쳐 둔 것만** 안내를 듣는다(창으로 뜬 편집기는 대상이 아니다)
  assert.match(코드만(읽기('src/components/shared/FlowBuilder.jsx')), /useTourStage\(인라인 \? \{/)
})

test('**초기 설정이 세우는 표식 = 간편 화면이 읽는 표식**, 메뉴에서 다시 볼 수 있다', () => {
  const 무대 = 코드만(읽기('src/lib/tourStage.js'))
  const 키 = 무대.match(/export const 안내대기키 = '([^']+)'/)
  assert.ok(키, '안내 대기 표식 이름이 없다')
  const 설정 = 코드만(읽기('src/components/admin/sections/SetupWizard.jsx'))
  assert.ok(설정.includes(`localStorage.setItem('${키[1]}', '1')`), '초기 설정이 다른 이름의 표식을 세운다 — 안내가 안 뜬다')
  const 안내 = 코드만(읽기('src/components/home/HomeTour.jsx'))
  assert.match(안내, /localStorage\.getItem\(안내대기키\) === '1'/)
  assert.match(안내, /localStorage\.removeItem\(안내대기키\)/, '한 번 띄우고 표식을 안 지운다 — 매번 뜬다')
  assert.match(코드만(읽기('src/pages/HomeMode.jsx')), /<HomeTour \/>/)
  const 메뉴 = 코드만(읽기('src/components/home/HomeBrandMenu.jsx'))
  assert.match(메뉴, /label: '처음 안내 다시 보기', to: '#tour'/)
})

test('**안내 중에는 마이크 방송이 시작되지 않고, 키보드로도 막 뒤 단추에 못 간다** (독립 검수 F2)', () => {
  // 목소리는 WebSocket·직접 fetch 로 나가 fetchT 차단을 안 지난다 — 그래서 시작 함수 맨 앞에서 끊는다
  const 마이크 = 코드만(읽기('src/components/easy/InstantBroadcast.jsx'))
  const i = 마이크.indexOf('const startBroadcast = useCallback(async () => {')
  assert.ok(i >= 0, '마이크 시작 함수가 없다')
  const 앞 = 마이크.slice(i, i + 200)
  assert.match(앞, /^const startBroadcast = useCallback\(async \(\) => \{\s*if \(안내중\(\)\) return/, '마이크 시작 맨 앞에서 안내 중인지 안 본다')
  assert.match(마이크, /import \{ useTourStage, 안내중 \} from '\.\.\/\.\.\/lib\/tourStage'/)
  // 막은 마우스만 받는다 — 키보드는 초점을 말풍선 안에 가두고, 밖을 겨눈 Enter·Space 를 버린다
  const 안내 = 코드만(읽기('src/components/home/HomeTour.jsx'))
  assert.match(안내, /e\.key === 'Tab'/, 'Tab 을 가두지 않는다 — 뒤 단추로 초점이 간다')
  assert.match(안내, /\(e\.key === 'Enter' \|\| e\.key === ' '\) && !말풍선\.current\?\.contains\(document\.activeElement\)/, '말풍선 밖 Enter·Space 를 안 버린다')
})

// 2026-09-26(Codex 통합 검수 SOLO-0917A High): 재생 막대(NowPlayingBar)도 window capture 로 키를 듣는다.
// 안내가 말풍선 단추의 Space 는 **일부러 안 막으므로**(단추를 눌러야 하니까) 그 키가 막대에도 가서
// 실제 방송이 일시정지됐다. ESC 도 같다 — 안내를 닫으면서 방송까지 정지시켰다. 둘 다 창 안의 일이라
// 쓰기 차단(api.js)으로는 못 막는다. 그래서 **안내 중에는 막대가 키를 받지 않는다.**
test('**안내 중에는 재생 막대가 Space·ESC 를 받지 않는다** — 말풍선 단추를 누르다 방송이 멈추지 않는다 (SOLO-0917A)', () => {
  const 막대 = 코드만(읽기('src/components/easy/NowPlayingBar.jsx'))
  const 시작 = 막대.indexOf('const onKey = (e) =>')
  assert.ok(시작 > 0, '막대의 키 처리기를 못 찾았다 — 대상 앵커')
  const 본문 = 막대.slice(시작, 막대.indexOf("window.addEventListener('keydown', onKey", 시작))
  const 거름 = 본문.search(/if\s*\(\s*안내중\(\)\s*\)\s*return/)
  const 뜻 = 본문.indexOf('단축키뜻(')
  assert.ok(뜻 > 0, '키 뜻을 가르는 줄을 못 찾았다 — 대상 앵커')
  assert.ok(거름 >= 0 && 거름 < 뜻, '안내 중인지 보기 전에 키를 처리한다 — 말풍선 Space 가 방송을 멈춘다')
  assert.match(막대, /import\s*\{[^}]*안내중[^}]*\}\s*from\s*'[^']*tourStage'/, '안내 표식을 tourStage 에서 읽지 않는다 — 쓰기 차단과 다른 표식을 보면 갈린다')
})
