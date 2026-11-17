import { useEffect, useState } from 'react'
import { ArrowLeft, Building2, Smartphone, Repeat, RotateCcw, Map, FileCode2, ExternalLink, MousePointerClick } from 'lucide-react'
import GuideMapCanvas from '../components/shared/GuideMapCanvas'
import { BEATS, IDLE_CAPTION } from '../lib/guideMap'

// /guide — 안내도(움직이는 판)와 설계도(개발자 도면)를 한 화면의 두 탭으로.
//
// 같은 시스템을 두 가지로 찍는다 — 사진과 CT처럼. 「안내도」는 방송 한 건이 사무실·폰에서
// 홀 스피커와 TV까지 가는 길을 사람 말로 움직여 보여주고(GuideMapCanvas + 아래 글),
// 「설계도」는 같은 길을 파일 경로와 모듈 이름으로 그린 도면을 그대로 띄운다.
// 도면의 원본은 docs/arch/structure.json이고 HTML은 산출물이라, 설계가 바뀌면 JSON을
// 고쳐 다시 그리면 이 탭도 같이 바뀐다(그림은 /api/dev/arch/structure/html에서 읽는다).
//
// **iframe 높이를 못박지 않는다(2026-09-04).** 예전엔 clamp(920px, 120vh, 1350px)였다 —
// archify 뷰어가 자기 폭 상한을 뷰포트(=iframe) 높이에서 정하던 시절의 값이고, 납작하게
// 끼우면 글씨가 뭉개져서 크게 줬었다. 그 뷰어를 걷어내고 도면을 직접 그리게 된 뒤로는
// 그림이 그만큼 크지 않아 **아래가 통째로 검은 홀**이 됐다(사용자 지적). 지금은 그림의
// 가로세로비를 그대로 주고, 확대는 폭을 키워 옆으로 미는 방식으로 한다.
//
// **이 화면은 방송 재생과 아무 상관이 없다.** App.jsx에서 /monitor·/dev-console처럼
// 별도 껍데기로 갈라 놓았다(재생 코드·SSE를 아예 안 태운다). 그래서 현장 PC에서 이걸
// 띄워 놓아도 소리 담당이 바뀌거나 중복 창 경고가 뜨지 않는다.
// 같은 이유로 이 화면을 여는 길은 navigate가 아니라 a 태그(통째 이동)여야 한다.

// 글로 적은 다섯 단계 — 그림의 번호와 같다.
const STEPS = BEATS.filter(b => b.step).map(b => ({
  n: b.step,
  title: b.title,
  detail: b.caption,
  sound: b.step >= 4,
}))

const NOTES = [
  {
    title: '타이머는 그 1분만 봅니다',
    body: '07:50 방송은 타이머가 07:50에 DB를 읽을 때만 나갑니다. 그 순간 서버가 꺼져 있었다면 그날 그 방송은 없습니다. 그래서 감시가 따로 있습니다 — 나갔어야 할 방송이 안 나가면 5분 뒤에 경보를 띄웁니다.',
  },
  {
    title: '소리 길이 둘이라 증상도 둘입니다',
    body: '안내 음성과 차임벨은 서버가 내고, 음원·음악·영상은 브라우저가 냅니다. "안내 음성은 나오는데 음악이 안 나온다"와 그 반대는 서로 다른 고장입니다 — 어느 쪽이 안 들렸는지만 알려 주시면 찾는 자리가 절반으로 줄어듭니다.',
    sound: true,
  },
  {
    title: 'DB는 그 컴퓨터에만 있습니다',
    body: '예약·음원·설정은 현장 컴퓨터 안 DB 파일 하나에 들어 있습니다. 다른 PC에서 열면 목록이 비어 보이는데, 없어진 것이 아니라 원래 그 PC의 것이 아닙니다. 그래서 매일 새벽 4시 30분에 DB를 백업합니다.',
  },
  {
    title: 'AI가 마음대로 내보내지 않습니다',
    body: '"내일 두 시에 프로그램 안내 방송"처럼 말로 넣으면 AI가 초안까지만 만듭니다. 사람이 화면에서 확인하고 확정을 눌러야 실제 예약이 됩니다. 애매하게 읽은 부분은 되물어 봅니다.',
  },
]

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

