// 방송일정 캘린더의 팝업들 (UX-20 · UX-21 · UX-23, 2026-09-11).
//
// 왜 파일을 나눴나: `WeeklySchedule.jsx` 는 달력 격자와 목록을 그리는 일만으로 이미 400줄이다.
// 팝업 셋을 거기 넣으면 한 파일이 하는 일을 한 문장으로 못 말하게 된다(구조 단순성 원칙 3).
// 이름은 저장소의 기존 규칙을 따랐다 — `musicManagementModals.jsx`·`morningEditorPanels.jsx`.
//
// **팝업은 클릭한 자리 옆에 뜬다.** 참고 이미지(구글 캘린더)가 그렇고, 화면 가운데로 날아가면
// 어느 날짜를 눌렀는지 놓친다. 화면 밖으로 나가지 않게 좌표를 접어 넣는다.
import { BGM_DEFAULT_TYPE } from '../../../lib/bgmTypes'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Trash2, Edit2, Clock, Repeat, Users, ChevronRight, AlertTriangle, Sunrise } from 'lucide-react'
import { BroadcastTypeBadge } from '../../shared/ScheduleModal'
// **가운데 모달로 만들지 않는다** — 좌표 옆에 뜨는 것이 이 부품의 요점이다(위 머리말).
// 껍데기는 제 것을 쓰되, 접근성(Escape·초점 복귀)과 닫기 단추는 공용에서 가져온다.
import useDialogA11y from '../../shared/useDialogA11y'
import CloseButton from '../../shared/CloseButton'
// 겹침 판정은 `scheduleUtils` 가 단일 출처다 — 이 팝업이 제 규칙을 또 만들면 전체 모달과
// 경고가 갈린다(실제로 한쪽에만 있었다).
import { formatRepeatLabel, formatDayLabel, findScheduleOverlaps, autoBroadcastSiblings } from '../../../lib/scheduleUtils'
import { createSchedule, deleteSchedule, toggleSchedule } from '../../../lib/api'
import { 먹은배율 } from '../../../lib/bigView'
import { 쪽지자리 } from '../../../lib/popupPlace'

// ── **확대 배율로 나눈다** (사용자 신고 2026-09-18 「브라우저 크게 해서 캘린더 보니까 바깥으로 나가버리잖아」) ──
// 크게 보기는 `<html>` 에 `zoom` 을 건다(`lib/bigView.js`). 그러면 `position:fixed` 의 `left`·`width` 가
// **배율만큼 커져서** 그려지는데, 판정에 쓰던 `innerWidth` 와 클릭 좌표(`clientX`)는 **확대 전** 화면 좌표다.
// 두 좌표계가 섞여서 1.25배·창 폭 1689 에서 오른쪽 끝 날짜를 누르면 계산은 `left: 1337px` 이었는데
// 실제로는 **1671px 에 그려져 407px 이 화면 밖**으로 나갔다(실측). 보통(1배)에서만 맞던 셈이다.
//
// 판정을 **확대된 좌표계 하나로** 맞춘다 — 창 크기와 클릭 좌표를 배율로 나누면, 거기서 정한
// `left` 가 배율만큼 커져도 창 안에 든다. 배율은 저장값이 아니라 **지금 실제로 먹은 값**을 읽는다
// (처음 안내 중 임시 배율·휴대폰 폭에서 1 로 고정되는 경우까지 저절로 맞는다).
// 화면 높이를 쓰는 CSS 가 `calc(…/var(--cc-zoom,1))` 로 나누는 것과 같은 규칙이다.
// 배율을 읽는 자리는 `lib/bigView.js` 의 `먹은배율()` 하나다(도움말 말풍선도 같은 것을 쓴다).

