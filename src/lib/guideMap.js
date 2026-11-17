// 안내도 인앱 모션 — 장면·물리·타임라인 (그리는 코드는 여기 없다)
//
// 사용자가 방식을 못박았다(2026-09-01): **DOM 애니메이션이 아니라 canvas 2D + rAF**,
// 삼각함수·벡터 물리(위치·속도·마찰)·스프링(F = -kx)·lerp·파티클.
// 그래서 이 파일은 **숫자만** 다룬다 — canvas도 DOM도 React도 모른다.
// 그리기는 components/shared/GuideMapCanvas.jsx가, 글은 pages/GuideMapPage.jsx가 맡는다.
//
// 왜 나눴나: 움직임이 맞는지(순서·도착·감쇠)는 화면 없이 검사할 수 있어야 한다.
// server/test/guide-map.test.js가 이 모듈을 그대로 불러 순서와 수렴을 고정한다.
//
// 바탕은 비개발자용 정적 안내도 목업이었다(공개판에는 들어 있지 않다).

// 그림 좌표계. 캔버스 크기와 무관한 고정 좌표 — 그리는 쪽이 통째로 배율만 바꾼다.
// 2026-09-04: 세로만 566 → 636으로 늘렸다. 가로는 그대로다 — 배율은 폭으로만 정해지므로
// (fit()의 scale = 칸 너비 / VIEW.w) 세로를 늘려도 글씨가 작아지지 않는다. 늘린 자리에
// 「업데이트」와 「자동 재시작」을 세로로 세웠다.
export const VIEW = { w: 1120, h: 636 }

// ── 방(테두리만 있는 상자) ────────────────────────────────────────────────
export const ROOMS = [
  { id: 'building', x: 20, y: 78, w: 1080, h: 540, label: '요양원 안', tone: 'faint', dashed: true },
  { id: 'studio', x: 300, y: 134, w: 484, h: 254, label: '방송실 — 사무실 컴퓨터 한 대', tone: 'wire' },
  { id: 'hall', x: 830, y: 140, w: 250, h: 268, label: '홀 — 어르신이 계신 곳', tone: 'sound' },
]

