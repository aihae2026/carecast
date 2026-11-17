// 자동방송 시각을 읽는 규칙이 **한 벌**인가 (P-35, 사용자 결정 2026-09-08 · AP-0012)
//
// 왜 이 파일이 있나:
//   "자동방송순서편집기에서 시각 칸을 비운다" = **이 방송은 쓰지 않는다**(끄기)로 확정했다.
//   관리자가 지운 시각에 기본값으로 방송이 나가는 것이 요양시설에서 더 큰 사고다 —
//   안 나가는 것보다 **안 나가야 할 것이 나가는 쪽**이 되돌리기 어렵다.
//
//   그런데 같은 설정값을 읽는 방법이 두 벌이었다(2026-09-07 검수, EV-001351):
//     발동부  `raw ?? defaultTime`  → 빈 문자열은 그대로 남아 현재 시각과 안 맞는다 = 안 나감
//     감시·화면 `raw || defaultTime` → 빈 문자열이 기본시각으로 되살아난다 = 매일 누락으로 찍힘
//   그래서 사람이 끄려고 비운 방송이 **안 나가면서 쉬운 화면에 빨간 '누락'으로** 떴다.
//
// 이 파일이 지키는 것은 두 가지다.
//   ① 해석 규칙 자체(autoTime)가 결정대로 동작하는가
//   ② 읽는 자리들이 **그 함수만** 부르는가 — 한 곳만 되돌아가도 조용해지는 것이 이 결함의 성질이라
//      소스를 글자로 대조한다. 가드가 없으면 다음 사람이 `||` 로 되돌려도 아무 테스트도 안 깨진다.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { AUTO_BROADCASTS, autoTime } = require('../domain/autoBroadcasts')

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')

// ── ① 해석 규칙 ────────────────────────────────────────────────────────────

test('키 자체가 없으면(설정을 만든 적 없음) 정의표의 기본 시각을 쓴다', () => {
  const spec = AUTO_BROADCASTS[0]
  assert.equal(autoTime(undefined, spec), spec.defaultTime)
  assert.equal(autoTime(null, spec), spec.defaultTime)
})

test('빈 값으로 저장한 방송은 발동하지 않는다 — 사람이 끈 것이다', () => {
  for (const spec of AUTO_BROADCASTS) {
    assert.equal(autoTime('', spec), null,
      `${spec.id}: 빈 시각이 기본값으로 되살아나면 사람이 끄려던 방송이 ${spec.defaultTime}에 나간다`)
    assert.equal(autoTime('   ', spec), null, `${spec.id}: 공백만 있는 값도 빈 값이다`)
  }
})

test('형식이 깨진 시각도 발동하지 않는다 — 기본값으로 대신 채우지 않는다', () => {
  const spec = AUTO_BROADCASTS[0]
  for (const bad of ['25:00', '7:50', 'abc', '12:60', '1250']) {
    assert.equal(autoTime(bad, spec), null, `"${bad}"는 시각이 아니다`)
  }
})

test('공백이 섞인 값은 다듬지 않고 버린다 — 다듬으면 발동부와 또 갈린다', () => {
  // 발동부(scheduler.js)는 저장된 값을 **문자열 정확일치**로 비교한다. 여기서 `' 09:00'` 을
  // `'09:00'` 으로 고쳐 주면 발동부는 안 내보내는데 감시는 유효로 읽어 매일 누락 경보가 뜬다 —
  // 이 함수가 없애려던 것과 똑같은 종류의 어긋남이다(2026-09-08 독립 검수 지적).
  const spec = AUTO_BROADCASTS[0]
  for (const padded of [' 09:00', '09:00 ', '\t09:00']) {
    assert.equal(autoTime(padded, spec), null,
      `"${padded}" 를 다듬어 되살리면 발동부와 감시가 다른 답을 낸다`)
  }
})

test('제대로 저장된 시각은 그대로 쓴다', () => {
  const spec = AUTO_BROADCASTS[0]
  assert.equal(autoTime('09:00', spec), '09:00')
  assert.equal(autoTime('00:00', spec), '00:00')
  assert.equal(autoTime('23:59', spec), '23:59')
})

