// 테스트 전용 Express 앱 — server/index.js(운영 진입점, 포트 바인딩·스케줄러·WebSocket 등 부수효과
// 다수)를 건드리지 않고, 검증하고 싶은 라우트만 골라 빈 익스프레스 앱에 얹어서 임시 포트로 띄운다.
// CARECAST_DB_PATH가 라우트 require보다 먼저 설정돼 있어야 한다(각 테스트 파일에서 처리).
'use strict'

const express = require('express')
const http = require('http')

// routes: { '/api/schedules': require('../../routes/schedules'), ... }
function startTestApp(routes) {
  const app = express()
  app.use(express.json())
  for (const [mountPath, router] of Object.entries(routes)) {
    app.use(mountPath, router)
  }
  const server = http.createServer(app)
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r)),
      })
    })
    server.on('error', reject)
  })
}

module.exports = { startTestApp }
