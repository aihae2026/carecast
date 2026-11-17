// settings 표를 읽고 쓰는 한 곳.
//
// 두 가지를 고친다:
//  1) **매번 다시 prepare하던 것.** `db.prepare('SELECT value FROM settings WHERE key = ?')`가
//     저장소 곳곳에 흩어져 있고, 호출할 때마다 문장을 새로 만들었다. 문장은 안 바뀌는데.
//  2) **한 번에 될 일을 여러 번 묻던 것.** 자연어 예약 문장 하나를 파싱하면 단건 조회가
//     13회 났다 — 일과방송 5종 × (켜짐·시각) + 정성어 볼륨 3단계. 전부 같은 표의 다른 키다.
//
// **캐시하는 것은 준비된 문장이지 값이 아니다.** 값을 캐시하면 볼륨을 바꿔도 다음 방송이
// 옛 값으로 나간다 — 이 시스템에서 가장 알아채기 어려운 종류의 버그다.
//
// 문장은 DB 핸들에 묶인다. WeakMap으로 잡아 두면 DB를 새로 열었을 때(테스트·재시작)
// 옛 핸들의 문장이 따라오지 않는다.
'use strict'

const perDb = new WeakMap()

// 읽기 실패는 삼키고 기본값으로 간다(사용자 결정 2026-09-01 · TD-04) — 설정 하나 때문에
// 요양원 방송이 멈추면 안 된다. 대신 **흔적은 남긴다.** 삼키기만 하면 잘못된 시각·문구로
// 나가는 것을 아무도 모른다.
//
// 발동부가 매분 도는 탓에 같은 실패가 하루 1440줄이 될 수 있다. 같은 키는 1분에 한 줄만 적는다.
const LOG_GAP_MS = 60_000
const lastLoggedAt = new Map()

function noteReadFailure(key, err) {
  const now = Date.now()
  if (now - (lastLoggedAt.get(key) ?? -Infinity) < LOG_GAP_MS) return
  lastLoggedAt.set(key, now)
  console.error(`[설정] 읽기 실패 — 기본값으로 진행합니다: ${key} (${err?.message ?? err})`)
}

function stmtsFor(db) {
  let s = perDb.get(db)
  if (!s) { s = { one: null, many: new Map() }; perDb.set(db, s) }
  return s
}

/** 키 하나. 없으면 null. 조회가 실패해도 던지지 않는다 — 설정 하나 때문에 방송이 멈추면 안 된다. */
function rawSetting(db, key) {
  try {
    return rawSettingStrict(db, key)
  } catch (err) {
    noteReadFailure(key, err)
    return null
  }
}

/**
 * 같은 읽기인데 **실패를 삼키지 않는다.** 없으면 `null`, **못 읽으면 던진다.**
 *
 * 왜 둘이 필요한가(V③ R20 지적 1, 2026-09-14): 위 `rawSetting` 은 «값이 없다» 와
 * «못 읽었다» 를 **둘 다 `null`** 로 만든다. 재생 경로에서는 그게 맞다 — 설정 하나 때문에
 * 방송이 멈추면 안 되니 기본값으로 간다. 그런데 **판정 경로에서는 그 둘이 정반대다.**
 *
 * 실제로 그래서 사고가 났다: 차임 판정이 «TV 볼륨이 0 인가» 를 물었는데, DB 조회가 죽으면
 * `rawSetting` 이 `null` → `readVolume` 이 **기본값 100** → `100 > 0` 이라
 * **못 읽었는데 「소리가 난다」로 단정**해 차임을 막았다. 「모르는 것」이 「참」이 된 것이다.
 *
 * **기존 경로는 그대로 둔다.** 새 경로를 쓰는 쪽만 실패를 보게 된다.
 */
function rawSettingStrict(db, key) {
  const s = stmtsFor(db)
  if (!s.one) s.one = db.prepare('SELECT value FROM settings WHERE key = ?')
  return s.one.get(key)?.value ?? null
}

/**
 * 키 여러 개를 한 번에. 없는 키는 null로 채워 돌려준다 —
 * 있는 것만 주면 호출부마다 `?? null`을 적게 되고, 그중 하나를 빠뜨리면 undefined가 샌다.
 * @returns {Map<string, string|null>}
 */
