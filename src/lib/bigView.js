// **크게 보기 — 화면 전체를 통째로 키운다** (사용자 지시 2026-09-15).
//
// *"전반적으로 나이대가 높다보니까, 노안이 많아. 그래서 노인들을 위한 큰화면보기도
//   하나 만들어주면 좋겠네(전반적으로 다 글씨체 커지는거, 확대경처럼)."*
//
// ── 왜 글씨만 키우지 않나 ──────────────────────────────────────────────────
// 글씨만 키우면 **칸은 그대로**라 글자가 넘치고 줄이 어긋난다. 이 저장소가 이미
// 여러 번 겪은 모양이다(*"오늘 일과방송에서 저 내용이 자꾸 두줄되고 꼴보기 싫어지는데"*).
// 그리고 노안에 필요한 것은 글씨만이 아니다 — **단추도, 간격도** 같이 커져야 누르기 쉽다.
//
// 그래서 `zoom` 으로 **화면 전체를 그대로 확대**한다. 돋보기를 대는 것과 같아서,
// 배치가 하나도 안 깨지고 44px 터치 크기도 같은 비율로 커진다.
//
// **`transform: scale` 이 아니다.** 그것은 자리만 늘리고 **줄바꿈을 다시 하지 않아서**
// 가로 스크롤이 생긴다. `zoom` 은 레이아웃을 다시 계산한다.
//
// ── 단계는 셋이다 ──────────────────────────────────────────────────────────
// 끄고 켜는 두 값이면 「조금만 키우고 싶다」를 못 한다. 그렇다고 슬라이더를 두면
// 어르신 앞에서 만지다가 이상한 값에 걸린다. **세 칸이면 한 손가락으로 돈다.**
'use strict'

// 저장 자리. **이 PC 의 이 브라우저에만** 남는다 — 사람마다 눈이 다르고, 현장 PC 와
// 직원 폰이 같은 배율을 쓸 이유가 없다. 서버에 올리지 않는다.
export const 저장키 = 'carecast:bigView'

// 1 은 원래 크기다. **1.5 를 넘기지 않는다** — 그 위로는 한 화면에 들어오는 것이
// 너무 줄어 「오늘 일과 여섯 줄」이 한눈에 안 들어온다.
export const 배율들 = [1, 1.25, 1.5]

export const 이름들 = { 1: '보통', 1.25: '크게', 1.5: '아주 크게' }

/** 지금 배율에서 한 칸 다음. 끝에서는 처음으로 돈다(한 단추로 순환). */
export function 다음배율(지금) {
  const i = 배율들.indexOf(정리(지금))
  return 배율들[(i + 1) % 배율들.length]
}

/** 아무 값이나 받아 **쓸 수 있는 배율**로 만든다. 모르는 값은 원래 크기다. */
export function 정리(v) {
  const n = Number(v)
  return 배율들.includes(n) ? n : 1
}

export function 이름(배율) {
  return 이름들[정리(배율)] || '보통'
}

/**
 * 화면에 실제로 먹인다.
 *
 * **1 일 때는 속성을 지운다.** `zoom: 1` 을 남겨 두면 그것만으로 새 쌓임 맥락이
 * 생겨서, 평소에도 `position: fixed` 층이 미묘하게 달라진다. 안 쓸 때는 흔적을 안 남긴다.
 */
// ── **초기 설정 중에는 보통 크기로 고정한다** (사용자 지시 2026-09-17 「처음시작은 보통화면이 낫지 않아?」) ──
// 다시 설치한 PC 는 브라우저에 남은 「아주 크게」를 그대로 물려받아, 초기 설정 판이 1.5배로 떠서 칸이 잘리고
// 끌어 내려야 했다. 초기 설정 판은 그 자체로 글씨가 크다. 고정 중에는 누가 배율을 먹여도 1 로 먹이고,
// 저장된 값은 건드리지 않는다 — 끝나면 사람이 고른 배율로 돌아간다.
let 보통고정 = false
// 배율이 바뀌면 알린다 — 배치를 가르는 쪽(`hooks/useViewWidth`)이 실제 폭을 다시 잰다.
export const 배율이벤트 = 'cc-bigview-change'
export function 보통으로고정(켬) { 보통고정 = !!켬 }
// ── **휴대폰 폭에서는 크게 보기를 안 먹인다** (사용자 신고 2026-09-17 「모바일에서 확대하면 저따구로 나오는데」) ──
// 390 폭을 1.25·1.5배로 키우면 칸들이 312·260 폭에 갇혀 글자가 겹치고 단추가 잘렸다. 휴대폰은 손가락으로 벌려
// 키우는 확대가 이미 있어 이 단추가 필요 없다 — 단추도 숨긴다(BigViewButton). 저장값은 안 지운다(PC 의 선택이다).
// 미디어 쿼리는 zoom 을 모르므로 **실제 CSS 창 폭**으로 가른다(tablet 834 미만 = 휴대폰).
export function 휴대폰폭() {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 833.98px)').matches } catch { return false }
}
/** 지금 화면에 먹어 있어야 할 배율 — 저장값(초기 설정 중에는 1). 첫 그림에서도 맞게 저장소를 읽는다. */
export function 지금배율() { return (보통고정 || 휴대폰폭()) ? 1 : (임시배율 ?? 읽기()) }

