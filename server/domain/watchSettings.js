'use strict'
// **방송 감시·백업 설정 — 규칙의 단일 출처** (2026-09-23).
//
// 이 넷은 서버가 오래전부터 읽고 있었다. 코드 주석마다 「설정으로 바꾼다」고 적혀 있는데
// **바꾸는 칸이 없어** 기본값으로만 돌았다. 화면을 붙이면서 범위·기본값을 여기 한 곳에 둔다 —
// 라우트와 화면이 각자 들고 있으면 둘이 다른 것을 믿게 된다(videoSync.js 머리말과 같은 이유).
//
//   backup_time             매일 DB 백업 시각        기본 04:30 (services/backup.js)
//   watchdog_grace_min      시작 안 한 방송 알림 유예  기본 5분   (services/watchdog.js)
//   watchdog_run_grace_min  안 끝난 방송 알림 유예    기본 60분  (services/watchdog.js)
//   schedule_defer_max_min  방송 중일 때 예약 미룸 상한 기본 10분  (여기 — scheduler.js 가 가져다 쓴다)
//
// **범위는 막으려는 실수만큼만 좁다.** 0 분 유예는 방송이 나가는 1분 사이에 누락 경보를 띄우고,
// 안 끝남 유예가 10분보다 짧으면 아침 종합 방송(40분 넘기도 한다)이 매일 「멈춤」으로 찍힌다.
// 위쪽 끝은 「사실상 알리지 않음」이 되지 않을 만큼이다.

const { rawSetting } = require('./settingsRead')

const DEFAULT_DEFER_MAX_MIN = 10

/**
 * 화면 칸 이름 → 설정 키·범위. 기본값은 각 기능 쪽 상수에서 온다(아래 기본값()).
 * `이름` 은 오류 문구에 그대로 나간다 — 경보 문장·사용 설명서의 말(「안 나감」·「안 끝남」)과 맞춘다
 * (2026-09-23 화면 검수: 「유예」「미룸 상한」은 실무자가 경보와 이어 읽지 못한다).
 */
const 칸들 = {
  graceMin:    { key: 'watchdog_grace_min',     min: 1,  max: 60,  이름: '안 나감 알림까지 기다리는 시간' },
  runGraceMin: { key: 'watchdog_run_grace_min', min: 10, max: 240, 이름: '안 끝남 알림까지 기다리는 시간' },
  deferMaxMin: { key: 'schedule_defer_max_min', min: 1,  max: 60,  이름: '겹친 예약 방송을 기다리는 최대 시간' },
}
const 백업키 = 'backup_time'
const 시각형식 = /^([01]\d|2[0-3]):([0-5]\d)$/

function 기본값() {
  // 감시 기본값은 watchdog.js 가 정본이다 — 여기서 숫자를 다시 적지 않는다.
  const { DEFAULT_GRACE_MIN, DEFAULT_RUN_GRACE_MIN } = require('../services/watchdog')
  const { DEFAULT_TIME } = require('../services/backup')
  return {
    backupTime: DEFAULT_TIME,
    graceMin: DEFAULT_GRACE_MIN,
    runGraceMin: DEFAULT_RUN_GRACE_MIN,
    deferMaxMin: DEFAULT_DEFER_MAX_MIN,
  }
}

/** 미룸 상한(분). scheduler.js 의 옛 규칙 그대로 — 비었거나 0 이하·숫자 아님이면 기본값. */
function 미룸상한(db) {
  const n = parseInt(rawSetting(db, 'schedule_defer_max_min') ?? String(DEFAULT_DEFER_MAX_MIN), 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DEFER_MAX_MIN
}

/**
 * 화면에 보여 줄 **지금 실제로 쓰이는 값**. 각 기능이 읽는 규칙과 같은 규칙으로 읽는다 —
 * 저장된 값이 깨져 있으면 기능은 기본값으로 도는데 화면이 깨진 값을 보여 주면 안 된다.
 */
function 읽기(db) {
  const { 숫자설정 } = require('./settingsRead')
  const 기본 = 기본값()
  const 백업 = rawSetting(db, 백업키)
  return {
    backupTime:  백업 && 시각형식.test(백업) ? 백업 : 기본.backupTime,
    graceMin:    숫자설정(rawSetting(db, 칸들.graceMin.key), 기본.graceMin),
    runGraceMin: 숫자설정(rawSetting(db, 칸들.runGraceMin.key), 기본.runGraceMin),
    deferMaxMin: 미룸상한(db),
    defaults: 기본,
    limits: Object.fromEntries(Object.entries(칸들).map(([k, v]) => [k, { min: v.min, max: v.max }])),
  }
}

/**
 * 요청 본문을 검사한다. **하나라도 틀리면 아무것도 저장하지 않도록** 저장할 것을 먼저 다 모은다.
 * 안 보낸 칸(없음·null·undefined)은 건드리지 않는다(P-115, routes/settings.js `보냈나`).
 * 틀린 칸의 이름(`field`)을 함께 돌려준다 — 화면이 그 칸 바로 아래에 사유를 띄운다.
 * 사유 문장은 조사를 쓰지 않는다(「…시간은/는」은 이름이 바뀔 때마다 틀린다).
 * @returns {{ok:true, 쓸것:Array<[string,string]>, 백업바뀜:boolean} | {ok:false, 사유:string, field:string}}
 */
function 검사(body) {
  const 보냈나 = (f) => body && Object.prototype.hasOwnProperty.call(body, f) && body[f] !== null && body[f] !== undefined
  const 쓸것 = []
  for (const [field, 칸] of Object.entries(칸들)) {
    if (!보냈나(field)) continue
    const 글 = String(body[field]).trim()
    const n = Number(글)
    if (글 === '' || !Number.isInteger(n) || n < 칸.min || n > 칸.max) {
      return { ok: false, field, 사유: `${칸.이름}: ${칸.min}~${칸.max}분 사이의 정수로 적어 주세요.` }
    }
    쓸것.push([칸.key, String(n)])
  }
  let 백업바뀜 = false
  if (보냈나('backupTime')) {
    if (typeof body.backupTime !== 'string' || !시각형식.test(body.backupTime)) {
      return { ok: false, field: 'backupTime', 사유: '백업 시각이 올바르지 않습니다. (예: 04:30)' }
    }
    쓸것.push([백업키, body.backupTime])
    백업바뀜 = true
  }
  return { ok: true, 쓸것, 백업바뀜 }
}

module.exports = { DEFAULT_DEFER_MAX_MIN, 미룸상한, 읽기, 검사 }
