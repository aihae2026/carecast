// Google Calendar OAuth2 서비스 (googleapis 패키지 없이 raw fetch로 구현)
// 토큰은 settings 테이블에 저장, 만료 시 자동 갱신

function getSetting(db, key, def = '') { return rawSetting(db, key) ?? def }

// settings 쓰기는 domain/settingsRead 한 곳을 쓴다 — 같은 upsert가 8곳에 복사돼 있었다(TD-05).
const { rawSetting, writeSetting: setSetting } = require('../domain/settingsRead')
const { networkDisabled, noticeOnce: netNotice, blockedError } = require('./networkMode')

// 구글에 나가는 fetch 셋(토큰 교환·토큰 갱신·일정 조회)의 제한시간. 셋이 같은 값을 쓴다.
// 왜 있나(ISSUE-004, 2026-09-06): 아침 종합 방송(07:50)이 morning.js 에서 무인으로 getTodayEvents 를
// 부르는데, 토큰 갱신 fetch 에 signal 이 없어 구글이 **응답을 안 주면**(오류가 아니라 무응답)
// 약속이 영영 안 끝나고 방송이 멈춘 채 60분 뒤에야 감시 경보가 떴다. 제한시간에 걸리면 던지므로
// morning.js 의 catch 가 잡아 "캘린더 일정 조회 실패" 경보를 내고 일정 안내만 뺀 채 방송은 나간다.
// server/test/calendar-token-refresh-timeout.test.js 와 fetch-timeout.test.js 가 고정한다.
// 이름이 `TOKEN_` 이었는데 **일정 조회까지** 지배한다(P-20, 2026-09-08). 이름만 읽고
// "토큰만 걸려 있구나" 하면 일정 조회는 무방비라고 오해한다. 범위대로 부른다.
// 값(10초)은 아침 방송이 구글 무응답에 얼마나 멈춰 있을 수 있는지를 정한다 —
// calendar-timeout-value-and-message.test.js 가 그 숫자를 고정한다.
const GOOGLE_TIMEOUT_MS = 10000

/**
 * 구글 호출 하나를 돌리고, **무응답이면 사람이 읽을 말로 바꿔** 던진다 (P-20).
 *
 * `AbortSignal.timeout` 이 던지는 것은 `The operation was aborted due to timeout` 이다.
 * 그 문장이 `morning.js:209` 를 거쳐 **현장 직원이 보는 배너에 그대로** 떴다.
 * `geminiClient.js:47` 이 같은 상황을 한국어로 바꿔 주는 선례다.
 *
 * 다른 오류(401·네트워크 등)는 그대로 올려보낸다 — 원인이 다르면 문구도 달라야 한다.
 */
async function fetchGoogle(url, options = {}) {
  // 구글 호출은 전부 이 함수를 지난다 — 토큰 갱신도 포함이다(ISSUE-004 의 그 자리).
  if (networkDisabled()) { netNotice('캘린더'); throw blockedError('구글 캘린더 호출') }
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) })
  } catch (err) {
    if (err?.name === 'TimeoutError' || /aborted due to timeout/i.test(err?.message || '')) {
      throw new Error(
        `구글 캘린더가 ${Math.round(GOOGLE_TIMEOUT_MS / 1000)}초 안에 응답이 없습니다.`,
        { cause: err })
    }
    throw err
  }
}

// ─────────────────────────────────────────────────────────
// OAuth2 인증 URL 생성 (1단계: 사용자 인증 페이지로 유도)
// ─────────────────────────────────────────────────────────
// **OAuth `state` — 우리가 시작한 연결인지 콜백에서 확인한다**(추가 점검 2026-11-01).
// state 없이 code 만 받으면, 남이 **자기 Google 계정**으로 받은 code 를 콜백 주소에 붙인 링크를 직원이
// 여는 것만으로 그 계정이 연결된다 — 그 사람이 자기 캘린더에 적은 글이 다음 날 아침 방송으로 나간다.
// 인증 주소를 만들 때 무작위 값을 서버 메모리에 짧게(10분) 두고, 콜백에서 한 번만 쓰고 지운다.
// 서버를 다시 켜면 비워진다 — 그때는 「다시 연결」을 누르면 된다(연결은 드문 일이다).
const STATE_TTL_MS = 10 * 60 * 1000
const 대기중state = new Map()   // state → 만료 시각(ms)
function 오래된state지우기(now = Date.now()) {
  for (const [s, 만료] of 대기중state) if (만료 <= now) 대기중state.delete(s)
}
/** 콜백의 state 가 우리가 발급한 것이면 true — **한 번 쓰면 지운다**(같은 링크를 두 번 못 쓴다). */
function consumeAuthState(state) {
  오래된state지우기()
  if (typeof state !== 'string' || !대기중state.has(state)) return false
  대기중state.delete(state)
  return true
}

