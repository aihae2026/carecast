'use strict'
// **이용 조건 동의 기록** — 누가·언제·어느 판에 동의했나 (사용자 지시 2026-10-07).
//
// *"오픈소스 슈퍼토닉 3 이용약관 등 고지 게시하는거 … 약관 동의 할 수 있게"*
//
// ── 무엇을 남기나 ──────────────────────────────────────────────────────────
// 설정 셋(`license_consent_version`·`_by`·`_at`). 표를 새로 만들지 않는다 — 한 기관에 한 줄이면
// 되고, 고칠 때마다 `settings_history` 가 옛 값을 남겨 주므로 「전에 누가 동의했나」도 거기 있다.
//
// ── 무엇을 **하지 않나** ───────────────────────────────────────────────────
// **방송을 막지 않는다**(사용자 결정 2026-10-07: 「처음 설정 + 미동의 알림 띠만」). 그래서 이 값을
// 읽는 곳은 설정 라우트와 화면뿐이다 — 방송 경로가 읽기 시작하면 시험이 빨간불을 낸다
// (`server/test/license-consent.test.js`).
//
// ── 판은 화면이 정한다 ──────────────────────────────────────────────────────
// 동의할 글은 화면(`src/lib/licenseNotice.js`)에 있고, 그 글의 판도 거기 있다. 서버는 받은 판을
// **모양만 보고**(날짜) 적는다. 서버가 판을 따로 들면 글과 판이 두 곳이 되어 한쪽만 바뀐다.
const { rawSetting, writeSetting } = require('./settingsRead')
const { hasBrokenText } = require('./text')

const 키 = { 판: 'license_consent_version', 누가: 'license_consent_by', 언제: 'license_consent_at' }
const 이름상한 = 40
const 판모양 = /^\d{4}-\d{2}-\d{2}$/

/** 지금 기록. 동의한 적이 없으면 null. */
function 읽기(db) {
  const version = rawSetting(db, 키.판) || ''
  if (!version) return null
  return { version, by: rawSetting(db, 키.누가) || '', at: rawSetting(db, 키.언제) || '' }
}

/** 받은 값을 검사한다. 틀리면 { error }, 맞으면 { version, by }. */
function 검사(body) {
  const version = typeof body?.version === 'string' ? body.version.trim() : ''
  const by = typeof body?.by === 'string' ? body.by.trim() : ''
  if (!판모양.test(version)) return { error: '동의한 약관의 판이 없습니다. 화면을 새로고침한 뒤 다시 동의해 주세요.' }
  if (!by) return { error: '동의하는 분의 이름(또는 직책)을 적어 주세요.' }
  if (by.length > 이름상한) return { error: `이름은 ${이름상한}자까지 적을 수 있습니다.` }
  if (hasBrokenText(by)) return { error: '이름의 글자가 깨져 있습니다. 다시 입력해 주세요.' }
  return { version, by }
}

/** 기록한다. 시각은 서버가 찍는다 — 화면 PC 의 시계를 믿지 않는다. */
// 셋을 한 묶음으로 쓴다 — 중간에 실패하면 판은 새것인데 누가·언제는 옛것인 기록이 남는다(검수 1회차 참고).
// `routes/settings.js` 의 감시 설정 저장과 같은 방식이다.
function 쓰기(db, { version, by }, now = new Date()) {
  db.exec('BEGIN')
  try {
    writeSetting(db, 키.판, version)
    writeSetting(db, 키.누가, by)
    writeSetting(db, 키.언제, now.toISOString())
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* 이미 풀렸으면 무시 */ }
    throw err
  }
  return 읽기(db)
}

module.exports = { 읽기, 검사, 쓰기, 키, 이름상한 }
