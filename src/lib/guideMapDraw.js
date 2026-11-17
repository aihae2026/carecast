// 안내도 인앱 모션 — 칠하기(canvas 2D). React도 DOM도 모르는 순수 함수만 둔다.
//
// 왜 분리했나(2026-09-02): 이 그림은 두 군데서 그려진다 — 앱(/guide, GuideMapCanvas.jsx)과
// 심사용 아티팩트(scripts/build-guide-blueprint.cjs가 이 파일을 **글자 그대로 인라인**한다).
// 칠하기가 컴포넌트 안에 있으면 아티팩트 쪽에 사본이 생겨서 고칠 때마다 어긋난다.
// 그래서 규칙은 guideMap.js(움직임)와 같다: 여기는 (ctx, state)만 받는 순수 함수.
//
// 인라인 방식의 제약: 빌드 스크립트가 `import`/`export ` 줄머리를 지우고 이어붙인다.
// **import는 이 한 줄만, export는 줄 머리에서만** 쓸 것.
import { VIEW, ROOMS, NODES, EDGES, edgeById, pointAtDistance, pathLength, clamp } from './guideMap'

// 디자인 시스템(라벤더 셋업) 글꼴 규칙 — Noto Sans KR이 1순위(아티팩트가 로드),
// 앱에서는 아직 안 실려 Pretendard로 떨어진다(코드 환경설정 적용은 별도 결정).
export const FONT = '"Noto Sans KR", Pretendard, system-ui, "Malgun Gothic", sans-serif'

export const C = {
  surface: '#FFFFFF',
  surface2: '#F8FAFF',
  line: '#E8ECF4',
  ink: '#1A1D2E',
  sub: '#6B7280',
  faint: '#9AA3B2',
  wire: '#4F8EF7',
  wireSoft: '#EFF6FF',
  sound: '#F97316',
  soundSoft: '#FFF7ED',
  quiet: '#94A3B8',
  pipe: '#E3E9F2', // 파이프 바탕 — 연한 회청
  // 놀이 짐(조형물) 색 — 디자인 시스템의 방송 종류색을 그대로 쓴다
  kindTts: '#286AC8',    // 안내
  kindBgm: '#BD4049',    // BGM
  kindChime: '#B84800',  // 즉시(차임)
}

export const kindColor = (kind) =>
  (kind === 'tts' ? C.kindTts : kind === 'bgm' ? C.kindBgm : kind === 'chime' ? C.kindChime : null)

// 파이프 길이 캐시 — 좌표는 고정이라 pathLength를 매 프레임 다시 재지 않는다
const PIPE_LEN = {}

export const toneColor = (tone) =>
  (tone === 'sound' ? C.sound : tone === 'quiet' ? C.quiet : tone === 'faint' ? C.faint : C.wire)
export const toneSoft = (tone) => (tone === 'sound' ? C.soundSoft : C.wireSoft)

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function polyline(ctx, points) {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
}

// 꺾이는 자리를 둥글린 폴리라인 — 파이프 전용(짐·방울의 좌표 계산은 원래 꺾은선을 쓴다.
// 반지름을 파이프 반폭 수준으로 작게 잡아 둘의 어긋남이 관 두께 안에 묻힌다).
export function roundedPolyline(ctx, points, r = 10) {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length - 1; i++) {
    ctx.arcTo(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], r)
  }
  const last = points[points.length - 1]
  ctx.lineTo(last[0], last[1])
}

export function arrowHead(ctx, x, y, dx, dy, size, color) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.atan2(dy, dx))
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-size, size * 0.5)
  ctx.lineTo(-size, -size * 0.5)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

// ── 담당 네모 안의 작은 그림 ──────────────────────────────────────────────

export function drawClockFace(ctx, n, e, t) {
  const cx = n.x + 18
  const cy = n.y + 20
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.globalAlpha = 0.35 + 0.65 * clamp(e, 0, 1)
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.arc(cx, cy, 10, 0, Math.PI * 2)
  ctx.stroke()
  // 초침은 늘 돌고, 켜져 있을 때 빨라진다 — 삼각함수로 바늘 끝을 찍는다
  const spin = t * (1.1 + 3.4 * clamp(e, 0, 1))
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(spin - Math.PI / 2) * 7.5, cy + Math.sin(spin - Math.PI / 2) * 7.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(spin / 12 - Math.PI / 2) * 5, cy + Math.sin(spin / 12 - Math.PI / 2) * 5)
  ctx.stroke()
  ctx.restore()
}

