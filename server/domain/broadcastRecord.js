// 서버 스피커로 직접 나가는 방송(즉시 TTS · 마이크)의 **이력 단일 출처**.
//
// 왜 함수로 뺐나: 두 라우트가 각자 `INSERT` 하고 각자 정정하면 **한쪽만 고치는 일이
// 반드시 생긴다.** 오늘 고친 결함 중 P-43·P-54·P-83·P-84·P-86 이 전부 그 모양이었다.
// 그리고 소스에 글자가 있는지만 보는 검사는 **그 줄을 안 밟게 만드는 변이를 못 잡는다**
// ([FACT] EV-003143 — 실제로 두 변이가 살아남았다). 함수로 빼면 진짜 DB 로 잴 수 있다.
//
// 규칙 하나: **낙관적으로 성공을 넣고, 재생이 거절되면 되돌려 적는다.**
//   · 먼저 넣는 이유 — 프로세스가 죽어도 "시도했다"는 사실은 남아야 한다.
//   · 되돌려 적는 이유 — 소리가 안 났는데 기록만 멀쩡한 것이 이 저장소에서 가장 비싼 실패다.
//   흐름(flowRunner) 쪽도 같은 규칙이다(`flowOutcome.js` 가 나중에 FAILED 로 정정한다).
'use strict'

// **날짜·시각은 단일 출처를 쓴다.** 직접 만들면 UTC 로 새는 자리가 또 생긴다 —
// `date-timezone.test.js` 가 그 규칙을 지키고, 이 파일을 처음 썼을 때 실제로 잡혔다(2026-09-10).
// watchdog 의 판정 날짜와 같은 구현이어야 한다.
//
// **함수 안에서 부른다.** `domain/` 이 최상위에서 `services/` 를 물면
// `db/ → domain/ → services/` 로 부서가 장부보다 먼저 뜬다(`route-wiring.test.js`).
// 이것도 그 검사가 잡았다 — 두 가드가 서로 반대 방향으로 밀어서 답이 하나로 좁혀졌다.
// (아래 함수 안에서 require 한다 — 최상위에 두면 그 가드에 걸린다)

/**
 * 방송 이력 한 줄을 남기고 그 id 를 돌려준다. 실패해도 던지지 않는다 —
 * **이력을 못 남겼다고 방송을 막지는 않는다.** 그 경우 null 이 나오고 정정도 건너뛴다.
 */
