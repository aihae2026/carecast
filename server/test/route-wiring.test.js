// 접수창구(routes/)끼리 서로 물건을 꺼내 쓰지 않는다 — 배선 규칙의 회귀 방지.
//
// 왜 필요했나(2026-08-30 배선도): settings.js가 ai.js의 기본 프롬프트를,
// scheduleDrafts.js가 schedules.js의 insertSchedule을 직접 require하고 있었다.
// 라우트 파일은 require 시점에 부작용이 있다(Router 생성, schedules.js의 ALTER 가드).
// 다른 라우트를 당기면 그 부작용의 실행 시점이 로드 순서에 얽히고, 공용 물건이
// 어디 사는지도 흐려진다. 공유할 것은 services/나 domain/으로 내린다.
//
// 검사 방식은 spawn-error-guard.test.js와 같은 소스 정적 검사 — 규칙을 문서가 아니라
// 테스트로 고정해, 새 라우트가 같은 함정을 다시 밟으면 여기서 걸린다.
'use strict'

const fs   = require('fs')
const path = require('path')

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROUTES_DIR = path.join(__dirname, '..', 'routes')

test('routes/ 파일은 다른 routes/ 파일을 require하지 않는다', () => {
  const offenders = []
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    // routes/ 안에서 './이름'은 무조건 이웃 라우트다 (services/domain은 '../'로 올라간다)
    for (const m of src.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
      offenders.push(`${file} → ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [],
    `창구가 창구를 부르고 있다 — 공유물은 services/나 domain/으로 내릴 것:\n  ${offenders.join('\n  ')}`)
})

// domain/은 **DB를 주입받는 순수 규칙 층**이다. db/schema.js가 domain/을 부르므로(볼륨 시딩·
// 음원 폴더 만들기), domain/이 최상위에서 services/를 물면 **db/ → domain/ → services/**로
// 부서가 장부보다 먼저 뜨는 경로가 생긴다. 배선도 ②가 없애려던 그 모양이다.
//
// 지금 있는 것 하나(stepHistory)는 이름을 대고 통과시킨다 — 이 검사의 목적은 **새로 늘지 않게
// 하는 것**이고, 있는 것을 지금 옮기는 것은 별건이다. 함수 안 지연 호출(volume·
// broadcastEstimate·broadcastScheduleRead)은 로드 시점에 안 얽히므로 여기서 안 본다.
test('domain/ 파일은 최상위에서 services/를 require하지 않는다 — db/가 그 위를 지나간다', () => {
  const DOMAIN_DIR = path.join(__dirname, '..', 'domain')
  const 알려진예외 = new Set(['stepHistory.js'])   // 늘리려면 왜인지 여기 적을 것
  const offenders = []
  for (const file of fs.readdirSync(DOMAIN_DIR)) {
    if (!file.endsWith('.js') || 알려진예외.has(file)) continue
    const src = fs.readFileSync(path.join(DOMAIN_DIR, file), 'utf8')
    for (const line of src.split(/\r?\n/)) {
      if (/^(?:const|let|var|import)\b[^\n]*require\(\s*'\.\.\/services\//.test(line)) {
        offenders.push(file + ' → ' + line.trim().slice(0, 60))
      }
    }
  }
  assert.deepEqual(offenders, [],
    `domain/이 최상위에서 부서를 문다(${offenders.join(' / ')}) — 함수 안에서 부르거나, `
    + '그 코드가 services/에 있어야 한다. db/가 이 층을 지나가므로 로드 순서가 얽힌다')
})

// 창구를 갈라 놓는 것만으로는 절반이다 — **둘이 같은 곳을 봐야** 갈라지지 않는다.
//
// 예약 저장은 두 창구가 쓴다: `routes/schedules.js`(사람이 만든 예약)와
// `routes/scheduleDrafts.js`(AI 초안 승인). 공유물을 `services/scheduleStore.js`로 내려서
// 창구가 창구를 안 부르게 했는데, **그 다음 사람이 컬럼 목록을 복사해 자기 INSERT를 쓰면
// 위 검사는 그대로 통과한다**(라우트를 require한 게 아니니까).
//
// 그러면 AI 승인으로 만든 예약만 `bgm_volume`·`main_volume`·`playback_rate`를 조용히
// 빠뜨린 채 저장되고, 사람에게는 **"AI로 넣은 방송만 볼륨·속도가 설정과 다르게 나간다"**로
// 나타난다. 소리 문제인데 원인이 저장 쪽이라 찾는 데 오래 걸린다.
// (scheduleStore.js 머리말이 "route-wiring.test.js가 이 규칙을 고정한다"고 적고 있었는데,
//  2026-09-05까지 고정하던 것은 위 절반뿐이었다.)
test('예약 저장은 두 창구가 같은 곳을 쓴다 — 자기 INSERT를 새로 쓰지 않는다', () => {
  const 창구 = ['schedules.js', 'scheduleDrafts.js']
  for (const file of 창구) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    assert.match(src, /require\(\s*'\.\.\/services\/scheduleStore'\s*\)/,
      `${file}이 services/scheduleStore를 안 쓴다`)
    assert.match(src, /\binsertSchedule\b/, `${file}이 공용 저장 함수를 안 부른다`)
    assert.doesNotMatch(src, /INSERT\s+INTO\s+schedules\b/i,
      `${file}이 예약 INSERT를 스스로 쓴다 — 컬럼 하나가 새면 그 창구로 만든 예약만 조용히 달라진다`)
  }
})

// db/는 제일 아래층이다 — 위층(services/)을 부르면 순환이 된다. 실제로 schema.js가
// 시딩용 문구 상수를 broadcastSequencer(→ morning → schema로 되돌아오는 고리)에서
// 꺼내느라 lazy require로 버티고 있었다(배선도 ②). 순수 상수는 domain/에 둔다.
// (domain/은 DB를 주입받는 순수 규칙 층이라 db/가 참조해도 순환이 없다.)
test('db/ 파일은 services/를 require하지 않는다 — 장부가 부서를 부르면 순환이다', () => {
  const DB_DIR = path.join(__dirname, '..', 'db')
  const offenders = []
  for (const file of fs.readdirSync(DB_DIR)) {
    if (!file.endsWith('.js')) continue
    const src = fs.readFileSync(path.join(DB_DIR, file), 'utf8')
    for (const m of src.matchAll(/require\(\s*['"]([^'"]*\.\.\/services\/[^'"]+)['"]\s*\)/g)) {
      offenders.push(`${file} → ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [],
    `장부(db/)가 부서(services/)를 부르고 있다:\n  ${offenders.join('\n  ')}`)
})

// 방송 심장부의 삼각 순환 금지 — scheduler ↔ flowRunner ↔ broadcastSequencer 셋이 서로를
// lazy require로 부르던 것(배선도 ①)을 풀었다. 공유물의 진짜 집: 설정 해석(resolveBGM·
// loadTTSConfig)은 broadcastConfig.js, 취소·종료 대기 배관은 broadcastGate.js.
// 허용 방향은 scheduler → {sequencer, flowRunner}, sequencer → flowRunner 한쪽뿐이다.
test('flowRunner는 scheduler·broadcastSequencer를 require하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  const bad = [...src.matchAll(/require\(\s*['"]\.\/(scheduler|broadcastSequencer)['"]\s*\)/g)].map(m => m[1])
  assert.deepEqual(bad, [],
    `flowRunner가 위쪽을 다시 부르면 삼각 순환이 되살아난다: ${bad.join(', ')}`)
})

