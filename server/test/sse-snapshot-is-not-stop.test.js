// 접속 스냅샷의 broadcast_stopped는 「정지」가 아니다 (2026-09-04 현장 사고).
//
// 무슨 일이 있었나: SSE에 새로 붙은 화면에게 서버가 "지금 방송 중이 아니다"를 알리려고
// broadcast_stopped를 한 번 보낸다(routes/events.js). 그런데 화면 쪽은 그 이벤트를
// carecast:stop-broadcast로 바꿔 쏘고, 그 신호는 흐르던 BGM·TV 송출을 **실제로 끈다.**
// 그래서 재접속할 때마다(서버 재시작·자동 업데이트·네트워크 끊김) 소리가 죽었다.
//
// 지금까지 안 터진 이유는 MusicPlayer가 배경음악일 때 그 신호를 무시하고 있었기 때문이다.
// 그 무시를 "결함"으로 보고 걷어내는 순간 이 구멍이 열린다 — 실제로 그렇게 터졌다.
// 그러니 **정지 신호를 강화하기 전에 이 구별이 먼저 있어야 한다.**
//
// 고정하는 사실 셋:
//  1. 접속 스냅샷(stopped·started 둘 다)에는 표(snapshot)가 실린다
//  2. 화면은 그 표를 보고, 스냅샷이면 소리를 안 건드린다 — 표시만 맞춘다. 조건의 극성까지 본다
//  3. 진짜 정지(사람이 누른 정지·흐름이 끊은 것)에는 표가 없다 — emitter 집합을 server/ 전체에서 대조
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

// 주석 줄을 걷고 공백을 하나로 접는다 — 정규식 없이 **모양 그대로** 대조하기 위해서.
// (백슬래시가 든 정규식은 이 저장소의 편집 경로에서 두 번이나 깎여 나갔다.)
const flat = (s) => s.split('\n').filter(l => !l.trim().startsWith('//')).join(' ').replace(/[ \t\r\n]+/g, ' ').trim()

// ── 사실 1 ────────────────────────────────────────────────────────────────────
test('접속 스냅샷의 broadcast_stopped·broadcast_started 둘 다에 snapshot 표가 실린다', () => {
  const src   = read('server/routes/events.js')
  const lines = src.split('\n').filter(L => L.includes('res.write(')
    && (L.includes('event: broadcast_stopped') || L.includes('event: broadcast_started')))
  assert.equal(lines.length, 2, 'events.js의 접속 스냅샷 두 줄(stopped·started)을 못 찾았다 — 자리가 바뀌었으면 이 가드를 고칠 것')
  for (const line of lines) {
    assert.ok(line.includes('snapshot: true'),
      `접속 스냅샷에 표가 없다: ${line.trim().slice(0, 60)} — 화면이 이걸 사람이 누른 정지·진짜 시작과 `
      + '구별할 방법이 사라진다. 재접속마다 흐르던 BGM·TV 송출·TTS가 죽는다(2026-09-04 현장 사고).')
  }
})

// ── 사실 2 ────────────────────────────────────────────────────────────────────
test('화면은 스냅샷이면 소리를 안 건드린다 — 조건의 극성까지 본다', () => {
  const src = read('src/hooks/useScheduledBroadcast.js')

  // stopped: 정지 신호 둘(stopCurrent·stop-broadcast)이 **`!data.snapshot` 블록 안에만** 있어야 한다.
  const sFrom = src.indexOf("if (type === 'broadcast_stopped')")
  assert.ok(sFrom > 0, 'broadcast_stopped 처리기를 못 찾았다')
  const sBody = flat(src.slice(sFrom, src.indexOf("if (type === 'broadcast_step')", sFrom)))
  const guarded = "if (!data.snapshot) { stopCurrent() window.dispatchEvent(new CustomEvent('carecast:stop-broadcast', { detail: { byUser: !data.auto } })) }"
  assert.ok(sBody.includes(guarded),
    '스냅샷 가드의 모양이 다르다 — 조건이 뒤집혔거나(if (data.snapshot)), 정지 신호가 가드 밖에 있거나, '
    + 'byUser(흐름의 자동 절단 표)가 빠졌다. 기대: ' + guarded)
  assert.equal(sBody.split('carecast:stop-broadcast').length - 1, 1,
    '정지 신호가 가드 밖에서도 나간다 — 접속·재접속이 다시 정지가 된다')
  assert.equal(sBody.split('stopCurrent()').length - 1, 1, 'stopCurrent가 가드 밖에서도 불린다')
  // 표시 쪽은 스냅샷에서도 그대로여야 한다(그게 이 이벤트의 원래 목적이다).
  assert.ok(sBody.includes('carecast:broadcast-ended'), '표시 동기화(오버레이 내리기)까지 사라졌다')
  assert.ok(sBody.includes('setNowPlaying(false)'),     '"방송중" 표시가 안 걷힌다 — 재접속한 화면이 방송중으로 굳는다')

  // started: 스냅샷이면 stopCurrent를 안 부른다. 표시(broadcast-started·setNowPlaying(true))는 그대로.
  const bFrom = src.indexOf("if (type === 'broadcast_started')")
  assert.ok(bFrom > 0, 'broadcast_started 처리기를 못 찾았다')
  const bBody = flat(src.slice(bFrom, src.indexOf("if (type === 'broadcast_stopped')", bFrom)))
  assert.ok(bBody.includes('if (!data.snapshot) stopCurrent()'),
    'broadcast_started가 스냅샷을 안 가른다 — 방송 도중 재접속한 현장 창이 나가던 TTS를 문장 중간에 세운다')
  assert.equal(bBody.split('stopCurrent()').length - 1, 1, 'stopCurrent가 가드 밖에서도 불린다')
  assert.ok(bBody.includes('setNowPlaying(true)'), '"방송중" 표시 동기화가 사라졌다')
})

// ── 사실 3 ────────────────────────────────────────────────────────────────────
// 진짜 정지(사람이 누른 정지 · 흐름이 단계를 끊을 때)에는 표가 없다 — 그건 소리를 꺼야 한다.
// 파일 두 개를 이름 박아 보는 대신 **server/ 전체를 걸어** emitter 집합을 대조한다.
// 새 emitter가 생기면 여기 목록을 갱신하며 "표를 붙일 것인가"를 반드시 결정하게 된다.
test('broadcast_stopped를 보내는 곳은 정확히 셋이고, 표는 접속 스냅샷에만 있다', () => {
  const root = path.join(ROOT, 'server')
  const hits = []   // { rel, line }
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== 'test') walk(full); continue }
      if (!ent.name.endsWith('.js')) continue
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        const emits = line.includes("broadcastSSE('broadcast_stopped'") || line.includes('event: broadcast_stopped')
        if (emits) hits.push({ rel: path.relative(root, full).split(path.sep).join('/'), line })
      }
    }
  }
  walk(root)
  const files = [...new Set(hits.map(h => h.rel))].sort()
  assert.deepEqual(files, ['routes/events.js', 'services/broadcastGate.js', 'services/flowRunner.js'],
    `broadcast_stopped를 보내는 곳이 바뀌었다: ${files.join(', ')} — 새 emitter라면 표를 붙일지 먼저 정하고 이 목록을 갱신할 것`)
  for (const h of hits) {
    if (h.rel === 'routes/events.js') assert.ok(h.line.includes('snapshot: true'), '접속 스냅샷에 표가 없다')
    else assert.ok(!h.line.includes('snapshot'), `${h.rel}: 진짜 정지에 스냅샷 표가 붙었다 — 정지를 눌러도 소리가 안 멎는다`)
  }
})
