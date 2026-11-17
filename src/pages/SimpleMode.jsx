// 간편화면 — 3단 위계의 첫 칸(간편 · 쉬운 · 관리자).
//
// **디자인 시스템 캔버스가 원본이다**(아티팩트 17bd2f6a의 SimpleMobile · SimpleTablet ·
// EasyMode(웹) 세 아트보드). 색·크기·문구를 지어내지 않고 그 값을 그대로 옮겼다.
// 반응형 기준도 캔버스가 정한 것이다: **390(1열) · 834(세로 쌓기) · 1440(두 판)**.
// Tailwind의 phone/tablet/wide가 그 세 값이다(tailwind.config.js).
//
// 왜 새 화면인가: 캔버스에만 있고 코드에는 없던 칸이다. 그래서 이 화면을 만들어도
// **기존 화면은 하나도 안 바뀐다** — 새 토큰·중단점을 실제 화면에서 처음 써 보는 자리로
// 이만한 데가 없다(현장이 매일 쓰는 쉬운화면을 첫 대상으로 삼으면 위험만 크다).
//
// **소리를 내지 않는다.** 지금은 뼈대와 실제 정보(시각·다음 방송·BGM 상태)까지이고,
// 타일은 이미 있는 화면으로 보낸다. 새 방송 경로를 여기서 만들지 않는다 — 소리를 내는
// 길이 또 하나 늘면 정지·겹침 규칙을 그만큼 또 지켜야 한다(td09가 그 이야기다).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Music2, CalendarDays, Volume2, ArrowRight, Radio } from 'lucide-react'
import '../styles/tokens.css'
import { getSchedules } from '../lib/api'
import { parseWeekdays } from '../lib/scheduleUtils'
// 시각 짓는 규칙은 `lib/clock.js` 한 곳이다 — 통합 홈·쉬운 화면 머리줄이 같은 것을 쓴다.
import { formatTime } from '../lib/clock'

// 오늘 아직 안 지난 예약 중 가장 이른 것. 화면이 스스로 계산하지 않고 예약 규칙을
// 쓰는 곳(scheduleUtils)을 그대로 본다 — 요일 판정이 갈리면 화면만 다른 말을 한다.
function nextToday(rows, now) {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const runsToday = (s) => {
    const wd = parseWeekdays(s.repeat_weekdays)
    return wd.length ? wd.includes(now.getDay()) : true
  }
  return rows
    .filter(s => Number(s.active) === 1 && s.scheduled_time > hhmm && runsToday(s))
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))[0] || null
}