export function drawSpeakerFace(ctx, n, e, t) {
  const x = n.x + 18
  const y = n.y + n.h / 2
  ctx.save()
  ctx.fillStyle = C.sound
  ctx.globalAlpha = 0.5 + 0.5 * clamp(e, 0, 1)
  ctx.beginPath()
  ctx.moveTo(x - 5, y - 4)
  ctx.lineTo(x - 1, y - 4)
  ctx.lineTo(x + 4, y - 9)
  ctx.lineTo(x + 4, y + 9)
  ctx.lineTo(x - 1, y + 4)
  ctx.lineTo(x - 5, y + 4)
  ctx.closePath()
  ctx.fill()
  // 스피커 앞의 잔물결 — 진폭이 sin으로 커졌다 작아진다
  ctx.strokeStyle = C.sound
  ctx.lineWidth = 1.4
  for (let i = 1; i <= 2; i++) {
    const amp = 0.25 + 0.75 * clamp(e, 0, 1) * (0.6 + 0.4 * Math.sin(t * 7 - i))
    ctx.globalAlpha = amp * 0.7
    ctx.beginPath()
    ctx.arc(x + 5, y, 5 + i * 4.5, -0.8, 0.8)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawTvFace(ctx, n, e, t) {
  const x = n.x + 12
  const y = n.y + n.h / 2 - 9
  ctx.save()
  ctx.strokeStyle = C.sound
  ctx.globalAlpha = 0.5 + 0.5 * clamp(e, 0, 1)
  ctx.lineWidth = 1.4
  roundRect(ctx, x, y, 22, 16, 3)
  ctx.stroke()
  // 화면이 재생 중이면 주사선 하나가 위아래로 훑는다
  if (e > 0.2) {
    const ly = y + 2 + ((t * 26) % 12)
    ctx.globalAlpha = 0.25 + 0.55 * clamp(e, 0, 1)
    ctx.beginPath()
    ctx.moveTo(x + 2.5, ly)
    ctx.lineTo(x + 19.5, ly)
    ctx.stroke()
  }
  ctx.restore()
}

// 사무실 = 작은 건물. 왼쪽 위 모서리(가운데 글과 안 겹치는 자리), 창문에 불이 들어온다.
export function drawBuildingFace(ctx, n, e) {
  const x = n.x + 14
  const y = n.y + 8
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.fillStyle = C.wireSoft
  ctx.strokeStyle = C.wire
  ctx.lineWidth = 1.4
  roundRect(ctx, x, y, 22, 26, 3)
  ctx.fill()
  ctx.stroke()
  // 창문 2x3 — 켜지면 채워진다
  ctx.fillStyle = C.wire
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      ctx.globalAlpha = (0.35 + 0.65 * a) * (r === 2 && c === 1 ? 1 : 0.75)
      ctx.fillRect(x + 4.5 + c * 8, y + 4 + r * 6, 4.5, 3.5)
    }
  }
  // 문
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.fillRect(x + 8.5, y + 20, 5, 6)
  ctx.restore()
}

