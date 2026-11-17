'use strict'
// **Codex 통합 검수 SOLO-0917A·0917B·0918 의 화면 Medium 넷** (2026-09-26). 소스를 읽어 고정한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('오늘 일과의 배경음악 선은 편집기와 같은 표(audioCategory)로 판정한다 — 영상 단계 뒤까지 선을 긋지 않는다 (0917A)', () => {
  const src = 코드만(읽기('src/components/home/HomeToday.jsx'))
  // bgmCoverage(bgmLane.bgmRole)는 audioCategory 로 영상·녹음 음원을 알아본다. audioMap 만 주면 둘 다 'other' 다.
  const 호출 = /bgmCoverage\(stepState\.steps, (\S+?)\)/.exec(src)
  assert.ok(호출, '배경음악 선을 그리는 줄 — 대상 앵커')
  const 정의 = new RegExp(`const ${호출[1]} = [^\\n]*`).exec(src)
  assert.ok(정의, `${호출[1]} 의 정의를 못 찾았다`)
  assert.match(정의[0], /audioCategory:\s*AUDIO_STEP_MAP/, '오늘 일과가 bgmCoverage 에 audioCategory 를 안 준다 — 영상이 음악을 꺼도 선이 이어진다')
})

test('처음 안내는 메뉴로 이미 열었으면 준비가 끝났을 때 또 열지 않는다 — 쓰던 초안이 지워지지 않는다 (0917B)', () => {
  const src = 코드만(읽기('src/components/home/HomeTour.jsx'))
  const 시작 = src.indexOf('const 준비끝나면열기 = async')
  assert.ok(시작 > 0, '준비 뒤 여는 함수를 못 찾았다 — 대상 앵커')
  const 본문 = src.slice(시작, src.indexOf('\n    }', 시작) + 6)
  assert.match(본문, /while \(살아있음 && 아직대기\(\)/, '기다리는 동안 대기 표식이 지워졌는지(메뉴로 열었는지) 안 본다')
  assert.match(본문, /setTimeout\(\(\) => \{ if \(아직대기\(\)\) 열기\(\) \}/, '여는 순간에도 대기 표식을 다시 안 본다')
})

test('크게 보기는 저장한 뒤에 먹인다 — 배율 알림을 받은 폭 계산이 옛 배율을 읽지 않는다 (0917B)', () => {
  const src = 코드만(읽기('src/components/home/BigViewButton.jsx'))
  // 단추를 누른 처리기 안에서만 본다 — 위의 `zoom.next`(안내용 임시 배율, 저장 안 함)에도 `먹이기(다음)` 이 있다.
  const 시작 = src.indexOf('const 누름 = () =>')
  assert.ok(시작 > 0, '크게 보기 단추 처리기 — 대상 앵커')
  const 본문 = src.slice(시작, src.indexOf('\n  }', 시작))
  const 저장자리 = 본문.indexOf('저장(다음)'), 먹이기자리 = 본문.indexOf('먹이기(다음)')
  assert.ok(저장자리 > 0 && 먹이기자리 > 0, '저장·먹이기 둘 다 있어야 한다')
  assert.ok(먹이기자리 > 저장자리, '먹이기가 저장보다 먼저다 — useViewWidth 가 이벤트를 받는 순간 옛 저장값을 읽는다')
})

test('날씨 설정은 위경도로 격자·관측소를 바꿔 저장했으면 그렇다고 말한다 — 말없이 「저장 완료」가 아니다 (0918)', () => {
  const src = 코드만(읽기('src/components/admin/sections/apiSettingsWeather.jsx'))
  assert.match(src, /좌표몫 = \{ lat:/, '위경도에서 격자를 다시 계산하는 줄 — 대상 앵커(좌표가 기준이라는 09-18 결정은 유지)')
  assert.match(src, /let 바꿔씀 = false/, '직접 넣은 격자·관측소와 계산값이 다른지 안 본다')
  assert.match(src, /showToast\(바꿔씀 \?/, '다르게 저장했는데도 그냥 「저장 완료」라고만 한다')
})

// ── Codex 0918 가 남긴 TEST_GAP 둘을 여기서 채운다(기존 시험 파일은 건드리지 않는다) ──────────────

test('간편 화면 카드 순서 — **순서를 정하는 칸이 셋(order-1·2·3) 다 있다** (home-card-order-narrow 의 빈 대상 막기)', () => {
  // home-card-order-narrow.test.js 는 order- 가 없는 칸을 건너뛴다. 열림·닫힘 양쪽에서 순서 클래스를 모두 지우면
  // 검사 대상이 사라져 조용히 초록이 된다. 그래서 대상이 있다는 긍정 앵커를 따로 세운다.
  const 코드 = 코드만(읽기('src/pages/HomeMode.jsx'))
  const 쌍 = [...코드.matchAll(/초안열림\s*\n?\s*\?\s*'([^']*)'\s*\n?\s*:\s*'([^']*)'/g)]
  const 순서 = (c) => (c.match(/(?:^|\s)(order-\d)/) || [])[1]
  const 열림 = 쌍.map(([, a]) => 순서(a)).filter(Boolean).sort()
  const 닫힘 = 쌍.map(([, , b]) => 순서(b)).filter(Boolean).sort()
  assert.deepEqual(열림, ['order-1', 'order-2', 'order-3'], `열렸을 때 순서 칸이 셋이 아니다: ${열림}`)
  assert.deepEqual(닫힘, ['order-1', 'order-2', 'order-3'], `닫혔을 때 순서 칸이 셋이 아니다: ${닫힘}`)
})

test('날씨 설정 저장 — **좌표로 계산한 격자·관측소가 화면 값 뒤에 와서 덮는다** (weather-location-save 의 화면 쪽 빈칸)', () => {
  // 좌표가 기준이라는 09-18 결정: 좌표가 있으면 격자·관측소는 계산값이 저장돼야 한다. 순서가 뒤바뀌면
  // 「좌표는 부산, 격자는 옛 시설 자리」가 다시 된다. 덮어쓴 사실을 알리는 것은 위 시험이 본다.
  const src = 코드만(읽기('src/components/admin/sections/apiSettingsWeather.jsx'))
  // 끝은 `...좌표몫` 뒤까지 — 첫 `})` 는 `apiKey.trim() })` 안에 있어 거기서 자르면 너무 짧다.
  const 시작 = src.indexOf('await saveKmaSettings({')
  assert.ok(시작 > 0 && src.indexOf('...좌표몫', 시작) > 시작, '저장 요청을 못 찾았다 — 대상 앵커')
  const 저장 = src.slice(시작, src.indexOf('...좌표몫', 시작) + '...좌표몫'.length)
  const 화면값 = 저장.search(/\bnx, ny, uvStn\b/), 계산값 = 저장.indexOf('...좌표몫')
  assert.ok(화면값 > 0 && 계산값 > 화면값, '좌표 계산값이 화면 값보다 앞이다 — 직접 넣은 격자가 좌표를 이긴다')
  assert.match(src, /좌표몫 = \{ lat: String\(la\), lon: String\(lo\), nx: String\(g\.nx\), ny: String\(g\.ny\), uvStn: uv\.stn \}/,
    '계산값이 격자로()·가까운자외선관측소() 결과가 아니다')
})

// 2026-09-26 Codex 교차검수 1회차 Medium: 꺼 둔 영상 단계가 배경음악 선을 끊었다. 실행기는 꺼진 단계를 건너뛰므로
// (broadcastSequencer `if (!step.enabled) continue`) 음악은 계속 나간다. 켜진 영상은 여전히 선을 끊어야 한다.
test('꺼 둔 영상 단계는 배경음악 선을 끊지 않는다 · 켜진 영상은 끊는다 — 실제로 돌려 본다', () => {
  const { bgmCoverage } = require(path.join(ROOT, 'src', 'lib', 'bgmLane.js'))
  const 표 = { bgmIds: new Set(['bgm']), videoIds: new Set(), audioCategory: { lunch_video: 'lunch-video' } }
  const 단계 = (영상켬) => [
    { id: 'bgm', enabled: true }, { id: 'tts1', enabled: true },
    { id: 'lunch_video', enabled: 영상켬 }, { id: 'tts2', enabled: true },
  ]
  const 꺼짐 = bgmCoverage(단계(false), 표)
  assert.ok(꺼짐[3], `꺼 둔 영상 뒤 안내에 선이 없다 — 실제로는 음악이 계속 나간다: ${JSON.stringify(꺼짐)}`)
  const 켜짐 = bgmCoverage(단계(true), 표)
  assert.equal(켜짐[3], null, `켜진 영상은 음악을 끄는데 뒤 안내에 선이 이어진다: ${JSON.stringify(켜짐)}`)
})
