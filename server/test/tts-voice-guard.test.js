// 존재하지 않는 목소리가 아침 방송을 죽이지 못하게 한다.
//
// [사고] 2026-09-18 제출판: `tts_voice_morning` 의 기본값이 `ko-KR-GookMinNeural` 이었다.
// 옛 인터넷 합성 엔진 에 그런 목소리는 없다(2026-09-21 `옛 합성 엔진 목록 조회` 실측: 한국어는 SunHi·
// InJoon·HyunsuMultilingual 셋). 화면 목록에도 없어서, 관리자가 목소리를 **건드리지 않고**
// 다른 설정만 저장해도 GookMin 이 DB 에 들어갔고(서버에 검사가 없었다) 다음 날 아침 방송이
// NoAudioReceived → HTTP 500 으로 통째로 빠졌다.
//
// 여기서 고정하는 것 넷:
//   1) 기본값 셋이 전부 실재하는 목소리다 — 아무도 안 골랐을 때 나가는 값이 사고가 되면 안 된다
//   2) 없는 목소리·빈 값은 저장을 거절하고, 거절한 요청은 **아무것도 쓰지 않는다**
//   3) 화면 목록(src/data/presets.js)의 모든 값이 서버 목록에 있다 — 두 벌이 갈리는 날을 막는다
//   4) 이미 저장된 없는 목소리는 부팅 때 한 번 SunHi 로 고치고, 고친 흔적을 settings_history 에 남긴다
'use strict'

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const TEST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttsvoice_${process.pid}_${Date.now()}.db`)
process.env.CARECAST_DB_PATH = TEST_DB_PATH

const test   = require('node:test')
const assert = require('node:assert/strict')

const { initDB, getDB }  = require('../db/schema')
const { startTestApp }   = require('./helpers/testApp')
const settingsRoutes     = require('../routes/settings')
const { 목록, 있는목소리인가, 기본목소리 } = require('../domain/ttsVoices')
const { applyDataFixes, DATA_FIXES } = require('../config/dataFixes')

const ROOT = path.join(__dirname, '..', '..')
const set = (k, v) => getDB().prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, v)
const del = (k) => getDB().prepare('DELETE FROM settings WHERE key=?').run(k)
const val = (k) => getDB().prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? null

let app
test.before(async () => {
  initDB()
  app = await startTestApp({ '/api/settings': settingsRoutes })
})
test.after(async () => {
  await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* 없으면 그만 */ }
  }
})

async function post(body) {
  const r = await fetch(app.baseUrl + '/api/settings/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* 본문 없을 수 있음 */ }
  return { status: r.status, body: parsed }
}

const KEYS = ['tts_voice_normal', 'tts_voice_morning', 'tts_voice_emergency']

test('목록 — GookMin 은 없는 목소리다', () => {
  assert.ok(Array.isArray(목록()) && 목록().length > 0)
  for (const v of 목록()) assert.ok(v.value && v.label, `항목 모양이 {value,label} 이 아니다: ${JSON.stringify(v)}`)
  assert.equal(있는목소리인가('ko-KR-SunHiNeural'), true)
  assert.equal(있는목소리인가('ko-KR-InJoonNeural'), true)
  assert.equal(있는목소리인가('ko-KR-GookMinNeural'), false)
  for (const 빈것 of ['', '   ', null, undefined, 3]) {
    assert.equal(있는목소리인가(빈것), false, `빈 값이 통과했다: ${JSON.stringify(빈것)}`)
  }
  assert.equal(있는목소리인가(기본목소리), true)
})

test('빈 DB 의 기본값 셋이 전부 실재하는 목소리다', async () => {
  for (const k of KEYS) del(k)
  const r = await (await fetch(app.baseUrl + '/api/settings/tts')).json()
  for (const f of ['voiceNormal', 'voiceMorning', 'voiceEmergency']) {
    assert.equal(있는목소리인가(r[f]), true, `${f} 기본값 ${r[f]} 은 없는 목소리다 — 아무도 안 골라도 방송이 죽는다`)
  }
})

test('없는 목소리·빈 값은 400 이고 한 칸도 쓰지 않는다', async () => {
  set('tts_voice_morning', 'ko-KR-InJoonNeural')
  set('tts_rate', '0.9')
  // `null` 은 여기 없다 — 이 저장소에서 `null` 은 「안 보낸 것」이다(보냈나(), P-115). 아래에서 따로 본다.
  // 공백 붙은 실재 이름도 막는다 — 옛 인터넷 합성 엔진 가 ' ko-KR-SunHiNeural ' 을 Invalid voice 로 거절한다.
  for (const bad of ['ko-KR-GookMinNeural', '', '  ', ' ko-KR-SunHiNeural ', 'ko-KR-SunHiNeural\n', 'ko-kr-sunhineural']) {
    const r = await post({ voiceMorning: bad, rate: 1.2 })
    assert.equal(r.status, 400, `${JSON.stringify(bad)} 가 저장됐다`)
    assert.ok(r.body?.error, '왜 막혔는지를 안 말한다')
    assert.equal(val('tts_voice_morning'), 'ko-KR-InJoonNeural', '거절했는데 목소리가 바뀌었다')
    assert.equal(val('tts_rate'), '0.9', '거절한 요청의 다른 칸이 반만 저장됐다')
  }
  for (const f of ['voiceNormal', 'voiceEmergency']) {
    assert.equal((await post({ [f]: 'ko-KR-GookMinNeural' })).status, 400, `${f} 는 검사를 안 한다`)
  }
})

test('정상값은 저장되고, 안 보낸 칸은 그대로다', async () => {
  set('tts_voice_normal', 'ko-KR-InJoonNeural')
  const r = await post({ voiceMorning: 'ko-KR-SunHiNeural', voiceEmergency: null })
  assert.equal(r.status, 200)
  assert.equal(val('tts_voice_morning'), 'ko-KR-SunHiNeural')
  assert.equal(val('tts_voice_normal'), 'ko-KR-InJoonNeural', '안 보낸 칸이 바뀌었다')
  assert.notEqual(val('tts_voice_emergency'), '', 'null 을 보냈더니 목소리가 지워졌다(P-115 재발)')
})

test('화면 목록의 모든 목소리가 서버 목록에 있다', () => {
  const 화면 = fs.readFileSync(path.join(ROOT, 'src/data/presets.js'), 'utf8')
  const m = /export const ttsVoices = \[([\s\S]*?)\n\]/.exec(화면)
  assert.ok(m, 'src/data/presets.js 에서 ttsVoices 를 못 찾았다 — 이 시험이 읽는 모양이 바뀌었다')
  const 화면값 = [...m[1].matchAll(/value:\s*'([^']+)'/g)].map(x => x[1])
  assert.ok(화면값.length > 0)
  const 서버에없음 = 화면값.filter(v => !있는목소리인가(v))
  assert.deepEqual(서버에없음, [], `화면에만 있고 서버(server/domain/ttsVoices.js)에 없는 목소리: ${서버에없음.join(', ')}`)
})

test('부팅 보정 — 없는 목소리만 SunHi 로, 흔적을 남기고, 한 번만', () => {
  const fix = DATA_FIXES.find(f => f.key === 'datafix_tts_voice_unknown_20260921')
  assert.ok(fix, '보정 항목이 없다')
  del(fix.key)
  set('tts_voice_normal', 'ko-KR-InJoonNeural')      // 정상값 — 건드리면 안 된다
  set('tts_voice_morning', 'ko-KR-GookMinNeural')    // 사고값
  set('tts_voice_emergency', ' ko-KR-SunHiNeural ')   // 공백 붙은 이름도 엔진이 거절한다
  const 전 = getDB().prepare("SELECT COUNT(*) n FROM settings_history WHERE key LIKE 'tts_voice_%'").get().n

  const changed = applyDataFixes(getDB(), [fix])

  assert.equal(val('tts_voice_morning'), 기본목소리)
  assert.equal(val('tts_voice_emergency'), 기본목소리)
  assert.equal(val('tts_voice_normal'), 'ko-KR-InJoonNeural', '정상값을 덮었다')
  assert.equal(changed.length, 2, `바뀐 내역: ${JSON.stringify(changed)}`)
  const 후 = getDB().prepare("SELECT COUNT(*) n FROM settings_history WHERE key LIKE 'tts_voice_%'").get().n
  assert.equal(후 - 전, 2, 'settings_history 에 흔적이 안 남았다 — 「왜 내 목소리가 바뀌었지」에 답할 수 없다')

  // 두 번째 부팅: 사람이 다시 무엇을 넣었든 보정은 다시 안 돈다(마커).
  set('tts_voice_morning', 'ko-KR-GookMinNeural')
  assert.deepEqual(applyDataFixes(getDB(), [fix]), [])
  assert.equal(val('tts_voice_morning'), 'ko-KR-GookMinNeural')
})
