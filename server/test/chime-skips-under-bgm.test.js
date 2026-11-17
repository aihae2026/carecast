// **BGM 이 나가는 중이면 안내방송에 딸린 차임은 건너뛴다** (사용자 결정 2026-09-13).
//
// 사용자 원문: *"차임벨은 BGM 없을 경우에만 시행하는 걸로 하지 뭐"* ·
// *"BGM 이 나가고 있을 때 TTS 넣으면 차임벨 넣으면 안 되겠지?"*
//
// 왜 규칙이 필요한가: BGM 이 깔린 위에 차임까지 때리면 소리가 셋(반주·차임·안내)이 겹쳐
// 안내가 안 들린다. 차임의 쓰임은 *"이제 방송이 나갑니다"* 인데 BGM 이 이미 그 신호다.
//
// **여기서 지키는 것이 둘이고, 둘째가 더 중요하다:**
//   ① BGM 중에는 **딸린 차임**(즉시 TTS 방송의 시작음·종료음)이 안 나간다
//   ② **사람이 명시한 차임은 그대로 나간다** — 예약 유형 `chime`, 흐름의 「차임벨」 단계,
//      마이크. 사람이 «차임벨을 울려라» 라고 적어 둔 것을 조용히 삼키면 그 예약은
//      **아무 일도 안 하는 예약**이 된다. 이 저장소가 가장 경계하는 조용한 실패다.
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_chimebgm_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB } = require('../db/schema')
const { 부수차임막힘 } = require('../services/chimePlayer')
const nowPlaying = require('../services/nowPlaying')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
// 주석을 걷고 본다 — 이 규칙을 설명하는 머리말에 「차임」·「BGM」이 잔뜩 들어 있다
const 주석없이 = (p) => 읽기(p)
  .split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

test.before(() => { initDB() })
test.after(() => {
  nowPlaying.update({ bgm: null })
  try { getDB().close() } catch { /* 이미 닫혔으면 그만 */ }
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 무시 */ } }
})

// ── 판정 자체 ──────────────────────────────────────────────────

test('BGM 이 없으면 차임은 그대로 울린다', () => {
  nowPlaying.update({ bgm: null })
  assert.equal(부수차임막힘(), null, 'BGM 도 없는데 차임을 막았다 — 평소 방송이 조용해진다')
})

test('BGM 이 나가는 중이면 막고, **왜 막혔는지 문장으로** 알린다', () => {
  // BGM 상태는 nowPlaying.bgm 하나다(2026-09-21) — 자동방송은 서버가, 사람이 튼 것은 현장 재생기가 알린다
  nowPlaying.update({ bgm: { title: '잔잔한 피아노' } })
  const 이유 = 부수차임막힘()
  assert.ok(이유, 'BGM 중인데 차임을 막지 않았다')
  assert.match(이유, /BGM/, '왜 막혔는지 안 적혀 있다 — 고장인지 규칙인지 못 가른다')
  assert.match(이유, /잔잔한 피아노/, '어느 곡 때문인지 안 적혀 있다')
})

test('불리언이 아니라 **문장**을 돌려준다 — 이력·로그에 그대로 적어야 한다', () => {
  nowPlaying.update({ bgm: { title: 'X' } })
  assert.equal(typeof 부수차임막힘(), 'string')
  nowPlaying.update({ bgm: null })
  assert.equal(부수차임막힘(), null)
})

test('BGM 이 꺼지면 곧바로 다시 울린다 — 한 번 막혔다고 굳지 않는다', () => {
  nowPlaying.update({ bgm: { title: '노래' } })
  assert.ok(부수차임막힘())
  nowPlaying.update({ bgm: null })
  assert.equal(부수차임막힘(), null)
})

// ── 어디에 걸리고 어디에 안 걸리나 ─────────────────────────────

