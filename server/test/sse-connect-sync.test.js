// SSE 접속 직후 상태 동기화 — 재연결한 브라우저가 "방송중"으로 굳지 않는가.
//
// 왜 필요했나(배선도 ③, 2026-08-30): 이 동기화(broadcast_started/stopped)는 원래
// sse.addClient() 안에 있었는데, 그러려고 sse가 nowPlaying을 역참조했고 nowPlaying은
// sse를 참조해서 상호 참조가 됐다. 동기화를 routes/events.js(두 모듈을 다 아는 자리)로
// 옮기면서, 옮긴 뒤에도 접속 직후 같은 이벤트들이 나가는지 이 테스트가 고정한다.
'use strict'

const http = require('http')

const test   = require('node:test')
const assert = require('node:assert/strict')

const { startTestApp } = require('./helpers/testApp')

// SSE 스트림은 안 끝나므로, 잠깐 읽고 연결을 끊어 첫 페이로드만 얻는다.
function readSSEHead(url, ms = 500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buf = ''
      res.on('data', d => { buf += d.toString() })
      setTimeout(() => { req.destroy(); resolve(buf) }, ms)
    })
    req.on('error', reject)
  })
}

test('접속 직후 방송 상태·재생 상태가 즉시 동기화된다', async () => {
  const app = await startTestApp({ '/api/events': require('../routes/events') })
  try {
    const head = await readSSEHead(`${app.baseUrl}/api/events`)
    assert.match(head, /event: connected/, 'heartbeat가 먼저 와야 브라우저가 스트림을 인식한다')
    assert.match(head, /event: broadcast_stopped/,
      '방송이 없을 때 접속하면 stopped로 초기화해야 재연결 후 "방송중"으로 굳는 버그가 안 생긴다')
    assert.match(head, /event: now_playing/, '크로스-PC 동기화용 현재 재생 상태')
    // BGM 도 now_playing 의 bgm 칸 하나로 간다(2026-09-21 — 따로 가던 외부 동영상 BGM 상태는 걷었다)
    assert.doesNotMatch(head, /event: youtube_bgm/, '걷어낸 BGM 상태 이벤트가 되살아났다')
  } finally {
    await app.close()
  }
})

test('방송 진행 중에 접속하면 broadcast_started로 동기화된다', async () => {
  const nowPlaying = require('../services/nowPlaying')
  nowPlaying.update({ broadcast: { title: '저녁 마무리 방송' } })
  const app = await startTestApp({ '/api/events': require('../routes/events') })
  try {
    const head = await readSSEHead(`${app.baseUrl}/api/events`)
    assert.match(head, /event: broadcast_started/, '새 탭이 진행 중인 방송 상태를 반영해야 한다')
    assert.match(head, /저녁 마무리 방송/)
  } finally {
    await app.close()
    nowPlaying.update({ broadcast: null })
  }
})