export default function SimpleMode() {
  const navigate = useNavigate()
  const [now, setNow] = useState(new Date())
  const [next, setNext] = useState(null)
  const [remain, setRemain] = useState(null)
  // BGM이 지금 나오는지는 **앱 수준 재생기가 아는 것**이고, 그것을 묻는 API는 없다
  // (재생기가 서버 now-playing 에 쓰기만 한다). 없는 함수를 지어내 부르지 않는다 — SSE로 오는
  // 상태를 듣는 배선은 다음 갈래다. 그때까지 이 칸은 "눌러서 확인"이라고 정직하게 말한다.
  const bgmOn = null

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let dead = false
    const load = () => {
      getSchedules()
        .then(rows => {
          if (dead || !Array.isArray(rows)) return
          const d = new Date()
          const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          setNext(nextToday(rows, d))
          setRemain(rows.filter(s => Number(s.active) === 1 && s.scheduled_time > hhmm).length)
        })
        .catch(() => { /* 못 받아도 화면은 뜬다 — 아래에서 "확인 중"으로 나온다 */ })
    }
    load()
    const t = setInterval(load, 30000)
    return () => { dead = true; clearInterval(t) }
  }, [])

  // 초까지 그린다 (사용자 지시 2026-09-14: *"시간 초단위 안해놨네?"*). 여기는 시각을
  // **직접 짓고 있어서** 공용 규칙 밖에 있었다 — 통합 홈·쉬운 화면이 `lib/clock` 으로
  // 바뀌어도 이 화면만 분까지 남았을 자리다. 같은 함수를 쓰게 해서 세 화면을 맞춘다.
  const clock = formatTime(now)

  // 타일 — 캔버스의 네 칸 그대로. 누르면 이미 있는 화면으로 간다(새 소리 경로 없음).
  // 색은 **토큰을 가리키기만 한다** — 값이 배열에 실려 오는 자리라 Tailwind 클래스를 못 쓰고
  // var()로 읽는다(tokens.css가 유일한 출처다. tailwind.config.js의 ds 등록과 같은 값이다).
  const tiles = [
    { icon: Mic, bg: 'var(--ds-kind-now-soft)', ink: 'var(--ds-kind-now)', title: '마이크로 말하기', sub: '누르는 동안 나갑니다', to: '/' },
    { icon: Music2, bg: 'var(--ds-kind-bgm-soft)', ink: 'var(--ds-kind-bgm)', title: '음악 틀기',
      sub: bgmOn === null ? '눌러서 확인' : bgmOn ? '지금 나오는 중' : '지금 꺼져 있음',
      subInk: bgmOn ? 'var(--ds-kind-done)' : 'var(--ds-text-sub)', to: '/' },
    { icon: CalendarDays, bg: 'var(--ds-kind-done-soft)', ink: 'var(--ds-kind-done)', title: '오늘 일정',
      sub: next ? `다음 ${next.scheduled_time} · ${remain ?? 0}개 남음` : '남은 예약 없음', to: '/admin?tab=schedule' },
    { icon: Volume2, bg: 'var(--ds-brand-soft)', ink: 'var(--ds-brand-ink)', title: '소리 크기', sub: '눌러서 조절', to: '/' },
  ]

  return (
    <div className="min-h-screen bg-ds-bg text-ds-text" style={{ wordBreak: 'keep-all' }}>
      {/* **늘어지지 않게 최대 폭을 묶는다**(2026-09-04 사용자 지적).
          중단점만 있으면 그 사이 폭에서는 내용이 그냥 늘어난다 — 세로로 쌓는 동안은
          834(태블릿 판의 폭)로 묶어 두고, 두 판이 되는 wide에서만 1440까지 편다.
          가운데 정렬이라 넓은 화면에서는 양옆 여백으로 남는다. */}
      <div className="mx-auto w-full max-w-[834px] wide:max-w-[1440px]">
      {/* 상단 얇은 바 — 390에서 56px, 넓어지면 여백만 커진다 */}
      <div className="flex items-center gap-2 px-4 wide:px-6 h-14 wide:h-[72px]">
        {/* 아이콘 색은 currentColor다 — 바깥 글자색(text-ds-text)을 그대로 따라간다.
            color="#..."로 박으면 화면이 색을 또 한 벌 갖게 된다. */}
        <span className="inline-flex items-center justify-center w-7 h-7 wide:w-8 wide:h-8 rounded-[9px] wide:rounded-[10px] bg-ds-brand">
          <Radio size={15} strokeWidth={2} />
        </span>
        <b className="text-[15px] wide:text-[17px] font-semibold tracking-[-0.01em]">CareCast</b>
        <span className="ml-auto nums text-[20px] wide:text-[26px] font-normal">{clock}</span>
      </div>

      {/* 두 판 — 1440부터 나란히(640px + 나머지), 그 아래는 세로로 쌓는다.
          캔버스의 세 아트보드가 정확히 이 세 모습이다. */}
      <div className="px-3 wide:px-6 pb-3 wide:pb-6 grid gap-3 wide:gap-6 wide:grid-cols-[640px_minmax(0,1fr)] items-stretch">

        {/* 라벤더 판 */}
        <div className="bg-ds-brand rounded-[24px] wide:rounded-[32px] p-5 tablet:p-8 laptop:p-10 wide:p-[52px] flex flex-col gap-3.5 laptop:gap-5 wide:gap-6">
          <div className="inline-flex items-center gap-[7px] wide:gap-[9px] self-start h-8 wide:h-[38px] px-[13px] wide:px-[17px] rounded-full bg-ds-chip-on-brand text-[13px] wide:text-[15px] font-normal">
            <span className="w-1.5 h-1.5 wide:w-2 wide:h-2 rounded-full bg-ds-text" />
            {next
              ? <>다음 방송 <span className="nums">{next.scheduled_time}</span> · {next.title}</>
              : <>오늘 남은 예약이 없습니다</>}
          </div>

          <div className="text-[32px] tablet:text-[40px] laptop:text-[44px] wide:text-[50px] leading-[1.18] font-semibold tracking-[-0.03em]"
            style={{ textWrap: 'pretty' }}>
            무엇을<br className="hidden wide:inline" />{' '}방송할까요?
          </div>

          {/* 명령창은 아직 **모양만**이다 — 말귀를 알아듣는 자리(자연어 파서)는 이미
              쉬운화면에 있고, 여기에 또 만들면 같은 일을 하는 둘이 된다. 잇는 것은 다음 갈래. */}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2 h-14 wide:h-[68px] pl-3.5 pr-1.5 rounded-full bg-ds-surface border-2 border-ds-border text-left"
          >
            <span className="flex-1 min-w-0 truncate text-[15px] wide:text-[17px] text-ds-text-sub">
              말하듯이 적어 보세요 — 예: 11시에 점심 안내
            </span>
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-ds-brand-ink text-ds-surface shrink-0">
              <ArrowRight size={18} strokeWidth={2.2} />
            </span>
          </button>

          {/* `bg-white/45`만 토큰이 아니다 — 반투명이라서다. Tailwind v3는 값이 var()면
              투명도 수식어를 합성하지 못하고 조용히 불투명하게 낸다(`bg-ds-surface/45`가
              그렇게 깨진다). 흰색은 캔버스에서도 --ds-surface와 같은 값이라 위험이 없다. */}
          <div className="flex gap-2 flex-wrap">
            {['가족방문 안내 예약', '아침 방송 흐름 실행'].map(t => (
              <span key={t} className="inline-flex items-center h-11 px-4 text-[14px] bg-white/45 rounded-full">{t}</span>
            ))}
          </div>

          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center justify-center h-14 wide:h-[72px] rounded-full bg-ds-surface text-[18px] wide:text-[22px] font-semibold"
          >
            지금 방송 내보내기
          </button>
        </div>

        {/* 타일 2×2 — 폰에서도 2열이다(캔버스 그대로). 손가락 표적은 카드 전체다. */}
        <div className="bg-ds-surface rounded-[24px] wide:rounded-[32px] p-4 laptop:p-6 wide:p-8 grid grid-cols-2 grid-rows-2 gap-3 laptop:gap-5 wide:gap-6">
          {tiles.map(({ icon: Icon, bg, ink, title, sub, subInk, to }) => (
            <button
              key={title}
              type="button"
              onClick={() => navigate(to)}
              className="border border-ds-border rounded-[18px] wide:rounded-[24px] p-3.5 wide:p-[30px]
                         flex flex-col justify-between gap-3 text-left min-h-[132px]"
            >
              {/* 배지가 색을 정하고 아이콘은 currentColor로 따라간다 — 같은 값을
                  배경·아이콘 두 군데에 넘기지 않으려는 것이다. */}
              <span className="inline-flex items-center justify-center w-14 h-14 wide:w-[76px] wide:h-[76px] rounded-2xl wide:rounded-[24px] shrink-0"
                style={{ background: bg, color: ink }}>
                <Icon size={26} strokeWidth={1.8} className="wide:hidden" />
                <Icon size={34} strokeWidth={1.8} className="hidden wide:block" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[19px] wide:text-[27px] font-semibold tracking-[-0.02em]">{title}</span>
                <span className="text-[14px] wide:text-[16px] leading-[1.5]" style={{ color: subInk || 'var(--ds-text-sub)' }}>{sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      </div>
    </div>
  )
}