// ── 네모 하나 = 방 하나 또는 담당 하나 ────────────────────────────────────
export const NODES = [
  { id: 'internet', x: 430, y: 8, w: 260, h: 44, tone: 'quiet', title: '외부 API',
    lines: ['날씨 · 미세먼지 · AI'] },
  { id: 'office', x: 40, y: 150, w: 200, h: 92, tone: 'wire', title: '사무실 PC', start: true,
    lines: ['선생님이 예약을 넣는다', '시각 · 문구 · 음악을 정한다'] },
  { id: 'phone', x: 40, y: 286, w: 200, h: 92, tone: 'wire', title: '휴대폰 · 태블릿', start: true,
    lines: ['선생님이 지금 바로 내보낸다', '차임벨 · 마이크 안내'] },
  { id: 'clock', x: 320, y: 176, w: 132, h: 86, tone: 'wire', title: '타이머', face: 'clock',
    lines: ['매분 DB를 본다', '방송을 시작한다'] },
  { id: 'runner', x: 476, y: 176, w: 132, h: 86, tone: 'wire', title: '방송 진행',
    lines: ['차임 → 안내 → 음악', '순서대로 내보낸다'] },
  { id: 'sound', x: 632, y: 176, w: 132, h: 86, tone: 'wire', title: '오디오 큐',
    lines: ['소리를 줄 세운다', '한 번에 하나씩'] },
  // 방송실 아래층 둘(2026-09-04). **DB는 타이머 바로 밑에 둔다** — 예약이 DB에 앉고
  // 타이머가 그것을 읽으므로, 위아래로 붙여 놓아야 선이 짧고 곧다.
  // 음성 합성은 방송 진행 밑이다(방송 진행이 문장을 넘긴다). 소리를 **만드는** 곳이
  // 그림에 없어서 "정각인데 몇 초 늦는다"의 이유(합성 대기)를 짚을 데가 없었다.
  { id: 'ledger', x: 320, y: 300, w: 200, h: 74, tone: 'wire', title: '데이터베이스(DB)', dashed: true,
    lines: ['예약 · 음원 · 설정 · 기록', '서버 켤 때 백업한다'] },
  { id: 'tts', x: 560, y: 300, w: 204, h: 74, tone: 'wire', title: '음성 합성(TTS)',
    lines: ['문장을 소리로 바꾼다'] },
  { id: 'speaker', x: 850, y: 180, w: 210, h: 88, tone: 'sound', title: '천장 스피커', face: 'speaker',
    lines: ['안내 음성 · 차임벨', '음악 · 음원'] },
  { id: 'tv', x: 850, y: 296, w: 210, h: 88, tone: 'sound', title: 'TV', face: 'tv',
    lines: ['체조 영상 · 배경 영상', '브라우저가 띄운다'] },
  // 하루 주기를 왼→오른쪽으로 편다(2026-09-05). 한 덩어리였을 때는 아침에 저절로 켜진다는
  // 사실이 아예 없었고, 백업 시각(04:30)은 **그 시각에 PC가 꺼져 있어 실제로는 안 도는 경로**를
  // 사실처럼 적고 있었다(진짜 백업은 서버 기동 5초 뒤 — backup.js:144).
  // 시각 숫자는 셋 다 설정값이라(auto_shutdown_time · backup_time · watchdog_grace_min)
  // 기관마다 달라진다 — 그림에는 「정한 시각에」로만 적는다.
  { id: 'boot', x: 320, y: 452, w: 120, h: 74, tone: 'wire', dashed: true,
    title: '전원 켜기',
    lines: ['BIOS가 켠다', '정한 시각에'] },
  { id: 'watch', x: 470, y: 452, w: 150, h: 74, tone: 'wire',
    title: '감시',
    lines: ['안 나간 방송을 찾아', '경보를 띄운다'] },
  { id: 'shutdown', x: 650, y: 452, w: 114, h: 74, tone: 'wire', dashed: true,
    title: '자동 종료',
    lines: ['정한 시각에', 'PC를 끈다'] },
  // 홀 아래 오른쪽 기둥 — **프로그램 자체를 살아 있게 하는 둘**(2026-09-04 추가).
  // 위가 새 코드를 받아 두고, 아래가 멎은 서버를 다시 띄운다.
  // 방(방송실) 밖에 두는 것이 사실에 맞다 — 서버가 멎어도 이 둘은 살아 있어야 하므로
  // 서버 바깥에서 돈다. 감시(방송이 안 나갔나)와도 층이 다르다: 이쪽이 죽으면
  // 감시도 같이 죽는다. 그림에 없으면 "왜 아무 경보도 없이 조용했나"를 설명할 수가
  // 없다 — 2026-09-04 현장에서 자동 재시작 루프가 3시간 56분 동안 실패하고 있었다.
  { id: 'update', x: 830, y: 424, w: 250, h: 76, tone: 'wire', dashed: true,
    title: '업데이트',
    lines: ['10분마다 새 코드를 확인한다', '새 코드가 있으면 내려받는다'] },
  { id: 'starter', x: 830, y: 530, w: 250, h: 76, tone: 'wire', dashed: true,
    title: '자동 재시작',
    lines: ['5초마다 서버가 응답하는지 확인한다', '멎어 있으면 서버를 다시 띄운다'] },
]

