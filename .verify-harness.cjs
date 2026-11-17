// 검증 전용 하네스 — index.js 를 **안 태운다**(스케줄러·자동종료·오디오·업데이트 없음).
// 라우트 몇 개만 사본 DB 에 붙여 화면을 띄운다. 부작용 0.
// 장치 제어 라우트는 **일부러 안 붙인다** — 화면은 '미설정'으로 뜨고 그것으로 충분하다.
// **사본 DB 경로가 없으면 띄우지 않는다**(추가 점검 2026-11-01). 예전엔 VERIFY_DB 가 비면 문자열
// 'undefined' 가 DB 경로가 되어 현재 폴더에 그 이름의 DB 가 생겼다. 기본값을 두면 언젠가 운영 DB 를 연다.
if (!process.env.VERIFY_DB) {
  console.error('[검증하네스] VERIFY_DB 에 사본 DB 경로를 주세요 — 기본값은 두지 않습니다.')
  process.exit(1)
}
process.env.CARECAST_NO_HARDWARE = '1'
process.env.CARECAST_DB_PATH = process.env.VERIFY_DB
const path = require('path')
const express = require('express')
const app = express()
app.use(express.json())
require('./server/db/schema').initDB()

// **읽기만 통과시킨다.** `/api/audio` 를 붙여야 음원 관리 화면의 폴더 트리가 뜨고,
// 그래야 검색·정렬·경로 표시(UX-27)를 눈으로 볼 수 있다. 그런데 그 라우터에는
// 폴더 삭제·파일 이동·자막 생성(유료 API)까지 들어 있다 — 검증하다 잘못 눌러
// 사본이 망가지거나 요금이 나가면 안 되므로 **GET 이 아닌 것은 여기서 막는다.**
// 막는 자리를 라우터 앞에 두는 이유: 라우터 안에서 고르면 새 라우트가 생길 때마다 샌다.
const 읽기만 = (name) => (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  res.status(405).json({ error: `[검증하네스] ${name} 의 쓰기는 막혀 있습니다(${req.method} ${req.path}).` })
}

app.use('/api/status', require('./server/routes/status'))
app.use('/api/broadcasts', 읽기만('broadcasts'), require('./server/routes/broadcasts'))
// 설정·예약도 읽기만 — 쓰기를 열어 두면 인증서 생성(generate-cert)이 실제 server/ssl 에 파일을 남겨
// 다음 운영 기동 때 HTTPS 가 켜진다. 「부작용 0」은 막아야 참이 된다.
app.use('/api/settings', 읽기만('settings'), require('./server/routes/settings'))
app.use('/api/schedules', 읽기만('schedules'), require('./server/routes/schedules'))
app.use('/api/audio', 읽기만('audio'), require('./server/routes/audio'))
app.use(express.static(path.join(__dirname, 'dist')))
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))
app.listen(3099, '127.0.0.1', () => console.log('[검증하네스] http://127.0.0.1:3099 (audio 는 읽기 전용)'))