function 시작기록(db, { type, content, user = '수동', target = '전체', now = new Date() } = {}) {
  try {
    const { todayStr, nowHHMMSS } = require('../services/repeatSchedule')
    const date = todayStr(now)
    // 이력에는 **초까지** 적는다 — 정시 방송이 몇 초에 나갔는지가 이 제품의 관심사다.
    // 스케줄러가 쓰는 `nowHHMM` 과 일부러 다른 함수다(그쪽에 초가 붙으면 발동이 어긋난다).
    const time = nowHHMMSS(now)
    const r = db.prepare(
      'INSERT INTO broadcasts (date, time, type, content, user, target, success) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(date, time, type, content, user, target, 1)
    return r && r.lastInsertRowid ? Number(r.lastInsertRowid) : null
  } catch (e) {
    console.error('[방송이력] 기록 실패:', e.message)
    return null
  }
}

/** 재생이 거절됐다 — 그 줄을 실패로 되돌린다. id 가 없으면 아무것도 안 한다. */
/**
 * 재생이 거절됐다 — 그 줄을 실패로 되돌린다. id 가 없으면 아무것도 안 한다.
 *
 * 셋째 인자는 **로그용 한 줄**이고, 넷째가 **이력에 남을 사유 코드**다.
 * 코드를 안 주면 칸은 NULL 로 남는다 — "사유를 안 남겼다"이고 '기록 없음'과 같은 뜻이다.
 * 원본 오류 메시지는 **로그에만** 간다. 이력에는 코드만 들어간다(0026, 사용자 지시 §4).
 */
function 실패로정정(db, id, 메모 = '', 코드 = null) {
  if (!id) return false
  const c = 사유코드(코드)
  try {
    if (c) db.prepare('UPDATE broadcasts SET success = 0, fail_reason = ? WHERE id = ?').run(c, id)
    else db.prepare('UPDATE broadcasts SET success = 0 WHERE id = ?').run(id)
    if (메모) console.error(`[방송이력] ${id} 번을 실패로 정정(${c || '사유 미기록'}): ${메모}`)
    return true
  } catch (e) {
    console.error('[방송이력] 정정 실패:', e.message)
    return false
  }
}

/**
 * 아예 시작도 못 한 방송을 실패로 남긴다(TTS 생성 실패 등 — 아직 행이 없는 경우).
 * **실패 기록까지 실패하면 그 방송은 이력에서 통째로 사라진다** — 조용히 넘기지 않는다.
 */
function 실패기록(db, opts = {}) {
  const id = 시작기록(db, opts)
  if (id) 실패로정정(db, id, '', opts.코드 || null)
  return id
}

// ── 밀림 표식 — **네 자리가 이 한 낱말을 본다** ─────────────────────────
// 밀림은 실패가 아니라 **의도된 교체**다. 그런데 이력에는 `success = 0` 으로 남으므로
// (ISSUE-010, 사용자 결정 2026-09-07: 이력에는 남기고 배너는 안 띄운다) 세는 쪽이
// 가리지 않으면 대시보드 "오류" 숫자가 오른다(P-31).
//
// 문구를 네 곳에 베껴 적으면 한 곳만 고치는 날 조용히 어긋난다 — 오늘 고친 결함 중
// 여럿이 그 모양이었다(P-43·P-54·P-83·P-84·P-86). 그래서 여기 한 번만 적는다.
//   쓰는 곳: `services/broadcastSequencer.js`(짓는다) · `services/watchdog.js`(읽어 문구를 가른다)
//            `routes/status.js`·`routes/broadcasts.js`(오류 집계에서 뺀다)
// **`broadcasts` 에 사유 칸이 생기면 이 문자열 짝맞추기는 사라져야 한다**(P-33 과 같은 부채).
const 밀림표식 = '— 다른 방송에 밀려 중단됨'
const 밀림문구 = (본문) => `${본문} ${밀림표식}`

// ── 실패 사유 코드 — **정본은 여기다** (0026, P-95) ─────────────────────
// `success = 0` 은 "안 나갔다"만 말한다. **왜**를 값으로 나른다.
//
// **정해진 코드만 넣는다.** 원본 오류 메시지·토큰·방송 문안을 그대로 저장하지 않는다
// (사용자 지시 2026-09-10 §4). 사유가 목록에 없으면 `기타`로 접는다 — 자유 문자열을
// 이력에 흘리는 것보다 굵게 뭉뚱그리는 편이 안전하다. 자세한 것은 그때 로그에 있다.
const 사유 = {
  밀림:      'preempted',      // 다른 방송이 앞 소리를 밀어냈다 — **실패가 아니라 의도된 교체**
  사람정지:  'human_stop',     // 사람이 정지를 눌렀다
  차임실패:  'chime_failed',   // 차임이 안 울렸다(보조 신호)
  장치없음:  'no_hardware',    // CARECAST_NO_HARDWARE
  통신차단:  'no_network',     // CARECAST_NO_NETWORK
  제한시간:  'timeout',        // 상한까지 안 끝났다
  서버미가동: 'server_down',   // 예정 시각에 서버가 안 떠 있었다 — **고장이 아니다**(P-97)
  확인불가:  'unverified',     // 가동 기록이 없어 위 둘을 못 가른다(P-97)
  화면없음:  'no_site_screen', // 현장 PC 에 소리를 낼 창이 없었다 — **소리가 안 났다**(2026-09-14)
  기타:      'error',          // 그 밖 — **메시지는 안 남긴다**
}

// 화면에 그대로 뜨는 한 줄. **문구도 여기서 짓는다** — 감시와 이력이 따로 적으면 갈린다.
const 미가동표식 = '— 서버 미가동으로 미실행'
const 미가동문구 = (본문) => `${본문} ${미가동표식}`
const 확인불가표식 = '— 가동 기록이 없어 확인 불가'
const 확인불가문구 = (본문) => `${본문} ${확인불가표식}`

// **오류 숫자에서 빼는 사유들.** `success = 0` 이지만 "고장"이 아닌 것들이다 —
// 밀림은 의도된 교체이고(P-31), 서버 미가동은 PC 가 꺼져 있었다는 사실이다(P-97).
// 이 목록이 오류 집계의 단일 출처다(`routes/status.js` 가 읽는다).
const 고장아닌사유 = [사유.밀림, 사유.서버미가동]
const 사유값 = new Set(Object.values(사유))
// 목록에 없는 것은 `error` 로 접는다. null·빈 값은 그대로 null(= 기록 없음)이다.
function 사유코드(v) {
  if (v == null || v === '') return null
  return 사유값.has(v) ? v : 사유.기타
}

/**
 * 그 달의 **'오류'** 개수. `success = 0` 중 **고장 아닌 것**을 뺀다.
 *
 * 왜 여기 있나: 이 질의가 `routes/status.js` 와 `routes/broadcasts.js` **두 곳에 복사**돼
 * 있었다. 2026-09-10 에 서버 미가동 사유를 더하면서 실제로 **한쪽만 고쳤고**, 그것을
 * `fail-reason.test.js` 의 대조 가드가 잡았다 — FP-0005 그대로다. 그래서 질의를 올렸다.
 *
 * `fail_reason` 이 NULL 인 **옛 행**은 그 칸이 생기기 전 기록이라 문구로 뺀다(호환용).
 * 옛 행이 다 정리되면(보관 365일) 자연히 안 쓰인다.
 *
 * @param 월접두 'YYYY-MM' — **null 이면 전체 기간**(화면의 "전체" 보기가 같은 규칙을 쓴다)
 */
function 오류수(db, 월접두) {
  const 자리 = 고장아닌사유.map(() => '?').join(',')
  // **한 구문으로 쓴다.** 기간 분기를 조기 반환으로 나눴더니
  // `dashboard-error-tile-period.test.js` 가 구문 끝을 잘못 잘라 빨간불이 났다 —
  // 가드가 옳았다(그 검사는 "이 질의에 날짜 조건이 있는가"를 본다). 가드를 고치는 대신
  // 여기를 한 구문으로 되돌렸다.
  const 기간 = 월접두 ? 'date LIKE ? AND ' : ''
  const 기간인자 = 월접두 ? [`${월접두}-%`] : []
  return db.prepare(
    `SELECT COUNT(*) as cnt FROM broadcasts WHERE ${기간}success = 0`
    + ` AND (fail_reason IS NULL OR fail_reason NOT IN (${자리}))`
    + ' AND NOT (fail_reason IS NULL AND content LIKE ?)'
  ).get(...기간인자, ...고장아닌사유, `%${밀림표식}%`).cnt
}

// ── 방송 종류 칸 — **정본은 여기다** (UX-34, 2026-09-10) ─────────────────
// 업무 질문: **"이 이력 줄은 화면의 어느 칸에 세나?"**
//
// 왜 올렸나: 같은 질문에 두 라우트가 각자 답했고 **답이 달랐다** —
//   · `routes/status.js`    instant = '즉시' 하나
//   · `routes/broadcasts.js` instant = '즉시','차임벨','즐겨찾기','AI'
// 같은 달 같은 이력을 두 화면이 다르게 셌다. FP-0005 그대로다.
//
// 그리고 **아무도 안 적는 낱말을 세고 있었다.** `'즉시'`·`'즐겨찾기'`·`'AI'` 를 이력에
// 쓰는 자리가 코드에 0건이라([FACT] EV-003493) 화면의 "즉시" 칸은 구조적으로 언제나 0 이었다.
// 실제로 적히는 낱말은 이렇다:
//   'TTS'(routes/tts.js) · '마이크'(routes/mic.js) · '차임벨'(mic/tts) ·
//   '예약'(scheduler) · '자동'(broadcastSequencer·watchdog) · 'BGM'(routes/audio.js /bgm/now) ·
//   '특보'(scheduler) · '경보'(services/alert.js) · '시스템'(switchbot)
//
// **'경보'·'시스템'·'특보'는 칸에 안 넣는다.** 소리가 아니라 기록이다 — 세면 총계가 부푼다.
// 옛 낱말('즉시'·'즐겨찾기'·'AI')은 **옛 행 호환으로만** 남긴다. 새로 쓰이지는 않는다.
const 종류칸 = {
  instant: ['즉시', '차임벨', '즐겨찾기', '마이크'],  // 사람이 지금 눌러서 나간 것
  tts:     ['TTS', 'AI'],                            // 글을 음성으로
  bgm:     ['BGM'],                                  // 배경음악 단독
  auto:    ['자동', '예약'],                          // 시스템이 알아서 낸 것
}
// 자동 칸 안에서 **자동방송 5종과 일반 예약을 가를 수 있어야 한다** — 합쳐만 놓고 못 가르면
// "자동방송이 몇 번 나갔나"에 답할 수 없다(UX-24 가 캘린더에서 같은 것을 묻는다).
const 자동낱말 = ['자동']
const 예약낱말 = ['예약']

/**
 * 그 달(또는 전체)의 **종류별 성공 건수**. 화면 통계 칸의 단일 출처다.
 *
 * 실패한 줄은 안 센다 — 안 나간 방송을 실적으로 세지 않는다. 오류는 `오류수()` 가 따로 센다.
 *
 * @param 월접두 'YYYY-MM' — **null 이면 전체 기간**(화면의 "전체" 보기)
 * @returns {{instant:number, tts:number, bgm:number, auto:number, autoOnly:number, scheduledOnly:number}}
 */
function 종류별집계(db, 월접두) {
  const rows = 월접두
    ? db.prepare('SELECT type, COUNT(*) as cnt FROM broadcasts WHERE date LIKE ? AND success = 1 GROUP BY type')
        .all(`${월접두}-%`)
    : db.prepare('SELECT type, COUNT(*) as cnt FROM broadcasts WHERE success = 1 GROUP BY type').all()
  const 세기 = (낱말들) => rows
    .filter((r) => 낱말들.includes(r.type))
    .reduce((sum, r) => sum + r.cnt, 0)
  const out = {}
  for (const [칸, 낱말들] of Object.entries(종류칸)) out[칸] = 세기(낱말들)
  out.autoOnly      = 세기(자동낱말)
  out.scheduledOnly = 세기(예약낱말)
  return out
}

module.exports = {
  시작기록, 실패로정정, 실패기록, 오류수, 종류칸, 종류별집계,
  밀림표식, 밀림문구, 미가동표식, 미가동문구, 확인불가표식, 확인불가문구,
  사유, 사유값, 사유코드, 고장아닌사유,
}
