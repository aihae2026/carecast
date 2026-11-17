// 테스트가 실제 스피커를 울리지 않는가 — 소리 경계의 가드 존재를 고정한다.
//
// 왜 필요했나(2026-08-30 사용자 보고): npm run verify를 돌리는 동안 개발 PC 스피커에서
// 실제 소리가 났다. hardwareMode의 가드(CC-050)는 require 시점에 프로세스를 띄우는 3곳
// (audioPlayer·audioDevices·volumeControl)만 막았고, **호출 시점에 띄우는 두 곳** —
// chimePlayer.playChime(차임벨)과 audioQueue.enqueue(MCI 재생)는 가드가 없어서,
// 옛 인터넷 합성 엔진 설치로 Python 경로가 잡히자 스텁을 빠뜨린 테스트가 진짜 소리를 냈다.
//
// 검사 방식은 spawn-error-guard.test.js와 같은 소스 정적 검사다 — 이 테스트 자체가
// 모듈을 실행하면 RED 상태에서 스피커가 울리는 자기모순이 생기므로 실행하지 않는다.
'use strict'

const fs   = require('fs')
const path = require('path')

const test   = require('node:test')
const assert = require('node:assert/strict')

const SERVICES = path.join(__dirname, '..', 'services')

// 호출 시점에 소리 프로세스를 spawn하는 모듈들. 새 소리 경계가 생기면 여기 추가한다.
const SOUND_BOUNDARIES = ['chimePlayer.js', 'audioQueue.js']

for (const file of SOUND_BOUNDARIES) {
  test(`${file} — 진입 함수가 hardwareDisabled()를 확인한다`, () => {
    const src = fs.readFileSync(path.join(SERVICES, file), 'utf8')
    assert.match(src, /require\(['"]\.\/hardwareMode['"]\)/,
      'hardwareMode를 가져오지 않으면 테스트·맥 개발 환경에서 실제 소리가 난다')
    // 파일 내 위치(소스 순서)는 호출 순서가 아니므로 보지 않는다 — audioQueue는 가드가
    // 진입점(enqueue)에 있고 spawn은 그보다 위(processNext)에 있다. 존재만 고정한다.
    assert.match(src, /hardwareDisabled\(\)/,
      'hardwareDisabled() 호출이 없다 — 스텁을 빠뜨린 테스트가 실제 소리를 낸다')
  })
}
