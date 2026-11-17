// 부팅·방송 경로에서 이벤트 루프를 멈추는 동기 탐색·설치를 막는다(CC-034).
//
// 예전엔 서버가 켜질 때마다 옛 음성 합성 모듈을 pip 로 동기 설치했다(오프라인이면 60초 멎음) — 그 모듈과
// 자동 설치는 2026-09-21 걷어냈다. 여기서는 **다시 들어오지 않는지**와, 파이썬을 못 찾았을 때 방송마다
// 탐색(execSync, 후보 3개 × 5초)을 되풀이하지 않는지를 본다. 파이썬은 차임·서버 스피커·마이크가 쓴다.
//
// 아래 execSync 스텁은 tts.js를 require하기 **전에** 갈아끼운다(tts.js가 모듈 로드 시점에
// 구조분해로 붙잡기 때문). 스텁이 항상 던지므로 실제 python·소리와 무관하다.
'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')

process.env.CARECAST_DB_PATH = path.join(os.tmpdir(), `carecast_test_ttsguard_${process.pid}_${Date.now()}.db`)

const childProcess = require('child_process')
let execSyncCalls = 0
childProcess.execSync = () => { execSyncCalls++; throw new Error('테스트: 실행 파일 없음') }

const test = require('node:test')
const assert = require('node:assert/strict')

const tts = require('../services/tts')

const TTS_PATH = path.join(__dirname, '..', 'services', 'tts.js')

// 2026-09-21: 옛 음성 합성 모듈(과 그 자동 설치)을 걷어냈다. 부팅마다 pip 를 도는 코드가 **다시 들어오지 않는지**를 본다.
test('부팅 때 pip install 을 돌리지 않는다 — 옛 음성 합성 모듈 자동 설치는 걷어냈다', () => {
  const src = fs.readFileSync(TTS_PATH, 'utf8')
  assert.match(src, /function findPython\(\)/, '긍정 앵커 — 파이썬 찾기가 이 파일에 있다')
  assert.doesNotMatch(src, /pip install/, '부팅 경로에 pip install 이 다시 들어왔다 — 오프라인이면 60초 멎는다')
  assert.doesNotMatch(src, /edge[-_]tts/i, '걷어낸 옛 음성 합성 모듈 흔적이 남았다')
})

test('Python을 못 찾아도 방송마다 탐색(execSync)을 되풀이하지 않는다', async () => {
  // 부팅 시 1회 탐색(setImmediate)이 끝나기를 기다린다
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(execSyncCalls > 0, '전제: 부팅 시 python 탐색이 execSync로 이뤄진다')

  const afterBoot = execSyncCalls
  // 합성은 파이썬을 안 탄다(엔진은 Node 안·PowerShell·HTTP) — 시험 안에서는 엔진이 없어 거절된다.
  await assert.rejects(tts.generateTTS({ text: '테스트 문장' }), /엔진이 없다/)
  await assert.rejects(tts.generateTTS({ text: '테스트 문장 둘' }), /엔진이 없다/)

  assert.equal(execSyncCalls, afterBoot,
    '방송 때마다 python 탐색을 다시 돈다 — 후보 3개 × 5초 타임아웃이 방송 단계마다 이벤트 루프를 멈춘다')
})
