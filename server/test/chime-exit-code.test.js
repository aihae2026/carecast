// ISSUE-001: 차임벨 "재생" 프로세스가 떴다가 0 아닌 코드로 죽어도 어디에도 안 남던 구멍.
//
// watchChild(what, cmd, args, onDone, extraEnv)는 close에서 onDone(code)를 부르기만 하는데,
// 재생을 부르는 두 곳 — playViaWaveOut(Windows=현장, :97 부근)과 playWav(맥·리눅스, :136 부근) —
// 이 onDone을 안 넘겼다. 같은 파일의 playViaFile(합성 단계, :115-120)은 onDone에서
// `code !== 0`이면 console.error를 남긴다 — 재생 쪽도 같은 결로 맞춘다.
//
// 재현: EV-000040(무음) / 대조군: EV-000039(합성 단계는 로그가 남는다). TC-007/TC-008 참고.
'use strict'

// **DB 를 임시 파일로 돌린다**(P-120, 2026-09-11). 이 파일은 소스 대조가 대부분이지만
// 아래 어딘가에서 DB 를 여는 모듈을 require 하고, 그러면 `server/db/database.db` 가
// **없으면 만들어진다** — 즉 이 테스트가 개발 DB 를 직접 건드린다.
// 본체에는 그 파일이 이미 있어 눈에 안 띄고, **빈 체크아웃에서만 드러난다**
// ([FACT] EV-004285 — 실제로 그렇게 찾았다). 이 저장소 테스트 138개가 쓰는 관례다.
process.env.CARECAST_DB_PATH = require('node:path')
  .join(require('node:os').tmpdir(), `carecast_test_chime_exit_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')
const fs     = require('fs')

const SERVICES_DIR = path.join(__dirname, '..', 'services')
const CHIME_SRC     = fs.readFileSync(path.join(SERVICES_DIR, 'chimePlayer.js'), 'utf8')

// 함수 하나의 본문만 중괄호 짝을 맞춰 잘라낸다 — 다른 함수(playViaFile 등)의 onDone과
// 섞여서 오탐/누락이 나지 않게 하기 위함이다.
function extractFunctionBody(src, fnName) {
  const marker = `function ${fnName}(`
  const start = src.indexOf(marker)
  assert.ok(start >= 0, `${fnName} 함수를 chimePlayer.js에서 찾지 못했다 — 함수가 옮겨졌거나 이름이 바뀌었다`)
  const braceStart = src.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`${fnName}의 중괄호 짝이 안 맞는다`)
}

// ── 소스 대조: 재생 쪽 두 곳 모두 onDone에서 실패를 드러내는지 ────────────────
for (const fnName of ['playViaWaveOut', 'playWav']) {
  test(`${fnName}(재생) — watchChild가 있고(긍정 앵커), onDone이 없지 않으며, 0 아닌 코드를 로그로 남긴다`, () => {
    const body = extractFunctionBody(CHIME_SRC, fnName)

    // 긍정 앵커: 이 함수 안에 watchChild 호출이 실제로 있다 (CLAUDE.md 규칙 2)
    assert.match(body, /watchChild\(/, `${fnName}에서 watchChild 호출을 못 찾았다`)

    // 부정 단언: onDone 자리(4번째 인자)가 undefined로 비어 있으면 안 된다
    assert.doesNotMatch(
      body,
      /watchChild\(\s*'재생'\s*,[^,]+,\s*\[[^\]]*\]\s*,\s*undefined\s*[,)]/,
      `${fnName}이 watchChild에 onDone 자리를 비워(undefined) 넘긴다 — 실패가 버려진다`
    )

    assert.match(body, /code\s*!==\s*0/, `${fnName}이 0 아닌 종료코드를 판별하지 않는다`)
    assert.match(body, /console\.error/, `${fnName}이 실패를 로그로 남기지 않는다`)
  })
}

// ── 동작 검증: 실제로 spawn되고 종료코드 1로 죽으면 로그가 남는가 (Windows=현장 경로) ──
//
// python 자리에 process.execPath(node.exe)를 넣는다. node가 .py 파일을 스크립트로
// 파싱하려다 실패해 종료코드 1로 죽는다 — 실제 오디오 API는 전혀 건드리지 않아 소리가
// 안 난다. spawn-error-guard.test.js의 ENOENT 테스트와 같은 기법이되, 그쪽은 spawn 자체가
// 안 뜨는 경우(error 이벤트)만 보고 여기는 "떴다가 죽는" 경우(close 이벤트, code!==0)를 본다.
test('playChime(Windows 재생 경로)이 종료코드 1로 죽으면 로그를 남긴다 — 지금까지는 0건', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows 전용 — 현장 PC 경로(playViaWaveOut)는 win32에서만 탄다')
    return
  }

  const ttsPath = require.resolve('../services/tts')
  const hwPath  = require.resolve('../services/hardwareMode')
  const chimePath = require.resolve('../services/chimePlayer')

  delete require.cache[chimePath]
  require.cache[ttsPath] = {
    id: ttsPath, filename: ttsPath, loaded: true,
    // ensurePythonPath 도 같이 준다(ISSUE-003 — chimePlayer 가 이쪽을 쓴다).
    exports: { getPythonPath: () => process.execPath, ensurePythonPath: () => process.execPath },
  }
  require.cache[hwPath] = {
    id: hwPath, filename: hwPath, loaded: true,
    exports: { hardwareDisabled: () => false, noticeOnce: () => {} },
  }
  // 상주 플레이어는 「준비 안 됨」으로 막는다(2026-09-22). 임시 폴더에 차임 파형 캐시가 남아 있으면
  // playChime 이 상주 플레이어(진짜 carecast_player.py)를 띄워 **시험 프로세스가 끝나지 않았다** — 이 시험은
  // 파형이 없는 예전 길(playViaWaveOut)의 종료코드를 본다. 캐시가 있든 없든 같은 길을 타게 한다.
  const playerPath = require.resolve('../services/audioPlayer')
  const 진짜플레이어 = require.cache[playerPath]
  require.cache[playerPath] = { id: playerPath, filename: playerPath, loaded: true, exports: { playPcm16: () => false } }

  const logs = []
  const origErr = console.error
  console.error = (...a) => { logs.push(a.join(' ')) }

  try {
    const { playChime } = require('../services/chimePlayer')
    playChime('general', 50)
    await new Promise((r) => setTimeout(r, 800))
  } finally {
    console.error = origErr
    delete require.cache[hwPath]
    delete require.cache[ttsPath]
    delete require.cache[chimePath]
    if (진짜플레이어) require.cache[playerPath] = 진짜플레이어; else delete require.cache[playerPath]
  }

  assert.ok(
    logs.some((l) => l.includes('차임벨') && l.includes('종료코드')),
    '재생 프로세스가 0 아닌 코드로 죽었는데 로그가 없다. 실제 로그: ' + JSON.stringify(logs)
  )
})