/**
 * **지금 `<html>` 에 실제로 먹어 있는 배율** (2026-09-18).
 *
 * 화면 좌표(`getBoundingClientRect`·`clientX`)로 `position:fixed` 쪽지를 띄우는 곳은 이 값으로
 * **나눠서** 넣어야 한다 — `zoom` 이 style 의 px 에 배율을 한 번 더 곱하기 때문이다.
 * 안 나누면 1.25배에서 캘린더 쪽지가 407px 화면 밖으로 나갔다(실측).
 * `지금배율()` 은 「먹어 있어야 할」 값이고 이것은 「실제로 먹은」 값이다 — 좌표 보정에는 이쪽을 쓴다.
 * 같은 규칙을 쓰는 곳: 캘린더 쪽지(`scheduleCalendarPopups`) · 물음표 도움말(`HelpTip`) · 처음 안내(`HomeTour`, 제 안에서 읽음).
 */
export function 먹은배율() {
  try {
    const z = parseFloat(getComputedStyle(document.documentElement).zoom)
    return z > 0 ? z : 1
  } catch { return 1 }
}

// ── **처음 안내 중에는 배율을 따로 정한다** (사용자 신고 2026-09-17, 두 번) ─────────────
// 1.5배에서 흐름이 안 보였고(→ 1.25배), 1.25배에서도 말풍선이 화면을 가렸다(→ 보통). 값은 HomeTour 가 정한다.
// 저장은 안 한다 — 안내가 끝나면 사람이 고른 배율로 돌아간다(`되돌릴배율`).
let 임시배율 = null
export function 임시배율로(v) { 임시배율 = v == null ? null : 정리(v) }
/** 「원래대로」가 돌아갈 배율 — 안내 중이면 안내 배율, 아니면 저장값. */
export function 되돌릴배율() { return 임시배율 ?? 읽기() }

export function 먹이기(배율, root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null)
  if (!el) return
  const v = (보통고정 || (!root && 휴대폰폭())) ? 1 : 정리(배율)
  if (v === 1) {
    el.style.removeProperty('zoom')
    el.style.removeProperty('--cc-zoom')
  } else {
    el.style.zoom = String(v)
    // ── **화면 높이를 쓰는 곳이 확대를 알아야 한다** (사용자 신고 2026-09-15) ────
    // *"큰화면으로 하니까 저기서 안 내려가."*
    //
    // `zoom` 을 걸면 안쪽의 모든 px 이 배율만큼 커져서 그려진다. **그런데 `vh`·`dvh`
    // 는 확대를 모른다** — 늘 「화면 높이의 몇 %」다. 그래서 `max-h-[90dvh]` 인
    // 모달이 1.5배에서는 **화면보다 1.5배 커지고**, 넘친 부분이 화면 밖으로 나가
    // 스크롤이 죽는다.
    //
    // 고치는 법은 **배율로 나누는 것**이다(`calc(90dvh/var(--cc-zoom,1))`).
    // 그러려면 배율을 CSS 가 읽을 수 있어야 해서 여기서 내보낸다.
    // 기본값 1 을 둬서, 이 값이 없을 때(평소)는 예전과 글자 그대로 같다.
    el.style.setProperty('--cc-zoom', String(v))
  }
  try { if (typeof window !== 'undefined' && !root) window.dispatchEvent(new Event(배율이벤트)) } catch { /* 알림 실패는 배치만 늦게 맞춘다 */ }
}

/** 저장해 둔 배율을 읽는다. 못 읽으면 원래 크기다(사생활 보호 창·차단 설정). */
export function 읽기(store) {
  try {
    const s = store || (typeof localStorage !== 'undefined' ? localStorage : null)
    return 정리(s?.getItem(저장키))
  } catch { return 1 }
}

/**
 * **처음 배율은 「크게」(1.25배)** (사용자 지시 2026-09-17 「초기는 중간 값으로 하는거지」).
 * 초기 설정을 마칠 때 **아직 고른 적이 없으면만** 넣는다 — 이미 고른 사람·초기 설정을 안 거친 현장 PC 는 그대로다.
 */
export const 처음배율 = 1.25
export function 처음이면기본저장(store) {
  try {
    const s = store || (typeof localStorage !== 'undefined' ? localStorage : null)
    if (s && s.getItem(저장키) == null) s.setItem(저장키, String(처음배율))
  } catch { /* 못 쓰면 보통 크기로 시작한다 */ }
}

/** 저장한다. 실패해도 화면은 그대로 커진 채 쓴다 — 다음에 안 기억될 뿐이다. */
export function 저장(배율, store) {
  try {
    const s = store || (typeof localStorage !== 'undefined' ? localStorage : null)
    s?.setItem(저장키, String(정리(배율)))
  } catch { /* 저장 못 해도 이번 판은 쓴다 */ }
}
