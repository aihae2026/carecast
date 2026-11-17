// **매일 반복 예약도 날짜 칸에서 한 묶음으로 접는다** (사용자 지시 2026-09-14).
//
// ── 왜 ───────────────────────────────────────────────────────────────────────
// 현장의 환기방송은 매일 3쌍(6건)이다. 그것이 날짜마다 여섯 줄로 펼쳐지면 달력이 환기방송으로
// 뒤덮여 **그날 특별한 예약이 안 보인다** — 자동방송 5종을 접은 것과 같은 이유(UX-24).
//
// ── 이 시험이 지키는 것 셋 ───────────────────────────────────────────────────
// ① **이름이 아니라 반복 규칙으로 고른다.** 「환기방송」이라는 글자를 찾으면 이름을 바꾼
//    순간 안 접히고, 다른 시설에서는 아예 안 걸린다.
// ② **자동방송과 겹쳐 세지 않는다.** `_isAuto` 는 이 판정에 들어오지 않는다.
// ③ **접힌 것을 낱개로 또 그리지 않는다.** 그러면 같은 방송이 두 번 세어진다.
//
// 판정 함수는 `.jsx` 안에 있다 — **떼어 내 실제로 돌린다.** 소스를 글자로 읽는 검사는
// 이 저장소에서 이미 여러 번 헛통과했다(V③ R23·R24).
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC  = fs.readFileSync(path.join(ROOT, 'src/components/admin/sections/WeeklySchedule.jsx'), 'utf8')

/**
 * `parseWeekdays` 는 **제품 것을 그대로** 쓴다 — 대역을 세우면 내 대역을 시험하게 된다.
 *
 * **아이콘만 이름을 세워 준다.** `scheduleUtils` 는 최상위에서 lucide 아이콘을 표에 담는데
 * (노드에는 그 모듈이 없다), 우리가 보는 계산은 그것을 **한 번도 안 쓴다.**
 * `instant-broadcast-no-replay.test.js` 와 같은 방식이다.
 */
function 제품의parseWeekdays() {
  const util = fs.readFileSync(path.join(ROOT, 'src/lib/scheduleUtils.js'), 'utf8')
  const 아이콘 = [...util.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*'lucide-react'/gm)]
    .flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean))
  const 대역 = 아이콘.length ? `const ${[...new Set(아이콘)].map(n => `${n} = null`).join(', ')}\n` : ''
  const src = 대역 + util.replace(/^\s*import[^\n]*\n/gm, '')
                        .replace(/\bexport\s+(async\s+)?(function|const|let|class)\b/g, '$1$2')
  return new Function(src + '\n; return parseWeekdays')()
}

/** 제품의 판정 함수 몸통을 떼어 온다. */
function 매일예약인가() {
  const i = SRC.indexOf('function 매일예약인가(s) {')
  assert.ok(i > 0, '긍정 앵커 — 매일 반복 판정 함수가 이 화면에 있다')
  const body = SRC.slice(SRC.indexOf('{', i) + 1, SRC.indexOf('\n}', i))
  return new Function('parseWeekdays', `return (s) => {${body}}`)(제품의parseWeekdays())
}

const 판정 = 매일예약인가()
const 예약 = (w, extra = {}) => ({ repeat_weekdays: w, title: '아무 이름', ...extra })

test('요일 일곱이 다 켜져 있으면 **매일**이다', () => {
  assert.equal(판정(예약([0, 1, 2, 3, 4, 5, 6])), true, '매일 반복을 매일로 안 본다')
  // 저장 형태가 문자열인 경우도 있다(`repeat_weekdays` 가 JSON 문자열로 온다)
  assert.equal(판정(예약('[0,1,2,3,4,5,6]')), true, '문자열로 저장된 매일 반복을 못 읽는다')
})

test('**이름으로 고르지 않는다** — 「환기방송」이 아니어도 매일이면 접는다', () => {
  assert.equal(판정(예약([0, 1, 2, 3, 4, 5, 6], { title: '복도 소등 안내' })), true,
    '이름이 환기방송이 아니라고 안 접는다 — 다른 시설에서는 아예 안 걸린다')
  assert.equal(판정(예약([1, 3, 5], { title: '환기방송' })), false,
    '이름이 환기방송이면 매일이 아니어도 접는다 — 월·수·금 예약이 매일로 둔갑한다')
})

test('매일이 아닌 것은 안 접는다 — 평일·1회성은 그대로 보여야 한다', () => {
  assert.equal(판정(예약([1, 2, 3, 4, 5])), false, '평일 반복을 매일로 본다')
  assert.equal(판정(예약([])), false, '1회성을 매일로 본다 — 그날만의 예약이 묶음에 숨는다')
  assert.equal(판정(예약([0])), false, '일요일만 도는 예약을 매일로 본다')
})

test('**자동방송은 이 묶음에 안 들어간다** — 겹쳐 세지 않는다', () => {
  assert.equal(판정(예약([0, 1, 2, 3, 4, 5, 6], { _isAuto: true })), false,
    '자동방송 5종이 「매일 방송」으로도 세어진다 — 같은 방송이 두 묶음에 잡힌다')
})

// ── 화면 배선 ────────────────────────────────────────────────────────────────
// 아래는 소스 대조다. "접힌 것을 낱개로 **안** 그린다"는 없는 것을 보는 것이라 실행으로는
// 못 본다. 그래서 **긍정 앵커를 먼저 세운다**(CLAUDE.md 「파일을 가를 때」 ②).
test('접힌 것을 낱개로 또 그리지 않는다 — 두 보기 모두', () => {
  const 코드 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드, /<DailyChip items=\{dailyItems\}/, '매일 묶음 칩을 안 그린다')
  // 월간
  assert.match(코드, /batchSchedules\(나머지\.filter\(x => !매일예약인가\(x\)\), 'scheduled_time'\)/,
    '월간에서 접힌 예약을 낱개로도 그린다 — 같은 방송이 두 번 세어진다')
  // 주간
  assert.match(코드, /자동보임 \? 나머지\.filter\(x => !매일예약인가\(x\)\) : 나머지/,
    '주간에서 접힌 예약을 낱개로도 그린다')
})

test('지난 날에는 요약을 안 보인다 — **자동방송과 같은 날짜 기준**이다', () => {
  const 코드 = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(코드, /autoItems=\{지난날\(d\) \? \[\] : autos\}/, '긍정 앵커 — 자동방송의 날짜 기준')
  assert.match(코드, /dailyItems=\{지난날\(d\) \? \[\] : dailies\}/,
    '매일 묶음이 지난 날에도 남는다 — 자동방송과 기준이 갈린다')
  // **감추는 것은 표시뿐이다.** 예약을 지우거나 끄는 자리가 여기 생기면 안 된다.
  assert.doesNotMatch(코드, /지난날\(d\)[^\n]*deleteSchedule|지난날\(d\)[^\n]*active: 0/,
    '지난 날 처리가 예약 데이터를 건드린다 — 표시만 감추라는 지시다')
})
