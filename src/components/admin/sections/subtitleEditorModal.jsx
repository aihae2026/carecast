// 음원 자막 편집기.
//
// 두 가지 자리에서 쓴다: 음원 관리 화면의 **파일 펼침 패널 안(인라인)**이 기본이고,
// 모달은 껍데기만 씌운 것이다. 자막을 "따로 하는 일"로 두면 아무도 안 해서, 파일을 고른
// 그 자리에서 바로 하도록 옮겼다.
//
// 왜 별도 파일인가: musicManagementModals.jsx는 입력 몇 칸짜리 짧은 모달 모음인데, 이건
// 오디오를 쥐고 키보드를 듣고 매 프레임 자리를 갱신한다. 성격이 달라서 섞지 않았다.
//
// ── **세 단계로 보여준다** (사용자 지시 2026-09-16) ────────────────────────────
// *"지금 작업 형태가 복잡해, 딱 자막 초안생성 - AI 고치기 - 확인 및 저장 이런 플로우로"*
//
// 할 일은 예전과 같다. 달라진 것은 **어디쯤 왔는지가 보인다**는 것이다. 앞 판은 단추가
// 여기저기 흩어져 있어서, 처음 여는 사람이 무엇부터 눌러야 하는지 알 수 없었다.
//
//   ① 초안 만들기 — 받아쓰기 / 기본 문구 불러오기 / 직접 치기
//   ② AI 로 고치기 — 받아쓴 글자의 오탈자를 잡는다(정본이 있는 음원은 건너뛴다)
//   ③ 확인하고 저장 — 들어 보고, 밀렸으면 맞추고, 방송에 쓴다
//
// 단계는 **막지 않는다.** 아무 때나 앞뒤로 갈 수 있다 — 막으면 급할 때 길이 없다.
// 다만 **지금 무엇을 할 차례인지**를 진하게 표시한다.
//
// 만드는 순서는 글자가 먼저, 타이밍이 나중이다:
//   1. 왼쪽 칸에 문구를 줄 단위로 적는다(개행 하나가 자막 한 줄).
//   2. "싱크 시작"을 누르면 소리가 나온다. 줄이 시작될 때마다 **스페이스바**를 누른다.
//      노래방 자막을 만드는 방식 그대로다.
//   3. 어긋난 줄은 ◀ ▶로 0.1초씩 민다. 전체가 밀렸으면 "전체 밀기"로 한 번에 옮긴다.
//
// 저장은 두 갈래다. "초안 저장"은 남겨만 두고, "저장하고 방송에 쓰기"를 눌러야 방송 화면에
// 나간다 — 받아쓰기나 AI가 만든 자막을 사람 확인 없이 홀에 내보내지 않기 위한 관문이다
// (CLAUDE.md 검토 게이트).
import { useState, useEffect, useRef, useCallback } from 'react'
// 껍데기·닫기 단추·확인창은 **한 곳에서 온다**(G-53).
import ModalShell from '../../shared/ModalShell'
import CloseButton from '../../shared/CloseButton'
import ConfirmDialog from '../../shared/ConfirmDialog'
import { Play, Pause, Save, CheckCircle2, RotateCcw, ChevronLeft, ChevronRight, Mic, FileText, Loader2, Sparkles, Trash2 } from 'lucide-react'
import {
  API_URL, getAudioSubtitle, saveAudioSubtitle, deleteAudioSubtitle,
  transcribeAudioSubtitle, getSubtitleDefaultText, polishAudioSubtitle, getSubtitleProgress,
  installSttEngine,
} from '../../../lib/api'
import { BroadcastCaption } from '../../broadcast/BroadcastCaption'
import { audioBus } from '../../../lib/audioBus'
import { skyAt, blobLayer } from '../../../lib/skyPalette'

// 미리보기 배경 — **실제 방송 화면과 같은 하늘**을 쓴다(`lib/skyPalette.js`).
//
// 여기 옛 사탕색 그라디언트(민트→라임) 하나가 손으로 적혀 있었다. 2026-09-13 에 방송
// 화면이 시간대 하늘로 바뀌면서 그 그라디언트는 제품에서 사라졌는데 **이 미리보기에만
// 남아 있었다** — 확인하라고 만든 화면이 실제와 다른 것을 보여 주고 있었던 셈이다.
//
// 지금 시각의 하늘을 그대로 쓴다. 자막을 만드는 시간대가 곧 그 방송이 나갈 시간대인 경우가
// 많고, 아니어도 **제품에 실제로 있는 배경 위에서** 글씨가 읽히는지 보는 것이 요점이다.
const 하늘 = skyAt()
const PREVIEW_BG = 하늘.blobs.map(blobLayer).join(', ')
const PREVIEW_BASE = 하늘.base

// 세 단계 — 화면 머리줄에 그대로 그린다(사용자 지시 2026-09-16).
// **부품 밖에 둔다**: 매 렌더마다 새 배열을 만들 이유가 없고, 시험이 그대로 읽을 수 있다.
const 단계표 = [
  { 번호: 1, 이름: '초안 만들기',   한줄: '받아쓰기 · 기본 문구 · 직접 치기' },
  { 번호: 2, 이름: 'AI 로 고치기',  한줄: '잘못 들은 글자를 잡습니다' },
  { 번호: 3, 이름: '확인하고 저장', 한줄: '들어 보고 방송에 씁니다' },
]

const NUDGE = 0.1        // ◀ ▶ 한 번에 미는 초
const MIN_LINE = 0.35    // 줄 하나가 가질 수 있는 가장 짧은 길이(초)

