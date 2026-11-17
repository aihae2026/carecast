// 재생목록 **항목마다** 배속·소리를 따로 두기.
//
// 그전에는 배속·소리가 단계에 하나씩만 붙었다. 한 단계에 영상 셋을 담으면 셋 다 같은
// 배속으로 나갔다 — 따라 부르는 노래는 0.75배, 안내 영상은 정속으로 두고 싶어도 방법이
// 단계를 쪼개는 것뿐이었다.
//
// **DB 표는 안 건드린다.** 재생목록 항목이 지금까지 `[3, 7, 12]`(파일 id 배열)이었는데,
// 여기에 `[{ id: 3, rate: 0.75 }, 7]`처럼 객체도 올 수 있게 넓힌다. 옛 저장분은 그대로
// 읽히고(값이 없으면 단계 설정을 따른다), 새로 저장한 것만 항목별 값을 갖는다.
//
// 같은 규칙을 서버(재생)와 화면(편집)이 각자 갖고 있으므로, 아래 마지막 테스트가
// **둘이 같은 답을 내는지** 대조한다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizePlaylistItems, resolvePlaylistItem } = require('../domain/playlistItems')

test('옛 저장분(파일 id 배열)이 그대로 읽힌다', () => {
  assert.deepEqual(normalizePlaylistItems([3, 7]), [
    { id: 3, rate: null, volume: null },
    { id: 7, rate: null, volume: null },
  ])
})

test('항목마다 값을 가질 수 있다', () => {
  assert.deepEqual(normalizePlaylistItems([{ id: 3, rate: 0.75, volume: 80 }, 7]), [
    { id: 3, rate: 0.75, volume: 80 },
    { id: 7, rate: null, volume: null },
  ])
})

test('빈 목록·잘못된 값은 빈 배열 — 화면이 죽으면 안 된다', () => {
  assert.deepEqual(normalizePlaylistItems(null), [])
  assert.deepEqual(normalizePlaylistItems('엉터리'), [])
  assert.deepEqual(normalizePlaylistItems([null, undefined]), [])
})

test('항목 값이 없으면 단계 설정을 따른다', () => {
  const got = resolvePlaylistItem({ id: 3, rate: null, volume: null }, { volume: 60, rate: 1.25 })
  assert.deepEqual(got, { id: 3, volume: 60, rate: 1.25 })
})

test('항목 값이 있으면 그것이 이긴다', () => {
  const got = resolvePlaylistItem({ id: 3, rate: 0.5, volume: 90 }, { volume: 60, rate: 1.25 })
  assert.deepEqual(got, { id: 3, volume: 90, rate: 0.5 })
})

test('항목 볼륨 0은 살아남는다 — 0은 "설정 안 함"이 아니라 명시적 무음이다', () => {
  const got = resolvePlaylistItem({ id: 3, rate: null, volume: 0 }, { volume: 70, rate: null })
  assert.equal(got.volume, 0, '0을 falsy로 지우면 무음으로 두려던 영상이 소리를 낸다')
})

test('둘 다 없으면 그대로 비운다 — 서버가 "시스템 기본값"으로 읽는다', () => {
  const got = resolvePlaylistItem({ id: 3, rate: null, volume: null }, {})
  assert.deepEqual(got, { id: 3, volume: null, rate: null })
})

test('[구조] 화면과 서버가 같은 답을 낸다', () => {
  const fromScreen = require('../../src/lib/playlistItems.js')
  const CASES = [
    [3, 7],
    [{ id: 3, rate: 0.75 }, 7],
    [{ id: 3, volume: 0 }],
    [],
    null,
  ]
  for (const c of CASES) {
    assert.deepEqual(fromScreen.normalizePlaylistItems(c), normalizePlaylistItems(c),
      `재생목록 해석이 화면과 서버에서 갈린다: ${JSON.stringify(c)}`)
  }
})

test('[화면] 영상을 빼고 넣어도 남은 영상의 개별 설정은 지켜진다', () => {
  const { reconcilePlaylist } = require('../../src/lib/playlistItems.js')
  const before = [{ id: '3', rate: 0.75 }, '7', { id: '9', volume: 0 }]
  const after  = reconcilePlaylist(before, ['9', '3'])   // 7을 빼고 순서도 바꿨다
  assert.deepEqual(after, [{ id: '9', volume: 0 }, { id: '3', rate: 0.75 }],
    '목록을 건드릴 때마다 개별 설정이 날아가면 아무도 안 쓴다')
})

test('[화면] 손대지 않은 항목은 숫자 그대로 저장한다 — 저장분이 통째로 바뀌지 않게', () => {
  const { reconcilePlaylist } = require('../../src/lib/playlistItems.js')
  assert.deepEqual(reconcilePlaylist([3, 7], [3, 7]), [3, 7])
})

test('[구조] 영상 재생이 항목별 값을 쓴다', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'flowRunner.js'), 'utf8')
  const block = src.slice(src.indexOf("if (step.step_type === 'video_file')"))
  assert.match(block, /resolvePlaylistItem/,
    '영상 루프가 단계 값만 보고 있다 — 항목별 설정이 죽은 설정이 된다')
})