// sse.js는 순수 전송 계층이다. 예전엔 접속 스냅샷을 보내려고 nowPlaying을 역참조해서
// (nowPlaying도 sse를 참조하므로) 서로 lazy require로 합선만 피하는 상호 참조였다 —
// 스냅샷 전송은 두 모듈을 다 아는 routes/events.js의 몫이다(배선도 ③, 2026-08-30).
test('sse.js는 아무 모듈도 require하지 않는다 — 순수 전송 계층', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'sse.js'), 'utf8')
  const deps = [...src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map(m => m[1])
  assert.deepEqual(deps, [],
    `알림선이 상태 모듈을 알기 시작하면 상호 참조가 되살아난다: ${deps.join(', ')}`)
})

// 방송 실행부의 계층 방향 — 2026-09-01에 broadcastSequencer.js(1178줄)를 셋으로 나누면서
// 생긴 **네 번째 배선 규칙**이다(배선도 ①②③에 이은).
//
//   broadcastSequencer → broadcastSteps → broadcastGate
// (그 사이의 broadcastVideoPicker 는 2026-09-21 외부 동영상 연동과 함께 걷어냈다)
//
// 아래층은 위를 부르지 않는다. 이 규칙이 없으면 다음 사람이 broadcastSteps에서
// `DEFAULT_STEPS`나 `mergeStepsWithDefaults`를 쓰려고 시퀀서를 require하기 쉽다 —
// **둘 다 시퀀서에 남아 있어서 자연스럽게 손이 간다.** 그 순간 순환이 되살아나고,
// flowRunner가 겪었던 "resolveBGM이 undefined로 굳는" 사고가 이번엔 stepTTS에서
// 재현된다. 증상은 "정시에 소리가 안 난다"이고 부팅 로그에는 아무것도 안 남는다.
//
// 나눌 때 배관을 아래층으로 먼저 내린 이유가 이것이다. 규칙을 주석에만 두면 지켜지지 않는다.
// **flowRunner는 위층이 아니다.** broadcastSteps는 커스텀 단계를 flowRunner.runStep에
// 위임한다(재구현하지 않으려고). 그 화살표는 **한 방향**이라 순환이 아니다 —
// flowRunner는 이 셋 중 아무것도 require하지 않는다(아래 두 번째 테스트가 그것을 고정한다).
// 처음에 flowRunner까지 금지 목록에 넣었다가 이 사실을 확인하고 뺐다(2026-09-02).
const 실행부_아래층 = ['broadcastSteps.js']

