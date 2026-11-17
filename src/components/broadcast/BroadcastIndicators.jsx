// 방송 중임을 사람에게 알리는 껍데기 UI 모음 — App.jsx에서 갈라져 나왔다.
//
// 방송 중 배지·토스트·가림막 오버레이·소리 활성화 안내·연결 끊김 오버레이. 서로 상태를
// 나누지 않고 이벤트만 듣는 표시물이라, 방송 재생 로직과 한 파일에 있을 이유가 없었다.
// 붙는 자리(App의 JSX 순서)는 그대로다 — 순서가 곧 겹쳐 그리는 순서다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Radio } from 'lucide-react'
import { stopBroadcast as stopBroadcastAPI, getOrgInfo } from '../../lib/api'
import { 글자배율, 크기곱, 방송글자줄바꿈 } from '../../lib/broadcastTextSize'
// 소리 자물쇠를 여는 **단 하나의 함수**. 띠와 훅이 같은 것을 부른다(사용자 신고 2026-09-15).
import { unlockAudio } from '../../hooks/useAudioListener'
import { skyKeyAt, SKY, blobLayer } from '../../lib/skyPalette'
import OutlinedText from './OutlinedText'

// 방송 중 알림 + 즉시 정지 버튼
export function BroadcastNowPlaying({ nowPlaying }) {
  const [stopping, setStopping] = useState(false)

  const handleStop = async () => {
    setStopping(true)
    await stopBroadcastAPI().catch(() => {})
    window.dispatchEvent(new CustomEvent('carecast:stop-broadcast'))
    setStopping(false)
  }

  if (!nowPlaying) return null
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2.5
                    bg-ds-v3-warn text-white px-4 py-2 rounded-full shadow-lg pointer-events-auto">
      <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0" />
      <span className="text-sm font-semibold whitespace-nowrap">방송 중</span>
      <button
        onClick={handleStop}
        disabled={stopping}
        className="px-3 py-0.5 bg-white/25 hover:bg-white/40 rounded-full text-xs font-medium
                   transition-colors disabled:opacity-60 whitespace-nowrap"
      >
        {stopping ? '정지 중...' : '정지'}
      </button>
    </div>
  )
}

// 예약 방송 토스트 알림 UI
export function BroadcastToast({ toast }) {
  if (!toast) return null
  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm bg-white border border-ds-v3-tts/30
                    rounded-[14px] shadow-lg px-4 py-3.5 flex gap-3 items-start animate-fade-in">
      <span className="text-ds-v3-tts mt-0.5 text-lg">📢</span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-ds-v3-ink">{toast.title}</p>
        <p className="text-xs text-ds-v3-ink-2 mt-0.5 line-clamp-2">{toast.content}</p>
      </div>
    </div>
  )
}

// 하늘 팔레트는 `src/lib/skyPalette.js` 한 곳에 있다 — **시각이 색을 정한다**.
// 여기 있던 것은 서로 무관한 사탕색 그라디언트 10개였고 **무작위로** 골랐다
// (민트→라임, 노랑→하늘, 황금→오렌지…). 색이 아무것도 가리키지 않았고, 더 나쁜 것은
// **같은 시각에 볼 때마다 다른 색**이었다는 점이다 — 홀에 하루 종일 켜져 있는 화면이다.
// 지금은 07:50 아침 방송이 일출빛, 18:00 저녁 마무리 방송이 석양빛이라 **화면이 일과를 말한다**.

// 밝은 하늘 위의 흰 글씨는 **`OutlinedText` 하나로만** 그린다(2026-09-13).
// 이 파일에 있던 `outline()` 헬퍼(획 하나 + 그림자)는 걷었다 — 값으로 맞추는 방법이라
// 글자가 커질수록 흰 속이 회색으로 먹혔다. 왜 두 겹이어야 하는지는 그 파일 머리말에 있다.


