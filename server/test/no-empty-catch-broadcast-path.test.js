// 2026-08-31 CC-038. 처음엔 eslint 위반 179건 중 106건이 빈 catch였고, 그중 **방송 실행경로**
// 8곳만 먼저 풀었다. 여기서 삼킨 오류는 "소리가 안 났는데 이력은 성공"으로 이어지기 때문이다.
//
// 그날 저녁에 나머지 98곳도 전부 풀었다(빈 catch 0건, baseline 151 → 45). 없앤 게 아니라
// **이유를 주석으로 남기거나, 사람이 누른 동작이 조용히 실패하던 곳은 console.error를 넣었다.**
// 그래서 이 파일의 가드가 둘로 늘었다 — 실행경로 가드(원래 것)와 전체 가드(아래).
//
// 실제로 그랬다: broadcastSequencer의 즐겨찾기 조회 3곳이 빈 catch였고, 실패하면 바로 다음 줄에서
// "즐겨찾기 비어 있음 — 스킵"을 찍었다. 로그만 보면 사람이 즐겨찾기를 지운 줄 안다.
//
// 그래서 실행경로 파일들의 no-empty를 baseline에서 빼고(=이제 신규 위반으로 잡힌다),
// 다시 baseline에 들어오는 것을 이 테스트가 막는다. `lint-check --update`는 지금 상태를 통째로
// 기준선으로 저장하므로, 이 가드가 없으면 누군가 빈 catch를 하나 넣고 update를 돌리는 순간
// 조용히 다시 잠긴다.
'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..', '..')

// 방송이 실제로 나가는 길. 새 모듈이 이 길에 끼면 여기에 추가한다.
const BROADCAST_PATH = [
  'server/services/scheduler.js',
  'server/services/broadcastSequencer.js',
  // 2026-09-01: 시퀀서에서 갈라져 나온 세 파일. 단계 실행기와 영상 고르기가 여기 있으므로
  // 방송이 실제로 나가는 길은 그대로다 — 목록이 안 따라가면 가드가 빈 파일을 보게 된다.
  'server/services/broadcastSteps.js',
  'server/services/broadcastVideoPicker.js',
  'server/services/flowRunner.js',
  'server/services/broadcastGate.js',
  'server/services/tts.js',
  'server/services/audioQueue.js',
  'server/services/audioBackend.js',
]

test('방송 실행경로 파일은 baseline에 no-empty가 한 건도 없어야 한다', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline.json'), 'utf8'))
  const locked = baseline.filter((sig) => {
    const [file, rule] = sig.split('::')
    return rule === 'no-empty' && BROADCAST_PATH.includes(file)
  })
  assert.deepEqual(locked, [],
    '방송 실행경로의 빈 블록이 baseline에 다시 잠겼다 — 삼킨 오류는 "소리는 안 났는데 이력은 성공"이 된다:\n  ' + locked.join('\n  '))
})

// 저장소 전체 가드. `lint-check --update`는 지금 상태를 통째로 기준선으로 저장하므로,
// 이게 없으면 누군가 빈 catch를 넣고 update를 돌리는 순간 106건짜리 부채가 조용히 다시 쌓인다.
test('baseline에 no-empty가 한 건도 없다 — 빈 블록은 다시 잠그지 않는다', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline.json'), 'utf8'))
  const locked = baseline.filter(sig => sig.split('::')[1] === 'no-empty')
  assert.deepEqual(locked, [],
    '빈 블록이 baseline에 다시 잠겼다 — 이유를 주석으로 남기거나 console.error를 넣을 것:' + locked.join(', '))
})

test('방송 실행경로 파일에 빈 catch가 없다', () => {
  const offenders = []
  for (const rel of BROADCAST_PATH) {
    const full = path.join(ROOT, rel)
    if (!fs.existsSync(full)) continue
    const src = fs.readFileSync(full, 'utf8')
    // `catch {}` / `catch (e) {}` — 주석 한 줄만 있어도 통과한다(그 주석이 판단 근거다)
    for (const m of src.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) {
      offenders.push(`${rel}: ${src.slice(0, m.index).split('\n').length}줄`)
    }
  }
  assert.deepEqual(offenders, [],
    '빈 catch는 이유를 주석으로라도 남긴다 — 정당한 것과 위험한 것이 구별돼야 한다:\n  ' + offenders.join('\n  '))
})
