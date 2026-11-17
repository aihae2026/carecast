// 마이크 수신 재생기의 리더 가드 (td09 H14).
//
// useAudioListener는 창마다 WS(/ws/audio?role=listener)를 열어 둔다. 서버는 지금 청크를
// 릴레이하지 않아 재생 코드가 도달 불가지만, 릴레이를 켜는 날 — 열려 있는 **모든** 창
// (원격 PC·중복 탭 포함)이 같은 소리를 동시에 재생한다. 다른 재생기들이 다 쓰는
// 리더 가드(현장 PC 리더 탭만 재생)가 여기만 빠져 있었다.
//
// 고정하는 사실 둘:
//  1. 청크 재생 앞에 리더 가드가 있다 — 연결이 아니라 **재생 시점**에 본다
//     (담당(sound_owner)은 방송 도중에도 바뀔 수 있다)
//  2. 자기 방송 중 재생 금지(isBroadcasting)도 그대로 있다 — 가드를 넣다 이걸 밀어내면
//     마이크 방송자가 자기 목소리를 되듣는다
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.join(__dirname, '..', '..')
const src  = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useAudioListener.js'), 'utf8')

test('청크 재생 앞에 리더 가드가 있다 — 릴레이가 켜져도 현장 리더 탭만 소리를 낸다', () => {
  assert.match(src, /if \(!window\.CC_IS_LEADER \|\| !_IS_LOCAL\) return/,
    '리더 가드가 없다 — 서버가 청크 릴레이를 켜는 순간 모든 창이 동시에 재생한다(td09 H14)')
  assert.match(src, /from '\.\.\/lib\/isLocal'/,
    '_IS_LOCAL을 안 가져온다 — 가드가 항상 참(undefined 부정)으로 죽는다')

  // 가드는 source.start(실제 재생)보다 앞에 있어야 한다
  const guardIdx = src.indexOf('!window.CC_IS_LEADER')
  const startIdx = src.indexOf('source.start(')
  assert.ok(guardIdx > 0 && startIdx > guardIdx,
    '리더 가드가 재생(source.start)보다 뒤에 있다 — 소리가 난 다음에 막아 봐야 늦다')
})

test('자기 방송 중 재생 금지도 그대로 있다', () => {
  assert.match(src, /if \(isBroadcasting\(\)\) return/,
    'isBroadcasting 가드가 사라졌다 — 마이크 방송자가 자기 목소리를 되듣는다')
})