// 클릭 좌표 옆에 띄우되 화면 밖으로 안 나가게 접는다.
// **useMemo 다.** 그리기 전에 정해지는 값이라 effect 로 뒤늦게 setState 하면 첫 그림이
// (0,0) 에 잠깐 떴다가 튄다 — eslint(react-hooks/set-state-in-effect)도 그것을 잡는다.
function usePopupPosition(anchor, width, height) {
  // 계산 자체는 `lib/popupPlace.js` 의 순수 함수다 — 숫자를 넣어 시험할 수 있게 떼어 냈다(2026-09-18).
  // 여기서는 창 크기와 **지금 실제로 먹은 배율**만 읽어 넘긴다.
  return useMemo(() => 쪽지자리({
    anchor, width, height,
    vw: typeof window === 'undefined' ? 1280 : window.innerWidth,
    vh: typeof window === 'undefined' ? 800  : window.innerHeight,
    z:  typeof window === 'undefined' ? 1    : 먹은배율(),
  }), [anchor, width, height])
}

// 폭·높이가 **상수인 이유**: 위 `usePopupPosition` 이 화면 밖으로 나가는지 판정할 때
// 이 두 값을 쓴다. 글자를 14px 바닥으로 올리면서(T-3) 반복 라벨이 한 줄 더 내려가므로
// 둘을 같이 키웠다 — **한쪽만 키우면 팝업이 화면 밖으로 삐져나간다**(G-60 f).
function PopupShell({ anchor, width = 360, height = 360, onClose, children }) {
  const pos = usePopupPosition(anchor, width, height)
  // Escape·초점 복귀는 공용에서 온다(G-59). **스크롤은 안 잠근다** — 이것은 화면을 덮는
  // 창이 아니라 날짜 옆에 뜨는 쪽지라, 뒤쪽 달력이 굳으면 오히려 이상하다.
  const ref = useDialogA11y(true, onClose, { 스크롤잠금: false })

  return (
    <>
      {/* 바깥을 눌러도 닫힌다. 투명하지만 아래 달력의 클릭을 막아 주는 층이다. */}
      {/* **margin 0 을 인라인으로 박는다** (2026-09-18 실측). 이 쪽지는 부모(`space-y-5`) 안에 그려지는데,
          그 규칙이 형제 사이에 `margin-top: 20px` 을 준다 — 떠 있는 쪽지에도 붙어서 **20px 아래로 밀렸다.**
          계산한 자리보다 늘 20px 낮았고, 크게 보기에서는 그게 25·30px 이 돼 창 아래로 넘쳤다(1366×768 에서 10·12px).
          클래스(`m-0`)로는 못 이긴다 — `space-y` 선택자가 더 구체적이다. 인라인이 이긴다. */}
      <div className="fixed inset-0 z-[200]" style={{ margin: 0 }} onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        /* `top` 과 `bottom` 중 **하나만** 온다(위 `usePopupPosition`) — 아래쪽 날짜는
           아랫변을 고정해 위로 편다. `최대높이` 는 화면을 넘을 때의 마지막 방어선이고,
           넘치면 잘리는 대신 **쪽지 안에서 스크롤**된다. */
        style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.폭,
                 maxHeight: pos.최대높이, overflowY: 'auto', margin: 0 }}
        className="fixed z-[201] rounded-[14px] border border-ds-v3-line-2 bg-ds-v3-surface
                   p-4 shadow-v3-compose outline-none"
      >
        {children}
      </div>
    </>
  )
}

// 닫기 단추는 **공용**이다(위 import). 여기 있던 것이 그 원본이고 — 13개 중
// `aria-label` 을 가진 유일한 닫기 단추였다 — `shared/CloseButton.jsx` 로 옮기면서
// 타격 크기를 27px 에서 44px 로 키웠다(G-58).

