import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { WebSocketServer } from 'ws'
import { createRequire } from 'node:module'

// 출처 판정은 서버와 **같은 규칙 한 곳**(server/services/corsOrigin.js)을 쓴다 — 복제하면 한쪽만 고쳐진다.
const { isAllowedUpgrade } = createRequire(import.meta.url)('./server/services/corsOrigin.js')

// 실시간 오디오 스트리밍 WebSocket 플러그인 (wss://host:5173/ws/audio)
const audioStreamPlugin = {
  name: 'audio-stream',
  configureServer(server) {
    // Node.js 22 HTTPS upgrade 호환성 패치
    const patch = (s) => {
      if (s && typeof s.shouldUpgradeCallback !== 'function') {
        s.shouldUpgradeCallback = () => true
      }
    }
    patch(server.httpServer)
    server.httpServer?.once('listening', () => patch(server.httpServer))

    // WebSocket 서버 (noServer 모드 — Vite HTTP 서버에 수동 연결)
    const wss = new WebSocketServer({ noServer: true })
    let broadcaster = null
    const listeners = new Set()

    // prependListener: Vite 내부 핸들러보다 먼저 실행되도록
    server.httpServer?.prependListener('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'https://localhost')
      if (url.pathname !== '/ws/audio') return
      // **허용되지 않은 웹 출처는 연결 전에 끊는다**(전문가 1차 검토 1-6). WebSocket 은 CORS 를 안 거쳐서,
      // 직원이 연 외부 페이지가 role=broadcaster 로 붙으면 받은 소리가 아래에서 시설 스피커로 중계됐다.
      if (!isAllowedUpgrade(req)) {
        console.warn(`[AudioStream] 허용되지 않은 출처의 연결을 끊었습니다: ${req.headers.origin}`)
        socket.destroy()
        return
      }

      console.log(`[AudioStream] upgrade 요청: role=${url.searchParams.get('role')}`)
      socket.pause()  // Vite가 소켓을 가로채지 못하도록 일시 정지

      wss.handleUpgrade(req, socket, head, (ws) => {
        socket.resume()
        const role = url.searchParams.get('role')
        console.log(`[AudioStream] 연결됨: role=${role}, 리스너=${listeners.size}개`)

        if (role === 'broadcaster') {
          if (broadcaster) broadcaster.terminate()
          broadcaster = ws
          console.log(`[AudioStream] 방송 시작 → 리스너 ${listeners.size}개에 알림`)
          listeners.forEach(l => l.readyState === 1 && l.send(JSON.stringify({ type: 'start' })))

          ws.on('message', async (data) => {
            // 서버 스피커로 재생 (Express audioPlayer)
            try {
              await fetch('http://localhost:3001/api/mic/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: data,
              })
            } catch {}
          })
          ws.on('close', () => {
            console.log('[AudioStream] 방송 종료')
            broadcaster = null
            listeners.forEach(l => l.readyState === 1 && l.send(JSON.stringify({ type: 'stop' })))
          })
        } else {
          listeners.add(ws)
          console.log(`[AudioStream] 리스너 등록 (총 ${listeners.size}개)`)
          if (broadcaster) ws.send(JSON.stringify({ type: 'start' }))
          ws.on('close', () => {
            listeners.delete(ws)
            console.log(`[AudioStream] 리스너 해제 (총 ${listeners.size}개)`)
          })
        }
      })
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl(), audioStreamPlugin],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // SSE 스트리밍 끊김 방지
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('connection', 'keep-alive')
          })
        },
      },
      '/audio': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
