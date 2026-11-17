// **데이터 출처** — 제 화면 (사용자 지시 2026-09-16).
//
// *"데이터 출처 저기다 집어넣으니까 뭔가 이상하잖아. 그냥 따로 시스템 운영 메뉴 하나로
//   빼면 안될까?"*
//
// 맞다. 앞 판은 사이드바 **맨 아래 푸터**에 작은 글씨로 붙여 뒀다. 두 가지가 나빴다:
//   · 사이드바는 **가는 곳**이지 읽는 곳이 아니다. 거기 글이 있으면 메뉴가 아닌 것이
//     메뉴 자리에 앉아 있는 셈이라 어수선해 보인다.
//   · 작은 글씨로 눌러 붙여 두니 **정작 찾아야 할 때 못 찾는다.** 공공누리가 요구하는
//     것은 「찾을 수 있게 밝히는 것」인데, 찾기 어려우면 밝힌 값이 준다.
//
// 이제 시스템운영의 **한 메뉴**다. 목록 자체는 `lib/dataCredits` 한 곳에서 온다 —
// 화면이 제 목록을 들면 제출 문서·안내도와 갈린다.
import { Landmark, ExternalLink } from 'lucide-react'
import { 출처들 } from '../../../lib/dataCredits'

export default function DataCreditsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-section text-ds-v3-ink">데이터 출처</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">
          방송에 쓰는 날씨·미세먼지는 공공기관 등이 공개한 자료입니다. 어디서 받아 오는지와
          어떤 조건으로 쓸 수 있는지를 적어 둡니다.
        </p>
      </div>

      {/* ── 왜 적어 두나 ────────────────────────────────────────────────────
          우리가 쓰는 공공데이터는 전부 **공공누리(KOGL)** 아래에 있고, **네 유형 모두
          「출처표시」가 필수**다. 2026-09-16 에 데이터셋마다 원문의 「이용허락범위」
          칸을 직접 읽어 확인했다. */}
      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <Landmark size={15} className="text-ds-v3-tts" />
          받아 오는 자료
        </h2>
        <p className="text-xs text-ds-v3-ink-2 mb-4">
          기상청·에어코리아 자료는 <b>공공누리</b>, Open-Meteo 자료는 <b>CC BY 4.0</b> 아래에
          있습니다. 모두 <b>출처를 밝히는 것이 필수</b>라, 이 화면이 그 자리입니다.
        </p>

        <ul className="m-0 list-none space-y-3 p-0">
          {출처들.map((s, i) => (
            <li key={i}
              className="rounded-[10px] border border-ds-v3-line bg-ds-v3-bg px-3.5 py-3">
              <p className="text-sm font-semibold text-ds-v3-ink">{s.기관}</p>
              <p className="text-xs text-ds-v3-ink-2 mt-0.5">{s.자료}</p>
              {/* 조건을 함께 적는 이유: 「기상청 제공」만 적으면 다음 사람이 *"어느 조건으로
                  쓰는 것이더라"* 를 다시 조사해야 한다. 특히 **미세먼지는 변경금지**라,
                  그 한 줄이 나중에 누가 그 값을 가공하려 할 때 멈춰 세운다. */}
              <p className="text-xs text-ds-v3-ink-3 mt-1.5">{s.조건}</p>
              {/* CC BY 처럼 **링크 자체가 조건**인 출처(Open-Meteo, 2026-10-07). */}
              {s.링크 && (
                <a href={s.링크} target="_blank" rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ds-v3-tts hover:underline">
                  {s.링크글} <ExternalLink size={11} />
                </a>
              )}
              {s.조건링크 && (
                <a href={s.조건링크} target="_blank" rel="noreferrer"
                  className="mt-1.5 ml-3 inline-flex items-center gap-1 text-xs font-semibold text-ds-v3-tts hover:underline">
                  {s.조건링크글} <ExternalLink size={11} />
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1">우리가 값을 고치지 않습니다</h2>
        <p className="text-xs text-ds-v3-ink-2 leading-relaxed">
          미세먼지는 <b>변경금지(공공누리 제3유형)</b>입니다. 이 시스템은 에어코리아가 보내
          주는 등급 코드를 <b>그쪽이 정한 이름 그대로</b> 옮겨 읽을 뿐이고(좋음·보통·나쁨·
          매우나쁨), 우리 기준으로 다시 나누거나 값을 보정하지 않습니다.
        </p>
        <a href="https://www.kogl.or.kr/info/license.do" target="_blank" rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold
                     text-ds-v3-tts hover:underline">
          공공누리 이용조건 보기 <ExternalLink size={12} />
        </a>
      </div>
    </div>
  )
}