function rawSettings(db, keys) {
  const out = new Map(keys.map(k => [k, null]))
  if (!keys.length) return out
  try {
    const s = stmtsFor(db)
    // 키 개수마다 문장이 다르다(placeholder 수). 개수별로 하나씩만 만들어 둔다.
    let stmt = s.many.get(keys.length)
    if (!stmt) {
      stmt = db.prepare(
        `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`)
      s.many.set(keys.length, stmt)
    }
    for (const row of stmt.all(...keys)) out.set(row.key, row.value ?? null)
  } catch (err) {
    // 조회 실패는 "값이 없음"과 같게 다룬다(rawSetting과 같은 규칙). 기록도 같은 규칙으로 남긴다.
    noteReadFailure(keys.join(','), err)
  }
  return out
}

/**
 * 키 하나를 쓴다(없으면 넣고, 있으면 덮는다).
 *
 * 같은 upsert 문장이 routes 3곳 + services 5곳에 사설 사본으로 복사돼 있었다
 * (2026-08-31 TD-05). 저장 규칙을 바꿀 일이 생기면 여덟 곳을 다 찾아야 했다.
 *
 * **값은 반드시 문자열로 넣는다.** 읽는 쪽이 전부 문자열을 전제하고
 * (`=== 'true'`, `?? '07:50'`) 비교하기 때문에, 숫자로 들어가면 그 비교가 조용히 어긋난다.
 * 사본 8개 중 6개가 이미 String()을 붙이고 있었고, 안 붙인 두 곳도 실제로는
 * 문자열만 넘기고 있었다(실측: loop_cadence는 DB에 text로 들어가 있다).
 *
 * 읽기와 달리 실패를 삼키지 않는다 — 쓰기가 조용히 실패하면 "오늘 이미 방송했다"
 * 같은 표시가 안 남아 같은 방송이 다시 나갈 수 있다.
 */
/**
 * 설정 하나를 쓴다. **여기가 설정 쓰기의 단일 통로다** — 그래서 변경 기록도 여기서 남긴다
 * (docs/db-retention-design.md 5번). 호출부 117곳을 하나씩 고치지 않아도 되는 이유가 그것이다.
 *
 * @param by 주체. 기본은 '사람'이다 — 대부분의 쓰기가 관리자 화면에서 온다.
 *           서버가 스스로 쓰는 것은 '자동'을 넘긴다(대개 기록 대상도 아니다).
 */
function writeSetting(db, key, value, by = '사람') {
  // 기록은 쓰기 **전에** 옛 값을 봐야 한다. 기록이 실패해도 저장은 그대로 간다.
  let before = null
  try { before = rawSetting(db, key) } catch { /* 못 읽으면 '모름'으로 남는다 */ }

  // **`null`·`undefined` 는 빈 문자열로 넣는다** (P-114, 2026-09-11).
  //
  // 전에는 `String(value)` 였다. 그래서 `null` 이 **`"null"` 이라는 네 글자**로 저장됐다 —
  // [FACT] EV-003971: `POST /api/settings/tts {"voiceNormal":null}` 에 DB 가
  // `"ko-KR-InJoonNeural"` → `"null"` 이 됐다.
  //
  // 왜 나쁜가: `"null"` 은 **빈 문자열이 아니라서** `글자설정()` 도 `?? 기본값` 도 안 걸러
  // 낸다. 그대로 목소리 이름으로 합성에 내려가 안내 방송이 무너진다. "값이 없다" 를
  // 뜻하는 표기는 이 저장소에서 **빈 문자열 하나**다(빈 시각 = 끄기, 빈 장치 = 기본 장치).
  //
  // **글자 `'null'` 을 사람이 일부러 넣은 경우는 그대로 둔다** — 그건 값이지 부재가 아니다.
  // [FACT] EV-003973 — 운영·샌드박스 DB 에 아직 `"null"`·`"undefined"` 가 0건이다.
  // 들어간 것을 치우는 문제가 아니라 **들어가는 길을 막는** 문제다.
  const 저장값 = (value === null || value === undefined) ? '' : String(value)

  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, 저장값)

  require('./settingsHistory').record(db, key, before, 저장값, by)
}