// ── 선(꺾은 선). points가 곧 짐이 지나가는 길이다 ─────────────────────────
export const EDGES = [
  // 사람이 넣은 예약은 **타이머가 아니라 DB로** 간다(2026-09-04 바로잡음).
  // 실제로 insertSchedule()이 schedules 표에 적고, scheduler가 매분 그 표를 읽는다.
  // 예전 그림은 DB를 건너뛰어서, DB가 왜 있는지를 설명하지 못했다.
  { id: 'office-ledger', from: 'office', to: 'ledger', tone: 'wire',
    points: [[240, 196], [278, 196], [278, 332], [320, 332]], badge: { n: '1', x: 278, y: 264 } },
  { id: 'phone-ledger', from: 'phone', to: 'ledger', tone: 'wire',
    points: [[240, 332], [320, 332]] },
  { id: 'ledger-clock', from: 'ledger', to: 'clock', tone: 'wire',
    points: [[386, 300], [386, 262]], badge: { n: '2', x: 386, y: 281 } },
  { id: 'net-runner', from: 'internet', to: 'runner', tone: 'quiet', dashed: true,
    points: [[560, 52], [560, 112], [542, 112], [542, 176]], note: { text: '값을 받아온다', x: 572, y: 92 } },
  { id: 'clock-runner', from: 'clock', to: 'runner', tone: 'wire',
    points: [[452, 219], [476, 219]] },
  { id: 'runner-sound', from: 'runner', to: 'sound', tone: 'wire',
    points: [[608, 219], [632, 219]], badge: { n: '3', x: 620, y: 219, r: 9 } },
  { id: 'runner-ledger', from: 'runner', to: 'ledger', tone: 'quiet', dashed: true,
    points: [[500, 262], [500, 276], [440, 276], [440, 300]],
    note: { text: '기록을 남긴다', x: 446, y: 294 } },
  { id: 'sound-speaker', from: 'sound', to: 'speaker', tone: 'sound',
    points: [[764, 205], [810, 205], [810, 224], [850, 224]], badge: { n: '4', x: 806, y: 174 } },
  // ⑤는 **방송 진행에서 나간다.** 오디오 큐(서버 스피커)는 TV를 모른다 — audioQueue.js에
  // 'tv'라는 낱말이 한 번도 안 나온다. 재생 지시를 보내는 것은 방송 진행이고, 그 지시를 받아
  // 실제로 TV를 띄우는 것은 브라우저다(점선 = 브라우저가 재생하는 소리, 범례 참고).
  { id: 'runner-tv', from: 'runner', to: 'tv', tone: 'sound', dashed: true,
    points: [[590, 262], [590, 292], [800, 292], [800, 340], [850, 340]],
    badge: { n: '5', x: 800, y: 316 } },
  { id: 'watch-ledger', from: 'watch', to: 'ledger', tone: 'quiet', dashed: true,
    points: [[500, 452], [500, 374]], note: { text: '나간 기록을 확인한다', x: 512, y: 414 } },
  // 방송실 오른쪽 바깥(x=790)으로 올라가 위를 돌아 타이머로 들어간다 — 방송실(300~784)과
  // 홀(830~1080) 사이, 그리고 방들 위(y=120)가 이 그림에서 유일하게 비어 있는 길이다.
  //
  // **이 선을 지우지 말 것.** 2026-09-04에 "방 이름을 가린다"는 지적을 받고 한 번 지웠는데
  // 그건 틀린 처방이었다 — 가림은 **글자를 선보다 나중에 그려서** 푸는 것이고
  // (guideMapDraw.js drawStatic의 roomLabels), 선 자체는 이 시스템이 무인으로 도는
  // 근거라 그림에 있어야 한다.
  { id: 'starter-clock', from: 'starter', to: 'clock', tone: 'quiet', dashed: true,
    points: [[830, 568], [790, 568], [790, 120], [386, 120], [386, 176]],
    note: { text: '서버를 다시 띄운다', x: 500, y: 112 } },
  // 받아 둔 새 코드는 **다음에 띄울 때** 적용된다 — 그래서 화살표가 자동 재시작으로 간다.
  { id: 'update-starter', from: 'update', to: 'starter', tone: 'quiet', dashed: true,
    points: [[955, 500], [955, 530]], note: { text: '새 코드로 바꾼다', x: 970, y: 519 } },
  // 하루 주기 — 시간이 흐르는 화살표다(무엇이 오가는 게 아니라 언제인지). 그래서 점선.
  { id: 'boot-watch', from: 'boot', to: 'watch', tone: 'quiet', dashed: true,
    points: [[440, 489], [470, 489]], note: { text: '아침', x: 442, y: 445 } },
  { id: 'watch-shutdown', from: 'watch', to: 'shutdown', tone: 'quiet', dashed: true,
    points: [[620, 489], [650, 489]], note: { text: '저녁', x: 622, y: 445 } },
  // 하루의 끝 — 자동 종료가 서버를 끈다. 상자 아래 띠(y=570)로 왼쪽까지 가서
  // 방송실 바깥 벽(x=296)을 타고 올라간다. 예약선(x=278)과 11px 떨어져 안 붙는다.
  { id: 'shutdown-clock', from: 'shutdown', to: 'clock', tone: 'quiet', dashed: true,
    points: [[707, 526], [707, 570], [296, 570], [296, 205], [320, 205]],
    note: { text: '서버를 끈다', x: 500, y: 588 } },
  // 방송실 두 층 사이(262~300)의 빈 띠로 지나간다 — 타이머와 방송 진행 사이가 비어 있다.
  { id: 'runner-tts', from: 'runner', to: 'tts', tone: 'wire',
    points: [[560, 262], [560, 300]], note: { text: '문장을 넘긴다', x: 570, y: 280 } },
]

