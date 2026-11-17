// 오늘 일과방송 — 통합 홈의 목록. **카드로 감싸지 않는다(누끼)**: 배경 물감이 그대로 비친다.
// 디자인 정본: mockup-UX01/mockup/v3.html.
//
// ── 데이터는 `GET /api/schedules/today` 하나만 본다 ──────────────────────────
// 처음엔 `getSchedules()` 를 읽고 화면에서 요일을 걸렀다. **그것이 CC-026 의 재발이었다**
// (V③ Codex 검수 2026-09-13, high). 두 가지가 한꺼번에 틀린다:
//   ① **일과방송 5종이 아예 안 보인다** — 그것들은 `schedules` 표가 아니라 `settings` 의
//      시각·활성 키로 돈다.
//   ② 날짜 판정이 서버와 갈린다 — 내일 1회성·시작 전 반복·끝난 반복이 오늘 목록에 뜬다
//      (`scheduleUtils.runsOnDate` 와 `shouldRunToday` 가 보는 것을 화면이 안 봤다).
// 그래서 **완료/누락 판정도 서버 것을 그대로 쓴다.** 화면이 따로 계산하면 watchdog 경보와
// 어긋나서 사람이 둘 다 안 믿게 된다(`TodaySchedule.jsx` 머리말과 같은 근거).
//
// 묶음 접기도 `scheduleBatch` 를 그대로 쓴다 — 규칙을 화면마다 복사하면 같은 방송이
// 화면에 따라 한 줄로도 두 줄로도 보인다.
//
// ── 줄 접기와 "다음" 고르기는 `lib/todayRows.js` 에 있다 ────────────────────────
// 여기(JSX)에 두면 노드에서 못 돌려서, 회귀 시험이 **소스를 글자로 읽는 것**밖에 못 한다.
// V③ Codex 검수(2026-09-13)가 그 시험을 깨뜨려 보였다 — `findNextItem` 의 본문을
// `return null` 로 바꿔도 시험 5건이 전부 통과했다. 순수 모듈로 내려 **실제로 돌려 본다.**
import { useEffect, useState } from 'react'
import { Play, ChevronDown } from 'lucide-react'
import { getTodaySchedule, getAutoBroadcastSteps } from '../../lib/api'
import { canTriggerRow, triggerRow } from '../../lib/broadcastTrigger'
import ConfirmDialog from '../shared/ConfirmDialog'
import { groupItems, findNextItem, findRowOf } from '../../lib/todayRows'
import { bgmCoverage, stepKindOf } from '../../lib/bgmLane'
import { useTourStage } from '../../lib/tourStage'
import { AUDIO_STEP_MAP, VIDEO_STEP_IDS, TTS_STEP_KEYS, BGM_STEP_IDS, KIND_STYLE } from '../admin/sections/morningEditorConst'

// 펼친 단계의 색·그림 — **자동순서 편집기와 같은 판정·같은 표**를 쓴다(사용자 2026-09-17 N19).
const 단계표 = { videoIds: VIDEO_STEP_IDS, bgmIds: BGM_STEP_IDS, ttsKeys: TTS_STEP_KEYS, audioMap: AUDIO_STEP_MAP }
// 배경음악 선(bgmCoverage)은 영상·녹음 음원을 `audioCategory` 라는 이름으로 알아본다 — `audioMap`(색 판정용)만 주면
// 영상이 음악을 꺼도 선이 이어졌다(2026-09-26 Codex 검수 Medium). 편집기(StepList)와 같은 표를 준다.
const 배경음악표 = { ...단계표, audioCategory: AUDIO_STEP_MAP }

// ── 유형 꼬리표는 **이 목록에 없다** (사용자 지시 2026-09-14) ──────────────────
// 「자동」·「안내방송」 같은 꼬리표를 간편화면에서 뺐다. 앞으로 옮기는 안이 아니라 **제거**가
// 최종 요구다. 이 목록에서 사람이 찾는 것은 *"몇 시에 무엇이 나가나"* 이고, 유형은 그 물음에
// 답하지 않으면서 이름 칸을 갉아먹고 상태 칸을 밀어냈다.
//
// **표시만 빠진다** — 방송 유형·예약 데이터는 그대로다. 규칙(`lib/broadcastKind.js`)도 그대로
// 살아 있고 초안 카드가 계속 쓴다. 여기서만 안 그린다.

// ── 「지나간 줄 회색 바탕」은 **철회됐다** (사용자 지시 2026-09-14) ─────────────
// 잠깐 `지나간줄()` 이라는 판정을 두고 바탕을 눕혔는데, 사용자가 그 지시를 거뒀다 —
// 줄마다 바탕이 생기면 목록이 계단처럼 보이고 페이지 배경이 비치는 결이 끊긴다.
// **판정 자체를 지운다.** 안 쓰는 함수를 남겨 두면 다음 사람이 "왜 안 쓰지" 를 다시 판다.
// 지나갔다는 것은 **상태 칸**이 이미 말한다(완료·안 나감) — 그건 서버 판정이라 더 정확하다.

