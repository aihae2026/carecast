// **캘린더 쪽지를 어디에 띄울지** — 화면과 떼어 낸 순수 계산 (2026-09-18).
//
// 왜 떼어 냈나: 이 계산이 틀리면 쪽지가 화면 밖으로 나가는데, 부품 안에 있으면 **숫자를 넣어 시험할 수가 없다.**
// 앞 판의 시험은 소스 글자만 봐서, 계산을 망가뜨려도 초록이었다(독립 QA 가 변이 8개로 실증 — 2026-09-18).
// React 도 DOM 도 모르는 함수라 `server/test/popup-place.test.js` 가 그대로 돌린다.
//
// ── 확대 배율(z) ────────────────────────────────────────────────────────────
// 크게 보기는 `<html>` 에 `zoom` 을 건다. `position:fixed` 의 `left`·`top`·`width` 는 **z 배로 커져서** 그려지는데,
// 창 크기(`innerWidth`)와 클릭 좌표(`clientX`)는 확대 **전** 화면 좌표다. 그래서 **둘을 z 로 나눠 한 좌표계로**
// 맞춘 뒤 판정한다. 돌려주는 값은 전부 그 좌표계(= style 에 그대로 넣을 px)다.
// 이걸 안 해서 1.25배·창 1689 에서 오른쪽 끝 날짜를 누르면 407px 이 화면 밖으로 나갔다(실측).
//
// ── 위·아래 ────────────────────────────────────────────────────────────────
// 화면 아래 절반을 누르면 **위로** 편다(쪽지 아랫변을 클릭 지점에 붙인다 — 2026-09-15).
// 그런데 작은 노트북(1366×768)에 크게 보기면 **위쪽 공간이 쪽지 높이보다 작아** 「저장」 단추가 쪽지 안
// 스크롤 아래로 숨었다(2026-09-18 실측: 1.25·1.5배 둘 다). 그래서 위로 모자라면 아래로, 아래도 모자라면
// **쪽지 전체를 창 안에 넣는다** — 누른 날짜를 조금 가려도 된다(투명한 바깥 층이 달력 클릭을 막고 있다).

/**
 * @param {object} p
 * @param {{x:number,y:number}|null} p.anchor 클릭 좌표(`clientX`·`clientY`, 확대 전 화면 좌표). 없으면 가운데.
 * @param {number} p.width  쪽지 폭(CSS px, 확대 전)
 * @param {number} p.height 쪽지 높이 어림(CSS px) — 넘칠지 판정에만 쓴다
 * @param {number} p.vw     창 폭(`innerWidth`)
 * @param {number} p.vh     창 높이(`innerHeight`)
 * @param {number} [p.z=1]  지금 먹은 확대 배율
 * @param {number} [p.pad=12] 창 가장자리와 띄울 틈
 * @returns {{left:number, 폭:number, top?:number, bottom?:number, 최대높이:number}}
 */
export function 쪽지자리({ anchor, width, height, vw, vh, z = 1, pad = 12 }) {
  const 배 = z > 0 ? z : 1
  const W = vw / 배, H = vh / 배
  // 좁은 창에서는 쪽지 폭 자체가 창보다 넓을 수 있다 — 그러면 어디에 놓아도 잘린다.
  const 폭 = Math.min(width, Math.max(160, W - pad * 2))
  const ax = anchor ? anchor.x / 배 : W / 2
  const ay = anchor ? anchor.y / 배 : H / 2

  let left = ax + 8
  if (left + 폭 + pad > W) left = Math.max(pad, W - 폭 - pad)

  const 위공간 = ay - pad - 8
  const 아래공간 = H - ay - 8 - pad
  const 통째로 = () => {
    const top = Math.max(pad, H - height - pad)
    return { left, 폭, top, 최대높이: Math.max(120, H - top - pad) }
  }

  if (ay > H / 2) {
    // 위로 펴는 쪽이 기본. 위가 모자라면 아래, 둘 다 모자라면 창 안에 통째로.
    if (위공간 >= height) return { left, 폭, bottom: Math.max(pad, H - ay + 8), 최대높이: Math.max(120, 위공간) }
    if (아래공간 >= height) return { left, 폭, top: ay + 8, 최대높이: Math.max(120, 아래공간) }
    return 통째로()
  }
  const top = ay + 8
  if (top + height + pad > H) return 통째로()
  return { left, 폭, top, 최대높이: Math.max(120, H - top - pad) }
}
