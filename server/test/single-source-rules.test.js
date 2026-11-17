// 같은 규칙이 두 곳에 따로 적히지 않았는가 (FP-0005, 사용자 지시 2026-09-10 §6).
//
// **무엇을 막나**: 2026-09-10 하루에 여섯 건이 같은 모양이었다 —
//   P-43 수동 재생만 밀림을 안 남김 · P-54 자동방송 경로만 `sinceGen` 을 안 넘김 ·
//   P-83 수동·자동 업데이트가 서로를 모름 · P-84·P-86 되돌리기 가드가 한 경로에만 ·
//   P-31 밀림 문구가 네 자리에 흩어질 참.
// 공통점은 "두 경로가 같은 일을 하는데 규칙이 각자 적혀 있다"이고, 고친 사람은 자기가 보던
// 한 경로만 봤다. **테스트도 그 경로만 봐서 초록이었다.**
//
// **문자열이 같다고 합치지 않는다**(지시 §6). 아래 규칙은 전부 `업무질문` 을 달고 있고,
// 그 질문이 같은 자리만 묶는다. 모양만 같고 뜻이 다른 것은 여기 안 넣는다.
//
// **이 검사는 제품 함수에서 기대값을 가져오지 않는다** — "어디를 봐야 하는가"만 본다.
// 값이 맞는지는 각 기능의 검사가 따로 본다(그쪽이 독립 기대값을 들고 있다).
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const LF = String.fromCharCode(10)
const 소스 = (rel) => fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8')
// 주석은 뺀다 — 머리말이 옛 동작을 설명하느라 그 모양을 그대로 인용하는 파일이 많다.
const 주석뺀 = (t) => t.split(LF).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(LF)
const 본문 = (rel) => 주석뺀(소스(rel))

// 검사기. 소스 한 편과 규칙 하나를 받아 **어긋난 것 목록**을 낸다(비어 있으면 통과).
// 아래 '검사기 자체 시험'이 이 함수를 결함·정상 두 사례로 실제로 돌린다.
const 검사 = (텍스트, 규칙) => {
  const 어긋남 = []
  for (const re of 규칙.있어야) if (!re.test(텍스트)) 어긋남.push(`단일 출처를 안 쓴다: ${re}`)
  for (const re of 규칙.없어야) if (re.test(텍스트)) 어긋남.push(`베껴 적었다: ${re}`)
  return 어긋남
}

