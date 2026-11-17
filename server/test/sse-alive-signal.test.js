// 창이 살아 있음을 알리는 신호 — 주소(HTTP) 층까지 이어지는지 (H15, 2026-09-02).
//
// 왜 필요한가: 서버가 담당을 고르는 규칙은 sound-owner.test.js가 고정한다. 여기서는 그
// 규칙에 **브라우저가 실제로 신호를 넣을 수 있는 문이 열려 있는지**를 본다 — 문이 막히면
// (주소 오타·라우터 미등록) 규칙은 멀쩡한데 아무도 살아 있다고 말할 수 없어, 담당이
// 90초마다 비워지고 소리가 끊긴다. 그래서 규칙과 문을 따로 고정한다.
'use strict'

const http = require('http')

const test   = require('node:test')
const assert = require('node:assert/strict')

const { startTestApp } = require('./helpers/testApp')

// SSE 스트림은 안 끝나므로 잠깐 읽고 끊는다(sse-connect-sync.test.js와 같은 방식).
function readSSEHead(url, ms = 300) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buf = ''
      res.on('data', d => { buf += d.toString() })
      setTimeout(() => { req.destroy(); resolve(buf) }, ms)
    })
    req.on('error', reject)
  })
}

function post(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST' }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end()
  })
}

const 담당 = (head) => {
  const 줄 = [...head.matchAll(/event: sound_owner\ndata: (.*)\n\n/g)].pop()
  return 줄 ? JSON.parse(줄[1]).tabId : undefined
}

test('생존 신호와 작별 인사를 받는 문이 열려 있다', async () => {
  const app = await startTestApp({ '/api/events': require('../routes/events') })
  try {
    const 첫창 = await readSSEHead(`${app.baseUrl}/api/events?tab=창1`)
    assert.equal(담당(첫창), '창1', '루프백으로 붙은 첫 창이 담당이다')

    assert.equal(await post(`${app.baseUrl}/api/events/alive?tab=창1`), 204,
      '살아 있다는 신호를 받을 문이 없으면 담당이 90초마다 비워진다')

    // 창을 닫으면서 남기는 인사. 프록시가 연결을 안 끊어 줘도 서버가 여기서 걷어낸다.
    assert.equal(await post(`${app.baseUrl}/api/events/bye?tab=창1`), 204)

    const 둘째창 = await readSSEHead(`${app.baseUrl}/api/events?tab=창2`)
    assert.equal(담당(둘째창), '창2',
      '인사하고 간 창이 담당으로 남아 있으면 새 창에서 소리가 안 난다')
  } finally {
    await app.close()
  }
})
