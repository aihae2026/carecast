// Google Calendar API 라우트 — OAuth2 인증 플로우 + 일정 조회
const express  = require('express')
const { getDB } = require('../db/schema')
const {
  generateAuthUrl,
  consumeAuthState,
  exchangeCode,
  getTodayEvents,
  isConnected,
  disconnect,
} = require('../services/calendar')

const router = express.Router()

// GET /api/calendar/auth-url — OAuth 인증 URL 반환 (프론트에서 새 창으로 열기)
router.get('/auth-url', (req, res) => {
  try {
    const url = generateAuthUrl(getDB())
    res.json({ url })
  } catch (err) {
    console.error('[calendar/auth-url]', err.message)
    res.status(400).json({ error: err.message })
  }
})

// GET /api/calendar/callback — Google OAuth 콜백 처리
// redirect_uri로 등록된 주소이므로 HTML 응답 (팝업 창 닫기)
router.get('/callback', async (req, res) => {
  const { code, error } = req.query
  if (error) {
    // **Google 이 돌려준 오류 문자열을 화면에 넣지 않는다**(전문가 1차 검토 1-1).
    // 이 주소는 누구나 링크로 만들 수 있어서, `?error=<script>…` 를 직원이 열면 방송 앱 출처에서
    // 그 코드가 돈다. 원문은 도스창 로그에만 남기고 화면은 고정 안내문만 보여 준다.
    console.error('[calendar/callback] Google 이 연결을 거절했습니다:', String(error).slice(0, 200))
    return res.status(400).type('text/plain').send('일정 연결에 실패했습니다. 다시 연결해 주세요.')
  }
  if (!code) return res.status(400).send('인증 코드가 없습니다.')
  // 이 서버가 방금 만든 인증 주소로 돌아온 것인지 본다 — 남이 만든 연결 링크를 막는다(services/calendar.js).
  if (!consumeAuthState(req.query.state)) {
    console.warn('[calendar/callback] state 가 없거나 맞지 않아 연결을 거절했습니다.')
    return res.status(400).type('text/plain').send('일정 연결에 실패했습니다. 설정 화면에서 「연결」을 다시 눌러 주세요.')
  }

  try {
    await exchangeCode(code, getDB())
    res.send(`
      <html><body style="font-family:sans-serif;padding:2rem;text-align:center">
        <h3 style="color:#22C55E">✓ Google Calendar 연동 완료</h3>
        <p>이 창은 3초 후 자동으로 닫힙니다.</p>
        <script>setTimeout(()=>window.close(),3000)</script>
      </body></html>
    `)
  } catch (err) {
    console.error('[calendar/callback]', err.message)
    // 예외 문구도 같다 — 토큰 교환 오류에는 외부 응답 원문이 섞여 올 수 있다.
    res.status(400).type('text/plain').send('일정 연결에 실패했습니다. 다시 연결해 주세요.')
  }
})

// GET /api/calendar/today — 오늘 일정 목록
router.get('/today', async (req, res) => {
  try {
    const db     = getDB()
    const events = await getTodayEvents(db)
    if (events === null) return res.json({ connected: false, events: [] })
    res.json({ connected: true, events })
  } catch (err) {
    console.error('[calendar/today]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/calendar/status — 연동 상태 확인
router.get('/status', (req, res) => {
  try {
    res.json({ connected: isConnected(getDB()) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/calendar/disconnect — 연동 해제
router.post('/disconnect', (req, res) => {
  try {
    disconnect(getDB())
    res.json({ ok: true })
  } catch (err) {
    console.error('[calendar/disconnect]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