// 폰 · 태블릿 = 휴대폰. 왼쪽 위 모서리, 켜지면 화면이 밝아진다.
export function drawPhoneFace(ctx, n, e) {
  const x = n.x + 17
  const y = n.y + 8
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.strokeStyle = C.wire
  ctx.lineWidth = 1.4
  roundRect(ctx, x, y, 15, 26, 3.5)
  ctx.stroke()
  if (a > 0.25) {
    ctx.fillStyle = C.wireSoft
    ctx.globalAlpha = 0.9 * a
    roundRect(ctx, x + 2.5, y + 3, 10, 16, 1.5)
    ctx.fill()
  }
  ctx.fillStyle = C.wire
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.beginPath()
  ctx.arc(x + 7.5, y + 22, 1.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// 바깥 인터넷 = 구름.
export function drawCloudFace(ctx, n, e) {
  const cx = n.x + 26
  const cy = n.y + 24
  ctx.save()
  ctx.fillStyle = C.quiet
  ctx.globalAlpha = 0.4 + 0.45 * clamp(e, 0, 1)
  ctx.beginPath()
  ctx.arc(cx - 6, cy + 2, 4.5, 0, Math.PI * 2)
  ctx.arc(cx + 1, cy - 2, 5.5, 0, Math.PI * 2)
  ctx.arc(cx + 8, cy + 2, 4.5, 0, Math.PI * 2)
  ctx.rect(cx - 6, cy + 1, 14, 5.5)
  ctx.fill()
  ctx.restore()
}

// 장부 = 펼친 책.
export function drawBookFace(ctx, n, e) {
  const cx = n.x + 26
  const cy = n.y + 20
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.fillStyle = C.wireSoft
  ctx.lineWidth = 1.3
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.beginPath()
  ctx.moveTo(cx, cy - 6)
  ctx.quadraticCurveTo(cx - 6, cy - 9, cx - 11, cy - 7)
  ctx.lineTo(cx - 11, cy + 5)
  ctx.quadraticCurveTo(cx - 6, cy + 3, cx, cy + 6)
  ctx.quadraticCurveTo(cx + 6, cy + 3, cx + 11, cy + 5)
  ctx.lineTo(cx + 11, cy - 7)
  ctx.quadraticCurveTo(cx + 6, cy - 9, cx, cy - 6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy - 6)
  ctx.lineTo(cx, cy + 6)
  ctx.stroke()
  ctx.restore()
}

// 방송 진행 담당 = 단계 바 셋. 진행 중이면 위에서부터 차례로 밝아진다.
export function drawStepsFace(ctx, n, e, t) {
  const x = n.x + 12
  const y = n.y + 10
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.lineCap = 'round'
  ctx.lineWidth = 3
  const lens = [13, 9, 5]
  for (let i = 0; i < 3; i++) {
    const pulse = a > 0.2 ? Math.max(0, Math.sin(t * 4.5 - i * 0.9)) : 0
    ctx.globalAlpha = 0.3 + 0.35 * a + 0.35 * pulse
    ctx.beginPath()
    ctx.moveTo(x, y + i * 5)
    ctx.lineTo(x + lens[i], y + i * 5)
    ctx.stroke()
  }
  ctx.restore()
}

// 소리 담당 = 이퀄라이저. 소리가 지나가면 막대가 춤춘다.
export function drawEqFace(ctx, n, e, t) {
  const x = n.x + 14
  const y = n.y + 26
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.lineCap = 'round'
  ctx.lineWidth = 3
  const base = [7, 11, 5]
  for (let i = 0; i < 3; i++) {
    const h = a > 0.2 ? 4 + base[i] * (0.45 + 0.55 * Math.abs(Math.sin(t * 6 + i * 1.1))) : base[i] * 0.6 + 2
    ctx.globalAlpha = 0.4 + 0.6 * a
    ctx.beginPath()
    ctx.moveTo(x + i * 6, y)
    ctx.lineTo(x + i * 6, y - h)
    ctx.stroke()
  }
  ctx.restore()
}

// 지켜보기 = 눈. 글이 왼쪽 정렬인 칸이라 오른쪽 끝에 둔다.
export function drawEyeFace(ctx, n, e) {
  const cx = n.x + 26
  const cy = n.y + 20
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.lineWidth = 1.4
  ctx.globalAlpha = 0.4 + 0.6 * a
  ctx.beginPath()
  ctx.moveTo(cx - 10, cy)
  ctx.quadraticCurveTo(cx, cy - 8, cx + 10, cy)
  ctx.quadraticCurveTo(cx, cy + 8, cx - 10, cy)
  ctx.stroke()
  ctx.fillStyle = C.wire
  ctx.beginPath()
  ctx.arc(cx, cy, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// 음성 만들기 = 말풍선. 글자가 소리가 되는 곳이라 짐(안내 음성)과 같은 글리프를 쓴다.
// 켜지면 안에서 물결이 인다 — 말이 나오고 있다는 뜻.
function drawSpeechFace(ctx, n, e, t) {
  const x = n.x + 12
  const y = n.y + 12
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.lineWidth = 1.4
  ctx.lineJoin = 'round'
  roundRect(ctx, x, y, 20, 14, 3.5)
  ctx.stroke()
  // 꼬리
  ctx.beginPath()
  ctx.moveTo(x + 5, y + 14)
  ctx.lineTo(x + 5, y + 18.5)
  ctx.lineTo(x + 10.5, y + 14)
  ctx.stroke()
  // 안의 물결 — 켜지면 진폭이 sin으로 오르내린다
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.6
  for (let i = 0; i < 3; i++) {
    const hgt = a > 0.2 ? 2.5 + 3 * Math.abs(Math.sin(t * 6 + i * 1.2)) : 2.5
    ctx.globalAlpha = 0.4 + 0.6 * a
    ctx.beginPath()
    ctx.moveTo(x + 6 + i * 4, y + 7 - hgt / 2)
    ctx.lineTo(x + 6 + i * 4, y + 7 + hgt / 2)
    ctx.stroke()
  }
  ctx.restore()
}

// 새 판본 받기 = 내려받는 화살표 + 받침. 켜지면 화살표가 받침으로 톡 떨어진다.
function drawDownloadFace(ctx, n, e, t) {
  const x = n.x + 25
  const y = n.y + 14
  const a = clamp(e, 0, 1)
  // 0~1을 오가는 톱니 — 켜져 있을 때만 움직인다
  const drop = a > 0.2 ? (t * 1.3) % 1 : 0
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.fillStyle = C.wire
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // 화살대
  const dy = drop * 4
  ctx.beginPath()
  ctx.moveTo(x, y + dy)
  ctx.lineTo(x, y + 8 + dy)
  ctx.stroke()
  // 화살촉
  ctx.beginPath()
  ctx.moveTo(x - 4, y + 5 + dy)
  ctx.lineTo(x, y + 10 + dy)
  ctx.lineTo(x + 4, y + 5 + dy)
  ctx.stroke()
  // 받침
  ctx.beginPath()
  ctx.moveTo(x - 7, y + 14)
  ctx.lineTo(x - 7, y + 18)
  ctx.lineTo(x + 7, y + 18)
  ctx.lineTo(x + 7, y + 14)
  ctx.stroke()
  ctx.restore()
}

// 전원 켜기 · 자동 종료 = 전원 기호. 하루의 처음과 끝이라 같은 기호를 쓴다.
function drawPowerFace(ctx, n, e) {
  const cx = n.x + 26
  const cy = n.y + 20
  const a = clamp(e, 0, 1)
  ctx.save()
  ctx.strokeStyle = C.wire
  ctx.globalAlpha = 0.45 + 0.55 * a
  ctx.lineWidth = 1.7
  ctx.lineCap = 'round'
  // 위쪽을 비운 원 — 그 틈으로 세로 막대가 들어간다
  ctx.beginPath()
  ctx.arc(cx, cy, 8.5, -Math.PI * 0.32, Math.PI * 1.32)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy - 10.5)
  ctx.lineTo(cx, cy - 1.5)
  ctx.stroke()
  ctx.restore()
}

// 시작 지킴이 = 다시 켜기 화살표. 켜지면 천천히 한 바퀴 돈다 — 계속 지켜본다는 뜻.
function drawRestartFace(ctx, n, e, t) {
  const cx = n.x + 25
  const cy = n.y + 21
  const a = clamp(e, 0, 1)
  const r = 9
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(a > 0.2 ? t * 1.6 : 0)
  ctx.strokeStyle = C.wire
  ctx.globalAlpha = 0.4 + 0.6 * a
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  // 한 바퀴에서 위쪽을 조금 비운다 — 그 틈이 화살촉 자리다
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI * 0.35, Math.PI * 1.25)
  ctx.stroke()
  // 화살촉 — 열린 끝에 붙인다
  ctx.fillStyle = C.wire
  ctx.beginPath()
  ctx.moveTo(r * Math.cos(-Math.PI * 0.35), r * Math.sin(-Math.PI * 0.35))
  ctx.lineTo(r * Math.cos(-Math.PI * 0.35) - 4.5, r * Math.sin(-Math.PI * 0.35) - 2.5)
  ctx.lineTo(r * Math.cos(-Math.PI * 0.35) + 1.5, r * Math.sin(-Math.PI * 0.35) - 5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// ── 한 장 그리기 ──────────────────────────────────────────────────────────
//
// 정적/동적 두 겹으로 나눈다(web.dev canvas-performance의 prerender/layered 기법):
// 방·바탕 파이프·범례·메모·기본 화살촉·기본 배지는 프레임마다 똑같으므로, 그리는 쪽이
// drawStatic을 오프스크린 캔버스에 한 번 구워 두고(크기 바뀔 때만) 매 프레임은 그 그림을
// 얹은 뒤 drawDynamic만 그린다. draw()는 둘을 이어 부르는 호환용(캐시 없는 호출자용).

export function drawStatic(ctx) {
  const roomLabels = []   // 선 위에 얹을 방 이름 — 아래 파이프 루프가 끝난 뒤에 그린다
  // 방(테두리 상자) — 배경처럼 물러나도록 옅게, 모서리는 더 둥글게
  for (const room of ROOMS) {
    ctx.save()
    ctx.strokeStyle = room.tone === 'faint' ? C.line : toneColor(room.tone)
    ctx.globalAlpha = room.tone === 'faint' ? 0.75 : 0.32
    ctx.lineWidth = 1.4
    if (room.dashed) ctx.setLineDash([7, 5])
    roundRect(ctx, room.x, room.y, room.w, room.h, 16)
    ctx.stroke()
    ctx.restore()

    // 홀에는 지붕을 얹는다 — 방송이 도착하는 "집"이라는 뜻
    let labelX = room.x + 16
    if (room.id === 'hall') {
      ctx.save()
      ctx.strokeStyle = C.sound
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(room.x + 16, room.y + 18)
      ctx.lineTo(room.x + 22, room.y + 12)
      ctx.lineTo(room.x + 28, room.y + 18)
      ctx.moveTo(room.x + 17.5, room.y + 18)
      ctx.lineTo(room.x + 17.5, room.y + 22.5)
      ctx.lineTo(room.x + 26.5, room.y + 22.5)
      ctx.lineTo(room.x + 26.5, room.y + 18)
      ctx.stroke()
      ctx.restore()
      labelX = room.x + 34
    }
    // 라벨은 **선을 다 그린 뒤에** 그린다(2026-09-04 사용자 지적: "흐름도가 방 이름을 가린다").
    // 파이프는 방 테두리 위를 지나가도 되지만 글자는 아니다 — 글자가 먼저다.
    roomLabels.push({ text: room.label, x: labelX, y: room.y + 22, tone: room.tone })
  }

  // 바탕 파이프·하이라이트·기본 화살촉·기본 배지·메모 — 켜짐과 무관한 부분 전부
  for (const edge of EDGES) {
    const pts = edge.points
    const end = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    const dx = end[0] - prev[0]
    const dy = end[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // 파선 관은 둥근 점(cap이 round라 길이 0.5짜리 대시가 원이 된다)
    ctx.strokeStyle = C.pipe
    ctx.lineWidth = 7
    if (edge.dashed) ctx.setLineDash([0.5, 13])
    roundedPolyline(ctx, pts)
    ctx.stroke()

    // 윗면 하이라이트 — 가는 흰 선을 살짝 위에 얹으면 튜브 느낌이 난다
    if (!edge.dashed) {
      ctx.strokeStyle = C.surface
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 2.5
      ctx.translate(0, -1.4)
      roundedPolyline(ctx, pts)
      ctx.stroke()
    }
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = 0.45
    arrowHead(ctx, end[0], end[1], dx / len, dy / len, 9, C.faint)
    ctx.restore()

    if (edge.badge) {
      // 번호 동그라미(꺼진 상태) — 켜지면 drawDynamic이 같은 자리에 진하게 덧그린다
      drawBadge(ctx, edge, 0)
    }

    if (edge.note) {
      ctx.fillStyle = C.sub
      ctx.font = `500 12.5px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillText(edge.note.text, edge.note.x, edge.note.y)
    }
  }

  // 방 이름 — 선보다 위에. 글자 뒤에 바탕색 판을 깔아 지나가는 파이프에서 떼어 낸다
  // (설계도가 화살표 글에 쓰는 것과 같은 수법).
  for (const L of roomLabels) {
    ctx.save()
    ctx.font = `${L.tone === 'faint' ? 500 : 700} 13px ${FONT}`
    ctx.textAlign = 'left'
    const pad = 5
    const w = ctx.measureText(L.text).width
    ctx.fillStyle = C.surface
    roundRect(ctx, L.x - pad, L.y - 13, w + pad * 2, 19, 4)
    ctx.fill()
    ctx.fillStyle = L.tone === 'faint' ? C.faint : C.ink
    ctx.fillText(L.text, L.x, L.y)
    ctx.restore()
  }

  // 범례 — 소리 길이 둘이라는 것이 이 그림의 핵심이다. 견본도 파이프 스타일로.
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = C.pipe
  ctx.lineWidth = 7
  ctx.beginPath(); ctx.moveTo(44, 424); ctx.lineTo(80, 424); ctx.stroke()
  ctx.strokeStyle = C.sound
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 4.5
  ctx.beginPath(); ctx.moveTo(44, 424); ctx.lineTo(80, 424); ctx.stroke()
  ctx.globalAlpha = 1
  ctx.strokeStyle = C.pipe
  ctx.lineWidth = 7
  ctx.setLineDash([0.5, 13])
  ctx.beginPath(); ctx.moveTo(44, 452); ctx.lineTo(80, 452); ctx.stroke()
  ctx.strokeStyle = C.sound
  ctx.globalAlpha = 0.8
  ctx.beginPath(); ctx.moveTo(44, 452); ctx.lineTo(80, 452); ctx.stroke()
  ctx.restore()
  ctx.fillStyle = C.sub
  ctx.font = `500 13px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('서버가 직접 내는 소리', 90, 428)
  ctx.fillText('브라우저가 재생하는 소리', 90, 456)
}

export function drawBadge(ctx, edge, lit) {
  ctx.save()
  ctx.fillStyle = C.surface
  ctx.beginPath()
  ctx.arc(edge.badge.x, edge.badge.y, edge.badge.r || 10.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = toneColor(edge.tone)
  ctx.globalAlpha = 0.7 + 0.3 * lit
  ctx.lineWidth = 1.6
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = toneColor(edge.tone)
  ctx.font = `700 12.5px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(edge.badge.n, edge.badge.x, edge.badge.y + 0.5)
  ctx.restore()
  ctx.textBaseline = 'alphabetic'
}

export function drawDynamic(ctx, state, hoverId) {
  const t = state.t

  // 켜진 파이프 — 물듦·방울·화살촉·배지 (밝기는 스프링이 정한다)
  for (const edge of EDGES) {
    const lit = clamp(state.edges[edge.id].e, 0, 1)
    if (lit <= 0.02) continue
    const color = toneColor(edge.tone)
    const pts = edge.points
    const end = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    const dx = end[0] - prev[0]
    const dy = end[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.globalAlpha = edge.dashed ? 0.2 + 0.6 * lit : 0.14 + 0.42 * lit
    ctx.lineWidth = edge.dashed ? 7 : 4.5
    if (edge.dashed) ctx.setLineDash([0.5, 13])
    roundedPolyline(ctx, pts)
    ctx.stroke()
    ctx.restore()

    // 관 속을 흐르는 방울 — 간격 26px, edge당 최대 6개, 양 끝에서는 서서히 옅어진다
    if (lit >= 0.15) {
      const total = PIPE_LEN[edge.id] || (PIPE_LEN[edge.id] = pathLength(pts))
      const drops = Math.min(6, Math.floor(total / 26))
      ctx.save()
      ctx.fillStyle = color
      for (let i = 0; i < drops; i++) {
        const d = (t * 46 + i * 26) % total
        const p = pointAtDistance(pts, d)
        const edgeFade = Math.min(1, d / 20, (total - d) / 20)
        ctx.globalAlpha = (0.35 + 0.45 * lit) * edgeFade
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    if (lit > 0.15) {
      arrowHead(ctx, end[0], end[1], dx / len, dy / len, 9, color)
    }
    if (edge.badge) drawBadge(ctx, edge, lit)
  }

  // 소리 동그라미 — 스피커·TV에서 퍼진다
  for (const ring of state.rings) {
    ctx.save()
    ctx.strokeStyle = C.sound
    ctx.globalAlpha = clamp(ring.life, 0, 1) * 0.65 * (0.65 + 0.35 * Math.sin(t * 8 + ring.r * 0.12))
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(ring.x, ring.y, ring.r, -1.15, 1.15)
    ctx.stroke()
    ctx.restore()
  }

  // 담당 네모
  for (const n of NODES) {
    const slot = state.nodes[n.id]
    const e = clamp(slot.e, 0, 1.4)
    const color = toneColor(n.tone)
    const pop = 1 + 0.045 * clamp(e - 0.16, 0, 1.2)
    const hovered = hoverId === n.id && n.start
    // 아무도 안 눌렀을 때 시작점 둘은 천천히 숨을 쉰다 — 여기를 누르라는 뜻
    const breathe = n.start && state.phase !== 'run' ? 0.5 + 0.5 * Math.sin(t * 2.1) : 0

    ctx.save()
    ctx.translate(n.x + n.w / 2, n.y + n.h / 2)
    ctx.scale(pop, pop)
    ctx.translate(-(n.x + n.w / 2), -(n.y + n.h / 2))

    // 면 위주 — 평상시에도 옅은 면을 깔고 테두리는 가늘게 둔다
    ctx.fillStyle = e > 0.3 ? toneSoft(n.tone) : C.surface2
    if (e > 0.35) {
      ctx.shadowColor = color
      ctx.shadowBlur = 26 * clamp(e, 0, 1)
    }
    roundRect(ctx, n.x, n.y, n.w, n.h, 12)
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.strokeStyle = color
    ctx.globalAlpha = 0.3 + 0.7 * clamp(e, 0, 1) + (hovered ? 0.3 : 0) + breathe * 0.25
    ctx.lineWidth = 1 + (hovered ? 0.6 : 0)
    if (n.dashed) ctx.setLineDash([5, 4])
    roundRect(ctx, n.x, n.y, n.w, n.h, 12)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    const left = n.align === 'left'
    ctx.textAlign = left ? 'left' : 'center'
    const tx = left ? n.x + 18 : n.x + n.w / 2
    const single = n.lines.length === 1
    // 낮은 상자(바깥 인터넷 44px)는 줄자리를 당긴다 — 46px 기준선이면 글이 상자 밖으로 나간다
    const compact = n.h < 50
    ctx.fillStyle = C.ink
    ctx.font = `700 ${n.h < 60 ? 13.5 : 14}px ${FONT}`
    ctx.fillText(n.title, tx, n.y + (compact ? 19 : single ? 27 : 30))
    ctx.fillStyle = C.sub
    ctx.font = `400 12.5px ${FONT}`
    n.lines.forEach((line, i) => {
      ctx.fillText(line, tx, n.y + (compact ? 36 : single ? 46 : 50) + i * 17)
    })

    // 얼굴 그림 — clock·speaker·tv는 guideMap의 face 속성, 나머지는 id로 잇는다
    // (guideMap.js는 배치만 알고, 어떤 담당이 어떤 그림인지는 칠하기의 소관)
    if (n.face === 'clock') drawClockFace(ctx, n, e, t)
    else if (n.face === 'speaker') drawSpeakerFace(ctx, n, e, t)
    else if (n.face === 'tv') drawTvFace(ctx, n, e, t)
    else if (n.id === 'office') drawBuildingFace(ctx, n, e)
    else if (n.id === 'phone') drawPhoneFace(ctx, n, e)
    else if (n.id === 'internet') drawCloudFace(ctx, n, e)
    else if (n.id === 'ledger') drawBookFace(ctx, n, e)
    else if (n.id === 'runner') drawStepsFace(ctx, n, e, t)
    else if (n.id === 'sound') drawEqFace(ctx, n, e, t)
    else if (n.id === 'watch') drawEyeFace(ctx, n, e)
    else if (n.id === 'starter') drawRestartFace(ctx, n, e, t)
    else if (n.id === 'tts') drawSpeechFace(ctx, n, e, t)
    else if (n.id === 'update') drawDownloadFace(ctx, n, e, t)
    else if (n.id === 'boot' || n.id === 'shutdown') drawPowerFace(ctx, n, e)

    if (n.start) {
      ctx.fillStyle = C.wire
      ctx.globalAlpha = 0.35 + 0.4 * breathe + (hovered ? 0.25 : 0)
      ctx.font = `600 11.5px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText('눌러 보세요', n.x + n.w / 2, n.y + n.h - 10)
    }
    ctx.restore()
  }

  // 파티클 — 살짝만 (도착의 재미지 주인공이 아니다)
  for (const q of state.particles) {
    ctx.save()
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1) * 0.6
    ctx.fillStyle = toneColor(q.tone)
    ctx.beginPath()
    ctx.arc(q.x, q.y, q.size * 0.85, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // 짐 — 꼬리를 남기며 선을 따라 흐른다. 놀이 짐(조형물)은 제 종류색 동전으로 다닌다
  for (const p of state.packets) {
    const color = kindColor(p.kind) || toneColor(p.tone)
    ctx.save()
    ctx.lineCap = 'round'
    for (let i = p.trail.length - 1; i > 0; i--) {
      ctx.globalAlpha = (1 - i / p.trail.length) * 0.5
      ctx.strokeStyle = color
      ctx.lineWidth = 4.5 * (1 - i / p.trail.length) + 0.6
      ctx.beginPath()
      ctx.moveTo(p.trail[i].x, p.trail[i].y)
      ctx.lineTo(p.trail[i - 1].x, p.trail[i - 1].y)
      ctx.stroke()
    }
    const head = pointAtDistance(edgeById(p.edge).points, p.d)
    // 스쿼시&스트레치(12원칙) — 스프링 속도만큼 진행 방향으로 늘고 옆으로 눌린다(부피 보존).
    // 급가속·오버슈트 순간에만 눈에 띄게 살짝, 멈추면 정원으로 돌아온다.
    const stretch = clamp(1 + Math.abs(p.v) / 900, 1, 1.45)
    ctx.globalAlpha = 1
    ctx.shadowColor = color
    ctx.shadowBlur = 10
    ctx.fillStyle = color
    ctx.translate(head.x, head.y)
    ctx.rotate(Math.atan2(head.dy, head.dx))
    ctx.scale(stretch, 1 / stretch)
    if (p.kind) {
      drawTokenHead(ctx, p.kind, color)
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, 4.4 + 0.5 * Math.sin(t * 12), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

// 조형물 머리 — 흰 동전 + 종류색 테두리 + 손그림 글리프(원점 기준, 짐의 변형을 그대로 받는다)
export function drawTokenHead(ctx, kind, color) {
  ctx.shadowBlur = 8
  ctx.fillStyle = C.surface
  ctx.beginPath()
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'chime') {
    // 종
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(-3.6, 2.2)
    ctx.quadraticCurveTo(-3.6, -3.8, 0, -3.8)
    ctx.quadraticCurveTo(3.6, -3.8, 3.6, 2.2)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 4, 1.1, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'bgm') {
    // 8분음표
    ctx.beginPath()
    ctx.arc(-1.6, 2.6, 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(0.4, 2.6)
    ctx.lineTo(0.4, -3.4)
    ctx.quadraticCurveTo(3.4, -2.6, 3.4, -0.2)
    ctx.stroke()
  } else {
    // 말풍선(안내 음성)
    ctx.lineWidth = 1.4
    roundRect(ctx, -4, -3.6, 8, 5.6, 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-1.4, 2)
    ctx.lineTo(-0.6, 3.8)
    ctx.lineTo(0.8, 2)
    ctx.closePath()
    ctx.fill()
  }
}

export function draw(ctx, state, hoverId) {
  ctx.clearRect(0, 0, VIEW.w, VIEW.h)
  drawStatic(ctx)
  drawDynamic(ctx, state, hoverId)
}