// 방송 중 화면 가림막 오버레이 — 정규 스케줄 방송 시 자동 표시 (ESC/X로 닫기)
export function BroadcastOverlay() {
  const [show, setShow]   = useState(false)
  const [bcastTitle, setBcastTitle] = useState('')
  const [bcastTab,   setBcastTab]   = useState('')
  const [nowPlaying, setNowPlaying] = useState('')
  // 자막이 나가는 동안에는 고정 문구를 비운다. 자막은 자기 층(BroadcastCaption, z-10000)에서
  // 그리는데, 그 자리에 기관 표어가 그대로 있으면 두 글씨가 겹친다.
  const [captioning, setCaptioning] = useState(false)
  // 기관 이름·표어. **코드에 박아 두지 않는다** — 여기가 남의 기관 이름인 채로 홀 TV에
  // 걸리면 그것만으로 못 쓴다(도입 가이드 4-2). 서버 설정에서 받아 오고, 비어 있으면
  // 그 줄을 안 그린다.
  //
  // **한 번만 읽으면 안 된다**(2026-09-10 현장 신고, 재현함). 예전엔 마운트 때 한 번 읽고
  // `.catch(() => {})` 로 삼켰다 — 그 한 번이 어긋나면 **그 페이지가 살아 있는 내내** 빈
  // 채로 남아, 홀 TV에 `ON AIR` 와 배지만 뜨고 기관명·표어가 영영 안 나온다. 서버는 멀쩡한데도.
  // 현장 PC는 자동 업데이트마다 스스로 새로고침하므로(useConnectionWatch) 그 순간 한 번만
  // 끊겨도 하루 종일 그 상태다. 조용한 실패가 홀 TV에 그대로 걸리는 자리다.
  const [org, setOrg] = useState({ name: '', slogan: '', textSize: 'large' })
  // 값을 이미 손에 넣었나. 이벤트 처리기가 읽어야 해서 ref 로도 들고 있는다
  // (그 처리기는 한 번만 붙으므로 state 를 읽으면 첫 값에 묶인다 — 아래 showRef 와 같은 이유).
  const orgReadyRef = useRef(false)
  // 지금이 하루의 어느 마디인가(`lib/skyPalette.js`). **무작위가 아니라 시각이 정한다.**
  // **ref 가 아니라 상태다** — 렌더가 이 값을 읽으므로, ref 로 두면 값이 바뀌어도 React 가
  // 다시 그릴 의무가 없다.
  const [skyKey, setSkyKey] = useState(() => skyKeyAt())

  // 마디가 넘어가는 것을 화면이 스스로 따라간다. 이 화면은 몇 시간씩 열려 있으므로,
  // 열 때 한 번만 정하면 **낮에 연 화면이 저녁 마무리 방송 때까지 낮빛으로 남는다.**
  // 1분 간격이면 경계(08:30·16:30 …)를 최대 1분 늦게 넘는데, 색이 서서히 바뀌는 것이
  // 아니라 마디가 바뀌는 것이라 사람 눈에는 그 정도가 보이지 않는다.
  useEffect(() => {
    const t = setInterval(() => setSkyKey(skyKeyAt()), 60_000)
    return () => clearInterval(t)
  }, [])

  // 한 번 읽어 오면 끝. **못 읽으면 다시 시도한다.** 방송이 나가는 중에 글자가 없는 것보다
  // 몇 초 늦게라도 뜨는 편이 낫다. 무한히 두드리지 않는다 — 설정이 정말 비어 있는 기관도 있고
  // (그때는 서버가 빈 문자열을 정상 응답으로 준다) 그 경우는 **성공**이라 재시도가 멈춘다.
  // `다시({ 다시읽기: true })` 면 **이미 읽었어도 새로 읽는다** (2026-09-13).
  // 그전에는 `orgReadyRef` 가 서면 영영 안 읽었다. 그래서 설정에서 기관 이름을 저장해도
  // 이 창은 **빈 값을 계속 들고 있었다** — 사용자 지적: *"기관정보 저장했잖아 왜 안 나와"*.
  // 재시도 사다리(아래)는 그대로 «못 읽었을 때만» 두드린다. 강제 조회는 그것과 별개다.
  const 기관읽기 = useCallback(({ 다시읽기 = false } = {}) => {
    if (orgReadyRef.current && !다시읽기) return Promise.resolve()
    return getOrgInfo()
      .then(d => {
        orgReadyRef.current = true          // 빈 값이어도 "읽었다" — 그 기관은 설정을 안 넣은 것이다
        setOrg({ name: d?.name || '', slogan: d?.slogan || '', textSize: d?.textSize || 'large' })
      })
      .catch(() => { /* 못 읽어도 방송은 그대로 나간다. 아래에서 다시 시도한다 */ })
  }, [])

  // 설정에서 저장하면 서버가 SSE 로 알린다 — **다른 창·다른 PC 에서 저장해도** 여기가 바뀐다.
  // 값을 그대로 받아 쓴다(다시 조회하지 않는다): 서버가 방금 저장한 것을 실어 보내므로
  // 한 번 더 물으면 왕복만 늘고, 그 사이에 또 바뀌면 되레 옛 값을 덮어쓸 수 있다.
  useEffect(() => {
    const onOrg = (e) => {
      const d = e.detail || {}
      orgReadyRef.current = true
      setOrg({ name: d.name || '', slogan: d.slogan || '', textSize: d.textSize || 'large' })
    }
    window.addEventListener('carecast:org-info', onOrg)
    return () => window.removeEventListener('carecast:org-info', onOrg)
  }, [])

  useEffect(() => {
    let 살아있음 = true
    const 지연 = [0, 2000, 5000, 15000, 60000]   // 마지막은 1분마다가 아니라 1분 뒤 한 번 더
    let i = 0
    let timer = null
    const 한번 = () => {
      기관읽기().then(() => {
        if (!살아있음 || orgReadyRef.current || i >= 지연.length - 1) return
        i += 1
        timer = setTimeout(한번, 지연[i])
      })
    }
    한번()
    return () => { 살아있음 = false; if (timer) clearTimeout(timer) }
  }, [기관읽기])
  // 지금 깔린 가림막을 **자막 때문에** 깔았는가. 그렇다면 자막이 걷힐 때 같이 걷는다.
  // 사람이 연 것(📡 방송 화면)과 정규 5종이 깐 것은 안 건드린다 — 그건 사람이 ESC로 닫는다.
  const byCaptionRef = useRef(false)
  // 이벤트 처리기는 한 번만 붙으므로(아래 [] 의존), 그 안에서 show를 읽으면 첫 값에 묶인다.
  const showRef = useRef(false)

  useEffect(() => {
    // **열리는 순간 한 번 더 읽는다.** 재시도 사다리가 끝난 뒤에 방송이 시작될 수도 있고,
    // 글자가 가장 필요한 때가 바로 이때다. 이미 읽었으면 아무 일도 안 한다.
    const onShow   = (e) => {
      // **열 때마다 새로 읽는다**(2026-09-13). 이 창이 뜨기 전에 설정이 바뀌었을 수 있고,
      // 글자가 가장 필요한 때가 바로 지금이다. SSE 를 놓친 창(뒤늦게 연결된 창)도 여기서 맞춰진다.
      기관읽기({ 다시읽기: true })
      setSkyKey(skyKeyAt())
      byCaptionRef.current = false
      setBcastTitle(e.detail?.title || ''); setBcastTab(e.detail?.tab || '')
      setNowPlaying(''); setShow(true)
    }
    const onHide   = () => { byCaptionRef.current = false; setShow(false); setNowPlaying('') }
    const onUpdate = (e) => setNowPlaying(e.detail?.nowPlaying || '')
    const onKey    = (e) => { if (e.key === 'Escape') setShow(false) }
    // 자막이 실제로 떠 있는지는 BroadcastCaption이 정한다(거기가 시계를 쥐고 있다).
    //
    // 자막이 나가면 가림막도 같이 깐다. 자막만 뜨고 뒤에 관리자 화면이 그대로 비치면 글자가
    // 어디 있는지 안 읽힌다(사용자 지적 2026-09-05). 여기서는 방송 **이름**으로 고르지 않는다
    // — 자동방송 5종이 아닌 예약·기상특보도 자막이 나가면 같은 화면이어야 한다.
    const onCaption = (e) => {
      const active = !!e.detail?.active
      if (active) 기관읽기()          // 자막 경로로 열릴 때도 같은 규칙
      setCaptioning(active)
      if (active) {
        if (showRef.current) return          // 이미 깔려 있으면 그대로 둔다
        setSkyKey(skyKeyAt())
        byCaptionRef.current = true
        setBcastTitle(''); setBcastTab(''); setShow(true)
      } else if (byCaptionRef.current) {
        byCaptionRef.current = false
        setShow(false); setNowPlaying('')
      }
    }

    window.addEventListener('carecast:overlay-show',   onShow)
    window.addEventListener('carecast:overlay-hide',   onHide)
    window.addEventListener('carecast:overlay-update', onUpdate)
    window.addEventListener('carecast:caption-state',  onCaption)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('carecast:overlay-show',   onShow)
      window.removeEventListener('carecast:overlay-hide',   onHide)
      window.removeEventListener('carecast:overlay-update', onUpdate)
      window.removeEventListener('carecast:caption-state',  onCaption)
      window.removeEventListener('keydown', onKey)
    }
  }, [기관읽기])

  // 자막 층은 밑에 오버레이가 깔렸는지에 따라 모습을 바꾼다(그라디언트 위 = 배경 없이 큰 글씨,
  // 무음 영상 위 = 아래쪽 검정 띠). 그 판단의 단일 출처가 여기다.
  useEffect(() => {
    showRef.current = show
    window.dispatchEvent(new CustomEvent('carecast:overlay-state', { detail: { visible: show } }))
  }, [show])

  // ── 떠 있는 손잡이 — **색을 쓰지 않는다** (2026-09-13) ──────────────────────
  // 예전엔 `bg-ds-v3-ink-2` 이었다. 주황은 이 제품의 색 셋(말=파랑·음악=자주·순서=보라)
  // 어디에도 없는 **넷째 색**이었고, 하루에 몇 번 안 쓰는 단추가 화면에서 제일 튀었다.
  // 목업의 주 동작도 색이 아니라 잉크다(v3.html:85 `.btn.primary{background:var(--ink)}`).
  //
  // 이모지(📡)도 걷었다 — 기기·글꼴마다 모양이 갈리고, 아이콘이 같은 뜻을 더 조용히 한다(G-38).
  // 타격 크기는 44px 로 올렸다(G-15) — 주 사용자가 50~60대이고 현장 PC 는 터치일 수 있다.
  // ── 좁은 화면에서는 **글자를 접는다** (사용자 지시 2026-09-14) ────────────────
  // 이 단추는 `fixed` 라 목록 위에 그대로 얹힌다. 390px 에서 폭이 108px 이었고,
  // 하필 **환기방송 줄의 「1차·2차」 단추를 덮었다**(실측: 단추 오른쪽 끝 336px,
  // 이 단추 왼쪽 262px). 덮인 것이 **누르는 자리**라는 게 문제다 — 보기 나쁜 것과
  // 못 누르는 것은 다른 일이다.
  //
  // 그래서 좁은 화면에서는 **동그란 아이콘 하나**(44px)로 줄이고 오른쪽 끝으로 붙인다.
  // 44px 는 G-15 의 하한이라 더 줄이지 않는다. 글자가 빠지는 대신 `aria-label` 이
  // 같은 말을 남긴다 — 보조기술에서는 아무것도 안 줄어든다.
  // 넓은 화면은 예전 그대로다(거기서는 목록이 이 단추에 안 닿는다).
  if (!show) return (
    <button
      onClick={() => setShow(true)}
      className="fixed bottom-[96px] right-2 z-[9998] flex h-11 min-h-[44px] w-11 cursor-pointer
                 select-none items-center justify-center gap-2 rounded-full bg-ds-v3-ink t-sub
                 font-semibold text-white shadow-lg transition-all hover:bg-black active:scale-95
                 tablet:bottom-[140px] tablet:right-5 tablet:h-auto tablet:w-auto tablet:px-4"
      aria-label="방송 화면 열기"
      title="방송 화면 열기"
    >
      <Radio size={16} aria-hidden="true" />
      <span className="hidden tablet:inline">방송 화면</span>
    </button>
  )

  // 배지에 쓰는 짧은 이름. **자동방송 5종의 식별자로 찾는다** — 예전에는 서버가 보낸 제목
  // 글자를 열쇠로 썼는데, 서버(broadcastSequencer의 LANES)에서 제목을 한 자만 고치면 여기가
  // 조용히 안 맞아 긴 제목이 그대로 나왔다. 못 찾으면 서버가 보낸 제목을 그대로 쓴다.
  const TAB_LABEL = {
    morning:        '🌅 아침 방송',
    exercise:       '🏃 국민체조',
    lunch:          '🍱 점심 방송',
    dinner:         '🍚 저녁 방송',
    evening_prayer: '🌇 저녁 마무리',
  }

  const 하늘 = SKY[skyKey]
  // **글자는 늘 흰색이다.** 옅은 아침 하늘 위에서도 마찬가지 — 버티는 것은 배경이 아니라
  // 글자에 두른 **검정 획 테두리**(`outline`)다. 그게 이 장치의 존재 이유다.
  // 한때 옅은 하늘에서만 먹색으로 돌리는 갈래를 뒀다가 걷었다(사용자 지적 2026-09-13:
  // *"먹색하지말고 테두리만 씌우면 되잖아"*) — 색이 시간대마다 뒤집히면 같은 화면이
  // 아니게 되고, 자막(흰색 고정)과도 따로 논다. 한 가지로 가는 쪽이 맞다.

  return (
    // **글자를 가운데보다 조금 위에 둔다**(사용자 결정 2026-09-13, 두 번 고쳐서 여기 왔다).
    // 정가운데면 넓은 홀 TV 에서 시선이 화면 한복판에 꽂히는데 어르신들은 대개 TV 를
    // **올려다본다** — 눈높이는 그보다 위다. 그래서 처음엔 위에 붙였다(`pt-[12vh]`).
    // 그랬더니 **화면 위쪽에 박히고 아래 3분의 2가 통째로 비었다**(*"이번엔 너무 상단이다"*).
    //
    // 지금은 **가운데 정렬한 뒤 아래 여백만큼 들어올린다.** 고정 `pt` 와 달리 글자가
    // 한 줄이든 두 줄이든 덩어리의 **한가운데가 같은 자리**에 온다 — 기관명만 있는 곳과
    // 표어까지 있는 곳이 같은 높이로 보인다. 자막은 제 층에서 정가운데다(`BroadcastCaption`).
    //
    // **들어올리는 양을 16vh → 5vh 로 줄였다** (사용자 지적 2026-09-16: *"자막이 너무
    // 상단으로 올라온 것 같지 않아? 중간쯤 위치해야지"*). 16vh 는 글자를 1.5배로 키우기
    // **전**(09-13)에 맞춘 값이다. 글자가 커지면서 덩어리 자체가 위아래로 길어졌고, 같은 양을
    // 들어올리니 윗줄이 화면 위쪽에 붙었다. 「올려다본다」는 결정은 살리되 거의 가운데다.
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center
                    select-none overflow-hidden pb-[5vh]"
         style={{ backgroundColor: 하늘.base }}>

      {/* ── 구름 — **통합 홈의 물감 두 방울과 같은 기법**이다 ─────────────────────
          팔레트만 다르다(하늘). 셋째 팔레트를 만든 것이 아니라 **한 기법에 두 팔레트**라,
          홈과 이 화면이 한 제품으로 읽힌다.

          **`filter: blur()` 를 쓰지 않는다.** 이 화면은 현장 PC 에서 하루 종일 전체화면으로
          켜져 있고, 그 PC 는 내장 그래픽이다. `radial-gradient` 자체가 이미 부드러운 번짐이라
          필터 없이 같은 그림이 나온다. 움직임은 `transform` 으로만 준다 — GPU 가 싸게 한다.

          `motion-safe:` 로만 건다. 움직임을 줄이도록 설정한 기기에서는 서 있고,
          **그래도 하늘은 그대로 보인다** — 움직임이 정보를 나르지 않기 때문이다. */}
      {/* **그릇을 화면보다 키운다**(`-inset-[22%]`). 레이어가 `inset-0` 이면 화면과 크기가
          같아서, 조금만 움직여도 **밀린 반대편이 비어** 바탕색이 사각형으로 드러난다.
          22% 여유는 이 박자의 최대 이동(5.5%)보다 넉넉히 크다 — 어떤 순간에도 가장자리가
          화면 밖이다. 박자(`cc-sky-*`)에는 `scale` 이 없어 **크기 변화 자체가 없다.**
          둘을 같이 해야 한다: 키우기만 하면 커졌다 작아지는 움직임이 남고, `scale` 만
          빼면 이동한 쪽이 빈다. */}
      {하늘.blobs.map((b, i) => (
        <span key={i} aria-hidden="true"
          className={'pointer-events-none absolute -inset-[22%] '
            + (i % 2 === 0
              ? 'motion-safe:animate-[cc-sky-a_38s_ease-in-out_infinite]'
              : 'motion-safe:animate-[cc-sky-b_47s_ease-in-out_infinite]')}
          style={{ backgroundImage: blobLayer(b) }} />
      ))}

      {/* ── 그늘은 **없다** (사용자 지시 2026-09-14) ──────────────────────────────
          *"아예 시커먼 거 빼버리고 생 그라디언트 위에다가만 올려."*
          `skyPalette` 의 ⑦번 기록이 이미 답이었다 — *"그늘은 처음부터 할 일이 없었다.
          대비는 글자가 스스로 낸다."* 그때 「자막만 예외」로 남긴 한 줄이 같은 덫이었고,
          화면 전체 → 글자 자리로 좁혀 봐도 **여전히 칙칙했다**(실측 화면으로 확인).
          일곱 번째 판을 만들지 않고 **층을 통째로 걷는다.**
          대비는 자막이 제 몫으로 낸다(`OutlinedText` 의 테두리). */}

      {/* 닫기 버튼 */}
      <button onClick={() => setShow(false)}
        className="absolute top-5 right-5 flex min-h-[44px] cursor-pointer items-center gap-1.5
                   rounded-full bg-black/20 px-4 t-sub font-semibold text-white
                   transition-colors hover:bg-black/30"
        title="닫기 (ESC)">
        <X size={16} /> 닫기
      </button>

      {/* ON AIR 배지 — **자막이 나가는 동안에는 같이 비킨다** (사용자 신고 2026-09-14:
          *"가끔씩 ON AIR 이것도 자막이 가리더라"*).
          기관명·표어는 진작 `opacity: 0` 으로 자리를 내주고 있었는데 **이 배지만 안 비켰다.**
          자막은 화면 한가운데에 뜨고 이 배지는 그 바로 위라, 두 줄짜리 자막이 오면 겹친다.
          **같은 판정(`captioning`)을 쓴다** — 판정이 둘이면 언젠가 갈린다. */}
      <div className="mb-8 flex items-center gap-2 transition-opacity duration-500"
           style={{ opacity: captioning ? 0 : 1 }}>
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
        <OutlinedText em={0.12} shadow={false}
                      className="t-sub font-semibold uppercase tracking-[0.25em]">
          On Air
        </OutlinedText>
      </div>

      {/* 메인 텍스트 — 자막이 나가는 동안에는 자막에 자리를 내준다.
          설정이 비어 있으면 통째로 안 그린다(빈 자리가 남지 않게). */}
      {(org.slogan || org.name) && (
        <div className="px-10 text-center transition-opacity duration-500"
             style={{ opacity: captioning ? 0 : 1 }}>
          {/* ── **1.5배로 키웠다** (사용자 요청 2026-09-15: *"문구 기관명도 1.5배"*) ──────
              자막을 키우면서 함께 올렸다. 자막만 키우면 방송이 없을 때 뜨는 이 두 줄이
              상대적으로 작아 보인다 — 홀 TV 는 멀리서 보는 화면이라 그 차이가 크다.
              세 값(최소·화면비례·최대)을 **같은 비율로** 올린다. 하나만 올리면 어떤
              화면 폭에서는 안 커지고, 왜 안 커지는지 찾기 어렵다.
                표어   2.2 → 3.3rem · 6vw   → 9vw    · 4.5 → 6.75rem
                기관명 2   → 3rem   · 5.5vw → 8.25vw · 4   → 6rem */}
          {/* ── **크기는 설정이, 줄바꿈은 낱말이 정한다** (사용자 지시 2026-09-16) ───────
              · *"설정에서 크게, 중간, 작게"* — 세 값(최소·화면비례·최대)에 **같은 배율**을
                곱한다. 하나에만 곱하면 어떤 화면 폭에서는 안 바뀐다(위 1.5배 때와 같은 이유).
              · *"저렇게 화면에 따라 줄틀어지는거 안예쁘잖아"* — 긴 낱말이
                **낱말 한가운데서** 끊겼다. 한국어는 기본 줄바꿈이 **글자 단위**라서다.
                `keep-all` 로 낱말째 넘기고, `balance` 로 두 줄 길이를 고르게 맞춘다
                (한 줄만 길고 다음 줄에 두어 글자가 남지 않게). 화면이 좁아져도 같은 규칙으로 다시 나눈다.
                ※ 이 파일에는 실제 기관 문구를 적지 않는다 — `org-info.test.js` 가 막는다(설정에서만 온다).
              · 한 낱말이 화면보다 긴 드문 경우만 `break-word` 로 끊는다 — 안 그러면 넘친다. */}
          {org.slogan && (
            <OutlinedText as="h1" block className="mb-3 font-black leading-tight"
                          style={{ ...방송글자줄바꿈, fontSize: 크기곱('clamp(3.3rem, 9vw, 6.75rem)', 글자배율(org.textSize)) }}>
              {org.slogan}
            </OutlinedText>
          )}
          {org.name && (
            <OutlinedText as="h2" block className="font-black leading-tight"
                          style={{ ...방송글자줄바꿈, fontSize: 크기곱('clamp(3rem, 8.25vw, 6rem)', 글자배율(org.textSize)) }}>
              {org.name}
            </OutlinedText>
          )}
        </div>
      )}

      {/* ── 아직 안 넣었을 때는 **그렇다고 말한다** (사용자 지적 2026-09-13) ─────────────
          *"여기에 문구랑 기관명이 왜 없냐고"* — 안 넣어서 없는 것이 맞다. 기본값은 일부러
          비워 뒀다(`routes/settings.js` 의 「기관 이름·표어」: 남의 기관 이름을 기본값으로
          두면 설치하자마자 그 이름이 홀 TV 에 걸린다).
          **문제는 비었을 때 화면이 아무 말도 안 했다는 것이다.** 「ON AIR」 넉 자만 뜨니
          설정을 안 한 것인지 고장인지 구별할 수 없다 — 새 PC 를 세팅하는 사람이 가장
          먼저 만나는 화면이 그것이다.
          **작게, 그리고 자막이 나가는 동안에는 숨긴다.** 어르신이 보는 화면이라 크게
          적지 않는다. 값이 들어오면 이 줄은 저절로 사라진다. */}
      {!org.slogan && !org.name && (
        <div className="px-10 text-center transition-opacity duration-500"
             style={{ opacity: captioning ? 0 : 1 }}>
          <OutlinedText em={0.1} block className="t-body font-semibold opacity-80">
            기관 이름과 표어를 아직 넣지 않았습니다
          </OutlinedText>
          <OutlinedText em={0.1} block className="t-sub mt-1.5 opacity-70">
            설정 → 초기 설정 → 1. 기관 정보 에서 넣으면 여기에 나옵니다
          </OutlinedText>
        </div>
      )}

      {/* 방송 종류 배지 — 메인 텍스트와 **같은 규칙**으로 자막에 자리를 내준다.
          자막은 화면 전체를 덮고 세로 가운데로 정렬되는데(BroadcastCaption의 inset-0),
          이 배지는 일반 흐름에 남아 그 한가운데로 들어온다. 그래서 자막 아랫줄과 배지가
          겹쳐 둘 다 안 읽혔다(ISSUE-007, 2026-09-06 현장 화면). 위의 메인 텍스트는 이미
          같은 이유로 비켜 주고 있었는데 배지만 빠져 있었다.
          숨겨도 무엇이 나가는지는 하단 '방송 중' 바가 계속 말해 준다. */}
      {bcastTitle && (
        <div className="mt-10 px-5 py-2 rounded-full bg-white/30 border border-white/40 backdrop-blur-sm
                        transition-opacity duration-500"
             style={{ opacity: captioning ? 0 : 1 }}>
          <OutlinedText em={0.05} className="t-label">
            {TAB_LABEL[bcastTab] || bcastTitle}
          </OutlinedText>
        </div>
      )}

      {/* 하단 「방송 중」 줄.
          **띠를 그리지 않는다.** 예전엔 `bg-black/15 + backdrop-blur` 라 밝은 하늘을
          가로로 잘라 회색 막대가 하나 얹힌 것처럼 보였다(사용자 지적 2026-09-13 —
          가운데 그늘을 걷은 것과 같은 종류다). 지금은 **아래로 스며드는 그늘**이라
          경계선이 없고, 글자는 위 제목과 같은 테두리로 제 힘에 선다.
          blur 도 걷었다 — 화면 가로폭 전체에 하루 종일 걸리는 필터다.

          **스며드는 그늘도 마저 걷었다**(2026-09-13, 두 겹 테두리를 넣은 뒤).
          경계선은 없앴지만 옅은 아침 하늘 위에서는 화면 아래쪽 100px 이 통째로 잿빛으로
          떠 보였다 — 가운데 그늘을 걷은 것과 **같은 이유로 같은 일**을 하고 있었다.
          이제 이 줄의 글자도 위 제목과 같은 두 겹 테두리라 배경 도움이 필요 없다. */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 px-8 pb-4 pt-14">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <OutlinedText em={0.045} className="t-sub flex-shrink-0 font-semibold">
            방송 중
          </OutlinedText>
          {/* `truncate` 는 **바깥 겹에** 건다 — 두 겹이 같은 폭으로 잘려야 테두리와 속이
              같은 자리에서 끝난다. 안쪽 겹에 걸면 겹마다 따로 잘려 테가 어긋난다. */}
          <OutlinedText em={0.045} className="t-body min-w-0 flex-1 truncate font-semibold">
            {nowPlaying || '—'}
          </OutlinedText>
        </div>
      </div>
    </div>
  )
}

