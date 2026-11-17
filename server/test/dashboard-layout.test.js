// 대시보드가 사용자가 지시한 배치·문구를 지키는가 (UX-30~34, 2026-09-10).
//
// 이 검사는 **소스를 글자로 읽는다.** 화면 렌더링은 브라우저 확인(MT)이 맡고, 여기서는
// "지우라고 한 것이 다시 살아나지 않는가"·"칸 정의가 화면에도 적혀 있는가"만 본다.
// 부정 단언 앞에는 **긍정 앵커**를 세운다 — 파일이 통째로 없어져도 초록이 되지 않게(§6 규칙 2).
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 대시보드 = fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'admin', 'sections', 'Dashboard.jsx'), 'utf8')

test('앵커: 이 파일이 대시보드가 맞다', () => {
  assert.match(대시보드, /export default function Dashboard/)
  assert.match(대시보드, /기능 활성화/, '기능 활성화 토글이 사라졌다')
  assert.match(대시보드, /방송 통계/, '방송 통계 카드가 사라졌다')
  assert.match(대시보드, /최근 방송 로그/, '최근 방송 로그가 사라졌다')
  assert.match(대시보드, /월별 방송 실적/, '월별 방송 실적이 사라졌다')
})

test('빠른 설정 바로가기가 없다 — 지우라고 한 것이 다시 살아나지 않는다(UX-33)', () => {
  assert.doesNotMatch(대시보드, /빠른 설정 바로가기/)
  assert.doesNotMatch(대시보드, /quickLinks/, '바로가기 목록 상수가 남아 있다')
})

test('예약 방송 목록이 없다 — 예약은 캘린더가 맡는다(UX-33)', () => {
  // '예약' 이라는 낱말 자체는 통계 설명에 쓰이므로, **목록을 그리던 배선**이 없는지 본다.
  assert.doesNotMatch(대시보드, /getSchedules/,
    '대시보드가 아직 예약 목록을 불러온다 — 캘린더와 중복이다')
  assert.doesNotMatch(대시보드, /formatRepeatLabel/,
    '예약 반복 라벨을 그리던 코드가 남아 있다')
})

test('방송 통계 칸이 즉시방송·TTS·BGM·자동방송·오류 다섯이다(UX-34)', () => {
  for (const 라벨 of ['즉시방송', 'TTS', 'BGM', '자동방송', '오류']) {
    assert.ok(대시보드.includes(`label: '${라벨}'`),
      `통계 칸 '${라벨}' 이 없다`)
  }
  // 옛 칸이 남아 있으면 같은 것을 두 번 세는 화면이 된다
  assert.doesNotMatch(대시보드, /label: '예약\/자동'/, '옛 "예약/자동" 칸이 남아 있다')
  assert.doesNotMatch(대시보드, /label: '즉시'[,\s]/, '옛 "즉시" 칸이 남아 있다')
})

test('집계 정의가 화면 문구에 적혀 있다 — 숫자만 두면 사람이 오독한다(UX-34)', () => {
  assert.match(대시보드, /두 번 세지 않습니다/,
    '자동방송 안의 TTS·BGM 을 중복으로 세지 않는다는 설명이 화면에 없다')
  assert.match(대시보드, /다른 칸에 더해지지 않습니다/,
    '오류가 종류와 별개라는 설명이 화면에 없다')
})

test('CPU·작업 공간에 비개발자용 설명이 있다(UX-30)', () => {
  assert.match(대시보드, /작업 공간 사용량/,
    '"메모리"를 그대로 두면 PC를 모르는 사람이 못 읽는다')
  assert.match(대시보드, /얼마나 바쁜지/, 'CPU 설명이 없다')
  assert.doesNotMatch(대시보드, /label: '플랫폼'/,
    '"플랫폼"·"win32" 를 그대로 보여주면 안 된다 — 운영체제 이름으로 옮긴다')
})

test('전체 보기가 이번 달과 같은 규칙으로 센다 — 라벨만 바꾸지 않는다', () => {
  assert.match(대시보드, /allTime/,
    '"전체" 보기가 서버의 전체 기간 집계를 안 읽는다 — 이번 달 숫자에 라벨만 바꾸게 된다')
})