const 규칙들 = [
  {
    이름: '밀림 판정',
    업무질문: '이 이력 줄은 "다른 방송이 밀어낸 것"인가?',
    // 문구와 코드 둘 다 그 답을 나른다. 짓는 곳은 domain/broadcastRecord.js 하나다.
    // 2026-09-10(P-97): 두 라우트는 오류 집계 질의가 `오류수` 로 올라가면서 밀림을
    // 직접 안 보게 됐다. 그쪽은 아래 '오류 집계' 규칙이 본다.
    파일: ['services/broadcastSequencer.js', 'services/watchdog.js'],
    있어야: [/밀림(표식|문구|코드)/],
    없어야: [/다른 방송에 밀려 중단됨/, /'preempted'/],
  },
  {
    이름: '오류 집계',
    업무질문: '이 달에 사람이 봐야 할 "오류"가 몇 건인가?',
    // 같은 질의가 두 라우트에 복사돼 있었고, 사유를 더하면서 실제로 한쪽만 고쳤다(P-97).
    // 정본은 domain/broadcastRecord 의 `오류수`, 뺄 사유 목록은 `고장아닌사유`.
    파일: ['routes/status.js', 'routes/broadcasts.js'],
    있어야: [/오류수\(db,/],
    없어야: [/다른 방송에 밀려 중단됨/, /'preempted'/, /'server_down'/, /fail_reason NOT IN/],
  },
  {
    이름: '방송 종류 집계',
    업무질문: '이 이력 줄은 화면의 어느 통계 칸에 세나?',
    // 두 라우트가 각자 목록을 들고 있었고 **이미 서로 달랐다**(UX-34, 2026-09-10) —
    // status.js 는 instant = '즉시' 하나, broadcasts.js 는 '즉시','차임벨','즐겨찾기','AI'.
    // 정본은 domain/broadcastRecord 의 `종류칸`·`종류별집계`.
    파일: ['routes/status.js', 'routes/broadcasts.js'],
    있어야: [/종류별집계\(/],
    // 2026-09-13: `type IN (` **자체**를 금지하던 것을 좁혔다.
    //
    // 방송 로그의 거르개가 통계와 같은 축(묶음)으로 바뀌면서(커밋 33d3a26) `buildFilter` 가
    // **정본 `종류칸` 에서 자리표를 만들어** `type IN (?,?,?)` 를 짓는다. 목록을 베낀 것이
    // 아니라 정본을 펴는 것이라 이 규칙이 막으려던 것과 반대인데, 연산자만 보던 검사가
    // 그것을 "베껴 적었다"로 읽어 빨간불이 나 있었다.
    //
    // **막으려는 것은 낱말을 손으로 적는 것**이다 — 그것만 본다(위 '두 라우트가
    // 종류별집계를 쓴다' 항목이 낱말 여섯을 따로 전수로 막는다).
    없어야: [/type IN \([^)]*'/, /type = '[A-Za-z가-힣]/],
  },
  {
    이름: '업데이트 가능 여부',
    업무질문: '지금 이 트리를 건드려도 되는가?',
    // 수동(routes/update.js)·자동(services/autoUpdate.js)이 서로를 봐야 답이 하나가 된다.
    파일: ['routes/update.js', 'services/autoUpdate.js'],
    있어야: [/isUpdating/, /\[0-9a-f\]\{40\}/, /git merge --abort/],
    없어야: [],
  },
  {
    이름: '이력 기록',
    업무질문: '이 방송이 나갔다고 적어도 되는가?',
    // 서버 스피커로 직접 나가는 두 라우트가 같은 질문에 답한다.
    파일: ['routes/tts.js', 'routes/mic.js'],
    있어야: [/broadcastRecord/],
    없어야: [/INSERT INTO broadcasts/],
  },
  {
    이름: '단계 실패 사유',
    업무질문: '이 단계 이력 줄은 "차임이 실제로 안 울린 것"인가?',
    // 쓰는 쪽(flowRunner)과 세는 쪽(chimeFailStreak)이 같은 문구를 봐야 한다.
    // 문구를 양쪽에 따로 적으면, 사람이 정지한 것까지 장치 고장으로 세어 없는 고장을 신고한다.
    파일: ['services/flowRunner.js', 'domain/stepHistory.js'],
    있어야: [/차임고장인가/],
    없어야: [],
  },
  {
    이름: '단계 결과 어휘',
    업무질문: '단계 실행기가 돌려준 이 값은 무슨 뜻인가?',
    // 흐름과 자동방송이 같은 값을 나른다. 리터럴을 따로 적었다가 대소문자가 어긋나
    // 판정이 통째로 죽은 적이 있다(P-22). 정본은 domain/stepHistory 의 `단계사유`.
    파일: ['services/flowRunner.js', 'services/broadcastSteps.js', 'services/broadcastSequencer.js'],
    있어야: [/단계사유|이력판정/],
    없어야: [/'chime_failed'/, /'nothing_to_play'/],
  },
  {
    이름: '재생 창 판정',
    업무질문: '지금 이 소리를 낼 창이 있는가?',
    // 예약 5경로와 흐름이 **같은 판정**을 봐야 한다. 사본이 생기면 같은 상황에서
    // 예약은 실패로, 흐름은 성공으로 적힌다(P-51).
    파일: ['services/scheduler.js', 'services/flowRunner.js'],
    있어야: [/require\('\.\/sitePlayer'\)/],
    없어야: [/localAliveCount\(\) > 0/],
  },
  {
    이름: '바깥 호출 게이트',
    업무질문: '이 호출을 바깥으로 내보내도 되는가?',
    // 파일마다 helper 를 새로 정의했다가, 그 정의를 무력화하는 변이가 살아남았다.
    // (방송 실행부 셋은 2026-09-21 외부 동영상 호출이 없어져 빠졌다)
    파일: ['routes/weather.js', 'routes/weatherAlert.js'],
    있어야: [/const 바깥막힘 = \(\) => 바깥호출차단\('/],
    없어야: [],
  },
]

for (const 규칙 of 규칙들) {
  test(`${규칙.이름} — 한 곳에서만 정한다 (${규칙.업무질문})`, () => {
    for (const f of 규칙.파일) {
      const 어긋남 = 검사(본문(f), 규칙)
      assert.deepEqual(어긋남, [], `${f}: ${어긋남.join(' / ')}`)
    }
  })
}

test('규칙표가 헐거워지지 않았다 — 목록을 비우면 위 검사가 0건을 돌며 초록이 된다', () => {
  assert.ok(규칙들.length >= 4, `규칙이 ${규칙들.length}개뿐이다`)
  for (const r of 규칙들) {
    assert.ok(r.파일.length >= 2, `${r.이름} 이 파일 ${r.파일.length}개만 본다 — 둘 이상이라야 "두 벌"을 본다`)
    assert.ok(r.있어야.length + r.없어야.length >= 1, `${r.이름} 에 볼 것이 없다`)
    assert.ok(typeof r.업무질문 === 'string' && r.업무질문.length > 0,
      `${r.이름} 에 업무질문이 없다 — 무엇이 같은 규칙인지 못 대면 합칠 근거도 없다`)
  }
})

// 부정 단언 앞의 긍정 앵커 — 정본이 사라지면 위 검사들이 조용히 통과한다.
test('앵커: 밀림·실패 사유의 정본이 domain/broadcastRecord.js 에 있다', () => {
  const 정본 = 본문('domain/broadcastRecord.js')
  assert.match(정본, /const 사유 = \{/, '실패 사유 목록이 사라졌다')
  assert.match(정본, /다른 방송에 밀려 중단됨/, '밀림 문구가 사라졌다 — 정본이 비었다')
})

// ── 날짜·시각 — 이 저장소가 이미 한 번 데인 자리 ────────────────────────
// 업무 질문: **오늘이 며칠인가?** UTC 로 새면 감시가 매일 아침 오경보를 낸다.
// `date-timezone.test.js` 가 목록으로 지키는 규칙이다. 여기서는 **그 목록이 살아 있는지**만
// 본다 — 목록이 비면 그 파일은 0건을 검사하며 초록이 된다(조용한 헐거움).

test('날짜 감시 목록이 헐거워지지 않았다', () => {
  const t = 소스('test/date-timezone.test.js')
  const m = /DATE_WRITING_FILES = \[([\s\S]*?)\n\]/.exec(t)
  assert.ok(m, '날짜 감시 목록을 못 찾았다 — 이 검사의 앵커가 무너졌다')
  const 개수 = (m[1].match(/\['/g) || []).length
  assert.ok(개수 >= 5, `감시 대상이 ${개수}개뿐이다 — 목록에서 파일이 빠졌다`)
})

// ── 검사기 자체 시험 — 잡아야 하는 결함과 통과해야 하는 정상 사례 (지시 §6) ──
// 위 검사들은 실제 소스가 지금 규칙을 지키고 있어서 전부 초록이다. 그것만으로는
// **이 검사기가 결함을 잡을 줄 아는지** 알 수 없다. 그래서 두 사례를 손으로 만들어 돌린다.

const 밀림규칙 = 규칙들.find((r) => r.이름 === '밀림 판정')

test('검사기는 결함을 잡는다 — 문구를 베껴 적은 파일', () => {
  const 결함 = [
    "const { 밀림표식 } = require('../domain/broadcastRecord')",
    "if (row.detail === '다른 방송에 밀려 중단됨') return true",
  ].join(LF)
  const 어긋남 = 검사(주석뺀(결함), 밀림규칙)
  assert.equal(어긋남.length, 1, `문구를 베꼈는데 못 잡았다: ${JSON.stringify(어긋남)}`)
  assert.match(어긋남[0], /베껴 적었다/)
})

test('검사기는 결함을 잡는다 — 단일 출처를 아예 안 쓰는 파일', () => {
  const 결함 = "const detail = row.detail || ''"
  assert.match(검사(결함, 밀림규칙).join(' '), /단일 출처를 안 쓴다/)
})

test('검사기는 정상 사례를 통과시킨다 — 단일 출처만 읽는 파일', () => {
  const 정상 = [
    "const { 밀림표식, 사유코드 } = require('../domain/broadcastRecord')",
    'if (밀림표식(row.detail)) return { 코드: 사유코드(row) }',
  ].join(LF)
  assert.deepEqual(검사(주석뺀(정상), 밀림규칙), [])
})

test('검사기는 주석 속 인용을 결함으로 세지 않는다 — 머리말이 옛 동작을 설명한다', () => {
  const 정상 = [
    "// 예전에는 '다른 방송에 밀려 중단됨' 을 여기서 직접 지었다. 지금은 정본을 읽는다.",
    "const { 밀림표식 } = require('../domain/broadcastRecord')",
  ].join(LF)
  assert.deepEqual(검사(주석뺀(정상), 밀림규칙), [])
})

// ── 이 검사가 하지 않는 것 (지시 §6) ────────────────────────────────────

test('이 파일은 제품 함수에서 기대값을 가져오지 않는다', () => {
  // 규칙이 "어디를 보는가"라 값 비교가 없다. 제품 모듈을 require 하면 그 순간
  // 기대값이 구현을 따라가기 시작한다 — 승인 §6 이 분명히 가른 지점이다.
  // 줄머리의 진짜 require 만 본다(위 예제 문자열 안의 require 는 코드가 아니다).
  // 실패 메시지에 파일 전체가 실리지 않게 매치된 줄만 단언한다.
  const self = fs.readFileSync(__filename, 'utf8')
  const hit = self.match(/^const .*= require\('\.\.\/[^']*'\)/m)?.[0] ?? null
  assert.equal(hit, null,
    `제품 모듈을 불러왔다(${hit}) — 이 파일은 소스 배치만 본다. 값 검증은 각 기능의 검사가 한다`)
})