// 소리 활성화 안내 배너 (브라우저 autoplay 정책으로 클릭 필요)
export function AudioUnlockBanner({ unlocked }) {
  if (unlocked) return null
  return (
    // **떠 있되 글자 위에 앉지 않는다**(8단계, 2026-09-13).
    // 390px 에서 이 알약이 오늘 일과 목록을 덮어 「12:59 프로그램실 안내」·「안 나감」·
    // 「BGM 대기 중」을 가렸다(실측: 글자 위 겹침 다섯 자리). 알림이 정보를 가리면
    // 알림이 아니라 사고다 — 특히 「안 나감」은 이 화면에서 가장 비싼 말이다.
    //
    // 고친 방법은 **자리를 비켜 주는 것**이다. 아래쪽 재생 바(`NowPlayingBar`, 40px)
    // 바로 위에 12px 띄워 앉히고, 좁은 화면에서는 좌우 여백을 둬 글자가 알약 밖으로 흐르게 한다.
    // **더 올리면 안 된다** — 목록의 아래 여백이 112px 인데 처음에 `bottom-[84px]` 로 뒀더니
    // 알약 윗변이 128px 이라 **맨 아래까지 내려도 마지막 줄이 16px 가렸다**(실측).
    //
    // **`animate-pulse` 를 걷었다.** 어르신이 보는 화면에 하루 종일 깜빡이는 것을
    // 두지 않는다(영상 원칙 ①: 효과를 셋 이상 겹치지 않는다 — 여기엔 그림자·둥근
    // 알약·색이 이미 있다). 눈에 띄어야 하는 것은 색과 자리로 충분하다.
    // **이 띠는 제 손으로 자물쇠를 연다**(사용자 신고 2026-09-15: *"저거 뭐야 눌러도
    // 아무반응도 없고"*). 앞 판은 `onClick={() => {}}` — **빈 함수**였다. 문서에 걸린
    // 리스너가 대신 잡아 주기를 기대한 모양인데, 그쪽도 **첫 터치에 제 리스너를 걷어서**
    // 한 번 실패하면 끝이었다. 눌러도 아무 일이 없는 화면은 사람이 고장으로 읽는다.
    //
    // `type="button"` 인 진짜 단추로 둔다 — `div` 는 키보드로 못 누르고 보조기술도 못 읽는다.
    <button
      type="button"
      className="fixed bottom-[52px] left-1/2 z-50 max-w-[calc(100vw/var(--cc-zoom,1)-32px)] -translate-x-1/2
                 cursor-pointer rounded-full bg-ds-v3-tts px-5 py-2.5 t-label
                 text-white shadow-lg"
      onClick={() => { unlockAudio() }}
    >
      🔊 화면을 눌러 소리를 켜 주세요
    </button>
  )
}

// 연결 끊김 오버레이
export function OfflineBanner() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl">
        <div className="w-10 h-10 border-4 border-ds-v3-tts border-t-transparent rounded-full animate-spin" />
        <p className="text-base font-bold text-ds-v3-ink">서버 재연결 중...</p>
        <p className="text-sm text-ds-v3-ink-2">Wi-Fi가 바뀐 경우 잠시 기다려 주세요</p>
      </div>
    </div>
  )
}
