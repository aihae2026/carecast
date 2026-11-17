import { useEffect, useRef, useState } from 'react'
import { VIEW, createState, startRun, update, fastForward, hitTest } from '../../lib/guideMap'
import { drawStatic, drawDynamic } from '../../lib/guideMapDraw'

// 안내도 인앱 모션 — React 껍데기.
//
// **DOM 애니메이션이 아니다.** 네모 하나하나가 엘리먼트면 방마다 transition이 붙고, 짐이
// 선을 따라 흐르는 것·파티클·소리 파동은 결국 캔버스로 다시 짜게 된다(사용자가 방식을
// 못박은 이유). 여기서는 canvas 2D 한 장에 requestAnimationFrame 루프 하나로 전부 그린다.
// 움직임의 규칙(스프링·마찰·박자)은 lib/guideMap.js에, 칠하기는 lib/guideMapDraw.js에
// 있다 — 심사용 아티팩트(scripts/build-guide-blueprint.cjs)가 그 둘을 그대로 인라인해서
// 같은 그림을 그리므로, 이 파일에는 React에 붙는 배선만 남긴다.

export default function GuideMapCanvas({ cmd, loop, reduced, onStatus }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(null)
  const hoverRef = useRef(null)
  const sizeRef = useRef({ scale: 1, dpr: 1 })
  const staticRef = useRef(null)         // 정적 레이어(방·바탕 파이프·범례)를 구워 두는 오프스크린 캔버스
  const visibleRef = useRef(true)        // 화면 밖이면 루프를 쉰다 — 긴 페이지에서 배터리·CPU 절약
  const statusRef = useRef('')
  const paintRef = useRef(null)          // 지금 그림을 다시 칠하는 함수(루프 바깥에서 부를 때)
  const onStatusRef = useRef(onStatus)
  const [handOver, setHandOver] = useState(false)

  if (stateRef.current == null) stateRef.current = createState()

  useEffect(() => { onStatusRef.current = onStatus })

  // 칠하기 · 크기 맞추기 · 루프를 한 곳에 모은다.
  // 움직임을 끄기로 한 사람(prefers-reduced-motion)에게는 루프를 아예 안 건다 —
  // 대신 누를 때 계산만 끝까지 돌려서(fastForward) 도착한 그림 한 장을 보여 준다.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 매 프레임은 구워 둔 정적 레이어를 얹고 동적인 것만 그린다(프리렌더 기법 —
    // 파이프·방·범례를 프레임마다 다시 긋는 비용이 사라진다)
    const paint = () => {
      const { scale, dpr } = sizeRef.current
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (staticRef.current) ctx.drawImage(staticRef.current, 0, 0)
      ctx.scale(scale * dpr, scale * dpr)
      drawDynamic(ctx, stateRef.current, hoverRef.current)
    }

    // 단계·문구가 바뀔 때만 바깥에 알린다 — 매 프레임 알리면 글까지 매번 다시 그린다
    const report = () => {
      const s = stateRef.current
      const key = `${s.phase}:${s.step}:${s.caption}`
      if (key === statusRef.current) return
      statusRef.current = key
      if (onStatusRef.current) {
        onStatusRef.current({ phase: s.phase, step: s.step, caption: s.caption, source: s.source })
      }
    }

    paintRef.current = () => { paint(); report() }

    // 그림은 1120x620 고정 좌표로 그리고, 캔버스는 칸 너비에 맞춰 배율만 바꾼다.
    // 그래서 어떤 폭에서도 가로 스크롤이 안 생긴다(횡스크롤은 이 프로젝트의 금기다).
    const fit = () => {
      const cssW = wrap.clientWidth
      if (!cssW) return
      const scale = cssW / VIEW.w
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      sizeRef.current = { scale, dpr }
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${VIEW.h * scale}px`
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(VIEW.h * scale * dpr)
      // 정적 레이어를 이 크기로 다시 굽는다 — 크기가 바뀔 때만 일어나는 일
      const off = staticRef.current || (staticRef.current = document.createElement('canvas'))
      off.width = canvas.width
      off.height = canvas.height
      const octx = off.getContext('2d')
      octx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
      drawStatic(octx)
      paint()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    // 웹폰트가 늦게 도착하면 구워 둔 글자가 옛 글꼴이다 — 준비되면 한 번 다시 굽는다
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit())
    // 화면에 안 보이면 시계를 멈춘다(스크롤로 벗어난 동안 계산·칠하기 전부 쉼)
    const io = new IntersectionObserver(([entry]) => { visibleRef.current = entry.isIntersecting })
    io.observe(wrap)

    let raf = 0
    if (reduced) {
      paint()
      report()
    } else {
      let last = 0
      const frame = (now) => {
        if (!visibleRef.current) {
          last = now
          raf = requestAnimationFrame(frame)
          return
        }
        const dt = last ? now - last : 16
        last = now
        update(stateRef.current, dt)
        paint()
        report()
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    }

    return () => {
      ro.disconnect()
      io.disconnect()
      if (raf) cancelAnimationFrame(raf)
      paintRef.current = null
    }
  }, [reduced])

  // 바깥 단추가 보내는 지시 — n이 오를 때마다 한 번씩 처리한다
  useEffect(() => {
    if (!cmd || !cmd.n) return
    if (cmd.kind === 'reset') {
      const fresh = createState()
      fresh.loop = !!loop
      stateRef.current = fresh
    } else {
      startRun(stateRef.current, cmd.source)
      if (reduced) fastForward(stateRef.current, 9000)
    }
    if (paintRef.current) paintRef.current()
  }, [cmd, reduced, loop])

  useEffect(() => {
    stateRef.current.loop = !!loop
  }, [loop])

  const toView = (ev) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const scale = sizeRef.current.scale || 1
    return { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale }
  }

  const onMove = (ev) => {
    const { x, y } = toView(ev)
    const hit = hitTest(x, y)
    hoverRef.current = hit ? hit.id : null
    setHandOver(Boolean(hit && hit.start))
    if (reduced && paintRef.current) paintRef.current()
  }

  const onLeave = () => {
    hoverRef.current = null
    setHandOver(false)
  }

  // 그림 안의 네모를 직접 눌러도 시작한다 — 단추보다 먼저 누르는 곳이 여기다
  const onClick = (ev) => {
    const { x, y } = toView(ev)
    const hit = hitTest(x, y)
    if (!hit || !hit.start) return
    startRun(stateRef.current, hit.id)
    if (reduced) fastForward(stateRef.current, 9000)
    if (paintRef.current) paintRef.current()
  }

  return (
    <div ref={wrapRef} className="w-full">
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={onClick}
        className={`block w-full ${handOver ? 'cursor-pointer' : 'cursor-default'}`}
        role="img"
        aria-label="요양원 배치도. 사무실 PC와 휴대폰에서 넣은 예약이 방송실로 들어가고, 시계 지킴이가 시각을 보면 방송 진행 담당이 순서를 만들어 소리 담당에게 넘긴다. 소리는 두 갈래로 홀 스피커와 TV로 나가고, 장부에 기록이 남으며, 지켜보기가 안 나간 방송을 찾는다. 같은 내용이 아래 글로도 적혀 있다."
      />
    </div>
  )
}