// 상태 낱말은 서로 달라야 한다 — 같은 말로 덮으면 무슨 일인지 모른다.
const STATUS = {
  done:    { label: '완료',   cls: 'text-ds-v3-ink-3' },
  pending: { label: '대기',   cls: 'text-ds-v3-ink-3' },
  missed:  { label: '안 나감', cls: 'text-ds-v3-bgm font-semibold' },
  unknown: { label: '결과 미확인', cls: 'text-ds-v3-ink-2' },
}

// ── **칸이 좁아지는 것은 화면이 아니라 그릇이다** (사용자 지적 2026-09-15) ──────────
// *"내용하고 상태 붙어있으니까 내용이 잘리잖아"*
//
// 초안 카드가 열리면 이 목록이 **480px 칸**으로 들어간다. 그런데 넓은 화면 배치를
// 고르는 기준은 **창 너비**(`tablet:`)라, 창은 넓고 그릇만 좁은 그 상태에서도 네 칸
// 가로 배치가 그대로 걸렸다. 시각 140 + 상태 96 + 수동 100 + 사이 36 = 372px 를 먹고
// **이름에 108px 만** 남아 「아침 종합 …」으로 잘렸다.
//
// **고치는 법은 이미 있었다.** 좁은 화면용 두 줄 배치(시각 한 줄 · 이름과 상태 한 줄)가
// 바로 이 문제를 풀려고 만든 것이다. 그러니 새 배치를 만들지 않고 **그릇이 좁을 때도
// 그것을 쓰게** 한다 — 부르는 쪽이 아는 사실(`초안열림`)을 내려받는다.
//
// `@container` 로 그릇 너비를 직접 보는 방법도 있지만 이 저장소의 Tailwind(3.4)는
// 플러그인을 더 깔아야 하고, 의존성 추가는 승인 사항이다(헌장 §9).
export default function HomeToday({ reloadKey, onNavigate, 좁게 = false }) {
  // 좁게 쓸 때는 **넓은 화면 규칙을 아예 안 건다.** 두 벌을 겹쳐 두고 이기게 하는 것보다
  // 안 거는 쪽이 읽기 쉽고, 어느 규칙이 살아 있는지 헷갈리지 않는다.
  const 넓게 = (cls) => (좁게 ? '' : cls)
  const [state, setState] = useState({ phase: 'loading', items: [] })
  // 지금 내보낼지 묻는 중인 줄. **확인 없이 나가는 길을 만들지 않는다**(G-42) —
  // 전관 스피커로 나가는 것이라 되돌릴 수 없다.
  const [ask, setAsk] = useState(null)
  const [busy, setBusy] = useState(false)
  const [보낸것, set보낸것] = useState('')
  const [못보낸것, set못보낸것] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [stepState, setStepState] = useState({})
  // 처음 안내(N18) 「오늘 나갈 방송」 장 — 「다음」 방송(없으면 펼칠 수 있는 첫 방송)의 단계를 실제로 펼친다.
  // 펼치면 단계 목록을 **읽기만** 한다(GET). 「여기부터 재생」은 눌리는 모습만이고, 확인 창도 안 연다.
  useTourStage({
    'today.expand': (on) => {
      if (!on) { setExpanded(null); return }
      const items = Array.isArray(state.items) ? state.items : []
      const 줄들 = groupItems(items)
      const 다음줄 = findRowOf(줄들, findNextItem(items))
      const 펼칠수있나 = (x) => x && x.kind === 'auto' && canTriggerRow(x)
      const 고른 = 펼칠수있나(다음줄) ? 다음줄 : 줄들.find(펼칠수있나)
      if (고른) { setStepState({}); setExpanded(고른.id) }
    },
  })

  useEffect(() => {
    if (!expanded) return
    let active = true
    getAutoBroadcastSteps(expanded).then(data => {
      if (!Array.isArray(data.steps)) throw new Error('단계 목록이 없습니다')
      if (active) setStepState({ tab: expanded, steps: data.steps })
    }).catch(() => { if (active) setStepState({ tab: expanded, error: true }) })
    return () => { active = false }
  }, [expanded])

  useEffect(() => {
    let dead = false
    const load = () => {
      getTodaySchedule()
        .then(r => {
          if (dead) return
          const items = Array.isArray(r?.items) ? r.items : null
          setState(items ? { phase: 'ok', items, count: r.count } : { phase: 'error', items: [] })
        })
        .catch(() => { if (!dead) setState({ phase: 'error', items: [] }) })
    }
    load()
    const t = setInterval(load, 30000)
    return () => { dead = true; clearInterval(t) }
  }, [reloadKey])

  const { phase, items, count } = state
  if (phase === 'loading') {
    return <section className="w-full max-w-[720px] text-sm text-ds-v3-ink-2">오늘 일과를 불러오는 중…</section>
  }
  if (phase === 'error') {
    return (
      <section className="w-full max-w-[720px] text-sm text-ds-v3-ink-2">
        오늘 일과를 불러오지 못했습니다. 잠시 뒤 다시 시도합니다.
      </section>
    )
  }

  const rows = groupItems(items)
  // "다음"은 서버가 아직 `pending` 으로 본 **항목** 중 가장 이른 것이다 — `lib/todayRows.js` 참고.
  const nextItem = findNextItem(items)
  const nextRow = findRowOf(rows, nextItem)

  return (
    // ── **흰 카드 · 줄 없음** (사용자 결정 2026-09-16 N10 — 시안 A 투명 / B 흰 카드 / C 흰 카드·줄 없음 중
    //    *"줄없는게 낫다"*). G-21(간편 본문 목록은 누끼)의 **사용자 결정 예외**다 — 가이드라인에 적었다.
    //    줄 사이 칸막이선은 걷고 간격으로 가른다. 「다음」 줄만 흰 판·그림자·흐르는 물감으로 뜬다.
    //    카드 바탕은 물감 없는 흰색이다(`HomeShell` 의 `data-plain-cards`, N15).
    <section data-tour="today" className="w-full max-w-[720px] rounded-[22px] border border-ds-v3-line bg-white px-2 py-4 text-left shadow-v3-card tablet:px-3.5" aria-labelledby="home-today-title">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3 px-1.5 tablet:px-2.5">
        <h2 id="home-today-title" className="m-0 text-sm font-semibold">오늘 일과방송</h2>
        <span className="t-sub text-ds-v3-ink-2">
          {rows.length === 0 ? '오늘 나갈 방송이 없습니다'
            : <>{count?.done ?? 0}건 완료 · {count?.pending ?? 0}건 대기
              {count?.missed ? <> · <b className="font-semibold text-ds-v3-bgm">{count.missed}건 안 나감</b></> : null}
              {count?.unknown ? <> · {count.unknown}건 결과 미확인</> : null}</>}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 py-6 t-sub text-ds-v3-ink-3">
          오늘 나갈 방송이 없습니다. 위에 말하듯이 적으면 초안을 만들어 드립니다.
        </p>
      ) : (
        <>
        {/* ── 열 머리글 (사용자 지시 2026-09-13) ────────────────────────────────
            *"구분표가 없으니까 재생모양 버튼이 뭔지도 모르겠잖아"* — 맞는 지적이다.
            ▶ 아이콘만 떠 있으면 그것이 "지금 듣기"인지 "지금 내보내기"인지 알 길이 없었다.
            **전관 스피커로 나가는 단추**라 그 오해는 비싸다.

            그래서 열에 이름을 준다. 「수동」이 그 칸의 이름이다 — 나머지 줄은 시각이 되면
            저절로 나가고, 이 칸만 사람이 손으로 내보내는 자리라는 뜻이 한 낱말에 담긴다.

            **미관을 위해 지키는 것 셋**: ① 줄을 새로 그리지 않는다 — 목록의 첫 칸막이선을
            그대로 머리글의 밑줄로 쓴다. ② 배경을 안 깐다(누끼 원칙 — 물감이 비쳐야 한다).
            ③ 14px·잉크3 로 **가장 조용하게** 둔다. 머리글은 한 번 읽고 다시 안 보는 글이다.

            **좁은 화면에서는 안 그린다.** 거기서는 상태가 이름 **아래로** 접혀 4열이 아니라
            3열이 되므로, 머리글을 그리면 이름과 자리가 어긋나 오히려 헷갈린다. */}
        <div aria-hidden="true"
          className={'hidden items-center gap-3 px-2.5 pb-1.5 t-sub text-ds-v3-ink-3 '
            + 넓게('tablet:grid tablet:grid-cols-[140px_minmax(0,1fr)_96px_100px]')}>
          <span>시간</span>
          <span>내용</span>
          <span>상태</span>
          <span className="text-right">수동</span>
        </div>
        <ul className="m-0 list-none p-0">
          {rows.map(r => {
            const isNext = nextRow && r === nextRow
            const st = STATUS[r.status] || STATUS.pending
            return (
              <li key={r.key || `${r.kind}_${r.id}`}
                className={'group grid items-center px-1.5 py-2.5 tablet:px-2.5 '
                  // 시각 칸을 넓혔다 — 글자를 13px→16px 로 키웠으니 같은 폭에 안 들어간다.
                  // **글자를 줄이지 않고 칸을 넓힌다**(T-1). 「12:35~12:45」가 가장 긴 경우다.
                  //
                  // **수동 칸을 넓혔다**(2026-09-14). 차수 단추 둘이 그 칸에 들어오므로
                  // 44px 로는 안 담긴다. `auto` 로 두면 내용만큼만 차지하고, 상태 칸과는
                  // `gap-3`(12px) 이 벌려 준다 — 상태가 단추에 붙어 보이던 것이 이 때문이다.
                  // **상태·수동 칸은 고정 폭이다.** `auto` 로 두면 차수 단추가 있는 줄만
                  // 칸이 넓어져 **상태 글자가 줄마다 다른 자리에 선다**(실측 1001·930·986·942).
                  // 수동 100px = 차수 단추 둘(38+38) + 사이 6 + 여유. 상태 96px = 가장 긴
                  // 문구(「안 나감 · 다음」)가 들어가는 폭.
                  // ── 좁은 화면은 **칸을 줄여** 이름 자리를 만든다 (2026-09-14 실측) ────
                  // 390px 에서 재 보니 이름 칸이 **34px** 였다 — 「아침 종합 방송」이
                  // 「아…」로 잘린다. 바깥 여백이 116px 이나 되는 탓이다(서랍 손잡이 자리
                  // 32×2 + 패널 16×2 + 줄 10×2).
                  //
                  // **`auto` 로는 못 고친다.** 잠깐 그렇게 해 봤는데, 격자는 **줄마다 따로**라
                  // 칸 폭이 줄끼리 공유되지 않는다 — 차수 단추가 있는 줄만 칸이 넓어져
                  // 시각·상태가 줄마다 다른 자리에 섰다(실측 43px ↔ 105px). 고정 폭을 준
                  // 이유가 바로 그것이었다.
                  // 그래서 **좁은 화면 전용 치수**를 따로 준다 — 시각 104px(「09:10~09:20」이
                  // 들어가는 최소), 수동 84px(차수 단추 38+38+6), 칸 사이는 6px 로 좁힌다.
                  // ── 좁은 화면은 **두 줄로 세운다** (사용자 지시 2026-09-15) ──────────
                  // *"오늘 일과방송에서 저 내용이 자꾸 두줄되고 꼴보기 싫어지는데 그냥
                  //   모바일 ui에서는 시간 밑에 제목이랑 다음 이런거 집어넣어서 한줄에
                  //   보일 수 있게 할까?"*
                  //
                  // 앞 판은 시각·이름·상태를 **가로로** 세 칸에 넣었다. 390px 화면에서
                  // 이름 칸이 152px 밖에 안 남아 「아침 종합 방송」이 두 줄로 접혔고,
                  // 그러면 옆의 차수 단추와 줄이 어긋나 **목록이 들쭉날쭉**해 보였다
                  // (사용자: *"재생 카드들도 두줄 막 줄 어긋난거 보기 싫어"*).
                  //
                  // 이제 **시각 한 줄 · 이름과 상태 한 줄**이다. 이름이 쓸 폭이
                  // 152 → 250px 쯤으로 늘어 한 줄에 들어간다. 줄 수는 같은데(둘) 각 줄이
                  // **의미로 갈려** 눈이 따라가기 쉽고, 단추와 어긋나지 않는다.
                  // 넓은 화면(`tablet:`)은 **가로 네 칸 그대로다** — 자리가 있으면 한 줄이 낫다.
                  + 'gap-x-2 gap-y-0.5 grid-cols-[minmax(0,1fr)_94px] '
                  + 넓게('tablet:gap-3 tablet:grid-cols-[140px_minmax(0,1fr)_96px_100px] ')
                  // ── 기본 줄은 **투명하다** (사용자 지시 2026-09-14, 앞 지시 철회) ──────
                  // 잠깐 「지나간 줄에 회색 바탕」을 넣었다가 사용자가 철회했다 — 줄마다 바탕이
                  // 생기면 목록이 계단처럼 보이고, 페이지 배경이 비치는 결이 끊긴다.
                  // **지나갔다는 것은 「상태」 칸이 이미 말하고 있다**(완료·안 나감).
                  // 배경 표현만 되돌린다 — 꼬리표 제거·열 정렬·글씨 크기는 그대로 둔다.
                  + (isNext ? 'relative isolate overflow-hidden rounded-[10px] '
                              + 'border-t-transparent bg-white shadow-v3-card' : '')}>
                {/* ── 「다음」 줄에만 도는 **옅은 물감** (사용자 지시 2026-09-14) ──────
                    *"첫인상은 깨끗한 흰색 행이다. 자세히 보면 색이 은은하게 번지고 천천히 흐른다."*

                    **바탕은 흰색 그대로다.** 그 위에 붉은·푸른·보라 세 방울을 아주 옅게
                    얹는다(알파 0.05~0.07). 색은 디자인 토큰을 쓴다 — 이 화면의 세 갈래
                    (말 파랑 · 음악 자주 · 순서 보라)와 같은 색이라 한 제품으로 읽힌다.

                    **네모가 안 생기게 하는 법**(방송화면에서 데인 것과 같은 자리):
                     · 그릇에 `overflow-hidden` + 둥근 모서리 → 모서리 밖으로 안 샌다
                     · 레이어를 그릇보다 키운다(`-inset-[40%]`) → 어느 순간에도 가장자리가 밖
                     · `scale` 을 안 쓴다 → 크기가 변하면 그 순간 네 변에 띠가 생긴다
                    `radial-gradient` 는 가장자리가 투명으로 끝나므로 경계선 자체가 없다.

                    **글자·단추를 안 덮는다** — `isolate` 로 층을 따로 만들고 이 레이어만
                    `-z-10` 으로 내린다. `pointer-events-none` 이라 클릭도 그대로 지난다.
                    **움직임 줄이기**에서는 `motion-safe:` 가 안 걸려 **정지한 옅은 그라디언트**만
                    남는다(색은 그대로 보인다 — 안 보이면 강조가 사라진 것과 같다).
                    블러·새 라이브러리는 안 쓴다. 도는 것은 `transform` 둘뿐이라 저사양에서도 싸다. */}
                {isNext && (
                  <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                    <span className="absolute -inset-[40%] motion-safe:animate-[cc-row-a_24s_ease-in-out_infinite]"
                      style={{ backgroundImage:
                        'radial-gradient(38% 120% at 18% 50%, rgba(37,99,235,.07), rgba(37,99,235,0) 70%),'
                        + 'radial-gradient(34% 120% at 78% 45%, rgba(176,58,122,.06), rgba(176,58,122,0) 70%)' }} />
                    <span className="absolute -inset-[40%] motion-safe:animate-[cc-row-b_31s_ease-in-out_infinite]"
                      style={{ backgroundImage:
                        'radial-gradient(32% 120% at 52% 55%, rgba(109,40,217,.06), rgba(109,40,217,0) 70%)' }} />
                  </span>
                )}
                {/* **시각은 이름과 같은 크기다**(사용자 지적 2026-09-13: *"시간도 너무 글씨크기가
                    작은데 좀 더 크게 해줬으면 좋겠어 옆에 텍스트 처럼"*).
                    13px 이라 옆의 방송 이름(16px)보다 작았는데, 이 목록에서 **먼저 읽는 것은
                    시각**이다("지금 몇 시 방송을 보고 있나"). 먼저 읽는 것이 더 작으면 눈이
                    이름으로 먼저 가고 시각은 확인하러 되돌아가야 한다.
                    `tabular-nums` 는 그대로 둔다 — 없으면 자릿수마다 폭이 2.5px 씩 흔들려
                    세로로 안 맞는다(Pretendard 실측). */}
                <time className={'t-body tabular-nums ' + (isNext ? 'font-semibold text-ds-v3-ink' : 'text-ds-v3-ink-3')}>
                  {r._isGroup ? `${r.time}~${r._time_end}` : r.time}
                </time>
                {/* ── 꼬리표는 **안 그린다** (사용자 지시 2026-09-14) ─────────────────
                    「자동」·「안내방송」 같은 유형 꼬리표를 간편화면에서는 뺀다. 앞으로 옮기는
                    안이 아니라 **제거**가 최종 요구다. 목록에서 사람이 찾는 것은 *"몇 시에
                    무엇이 나가나"* 이고, 유형은 그 물음에 답하지 않으면서 이름 칸을 갉아먹고
                    상태 칸을 밀어냈다(PC 실측).
                    **표시만 빠진다** — 방송 유형·예약 데이터는 그대로다. 유형이 필요한
                    자리(캘린더·설정)는 안 건드린다. */}
                {/* ── 좁은 화면에서는 **이름과 상태가 한 줄에 나란히** 선다 ──────────
                    `tablet:contents` 가 넓은 화면에서 이 그릇을 **레이아웃에서 지운다** —
                    그러면 안의 둘이 원래대로 격자의 제 칸을 찾아간다. 그래서 넓은 화면
                    배치는 한 글자도 안 바뀐다. 그릇을 새로 만들지 않고 **좁을 때만** 쓴다. */}
                <div className={'col-start-1 row-start-2 flex min-w-0 items-baseline gap-2 ' + 넓게('tablet:contents')}>
                <span className={'flex min-w-0 items-center ' + 넓게('tablet:col-start-2')}>
                  {/* 좁은 화면에서는 **자르지 않고 접는다**(2026-09-14 실측). 이름 칸이
                      76px 라 「아침 종합 방송」이 「아침 종합 …」으로 잘렸다 — 방송 이름은
                      이 목록에서 사람이 찾는 두 가지 중 하나라 잘리면 목록의 뜻이 준다.
                      두 줄이 되는 대신 다 보인다. 넓은 화면은 한 줄로 자르던 그대로다.

                      **`break-words` 로는 모자랐다**(360px 실측). 두 가지가 겹쳤다:
                       · 이 화면은 `word-break: keep-all` 이라 「국민체조」가 **한 낱말**이다.
                       · flex 항목은 `min-width:auto` 라 내용보다 **안 줄어든다**(55px 고집).
                      그래서 칸이 46px 인데 글자가 55px 로 삐져나와 잘렸다.
                      `min-w-0` 으로 줄어들게 하고, `break-all` 로 낱말 안에서도 접는다.
                      넓은 화면은 `tablet:break-normal` 로 되돌려 예전 그대로 한 줄에 자른다. */}
                  <span className={'min-w-0 break-all tablet:break-normal tablet:truncate '
                    + (isNext ? 'font-semibold text-ds-v3-ink' : 'text-ds-v3-ink-2')}>
                    {r.kind === 'auto' && canTriggerRow(r) ? (
                      <button type="button" aria-expanded={expanded === r.id} aria-controls={`today-steps-${r.id}`}
                        className="inline-flex min-h-[44px] items-center gap-1 text-left"
                        onClick={() => { setStepState({}); setExpanded(expanded === r.id ? null : r.id) }}>
                        {r.label}<ChevronDown size={14} className={expanded === r.id ? 'rotate-180 shrink-0' : 'shrink-0'} />
                      </button>
                    ) : r.label}
                  </span>
                </span>
                {/* **「안 나감」을 '다음'으로 덮지 않는다.**
                    09:10 이 안 나가고 09:20 이 남은 묶음은 한 줄로 접히고, 그 줄이 곧 "다음"이다.
                    상태 칸을 '다음'으로만 쓰면 **빨간 「안 나감」이 목록에서 사라진다** —
                    머리줄 숫자("1건 안 나감")를 따로 읽어야만 안 나간 사실을 알게 된다.
                    R4 는 바닥글만 고쳤고 이 칸이 남아 있었다(V② 적대 검수 2026-09-13).
                    둘 다 참이면 **둘 다 적고, 색은 누락 쪽을 쓴다** — 안 나간 사실이 먼저다. */}
                <span className={'shrink-0 whitespace-nowrap t-sub '
                  + 'tablet:col-auto tablet:justify-self-auto '
                  + (r.status === 'missed' ? STATUS.missed.cls
                     : isNext ? 'font-semibold text-ds-v3-flow' : st.cls)}>
                  {isNext && r.status === 'missed' ? '안 나감 · 다음'
                    : isNext ? '다음' : st.label}
                </span>
                </div>

                {/* ── 수동 조작은 **한 칸에 모은다** (사용자 지시 2026-09-14) ────────────
                    차수 단추(1차·2차)가 상태 칸 안에 있어서 **상태 글자를 왼쪽으로 밀어냈다**
                    — 환기방송 줄만 「완료」의 자리가 다른 줄과 어긋나 보였다(PC 사진).
                    일반 ▶ 와 차수 단추는 하는 일이 같다(지금 내보내기). 같은 일은 같은 칸에.
                    세로 중심과 높이를 맞추려고 한 그릇에 담아 `justify-end` 로 오른쪽에 건다. */}
                {/* 좁은 화면에서는 **둘째 칸**이다(격자가 두 칸이라) — 두 줄에 걸쳐 선다.
                    그래서 이름이 한 줄이든 두 줄이든 단추는 늘 세로 가운데에 있다. */}
                <span className={'col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-1.5 '
                  + 'tablet:col-auto tablet:row-auto'}>
                  {/* ── 묶음은 **차수가 곧 단추**다 (V③ ENTRY-R1, HIGH, 2026-09-14) ──────
                      묶음 줄은 `todayRows` 가 `id` 를 안 싣고 `canTriggerRow` 가 그것을
                      거절해서 아래 ▶ 가 안 붙는다. 그건 옳다 — **줄 통째로는 1차인지 2차인지
                      모른다.** 그렇다고 길이 없으면 안 된다: 현장 예약 6건이 전부 환기방송
                      3쌍이라, 안 나간 회차를 손으로 다시 낼 길이 **하나도 없어진다.**
                      (`/calendar` 의 「지금 방송」은 `_isAuto` 전용이다 — 내가 한 번 그것을
                      대체 경로로 잘못 세었고 검수관이 실행으로 잡았다.)

                      **사람이 차수를 직접 고른다** — 옛 화면과 같은 규칙이다
                      (`ScheduledBroadcastMini` 가 "다음 차수를 골라 주는" 버튼을 없앤 이유와
                      같다: 골라 주면 2차만 다시 내야 할 때 1차가 나간다).
                      발사 경로는 새로 안 만든다 — 아래 ▶ 와 **같은 `setAsk` 문**을 지난다(G-42). */}
                  {r._isGroup && r._items.map((item, idx) => (
                    <button key={item.id ?? idx} type="button"
                      onClick={(e) => { e.stopPropagation(); setAsk({ ...item, label: `${item.label} ${idx + 1}차` }) }}
                      aria-label={`${item.label} ${idx + 1}차 (${item.time}) 지금 내보내기`}
                      title="지금 내보내기"
                      /* 손가락에는 hover 가 없다 — 좁은 화면에서 44px(G-15).
                         넓은 화면은 ▶(34px)와 **같은 높이**로 맞춘다 — 한 칸에 나란히 서므로
                         높이가 다르면 그 줄만 들쭉날쭉해진다. */
                      className={'inline-flex h-11 min-w-11 items-center justify-center rounded-md px-2 '
                        + 'tablet:h-[34px] tablet:min-w-[38px] t-sub font-semibold '
                        + 'border border-ds-v3-line bg-white/[.66] transition-colors btn-press '
                        + 'hover:text-ds-v3-ink-2 hover:border-ds-v3-ink-2/40 '
                        + (item.status === 'done' ? 'text-ds-v3-ink-3' : 'text-ds-v3-ink-2')}>
                      {item.status === 'done' ? '✓' : ''}{idx + 1}차
                    </button>
                  ))}
                {/* **지금 내보내기.** 사용자 지시로 되살렸다 — 예전에 독립검수가
                    "라벨과 동작이 다르다"고 잡았을 때 **라벨이 아니라 기능을 없애는 쪽으로**
                    풀어서 요구받은 버튼이 사라져 있었다.
                    새 발사 경로를 만들지 않는다 — `lib/broadcastTrigger` 가 기존 것을 부른다.
                    아이콘만으로 발사하지 않는다 — 누르면 **확인 한 단계**가 먼저 선다(G-42).
                    평소엔 흐리고 줄에 손이 닿거나 「다음」 줄이면 또렷해진다. **좁은 화면에서는
                    늘 또렷하다** — 손가락에는 hover 가 없다(목업 `.play`). */}
                {canTriggerRow(r) && (
                  <button type="button"
                    onClick={() => setAsk(r)}
                    aria-label={`${r.label} 지금 내보내기`}
                    title="지금 내보내기"
                    /* **좁은 화면에서는 44px**(G-15, 8단계 2026-09-13). 390px 실측에서
                       34px 이었다 — 손가락에는 hover 가 없고 이 줄은 스크롤 중에 누른다.
                       키워도 잘못 나가지 않는다: 누르면 **확인 한 단계**가 먼저 선다(위 G-42).
                       확인창이 없었다면 키우는 쪽이 오히려 위험했을 자리다.
                       마우스가 있는 넓은 화면에서는 34px 그대로 — 줄이 촘촘해야 한눈에 든다. */
                    className={'inline-flex h-11 w-11 items-center '
                      + 'tablet:h-[34px] tablet:w-[34px] '
                      + 'justify-center rounded-full text-ds-v3-ink-3 transition '
                      + 'hover:bg-white/90 hover:text-ds-v3-ink focus-visible:opacity-100 '
                      + (isNext ? 'opacity-100' : 'opacity-100 tablet:opacity-40 tablet:group-hover:opacity-100')}>
                    <Play size={15} fill="currentColor" strokeWidth={0} />
                  </button>
                )}
                </span>
                {r.kind === 'auto' && expanded === r.id && (
                  <div id={`today-steps-${r.id}`} className="col-span-full py-2 space-y-2">
                    <p className="text-sm text-ds-v3-ink-2">고른 단계부터 남은 순서를 재생합니다. 해당 단계의 처음부터 시작합니다.</p>
                    {stepState.tab !== r.id ? <p role="status">단계를 불러오는 중…</p>
                      : stepState.error ? <p role="alert">단계를 불러오지 못했습니다. 접었다가 다시 열어 주세요.</p>
                      : (() => {
                        // ── **자동순서 편집기처럼 색·그림·BGM 선** (사용자 지시 2026-09-17 N19) ─────────
                        // *"설마 저렇게 디자인할거야? 색이라도 세번쨰 자동순서편집처럼 넣어줘야지 구분이 가지
                        //   음원인지 TTS인지 어떻게 구분할거여 bgm은 연결되는지 옆에 … 선으로"*
                        // 종류·BGM 구간은 편집기와 **같은 함수**(`lib/bgmLane`)라 두 화면의 색이 갈리지 않는다.
                        const 선 = bgmCoverage(stepState.steps, 배경음악표)
                        return (
                          <>
                          <ol className="m-0 list-none p-0 space-y-1.5">{stepState.steps.map((step, i) => {
                            const kind = stepKindOf(step, 단계표)
                            const style = KIND_STYLE[kind] || KIND_STYLE.plain
                            const Icon = style.icon
                            const cov = 선[i]
                            return (
                              <li key={`${step.id}-${step.index}`}
                                className={'relative flex items-center gap-2.5 rounded-[14px] py-1.5 pl-4 pr-1.5 ' + style.bg + (step.enabled ? '' : ' opacity-60')}>
                                {cov && <span aria-hidden="true" className={'absolute left-1 w-[3px] bg-ds-v3-bgm '
                                  + (cov.startsWith('start') ? 'top-2.5 rounded-t-full ' : 'top-0 ')
                                  + (cov.includes('end') ? 'bottom-2.5 rounded-b-full ' : 'bottom-0 ')
                                  + (cov.startsWith('paused') ? 'opacity-30' : 'opacity-80')} />}
                                <span className={'grid h-6 w-6 shrink-0 place-items-center rounded-full t-sub font-semibold text-white tabular-nums ' + style.solid}>{step.index + 1}</span>
                                {Icon && <span className={'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/75 ' + style.text}><Icon size={13} aria-hidden="true" /></span>}
                                <span className="min-w-0 flex-1 break-words text-sm">{step.label}{!step.enabled && ' · 사용 안 함'}</span>
                                <button type="button" disabled={!step.enabled || busy}
                                  className="shrink-0 min-h-[44px] rounded-full bg-white/80 px-3 text-sm font-semibold text-ds-v3-tts disabled:opacity-40"
                                  onClick={() => setAsk({ ...r, startIndex: step.index, startStepId: step.id, stepLabel: step.label })}>
                                  여기부터 재생
                                </button>
                              </li>
                            )
                          })}</ol>
                          {선.some(Boolean) && (
                            <p className="m-0 flex items-center gap-1.5 t-sub text-ds-v3-ink-3">
                              <span aria-hidden="true" className="h-3.5 w-[3px] rounded-full bg-ds-v3-bgm" />
                              왼쪽 선이 이어진 단계에는 배경음악이 함께 나와요
                            </p>
                          )}
                          </>
                        )
                      })()}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        </>
      )}

      <div className="mt-2 flex flex-wrap justify-between gap-3 px-1.5 pt-1 t-sub text-ds-v3-ink-3 tablet:px-2.5">
        {/* 묶음의 첫 시각이 아니라 **그 항목의 시각**을 적는다 — 09:10 이 이미 나갔는데
            "다음 09:10" 이라고 말하면 안 된다. */}
        <span>
          {못보낸것
            ? <b className="font-semibold text-ds-v3-bgm" role="alert">내보내지 못했습니다 — {못보낸것}</b>
            : 보낸것
            ? <b className="font-semibold text-ds-v3-tts" role="status">{보낸것} 방송을 지금 내보냈습니다.</b>
            : nextItem ? `다음 ${nextItem.time} ${nextItem.label}` : '오늘 남은 방송 없음'}
        </span>
        <button type="button" onClick={() => onNavigate('/calendar')}
          className="min-h-[44px] px-2 font-semibold text-ds-v3-ink-2 hover:text-ds-v3-ink hover:underline">
          전체 예약 관리
        </button>
      </div>

      {/* 되돌릴 수 없는 것 앞의 확인 한 단계(G-42). **무엇이·어디로·지금**을 적는다 —
          "이 방송을 실행할까요?" 같은 문장은 어디로 나가는지 안 말해 준다.
          조사를 `을(를)` 로 적지 않는다 — 사람이 읽는 문장이다. 뒤를 **"방송을"** 로 받으면
          받침을 따질 일이 없어진다. */}
      <ConfirmDialog
        open={!!ask}
        title="지금 내보낼까요?"
        body={ask ? ask.startIndex === undefined
          ? `「${ask.label}」 방송을 지금 전관 스피커로 내보냅니다.`
          : `「${ask.label}」의 ${ask.startIndex + 1}단계 「${ask.stepLabel}」부터 남은 순서를 지금 전관 스피커로 내보냅니다.` : ''}
        경고="한 번 나간 방송은 되돌릴 수 없습니다."
        confirmLabel="지금 방송"
        busy={busy}
        onClose={() => { if (!busy) setAsk(null) }}
        onConfirm={async () => {
          if (busy || !ask) return
          setBusy(true)
          const 이름 = ask.label
          try {
            await triggerRow(ask)
            set보낸것(이름)
            setTimeout(() => set보낸것(''), 8000)
          } catch (e) {
            // **조용히 실패하지 않는다.** 안 나갔는데 나간 줄 알면 그게 이 저장소에서
            // 가장 비싼 실패다. 사유를 그 자리에 남긴다(브라우저 경고창을 쓰지 않는다 —
            // 그 문구는 우리가 못 고치고, 무엇이 안 나갔는지 못 적는다).
            set보낸것('')
            set못보낸것(`${이름} — ${e.message}`)
            setTimeout(() => set못보낸것(''), 12000)
          } finally {
            setBusy(false)
            setAsk(null)
          }
        }}
      />
    </section>
  )
}
