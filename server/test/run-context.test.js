// CC-035 — 로그 한 줄만 보고는 "어느 방송의 이야기인지" 알 수 없던 문제.
//
// 원 finding은 "타임스탬프·레벨·방송ID가 없다"였는데 앞의 둘은 이미 해소됐다(fileLog가 붙인다).
// 남은 건 상관관계 하나뿐이다: 방송 하나가 나가는 동안 스케줄러·시퀀서·흐름러너·TTS가 제각기
// 로그를 남기는데, 그것들이 같은 방송의 것인지 다른 방송의 것인지 구별할 수 없었다.
// 매분 tick이 여러 예약을 동시에 발동시키면 줄이 뒤섞인다.
//
// **새 JSON 로거를 들이지 않는다** — fileLog와 두 벌이 되고, 그러면 어느 쪽을 봐야 하는지가
// 다시 문제가 된다. 대신 실행 구간에 이름표(run id)를 붙이고 fileLog가 그 이름표를 싣는다.
// 호출부 87곳을 고치지 않아도 되는 것이 이 방식의 핵심이다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { withRun, currentRunId } = require('../services/runContext')
const fileLog = require('../services/fileLog')

test('구간 밖에서는 이름표가 없다', () => {
  assert.equal(currentRunId(), null)
})

test('구간 안의 모든 코드가 같은 이름표를 본다 — await 뒤에도', async () => {
  await withRun('예약', async () => {
    const first = currentRunId()
    assert.ok(first, '구간 안에서는 이름표가 있어야 한다')
    await new Promise(r => setTimeout(r, 5))
    assert.equal(currentRunId(), first, 'await 뒤에 이름표가 사라지면 상관관계가 끊긴다')
  })
  assert.equal(currentRunId(), null, '구간이 끝나면 원래대로 돌아와야 한다')
})

test('동시에 도는 두 방송은 서로 다른 이름표를 가진다', async () => {
  const seen = []
  await Promise.all([
    withRun('예약', async () => { await new Promise(r => setTimeout(r, 5)); seen.push(currentRunId()) }),
    withRun('아침', async () => { seen.push(currentRunId()) }),
  ])
  assert.equal(seen.length, 2)
  assert.notEqual(seen[0], seen[1], '같은 이름표면 매분 여러 예약이 겹칠 때 줄을 못 가른다')
})

test('한 방송 안에서 다시 구간을 열어도 이름표는 그대로다', async () => {
  // 스케줄러가 연 구간 안에서 흐름러너가 또 열 수 있다. 거기서 새 이름표를 만들면
  // 같은 방송의 뒷부분이 다른 방송처럼 보인다.
  await withRun('예약', async () => {
    const outer = currentRunId()
    await withRun('흐름', async () => {
      assert.equal(currentRunId(), outer)
    })
  })
})

test('구간 안에서 던져도 이름표가 새지 않는다', async () => {
  await assert.rejects(() => withRun('예약', async () => { throw new Error('실패') }), /실패/)
  assert.equal(currentRunId(), null)
})

test('fileLog가 로그 파일 줄에 이름표를 싣는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carecast_runctx_'))
  const restore = fileLog.install({ dir })
  try {
    console.log('구간 밖 줄')
    await withRun('아침', async () => { console.log('구간 안 줄') })
  } finally { restore() }

  const text = fs.readFileSync(fileLog.fileFor(dir), 'utf8')
  const inside  = text.split('\n').find(l => l.includes('구간 안 줄'))
  const outside = text.split('\n').find(l => l.includes('구간 밖 줄'))
  assert.match(inside, /\[#아침-\d+\]/, '구간 안 줄에 이름표가 없다 — 상관관계를 못 잡는다')
  assert.ok(!/\[#/.test(outside), '구간 밖 줄까지 이름표가 붙으면 기존 줄 형식이 바뀐다')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('스케줄러의 방송 실행이 이 구간 안에서 돈다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8')
  assert.ok(src.includes('runContext'), '스케줄러가 구간을 안 열면 이름표가 붙을 곳이 없다')
})