const fmt = (t) => {
  const s = Math.max(0, Number(t) || 0)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`
}

export function SubtitleEditor({ file, onClose, onChanged, embedded = false }) {
  const [text,   setText]   = useState('')      // 왼쪽 칸(개행 = 줄)
  const [marks,  setMarks]  = useState([])      // 줄마다 찍은 시작 시각(초). null이면 아직 안 찍음
  const [status, setStatus] = useState('draft')
  // **서버에 저장된 자막이 있는가.** 편집칸에 글자가 있는 것과 다르다 — 방금 받아쓰기로 채워
  // 놓고 아직 저장 안 한 상태에서 "지우기"를 띄우면 지울 것이 없는 단추가 된다.
  const [saved,  setSaved]  = useState(false)
  // **마지막으로 저장·불러온 모습.** `saved` 와 다르다 — 그것은 "서버에 자막이 있나"이고,
  // 이것은 "그 뒤로 사람이 손댔나"다. 자막은 받아쓰기 결과를 사람이 고친 것이라,
  // 실수로 창을 닫으면 **그 손질이 통째로 사라진다**(G-57).
  const [기준, set기준] = useState(() => JSON.stringify(['', []]))
  const [닫기물음, set닫기물음] = useState(false)
  const [source, setSource] = useState('manual')
  const [playing, setPlaying] = useState(false)
  const [now,    setNow]    = useState(0)
  const [dur,    setDur]    = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg,    setMsg]    = useState('')
  // ── **오류를 안내와 같은 자리에 같은 모양으로 적지 않는다** (현장 지적 2026-09-15) ────
  //
  // *"자막 생성이 안 돌아가"* — 실제로는 **돌다가 실패했고, 그 말이 화면에 있었다.**
  // 다만 모달 **맨 아래 한 줄에 `truncate` 로 잘린 채** 였고, 이 편집기는 길어서
  // 그 줄이 화면 밖이었다. 사람에게는 **아무 일도 안 일어난 것**으로 보인다.
  //
  // 받아쓰기는 이 PC 에 **파이썬과 faster-whisper 가 있어야** 돈다. 없으면
  // 「…이 PC에 없습니다」라고 정확히 말해 주는데, 그 말이 안 보이면 없는 것과 같다.
  // 그래서 오류는 **누른 단추 바로 아래에, 안 잘리게, 눈에 띄는 색으로** 띄운다.
  const [오류, set오류] = useState('')
  // 받아쓰기 프로그램이 **없어서** 실패했나. 그렇다면 그 자리에서 설치할 수 있다.
  const [설치가능, set설치가능] = useState(false)
  const 오류로 = (m) => { set오류(String(m || '알 수 없는 오류')); setMsg('') }
  const [busy,   setBusy]   = useState('')      // '받아쓰는 중' 같은 진행 표시

  // 받아쓰기 프로그램 설치. 몇 분 걸린다 — 도는 동안 무엇을 하는 중인지 계속 보여준다.
  // **`busy` 선언보다 아래에 둔다.** 지금은 onClick 에서만 불려서 위에 둬도 돌지만,
  // 이 저장소는 그 모양으로 한 번 크게 데였다(`useAudioListener` 의 TDZ 크래시,
  // V③ UI-0915-R1). 선언 순서를 지키면 나중에 누가 즉시 호출로 바꿔도 안 터진다.
  const 설치하기 = async () => {
    set오류('')
    setBusy('받아쓰기 프로그램 설치 중 — 몇 분 걸립니다')
    try {
      const r = await installSttEngine()
      set설치가능(false)
      setMsg(r.message || '설치했습니다. 「자동으로 만들기」를 다시 눌러 주세요.')
    } catch (e) {
      오류로(e.message)
    } finally { setBusy('') }
  }
  const [defaultText, setDefaultText] = useState(null)   // 이 카테고리에 정해진 문구(없으면 null)
  const [previewScale, setPreviewScale] = useState(0.25)
  // 다음에 찍을 줄. nextRef와 같은 값이지만 **화면을 다시 그리려면** 상태여야 한다 —
  // ref만 쓰면 스페이스바를 눌러도 왼쪽 목록이 안 움직인다.
  const [tapAt,  setTapAt]  = useState(0)
  // 무엇을 하는 중인가. **기본은 '확인'이다** — 자막은 이미 자동으로 만들어져 있고,
  // 사람이 할 일은 한 번 들어 보고 승인하는 것뿐이다. 예전엔 첫 화면이 "1. 문구 / 2. 타이밍"
  // 이라 매번 손으로 찍어야 하는 것처럼 보였다(사용자 지적: "일일이 하기 불편하다").
  const [mode, setMode] = useState('check')   // 'check' | 'text' | 'timing'
  // **지금 몇 단계인가**(2026-09-16). `mode` 와 다른 축이다 — `mode` 는 「이 순간 무엇을
  // 조작하는가」이고, 단계는 「전체에서 어디쯤 왔는가」다. 둘을 하나로 묶으려다 앞 판이
  // 복잡해졌다. 초안이 생기면 ②로 스스로 넘어간다(사람이 한 번 더 누르게 하지 않는다).
  const [단계, set단계] = useState(1)
  // 받아쓰기 진행률. 도는 동안 아무 표시가 없으면 사람이 다시 누르거나 창을 닫는다.
  const [prog, setProg] = useState(null)      // null | { percent, doneSec, totalSec, elapsedSec }

  const audioRef = useRef(null)
  const busRef   = useRef(null)
  const rafRef   = useRef(0)
  const nextRef  = useRef(0)        // 다음에 찍을 줄 번호
  const previewRef = useRef(null)   // 미리보기 상자(실제 화면 대비 얼마나 작은지 잰다)
  const tapRowRef  = useRef(null)   // 지금 찍을 줄 — 화면 밖으로 나가면 따라 올린다
  // 키 핸들러가 늘 최신 콜백을 보게 하는 통로. 의존 목록에 직접 넣으면 리스너가 매번
  // 떼었다 붙었다 하면서 키를 흘린다.
  const playRef    = useRef(null)
  const stopRef    = useRef(null)
  const playingRef = useRef(false)

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  // 지금 소리가 어느 줄에 와 있나. 찍는 자리(파랑)와 **따로** 표시한다 — 이미 다 찍어 둔
  // 자막을 검토할 때는 찍을 자리가 안 움직여서, 이게 없으면 왼쪽이 가만히 있는다.
  // 이 값을 의존 목록에 쓰는 효과가 아래에 있으므로 **선언이 먼저여야 한다**(let은 TDZ라
  // 아래에 두면 화면이 통째로 터진다).
  let 재생줄 = -1
  for (let i = 0; i < lines.length; i++) {
    if (marks[i] != null && now >= marks[i]) 재생줄 = i
  }

  // ── 저장된 자막 불러오기 ──────────────────────────────────────
  useEffect(() => {
    let alive = true
    getAudioSubtitle(file.id).then(({ subtitle }) => {
      if (!alive || !subtitle) return
      const 글 = subtitle.cues.lines.map((l) => l.text).join('\n')
      const 시각 = subtitle.cues.lines.map((l) => l.s)
      setText(글)
      setMarks(시각)
      setStatus(subtitle.status)
      setSource(subtitle.source)
      setSaved(true)
      // **이미 있는 자막은 ③(확인)에서 연다**(2026-09-16). 만들 것이 없는데 ①「초안
      // 만들기」를 띄우면, 한 줄 고치러 온 사람에게 *"처음부터 다시 만들라"* 로 읽힌다 —
      // 이 화면이 예전에 정확히 그래서 *"일일이 하기 불편하다"* 는 말을 들었다.
      set단계(3); setMode('check')
      // 불러온 이 모습이 **기준**이다 — 여기서부터 사람이 손댄 것만 "고쳤다"로 본다.
      set기준(JSON.stringify([글, 시각]))
    }).catch((e) => 오류로(`불러오지 못했습니다: ${e.message}`))
    return () => { alive = false }
  }, [file.id])

  // 이 카테고리에 정해진 문구가 있으면 "기본 문구 불러오기" 버튼을 띄운다.
  useEffect(() => {
    let alive = true
    getSubtitleDefaultText(file.id)
      .then(({ text: t }) => { if (alive) setDefaultText(t || null) })
      .catch(() => { /* 없으면 버튼만 안 뜬다 — 편집은 그대로 된다 */ })
    return () => { alive = false }
  }, [file.id])

  // 미리보기는 **실제 화면의 축소판**이어야 한다. 자막 글씨는 화면 폭(vw) 기준이라 상자만
  // 줄이면 글씨는 그대로 커서, 실제로 몇 글자가 들어가는지 못 본다. 상자가 지금 창의 몇 분의
  // 일인지 재서 글씨도 같은 비율로 줄인다.
  useEffect(() => {
    const measure = () => {
      const w = previewRef.current?.clientWidth
      if (w) setPreviewScale(w / window.innerWidth)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // ── 오디오 ───────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio(`${API_URL}/audio/${file.category}/${file.filename}`)
    audioRef.current = audio
    audio.addEventListener('loadedmetadata', () => setDur(audio.duration || 0))
    audio.addEventListener('ended', () => setPlaying(false))

    const tick = () => { setNow(audio.currentTime); rafRef.current = requestAnimationFrame(tick) }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      audio.pause()
      audioRef.current = null
      // 미리듣기와 같은 규칙 — 이 창을 닫으면 장부에서도 내린다.
      busRef.current?.done(); busRef.current = null
      window.dispatchEvent(new CustomEvent('carecast:caption-end', { detail: { preview: true } }))
    }
  }, [file.category, file.filename])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    setPlaying(false)
    busRef.current?.done(); busRef.current = null
    window.dispatchEvent(new CustomEvent('carecast:caption-end', { detail: { preview: true } }))
  }, [])

  useEffect(() => { playingRef.current = playing }, [playing])

  const play = useCallback((from) => {
    const audio = audioRef.current
    if (!audio) return
    if (typeof from === 'number') audio.currentTime = from
    // [audioBus] 편집기 재생도 장부에 올린다 — 관리자 화면에서 나는 소리도 "누가 내는지"가
    // 보여야 한다(미리듣기와 같은 규칙).
    busRef.current?.done()
    busRef.current = audioBus.register({ kind: 'preview-audio', label: `자막 편집 · ${file.original_name}`, stop })
    audio.play().then(() => setPlaying(true)).catch((e) => 오류로(`재생할 수 없습니다: ${e.message}`))
  }, [file.original_name, stop])

  // ── 미리보기 ─────────────────────────────────────────────────
  //
  // 실제 방송 화면과 **같은 컴포넌트**(BroadcastCaption)로 그린다. 미리보기용 렌더러를 따로
  // 만들면 둘이 어긋나서, 여기서 잘 보이던 자막이 홀에서는 다르게 나온다.
  // 의존 목록에 `lines`(매 렌더 새 배열)를 넣으면 안 된다. 넣으면 렌더마다 이 효과가 다시
  // 돌고, 새 cue를 받은 자막이 줄 번호를 -1로 되돌리는 바람에 **미리보기가 영영 비어 있다**
  // (실제로 그렇게 났다). 텍스트에서 줄을 여기서 다시 만든다.
  useEffect(() => {
    if (!playing) return
    const 줄들 = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const out = []
    for (let i = 0; i < 줄들.length; i++) {
      const s = marks[i]
      if (s == null) continue                       // 아직 안 찍은 줄은 빼고 보여준다
      const e = marks[i + 1] != null ? marks[i + 1] : (dur || s + 3)
      out.push({ s, e: Math.max(e, s + MIN_LINE), text: 줄들[i] })
    }
    if (!out.length) return
    window.dispatchEvent(new CustomEvent('carecast:caption-cue', {
      detail: { preview: true, kind: 'preview', title: file.original_name,
                cues: { v: 1, src: 'manual', lines: out }, leadMs: 0 },
    }))
    if (audioRef.current) {
      window.dispatchEvent(new CustomEvent('carecast:caption-attach',
        { detail: { preview: true, audio: audioRef.current } }))
    }
    // text/marks가 바뀔 때마다 다시 보낸다 — 스페이스바를 누르는 즉시 미리보기에 반영된다.
  }, [playing, text, marks, dur, file.original_name])

  useEffect(() => { playRef.current = play; stopRef.current = stop }, [play, stop])

  // ── 탭 싱크: 줄이 시작될 때 스페이스바 ────────────────────────
  const mark = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !lines.length) return
    const i = nextRef.current
    if (i >= lines.length) return
    setMarks((prev) => {
      const next = [...prev]
      next.length = lines.length
      next[i] = Number(audio.currentTime.toFixed(2))
      return next
    })
    nextRef.current = i + 1
    setTapAt(i + 1)
  }, [lines.length])

  // 스페이스는 **타이밍 맞추기 모드에서만** 찍기다.
  // 예전엔 항상 찍기였다 — 확인만 하려던 사람이 습관대로 스페이스(일시정지)를 누르면
  // 1번 줄 시각이 조용히 덮어써졌다. 말이 아니라 데이터를 망치는 함정이었다.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      // 글을 쓰는 중이면 스페이스는 띄어쓰기다.
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (mode === 'text') return
      e.preventDefault()
      e.stopPropagation()   // 오버레이의 ESC 처리와 달리, 이 키는 여기서 끝난다
      if (mode === 'timing') mark()
      else if (playingRef.current) stopRef.current?.()   // 확인 모드: 재생/정지
      else playRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mark, mode])

  // 찍을 줄이 목록 밖으로 밀려나면 사람이 못 따라간다 — 늘 보이게 끌어온다.
  useEffect(() => {
    tapRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [tapAt, 재생줄])

  // ── 줄 시각 다루기 ───────────────────────────────────────────
  const nudge = (i, by) => setMarks((prev) => {
    const next = [...prev]
    if (next[i] == null) return prev
    next[i] = Math.max(0, Number((next[i] + by).toFixed(2)))
    return next
  })

  // 녹음은 앞에 무음이 붙거나 페이드가 있어서 **통째로 일정하게** 밀리는 일이 많다.
  // 대부분 이 버튼 한 번으로 끝난다.
  const shiftAll = (by) => setMarks((prev) =>
    prev.map((m) => (m == null ? m : Math.max(0, Number((m + by).toFixed(2))))))

  const restart = () => { nextRef.current = 0; setTapAt(0); setMarks([]); play(0) }

  // ── 문구 채우기 ──────────────────────────────────────────────
  //
  // 빈 칸을 사람이 처음부터 치게 두면 아무도 안 쓴다. 두 가지 길을 준다:
  //  · 정해진 문구가 있는 음원(식사 안내)은 그 문구를 그대로 가져온다.
  //  · 그 외에는 받아쓰기로 뽑는다. 받아쓰기는 틀리므로 **가져오기만 하고 저장은 안 한다** —
  //    사람이 보고 고친 뒤 저장 버튼을 누른다(CLAUDE.md 검토 게이트).
  const applyCues = (cues, 새source) => {
    setText(cues.lines.map((l) => l.text).join('\n'))
    setMarks(cues.lines.map((l) => l.s))
    if (새source) setSource(새source)
    nextRef.current = 0
    setTapAt(0)
  }

  const fillFromDefault = () => {
    if (!defaultText) return
    stop()
    // 줄 나누기는 저장할 때 쓰는 것과 같은 규칙이 아니라 사람이 보기 좋게 문장 단위로 준다 —
    // 어차피 사람이 칸에서 자유롭게 고친다.
    setText(defaultText.split(/(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean).join('\n'))
    setMarks([])
    nextRef.current = 0
    setTapAt(0)
    setSource('manual')
    // **초안이 생겼으니 다음 단계다.** 사람이 한 번 더 누르게 하지 않는다.
    // 기본 문구는 이미 정본이라 AI 로 고칠 것이 없다 — ③(확인)으로 바로 간다.
    set단계(3); setMode('check')
    setMsg('문구를 불러왔습니다. 이제 재생하며 스페이스바로 타이밍을 찍어주세요.')
  }

  // 받아쓰기는 시각을 잘 잡고 글자를 종종 틀린다. 시각은 그대로 두고 글자만 AI로 다듬는다.
  // 줄 수가 바뀌면 서버가 거절하므로 타이밍이 어긋날 일이 없다.
  const polish = async () => {
    if (!lines.length) return
    stop()
    setBusy('AI가 글자를 다듬는 중…')
    set오류('')
    setMsg('')
    try {
      const r = await polishAudioSubtitle(file.id, lines)
      setText(r.lines.join('\n'))
      // **AI 가 죽은 것과 정말 깨끗한 원고를 같은 말로 적으면 안 된다.**
      // 예전에는 둘 다 "고칠 곳이 없었습니다"가 됐다 — 사람은 다듬어진 줄 알고 넘어간다.
      setMsg(r.via === 'template'
        ? `AI 를 쓰지 못해 원문을 그대로 뒀습니다${r.via_reason ? ` (${r.via_reason})` : ''}. 글자는 직접 고쳐 주세요 — 타이밍은 그대로입니다.`
        : r.changed
          ? `${r.changed}곳을 고쳤습니다. 타이밍은 그대로입니다 — 재생해서 확인해 보세요.`
          : '고칠 곳이 없었습니다.')
    } catch (e) {
      오류로(e.message)
    } finally { setBusy('') }
  }

  const fillFromStt = async () => {
    stop()
    setBusy('받아쓰는 중')
    set오류('')
    setMsg('')
    setProg({ percent: 0, doneSec: 0, totalSec: 0, elapsedSec: 0 })
    // 1초마다 어디까지 왔는지 물어본다. 도는 동안 아무 표시가 없으면 사람이 다시 누르거나
    // 창을 닫는다 — 그러면 이미 돌던 것이 헛일이 된다.
    const 타이머 = setInterval(() => {
      getSubtitleProgress()
        .then((p) => { if (p.running) setProg(p) })
        .catch(() => { /* 한 번 못 물어봐도 다음 초에 다시 본다 */ })
    }, 1000)
    try {
      const r = await transcribeAudioSubtitle(file.id)
      applyCues(r.cues, 'stt')
      // 받아쓴 글자는 **틀릴 수 있다** — 그래서 ②(AI 로 고치기)로 간다.
      // 정본을 맞춰 온 경우(`canonical`)는 글자가 이미 맞으니 ③으로 건너뛴다.
      set단계(r.canonical ? 3 : 2); setMode(r.canonical ? 'check' : 'text')
      setMsg(r.canonical
        ? `받아썼습니다 — 글자는 정해진 문구를 쓰고 시각만 가져왔습니다(${(r.matched / r.total * 100).toFixed(0)}% 일치). 틀린 곳이 없는지 재생해 보세요.`
        : '받아썼습니다 — 글자가 틀릴 수 있으니 왼쪽 칸에서 고쳐주세요.')
    } catch (e) {
      오류로(e.message)
      // 없어서 못 돈 것이면 **그 자리에서 받을 수 있다** — 단추를 띄운다.
      // 문구가 아니라 **표식**으로 가른다(문구를 다듬는 날 조용히 끊기지 않게).
      // `apiPost` 는 서버 본문을 `e.data` 에 담아 던진다 — 거기서 읽는다.
      set설치가능((e.data?.code || e.code) === 'STT_MISSING')
    } finally { clearInterval(타이머); setBusy(''); setProg(null) }
  }

  // ── 저장 ─────────────────────────────────────────────────────
  const buildCues = () => {
    const out = []
    for (let i = 0; i < lines.length; i++) {
      const s = marks[i]
      if (s == null) throw new Error(`${i + 1}번째 줄의 시각이 아직 없습니다`)
      // 끝은 다음 줄이 시작하는 자리. 마지막 줄은 음원 끝까지 둔다.
      const e = i + 1 < lines.length && marks[i + 1] != null ? marks[i + 1] : (dur || s + 2)
      out.push({ s, e: Math.max(e, s + MIN_LINE), text: lines[i] })
    }
    return { v: 1, src: source === 'prefill' ? 'manual' : source, lines: out }
  }

  const save = async (asReady) => {
    // **방송 중인 자막을 초안으로 내리면 그 순간 방송 화면에서 빠진다.** 오타를 고치고 「초안 저장」을
    // 누르면 고친 글자는커녕 자막 자체가 안 나간다 — 한 번 묻는다(2026-11-01 현장 보고 뒤 보강).
    if (status === 'ready' && !asReady
      && !confirm('지금 방송에 나가고 있는 자막입니다.\n\n「초안 저장」을 하면 이 자막이 방송 화면에서 빠집니다. 고친 내용을 방송에 쓰려면 「다시 저장」을 누르세요.\n\n그래도 초안으로 저장할까요?')) return
    setSaving(true); setMsg('')
    try {
      const cues = buildCues()
      await saveAudioSubtitle(file.id, { cues, source, status: asReady ? 'ready' : 'draft' })
      setStatus(asReady ? 'ready' : 'draft')
      setSaved(true)
      set기준(JSON.stringify([text, marks]))   // 저장했으니 여기가 새 기준이다
      setMsg(asReady ? '저장했습니다 — 이제 방송 화면에 나갑니다.' : '초안으로 저장했습니다.')
    } catch (e) {
      setMsg(e.message)
    } finally { setSaving(false) }
  }

  // 자막 지우기 — 서버엔 길이 있었는데 화면에 단추가 없었다(2026-09-05).
  //
  // 왜 필요한가: 잘못 만든 자막을 되돌릴 길이 없어서, 통째로 다시 만들어야 했다. 특히
  // **방송에 쓰기까지 누른 자막**은 지울 때까지 홀 화면에 계속 나간다.
  //
  // 지운 뒤 편집기를 닫는다 — 목록의 자막 뱃지가 낡은 채로 남지 않게 부모에게 알린다.
  const remove = async () => {
    if (!confirm(`"${file.original_name}" 의 자막을 지울까요?\n\n지우면 되돌릴 수 없고, 방송 화면에도 안 나갑니다.`)) return
    setSaving(true); setMsg('')
    try {
      await deleteAudioSubtitle(file.id)
      onChanged?.()
      onClose?.()
    } catch (e) {
      setMsg(`지우지 못했습니다: ${e.message}`)
      setSaving(false)
    }
  }

  const 찍은줄 = marks.filter((m, i) => m != null && i < lines.length).length
  const 준비됨 = lines.length > 0 && 찍은줄 === lines.length

  // 상태에 따라 첫 문장이 달라진다. 자막은 대개 **이미 만들어져 있고**, 사람이 할 일은
  // 한 번 들어 보고 승인하는 것뿐이다 — 그 사실을 첫 줄에서 말한다.
  const 안내문 = busy
    ? '자막을 만드는 중입니다.'
    : status === 'ready' ? '방송에 나가고 있는 자막입니다.'
    : !lines.length     ? '자막이 아직 없습니다. 아래에서 만들어 주세요.'
    : source === 'stt'    ? '자막이 자동으로 만들어졌습니다. 한 번 들어 보고 맞으면 「방송에 쓰기」를 누르세요.'
    : source === 'prefill' ? '글자는 정해진 문구입니다. 시각은 어림값이니 들어 보고 밀렸으면 「타이밍 맞추기」로 고치세요.'
    : '저장해 둔 초안입니다. 방송에 내보내려면 「방송에 쓰기」를 누르세요.'

  // **고친 게 있으면 한 번 묻고 닫는다**(G-57). 자막은 받아쓰기 결과를 사람이 고친 것이라
  // 닫으면 그 손질이 통째로 사라진다. 안 고쳤으면 묻지 않는다.
  const 고쳤나 = 기준 !== JSON.stringify([text, marks])
  const 닫기 = () => { if (고쳤나) set닫기물음(true); else onClose() }

  return (
    <>
    <Shell embedded={embedded} onClose={닫기}>

        {/* 인라인일 때는 파일 이름을 바로 위 패널이 이미 보여준다 — 두 번 쓰지 않는다. */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-ds-v3-line">
          <div className="flex-1 min-w-0">
            {!embedded && <div className="text-sm font-semibold text-ds-v3-ink truncate">{file.original_name}</div>}
            {/* 첫 문장이 "무엇을 해야 하는지"를 말한다. 예전엔 "자막 편집 · 초안"뿐이라
                사람이 처음부터 만들어야 하는 줄 알았다. */}
            <div className="text-sm text-ds-v3-ink mt-0.5">{안내문}</div>
            {/* **고친 파일과 방송에 나가는 파일이 다를 수 있다**(2026-11-01 현장 보고: 오타를 고쳤는데
                다음 방송에 옛 자막이 떴다). 같은 폴더에 파일이 여럿이면 「대기」 파일을 고쳐도 방송엔
                안 보인다 — 서버가 판정한 is_primary 만 본다(화면이 다시 계산하면 규칙이 갈린다). */}
            {file.is_primary === false && file.category !== 'bgm' && (
              <div className="t-sub text-ds-v3-warn mt-1">
                이 파일은 지금 자동방송에 나가는 파일이 아닙니다(대기). 고친 자막은 이 파일이 나갈 때만 보입니다 —
                같은 폴더의 「지금 나가는 파일」도 확인하세요.
              </div>
            )}
          </div>
          <CloseButton onClose={닫기} label="자막 편집 닫기" />
        </div>

        {/* ── 단계 머리줄 (사용자 지시 2026-09-16) ──────────────────────────────
            **막는 것이 아니라 알려 주는 것**이다. 아무 때나 눌러 옮길 수 있다 —
            막으면 급할 때(이미 다 된 자막을 한 줄만 고치려 할 때) 길이 없다. */}
        <div className="flex items-stretch gap-1 px-5 py-2.5 border-b border-ds-v3-line bg-ds-v3-bg/60">
          {단계표.map((칸) => {
            const 지금 = 단계 === 칸.번호
            const 지남 = 단계 > 칸.번호
            return (
              <button key={칸.번호} type="button"
                onClick={() => { set단계(칸.번호); if (칸.번호 !== 3) setMode('text'); else setMode('check') }}
                aria-current={지금 ? 'step' : undefined}
                className={'flex-1 min-w-0 flex items-center gap-2 rounded-btn px-3 py-2 text-left '
                  + 'border transition-colors btn-press '
                  + (지금
                    ? 'border-ds-v3-tts bg-ds-v3-tts-bg text-ds-v3-tts'
                    : 지남
                      ? 'border-ds-v3-line bg-white text-ds-v3-ink-2 hover:text-ds-v3-ink'
                      : 'border-transparent text-ds-v3-ink-3 hover:text-ds-v3-ink-2')}>
                {/* **14px 바닥은 이 저장소 규칙이다**(`modal-shell.test.js` 7단계).
                    11px 로 썼다가 그 가드에 걸렸고, 가드가 옳았다 — 단계 번호는 「지금
                    어디쯤인가」를 말하는 글자라 작으면 읽히지 않는다. */}
                <span className={'flex-shrink-0 w-6 h-6 rounded-full text-sm font-semibold '
                  + 'flex items-center justify-center '
                  + (지금 ? 'bg-ds-v3-tts text-white' : 지남 ? 'bg-ds-v3-ink-3 text-white' : 'bg-ds-v3-line text-ds-v3-ink-2')}>
                  {지남 ? '✓' : 칸.번호}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold truncate">{칸.이름}</span>
                  <span className="block t-sub truncate opacity-80">{칸.한줄}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* **글자 칸을 더 넓게 준다.** 반반으로 나누면 긴 자막 줄이 접히는데, 접히면
            「이 줄이 화면에서 몇 줄로 보일지」를 못 가늠한다. 미리보기는 실제 방송 화면의
            축소판이라 좁아도 뜻이 통한다. 좁은 화면에서는 예전처럼 위아래로 쌓인다. */}
        <div className="flex-1 overflow-y-auto p-5 gap-5
                        grid grid-cols-1 laptop:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">

          {/* 왼쪽 — 문구 */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-semibold text-ds-v3-ink">
                문구 {mode === 'text' && <span className="text-ds-v3-ink-2 font-normal">— 한 줄이 자막 한 줄입니다</span>}
              </span>
            </div>

            {/* 받아쓰기 진행 바. 도는 동안 표시가 없으면 사람이 다시 누르거나 창을 닫는다. */}
            {busy && (
              <div className="mb-2 p-3 border border-ds-v3-tts rounded-btn bg-ds-v3-tts-bg/40">
                <div className="flex items-center gap-2 text-sm font-semibold text-ds-v3-ink">
                  <Loader2 size={14} className="animate-spin text-ds-v3-tts" />
                  {busy === '받아쓰는 중' ? '자막을 만드는 중' : busy}
                  {prog && <span className="ml-auto nums text-ds-v3-tts">{prog.percent}%</span>}
                </div>
                {prog && (
                  <>
                    <div className="mt-2 h-2 w-full rounded-full bg-white overflow-hidden">
                      <div className="h-full bg-ds-v3-tts transition-all duration-500"
                           style={{ width: `${Math.max(3, prog.percent)}%` }} />
                    </div>
                    <div className="mt-1.5 t-sub text-ds-v3-ink-2 nums">
                      {prog.totalSec > 0
                        ? `${fmt(prog.doneSec)} / ${fmt(prog.totalSec)} 들었습니다 · ${prog.elapsedSec}초 경과`
                        : '음원을 여는 중…'}
                    </div>
                  </>
                )}
                <div className="mt-1.5 t-sub text-ds-v3-ink-2">창을 닫지 마세요. 음원 길이의 3분의 1쯤 걸립니다.</div>
              </div>
            )}

            {/* ── 단계마다 **할 일 하나만 진하게** (사용자 지시 2026-09-16) ────────
                앞 판은 이 단추 셋이 늘 나란히 있었다. 처음 여는 사람에게는 무엇부터
                눌러야 하는지가 안 보였다 — *"지금 작업 형태가 복잡해"*.
                이제 그 단계의 주 동작만 진하고, 나머지는 옆에 조용히 둔다. */}
            <div className={`items-center gap-2 mb-2 flex-wrap ${단계 === 3 ? 'hidden' : 'flex'}`}>
              {단계 === 1 && (
                <>
                  <button onClick={fillFromStt} disabled={!!busy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-btn text-sm font-semibold btn-press
                               bg-ds-v3-tts hover:bg-ds-v3-ink text-white disabled:opacity-40">
                    <Mic size={14} /> {lines.length ? '다시 받아쓰기' : '소리 듣고 자동으로 만들기'}
                  </button>
                  {defaultText && (
                    <button onClick={fillFromDefault} disabled={!!busy}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 border border-ds-v3-line rounded-btn
                                 t-sub font-semibold text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press disabled:opacity-40">
                      <FileText size={13} /> 기본 문구 불러오기
                    </button>
                  )}
                  {lines.length > 0 && (
                    <button onClick={() => { set단계(2); setMode('text') }}
                      className="t-sub text-ds-v3-ink-2 hover:text-ds-v3-tts px-2 py-1.5 btn-press">
                      이미 있는 글로 계속하기 →
                    </button>
                  )}
                </>
              )}

              {단계 === 2 && (
                <>
                  {/* 정본이 있는 음원은 글자가 이미 맞다 — AI 를 부를 이유가 없다. */}
                  {!defaultText && (
                    <button onClick={polish} disabled={!!busy || !lines.length}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-btn text-sm font-semibold btn-press
                                 bg-ds-v3-tts hover:bg-ds-v3-ink text-white disabled:opacity-40">
                      {busy && busy.startsWith('AI') ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      AI로 오탈자 고치기
                    </button>
                  )}
                  <button onClick={() => { set단계(3); setMode('check') }} disabled={!lines.length}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 border border-ds-v3-line rounded-btn
                               t-sub font-semibold text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press disabled:opacity-40">
                    확인하러 가기 →
                  </button>
                  <button onClick={fillFromStt} disabled={!!busy}
                    className="t-sub text-ds-v3-ink-2 hover:text-ds-v3-tts px-2 py-1.5 btn-press disabled:opacity-40">
                    다시 받아쓰기
                  </button>
                </>
              )}
            </div>
            {/* ── **오류는 누른 자리 바로 아래다** (현장 지적 2026-09-15) ────────────────
                앞 판은 이 창 **맨 아래 한 줄**에 `truncate` 로 적었다. 이 편집기는 길어서
                그 줄이 화면 밖이고, 게다가 잘려서 이유도 안 보였다 — 사람에게는
                *"자막 생성이 안 돌아간다"* 로 보인다(실제로는 돌다가 실패한 것이었다).
                **누른 단추 바로 아래**에, **안 잘리게**, 눈에 띄는 색으로 띄운다. */}
            {오류 && (
              <div role="alert"
                   /* 14px 바닥은 이 저장소 규칙이다(`modal-shell.test.js` 7단계) —
                      13px 로 썼다가 그 가드에 걸렸고, **가드가 옳았다.** 읽으라고 띄우는
                      글인데 작으면 안 읽힌다. */
                   className="mt-2 rounded-btn border border-ds-v3-warn/40 bg-ds-v3-warn/5 px-3 py-2
                              text-sm leading-relaxed text-ds-v3-warn whitespace-pre-wrap break-words">
                {오류}
                {/* **없어서 못 돈 것이면 그 자리에서 받는다**(사용자 지시 2026-09-15).
                    서버가 뜰 때 자동으로는 안 한다 — 무거워서 부팅마다 하면 방송이 밀린다.
                    방송 중에는 서버가 막는다(설치가 CPU 를 몇 분간 잡아먹는다). */}
                {설치가능 && (
                  <div className="mt-2">
                    <button onClick={설치하기} disabled={!!busy}
                      className="px-3 py-1.5 rounded-btn bg-ds-v3-warn text-white text-sm font-semibold
                                 btn-press disabled:opacity-40">
                      지금 설치하기 (몇 분 걸립니다)
                    </button>
                    <p className="mt-1.5 text-sm text-ds-v3-ink-2">
                      약 460MB를 내려받습니다. 설치하는 동안 방송은 그대로 나갑니다.
                    </p>
                  </div>
                )}
              </div>
            )}
            {/* 재생 중에는 글자 칸 대신 **찍을 줄을 짚어 주는 목록**을 보여준다.
                타이핑 칸만 있으면 지금 어느 줄을 찍어야 하는지 눈으로 못 따라간다 — 소리는
                흐르는데 화면은 가만히 있으니 사람이 박자를 놓친다. */}
            {mode !== 'text' ? (
              <div className="flex-1 min-h-[280px] overflow-y-auto border border-ds-v3-line rounded-btn
                              bg-[#F8FAFF] p-2 space-y-1">
                {lines.map((line, i) => {
                  const 찍음 = marks[i] != null
                  const 다음 = i === tapAt
                  const 지금 = i === 재생줄
                  return (
                    <div key={i}
                         ref={다음 ? tapRowRef : (지금 && tapAt >= lines.length ? tapRowRef : null)}
                         className={`flex items-center gap-2 px-2.5 py-2 rounded-btn transition-colors ${
                           다음 && mode === 'timing' ? 'bg-ds-v3-ink text-white shadow'
                                : 지금 ? 'bg-ds-v3-tts-bg font-semibold text-ds-v3-ink'
                                : 'text-ds-v3-ink'}`}>
                      {지금 && <span className="text-ds-v3-tts t-sub flex-shrink-0">▶</span>}
                      <span className={`w-12 t-sub nums flex-shrink-0 ${다음 && mode === 'timing' ? 'text-white/80' : 'text-ds-v3-ink-2'}`}>
                        {찍음 ? fmt(marks[i]) : '—'}
                      </span>
                      <span className={`flex-1 min-w-0 text-sm ${다음 && mode === 'timing' ? 'font-semibold' : ''}`}>{line}</span>
                      {다음 && mode === 'timing' && <span className="t-sub font-semibold flex-shrink-0">스페이스 ␣</span>}
                    </div>
                  )
                })}
                {!lines.length && (
                  <div className="px-2.5 py-3 text-sm text-ds-v3-ink-2">
                    자막이 없습니다. 위 「자동으로 만들기」를 누르면 받아쓰기가 문구와 타이밍을 채웁니다.
                  </div>
                )}
                {mode === 'timing' && tapAt >= lines.length && lines.length > 0 && (
                  <div className="px-2.5 py-3 text-sm text-ds-v3-ink-2">
                    다 찍었습니다. 멈춘 뒤 저장하거나 ◀ ▶로 미세조정하세요.
                  </div>
                )}
              </div>
            ) : (
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); nextRef.current = 0; setTapAt(0) }}
                placeholder={'식사 안내 드리겠습니다.\n오늘도 정성껏 마련된\n이 음식에 감사드리며'}
                className="input-base flex-1 min-h-[280px] text-sm leading-relaxed resize-none" />
            )}
            <div className="t-sub text-ds-v3-ink-2 mt-1.5">
              {lines.length}줄{mode === 'timing' && ` · 시각을 찍은 줄 ${찍은줄}개`}
            </div>
          </div>

          {/* 오른쪽 — 타이밍 */}
          <div className="flex flex-col min-h-0">
            <div className="text-sm font-semibold text-ds-v3-ink mb-1.5">
              {mode === 'timing'
                ? <>타이밍 맞추기 <span className="text-ds-v3-ink-2 font-normal">— 줄이 시작될 때 스페이스바</span></>
                : <>방송 화면 <span className="text-ds-v3-ink-2 font-normal">— 재생하면 홀 화면 그대로 보입니다</span></>}
            </div>

            <div className="flex items-center gap-2 mb-2">
              {/* 이름이 "싱크 시작"이면 듣기만 하려는 사람에게 작업을 선언하는 셈이다. */}
              <button onClick={() => (playing ? stop() : play())} disabled={!lines.length}
                className="flex items-center gap-1.5 px-3 h-11 bg-ds-v3-ink hover:bg-ds-v3-ink text-white rounded-btn text-sm font-semibold btn-press disabled:opacity-40">
                {playing ? <Pause size={14} /> : <Play size={14} />}
                {playing ? '멈춤' : mode === 'timing' ? '찍기 시작' : '들으며 확인'}
              </button>
              {mode === 'timing' && (
                <button onClick={restart}
                  className="flex items-center gap-1.5 px-3 h-11 border border-ds-v3-line rounded-btn text-sm text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press">
                  <RotateCcw size={14} /> 처음부터
                </button>
              )}
              <span className="ml-auto text-sm text-ds-v3-ink-2 nums">{fmt(now)} / {fmt(dur)}</span>
            </div>

            {/* 교정 도구는 「타이밍 맞추기」 안에서만 보인다 — 늘 보이면 본작업처럼 읽힌다. */}
            {mode === 'timing' && (
              <div className="flex items-center gap-2 mb-2 t-sub flex-wrap">
                <span className="text-ds-v3-ink-2">전체가 똑같이 밀렸으면 이것만으로 끝납니다</span>
                <button onClick={() => shiftAll(-NUDGE)} className="px-2.5 py-1.5 border border-ds-v3-line rounded-btn hover:text-ds-v3-tts btn-press">◀ 0.1초</button>
                <button onClick={() => shiftAll(+NUDGE)} className="px-2.5 py-1.5 border border-ds-v3-line rounded-btn hover:text-ds-v3-tts btn-press">0.1초 ▶</button>
              </div>
            )}

            {/* 실제 방송 화면 미리보기. 홀 화면에 **그대로 이 모습으로** 나간다 —
                같은 컴포넌트로 그리고, 글씨는 창 대비 상자 크기만큼 줄여 축소판을 만든다. */}
            <div ref={previewRef}
                 className="relative w-full rounded-[10px] overflow-hidden mb-2 overlay-gradient-anim"
                 style={{ aspectRatio: '16 / 9',
                          backgroundColor: PREVIEW_BASE, backgroundImage: PREVIEW_BG }}>
              <BroadcastCaption embedded scale={previewScale} />
              {!playing && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="px-3 py-1.5 rounded-full bg-black/35 text-white t-sub font-semibold">
                    {lines.length ? '재생하면 여기에 방송 화면 그대로 보입니다' : '왼쪽에 문구를 먼저 채워주세요'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto border border-ds-v3-line rounded-[10px] divide-y divide-ds-v3-line/60 min-h-[120px]">
              {lines.length === 0 && <div className="p-4 text-sm text-ds-v3-ink-2">자막이 아직 없습니다.</div>}
              {lines.map((line, i) => {
                const s = marks[i]
                const 지금 = s != null && now >= s && (marks[i + 1] == null || now < marks[i + 1])
                return (
                  <div key={i} className={`flex items-center gap-2 px-2.5 py-2 ${지금 ? 'bg-ds-v3-tts-bg' : ''}`}>
                    <span className="w-14 t-sub text-ds-v3-ink-2 nums flex-shrink-0">{s == null ? '—' : fmt(s)}</span>
                    <span className="flex-1 min-w-0 text-sm text-ds-v3-ink truncate">{line}</span>
                    {mode === 'timing' && (
                      <>
                        <button onClick={() => nudge(i, -NUDGE)} disabled={s == null} title="0.1초 앞으로"
                          className="p-2 text-ds-v3-ink-2 hover:text-ds-v3-tts disabled:opacity-25"><ChevronLeft size={16} /></button>
                        <button onClick={() => nudge(i, +NUDGE)} disabled={s == null} title="0.1초 뒤로"
                          className="p-2 text-ds-v3-ink-2 hover:text-ds-v3-tts disabled:opacity-25"><ChevronRight size={16} /></button>
                        <button onClick={() => { nextRef.current = i; setTapAt(i); play(Math.max(0, (s ?? now) - 1.5)) }}
                          className="px-2 py-1.5 t-sub text-ds-v3-ink-2 hover:text-ds-v3-tts border border-ds-v3-line rounded-btn">여기부터</button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-ds-v3-line flex-wrap">
          {msg && <span className="text-sm text-ds-v3-ink-2 flex-1 min-w-0 truncate">{msg}</span>}
          {!msg && <span className="flex-1" />}

          {/* 고치는 도구는 확인 뒤에 온다. 예전엔 이것이 첫 화면이라 "일일이 해야 하는 일"로
              보였다 — 실제로는 자막이 이미 다 만들어져 있고 승인만 하면 된다. */}
          {mode === 'check' ? (
            <>
              <button onClick={() => { stop(); setMode('text') }} disabled={!lines.length}
                className="px-3 h-11 border border-ds-v3-line rounded-btn text-sm font-semibold text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press disabled:opacity-40">
                글자 고치기
              </button>
              <button onClick={() => { stop(); setMode('timing'); nextRef.current = 0; setTapAt(0) }} disabled={!lines.length}
                className="px-3 h-11 border border-ds-v3-line rounded-btn text-sm font-semibold text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press disabled:opacity-40">
                타이밍 맞추기
              </button>
            </>
          ) : (
            <button onClick={() => { stop(); setMode('check') }}
              className="px-3 h-11 border border-ds-v3-line rounded-btn text-sm font-semibold text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press">
              확인으로 돌아가기
            </button>
          )}

          {saved && (
            <button onClick={remove} disabled={saving}
              className="flex items-center gap-1.5 px-3 h-11 border border-ds-v3-line rounded-btn text-sm font-semibold text-ds-v3-ink-2 hover:text-ds-v3-warn hover:border-ds-v3-line btn-press disabled:opacity-40"
              title="이 음원의 자막을 지웁니다">
              <Trash2 size={14} /> 자막 지우기
            </button>
          )}

          {mode !== 'check' && (
            <button onClick={() => save(false)} disabled={saving || !준비됨}
              className="flex items-center gap-1.5 px-3 h-11 border border-ds-v3-line rounded-btn text-sm font-semibold text-ds-v3-ink-2 hover:text-ds-v3-tts btn-press disabled:opacity-40">
              <Save size={14} /> 초안 저장
            </button>
          )}
          {/* ── **주 동작은 진하다** (사용자 지적 2026-09-16) ──────────────────────
              *"저장화면도 연하게 나오니까 헷갈리잖아"*

              이 단추가 `bg-ds-v3-ink-3`(흐린 회색)이었다. 옆의 「초안 저장」·「글자 고치기」와
              **같은 무게로 보여서**, 이 화면에서 무엇이 마무리인지가 안 보였다.
              자막은 이 단추를 눌러야 비로소 홀 화면에 나간다 — 가장 진해야 한다. */}
          <button onClick={() => save(true)} disabled={saving || !준비됨}
            className="flex items-center gap-1.5 px-5 h-11 rounded-btn text-sm font-semibold btn-press
                       bg-ds-v3-tts hover:bg-ds-v3-ink text-white
                       shadow-[0_2px_8px_rgba(37,99,235,0.25)] disabled:opacity-40 disabled:shadow-none">
            <CheckCircle2 size={15} /> {status === 'ready' ? '다시 저장' : '방송에 쓰기'}
          </button>
        </div>
    </Shell>

    {/* 고친 자막을 버리기 전에 한 번 묻는다. 받아쓰기 결과를 사람이 손질한 것이라
        다시 만들려면 처음부터 들어야 한다. */}
    <ConfirmDialog
      open={닫기물음}
      title="저장하지 않고 닫을까요?"
      body="고친 자막이 사라집니다."
      confirmLabel="저장 안 하고 닫기"
      onConfirm={() => { set닫기물음(false); onClose() }}
      onClose={() => set닫기물음(false)}
    />
    </>
  )
}

// 인라인이면 카드 안에 그대로 눕고, 모달이면 화면을 덮는 껍데기를 씌운다.
// 안쪽 내용은 한 벌이라 두 자리가 어긋날 일이 없다.
function Shell({ embedded, onClose, children }) {
  if (embedded) {
    return (
      <div className="border border-ds-v3-tts rounded-[12px] bg-white overflow-hidden">
        {children}
      </div>
    )
  }
  // **바깥을 눌러도 안 닫힌다**(G-57). 예전엔 닫혔고, 그게 이 창에서 가장 위험했다 —
  // 받아쓰기 결과를 손질하던 중 스치듯 지나간 클릭 한 번에 다 사라졌다.
  // 머리줄이 `children` 안에 있으므로 `title` 은 안 준다(껍데기가 또 그리면 제목이 둘이 된다).
  return (
    // **넓게 연다**(사용자 지시 2026-09-16: *"반응형으로 자막 고치면 옆으로 좀 늘어나서
    // 편집하기 좀 쉬운 환경으로"*). `max-w-5xl`(1024px)로는 글자 칸과 미리보기가 둘 다
    // 좁아 한 줄이 두 줄로 접혔다 — 자막은 **한 줄이 한 줄로 보여야** 길이를 가늠한다.
    <ModalShell open onClose={onClose} width="max-w-[1400px] w-[calc(96vw/var(--cc-zoom,1))]" 바깥클릭={false}>
      {children}
    </ModalShell>
  )
}


export default SubtitleEditor