// ── 한 번의 방송이 지나가는 순서 ──────────────────────────────────────────
// step은 화면 아래 글 목록의 번호와 같다(1~5). 마지막 박자는 번호가 없다 — 방송이 끝난 뒤의 일이다.
export const BEATS = [
  {
    id: 'ask', step: 1, title: '선생님이 예약을 넣습니다',
    light: ['boot'],   // 하루가 여기서 시작한다 — 누르면 전원 켜기부터 올라온다
    caption: '선생님이 사무실 화면에서 아침 방송 07:50을 한 번 넣어 둡니다. 그 예약은 DB에 저장돼 그대로 남습니다 — 사람이 다시 손댈 일이 없습니다.',
    packets: [{ edge: '@source', delay: 0 }],   // @source = 사무실이냐 폰이냐(누른 쪽)
  },
  {
    id: 'tick', step: 2, title: '타이머가 매분 DB를 확인합니다',
    caption: '타이머가 1분마다 DB를 읽어 지금이 그 예약의 시각인지 봅니다. 아무도 누르지 않아도 여기서 시작됩니다.',
    packets: [{ edge: 'ledger-clock', delay: 260 }],
  },
  {
    id: 'plan', step: 3, title: '방송 진행이 순서를 만듭니다',
    caption: '방송 진행이 차임벨 → 안내 음성 → 음원 → 배경음악 순서를 짭니다. 날씨가 들어가는 방송이면 외부 API에서 값을 받아 문장을 만들고, 음성 합성이 그 문장을 미리 소리로 바꿔 둡니다.',
    light: ['internet'],   // 짐을 보내는 쪽은 도착으로 안 켜진다 — 여기서 따로 켠다
    packets: [
      { edge: 'clock-runner', delay: 0 },
      { edge: 'net-runner', delay: 200 },
      { edge: 'runner-ledger', delay: 420 },
      { edge: 'runner-tts', delay: 560 },
      { edge: 'runner-sound', delay: 720 },
    ],
  },
  {
    id: 'speak', step: 4, title: '서버가 직접 소리를 냅니다',
    caption: '안내 음성과 차임벨은 서버가 직접 만들어 홀 스피커로 내보냅니다. 브라우저를 거치지 않습니다.',
    packets: [{ edge: 'sound-speaker', delay: 0 }],
  },
  {
    id: 'play', step: 5, title: '브라우저가 나머지를 재생합니다',
    caption: '음원·배경음악·영상은 현장 컴퓨터의 브라우저 화면이 재생합니다. 홀 TV 에 띄우는 체조·배경 영상도 이쪽입니다.',
    packets: [{ edge: 'runner-tv', delay: 0 }],
  },
  {
    id: 'check', step: null, title: '감시가 기록을 확인합니다',
    caption: '하루가 이렇게 돕니다 — 아침에 메인보드 BIOS가 PC를 켜고(이건 우리 프로그램이 아닙니다), 낮에는 감시가 안 나간 방송을 찾아 경보를 띄우고, 저녁에는 자동 종료가 PC를 끕니다. DB는 서버가 켜질 때 백업합니다. 업데이트는 10분마다 새 코드를 확인하고, 서버가 멎으면 자동 재시작이 다시 띄웁니다.',
    light: ['watch', 'boot', 'shutdown', 'update', 'starter'],
    packets: [
      { edge: 'watch-ledger', delay: 0 },
      { edge: 'update-starter', delay: 250 },
      { edge: 'starter-clock', delay: 500 },
      // 하루를 닫는다 — 아침에서 저녁으로 흘러 서버가 꺼지는 것으로 끝난다
      { edge: 'boot-watch', delay: 900 },
      { edge: 'watch-shutdown', delay: 1250 },
      { edge: 'shutdown-clock', delay: 1600 },
    ],
  },
]