test('**딸린 차임에만** 걸린다 — 즉시 TTS 방송의 시작음·종료음', () => {
  const src = 주석없이('server/routes/tts.js')
  assert.match(src, /const 차임막힘 = 부수차임막힘\(\)/, '즉시 방송이 판정을 안 묻는다')
  assert.match(src, /if \(chimeStart && !차임막힘\)/, '시작음이 규칙을 안 본다')
  assert.match(src, /if \(chimeEnd && !차임막힘\)/, '종료음이 규칙을 안 본다')
  // **한 번만 묻는다** — 시작과 끝 사이에 BGM 이 꺼지면 시작은 건너뛰고 종료만 울리는
  // 반쪽이 된다. 한 방송의 시작·끝은 같은 판정을 따라야 한다.
  assert.equal((src.match(/부수차임막힘\(\)/g) || []).length, 1,
    '판정을 두 번 묻는다 — 그 사이에 BGM 이 꺼지면 종료음만 울리는 반쪽이 된다')
})

test('**사람이 명시한 차임은 안 건드린다** — 예약·흐름·마이크', () => {
  for (const [p, 무엇] of [
    ['server/services/scheduler.js', '예약 유형 chime'],
    ['server/services/flowRunner.js', '흐름의 차임벨 단계'],
    ['server/routes/mic.js', '마이크 방송'],
  ]) {
    const src = 주석없이(p)
    // 긍정 앵커 — 그 파일이 실제로 차임을 부르는지 먼저 본다(부정 단언만 두면 빈 파일도 통과)
    assert.match(src, /playChime\(/, `${p} 가 차임을 안 부른다 — 이 검사의 앵커가 무너졌다`)
    assert.ok(!/부수차임막힘/.test(src),
      `${무엇}(${p})에 BGM 규칙이 걸렸다 — 사람이 「차임벨」이라고 적어 둔 것이 조용히 사라진다`)
  }
})

test('BGM 상태를 못 읽어도 방송은 그대로 나간다 — 규칙 하나로 안내를 막지 않는다', () => {
  const p = require.resolve('../services/nowPlaying')
  const 원래 = require.cache[p]
  const 진짜 = require('../services/nowPlaying')
  require.cache[p] = {
    id: p, filename: p, loaded: true,
    exports: { ...진짜, get: () => { throw new Error('못 읽음') } },
  }
  try {
    assert.equal(부수차임막힘(), null,
      'BGM 상태를 못 읽었다고 차임을 막았다 — 읽기 실패가 소리를 줄이면 안 된다')
  } finally {
    if (원래) require.cache[p] = 원래; else delete require.cache[p]
  }
})

// ── 설정으로 옮긴 시작음·종료음 ────────────────────────────────

test('시작음·종료음은 **서버 설정**이다 — 브라우저마다 갈리지 않는다', () => {
  const 설정 = 주석없이('server/routes/settings.js')
  assert.match(설정, /chimeStart: getSetting\(db, 'tts_chime_start', '1'\)/, '서버가 시작음을 안 준다')
  assert.match(설정, /chimeEnd:\s+getSetting\(db, 'tts_chime_end',\s+'1'\)/, '서버가 종료음을 안 준다')
  assert.match(설정, /setSetting\(db, 'tts_chime_start'/, '서버가 시작음을 안 저장한다')
  assert.match(설정, /setSetting\(db, 'tts_chime_end'/, '서버가 종료음을 안 저장한다')

  // 화면이 다시 localStorage 로 돌아가면 값이 또 갈린다
  const 방송화면 = 읽기('src/components/easy/TTSBroadcast.jsx')
  assert.ok(!/carecast:ttsChime/.test(방송화면),
    'localStorage 로 돌아갔다 — PC·브라우저마다 값이 갈린다(현장에서 끈 것이 폰에서는 켜져 있다)')
  // 고치는 자리는 설정 한 곳
  assert.match(읽기('src/components/admin/sections/TTSSettings.jsx'), /시작음 · 종료음/,
    '설정 화면에 시작음·종료음 자리가 없다')
})

test('기본값은 켜짐이다 — 지금까지의 동작과 같다', () => {
  const db = getDB()
  db.prepare("DELETE FROM settings WHERE key IN ('tts_chime_start','tts_chime_end')").run()
  const { getSetting } = require('../domain/settingsRead')
  assert.equal(getSetting(db, 'tts_chime_start', '1') !== '0', true)
  assert.equal(getSetting(db, 'tts_chime_end', '1') !== '0', true)
})
