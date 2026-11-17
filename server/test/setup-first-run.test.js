'use strict'
// **설치하고 처음 열면 초기 설정이 뜬다 · 준비물을 미리 본다** (사용자 지시 2026-09-16).
//
// *"초기설정 메뉴에 있는거 설치하고 맨처음에 떴으면 좋겠는데"*
// *"꼭 필수적으로 설치하는거 … 체크리스트 세워서 없으면 하나하나씩 다운로드 받을 수 있게"*
//
// ── 이 시험이 가장 걱정하는 것 ─────────────────────────────────────────────
// **자동으로 화면을 옮기는 장치는 잘못 걸리면 사람을 가둔다.** 방송하러 온 사람이
// 설정 화면에 떨어지는 것은 마법사를 못 띄우는 것보다 나쁘다. 그래서 「언제 띄우나」의
// 조건을 여기서 못 박는다 — 넓히려면 이 시험을 먼저 고쳐야 한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const 홈 = 읽기('src/pages/HomeMode.jsx')
const 규칙 = require('../../src/lib/setupRules.js')

// ── 「처음인가」는 **모양이 아니라 사실로** 고정한다 (사용자 신고 2026-09-16 N2) ──────────
// *"초기화면 설정도 안뜨고"* — 설치한 노트북에서 마법사가 안 떴다.
// 원인: 설치팩의 `site-baseline.json` 이 첫 기동 때 **환기방송 예약 6건·기관 설정**을 심는다.
// 앞 판의 판정은 「기관 이름도 예약도 없어야 처음」이라, 설치하자마자 「쓰던 PC」가 됐다.
// 앞 판의 시험은 그 조건을 **글자 그대로**(`/FROM schedules/`) 고정하고 있어서 버그를 지켰다.
//
// 그래서 실제 설치 순서를 그대로 재현한다: 빈 DB → 기초값 심기 → 물어보기.
// 「쓰던 PC」의 표지는 **방송 기록**이다 — 기초값이 심지 않고, 실제로 방송을 한 PC 에만 쌓인다.
const TEST_DB_PATH = path.join(require('node:os').tmpdir(), `carecast_test_firstrun_${process.pid}_${Date.now()}.db`)

// 기초값 파일(server/config/site-baseline.json)은 한 기관의 운영값이라 **공개 저장소에는 없다**. 없으면 심을 것이
// 없어 이 시험이 재현하려는 상황 자체가 안 생기므로, 이유를 적고 건너뛴다(출시 검수 2026-10-17).
const 기초값있나 = fs.existsSync(path.join(ROOT, 'server', 'config', 'site-baseline.json'))
const 기초값옵션 = 기초값있나 ? {} : { skip: 'site-baseline.json 이 이 작업 트리에 없다 — 공개 저장소에는 기관 운영값을 싣지 않는다' }

test('**설치 직후(기초값을 심은 새 PC)에는 처음이다** · 방송 기록이 있거나 끝냈으면 처음이 아니다', 기초값옵션, async () => {
  const 이전경로 = process.env.CARECAST_DB_PATH
  process.env.CARECAST_DB_PATH = TEST_DB_PATH
  const { initDB, getDB } = require('../db/schema')
  const { startTestApp } = require('./helpers/testApp')
  const settingsRoutes = require('../routes/settings')
  initDB()
  const 심음 = require('../config/siteBaseline').applyBaseline(getDB())
  const app = await startTestApp({ '/api/settings': settingsRoutes })
  const 묻기 = async () => (await fetch(`${app.baseUrl}/api/settings/setup-state`)).json()
  try {
    assert.ok((심음.schedules || 0) > 0, '기초값이 예약을 안 심었다 — 이 시험이 재현하려는 상황이 아니다')

    assert.equal((await 묻기()).처음인가, true,
      '설치 직후인데 「처음」이 아니다 — 기초값이 심은 예약 때문에 초기 설정이 안 뜬다(N2)')

    // ── **설치 1분 뒤 — 누락 감시가 한 번 돈 다음에도 처음이다** (적대적 검증 T-32-1, 2026-09-17) ──
    // 새 설치에도 체조·점심·저녁이 켜진 채 심기고, 감시는 매분 이미 지난 방송을 「서버 꺼짐/확인 불가」
    // 행과 경보 행으로 `broadcasts` 에 적는다. 앞 판은 그 행까지 세어, 08:40 이후에 설치하면 1분 뒤부터
    // 초기 설정이 안 떴다. Sandbox 시험은 07시대에 돌아 지난 방송이 없어서 못 잡았다.
    // 그래서 **하루가 거의 끝난 시각**으로 감시를 돌린다 — 지난 방송이 전부 생기는 가장 나쁜 조건이다.
    const 늦은시각 = new Date(); 늦은시각.setHours(23, 30, 0, 0)
    require('../services/watchdog').checkMissed(getDB(), { now: 늦은시각 })
    const 감시행 = getDB().prepare('SELECT COUNT(*) AS n FROM broadcasts').get().n
    assert.ok(감시행 > 0, '감시가 행을 안 썼다 — 이 시험이 재현하려는 상황이 아니다')
    assert.equal((await 묻기()).처음인가, true,
      `감시가 적은 「안 나감」·경보 행 ${감시행}개 때문에 「처음」이 아니게 됐다 — 설치 1분 뒤 초기 설정이 안 뜬다`)
    getDB().prepare('DELETE FROM broadcasts').run()

    getDB().prepare("INSERT INTO broadcasts (time, type, content, success) VALUES (datetime('now'), 'text', '시험', 1)").run()
    assert.equal((await 묻기()).처음인가, false, '방송을 한 PC 인데 마법사가 또 뜬다')

    getDB().prepare('DELETE FROM broadcasts').run()
    await fetch(`${app.baseUrl}/api/settings/setup-state`, { method: 'POST' })
    const 끝 = await 묻기()
    assert.equal(끝.처음인가, false, '끝낸 PC 에서 마법사가 또 뜬다')
    assert.equal(끝.끝냈나, true)
  } finally {
    await app.close()
    try { getDB().close() } catch { /* 이미 닫힘 */ }
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEST_DB_PATH + s) } catch { /* 없음 */ } }
    if (이전경로 === undefined) delete process.env.CARECAST_DB_PATH; else process.env.CARECAST_DB_PATH = 이전경로
  }
})