// ── 박자가 머무는 시간은 **자막 길이가 정한다** (2026-09-05 사용자 지시) ──────────────
//
// "모션 좀 천천히 해라, 밑에 글씨 못 읽겠다" → 전부 똑같이 늦추면 짧은 박자가 지루해진다.
// 그래서 글이 긴 박자만 오래 머문다. 28ms/글자 ≈ 초당 36자로, 한글 자막을 훑어 읽는 속도다.
// 짐이 아직 날아가는 중이면 박자는 어차피 안 넘어가므로(update의 settled 조건) 이 값은 **하한**이다.
const READ_BASE_MS = 650
const READ_PER_CHAR_MS = 35
export const readMs = (text) => READ_BASE_MS + Math.round(String(text).length * READ_PER_CHAR_MS)
for (const beat of BEATS) beat.minMs = readMs(beat.caption)

export const IDLE_CAPTION = '사무실 PC나 휴대폰을 누르면, 방송 한 건이 홀까지 가는 길이 그대로 움직입니다.'
export const DONE_CAPTION = '한 바퀴가 끝났습니다. 실제로는 이 전부가 몇 초 안에 지나갑니다.'

// ── 순수 계산 ─────────────────────────────────────────────────────────────

export const lerp = (a, b, t) => a + (b - a) * t
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// 스프링(훅의 법칙) 한 걸음. F = -k(x - 목표) - c·v
// 임계감쇠(c = 2√k)보다 c를 낮게 잡으면 목표를 살짝 지나쳤다 돌아온다 — 켜질 때의 통 하는 맛.
export function springStep(x, v, target, dt, k = 190, c = 17) {
  const a = -k * (x - target) - c * v
  const nv = v + a * dt
  return { x: x + nv * dt, v: nv }
}

// 씨앗을 주면 항상 같은 난수 — 테스트가 파티클까지 재현할 수 있다.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pathLength(points) {
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return sum
}

// 길 위에서 d만큼 간 지점과 그때의 진행 방향(단위 벡터).
export function pointAtDistance(points, d) {
  const total = pathLength(points)
  const want = clamp(d, 0, total)
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    const seg = Math.hypot(x1 - x0, y1 - y0)
    if (seg === 0) continue
    if (acc + seg >= want || i === points.length - 1) {
      const t = clamp((want - acc) / seg, 0, 1)
      return { x: lerp(x0, x1, t), y: lerp(y0, y1, t), dx: (x1 - x0) / seg, dy: (y1 - y0) / seg }
    }
    acc += seg
  }
  const last = points[points.length - 1]
  return { x: last[0], y: last[1], dx: 1, dy: 0 }
}