function generateAuthUrl(db) {
  const clientId    = getSetting(db, 'gcal_client_id', '')
  const redirectUri = getSetting(db, 'gcal_redirect_uri', 'http://localhost:3001/api/calendar/callback')
  if (!clientId) throw new Error('Google Client ID가 설정되지 않았습니다.')

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.readonly',
    access_type:   'offline',
    prompt:        'consent',  // 매번 refresh_token 발급 보장
  })
  오래된state지우기()
  const state = require('crypto').randomBytes(16).toString('hex')
  대기중state.set(state, Date.now() + STATE_TTL_MS)
  params.set('state', state)
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// ─────────────────────────────────────────────────────────
// 인증 코드 → 액세스/리프레시 토큰 교환 (2단계: 콜백 처리)
// ─────────────────────────────────────────────────────────
async function exchangeCode(code, db) {
  const clientId     = getSetting(db, 'gcal_client_id', '')
  const clientSecret = getSetting(db, 'gcal_client_secret', '')
  const redirectUri  = getSetting(db, 'gcal_redirect_uri', 'http://localhost:3001/api/calendar/callback')

  const res = await fetchGoogle('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  })
  const tokens = await res.json()
  if (tokens.error) throw new Error(tokens.error_description ?? tokens.error)

  // 토큰을 DB에 영구 저장
  setSetting(db, 'gcal_access_token', tokens.access_token)
  setSetting(db, 'gcal_token_expiry', String(tokens.expiry_date ?? (Date.now() + (tokens.expires_in ?? 3600) * 1000)))
  if (tokens.refresh_token) setSetting(db, 'gcal_refresh_token', tokens.refresh_token)

  return tokens
}

// ─────────────────────────────────────────────────────────
// access_token 갱신 (refresh_token으로 자동 갱신)
// ─────────────────────────────────────────────────────────
async function refreshAccessToken(db) {
  const refreshToken = getSetting(db, 'gcal_refresh_token', '')
  const clientId     = getSetting(db, 'gcal_client_id', '')
  const clientSecret = getSetting(db, 'gcal_client_secret', '')
  if (!refreshToken) throw new Error('refresh_token이 없습니다. Google Calendar를 다시 연동해주세요.')

  const res = await fetchGoogle('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
    }),
  })
  const tokens = await res.json()
  if (tokens.error) throw new Error(tokens.error_description ?? tokens.error)

  const newToken = tokens.access_token
  setSetting(db, 'gcal_access_token', newToken)
  setSetting(db, 'gcal_token_expiry', String(Date.now() + (tokens.expires_in ?? 3600) * 1000))
  return newToken
}

// 유효한 access_token 반환 — 만료 5분 전이면 자동 갱신
async function getValidToken(db) {
  const accessToken = getSetting(db, 'gcal_access_token', '')
  if (!accessToken) return null

  const expiry = parseInt(getSetting(db, 'gcal_token_expiry', '0'))
  // 만료 5분 전부터 미리 갱신
  if (expiry && Date.now() + 5 * 60 * 1000 > expiry) {
    return await refreshAccessToken(db)
  }
  return accessToken
}

// ─────────────────────────────────────────────────────────
// 오늘 일정 조회
// ─────────────────────────────────────────────────────────
async function getTodayEvents(db) {
  const token = await getValidToken(db)
  if (!token) return null  // 미연동 상태

  const calendarId = getSetting(db, 'gcal_calendar_id', 'primary')

  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()

  const params = new URLSearchParams({
    timeMin: start, timeMax: end,
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '10',
  })

  const res  = await fetchGoogle(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)

  return (json.items ?? []).map(e => ({
    title:    e.summary ?? '(제목 없음)',
    start:    e.start.dateTime ?? e.start.date,
    isAllDay: !e.start.dateTime,
  }))
}

// 연동 여부 확인 (refresh_token 존재 여부로 판단)
function isConnected(db) {
  return !!getSetting(db, 'gcal_refresh_token', '')
}

// 연동 해제 — 저장된 토큰 전부 삭제
function disconnect(db) {
  for (const key of ['gcal_access_token', 'gcal_refresh_token', 'gcal_token_expiry']) {
    try { db.prepare('DELETE FROM settings WHERE key = ?').run(key) } catch { /* 연동 해제는 남은 키를 최대한 지우는 것이 목적이다 — 한 키가 실패해도 나머지를 계속 지운다 */ }
  }
}

module.exports = { generateAuthUrl, consumeAuthState, exchangeCode, getTodayEvents, isConnected, disconnect }