// ── 빠른 등록 (참고 이미지 '제목 및 시간 추가') ──────────────────────────────
//
// 구글은 제목·시간만 받지만 **이 시스템은 내용 없이는 TTS 방송을 만들 수 없다**
// (`ScheduleModal` 이 빈 내용을 400 으로 막는다). 그래서 세 칸을 받고, 나머지는
// "자세히 설정"으로 전체 모달에 넘긴다 — 조용히 기본값을 지어내지 않는다.
// **「지금」 에서 시작하는 시각.** 다음 5분 자리로 올린다 — 초 단위의 지금을 넣으면
// 사람이 제목을 치는 사이에 이미 지나간 시각이 되고, 1회성 예약은 그러면 영영 안 나간다.
function 다음자리시각(now = new Date()) {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + (5 - (d.getMinutes() % 5 || 5)) + (d.getMinutes() % 5 === 0 ? 5 : 0))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function QuickCreatePopup({ dateStr, anchor, onClose, onCreated, onMoreOptions,
  이미있는것 = [], 자동방송 = null }) {
  const [title, setTitle] = useState('')
  // **09:00 을 박아 두지 않는다** (사용자 지적 2026-09-13:
  // *"설정할 때 09:00 픽스해놓는 게 아니라 지금 설정하는 시간대 갖고 와서 해야지"*).
  // 대개는 «조금 뒤»에 내보내려고 여는 창이라, 고정값이면 매번 지우고 다시 친다.
  // 다음 5분 자리로 올림한다 — 초 단위로 지금을 넣으면 저장하는 사이에 이미 지나간다.
  const [time,  setTime]  = useState(() => 다음자리시각())
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  // BGM 과 반복 — **여기서 정할 수 있어야 한다**(사용자 지시 2026-09-13).
  // 그전에는 「자세히 설정」으로 큰 창을 열어야 했다. 기본은 꺼짐이다: 켜 두면 이 창으로
  // 만든 모든 안내방송에 반주가 깔린다.
  const [bgm, setBgm] = useState(false)
  const [반복, set반복] = useState(false)
  const firstRef = useRef(null)

  useEffect(() => { firstRef.current?.focus() }, [])

  const draft = () => ({
    title: title.trim(), content: content.trim(), scheduled_time: time,
    broadcast_type: 'text', target: '전체', active: 1,
    // 이 팝업이 만드는 것은 **그 날 하루짜리** 예약이다. 반복 요일은 전체 설정에서 정한다.
    repeat_weekdays: [], repeat_start_date: dateStr, repeat_end_date: null,
    // 갈래만 정하고 검색어는 비워 둔다 — 장르 낱말은 화면에 안 적는다(사전은 서버 한 곳).
    ...(bgm ? { bgm_enabled: 1, bgm_type: BGM_DEFAULT_TYPE } : {}),
    repeat_broadcast: 반복 ? 1 : 0,
  })

  // 같은 시각에 이미 방송이 있는가 (2026-09-12).
  //
  // 예전에는 이 경고가 **「자세히 설정」에만** 있었다. 그런데 사람이 실제로 쓰는 길은
  // 여기다 — 빈 날짜를 누르고 제목·시각·내용만 적고 저장한다. 같은 분에 이미 방송이
  // 있어도 아무 말이 없었고, 두 소리가 홀에서 겹쳐 나간 뒤에야 안다.
  //
  // **규칙을 여기서 다시 쓰지 않는다.** `findScheduleOverlaps` 가 단일 출처고, 자동방송
  // 5종을 그 함수가 아는 모양으로 바꾸는 것도 이미 있는 `autoBroadcastSiblings` 가 한다.
  // 예상 종료 시각(estimate)은 이 팝업이 안 받으므로 **도는 도중 겹침은 못 본다** —
  // 같은 분 겹침만 본다. 그 한계를 알고 쓴다(전체 모달은 둘 다 본다).
  const 겹침 = findScheduleOverlaps(draft(), [
    ...이미있는것,
    ...autoBroadcastSiblings(자동방송 || {}, {}),
  ])

  const save = async () => {
    if (!title.trim())   { setError('제목을 입력해주세요.'); return }
    if (!content.trim()) { setError('방송으로 내보낼 내용을 입력해주세요. 내용 없이는 음성을 만들 수 없습니다.'); return }
    setSaving(true); setError('')
    try {
      await createSchedule(draft())
      onCreated(`${formatDayLabel(dateStr)}에 예약을 추가했습니다`)
    } catch (e) {
      if (!e.cancelled) setError(e.message || '저장하지 못했습니다.')
      setSaving(false)
    }
  }

  // 경고가 뜨면 그만큼 키운다 — 고정 높이에 끼워 넣으면 「저장」이 잘려 나간다.
  // PopupShell 은 이 값으로 화면 밖으로 넘칠지를 계산하므로, 실제 높이와 맞아야 한다.
  return (
    // 390 → 420 (2026-09-18 실측: BGM·반복 칸이 들어간 뒤 실제 높이가 404px 이었다 — 어림이 작으면 「저장」이 쪽지 안 스크롤 아래로 숨는다).
    <PopupShell anchor={anchor} width={360} height={겹침.length > 0 ? 510 : 420} onClose={onClose}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[11px] text-ds-v3-ink-2">{formatDayLabel(dateStr)}</p>
          <h3 className="text-sm font-semibold text-ds-v3-ink mt-0.5">새 방송 예약</h3>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <label className="block">
        <span className="sr-only">제목</span>
        <input ref={firstRef} value={title} onChange={e => setTitle(e.target.value)}
          placeholder="제목 (예: 프로그램 안내)"
          className="w-full border-0 border-b-2 border-ds-v3-line focus:border-ds-v3-tts
                     text-base py-1.5 outline-none bg-transparent" />
      </label>

      <div className="flex items-center gap-2 mt-4">
        <Clock size={14} className="text-ds-v3-ink-2 shrink-0" />
        <input type="time" value={time} onChange={e => setTime(e.target.value)}
          aria-label="방송 시각"
          className="border border-ds-v3-line rounded-btn px-2 py-1.5 text-sm nums" />
        <span className="text-xs text-ds-v3-ink-2">에 한 번</span>
      </div>

      <label className="block mt-3">
        <span className="text-[11px] text-ds-v3-ink-2">방송 내용 (음성으로 읽습니다)</span>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={3}
          placeholder="어르신들께 안내할 말을 그대로 적어주세요."
          className="w-full mt-1 border border-ds-v3-line rounded-btn px-2.5 py-2 text-sm
                     resize-none outline-none focus:border-ds-v3-tts" />
      </label>

      {/* ── 내용 **바로 밑**에 BGM 과 반복 (사용자 지시 2026-09-13) ────────────────────
          *"새방송예약 저거 tts 밑에 BGM이랑 반복방송 쳐 넣으라고"*
          예약 하나가 내는 소리는 대개 둘(안내 + 반주)인데, 반주를 정하려면 「자세히 설정」으로
          큰 창을 열어야 했다. 여기서 끝낼 수 있게 둘만 올린다 — 세부(검색어·볼륨·요일)는
          여전히 「자세히 설정」이다. 이 창의 값은 그대로 들고 넘어간다. */}
      <div className="mt-3 space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={bgm} onChange={e => setBgm(e.target.checked)}
            className="w-4 h-4 accent-ds-v3-tts" />
          <span className="text-[11px] text-ds-v3-ink-2">
            BGM 재생 <span className="opacity-70">— 반주가 먼저 나오고 안내가 이어집니다</span>
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={반복} onChange={e => set반복(e.target.checked)}
            className="w-4 h-4 accent-ds-v3-tts" />
          <span className="text-[11px] text-ds-v3-ink-2">
            방송 2회 반복 <span className="opacity-70">— 「다시 한번 알려드립니다」 뒤에 한 번 더</span>
          </span>
        </label>
      </div>

      {/* 같은 분에 이미 방송이 있으면 **막지 않고 말한다.** 겹쳐 내보내야 할 때도 있고
          (1·2차로 나눈 환기방송), 막아 버리면 사람이 우회로를 찾는다. 무엇과 겹치는지
          이름을 대야 "그럼 5분 미루자"를 그 자리에서 결정할 수 있다. */}
      {겹침.length > 0 && (
        <div role="status" className="mt-2 px-2.5 py-2 rounded-btn bg-ds-v3-surface-2 border border-ds-v3-line">
          <p className="text-xs font-semibold text-ds-v3-ink-2 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            이미 {time} 에 나가는 방송이 있습니다 — 소리가 겹칩니다.
          </p>
          <ul className="mt-1 text-[11px] text-ds-v3-ink-2 space-y-0.5">
            {겹침.slice(0, 3).map(o => (
              <li key={`${o.isAuto ? 'auto' : 'row'}-${o.id}`} className="truncate">
                · {o.time} {o.title}{o.isAuto ? ' (자동방송)' : ''}
              </li>
            ))}
            {겹침.length > 3 && <li>· 외 {겹침.length - 3}건</li>}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-ds-v3-warn flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}
        </p>
      )}

      <div className="flex items-center justify-between mt-4">
        <button onClick={() => onMoreOptions(draft())}
          className="text-xs text-ds-v3-ink-2 hover:text-ds-v3-tts underline min-h-[24px] inline-flex items-center">
          자세히 설정
        </button>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 rounded-btn text-sm font-semibold text-white bg-ds-v3-ink
                     hover:bg-ds-v3-ink disabled:opacity-50 btn-press transition-colors">
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </PopupShell>
  )
}