export const nodeById = (id) => NODES.find(n => n.id === id) || null
export const edgeById = (id) => EDGES.find(e => e.id === id) || null
export const nodeCenter = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })

// ── 상태 ──────────────────────────────────────────────────────────────────

const AFTERGLOW = 0.16    // 지나간 담당은 완전히 꺼지지 않고 옅게 남는다 — 지나온 길이 보인다
const LEAD_SPEED = 360    // 짐을 끌고 가는 앞장의 속도(좌표/초). 470이었는데 눈이 못 따라간다고 낮췄다(2026-09-03)
const ARRIVE_EPS = 2.5

// ── 놀이 짐(조형물) — 사람이 떨어뜨린 차임벨·안내 음성·BGM이 길을 끝까지 여행한다 ──
// 한 구간이 끝나면 다음 구간에서 새로 태어나는 식으로 잇는다. 박자(BEATS) 진행과는
// 무관하게 움직이고, 마지막 도착은 tokenArrivals에 쌓인다 — 그리는 쪽이 소리를 낸다.
export const TOKEN_ROUTES = {
  // **EDGES를 고치면 여기도 고쳐야 한다.** 없는 선을 적으면 launchToken이 조용히
  // 빠져나가 단추가 아무 일도 안 한다(2026-09-05에 실제로 그랬다). guide-map.test.js가
  // 이제 이 표의 선이 실재하는지와 앞뒤가 이어지는지를 고정한다.
  chime: ['office-ledger', 'ledger-clock', 'clock-runner', 'runner-sound', 'sound-speaker'],
  tts: ['office-ledger', 'ledger-clock', 'clock-runner', 'runner-sound', 'sound-speaker'],
  bgm: ['phone-ledger', 'ledger-clock', 'clock-runner', 'runner-tv'],
}

export function launchToken(state, kind) {
  const route = TOKEN_ROUTES[kind]
  if (!route) return state
  const first = edgeById(route[0])
  if (first) {
    kick(state.nodes[first.from], 0.8, 5)
    spawnPacket(state, route[0], { token: true, kind, route, leg: 0 })
  }
  return state
}

function blank(list) {
  const out = {}
  for (const item of list) out[item.id] = { e: 0, v: 0, target: 0, visited: false }
  return out
}

export function createState(seed = 20260901) {
  return {
    t: 0,
    phase: 'idle',          // idle | run | done
    source: 'office',       // 이번 판을 시작한 곳
    beatIndex: -1,
    beatT: 0,
    step: 0,                // 화면 글 목록에서 밝힐 번호 (0 = 없음)
    caption: IDLE_CAPTION,
    loop: false,
    doneAt: 0,
    nodes: blank(NODES),
    edges: blank(EDGES),
    pending: [],            // 아직 안 띄운 짐 { edge, at }
    packets: [],
    particles: [],
    rings: [],
    tokenArrivals: [],      // 놀이 짐이 끝까지 도착한 기록 — 그리는 쪽이 꺼내 소리를 낸다
    rng: mulberry32(seed),
  }
}

function kick(slot, target, impulse) {
  slot.target = target
  slot.v += impulse
}

function burst(state, x, y, tone, n) {
  for (let i = 0; i < n; i++) {
    const ang = state.rng() * Math.PI * 2
    const spd = 40 + state.rng() * 130
    state.particles.push({
      x, y, tone,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 0.45 + state.rng() * 0.45,
      max: 0.9,
      size: 1.2 + state.rng() * 2.2,
    })
  }
}

function spawnPacket(state, edgeId, extra) {
  const edge = edgeById(edgeId)
  if (!edge) return
  state.packets.push(Object.assign({
    edge: edgeId, d: 0, v: 0, lead: 0, x: edge.points[0][0], y: edge.points[0][1],
    len: pathLength(edge.points), tone: edge.tone, trail: [],
  }, extra || null))
  kick(state.edges[edgeId], 1, 6)
}

