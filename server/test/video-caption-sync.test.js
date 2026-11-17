'use strict'
// 영상 자막의 **싱크**를 고정한다 (2026-09-12).
//
// 왜 이 검사가 따로 필요한가: 영상은 소리를 **일부러 늦춰서** 내보낸다. TV HDMI 지연만큼
// Web Audio DelayNode 로 미루는 장치가 이미 있고(체조·식사 각각 기본 450ms), 그래야 홀
// TV 에서 입이 맞는다. 그런데 자막을 `video.currentTime` 그대로 따라가게 두면
// **PC 모니터에서 자막이 소리보다 정확히 그만큼 앞선다.**
//
// 0.45초는 "틀렸다"고 느끼기엔 애매하고 "맞다"고 하기엔 어긋난 크기라, 사람이 봐서는
// 원인을 못 짚는다. 그래서 숫자와 배선을 여기서 고정한다.
//
// 소스 대조다 — 이 배선은 브라우저 미디어 요소와 Web Audio 를 타서 순수 함수로 못 뗀다.
// 그래서 **부정 단언 앞에 긍정 앵커**를 먼저 세운다(CLAUDE.md).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const 재생기 = () => 읽기('src', 'components', 'broadcast', 'VideoPlayer.jsx')
const 자막층 = () => 읽기('src', 'components', 'broadcast', 'BroadcastCaption.jsx')

test('영상이 재생되면 자막을 붙이고 **미룬 만큼 + 오프셋**을 함께 넘긴다', () => {
  const src = 재생기()
  // 긍정 앵커 — 소리를 미루는 장치가 이 파일에 있다
  assert.match(src, /setupWebAudioDelay\(v, delayMs\)/, '소리 미룸이 사라졌다 — 이 가드를 옮길 것')

  // **자막 시점 = 영상 보정 + 자막 오프셋**(2026-09-16). 소리는 보정만큼만 늦고, 자막은
  // 그 위에서 앞뒤로 더 움직인다 — 눈이 귀보다 자막을 먼저 찾기 때문이다
  // (*"자막은 조금 늦어, 그래서 조금 빠르게 설정할 수 있도록"*).
  assert.match(src, /자막붙이기\(v, delayMs, captionOffsetRef\.current\)/,
    '재생 시작에서 자막을 안 붙이거나, 오프셋을 안 넘긴다')
  assert.match(src, /offsetMs: \(Number\(delayMs\) \|\| 0\) \+ \(Number\(offsetMs\) \|\| 0\)/,
    'caption-attach 가 둘을 안 더한다 — 자막을 당기는 설정이 아무 일도 안 한다')
})

test('확인된 자막만 나간다 — 초안은 홀 화면에 안 뜬다', () => {
  const src = 재생기()
  assert.match(src, /subtitle\?\.status !== 'ready'\) return/,
    "status가 'ready'가 아닌 자막까지 띄운다 — 잘못 들은 초안이 홀에 뜬다")
})

test('슬라이더를 움직이면 **재생 중인 것에 바로** 먹는다 — 둘 다', () => {
  const src = 재생기()
  // 보정 갈래(A/B)가 없어져 영상 처리기도 하나다(2026-09-16). 대신 자막 오프셋이 생겼다.
  assert.match(src, /const onDelay = /, 'onDelay 를 못 찾았다 — 가드를 옮길 것')
  assert.match(src, /const onCaptionOffset = /, 'onCaptionOffset 을 못 찾았다')
  assert.ok(!/const onDelayExercise = /.test(src), '갈래별 처리기가 되살아났다 — 값은 하나뿐이다')

  const 본문 = (이름) => {
    const m = new RegExp(`const ${이름} = \\(e\\) => \\{([\\s\\S]*?)\\n {4}\\}`).exec(src)
    assert.ok(m, `${이름} 본문을 못 읽었다`)
    return m[1]
  }

  // 영상 슬라이더 — 소리와 자막이 **같이** 움직인다.
  const d = 본문('onDelay')
  assert.match(d, /delayTime\.value = ms \/ 1000/, 'onDelay 가 소리를 안 옮긴다')
  assert.match(d, /자막보정\(ms, captionOffsetRef\.current\)/,
    'onDelay 가 소리만 옮기고 자막을 안 옮긴다 — 슬라이더를 만지는 순간 글자가 어긋난다')

  // 자막 슬라이더 — **소리는 안 건드린다.** 그게 이 값의 존재 이유다.
  const c = 본문('onCaptionOffset')
  assert.match(c, /자막보정\(audioDelayRef\.current, ms\)/, 'onCaptionOffset 이 자막을 안 옮긴다')
  assert.ok(!/delayTime\.value/.test(c),
    '자막 오프셋이 소리까지 옮긴다 — 자막만 당기려고 만든 값이다')
})

test('영상이 끝나거나 정지하면 자막을 걷는다 — 걷는 자리가 둘 다 있어야 한다', () => {
  const src = 재생기()
  const 끝 = /const handleEnded = async \(\) => \{([\s\S]*?)\n {2}\}/.exec(src)
  assert.ok(끝, 'handleEnded 를 못 찾았다 — 가드를 옮길 것')
  assert.match(끝[1], /caption-end/, '자연 종료에서 자막이 남는다')

  const 정지 = /const onStop = \(\) => \{([\s\S]*?)\n {4}\}/.exec(src)
  assert.ok(정지, 'onStop 을 못 찾았다 — 가드를 옮길 것')
  assert.match(정지[1], /caption-end/,
    '정지 경로가 자막을 안 걷는다 — 빈 화면에 글자가 남고, 그 보정값이 다음 음원 자막까지 민다')
})

test('자막층이 보정을 받아 실제로 빼고, 걷을 때 0으로 되돌린다', () => {
  const src = 자막층()
  // 긍정 앵커 — 실측 시계를 쓰는 자리가 이 파일에 있다
  assert.match(src, /const audio = audioRef\.current/, '시계 자리를 못 찾았다 — 가드를 옮길 것')

  assert.match(src, /offsetRef\.current = Number\.isFinite\(v\) \? v : 0/,
    'attach 에서 보정값을 안 받는다')
  assert.match(src, /t = audio\.currentTime - offsetRef\.current \/ 1000/,
    '실측 시계에서 보정을 안 뺀다 — offsetMs 를 받아 놓고 안 쓰는 것이 가장 나쁘다')
  // **되돌리는 것이 핵심이다.** 안 되돌리면 영상 뒤의 음원 자막이 450ms 밀린다.
  assert.match(src, /clockRef\.current = null; offsetRef\.current = 0/,
    '자막을 걷을 때 보정값을 안 지운다 — 다음 음원 자막이 밀린다')
})

test('음원 경로는 보정이 0이다 — 영상 때문에 음원이 밀리면 안 된다', () => {
  const 음원 = 읽기('src', 'components', 'easy', 'MusicPlayer.jsx')
  const 예약 = 읽기('src', 'hooks', 'useScheduledBroadcast.js')
  for (const [이름, src] of [['MusicPlayer', 음원], ['useScheduledBroadcast', 예약]]) {
    // 긍정 앵커 — 그 파일이 실제로 자막을 붙인다
    assert.match(src, /carecast:caption-attach/, `${이름} 이 자막을 안 붙인다 — 가드를 옮길 것`)
    assert.ok(!/caption-attach[\s\S]{0,120}offsetMs/.test(src),
      `${이름} 이 보정값을 싣는다 — 음원은 소리를 미루지 않으므로 0이어야 한다`)
  }
})
