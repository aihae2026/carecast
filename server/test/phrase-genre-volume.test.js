// 자연어 예약 파서 — 장르 검색어 유실과 볼륨 오탐.
//
// 1) (옛) "트로트 틀어줘"의 장르가 검색어로 남아야 했다 — 외부 동영상 검색을 쓰던 때의 규칙이다.
//    2026-09-21 부터 BGM 은 이 PC 의 방송용 폴더에서 튼다. 장르는 **BGM 이라는 유형을 알아보는 데만** 쓴다.
// 2) VOLUME_NUMBER에 단어 경계가 없어 종소리/벨소리 뒤의 숫자("종소리 30초")를
//    볼륨 30%로 오독하고 내용까지 망가뜨렸다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { parseSchedulePhrase } = require('../services/schedulePhrase')

// ── 장르 낱말은 BGM 유형으로 읽히고, 곡은 이 PC 방송용 폴더에서 ────────────────


for (const 문장 of ['매일 저녁 7시에 트로트 틀어줘', '매일 저녁 7시에 찬송가 틀어줘', '저녁 7시에 음악 틀어줘', '저녁 7시에 조용한 피아노 음악 틀어줘']) {
  test(`"${문장}" → BGM · 이 PC 방송용 폴더 · 검색어 없음`, () => {
    const r = parseSchedulePhrase(문장)
    assert.equal(r.broadcast_type, 'bgm')
    assert.equal(r.bgm_type, 'local_broadcast', '서버가 해석하는 값(이 PC 방송용 폴더)이 아니다')
    assert.equal(r.bgm_value, '', '걷어낸 검색어가 되살아났다')
  })
}

// ── 볼륨 숫자 오탐 ──────────────────────────────────────────────

test('"종소리 30초"의 30은 볼륨이 아니다', () => {
  const r = parseSchedulePhrase('저녁 7시에 종소리 30초 울려줘')
  assert.equal(r.broadcast_type, 'chime')
  assert.equal(r.bgm_volume, undefined)
  assert.equal(r.volume_label, undefined)
})

test('"벨소리 3번"의 3은 볼륨이 아니다', () => {
  const r = parseSchedulePhrase('저녁 6시에 벨소리 3번 울려줘')
  assert.equal(r.bgm_volume, undefined)
})

test('진짜 볼륨 지시는 그대로 읽힌다 — "볼륨 40으로"', () => {
  const r = parseSchedulePhrase('저녁 8시에 배경음악 볼륨 40으로 틀어줘')
  assert.equal(r.bgm_volume, 40)
})

test('낱말 "소리"가 홀로 쓰이면 여전히 볼륨이다 — "음악 소리 30으로"', () => {
  const r = parseSchedulePhrase('저녁 8시에 음악 소리 30으로 틀어줘')
  assert.equal(r.bgm_volume, 30)
})
