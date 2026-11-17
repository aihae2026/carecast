'use strict'
// UX-17 ④ — **꼬리 5초 안에 페이드가 들어간다** (2026-09-11).
//
// 수용 기준: *"TTS 종료 후 BGM 5초 → 종료. **5초 안에 페이드 시간이 포함**된다
// (페이드 때문에 5초가 더 붙지 않는다)"*.
//
// 실측은 **5374ms** 였다([FACT] EV-003954). 순서 때문이다 — 안내가 끝나면 `endDelay` 를
// 다 기다렸다가 정지를 쏘고, **받은 쪽이 그때부터** 페이드를 시작한다.
//
//   (예전)  안내 끝 ──5000 대기──▶ 정지 ──300 페이드──▶ 무음  = 5300+
//   (지금)  안내 끝 ──4700 대기──▶ 정지 ──300 페이드──▶ 무음  = 5000
//
// **기준을 낮춰서 통과시키지 않았다.** 5초는 그대로고, 페이드를 그 안에 넣었다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

// 계산은 순수 함수라 그대로 돌린다. ESM 이라 소스에서 읽어 실행한다 —
// 이 저장소 서버 테스트는 CJS 이고, 그 경계 때문에 규칙을 사본으로 옮겨 적으면
// **사본이 틀려도 초록이 된다**(P-107 에서 실제로 그랬다).
// 예전엔 이 소스를 **글자로 읽어** 상수를 뽑았다. 이제 모듈을 불러 쓴다 —
// 글자로 읽으면 "적어 둔 값" 만 보고 "실제로 계산되는 값" 은 못 본다.
// **진짜 함수를 불러 온다.** 예전엔 여기서 `쏠때` 를 다시 구현해 놓고 그것을 검사했다 —
// 진짜 함수가 무엇을 하든 늘 통과하는 테스트였다(헌장 §M8 "구현을 되풀이하는 테스트").
// 실제로 2026-09-11 에 `bgmStopAfterMs` 가 빼는 값을 300 → 360 으로 바꿨는데
// **이 가드는 초록 그대로였다.** 조용한 초록이다.
const { BGM_STOP_FADE_MS, 실제페이드ms, 당길ms, bgmStopAfterMs } =
  require(path.join(ROOT, 'src/lib/bgmFade.js'))
const 페이드 = BGM_STOP_FADE_MS
const 쏠때 = bgmStopAfterMs

// 아래 시험 여럿이 같은 두 파일을 본다 — 한 번만 읽는다.
const 훅 = fs.readFileSync(path.join(ROOT, 'src/hooks/useScheduledBroadcast.js'), 'utf8')
// 2026-09-21: 반주를 트는 재생기는 이 PC 음원 재생기(MusicPlayer) 하나다(외부 동영상 재생기를 걷어냈다).
const 재생기 = fs.readFileSync(path.join(ROOT, 'src/components/easy/MusicPlayer.jsx'), 'utf8')

