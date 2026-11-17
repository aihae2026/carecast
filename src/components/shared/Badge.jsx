// 상태 뱃지 — 라이트 테마용
const variantStyles = {
  success: 'bg-ds-v3-surface-2  text-ds-v3-ink-2  border border-ds-v3-line',
  warning: 'bg-ds-v3-surface-2  text-ds-v3-ink-2  border border-ds-v3-line',
  danger:  'bg-ds-v3-warn-bg    text-ds-v3-warn    border border-ds-v3-warn-bg',
  primary: 'bg-ds-v3-tts-bg   text-ds-v3-tts   border border-ds-v3-tts-line',
  purple:  'bg-ds-v3-flow-bg text-ds-v3-flow border border-ds-v3-flow-line',
  // gray-500 은 gray-100 위에서 4.39 였다 — 흰 배경(4.83)만 보고 고른 값이다.
  // 이 뱃지는 방송 로그 한 화면에 180줄 넘게 깔린다(UX-42, 2026-09-12 실측).
  default: 'bg-ds-v3-surface-2  text-ds-v3-ink-2     border border-ds-v3-line',
}

// `whitespace-nowrap` — 좁은 표 칸에서 "자동"이 "자/동" 으로 세로로 쪼개졌다
// (2026-09-11 브라우저 확인). 뱃지는 낱말 하나라 줄바꿈할 이유가 없다.
export function Badge({ children, variant = 'default' }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-normal
                      ${variantStyles[variant] ?? variantStyles.default}`}>
      {children}
    </span>
  )
}

// 상태 점 — **색만으로 알리지 않는다** (UX-42, 2026-09-11).
//
// 예전엔 2×2 색점 하나가 전부였다. 적록색약은 성인 남성의 약 8%고, 현장 PC 화면은
// 밝은 곳에 있어 채도가 죽는다. 그 상태에서 초록과 빨강은 같은 회색 점이다 —
// 방송 시스템에서 그것은 "괜찮은 줄 알았다"가 된다.
//
// 그래서 셋을 다르게 한다: **모양**(찬 원 / 테 두른 원 / 빈 원)과 **글자**
// (`aria-label`·`title`). 색은 셋째 단서로만 쓴다.
// **초록·주황을 걷었다**(사용자 지시 2026-09-16). 이 제품의 색 언어에 없는 색이다(G-1).
// 위 머리말이 이미 적어 둔 대로 **모양이 첫째 단서**라, 색을 무채색으로 내려도 셋이
// 그대로 갈린다 — 찬 원 / 테 두른 원 / 빈 원. 빨강만 남는데 그것은 **경고**다(G-6).
const dotStyles = {
  online:  { cls: 'bg-ds-v3-ink-3',                                  label: '정상' },
  warning: { cls: 'bg-ds-v3-ink-3 ring-2 ring-ds-v3-ink-3/40',       label: '주의' },
  offline: { cls: 'bg-transparent border-2 border-ds-v3-warn',        label: '오류' },
}

export function StatusDot({ status }) {
  const s = dotStyles[status] ?? { cls: 'bg-ds-v3-line', label: '확인 불가' }
  return (
    <span
      role="img"
      aria-label={s.label}
      title={s.label}
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${s.cls}`}
    />
  )
}

// 방송 종류 뱃지
export function TypeBadge({ type }) {
  // 실제로 이력에 적히는 낱말이 여기 다 있어야 한다 — 빠지면 회색 기본 뱃지로 떨어진다.
  // 쓰는 자리: routes/tts.js('TTS'·'차임벨') · routes/mic.js('마이크'·'차임벨') ·
  //           routes/audio.js /bgm/now('BGM') · scheduler('예약'·'특보') · sequencer·watchdog('자동') ·
  //           services/alert.js('경보') · routes/switchbot.js('시스템')
  // '즉시'·'즐겨찾기'는 지금 쓰이지 않지만 **옛 행이 남아 있어** 그대로 둔다.
  const map = {
    'AI':       'purple',
    'TTS':      'primary',
    '즉시':     'success',
    '마이크':   'success',
    'BGM':      'danger',
    '자동':     'default',
    '예약':     'default',
    '차임벨':   'default',
    '즐겨찾기': 'default',
    '특보':     'warning',
    '경보':     'danger',
    '시스템':   'warning',
  }
  return <Badge variant={map[type] ?? 'default'}>{type}</Badge>
}

// 결과 상태 뱃지
export function StatusBadge({ status }) {
  if (status === 'success') return <Badge variant="success">성공</Badge>
  if (status === 'warning') return <Badge variant="warning">경고</Badge>
  if (status === 'error')   return <Badge variant="danger">오류</Badge>
  // 'fail'은 이력 화면이 쓰는 이름인데 분기가 없어서 회색 뱃지에 영문 "fail"이 그대로 떴다.
  if (status === 'fail')    return <Badge variant="danger">실패</Badge>
  // 흐름 방송은 수십 분 걸릴 수 있다. 끝나기 전까지는 실패가 아니라 진행 중이다(CC-003).
  if (status === 'running') return <Badge variant="warning">진행 중</Badge>
  return <Badge>{status}</Badge>
}