// ── 일정 상세 (참고 이미지 '국군의날' 팝업) ─────────────────────────────────
//
// **`items` 는 배열이다.** 1·2차로 나뉜 같은 방송(환기방송 시작/종료)은 달력에서 한 칩으로
// 접히는데, 예전엔 이 팝업이 **첫 건만** 받아서 "2건"이라 표시해 놓고 삭제는 1차만 했다
// (2026-09-11 독립 검수 지적). 현장 예약 6건이 전부 그 모양이라, 그러면 "창문 여세요"는
// 나가고 "닫으세요"는 안 나간다. 오류도 경고도 없이.
//
// 그래서 묶음이면 **회차를 다 보여주고 무엇을 지울지 사람이 고르게** 한다.
export function EventDetailPopup({ items, dateStr, anchor, onClose, onEdit, onChanged, onToast }) {
  const [busy, setBusy] = useState(false)
  const 묶음 = Array.isArray(items) ? items : [items]
  const item = 묶음[0]
  const 여러건 = 묶음.length > 1

  const removeOne = async (대상, 문구) => {
    if (!confirm(문구)) return
    setBusy(true)
    try { await deleteSchedule(대상.id); onChanged(); onToast('예약을 삭제했습니다'); onClose() }
    catch (e) { alert(e.message); setBusy(false) }
  }

  const removeAll = async () => {
    if (!confirm(`"${item.title}" ${묶음.length}건을 모두 삭제하시겠습니까?\n\n`
      + 묶음.map((s, i) => `${i + 1}차 ${s.scheduled_time}`).join('\n'))) return
    setBusy(true)
    try {
      // **하나라도 실패하면 멈추고 알린다.** 조용히 반쯤 지우면 그것이 바로 이 결함의 재발이다.
      for (const s of 묶음) await deleteSchedule(s.id)
      onChanged(); onToast(`${묶음.length}건을 삭제했습니다`); onClose()
    } catch (e) {
      onChanged()   // 지워진 것까지는 화면에 반영한다
      alert(`일부만 삭제됐습니다: ${e.message}`)
      setBusy(false)
    }
  }

  const remove = () => (여러건
    ? removeAll()
    : removeOne(item, `"${item.title}" 예약을 삭제하시겠습니까?`))

  // **목표 상태를 먼저 정하고, 어긋난 건만 뒤집는다** (2026-09-11 독립 검수 지적).
  //
  // 예전엔 `묶음` 을 돌며 `toggleSchedule(id)` 를 그냥 N번 불렀다. 그런데 그 라우트는
  // **목표 상태를 안 받고 각 행의 현재 값을 뒤집는다**(`routes/schedules.js:369-381`).
  // 그래서 1차만 멈춘 상태의 환기방송 쌍에서 "2건 모두 잠시 멈추기"를 누르면
  // **1차 켜짐 · 2차 멈춤**으로 서로 뒤바뀌었다 — "창문 여세요"만 나가고 "닫으세요"는 안 나간다.
  // 없앴다고 커밋에 적었던 바로 그 그림이 이 경로에 남아 있었다.
  //
  // 상태가 갈린 쌍은 실제로 만들어진다 — 예약 목록 화면(`ScheduledBroadcast.jsx`)에서
  // 묶음을 펼쳐 한 건만 멈출 수 있다.
  const 켤까 = !묶음.every(s => s.active)   // 하나라도 꺼져 있으면 "모두 켜기"가 목표다

  const toggle = async () => {
    setBusy(true)
    try {
      // 이미 목표 상태인 건은 건드리지 않는다 — 뒤집으면 되레 어긋난다.
      for (const s of 묶음) {
        if (!!s.active === 켤까) continue
        await toggleSchedule(s.id)
      }
      onChanged()
      onToast(켤까
        ? (여러건 ? `${묶음.length}건을 다시 켰습니다` : '다시 방송하도록 켰습니다')
        : (여러건 ? `${묶음.length}건을 잠시 멈췄습니다` : '이 예약을 잠시 멈췄습니다'))
      onClose()
    } catch (e) {
      onChanged()
      // 어디까지 갔는지 모르는 채로 닫지 않는다 — 목록에서 각 건을 직접 보게 한다.
      alert(`일부만 바뀌었습니다: ${e.message}\n예약 목록에서 각 회차의 상태를 확인해 주세요.`)
      setBusy(false)
    }
  }

  return (
    <PopupShell anchor={anchor} width={360} height={300} onClose={onClose}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="mt-1.5 w-3 h-3 rounded-[4px] shrink-0 bg-ds-v3-tts" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ds-v3-ink break-words">{item.title}</h3>
            <p className="text-xs text-ds-v3-ink-2 mt-0.5 nums">
              {formatDayLabel(dateStr)} · {여러건
                ? `${묶음[0].scheduled_time}~${묶음[묶음.length - 1].scheduled_time}`
                : item.scheduled_time}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={remove} disabled={busy}
            aria-label={여러건 ? `${묶음.length}건 모두 삭제` : '삭제'}
            title={여러건 ? `${묶음.length}건을 모두 삭제합니다` : undefined}
            className="p-1.5 rounded-full text-ds-v3-ink-2 hover:text-ds-v3-warn hover:bg-ds-v3-warn-bg transition-colors btn-press">
            <Trash2 size={15} />
          </button>
          <button onClick={() => onEdit(item)}
            aria-label={여러건 ? '1차 수정' : '수정'}
            title={여러건 ? '1차부터 수정합니다' : undefined}
            className="p-1.5 rounded-full text-ds-v3-ink-2 hover:text-ds-v3-tts hover:bg-ds-v3-tts-bg transition-colors btn-press">
            <Edit2 size={15} />
          </button>
          <CloseButton onClose={onClose} />
        </div>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <BroadcastTypeBadge type={item.broadcast_type} />
          {!item.active && (
            <span className="text-[11px] font-semibold text-ds-v3-ink-2 bg-ds-v3-bg border border-ds-v3-line px-2 py-0.5 rounded-full">
              일시정지
            </span>
          )}
        </div>
        {여러건 && (
          <div className="rounded-btn border border-ds-v3-line bg-ds-v3-surface-2 px-3 py-2">
            <p className="text-xs font-semibold text-ds-v3-ink-2 mb-1.5">
              이 방송은 {묶음.length}건이 한 쌍입니다 — 하나만 지우면 나머지가 혼자 나갑니다
            </p>
            <ul className="space-y-1">
              {묶음.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="nums font-semibold text-ds-v3-ink-2 w-12 shrink-0">{s.scheduled_time}</span>
                  <span className="text-ds-v3-ink truncate">{s.content || s.title}</span>
                  <button
                    onClick={() => removeOne(s, `${i + 1}차(${s.scheduled_time})만 삭제하시겠습니까?
나머지 ${묶음.length - 1}건은 그대로 나갑니다.`)}
                    disabled={busy}
                    className="ml-auto shrink-0 text-[11px] text-ds-v3-ink-2 hover:text-ds-v3-warn underline disabled:opacity-50">
                    이것만 삭제
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!여러건 && item.content && (
          <p className="text-ds-v3-ink bg-ds-v3-bg border border-ds-v3-line rounded-btn px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
            {item.content}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-ds-v3-ink-2">
          <Repeat size={13} className="shrink-0" /> {formatRepeatLabel(item)}
        </div>
        <div className="flex items-center gap-2 text-xs text-ds-v3-ink-2">
          <Users size={13} className="shrink-0" /> {item.target || '전체'}
        </div>
      </div>

      <button onClick={toggle} disabled={busy}
        className="mt-4 w-full py-2 rounded-btn text-sm font-normal border border-ds-v3-line
                   text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-ds-v3-bg btn-press transition-colors disabled:opacity-50">
        {/* `item.active`(1차)가 아니라 **묶음 전체**로 정한다 — 안 그러면 1차만 멈춘 쌍에서
            "2건 모두 잠시 멈추기"라고 적어 놓고 실제로는 켜는 쪽으로 동작한다. */}
        {켤까
          ? (여러건 ? `${묶음.length}건 모두 다시 켜기` : '다시 방송하도록 켜기')
          : (여러건 ? `${묶음.length}건 모두 잠시 멈추기` : '이 예약 잠시 멈추기')}
      </button>
    </PopupShell>
  )
}

// ── 자동방송 묶음 (UX-24) ───────────────────────────────────────────────────
//
// 자동방송은 날짜마다 한 칩으로 접혀 있다. 눌러야 안이 보인다.
// **여기서는 지우거나 날짜를 옮기지 못한다** — 자동방송 5종은 `settings` 의 시각 하나로
// 매일 도는 것이라 "이 날짜의 그 회차"에 해당하는 저장 자리가 없다(UX-23 해석 기록).
// 그래서 바꾸는 길은 '자동방송 편집' 하나뿐이고, 그 사실을 숨기지 않고 적는다.
export function AutoGroupPopup({ items, dateStr, anchor, onClose, onGoAutoEditor }) {
  return (
    <PopupShell anchor={anchor} width={340} height={300} onClose={onClose}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-2.5">
          <Sunrise size={16} className="text-ds-v3-tts mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-ds-v3-ink">자동방송 {items.length}종</h3>
            <p className="text-[11px] text-ds-v3-ink-2 mt-0.5">{formatDayLabel(dateStr)} · 매일 같은 시각</p>
          </div>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <ul className="space-y-1.5">
        {items.map(it => (
          <li key={it.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-btn bg-ds-v3-tts-bg/60 border border-ds-v3-line">
            <span className="nums text-sm font-semibold text-ds-v3-tts w-12 shrink-0">{it.scheduled_time}</span>
            <span className="text-sm text-ds-v3-ink truncate">{it.title}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-ds-v3-ink-2 leading-relaxed">
        자동방송은 <span className="font-semibold text-ds-v3-ink">날마다 같은 시각</span>에 나갑니다.
        그래서 <span className="font-semibold text-ds-v3-ink">이 날짜만 옮기거나 지울 수 없습니다</span> —
        시각·순서를 바꾸면 그날 이후 모든 날에 적용됩니다.
      </p>

      <button onClick={onGoAutoEditor}
        className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-btn text-sm
                   font-semibold text-ds-v3-tts border border-ds-v3-tts/30 bg-ds-v3-tts-bg
                   hover:bg-ds-v3-tts-bg btn-press transition-colors">
        자동방송 편집에서 바꾸기 <ChevronRight size={14} />
      </button>
    </PopupShell>
  )
}

// ── 옮기기 확인 (UX-22 · UX-23) ─────────────────────────────────────────────
//
// 끌어서 옮길 때 **무엇이 바뀌는지 먼저 말한다.** 반복 예약을 말없이 옮기면 그 사람은
// "오늘 하루만 옮겼다"고 믿는데 실제로는 앞으로 모든 회차가 옮겨진다.
export function MoveConfirmPopup({ plan, anchor, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); await onConfirm(); }
  return (
    <PopupShell anchor={anchor} width={340} height={220} onClose={onClose}>
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-semibold text-ds-v3-ink flex items-center gap-2">
          <AlertTriangle size={15} className="text-ds-v3-ink-2" /> 옮기기 전에 확인해주세요
        </h3>
        <CloseButton onClose={onClose} />
      </div>
      <p className="text-sm text-ds-v3-ink leading-relaxed">{plan.message}</p>
      {plan.detail && <p className="mt-2 text-xs text-ds-v3-ink-2 leading-relaxed">{plan.detail}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onClose}
          className="px-3 py-2 rounded-btn text-sm text-ds-v3-ink-2 border border-ds-v3-line hover:bg-ds-v3-bg btn-press transition-colors">
          그대로 두기
        </button>
        <button onClick={go} disabled={busy || !plan.allowed}
          className="px-4 py-2 rounded-btn text-sm font-semibold text-white bg-ds-v3-ink
                     hover:bg-ds-v3-ink disabled:opacity-40 btn-press transition-colors">
          {busy ? '옮기는 중…' : '옮기기'}
        </button>
      </div>
    </PopupShell>
  )
}