// ── ② 읽는 자리가 그 함수만 부르는가 (소스 대조) ──────────────────────────
//
// `assert.doesNotMatch` 만 쓰면 대상이 없는 파일에서도 통과한다(CLAUDE.md "조용하게 죽는다").
// 그래서 파일마다 **긍정 앵커**(autoTime 을 부른다)를 먼저 세우고 부정 단언을 얹는다.

const 읽는_자리 = [
  ['domain/autoBroadcasts.js',        '겹침 경고·자연어 초안·자동업데이트 안전창이 쓰는 목록'],
  ['services/watchdog.js',            '누락 감시'],
  ['routes/schedules.js',             '오늘 일정 화면'],
  ['services/autoShutdown.js',        '자동종료 전에 나갈 방송이 있는지 세는 자리'],
  ['services/prerenderAuto.js',       'TTS 미리 만들기 순서'],
  ['services/broadcastSequencer.js',  '지연 계측의 예정 시각'],
]

for (const [rel, 역할] of 읽는_자리) {
  test(`${rel} 은 시각을 autoTime() 으로만 읽는다 (${역할})`, () => {
    const src = SRC(rel)

    // 긍정 앵커 — 이 파일이 정말 자동방송 시각을 읽는 자리인가
    assert.ok(src.includes('autoTime'),
      `${rel}: autoTime 을 안 부른다 — 옮겼거나 지웠다면 이 목록도 함께 고칠 것`)
    assert.ok(/AUTO_BROADCASTS|spec\.timeKey/.test(src),
      `${rel}: 자동방송 시각을 읽는 자리가 아니다 — 목록에서 뺄 것`)

    // 부정 단언 — 옛 방식이 되살아나지 않았는가
    assert.doesNotMatch(src, /\|\|\s*spec\.defaultTime/,
      `${rel}: \`|| spec.defaultTime\` 이 되살아났다 — 빈 값이 기본시각으로 되살아나 안 나갈 방송이 누락으로 찍힌다`)
  })
}

// ── ③ 화면도 같은 뜻을 보여주는가 (P-40) ──────────────────────────────────
//
// 서버 여섯 곳을 고쳐도 **사람이 보는 자리**가 옛 뜻이면 이 수정은 절반이다.
// 관리자가 시각을 비워 껐는데 편집기 탭에는 여전히 "07:50 아침 종합 방송"으로 보이면,
// 그 사람은 그 방송이 걸려 있다고 믿는다.

test('자동방송순서편집기는 빈 시각을 기본 시각으로 보여주지 않는다 (P-40)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/components/admin/sections/MorningEditor.jsx'), 'utf8')

  // 긍정 앵커 — 이 파일이 정말 자동방송 시각을 보여주는 자리인가
  assert.ok(/defaultTime/.test(src), 'MorningEditor 가 defaultTime 을 안 쓴다 — 이 가드를 옮길 것')
  assert.ok(/autoName|activeTab/.test(src), '자동방송 편집기가 아니다 — 목록에서 뺄 것')

  assert.doesNotMatch(src, /\|\|\s*t\??\.defaultTime|\|\|\s*tab\??\.defaultTime/,
    'MorningEditor 에 `|| defaultTime` 이 남아 있다 — 사람이 끈 방송이 화면에는 기본 시각으로 걸려 보인다(P-40)')
})

test('발동부(scheduler.js)는 예전부터 맞는 쪽이었다 — 되돌아가지 않았는지만 본다', () => {
  // scheduler.js 는 이번 자물쇠 범위 밖이라 고치지 않았다. 이미 `??` 라 동작이 옳다.
  // 여기서 고정하는 것은 "누군가 || 로 바꾸면 빨간불이 난다"는 것뿐이다.
  const src = SRC('services/scheduler.js')
  assert.ok(/AUTO_BROADCASTS/.test(src), 'scheduler.js 가 자동방송 표를 안 본다 — 이 가드를 옮길 것')
  assert.doesNotMatch(src, /\|\|\s*spec\.defaultTime/,
    'scheduler.js 에 `|| spec.defaultTime` 이 생겼다 — 빈 시각 방송이 기본시각에 나간다')
})
