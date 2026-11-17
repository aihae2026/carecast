// **바깥에서 받아 온 것의 출처를 밝히는 한 줄** (사용자 지시 2026-09-16).
//
// ── 왜 있어야 하나 ─────────────────────────────────────────────────────────
// 우리가 쓰는 공공데이터는 전부 **공공누리(KOGL)** 아래에 있고, **네 유형 모두
// 「출처표시」가 필수**다. 2026-09-16 에 데이터셋마다 원문을 확인했다:
//
//   기상청 단기예보        제1유형 (출처표시)
//   기상청 기상특보        제1유형 (출처표시)
//   기상청 생활기상지수     이용허락범위 제한 없음
//   한국환경공단 대기오염정보  **제3유형** (출처표시 + 변경금지)
//
// 그런데 **화면 어디에도 출처가 없었다.** 지켜야 할 것 중 가장 간단한 것을 안 지키고
// 있었다 — 고칠 수 있고 아직 안 고친 것이었다(`docs/submission/SUBMISSION.md` §4.2).
//
// ── 왜 여기 한 줄인가 ──────────────────────────────────────────────────────
// 날씨가 보이는 자리마다 붙이면 **간편 화면의 작은 날씨 칩**에까지 출처가 따라붙어
// 머리줄이 도로 어수선해진다. 공공누리가 요구하는 것은 **찾을 수 있게 밝히는 것**이지
// 값 옆에 매번 적는 것이 아니다. 그래서 **관리자 화면에서 늘 보이는 자리**에 둔다.
//
// ── 무엇을 적나 ────────────────────────────────────────────────────────────
// 기관 이름과 **유형**까지 적는다(이유는 `lib/dataCredits` 머리말에 있다).
import { Landmark } from 'lucide-react'
// 목록은 `lib/dataCredits` 한 곳에 있다 — 부품 파일이 부품 아닌 것을 함께 내보내면
// lint 가 막고, 화면에 박아 두면 다른 자리에서 쓸 때 사본이 생긴다.
import { 출처들 } from '../../lib/dataCredits'

export default function DataCredits() {
  return (
    <section aria-label="데이터 출처"
      className="border-t border-ds-v3-line px-4 py-3 text-left">
      <p className="mb-1.5 flex items-center gap-1.5 t-sub font-semibold text-ds-v3-ink-2">
        <Landmark size={13} aria-hidden="true" />
        데이터 출처
      </p>
      <ul className="m-0 list-none space-y-1 p-0">
        {출처들.map((s, i) => (
          <li key={i} className="t-sub leading-snug text-ds-v3-ink-3">
            <span className="font-semibold text-ds-v3-ink-2">{s.기관}</span>
            {' — '}{s.자료}
            {/* 조건은 한 단 더 조용하게. 매일 읽는 글이 아니라 **필요할 때 찾는** 글이다. */}
            <br /><span className="text-ds-v3-ink-3">{s.조건}</span>
            {/* CC BY 처럼 **링크 자체가 조건**인 출처는 링크로 그린다(Open-Meteo, 2026-10-07). */}
            {s.링크 && (<>
              <br /><a href={s.링크} target="_blank" rel="noreferrer" className="text-ds-v3-tts hover:underline">{s.링크글}</a>
            </>)}
            {s.조건링크 && (<>
              {' · '}<a href={s.조건링크} target="_blank" rel="noreferrer" className="text-ds-v3-tts hover:underline">{s.조건링크글}</a>
            </>)}
          </li>
        ))}
      </ul>
    </section>
  )
}