/**
 * 값이 없거나 읽기에 실패했을 때 기본값을 돌려주는 단건 조회.
 *
 * 저장소 곳곳에 `const getSetting = (db, key, def = '') => rawSetting(db, key) ?? def`가
 * 사본으로 흩어져 있다(TD-04 정리 때 호출부를 안 건드리기로 한 결정). 방송 실행부는
 * 2026-09-02에 이 한 줄을 여기로 모았다 — 그 전에는 그것 하나 때문에 `broadcastTokens.js`
 * 라는 경유지가 따로 있었다.
 */
function getSetting(db, key, def = '') {
  return rawSetting(db, key) ?? def
}

/**
 * 숫자 설정을 읽는다 — **0 을 기본값으로 되돌리지 않는다**(P-38, 2026-09-10).
 *
 * 이 저장소는 `Number(getSetting(...)) || 기본값` 을 네 자리에 따로 적고 있었다
 * (`watchdog.js` 세 곳 · `routes/schedules.js` 한 곳). `||` 는 **0 을 falsy 로 삼켜서**,
 * 사람이 유예 0분을 저장하면 **화면엔 0 이 남고 판정은 5분을 쓴다.** 값이 안 먹는 것도
 * 나쁘지만, 화면이 0 이라고 말하는 것이 더 나쁘다 — 사람은 즉시 알림이 켜졌다고 믿는다.
 *
 * 기본값으로 떨어지는 경우는 셋뿐이다: 값이 없다 · 빈 문자열이다 · 숫자로 못 읽는다.
 * 음수도 기본값으로 둔다 — 유예가 음수면 예정 시각 전에 누락을 알린다.
 */
function 숫자설정(raw, 기본값) {
  const s = String(raw ?? '').trim()
  if (s === '') return 기본값
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : 기본값
}

/**
 * **빈 값이면 기본값** — 글자 설정용 (P-113, 2026-09-11).
 *
 * 위 `숫자설정()` 의 짝이다. 그쪽은 `||` 가 0 을 삼키는 것을 막고, 이쪽은 `??` 가
 * **빈 문자열을 통과시키는 것**을 막는다. 이 저장소의 읽는 자리들이 전부
 * `rawSetting(k) ?? 기본값` 인데, `??` 는 `null`·`undefined` 만 걸러서
 * **빈 문자열이 저장돼 있으면 기본값으로 안 떨어진다.**
 *
 * [FACT] EV-003961 — 실제로 그랬다: `tts_voice_normal = ''` 일 때 방송이 쓰는 목소리가
 * `''` 였다(키가 아예 없으면 정상적으로 기본값이 나온다). 목소리 없이 합성에 내려가면
 * 안내 방송이 통째로 무너진다.
 *
 * **아무 설정에나 쓰면 안 된다.** 이 저장소에는 빈 값에 **뜻이 있는** 설정이 여럿이다 —
 * `audio_device` 빈 값 = Windows 기본 장치 · `auto_shutdown_time` 빈 값 = 끄지 않음
 * (AP-0012) · `org_name` 빈 값 = 홀 TV 에 이름 안 그림. 그런 자리에 이걸 쓰면
 * **사람이 일부러 비운 것을 되돌린다.** "빈 값에 뜻이 없는" 설정에만 쓴다.
 *
 * **다듬지 않는다.** `' ko-KR-X '` 를 그대로 돌려준다 — 여기서 공백을 떼면 저장된 값과
 * 쓰는 값이 갈린다(`autoTime()` 이 같은 이유로 다듬기를 거부한다). 다만 **공백만 있는
 * 값은 빈 값으로 본다** — 그건 사람이 지우려다 만 것이지 목소리 이름이 아니다.
 *
 * @param {*} raw     settings 에서 읽은 날것
 * @param {string} 기본값
 */
function 글자설정(raw, 기본값) {
  if (raw === null || raw === undefined) return 기본값
  const s = String(raw)
  return s.trim() === '' ? 기본값 : s
}

module.exports = { rawSetting, rawSettingStrict, rawSettings, writeSetting, getSetting, 숫자설정, 글자설정 }
