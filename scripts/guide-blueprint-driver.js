/* 안내도·설계도 합본(심사용 아티팩트) — 바닐라 배선.
 *
 * 이 파일 앞에 src/lib/guideMap.js(움직임)와 src/lib/guideMapDraw.js(칠하기)가
 * 글자 그대로 인라인돼 같은 스코프에 있다(build-guide-blueprint.cjs가 이어붙인다).
 * 여기는 앱의 GuideMapCanvas.jsx·GuideMapPage.jsx가 React로 하는 배선을 DOM으로
 * 옮긴 것만 담는다 — 그림 규칙·좌표·문구(BEATS)는 절대 여기 두지 않는다.
 *
 * eslint에게: 이 파일은 브라우저에서, 인라인된 두 모듈 뒤에서 돈다.
 */
/* global document, window, location, history, matchMedia, ResizeObserver, IntersectionObserver,
          requestAnimationFrame,
          VIEW, BEATS, createState, startRun, update, fastForward, hitTest, launchToken,
          drawStatic, drawDynamic */
(function () {
  'use strict'
  const $ = (id) => document.getElementById(id)

  // ── 탭 — 안내도(누구나) / 설계도(개발자). #blueprint 해시로 설계도 직행 ──
  const tabs = { guide: $('tabGuide'), blueprint: $('tabBlueprint') }
  const secs = { guide: $('secGuide'), blueprint: $('secBlueprint') }
  function openTab(name) {
    for (const k of Object.keys(tabs)) {
      const on = k === name
      tabs[k].classList.toggle('on', on)
      tabs[k].setAttribute('aria-pressed', String(on))
      secs[k].hidden = !on
    }
    try {
      history.replaceState(null, '', location.pathname + (name === 'blueprint' ? '#blueprint' : ''))
    } catch { /* file://에서 막히는 브라우저가 있다 — 탭은 이미 바뀌었다 */ }
    if (name === 'guide') fit()   // 숨김 동안 폭이 0이었다 — 돌아오면 다시 잰다
  }
  tabs.guide.addEventListener('click', () => openTab('guide'))
  tabs.blueprint.addEventListener('click', () => openTab('blueprint'))
  if (location.hash === '#blueprint') openTab('blueprint')

  // ── 순서 칩 — BEATS가 원본이다. 제목만 적는다(자막은 그림 아래 cap 줄이 진행 중에 보여 준다) ──
  const stepsOl = $('steps')
  for (const b of BEATS.filter((x) => x.step)) {
    const li = document.createElement('li')
    li.dataset.step = String(b.step)
    const no = document.createElement('span')
    no.className = 'stepNo' + (b.step >= 4 ? ' sound' : '')
    no.textContent = String(b.step)
    const body = document.createElement('span')
    body.className = 'stepBody'
    const bt = document.createElement('b')
    bt.textContent = b.title
    body.append(bt)
    li.append(no, body)
    stepsOl.appendChild(li)
  }

  // ── 캔버스 — GuideMapCanvas.jsx와 같은 순서: 배율 맞추고, 매 프레임 계산→칠하기 ──
  const wrap = $('canvasWrap')
  const canvas = $('mapCanvas')
  const ctx = canvas.getContext('2d')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  let state = createState()
  let hoverId = null
  let size = { scale: 1, dpr: 1 }
  let staticCanvas = null   // 정적 레이어(방·바탕 파이프·범례) — 크기 바뀔 때만 다시 굽는다
  let visible = true        // 스크롤로 화면을 벗어나면 루프를 쉰다

  // 매 프레임은 구워 둔 정적 레이어를 얹고 동적인 것만 그린다(프리렌더 기법)
  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (staticCanvas) ctx.drawImage(staticCanvas, 0, 0)
    ctx.scale(size.scale * size.dpr, size.scale * size.dpr)
    drawDynamic(ctx, state, hoverId)
  }

  // 단계·문구가 바뀔 때만 글을 만진다 — 매 프레임 DOM을 만지면 캔버스보다 글이 비싸진다
  let statusKey = ''
  const capBadge = $('capBadge')
  const capText = $('capText')
  function report() {
    const key = state.phase + ':' + state.step + ':' + state.caption
    if (key === statusKey) return
    statusKey = key
    capText.textContent = state.caption
    capBadge.textContent = state.step ? String(state.step) : ''
    capBadge.hidden = !state.step
    for (const li of stepsOl.children) {
      li.classList.toggle('on', Number(li.dataset.step) === state.step)
    }
  }
  const paintReport = () => { paint(); report() }

  // 그림은 VIEW 고정 좌표로 그리고 캔버스는 칸 너비에 맞춰 배율만 바꾼다 — 횡스크롤 금기
  function fit() {
    const cssW = wrap.clientWidth
    if (!cssW) return
    const scale = cssW / VIEW.w
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    size = { scale, dpr }
    canvas.style.width = cssW + 'px'
    canvas.style.height = VIEW.h * scale + 'px'
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(VIEW.h * scale * dpr)
    // 정적 레이어 굽기 — 크기가 바뀔 때만
    staticCanvas = staticCanvas || document.createElement('canvas')
    staticCanvas.width = canvas.width
    staticCanvas.height = canvas.height
    const octx = staticCanvas.getContext('2d')
    octx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
    drawStatic(octx)
    paint()
  }
  fit()
  new ResizeObserver(fit).observe(wrap)
  // 웹폰트(Noto Sans KR)가 늦게 오면 구운 글자가 옛 글꼴 — 준비되면 한 번 다시 굽는다
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit())
  // 화면 밖이면 시계를 멈춘다 — 긴 페이지에서 배터리·CPU 절약
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting }).observe(wrap)

  // 움직임을 줄여 달라는 설정이면 루프를 아예 안 건다 — 누르면 결과 그림만 나온다
  if (reduced) {
    $('reducedNote').hidden = false
    paintReport()
  } else {
    let last = 0
    const frame = (now) => {
      if (!visible) {
        last = now
        requestAnimationFrame(frame)
        return
      }
      const dt = last ? now - last : 16
      last = now
      update(state, dt)
      drainArrivals()
      paintReport()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  // ── 단추 ──
  function begin(source) {
    startRun(state, source)
    if (reduced) fastForward(state, 9000)
    paintReport()
  }
  $('btnOffice').addEventListener('click', () => begin('office'))
  $('btnPhone').addEventListener('click', () => begin('phone'))
  const btnLoop = $('btnLoop')
  btnLoop.addEventListener('click', () => {
    state.loop = !state.loop
    btnLoop.classList.toggle('on', state.loop)
    btnLoop.setAttribute('aria-pressed', String(state.loop))
    // 글자만 바꾼다 — textContent로 통째 갈면 단추 안 아이콘(svg)이 날아간다
    $('loopLabel').textContent = state.loop ? '되풀이 켜짐' : '되풀이'
  })
  $('btnReset').addEventListener('click', () => {
    const loop = state.loop
    state = createState()
    state.loop = loop
    statusKey = ''
    paintReport()
  })

  // ── 조형물 떨어뜨리기 — 차임벨·안내 음성·BGM이 길을 여행하고, 도착하면 소리가 난다 ──
  // 소리는 WebAudio 합성음(파일 없음). 단추를 누른 손짓이 있어야 소리 재생이 풀리므로
  // AudioContext는 첫 클릭에 만든다. 이 소리는 아티팩트 전용이다 — 앱 /guide에 넣으면
  // 현장 PC에서 홀 스피커로 나갈 수 있어 일부러 뺐다.
  let audio = null
  function tone(freq, at, dur, type, peak) {
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.type = type || 'sine'
    o.frequency.value = freq
    const t0 = audio.currentTime + at
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(peak || 0.12, t0 + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
    o.connect(g).connect(audio.destination)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
  }
  function playKind(kind) {
    if (!audio) return
    if (kind === 'chime') {          // 딩-동
      tone(880, 0, 0.7, 'sine', 0.14)
      tone(659, 0.22, 0.9, 'sine', 0.12)
    } else if (kind === 'bgm') {     // 도-미-솔 아르페지오
      tone(523, 0, 0.18, 'triangle', 0.11)
      tone(659, 0.14, 0.18, 'triangle', 0.11)
      tone(784, 0.28, 0.42, 'triangle', 0.11)
    } else {                         // 안내 음성 — 말하는 리듬의 블립 셋
      tone(430, 0, 0.1, 'triangle', 0.1)
      tone(520, 0.13, 0.1, 'triangle', 0.1)
      tone(470, 0.27, 0.16, 'triangle', 0.1)
    }
  }
  function drainArrivals() {
    if (!state.tokenArrivals.length) return
    for (const k of state.tokenArrivals) playKind(k)
    state.tokenArrivals.length = 0
  }
  function dropToken(kind) {
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)() } catch { /* 소리 없이도 여행은 한다 */ }
    }
    if (audio && audio.state === 'suspended') audio.resume()
    launchToken(state, kind)
    if (reduced) {
      fastForward(state, 8000)
      drainArrivals()
    }
    paintReport()
  }
  $('btnTokChime').addEventListener('click', () => dropToken('chime'))
  $('btnTokTts').addEventListener('click', () => dropToken('tts'))
  $('btnTokBgm').addEventListener('click', () => dropToken('bgm'))

  // ── 그림 안에서 직접 누르기 — 시작점 둘만 반응한다 ──
  function toView(ev) {
    const r = canvas.getBoundingClientRect()
    const s = size.scale || 1
    return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s }
  }
  canvas.addEventListener('mousemove', (ev) => {
    const v = toView(ev)
    const hit = hitTest(v.x, v.y)
    hoverId = hit ? hit.id : null
    canvas.style.cursor = hit && hit.start ? 'pointer' : 'default'
    if (reduced) paintReport()
  })
  canvas.addEventListener('mouseleave', () => {
    hoverId = null
    canvas.style.cursor = 'default'
  })
  canvas.addEventListener('click', (ev) => {
    const v = toView(ev)
    const hit = hitTest(v.x, v.y)
    if (hit && hit.start) begin(hit.id)
  })
})()