export default function GuideMapPage() {
  const [status, setStatus] = useState({ phase: 'idle', step: 0, caption: IDLE_CAPTION })
  const [cmd, setCmd] = useState({ kind: 'idle', source: 'office', n: 0 })
  const [loop, setLoop] = useState(false)
  // 움직임을 줄여 달라고 설정한 사람에게는 루프를 아예 안 돌린다(누르면 결과 그림만 나온다).
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_QUERY).matches)
  // 두 탭은 갈아 끼우지 않고 숨겼다 보인다 — 안내도의 움직임이 탭을 오가도 안 끊기고,
  // 설계도(740KB)도 처음 눌렀을 때 한 번만 읽는다.
  // /guide#blueprint 로 열면 설계도 탭에서 시작한다 — 링크 한 줄로 도면을 바로 보여줄 수 있게.
  const [tab, setTab] = useState(() => window.location.hash === '#blueprint' ? 'blueprint' : 'guide')
  const [blueprintSeen, setBlueprintSeen] = useState(() => window.location.hash === '#blueprint')
  // 설계도 확대 배율(1 = 폭 맞춤). 넓히면 넘치는 만큼 옆으로 밀어 본다.
  const [zoom, setZoom] = useState(1)

  // 설계도는 다크가 기본(2026-09-02 사용자 결정). archify 뷰어는 첫 방문에 시스템 설정을
  // 따르므로, 아직 고른 적 없는 브라우저에만 다크를 심는다 — iframe(/api/...)이 같은
  // 오리진이라 이 localStorage를 그대로 읽는다. 뷰어의 Light 단추는 그대로 산다.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem('archify-theme')) window.localStorage.setItem('archify-theme', 'dark')
    } catch { /* localStorage가 막힌 브라우저면 시스템 설정을 따른다 */ }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia(REDUCED_QUERY)
    const onChange = (e) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 지시는 값으로 보낸다 — n이 오를 때마다 그림 쪽이 한 번 처리한다
  const start = (source) => setCmd(c => ({ kind: 'start', source, n: c.n + 1 }))
  const reset = () => setCmd(c => ({ kind: 'reset', source: c.source, n: c.n + 1 }))
  const toggleLoop = () => setLoop(v => !v)
  const openTab = (t) => {
    setTab(t)
    if (t === 'blueprint') setBlueprintSeen(true)
    window.history.replaceState(null, '', window.location.pathname + (t === 'blueprint' ? '#blueprint' : ''))
  }

  const btn = 'flex items-center gap-2 px-3.5 py-2 rounded-btn text-sm font-normal border btn-press transition-colors'
  // 시작 단추는 이 화면의 주인공이다 — 심사·처음 보는 사람이 **어디를 누를지** 바로 보이게 크게(사용자 지시 2026-09-17).
  const startBtn = 'flex items-center gap-2.5 px-5 py-3 rounded-btn text-lg font-semibold border-2 btn-press transition-colors'
  const tabBtn = (on) => `flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-semibold btn-press transition-colors ${
    on ? 'bg-ds-v3-tts text-white' : 'text-ds-v3-ink-2 hover:text-ds-v3-ink'}`

  return (
    <div className="min-h-screen bg-ds-v3-bg">
      <div className="flex items-center gap-3 px-5 h-14 bg-white border-b border-ds-v3-line sticky top-0 z-10">
        <a href="/admin" className="flex items-center gap-1.5 text-sm text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press">
          <ArrowLeft size={15} /> 관리자 화면
        </a>
        <span className="text-sm font-semibold text-ds-v3-ink">시스템 안내도</span>
        <span className="text-[11px] text-ds-v3-ink-2 hidden sm:inline">방송 한 건이 홀까지 가는 길</span>
      </div>

      <div className="max-w-[1180px] mx-auto px-5 py-7">
        {/* 같은 시스템을 두 가지로 찍었다 — 사진(안내도)과 CT(설계도). 규격은 같은 카드 한 장 */}
        <div className="flex items-center gap-1 mb-6 p-1 bg-white border border-ds-v3-line rounded-card w-fit">
          <button onClick={() => openTab('guide')} aria-pressed={tab === 'guide'} className={tabBtn(tab === 'guide')}>
            <Map size={15} /> 안내도
            <span className={`text-[11px] font-normal ${tab === 'guide' ? 'text-white/80' : 'text-ds-v3-ink-2'}`}>누구나</span>
          </button>
          <button onClick={() => openTab('blueprint')} aria-pressed={tab === 'blueprint'} className={tabBtn(tab === 'blueprint')}>
            <FileCode2 size={15} /> 설계도
            <span className={`text-[11px] font-normal ${tab === 'blueprint' ? 'text-white/80' : 'text-ds-v3-ink-2'}`}>개발자</span>
          </button>
        </div>

        <div className={tab === 'guide' ? '' : 'hidden'}>
        {/* ── 심사위원이 **한눈에** 읽게 (사용자 지시 2026-09-17 「이부분 너무 안보여 … 눈에 확 들어오게」) ──
            예전엔 제목 24px·본문 14px·그림 위 자막 15px 이라 멀리서 안 읽혔다. 제목·시작 단추·자막 띠를 키운다.
            「누르면 움직인다」 안내는 자막 띠의 첫 문장(IDLE_CAPTION)이 이미 말하므로 따로 한 번 더 쓰지 않는다. */}
        <h1 className="text-3xl sm:text-4xl font-semibold text-ds-v3-ink mb-3 tracking-tight">방송 한 건이 홀까지 가는 길</h1>
        <p className="text-base sm:text-lg text-ds-v3-ink-2 leading-relaxed max-w-3xl mb-6">
          케어캐스트는 <b className="text-ds-v3-ink font-semibold">요양원 방송을 사람 대신 시간 맞춰 내보내는 프로그램</b>입니다.
          아침 방송·국민체조·식사 전 체조·저녁 마무리 방송이 매일 같은 시각에, 아무도 누르지 않아도 나갑니다.
        </p>

        <div className="bg-white border border-ds-v3-line rounded-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-3.5 border-b border-ds-v3-line">
            <button onClick={() => start('office')}
              className={`${startBtn} border-ds-v3-tts/50 text-ds-v3-tts bg-ds-v3-tts-bg hover:border-ds-v3-tts`}>
              <Building2 size={22} /> 사무실 PC에서 시작
            </button>
            <button onClick={() => start('phone')}
              className={`${startBtn} border-ds-v3-tts/50 text-ds-v3-tts bg-ds-v3-tts-bg hover:border-ds-v3-tts`}>
              <Smartphone size={22} /> 휴대폰에서 시작
            </button>
            <button onClick={toggleLoop}
              className={`${btn} ${loop
                ? 'border-ds-v3-ink-3/50 text-ds-v3-ink-3 bg-ds-v3-surface-2'
                : 'border-ds-v3-line text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
              <Repeat size={15} /> {loop ? '되풀이 켜짐' : '되풀이'}
            </button>
            <button onClick={reset} className={`${btn} border-ds-v3-line text-ds-v3-ink-2 hover:text-ds-v3-ink`}>
              <RotateCcw size={14} /> 처음으로
            </button>
            {reduced && (
              <span className="text-[11px] text-ds-v3-ink-2 ml-auto">
                이 컴퓨터는 화면 움직임을 줄이도록 설정돼 있어, 누르면 결과 그림만 보여 줍니다
              </span>
            )}
          </div>

          {/* 자막은 그림 **위**에 둔다(2026-09-05 사용자 지시) — 밑에 있으면 그림을 보느라
              안 읽는다. 높이를 두 줄로 잡아 자막이 바뀔 때 그림이 위아래로 안 튄다. */}
          {/* 이 띠가 그림의 **말**이다 — 심사위원이 멀리서도 읽게 크게(사용자 지시 2026-09-17 「눈에 확 들어오게」). */}
          <div className="px-5 py-5 border-b border-ds-v3-line bg-ds-v3-tts-bg min-h-[108px] flex items-center">
            <p className="flex items-center text-xl sm:text-[22px] font-semibold text-ds-v3-ink leading-snug">
              {status.step === 0 && <MousePointerClick size={34} className="mr-3.5 shrink-0 text-ds-v3-tts" aria-hidden="true" />}
              {status.step > 0 && (
                <span className="inline-flex items-center justify-center w-8 h-8 mr-2.5 rounded-full
                                 bg-ds-v3-tts text-white text-base font-semibold align-middle">
                  {status.step}
                </span>
              )}
              {status.caption}
            </p>
          </div>

          <GuideMapCanvas cmd={cmd} loop={loop} reduced={reduced} onStatus={setStatus} />
        </div>

        <p className="text-base text-ds-v3-ink-2 mt-3 leading-relaxed">
          소리가 나오는 길이 <b className="text-ds-v3-ink font-semibold">두 개</b>인 것이 이 시스템의 핵심입니다 —
          안내 음성과 차임벨은 서버가 직접 내고, 음원·음악·영상은 브라우저가 재생합니다. 둘 다 같은 홀 스피커로 나갑니다.
        </p>

        <h2 className="text-lg font-semibold text-ds-v3-ink mt-9 mb-1">순서대로 다시 보기</h2>
        <p className="text-sm text-ds-v3-ink-2 mb-4">아침 7시 50분 아침 방송을 예로 들면 이렇게 지나갑니다.</p>
        <ol className="space-y-2.5">
          {STEPS.map(step => {
            const on = status.step === step.n
            return (
              <li key={step.n}
                className={`flex gap-3.5 items-start bg-white border rounded-card px-4 py-3 transition-colors
                            ${on ? 'border-ds-v3-tts/60 bg-ds-v3-tts-bg' : 'border-ds-v3-line'}`}>
                <span className={`flex-shrink-0 w-8 h-8 mt-0.5 rounded-full flex items-center justify-center
                                  text-sm font-semibold
                                  ${step.sound ? 'bg-ds-v3-surface-2 text-ds-v3-ink-2' : 'bg-ds-v3-tts-bg text-ds-v3-tts'}`}>
                  {step.n}
                </span>
                <span>
                  <b className="block text-base font-semibold text-ds-v3-ink">{step.title}</b>
                  <span className="text-[15px] text-ds-v3-ink-2 leading-relaxed">{step.detail}</span>
                </span>
              </li>
            )
          })}
        </ol>

        <h2 className="text-lg font-semibold text-ds-v3-ink mt-9 mb-4">알아두면 좋은 것 넷</h2>
        <div className="grid gap-3.5 sm:grid-cols-2">
          {NOTES.map(note => (
            <div key={note.title}
              className="bg-white border border-ds-v3-line rounded-card px-4 py-3.5"
              style={{ borderLeft: `3px solid ${note.sound ? '#F97316' : '#4F8EF7'}` }}>
              <h3 className="text-base font-semibold text-ds-v3-ink mb-1.5">{note.title}</h3>
              <p className="text-[15px] text-ds-v3-ink-2 leading-relaxed">{note.body}</p>
            </div>
          ))}
        </div>

        </div>

        {/* 설계도 탭 — archify가 그린 도면을 그대로 띄운다. 별도 그림을 새로 그리지 않는다 */}
        {blueprintSeen && (
          <div className={tab === 'blueprint' ? '' : 'hidden'}>
            <h1 className="text-2xl font-semibold text-ds-v3-ink mb-2">같은 길을 개발자 눈으로 — 전체 설계도</h1>
            <p className="text-sm text-ds-v3-ink-2 leading-relaxed max-w-3xl mb-6">
              안내도 탭과 <b className="text-ds-v3-ink font-semibold">같은 시스템</b>입니다. 사진과 CT처럼 찍는 방법만 다릅니다 —
              여기서는 네모가 실제 코드 파일이고, 화살표의 <b className="text-ds-v3-ink font-semibold">번호 1~8</b>이
              방송 하나가 나가는 순서입니다. <b className="text-ds-v3-ink font-semibold">상자나 번호를 누르면</b>
              그 길만 남고, <b className="text-ds-v3-ink font-semibold">＋ －</b>로 확대해 끌어서 볼 수 있습니다.
            </p>

            <div className="bg-white border border-ds-v3-line rounded-card overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 border-b border-ds-v3-line">
                <span className="text-[12.5px] text-ds-v3-ink-2">
                  원본은 <code className="text-ds-v3-ink">docs/arch/structure.json</code> — 설계가 바뀌면 JSON을 고쳐 다시 그리면 이 탭도 같이 바뀝니다
                </span>
                <a href="/api/dev/arch/structure/html" target="_blank" rel="noopener"
                  className="ml-auto flex items-center gap-1.5 text-xs text-ds-v3-tts hover:underline btn-press">
                  <ExternalLink size={13} /> 새 탭에서 크게 열기
                </a>
              </div>
              {/* **높이를 못박지 않는다.** 예전엔 clamp(920px, 120vh, 1350px)였다 — archify
                  뷰어가 자기 폭을 iframe 높이에서 정하던 시절의 값이다. 그 뷰어를 걷어낸
                  뒤로는 그림이 그만큼 크지 않아 **아래가 통째로 검은 홀**이 됐다(2026-09-04
                  사용자 지적). 이제 그림의 가로세로비(1710×620)를 그대로 준다 — 폭이 변하면
                  높이가 따라오고 남는 자리가 없다.
                  확대는 **폭을 키워서** 한다: 넘치는 만큼 가로로 밀어 볼 수 있다(끌기·스크롤).
                  iframe 안으로 손을 넣지 않으므로 도면 쪽 코드와 얽히지 않는다. */}
              <div className="overflow-auto bg-[#0D1116]" style={{ maxHeight: '80vh' }}>
                <iframe src="/api/dev/arch/structure/html" title="CareCast 전체 설계도"
                  className="block border-0 bg-[#0D1116]"
                  style={{ width: `${zoom * 100}%`, aspectRatio: '1710 / 620', height: 'auto' }} />
              </div>
              <div className="flex items-center gap-2 px-4 py-2.5 border-t border-ds-v3-line">
                <button onClick={() => setZoom(z => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
                  disabled={zoom <= 1}
                  className="min-w-[44px] h-9 px-3 rounded-btn border border-ds-v3-line text-sm text-ds-v3-ink
                             disabled:opacity-40 btn-press">－</button>
                <button onClick={() => setZoom(z => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
                  disabled={zoom >= 3}
                  className="min-w-[44px] h-9 px-3 rounded-btn border border-ds-v3-line text-sm text-ds-v3-ink
                             disabled:opacity-40 btn-press">＋</button>
                <button onClick={() => setZoom(1)} disabled={zoom === 1}
                  className="h-9 px-3 rounded-btn border border-ds-v3-line text-sm text-ds-v3-ink-2
                             disabled:opacity-40 btn-press">폭 맞춤</button>
                <span className="text-xs text-ds-v3-ink-2 ml-1 nums">{Math.round(zoom * 100)}%</span>
                <span className="text-xs text-ds-v3-ink-2 ml-auto hidden tablet:inline">확대하면 옆으로 밀어서 봅니다</span>
              </div>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-3 mt-4">
              <div className="bg-white border border-ds-v3-line rounded-card px-4 py-3.5"
                style={{ borderLeft: '3px solid #4F8EF7' }}>
                <h3 className="text-sm font-semibold text-ds-v3-ink mb-1.5">사무실 PC · 휴대폰</h3>
                <p className="text-[13px] text-ds-v3-ink-2 leading-relaxed">= 설계도의 <b className="text-ds-v3-ink">1. 예약하기</b> — 관리자 화면이 Express API를 거쳐 SQLite 한 파일에 적는다</p>
              </div>
              <div className="bg-white border border-ds-v3-line rounded-card px-4 py-3.5"
                style={{ borderLeft: '3px solid #F97316' }}>
                <h3 className="text-sm font-semibold text-ds-v3-ink mb-1.5">방송실 세 담당</h3>
                <p className="text-[13px] text-ds-v3-ink-2 leading-relaxed">= <b className="text-ds-v3-ink">2. 방송하기 + 3. 소리내기</b> — 시계 지킴이는 스케줄러, 방송 진행은 시퀀서, 소리 담당은 SSE·스피커</p>
              </div>
              <div className="bg-white border border-ds-v3-line rounded-card px-4 py-3.5"
                style={{ borderLeft: '3px solid #10B981' }}>
                <h3 className="text-sm font-semibold text-ds-v3-ink mb-1.5">지켜보기</h3>
                <p className="text-[13px] text-ds-v3-ink-2 leading-relaxed">= <b className="text-ds-v3-ink">4. 지켜보기</b> — <b className="text-ds-v3-ink">두 가지를 따로 봅니다</b>: 시작조차 안 했으면 예정 +5분에 「안 나감」, 시작은 했는데 안 끝나면 +60분에 「안 끝남」. DB 사본은 <b className="text-ds-v3-ink">서버가 켜질 때</b> 남깁니다 (04:30 예약도 있지만 그 시각엔 현장 PC가 꺼져 있습니다)</p>
              </div>
            </div>
          </div>
        )}

        <p className="text-[12.5px] text-ds-v3-ink-2 mt-8 pt-5 border-t border-ds-v3-line leading-relaxed">
          두 탭은 같은 시스템을 다르게 찍은 것입니다 — 안내도는 사람 말로, 설계도는 파일 경로와 모듈
          이름으로. 두 장이 어긋나면 <b className="text-ds-v3-ink font-semibold">설계도가 원본</b>입니다.
        </p>
      </div>
    </div>
  )
}
