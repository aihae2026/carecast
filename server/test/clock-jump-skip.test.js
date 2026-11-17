// **시계가 건너뛰면 그 사이 방송이 조용히 사라진다** (현장 사고 2026-09-15).
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
// 현장 PC 시계가 실제보다 2분 늦어 있었다(11:12 ↔ 11:14). 사람이 시간을 자동 동기화하자
// **11:12 → 11:16 으로 뛰었다.** 11:15 점심 식사 전 방송은 그 사이에 있었고,
// **어느 틱도 `11:15` 를 본 적이 없어** 발동되지 않았다.
//
// 발동 조건이 **정확히 일치**이기 때문이다(`scheduled_time = 지금 분`).
// **유예창은 일부러 없다** — 사용자 결정(review/findings.csv CC-002).
// 그 결정은 그대로 둔다. 늦게 나가는 식사 전 안내가 안 나가는 것보다 낫다는 보장이 없고,
// 그건 사람이 정할 일이다. **여기서 고치는 것은 「조용함」이다.**
//
// 화면도 아무 말이 없었다 — 발동이 없으면 이벤트도 없다
// (사용자: *"아무 상황도 인지 못하듯이 계속 멈춰있더라"*).
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_jump_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH
process.env.CARECAST_NO_HARDWARE = '1'

const test   = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')
const 소스 = fs.readFileSync(path.join(ROOT, 'server', 'services', 'scheduler.js'), 'utf8')
const 코드만 = 소스.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('긍정 앵커 — 건너뜀 판정이 스케줄러에 있다', () => {
  assert.match(코드만, /function 건너뛴분들\(/, '건너뜀 판정이 없다')
  assert.match(코드만, /function 놓친방송찾기\(/, '놓친 방송을 세는 자리가 없다')
})

test('**매 분 도는 정상 진행은 아무것도 안 알린다** — 거짓 경보가 제일 비싸다', () => {
  // 건너뜀 판정은 모듈 안에 숨어 있어 직접 못 부른다. 규칙을 **같은 식으로** 재현해
  // 경계값을 고정한다(1분 진행 · 같은 분 · 뒤로 감 · 자정 넘김).
  const 판정 = (이전, 지금) => {
    const 차 = 지금 - 이전
    return (차 <= 1 || 차 > 180) ? [] : Array.from({ length: 차 - 1 }, (_, i) => 이전 + 1 + i)
  }
  assert.deepEqual(판정(11 * 60 + 14, 11 * 60 + 15), [], '1분씩 흐르는 것은 정상이다')
  assert.deepEqual(판정(11 * 60 + 15, 11 * 60 + 15), [], '같은 분을 두 번 봐도 정상이다')
  assert.deepEqual(판정(11 * 60 + 16, 11 * 60 + 12), [], '뒤로 간 시계는 여기서 안 다룬다')
  // 자정 넘김: 23:59(1439) → 00:00(0) 은 음수라 위 규칙에서 빈 배열이다.
  assert.deepEqual(판정(1439, 0), [], '자정마다 거짓 경보가 뜨면 아무도 안 읽는다')
})

test('**그날의 점프가 11:15 를 건너뛴다** — 실제 값으로', () => {
  const 판정 = (이전, 지금) => {
    const 차 = 지금 - 이전
    return (차 <= 1 || 차 > 180) ? [] : Array.from({ length: 차 - 1 }, (_, i) => 이전 + 1 + i)
  }
  const 건너뛴 = 판정(11 * 60 + 12, 11 * 60 + 16)
  const hhmm = 건너뛴.map(m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  assert.deepEqual(hhmm, ['11:13', '11:14', '11:15'])
  assert.ok(hhmm.includes('11:15'), '점심 식사 전 방송 시각이 건너뛴 목록에 있어야 한다')
})

test('**이미 나간 방송은 안 센다** — 사람이 먼저 내보냈을 수 있다', () => {
  // 거짓 경보를 막는 조건이라 소스에서 고정한다. 이 줄이 빠지면 수동으로 먼저 내보낸
  // 방송까지 「안 나갔다」고 알려, 사람이 경보를 안 읽기 시작한다.
  assert.match(코드만, /if \(get\(spec\.firedKey\) === today\) continue/,
    '자동방송의 「오늘 이미 나감」 검사가 없다')
  assert.match(코드만, /if \(s\.last_fired === today\) continue/,
    '예약의 「오늘 이미 나감」 검사가 없다')
  assert.match(코드만, /if \(!shouldRunToday\(s\)\) continue/,
    '오늘 안 도는 예약까지 세고 있다')
})

test('**알리려다 방송을 멈추지 않는다**', () => {
  // 이 저장소의 규칙이다(단계 알림과 같다). 경보가 던져서 틱이 죽으면 그 분의 방송이
  // 통째로 안 나간다 — 막으려던 것보다 나쁘다.
  const m = /const 건너뛴 = 건너뛴분들\(current\)[\s\S]{0,900}?시계 점프 확인 실패/.exec(소스)
  assert.ok(m, '시계 점프 처리가 try/catch 로 감싸여 있지 않다')
})

test('**발동 규칙은 안 바뀌었다** — 유예창을 몰래 만들지 않는다', () => {
  // 사용자 결정(CC-002)이다. 이번 수정은 「알리기」이지 「늦게라도 내보내기」가 아니다.
  assert.match(코드만, /AND scheduled_time = \?/,
    '예약 발동이 더는 정확히 일치가 아니다 — 유예창을 만들었다면 사용자 결정이 필요하다')
  assert.doesNotMatch(코드만, /건너뛴[^\n]*fireSchedule|건너뛴[^\n]*발사/,
    '건너뛴 분의 방송을 여기서 내보내고 있다 — 그건 알리기가 아니라 정책 변경이다')
})