function enterBeat(state, index) {
  state.beatIndex = index
  state.beatT = 0
  const beat = BEATS[index]
  if (!beat) return
  state.step = beat.step || 0
  state.caption = beat.caption
  for (const id of beat.light || []) {
    kick(state.nodes[id], 1, 6)
    state.nodes[id].visited = true
  }
  state.pending = beat.packets.map(p => ({
    edge: p.edge === '@source' ? (state.source === 'phone' ? 'phone-ledger' : 'office-ledger') : p.edge,
    at: p.delay / 1000,
  }))
}

// 새 판 시작. sourceId는 office 또는 phone — 누른 네모에서 짐이 출발한다.
export function startRun(state, sourceId = 'office') {
  state.source = sourceId === 'phone' ? 'phone' : 'office'
  state.phase = 'run'
  state.packets = state.packets.filter(p => p.token)   // 놀이 짐은 새 판이 시작돼도 계속 여행한다
  state.rings = []
  state.pending = []
  for (const id of Object.keys(state.nodes)) {
    state.nodes[id].target = 0
    state.nodes[id].visited = false
  }
  for (const id of Object.keys(state.edges)) state.edges[id].target = 0
  kick(state.nodes[state.source], 1, 5)
  state.nodes[state.source].visited = true
  const c = nodeCenter(nodeById(state.source))
  burst(state, c.x + 90, c.y, 'wire', 10)
  enterBeat(state, 0)
  return state
}

function arrive(state, packet) {
  const edge = edgeById(packet.edge)
  const end = pointAtDistance(edge.points, packet.len)
  const target = state.nodes[edge.to]
  if (target) {
    kick(target, 1, 7)
    target.visited = true
  }
  burst(state, end.x, end.y, edge.tone, 16)
  // 스피커·TV에 닿으면 소리가 퍼지는 동그라미가 생긴다
  if (edge.to === 'speaker' || edge.to === 'tv') {
    state.rings.push({ x: end.x, y: end.y, r: 6, life: 1, tone: 'sound', from: edge.to })
  }
}

