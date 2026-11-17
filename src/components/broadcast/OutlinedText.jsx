// 홀 TV 에 나가는 큰 글씨 — **순백 채움 + 단단한 검정 테두리** (2026-09-13).
//
// ── 왜 두 겹으로 그리나 ──────────────────────────────────────────────────────
// 밝은 하늘 위의 흰 글씨는 테두리가 없으면 안 읽힌다. 그런데 테두리를 주는 흔한 방법 둘이
// 전부 **흰 속을 회색으로 만들었다**(사용자 지적 2026-09-13: *"새하얀색으로 하라고"*):
//
//   ① `-webkit-text-stroke` — 획을 글자 윤곽 **가운데**에 그린다. 두께의 절반이 안쪽을
//      먹는다. `paint-order: stroke fill` 을 줘도 크롬에서 흰 속이 얇아져 회색으로 보였다.
//   ② 여러 방향 그림자 — 얇을 때만 통한다. 두껍게 하면 **방향 사이에 틈**이 생겨
//      테가 회색으로 뭉갠다(8방향 0.065em 에서 실제로 그랬다).
//
// 그래서 **글자를 두 번 그린다.** 뒤 겹은 테두리만(속은 투명), 앞 겹은 순백.
// 앞 겹이 뒤 겹을 완전히 덮으므로 **흰 속은 한 픽셀도 안 깎인다.** 자막 렌더러들이
// 쓰는 방법이고, 값이 아니라 구조로 보장한다.
//
// ── 쓰는 법 ─────────────────────────────────────────────────────────────────
//   <OutlinedText as="h1" className="..." style={{ fontSize: '...' }}>글자</OutlinedText>
// 글자 크기·굵기·정렬은 바깥에서 준다. 이 부품이 정하는 것은 **테두리와 흰색**뿐이다.

/**
 * @param {string}    [as='span']   그릴 태그
 * @param {number}    [em=0.07]     테두리 두께(글자 크기 대비). 72px 글자에서 5.0px.
 *                                  여덟 벌을 실제 크기로 나란히 놓고 사용자가 고른 값이다
 *                                  (2026-09-13: *"⑧ 획 0.07em + 그림자 이게 젤 나은거같은데?"*)
 * @param {string}    [color='#fff'] 앞 겹 색. 자막의 강조(청록)도 이 자리로 들어온다
 * @param {boolean}   [shadow=true] 바닥에서 살짝 띄우는 그림자
 * @param {boolean}   [block=false] **제 줄을 차지한다.** 기본은 `inline-block` 이라
 *   글자 폭만큼만 차지하는데, 그대로 `<h1>`·`<h2>` 에 쓰면 **두 제목이 한 줄에 붙는다**
 *   (2026-09-13 브라우저에서 실제로 그렇게 나왔다 — "…(표어)(기관 이름)" 처럼 두 줄이 이어 붙었다).
 *   태그 이름으로 알아서 정하지 않는다. 부르는 쪽이 어떤 자리인지 알고 있고,
 *   숨은 규칙은 다음 사람이 못 본다.
 */
export default function OutlinedText({
  as: Tag = 'span', em = 0.07, color = '#fff', shadow = true, block = false,
  className = '', style, children, ...rest
}) {
  return (
    <Tag className={(block ? 'relative block ' : 'relative inline-block ') + className}
         style={style} {...rest}>
      {/* 뒤 겹 — 테두리만. **속을 투명으로** 둬서 앞 겹의 흰색과 섞이지 않게 한다.
          `aria-hidden` 이라 화면 낭독기는 글자를 한 번만 읽는다.

          **줄바꿈·말줄임을 바깥에서 그대로 물려받는다**(`inherit` 셋). 뒤 겹은 흐름 밖
          (`absolute`)이라 바깥의 `truncate` 가 저절로 걸리지 않는다 — 그냥 두면 앞 겹은
          「…」로 끝나는데 뒤 겹은 글자 한가운데서 뚝 잘려 검은 테가 삐져나온다.
          바깥이 안 자르면 셋 다 기본값(`visible`·`clip`·`normal`)이라 아무 일도 안 한다. */}
      <span aria-hidden="true"
            className="absolute inset-0 select-none
                       [overflow:inherit] [text-overflow:inherit] [white-space:inherit]"
            style={{
              WebkitTextStrokeWidth: `${em}em`,
              WebkitTextStrokeColor: '#000',
              color: 'transparent',
              ...(shadow ? { textShadow: '0 0.03em 0.05em rgba(0,0,0,0.45)' } : null),
            }}>
        {children}
      </span>
      {/* 앞 겹 — 순백. 아무것도 안 얹는다. */}
      <span className="relative" style={{ color }}>{children}</span>
    </Tag>
  )
}
