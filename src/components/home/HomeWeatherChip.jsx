// 머리줄 시계 덩어리의 **셋째 줄 — 작은 날씨** (사용자 지시 2026-09-15·16).
//
// *"날씨정보 위에 날짜 옆에 조그마하게 집어넣을까? 최고 최저 습도, 자외선 이런거
//   가독성있게 깔끔하게 넣어봐 귀엽게"* (09-15)
//
// *"윗줄 너무 지저분해 보이지 않아? … 일자를 위에, 그 아래에 날씨정보 들어가서
//   콤팩트하게"* (09-16) — 그래서 **머리줄에 따로 서지 않고** `HomeClock` 안으로
//   들어갔다. 시각·날짜와 **한 이야기**(「지금 여기는 이렇다」)라 한 덩어리가 맞다.
//
// ── 지키는 것 넷 ───────────────────────────────────────────────────────────
// ① **새 색을 안 만든다.** 최고는 자주(`--ds-v3-bgm`), 최저는 파랑(`--ds-v3-tts`)
//    — 이 화면 배경에 이미 깔려 있는 두 물감이다. 따뜻함·차가움이 그대로 읽힌다.
// ② **머리줄의 주인공이 아니다.** 시계보다 작고 조용하다(`t-sub`·잉크2). 이 화면의
//    주인공은 「무엇을 방송할까요?」와 검색창이다.
// ③ **없는 값은 안 그린다.** 「-」나 「0」으로 채우면 사람이 그것을 값으로 읽는다.
//    서버가 `null` 로 주는 칸은 통째로 빠지고, 남은 것끼리 자연스럽게 붙는다.
// ④ **못 받으면 아무것도 안 그린다.** 날씨를 못 받는 것은 방송이 안 나가는 일이
//    아니다. 머리줄에 오류를 띄우면 사람이 방송 문제로 오해한다.
//
// ── 자주 물어도 된다 ───────────────────────────────────────────────────────
// 서버가 **반나절에 한 번만** 바깥으로 나간다(`domain/weatherChip.js`). 화면이 묻는
// 간격과 공공데이터 호출 횟수는 별개다. 그래도 10분으로 둔다 — 1분마다 물어 봐야
// 같은 값이 돌아온다.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { getWeatherChip } from '../../lib/api'

const 묻는간격 = 10 * 60 * 1000

// 자외선은 **말이 숫자보다 쓸모 있다** — 「3」보다 「낮음」이 바로 읽힌다.
// 말이 없을 때만 숫자를 쓴다.
function 자외선말(칩) {
  if (칩.자외선) return 칩.자외선
  if (칩.자외선수치 != null) return String(칩.자외선수치)
  return null
}

export default function HomeWeatherChip() {
  const [칩, set칩] = useState(null)

  useEffect(() => {
    let 끝났나 = false
    const 받기 = () => {
      getWeatherChip()
        .then(r => { if (!끝났나) set칩(r && typeof r === 'object' && !r.error ? r : null) })
        // 조용히 넘어간다 — 머리줄은 날씨 오류를 알릴 자리가 아니다.
        .catch(() => { if (!끝났나) set칩(null) })
    }
    받기()
    const t = setInterval(받기, 묻는간격)
    return () => { 끝났나 = true; clearInterval(t) }
  }, [])

  if (!칩) return null

  const uv = 자외선말(칩)
  const 칸들 = []

  // 최고·최저는 **한 묶음**이다. 따로 떼면 어느 쪽이 어느 쪽인지 화살표를 두 번 읽어야 한다.
  // ── **튀지 않게 회색 한 색 · 그림 대신 낱말** (사용자 결정 2026-09-16 시안 · 재확인 2026-09-17) ──
  // *"아까 이게 튀면 안된다해서 회색으로 그리고 자외선이라고 표기하지 않았나?"*
  // 날씨는 **읽는 보조 정보**다. 최고 자주·최저 파랑 화살표는 말(파랑)·음악(자주) 색을 빌려 써서
  // 방송 단추와 같은 무게로 눈을 끌었다(G-1). 물방울·해 그림은 뜻을 한 번 더 풀어야 했다 —
  // 「습도」「자외선」 두 낱말이 더 빨리 읽힌다.
  if (칩.최고 != null || 칩.최저 != null) {
    칸들.push(
      <span key="온도" className="flex items-center gap-1.5 tabular-nums">
        {칩.최고 != null && <span className="flex items-center gap-0.5"><ArrowUp size={11} strokeWidth={2.5} aria-hidden="true" />{칩.최고}°</span>}
        {칩.최저 != null && <span className="flex items-center gap-0.5"><ArrowDown size={11} strokeWidth={2.5} aria-hidden="true" />{칩.최저}°</span>}
      </span>
    )
  }

  if (칩.습도 != null) {
    칸들.push(<span key="습도" className="tabular-nums">습도 {칩.습도}%</span>)
  }

  if (uv) {
    칸들.push(<span key="자외선">자외선 {uv}</span>)
  }

  if (칸들.length === 0) return null

  // 낭독기에는 **한 문장으로** 준다. 아이콘을 하나씩 읽으면 뜻이 안 선다.
  const 읽을말 = [
    칩.최고 != null ? `최고 ${칩.최고}도` : null,
    칩.최저 != null ? `최저 ${칩.최저}도` : null,
    칩.습도 != null ? `습도 ${칩.습도}퍼센트` : null,
    uv ? `자외선 ${uv}` : null,
  ].filter(Boolean).join(', ')

  return (
    // **시계 덩어리의 셋째 줄이다**(2026-09-16). 앞 판은 머리줄에 따로 선 덩어리였는데,
    // 시각·날짜와 **한 이야기**(「지금 여기는 이렇다」)라 한 덩어리로 합쳤다.
    // 세로선·바깥 여백은 감싸는 쪽(`HomeClock`)이 갖는다 — 여기서 또 그으면 선이 둘이 된다.
    <div
      // 좁은 화면에서는 줄을 바꾼다 — Open-Meteo 출처 글이 붙으면 휴대폰 폭(390px)에서 한 줄이 화면 양옆으로
      // 잘렸다(2026-10-07 실측). 칸 하나하나는 그대로 한 덩어리(nowrap)이고, 넘칠 때만 다음 줄 가운데로 간다.
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 whitespace-nowrap text-[13px] text-ds-v3-ink-3"
      title={칩.낡음 ? '날씨를 새로 받지 못해 먼저 받아 둔 값입니다' : undefined}
      aria-label={`오늘 날씨 ${읽을말}`}
    >
      {칸들}
      {/* 낡은 값이면 **숨기지 않고** 아주 작게 알린다 — 조용히 옛 숫자를 보여 주지 않는다. */}
      {칩.낡음 && <span aria-hidden="true" className="text-ds-v3-ink-3">·</span>}
      {/* **Open-Meteo 값이 보일 때만** 그 옆에 출처(사용자 지시 2026-10-07 — CC BY 4.0 「보여 주는 자리 옆에」 링크).
          기상청 값뿐이면 안 단다. **신경 쓰이지 않게 아주 작고 옅게**(사용자 지시 2026-10-07) — 글은 원문이 요구하는
          그대로 두고 크기·색만 줄인다. 손을 대면 조금 진해진다(찾을 수는 있어야 한다). */}
      {칩.오픈메테오 && (
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer"
          className="text-[10px] leading-none text-ds-v3-ink-3 opacity-60 hover:opacity-100 focus-visible:opacity-100">Weather data by Open-Meteo.com</a>
      )}
    </div>
  )
}