// 한 걸음. dtMs는 rAF가 준 밀리초 — 탭을 잠시 두고 오면 큰 값이 오므로 잘라 쓴다.
export function update(state, dtMs) {
  const dt = clamp(dtMs, 0, 50) / 1000
  state.t += dt
  if (dt === 0) return state

  // 아직 안 띄운 짐
  if (state.phase === 'run') {
    state.beatT += dt
    state.pending = state.pending.filter(p => {
      if (state.beatT >= p.at) { spawnPacket(state, p.edge); return false }
      return true
    })
  }

  // 짐 — 앞장은 일정 속도로 가고, 짐은 스프링으로 그 뒤를 따라간다(끌려왔다 살짝 넘친다)
  const stillMoving = []
  for (const p of state.packets) {
    p.lead = Math.min(p.len, p.lead + LEAD_SPEED * dt)
    const s = springStep(p.d, p.v, p.lead, dt, 150, 21)
    p.d = clamp(s.x, 0, p.len)
    p.v = s.v
    const pt = pointAtDistance(edgeById(p.edge).points, p.d)
    p.x = pt.x
    p.y = pt.y
    p.trail.unshift({ x: pt.x, y: pt.y })
    if (p.trail.length > 14) p.trail.pop()
    if (p.lead >= p.len && p.len - p.d < ARRIVE_EPS) {
      arrive(state, p)
      // 놀이 짐은 다음 구간으로 갈아탄다 — 마지막 구간이면 도착 기록을 남긴다(소리는 그리는 쪽 몫)
      if (p.token && p.route) {
        if (p.leg + 1 < p.route.length) {
          spawnPacket(state, p.route[p.leg + 1], { token: true, kind: p.kind, route: p.route, leg: p.leg + 1 })
        } else if (state.tokenArrivals.length < 8) {
          state.tokenArrivals.push(p.kind)
        }
      }
      continue
    }
    stillMoving.push(p)
  }
  state.packets = stillMoving

  // 담당·선의 밝기 — 전부 스프링. 지나간 곳은 완전히 안 꺼지고 옅게 남는다
  for (const id of Object.keys(state.nodes)) {
    const slot = state.nodes[id]
    const s = springStep(slot.e, slot.v, slot.target, dt)
    slot.e = s.x
    slot.v = s.v
  }
  for (const id of Object.keys(state.edges)) {
    const slot = state.edges[id]
    const s = springStep(slot.e, slot.v, slot.target, dt, 120, 20)
    slot.e = s.x
    slot.v = s.v
  }

  // 파티클 — 속도에 마찰, 수명이 다하면 사라진다
  const friction = Math.exp(-2.6 * dt)
  state.particles = state.particles.filter(q => {
    q.x += q.vx * dt
    q.y += q.vy * dt
    q.vx *= friction
    q.vy *= friction
    q.life -= dt
    return q.life > 0
  })

  // 소리 동그라미 — 퍼지면서 옅어진다
  state.rings = state.rings.filter(r => {
    r.r += 62 * dt
    r.life -= dt * 0.75
    return r.life > 0
  })
  // 소리가 나는 동안은 계속 새 동그라미가 생긴다
  for (const id of ['speaker', 'tv']) {
    if (state.nodes[id].e <= 0.55) continue
    const mine = state.rings.filter(r => r.from === id)
    if (mine.length >= 4) continue
    const biggest = mine.reduce((m, r) => (r.r > m ? r.r : m), 0)
    if (mine.length === 0 || biggest > 26) {
      const n = nodeById(id)
      state.rings.push({ x: n.x + 26, y: n.y + n.h / 2, r: 6, life: 1, tone: 'sound', from: id })
    }
  }

  // 박자 넘기기 — 이 박자의 짐이 다 도착했고 최소 시간이 지났으면 다음으로
  if (state.phase === 'run') {
    const beat = BEATS[state.beatIndex]
    // 놀이 짐은 박자와 무관하다 — 사람이 떨어뜨린 조형물이 돌아다닌다고 이야기가 멈추면 안 된다
    const settled = state.packets.every(p => p.token) && state.pending.length === 0
    if (beat && settled && state.beatT * 1000 >= beat.minMs) {
      // 이번 박자에서 켠 담당은 옅게 낮춘다 — 다음 담당이 더 밝아 보인다
      for (const id of Object.keys(state.nodes)) {
        if (state.nodes[id].visited) state.nodes[id].target = AFTERGLOW
      }
      for (const id of Object.keys(state.edges)) {
        if (state.edges[id].target > 0) state.edges[id].target = AFTERGLOW
      }
      if (state.beatIndex + 1 < BEATS.length) {
        enterBeat(state, state.beatIndex + 1)
      } else {
        state.phase = 'done'
        state.doneAt = state.t
        state.step = 0
        state.caption = DONE_CAPTION
      }
    }
  }

  // 되풀이 — 끝나고 잠깐 쉬었다가 반대쪽(사무실 ↔ 폰)에서 다시 시작
  if (state.phase === 'done' && state.loop && state.t - state.doneAt > 2.4) {
    startRun(state, state.source === 'office' ? 'phone' : 'office')
  }

  return state
}

// 움직임을 못 쓰는 사람(prefers-reduced-motion)에게는 결과만 보여 준다 —
// 같은 계산을 잘게 여러 번 돌려서 끝난 그림을 한 장 만든다.
export function fastForward(state, ms, stepMs = 16) {
  for (let done = 0; done < ms; done += stepMs) update(state, stepMs)
  return state
}

// 지금 그림 안에서 눌린 곳이 어디인지 — 캔버스가 좌표를 그림 좌표계로 바꿔서 물어본다.
export function hitTest(vx, vy) {
  for (const n of NODES) {
    if (vx >= n.x && vx <= n.x + n.w && vy >= n.y && vy <= n.y + n.h) return n
  }
  return null
}