test('**한 번만 옮긴다** — 뒤로 가기로 돌아와도 다시 끌려가지 않는다', () => {
  assert.match(홈, /sessionStorage\.getItem\('carecast:setup-checked'\)/,
    '한 번만 옮기는 표식이 없다 — 뒤로 가기가 막혀 사람이 갇힌다')
  assert.match(홈, /sessionStorage\.setItem\('carecast:setup-checked'/, '표식을 안 세운다')
})

test('**못 물어봤으면 아무 일도 안 한다** — 방송하러 온 사람을 설정에 떨어뜨리지 않는다', () => {
  const m = /useEffect\(\(\) => \{[\s\S]*?carecast:setup-checked[\s\S]*?\}, \[navigate\]\)/.exec(홈)
  assert.ok(m, '첫 실행 처리를 못 찾았다')
  // 조회가 실패하면 `catch` 로 빠지고 **거기서 옮기지 않아야** 한다.
  const 본문 = m[0]
  const catch자리 = 본문.lastIndexOf('catch')
  assert.ok(catch자리 > 0, '실패를 안 받는다')
  assert.ok(!/navigate\(/.test(본문.slice(catch자리)),
    '조회에 실패했는데도 화면을 옮긴다 — 서버가 잠깐 안 떠도 설정 화면으로 끌려간다')
})

test('**「완료」가 실제로 일한다** — 눌리지 않는 마무리 단추를 두지 않는다', () => {
  const 마법사 = 읽기('src/components/admin/sections/SetupWizard.jsx')
  // 앞 판은 마지막 단계에서 `disabled` 였다 — 낱말은 「완료」인데 눌리지 않아,
  // 사람은 «내가 뭘 안 했나» 를 찾게 된다.
  assert.ok(!/disabled=\{마지막단계인가\(단계\)\}/.test(마법사),
    '마지막 단계에서 「완료」가 비활성이다 — 끝내는 자리가 없다')
  assert.match(마법사, /markSetupSeen\(\)/, '완료가 「봤다」를 남기지 않는다 — 다음에 또 뜬다')
})

test('**준비물 단계가 앞쪽에 있다** — 쓰려고 할 때 없는 것을 알면 늦다', () => {
  const 준비물 = 규칙.단계목록.find((s) => s.id === 'ready')
  assert.ok(준비물, '준비물 단계가 없다')
  assert.equal(준비물.번호, 2,
    '준비물이 2단계가 아니다 — 앞쪽이라야 설치하는 그 자리에서 받아 둔다')
  assert.equal(준비물.건너뛰기, true,
    '준비물을 건너뛸 수 없다 — 받아쓰기가 없어도 방송은 나가야 한다')
})

test('**없는 것을 고장이라고 하지 않는다** — 항목마다 결과를 적는다', () => {
  const { 항목들 } = require('../services/prerequisites')
  assert.ok(항목들.length >= 3, `항목이 ${항목들.length}개뿐이다`)
  for (const x of 항목들) {
    assert.ok(x.쓰임 && x.쓰임.length > 2, `${x.이름} 에 쓰임이 없다`)
    assert.ok(x.없으면 && x.없으면.length > 5, `${x.이름} 에 「없으면 무엇을 못 하나」가 없다`)
  }
  // **방송이 멈추는 것과 아닌 것을 가른다.** 받아쓰기가 없어도 방송은 나간다.
  const 받아쓰기 = 항목들.find((x) => x.id === 'faster_whisper')
  assert.match(받아쓰기.없으면, /방송은 그대로/,
    '받아쓰기가 없으면 방송이 멈추는 것처럼 읽힌다 — 사람이 급하지 않은 것에 시간을 쓴다')
  // 안내 음성 모델이 없어도 **무음은 아니다**(다음 엔진으로 넘어간다) — 그 사실을 적어야 사람이 겁먹지 않는다.
  const 음성 = 항목들.find((x) => x.id === 'tts_model')
  assert.ok(음성, '안내 음성 모델 항목이 없다')
  assert.match(음성.없으면, /무음은 아닙니다/, '모델이 없을 때의 결과가 흐릿하다')
  assert.equal(음성.설치, 'npm run setup:tts')
  assert.ok(!항목들.some((x) => x.id === 'edge_tts'), '걷어낸 옛 음성 합성 모듈 항목이 남았다')
})

test('**파이썬이 없으면 pip 로 못 받는다는 것을 화면이 안다**', () => {
  const svc = 읽기('server/services/prerequisites.js')
  assert.match(svc, /받을수있나: x\.설치 === 'pip' \? !!python : false/,
    '파이썬 없이도 받을 수 있는 것처럼 보낸다 — 눌러도 안 되는 단추가 뜬다')
})