test('페이드 길이가 한 곳에 있다 — 양쪽이 같은 값을 본다', () => {
  assert.ok(Number.isFinite(페이드) && 페이드 > 0, 'BGM_STOP_FADE_MS 를 못 읽었다')

  assert.match(훅, /bgmStopAfterMs/, '훅이 당겨 쏘지 않는다 — 꼬리에 페이드가 더 붙는다')
  // 재생기는 **쏘는 쪽이 실어 보낸 길이**를 쓰고, 없으면 정본 상수로 떨어진다.
  // (꼬리가 짧으면 페이드도 줄여야 한다 — 꼬리 0초에 0.32초가 붙던 자리, EV-004737.)
  assert.match(재생기, /Number\(d\.fadeMs\) : BGM_STOP_FADE_MS/,
    '재생기가 상수를 안 쓴다 — 숫자가 두 벌이 된다')
  assert.match(훅, /bgmFadeMsFor\(endDelayMs\)/, '훅이 이번 페이드 길이를 안 정한다')
  // 뒤에 주인 표(owner)가 붙을 수 있다(2026-09-21 로컬 반주) — 보는 것은 페이드·마감을 싣느냐다.
  assert.match(훅, /detail: \{ fadeMs: 페이드ms, 마감시각[ ,]/, '페이드 길이·마감 시각을 신호에 안 싣는다')
  // **마감 시각으로 줄인다** — 신호가 배달되는 데 걸린 시간이 꼬리 위에 얹히던 자리
  // (짧은 꼬리 0.1초에서는 그것만으로 넘쳤다, EV-004753).
  assert.match(재생기, /남은페이드ms\([\s\S]{0,120}?d\.마감시각, Date\.now\(\)\)/, '마감 시각을 안 본다')
  assert.match(재생기, /fadeTo\(0, fadeMs\)/, '정지가 계산한 페이드 길이를 안 쓴다')

  // 예약 안내의 반주를 끄는 꼬리 타이머는 **걷는 자리가 하나**다(Codex 재현, EV-004783).
  assert.match(훅, /const clearBgmTimers = \(\) => \{/, 'BGM 타이머 걷기가 한 곳에 없다')
  const 끄기 = 훅.match(/clearTimeout\(bgmEndTimerRef\.current\)/g) || []
  assert.equal(끄기.length, 1, `끄는 타이머를 걷는 자리가 ${끄기.length}곳이다 — clearBgmTimers 하나만 남겨야 한다`)

  // **부정 앵커 앞에 긍정 앵커**: 이 파일에 정지 페이드가 실제로 있다는 것부터 확인했다(위 줄).
  assert.doesNotMatch(재생기, /fadeTo\(0, 300\b/, '정지 페이드에 숫자를 그대로 적었다')
})

// ── 늦게 깨어나는 것은 **전부** 세대를 확인한다 (2026-09-12 내부 독립 검수) ──────────
//
// **이 가드는 구조 검사다. 브라우저에서 소리가 났는지는 안 본다** — 그것은 MT 다.
// 그래도 여기 두는 이유: 일곱 회차에 걸친 지적이 전부 같은 뿌리였고, 그 뿌리가
// *늦게 깨어난 코드가 정지된 줄 모른다* 였기 때문이다. 위의 손잡이 검사들은
// `setTimeout` 만 본다 — **`await` 는 손잡이가 없어서 그 그물에 안 걸린다.**
// 실제로 R6 을 고친 뒤에도 예약 TTS 경로의 `await` 셋이 그대로였다(같은 검수).
//
// 그래서 규칙을 바꿨다: 손잡이를 세지 말고 **`await` 뒤에 취소 검사가 있는지** 본다.
// 새 `await` 를 취소 검사 없이 넣으면 이 시험이 빨간불이 된다.
test('UX-17: 예약 방송 본문의 모든 await 뒤에 취소 검사가 있다', () => {
  // 세대 표식이 실제로 있다(부정 단언 앞의 긍정 앵커).
  assert.match(훅, /const 세대Ref = useRef\(0\)/, '세대 표식이 없다 — 이 가드를 옮길 것');
  assert.match(훅, /세대Ref\.current \+= 1/, '세대를 올리는 자리가 없다');
  assert.match(훅, /const 취소됨 = \(\) => 세대 !== 세대Ref\.current/, '취소 판정이 없다');

  // 정지·교체·언마운트 셋 다 세대를 올린다. 하나라도 빠지면 그 경로의 정지가 안 먹는다.
  const 올리는자리 = (훅.match(/세대Ref\.current \+= 1/g) || []).length;
  assert.ok(올리는자리 >= 2,
    `세대를 올리는 자리가 ${올리는자리}곳이다 — 정지(stopCurrent)와 언마운트 둘 다에 있어야 한다`);
  assert.match(훅, /const 세대 = \(세대Ref\.current \+= 1\)/, '새 방송이 세대를 올리지 않는다');

  // 예약 방송 처리 본문(`scheduled_broadcast` 분기) 안의 await 를 전부 센다.
  const 본문시작 = 훅.indexOf("const 세대 = (세대Ref.current += 1)");
  assert.ok(본문시작 > 0, '예약 방송 본문을 못 찾았다 — 이 가드를 옮길 것');
  const 본문 = 훅.slice(본문시작, 훅.indexOf('} catch (e) {', 본문시작));
  assert.ok(본문.length > 200, '본문 추출이 비었다 — 이 가드를 옮길 것');

  const 줄 = 본문.split('\n');
  const awaits = [];
  줄.forEach((l, i) => { if (/\bawait\b/.test(l)) awaits.push({ i, l: l.trim() }); });
  assert.ok(awaits.length >= 3, `본문에 await 가 ${awaits.length}개다 — 추출이 잘못됐다`);

  // 각 await 뒤 3줄 안에 취소 검사가 있어야 한다. 없으면 그 자리가 다음 회귀다.
  const 빠진곳 = [];
  for (const a of awaits) {
    const 뒤 = 줄.slice(a.i + 1, a.i + 4).join(' ');
    if (!/취소됨\(\)/.test(뒤)) 빠진곳.push(a.l.slice(0, 70));
  }
  assert.deepEqual(빠진곳, [],
    '취소 검사 없는 await 가 있다 — 정지한 뒤에 깨어나 소리를 낸다:\n  ' + 빠진곳.join('\n  '));
});

test('UX-17: 토스트 타이머도 손잡이를 잡고 언마운트에서 걷는다', () => {
  assert.match(훅, /toastTimerRef\.current = setTimeout\(/, '토스트 타이머에 손잡이가 없다');
  assert.match(훅, /clearTimeout\(toastTimerRef\.current\)/, '토스트 타이머를 걷는 자리가 없다');
});

test('무음이 꼬리 **안에서** 온다 — 적어 둔 값이 아니라 실제로 걸리는 값을 뺀다', () => {
  // 300 을 40ms 씩 나누면 8스텝이라 **320ms** 가 걸린다. 거기에 타이머가 제시간에
  // 안 오는 몫으로 한 틱을 더 뺀다 — 음악이 조금 일찍 조용해지는 것이 5초를 넘기는
  // 것보다 낫다([FACT] EV-004722·EV-004724).
  assert.ok(실제페이드ms >= 페이드, '실제 페이드가 적어 둔 값보다 짧다 — 계산이 틀렸다')
  assert.equal(쏠때(5000), 5000 - 당길ms)
  assert.ok(쏠때(5000) + 실제페이드ms < 5000,
    '실제 페이드를 더하면 꼬리를 넘는다 — 기준을 못 지킨다')
})

test('꼬리가 페이드보다 짧으면 바로 쏜다 — 음수로 밀지 않는다', () => {
  // 음수로 밀면 **안내가 끝나기도 전에** 음악이 준다. 그때는 꼬리 전체가 페이드가 되는 것이
  // "5초 안에 포함" 의 뜻에 가장 가깝다.
  assert.equal(쏠때(100), 0)
  assert.equal(쏠때(페이드), 0)
  assert.equal(쏠때(0), 0, '꼬리가 0이면 즉시 정지다 — 기존 동작')
  assert.equal(쏠때(undefined), 0, '값이 없으면 즉시 정지다')
  assert.equal(쏠때('이상한값'), 0, '숫자가 아니면 즉시 정지다 — NaN 이 타이머로 가면 안 된다')
})

test('1초 꼬리도 맞는다 — 5초만 맞춘 특례가 아니다', () => {
  // 실측에서 1초 꼬리는 1371ms 였다([FACT] EV-003954). 지금은 962ms 다(EV-004724).
  // 5초와 **같은 식**으로 풀린다 — 특례가 아니다.
  assert.equal(쏠때(1000), 1000 - 당길ms)
  assert.ok(쏠때(1000) + 실제페이드ms < 1000, '1초 꼬리에서 페이드가 넘친다')
})
