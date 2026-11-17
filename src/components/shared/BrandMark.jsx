import { Radio } from 'lucide-react'

// ── CareCast 이름표 — **한 벌만 둔다** (사용자 지시 2026-09-16) ───────────────────
// *"케어캐스트 홈화면 이미지 지금 케어캐스트 배너에 있는 모양에 배경색을 우리 공통
//   가이드라인으로 쓰고 있는 블러(간편모드 해당 방송 배경색으로) 해서 바꿔주는게 어때.
//   그리고 설정 관리에서도 저거 파란색으로 해놓지말고 위 지시사항에 맞춘 디자인 로고로 바꿔"*
//
// ── 무엇이 문제였나 ──────────────────────────────────────────────────────────
// ① **파랑이 브랜드색이 아니다.** 이름표가 `--ds-v3-tts` 를 쓰고 있었는데 그 토큰의 뜻은
//    「말(안내 음성)」이다(G-1). 로고가 그 색을 빌려 쓰면, 화면 어딘가의 파란 조각이
//    「TTS 라서 파란 것」인지 「로고라서 파란 것」인지 갈리지 않는다.
// ② **같은 것이 세 벌 있었다** — 사이드바·간편 상단바·통합 홈이 각자 적고 있어서, 색을
//    고치라는 지시가 오면 세 자리를 찾아 고쳐야 했고 언젠가 하나를 빠뜨린다.
//
// ── 무엇으로 바꿨나 ──────────────────────────────────────────────────────────
// 배경은 **이 제품이 이미 쓰는 물감 두 방울**이다(`--ds-v3-drop-tts` 하늘 · `--ds-v3-drop-bgm`
// 자두). 간편 화면 배경에 흐르고, 흰 카드에 옅게 깔리는 바로 그 둘이다 — **새 색을 만들지
// 않았다**(G-1). 대각선으로 이어 흐릿하게 번지게 두면 사용자가 말한 「블러」가 된다.
//
// 글자는 잉크다. 「AI」도 파랑을 뗀다 — 대신 **옅은 잉크**로 가른다. 처음엔 굵기(800)로
// 갈랐는데 `typography.test.js` 가 잡았다: **이 제품의 두께는 600 과 400 둘뿐이다**(T-10).
// 가드가 옳았다 — 두께를 하나 더 들이면 그때부터 「조금 굵은 것」이 여럿 생긴다.
//
// **아이콘은 그대로 `Radio` 다.** 사용자가 *"지금 케어캐스트 배너에 있는 모양"* 이라고
// 못 박았다 — 바꾸라는 것은 배경이지 모양이 아니다.

/** 물감 두 방울을 대각선으로 흘린 배경. 흐릿하게 번지도록 두 겹으로 겹친다. */
const 물감 = {
  backgroundImage:
    'radial-gradient(120% 120% at 18% 12%, rgba(var(--ds-v3-drop-tts), .95) 0%, rgba(var(--ds-v3-drop-tts), 0) 62%),'
    + 'radial-gradient(120% 120% at 88% 92%, rgba(var(--ds-v3-drop-bgm), .95) 0%, rgba(var(--ds-v3-drop-bgm), 0) 66%),'
    + 'linear-gradient(135deg, rgba(var(--ds-v3-drop-tts), .55) 0%, rgba(var(--ds-v3-drop-bgm), .5) 100%)',
}

// 자리마다 크기가 다르다. **여기 한 표에만 적는다** — 부르는 쪽이 px 을 직접 적으면
// 또 세 벌이 된다.
const 크기표 = {
  sm: { 판: 'w-7 h-7 rounded-[8px]',  아이콘: 14, 글자: 'text-sm'   },
  md: { 판: 'w-8 h-8 rounded-[10px]', 아이콘: 16, 글자: 'text-base' },
  lg: { 판: 'w-9 h-9 rounded-[11px]', 아이콘: 20, 글자: 'text-[17px]' },
}

/**
 * @param {'sm'|'md'|'lg'} size  자리에 맞는 크기
 * @param {boolean} ai           「AI」를 붙일지 (관리자·간편 상단바는 붙이고, 통합 홈은 안 붙인다)
 * @param {boolean} 글자없이      아이콘 판만 쓸 때
 */
export default function BrandMark({ size = 'md', ai = false, 글자없이 = false, className = '' }) {
  const s = 크기표[size] ?? 크기표.md
  return (
    <span className={'flex items-center gap-2.5 ' + className}>
      <span className={s.판 + ' flex items-center justify-center shrink-0 overflow-hidden'}
        style={물감} aria-hidden="true">
        {/* 물감 위에 놓이는 유일한 것이 아이콘이다 — 글자는 물감 위에 안 앉힌다(G-4). */}
        <Radio size={s.아이콘} strokeWidth={1.9} className="text-ds-v3-ink" />
      </span>
      {!글자없이 && (
        <span className={s.글자 + ' font-semibold text-ds-v3-ink tracking-tight'}>
          CareCast{ai && <span className="text-ds-v3-ink-3"> AI</span>}
        </span>
      )}
    </span>
  )
}
