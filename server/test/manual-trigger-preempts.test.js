'use strict';
// P-43 — `/trigger` 수동재생이 자동방송을 잘라내는데 밀림 기록에 안 걸린다.
//
// 기전(ISSUES.md P-43, C-0002 적대적 검증):
//   `routes/schedules.js` 의 /trigger 가 `fireSchedule` 을 직호출한다.
//   `fireSchedule` 은 **취소 토큰을 안 세운다.** 그래서 돌던 자동방송 레인은
//   `isCancelled(tok)` 가 false 인 채로 남고 `logPreempted()` 가 안 불린다 —
//   소리는 새 재생에 잘리는데(`awaitTTSEnd` 가 타임아웃으로 풀린다) 이력은 **성공**이다.
//   ISSUE-010 이 자동방송 레인에서 닫은 구멍이 이 경로에는 안 닫혀 있었다.
//
// 고침: /trigger 가 발사 **전에** `cancelCurrentBroadcast()` 를 부른다.
//   · 취소 종류는 기본값 CANCEL_PREEMPT('밀림') — 사람이 정지를 누른 것이 아니다.
//   · **차임은 예외다.** 차임은 공존이 명세다(td09 §3-B 규칙 5) — 밀어내면 안 된다.
//
// 실부작용 없음 — 소스를 글자로 읽어 고정한다. 이 저장소의 관례이고(CLAUDE.md
// "가드는 따라 옮긴다"), 라우트를 실제로 태우려면 DB·express·스피커가 전부 필요하다.
// **부정 단언 앞에 긍정 앵커를 세운다** — 감시할 대상이 이 파일에 있다는 것부터 고정한다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'schedules.js'), 'utf8');

// /trigger 핸들러 본문만 떼어 낸다 — 파일 어딘가에 있는 것으로는 증명이 안 된다.
function trigger본문() {
  const i = SRC.indexOf("router.post('/:id/trigger'");
  assert.ok(i >= 0, '/trigger 라우트가 사라졌다 — 이 검사의 앵커가 무너졌다');
  const j = SRC.indexOf('\n})', i);
  assert.ok(j > i, '/trigger 본문의 끝을 못 찾았다');
  return SRC.slice(i, j);
}

test('앵커: /trigger 가 fireSchedule 로 예약을 발사한다', () => {
  const 본문 = trigger본문();
  assert.ok(본문.indexOf('fireSchedule(') >= 0, '/trigger 가 fireSchedule 을 안 부른다');
  assert.ok(본문.indexOf('_manual: true') >= 0, '수동 표식이 사라졌다');
});

test('P-43: /trigger 는 발사 전에 앞 소리를 밀어낸다 — 그래야 밀림이 이력에 남는다', () => {
  const 본문 = trigger본문();
  assert.ok(본문.indexOf('cancelCurrentBroadcast') >= 0,
    'P-43 회귀: /trigger 가 취소 토큰을 안 세운다. 돌던 자동방송이 취소되지 않아 '
    + 'logPreempted() 가 안 불리고, 소리만 잘린 채 이력에는 성공으로 남는다');
});

test('P-43: 차임은 밀어내지 않는다 — 차임은 공존이 명세다', () => {
  const 본문 = trigger본문();
  const i = 본문.indexOf('cancelCurrentBroadcast');
  assert.ok(i >= 0, '앞 검사가 이미 잡았어야 한다');
  // 그 호출이 chime 검사 안에 있어야 한다. 무조건 부르면 차임이 앞 방송을 죽인다.
  assert.ok(/chime/.test(본문.slice(0, i)),
    '차임 예외 없이 무조건 밀어낸다 — 차임은 공존이 명세다(td09 §3-B 규칙 5)');
});

test('밀림으로 남긴다 — 사람이 정지를 누른 것으로 적지 않는다', () => {
  const 본문 = trigger본문();
  // 주석에 낱말이 나오는 것은 상관없다 — **부르는지**를 본다.
  assert.ok(본문.indexOf('stopCurrentBroadcast(') === -1,
    'stopCurrentBroadcast 는 CANCEL_HUMAN 이다 — 밀림을 사람 정지로 적으면 '
    + '밀려난 방송이 또 조용히 사라진다(broadcastGate.js:75-88)');
});