test('방송 실행부의 아래층은 위층을 require하지 않는다 — 순환이 되살아나면 소리가 죽는다', () => {
  const UPPER = /^\.\/(broadcastSequencer|scheduler)$/
  const offenders = []
  for (const file of 실행부_아래층) {
    const p = path.join(__dirname, '..', 'services', file)
    assert.ok(fs.existsSync(p), `전제: ${file}이 있다 — 파일을 옮겼으면 이 목록도 따라와야 한다`)
    const src = fs.readFileSync(p, 'utf8')
    for (const m of src.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
      if (UPPER.test(m[1])) offenders.push(`${file} → ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [],
    `아래층이 위층을 부른다 — 순환이다:\n  ${offenders.join('\n  ')}`)
})

// ── 위임 화살표는 한 방향이다 — **이름 목록이 아니라 그래프로 잰다** (2026-09-14) ──────
//
// 전에는 금지 목록이 `['broadcastSteps.js', 'broadcastVideoPicker.js']` 둘이었고,
// flowRunner 가 그중 **아무것이나** 부르면 빨간불이었다. 그 묶음이 틀렸다 —
// 둘의 사정이 다르다:
//   · `broadcastSteps` **는** flowRunner 를 부른다(커스텀 단계 위임). 그래서 반대 방향은
//     진짜 순환이고, 막는 것이 맞다.
//   · `broadcastVideoPicker` 는 `settingsRead`·`networkMode` 만 부르는 잎이다. flowRunner 에
//     **닿지 않는다.** 그런데도 이름이 목록에 있다는 이유로 막혔다.
//
// 2026-09-14 에 그 오탐에 실제로 걸렸다. 유튜브TV 단계에 계절별 자동을 이으면서 고르는
// 함수를 **사본 없이** 쓰려고 flowRunner 가 picker 를 부른 것인데, 그것이 순환이 아님을
// 실측으로 확인했다(양쪽 순서로 불러도 내보내기 11개·3개가 온전하다).
//
// 그래서 **이름을 세는 대신 닿는지를 잰다.** 규칙의 본디 뜻이 「순환을 막는다」이지
// 「이 파일을 부르지 마라」가 아니었다. 파일이 늘거나 이름이 바뀌어도 이 시험은 안 낡는다.
function 로컬의존(이름) {
  const p = path.join(__dirname, '..', 'services', `${이름}.js`)
  if (!fs.existsSync(p)) return []
  return [...fs.readFileSync(p, 'utf8').matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)].map(m => m[1])
}

// 시작에서 목표까지 닿는 길(services 안의 로컬 require 만 따라간다). 없으면 null.
function 닿는길(시작, 목표) {
  const 본것 = new Set([시작])
  const 줄 = [[시작, [시작]]]
  while (줄.length) {
    const [현, 길] = 줄.shift()
    for (const 다음 of 로컬의존(현)) {
      if (다음 === 목표) return [...길, 다음]
      if (!본것.has(다음)) { 본것.add(다음); 줄.push([다음, [...길, 다음]]) }
    }
  }
  return null
}

test('flowRunner 와 방송 실행부 사이에 순환이 없다 — 위임 화살표는 한 방향이다', () => {
  // flowRunner 를 부르는 모듈은 flowRunner 가 되부르면 안 된다. 그 짝을 **찾아서** 잰다.
  const 실행부 = 실행부_아래층.map(f => f.replace(/\.js$/, '')).concat('broadcastSequencer')
  const 순환 = []
  for (const 이름 of 실행부) {
    const 감 = 닿는길(이름, 'flowRunner')          // 그 모듈 → flowRunner
    const 옴 = 닿는길('flowRunner', 이름)          // flowRunner → 그 모듈
    if (감 && 옴) 순환.push(`${감.join(' → ')}  /  ${옴.join(' → ')}`)
  }
  assert.deepEqual(순환, [],
    '방송 실행부와 flowRunner 가 서로를 부른다 — 순환이고, 예전에 resolveBGM 이 undefined 로 '
    + `굳던 그 사고가 재현된다:\n  ${순환.join('\n  ')}`)

  // **전제가 살아 있나.** 위 시험은 «감»과 «옴»이 둘 다 있어야 걸린다 — 위임 화살표 자체가
  // 사라지면 조용히 통과한다(부정 단언의 함정). 그 화살표가 있다는 것을 여기서 못 박는다.
  assert.ok(닿는길('broadcastSteps', 'flowRunner'),
    'broadcastSteps → flowRunner 위임이 사라졌다 — 커스텀 단계를 다시 구현하고 있지 않은지 볼 것')
})
