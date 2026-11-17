// 자동방송 단계 목록 — 드래그 정렬 + 인라인 편집.
//
// MorningEditor.jsx에서 통째로 옮겨 왔다(TD-10). **옮기기만 했고 동작은 바꾸지 않았다.**
// 편집기 본체를 되부르지 않는다 — 본체가 이 파일을 부르므로 되부르면 순환이 된다.

import { BGM_DEFAULT_TYPE, BGM_ORDERS, sourceOfStep, stepFieldsOfSource, bgmFolderName } from '../../../lib/bgmTypes'
import { BgmFolderSelect } from '../../shared/BgmSourcePicker'
import { useBgmFolders } from '../../../lib/bgmFolders'

// 접힌 BGM 요약의 폴더 이름 — 서버 목록의 **지금 이름**(안 고른 단계는 null → 요약이 「BGM」이라 적는다).
const BGM폴더이름 = (bgm) => { const s = sourceOfStep(bgm); return s ? bgmFolderName(s) : null }
import { useState, useEffect, useRef, Fragment } from 'react'
import RateInput from '../../shared/RateInput'
import { rateToPercent, percentToRate } from '../../../lib/scheduleUtils'
import {
  GripVertical, Plus, Play, Trash2, Volume2, Mic, ChevronDown, ChevronUp, Gauge,
  ArrowUp, ArrowDown, Pencil, RotateCcw,
  Film,
} from 'lucide-react'
import { VIDEO_CATEGORIES } from '../../../lib/scheduleUtils'
import { bgmCoverage, stepKindOf } from '../../../lib/bgmLane'
// 분홍 레일은 흐름 편집기와 **같은 부품 하나**를 쓴다(2026-09-03) — 예전엔 여기에 글자까지
// 같은 사본이 따로 있었고, 주석은 "같은 모양이어야 한다"고 적고 있었다. 사본은 갈라진다.
import { BgmRail } from '../../shared/FlowBuilder'
import { bgmPreviewPlan } from '../../../lib/bgmPreview'
import { 카드묶기, 카드이동, bgm요약 } from '../../../lib/stepBgmPairing'
import { previewKindOf } from '../../../lib/previewKind'
import { normalizePlaylistItems, denormalizePlaylistItems, reconcilePlaylist } from '../../../lib/playlistItems'
import { playBrowserChime } from '../../../lib/browserChime'
import { audioBus } from '../../../lib/audioBus'
import {
  ttsPreview, getAudioFiles, getBgmPreview,
} from '../../../lib/api'
import {
  AUDIO_STEP_MAP, GRACE_STEP_MAP, VIDEO_STEP_IDS, TTS_STEP_KEYS, BGM_STEP_IDS, KIND_STYLE, CUSTOM_STEP_TYPES,
  canSetRate, hasTtsInline, hasBgmInline, stepSummaryFor,
} from './morningEditorConst'
import {
  GraceFilePanel, PlaylistChips, BgmPlaylistEditor, StepVolumePanel, StepRatePanel,
} from './morningEditorParts'
import StepSourcePicker from './StepSourcePicker'

// BGM 설정 알맹이 — **한 벌만 둔다**(UX-16, 2026-09-11).
//
// 같은 컨트롤이 두 자리에서 필요해졌다: ① TTS 카드 안에 접힌 BGM ② 짝을 못 찾아
// 제 카드로 남은 BGM. 두 벌로 두면 곧 갈린다 — 이 저장소가 분홍 레일에서 이미 겪었고
// (`BgmRail` 을 흐름 편집기와 같은 부품 하나로 합친 이유가 그것이다), 볼륨에서도 겪었다.
//
// **반드시 모듈 최상단에 둔다 — StepList 안에서 정의하지 않는다.**
// 컴포넌트 본문에서 만든 컴포넌트는 렌더마다 **새 타입**이라 React 가 같은 것으로 못 본다.
// 그러면 아래 입력칸이 글자 하나 칠 때마다 언마운트·리마운트되어 **포커스가 튀고
// 한 글자밖에 못 친다.** 실제로 처음엔 안쪽에 뒀었다(2026-09-11에 바로잡음).
//
// 2026-09-21: BGM 은 늘 이 PC 음원이다 — 폴더와 차례만 묻는다.
// 2026-09-22: 폴더는 **아래로 펼치는 목록**이고 사람이 만든 폴더도 고른다(사용자 결정 「폴더를 자유롭게 늘림」).
// 즉시방송·예약·흐름과 **같은 목록 부품**(BgmFolderSelect)이다 — 이름은 서버의 지금 이름. 줄 이름도 모든 화면에서
// 「BGM 폴더」다(예전 「용도」는 사람이 만든 폴더와 헷갈리지 않으려던 이름인데, 이제 둘이 같은 것이다).
// 서버 broadcastSteps.js 의 stepBGMStart 가 `bgmRole`(기본 폴더)·`bgmFolderId`(사람이 만든 폴더)·`bgmOrder` 를 읽는다.
function BgmSourceFields({ bgm, defaultRole, onDuration, onDelay, onFolder, onOrder }) {
  const 칩 = (고름) => `px-3 py-1.5 min-h-[44px] rounded-full t-sub font-semibold transition-colors cursor-pointer
    ${고름 ? 'bg-ds-v3-bgm text-white shadow-sm' : 'bg-white/70 text-ds-v3-ink-2 hover:bg-white'}`
  const 고른갈래 = sourceOfStep(bgm)
  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="space-y-1.5">
        <BgmFolderSelect source={고른갈래} defaultRole={defaultRole}
          noneLabel={(기본이름) => `안 고름 — 이 방송의 기본(「${기본이름}」)`}
          onSource={(s) => onFolder(s)} />
        {!bgm.bgmFileId && <div className="flex flex-wrap items-center gap-1.5">
          <span className="t-sub text-ds-v3-ink-2 w-10 flex-shrink-0">차례</span>
          {BGM_ORDERS.map(o => (
            <button key={o.id} type="button" title={o.desc} aria-pressed={bgm.bgmOrder === o.id}
              onClick={e => { e.stopPropagation(); onOrder(bgm.bgmOrder === o.id ? undefined : o.id) }}
              onDragStart={e => e.stopPropagation()}
              className={칩(bgm.bgmOrder === o.id)}>{o.label}</button>
          ))}
        </div>}
        {/* 안 고르면 어떻게 되는지 글로 적는다 — 빈 칩은 「없음」인지 「기본」인지 모양으로 안 갈린다 */}
        {!bgm.bgmOrder && !bgm.bgmFileId && (
          <p className="t-sub text-ds-v3-ink-3">
            {고른갈래 && /^local_f/.test(고른갈래)
              ? '차례를 안 고르면 랜덤으로 나갑니다.'
              : '차례를 안 고르면 업로드 › 배경음악에서 정한 그 폴더의 기본 차례.'}
          </p>
        )}
      </div>
      {/* 시작 — 안내 음성보다 **몇 초 먼저** 트나 (UX-16 ①, 2026-09-11).
          토글 안에 "재생 시간"만 있고 **시작을 정할 자리가 없었다.** 값은 `bgm_delay` 로
          이미 서버까지 이어져 있다(`broadcastSteps.js:510` → `flowRunner.js:318` 이
          그 초만큼 기다린 뒤 안내를 낸다) — 화면에만 없었다.
          기본 5초는 UX-17 의 "BGM 5초 선행"과 같은 값이고, 그 정본은 서버의 `|| 5` 다. */}
      <div className="flex items-center gap-2 bg-white/60 rounded-full px-3 py-1.5 w-fit">
        <span className="t-sub text-ds-v3-ink-2 whitespace-nowrap">시작</span>
        <input
          type="number"
          min="0"
          max="60"
          step="1"
          value={bgm.bgm_delay ?? 5}
          onChange={e => {
            // 빈 칸·글자는 0 이 아니라 **기본값**으로 둔다 — 0 은 "안내와 동시에" 라는
            // 다른 뜻이라, 지우다가 실수로 선행이 사라지면 안 된다.
            const n = parseInt(e.target.value, 10)
            onDelay(Number.isFinite(n) ? Math.min(60, Math.max(0, n)) : 5)
          }}
          onClick={e => e.stopPropagation()}
          onDragStart={e => e.stopPropagation()}
          className="w-12 border-0 bg-transparent t-sub text-ds-v3-ink
                     focus:outline-none cursor-text"
        />
        <span className="t-sub text-ds-v3-ink-2 whitespace-nowrap">초 먼저 (0 = 안내와 동시에)</span>
      </div>
      {/* 재생 시간 (초) — 저녁 마무리 등 짧은 방송에서 초 단위 자동 정지 */}
      <div className="flex items-center gap-2 bg-white/60 rounded-full px-3 py-1.5 w-fit">
        <span className="t-sub text-ds-v3-ink-2 whitespace-nowrap">재생 시간</span>
        <input
          type="number"
          min="0"
          step="30"
          value={bgm.durationSec ?? 0}
          onChange={e => onDuration(parseInt(e.target.value) || 0)}
          onClick={e => e.stopPropagation()}
          onDragStart={e => e.stopPropagation()}
          className="w-14 border-0 bg-transparent t-sub text-ds-v3-ink
                     focus:outline-none cursor-text"
        />
        {/* 0 = 끝까지 — 2026-09-24 부터 사실이다. 그전엔 네 방송의 첫 BGM 이 0 이면 숨은 분 설정으로 멈췄다. */}
        <span className="t-sub text-ds-v3-ink-2 whitespace-nowrap">
          초{(bgm.durationSec ?? 0) >= 60 ? ` (${Math.round(bgm.durationSec / 60)}분)` : ''} · 0 = 끝까지
        </span>
      </div>
    </div>
  )
}

// ── 드래그 정렬 + 인라인 TTS 편집이 통합된 단계 목록 ──────────
// ttsContents: { [stepId]: string } — 고정 TTS 단계의 텍스트 값
// onTtsChange: (stepId, value) => void — 고정 TTS 단계 텍스트 변경 시 호출
// 단계 판별·요약 순수 함수(volumeFieldFor·canSetRate·stepSummaryFor 등)는
// morningEditorConst.js로 옮겼다(2026-09-03) — 상태가 없어 그쪽이 자리다.

// tab: 자동방송 종류 — BGM 미리듣기가 서버와 같은 기본 폴더(점심·저녁=식사용)를 고르는 데 쓴다.
// 새 커스텀 단계의 id — 누를 때 한 번 만든다. 모듈 함수로 둔다(시각을 읽는 일은 렌더 밖의 일이다).
const 새단계id = (customType) => `custom_${customType}_${Date.now()}`

function StepList({ steps: 전체단계, onChange: 전체저장, ttsContents = {}, onTtsChange, estimateSteps = [], tab }) {
  // ── 지운 단계는 목록에서 빼고 다룬다 (2026-10-23, 단계 삭제) ──────────────────────
  // 기본 단계는 저장본에서 빼면 서버 `mergeStepsWithDefaults` 가 다시 채워 넣는다. 그래서 지울 때
  // 빼는 대신 `deleted: true` 표시를 남기고(서버가 enabled:false 로 못박는다), 이 화면은 그 단계를
  // 아예 안 보여 준다. 아래 코드는 전부 **보이는 단계(`steps`)만** 다루고, 저장할 때 지운 단계를
  // 뒤에 다시 붙인다 — 그래야 이동·추가·카드 묶기의 배열 번호가 지운 단계 때문에 어긋나지 않는다.
  const 지운단계 = 전체단계.filter(s => s.deleted)
  const steps = 전체단계.filter(s => !s.deleted)
  const 순서매김 = (list) => list.map((s, i) => (s.order === i ? s : { ...s, order: i }))
  const onChange = (next) => 전체저장(순서매김([...next, ...지운단계]))
  const [지울후보, set지울후보] = useState(null)    // 「삭제」를 한 번 누른 카드 id — 한 번 더 눌러야 지운다
  // BGM 폴더 목록을 구독한다 — 불러오거나 이름이 바뀌면 접힌 요약 줄(폴더 이름)도 다시 그린다.
  useBgmFolders()
  const [dragIdx,      setDragIdx]      = useState(null)
  const [previewingId, setPreviewingId] = useState(null)  // 미리듣기 중인 단계 ID
  const [allAudioFiles, setAllAudioFiles] = useState([])  // 커스텀 음원·영상 단계 — 전체 audio_files
  const [insertAt,     setInsertAt]     = useState(null)   // 카드 사이 ＋로 연 자리(정수) — 열려 있으면 종류 고르기가 뜬다
  const [expandedIds,  setExpandedIds]  = useState(new Set())  // 세로 타임라인 — 펼쳐진 단계만 상세 설정 표시
  const audioRef = useRef(null)
  // [audioBus] 단계·TTS 미리듣기 장부 등록 손잡이 — audioRef가 내는 소리와 짝이다.
  // BGM 미리듣기는 제 손잡이(previewBgmBusRef)로 따로 올리고, 차임은 browserChime이 스스로
  // 등록한다 — 여기서 또 올리면 이중 기입이 된다.
  const previewBusRef = useRef(null)

  // **미리듣기 세대(2026-09-02).** 미리듣기는 언제나 하나만 난다.
  //
  // 왜 번호가 필요한가: 끄는 것만으로는 안 된다. 미리듣기 경로는 대부분 await를 지난다
  // (TTS 합성·BGM 곡 받기·파일 조회). 그 사이에 사람이 다른 버튼을 누르거나 화면을 떠나면,
  // **잠들어 있던 옛 경로가 깨어나 소리를 켠다.** 실제로 그랬다 — 여러 개를 누르면 겹치고,
  // 쉬운화면으로 나가도 음악이 다시 시작됐다.
  // 그래서 시작할 때마다 번호를 올리고, await에서 깨어난 쪽은 **자기 번호가 아직 최신인지**
  // 확인한 뒤에만 소리를 낸다. 낡은 경로는 조용히 물러난다.
  const previewSessionRef = useRef(0)
  const 최신인가 = (my) => previewSessionRef.current === my

  // **미리듣기 BGM 은 이 화면이 가진 오디오 하나다(2026-09-21).** 예전엔 실제 방송 BGM 과 같은
  // 앱 수준 재생기를 빌려 써서, 조건 없이 끄면 홀의 방송 음악까지 죽었다(td09 H3). 이제는
  // 제 것만 켜고 제 것만 끈다 — 실제 방송 BGM(MusicPlayer)과 섞일 길이 없다.
  const previewBgmRef = useRef(null)
  const previewBgmBusRef = useRef(null)

  const toggleExpanded = (id) =>
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // 커스텀 단계(음원·영상 선택)용 데이터 — FlowEditorModal과 동일 패턴
  useEffect(() => {
    getAudioFiles().then(rows => setAllAudioFiles(rows)).catch(() => {})
  }, [])

  // 단계 한 칸 옮기기. **드래그와 버튼이 같은 함수를 쓴다** — 규칙이 갈리면 저장된 순서와
  // 화면 순서가 어긋난다(order를 다시 매기는 것이 그 규칙이다).
  //
  // **카드 단위로 옮긴다**(UX-16). TTS 카드 안에 접힌 BGM 은 함께 간다 — 안 그러면
  // 화면에서는 카드 하나를 끄는데 배열에서는 TTS 한 줄만 움직이고, 남은 BGM 이 그 자리의
  // **다음 TTS** 에 가서 붙는다. 엉뚱한 안내에 반주가 달리고 옮긴 TTS 는 반주를 잃는다 —
  // "화면만 접는다"는 전제가 깨지는 유일한 자리라, 규칙을 `lib/stepBgmPairing.js` 에 두고
  // 여기서 부른다.
  // **BGM 을 TTS 카드 안으로 접은 목록**(UX-16). 화면이 그리는 단위이자, 순서 조작이
  // 보는 단위다. 배열 번호(`index`·`시작`)를 함께 실어 주므로 `steps` 는 안 건드린다.
  //
  // 조작이 **카드 기준**이어야 하는 이유: 배열 번호로 두면 접힌 BGM 때문에 첫 카드의
  // 번호가 1 이 되어 ↑ 버튼이 살아 있고, 눌러도 화면은 그대로인데 배열만 바뀐다 —
  // 사람이 자기가 방송을 바꿨다는 사실을 알 방법이 없다(2026-09-11 독립 검수 지적).
  const 카드목록 = 카드묶기(steps, hasBgmInline, hasTtsInline)

  const moveStep = (from, to) => {
    if (from === to || to < 0 || to >= steps.length) return
    const next = 카드이동(steps, from, to, hasBgmInline, hasTtsInline)
    if (next === steps) return null     // 옮길 것이 없었다
    onChange(next.map((s, idx) => ({ ...s, order: idx })))
    return next
  }

  const onDragOver = (e, i) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === i) return
    const 끌던것 = steps[dragIdx]
    const next = moveStep(dragIdx, i)
    if (!next) return
    // **옮긴 뒤의 실제 자리**를 다시 잡는다. 카드가 `[BGM, TTS]` 두 줄일 수 있어
    // 목적지 번호(`i`)가 곧 새 자리가 아니다 — 그대로 두면 다음 dragover 가 엉뚱한 것을 집는다.
    setDragIdx(next.indexOf(끌던것))
  }

  const toggleStep = (id) =>
    onChange(steps.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))

  // 단계 삭제 — **그 단계만** 지운다. TTS 카드 안에 접힌 BGM 은 남긴다(2026-10-23 검수 지적):
  // 저녁기도는 [BGM 시작, 삼종기도 안내] 가 한 카드라, 같이 지우면 안내만 빼려던 사람이 모르는 새
  // 첫 배경음악까지 방송에서 빠진다. 남은 BGM 은 다음 단계 위에 그대로 깔린다(화면도 그렇게 다시 묶인다).
  // 추가한 단계는 배열에서 빼고, 기본 단계는 지운 표시만 남긴다(위 머리말). 잘못 지웠으면
  // 「취소」로 편집 전체를 되돌리거나 아래 「지운 단계」 줄에서 되살린다.
  const deleteCard = (ids) => {
    const 지울 = new Set(ids)
    const 표시 = steps.filter(s => 지울.has(s.id) && !s.customType)
      .map(s => ({ ...s, deleted: true, enabled: false }))
    전체저장(순서매김([...steps.filter(s => !지울.has(s.id)), ...지운단계, ...표시]))
    set지울후보(null)
  }

  // 지운 기본 단계 되살리기 — 보이는 목록 **맨 아래**로 돌아온다(원래 자리는 ▲▼로 옮긴다).
  const restoreStep = (id) => {
    const 살릴 = 지운단계.filter(s => s.id === id).map(s => {
      const { deleted: _버림, ...나머지 } = s
      void _버림
      return { ...나머지, enabled: true }
    })
    전체저장(순서매김([...steps, ...살릴, ...지운단계.filter(s => s.id !== id)]))
  }

  // 커스텀 단계 내용 변경
  const updateCustomContent = (id, content) =>
    onChange(steps.map(s => s.id === id ? { ...s, content } : s))

  // 커스텀 단계 이름 변경
  const updateCustomLabel = (id, label) =>
    onChange(steps.map(s => s.id === id ? { ...s, label } : s))

  // video 스텝 필드 변경
  const updateVideoField = (id, field, value) =>
    onChange(steps.map(s => s.id === id ? { ...s, [field]: value } : s))

  // BGM 재생목록(playlist) 항목 편집 — currentItems를 항상 넘겨받아서(구버전 단일 필드에서
  // 파생된 기본값 포함) 첫 수정 시 그 기본값이 사라지지 않고 그대로 playlist에 반영되게 한다.
  const updatePlaylistItem = (stepId, currentItems, idx, patch) =>
    onChange(steps.map(s => {
      if (s.id !== stepId) return s
      const list = [...currentItems]
      list[idx] = { ...list[idx], ...patch }
      return { ...s, playlist: list }
    }))
  const addPlaylistItem = (stepId, currentItems, blank) =>
    onChange(steps.map(s => s.id === stepId ? { ...s, playlist: [...currentItems, blank] } : s))
  const removePlaylistItem = (stepId, currentItems, idx) =>
    onChange(steps.map(s => s.id === stepId ? { ...s, playlist: currentItems.filter((_, i) => i !== idx) } : s))
  const reorderPlaylistItem = (stepId, currentItems, from, to) =>
    onChange(steps.map(s => {
      if (s.id !== stepId) return s
      const list = [...currentItems]
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return { ...s, playlist: list }
    }))

  // 식사 안내 useGraceAudio 토글
  const updateGraceAudio = (id, val) =>
    onChange(steps.map(s => s.id === id ? { ...s, useGraceAudio: val } : s))

  // TTS 음성 변경 (female / male)
  // null이면 "시스템 기본값 사용". 0은 무음이라는 유효한 값이므로 falsy로 지우면 안 된다.
  const updateStepVolume = (id, field, value) =>
    onChange(steps.map(s => s.id === id ? { ...s, [field]: value } : s))

  const updateTtsVoice = (id, ttsVoice) =>
    onChange(steps.map(s => s.id === id ? { ...s, ttsVoice } : s))

  // 이 단계가 무엇에 연결되는가 (2026-09-13, 설계 §3-D).
  //
  // **세 값이 서로 다른 뜻이다** — 이 구분이 이 기능의 전부다:
  //   · 객체        → 그 폴더·파일에 연결
  //   · `null`      → 사람이 일부러 끊었다. 건너뛴다. **기본값이 다시 안 붙는다**
  //   · `undefined` → 키를 **지운다**. 다시 기본값대로 나간다
  //
  // `undefined` 를 `{ ...s, source: undefined }` 로 쓰면 안 된다 — `JSON.stringify` 가
  // 그 키를 빼 주긴 하지만, 그 전에 서버로 가는 객체에 키가 남아 있어 `hasOwnProperty`
  // 검사(해제인지 미저장인지 가르는 근거)가 **해제로 읽는다.** 그래서 진짜로 지운다.
  //
  // **`sourceResolved` 도 같이 손댄다 — 저장 전까지만.**
  // 그 필드는 서버가 내려준 파생값이라 방금 고른 것을 모른다. 안 건드리면 폴더를 고른
  // 직후에도 고르개가 **옛 연결을 그대로 보여 준다** — 사람은 "안 눌렸나" 하고 또 누른다.
  // 여기서 만드는 값은 **해석이 아니다**: 사람이 방금 고른 그 폴더·파일 id 를 그대로
  // 옮겨 적는 것뿐이라, 서버 규칙을 화면이 다시 구현하는 것과는 다르다(설계 §2-C 유지).
  // 저장하면 편집기가 다시 불러와 **서버가 해석한 값**으로 덮인다(`MorningEditor.handleSave`).
  const 고른것표시 = (s, source) => {
    const media = s.sourceResolved?.media ?? null
    const 틀 = { kind: 'none', origin: 'saved', category: null, folderId: null,
      audioFileId: null, playlist: null, media, error: null }
    if (source === null) return 틀
    if (source?.kind === 'folder') {
      return { ...틀, kind: 'folder', category: source.category, folderId: source.folderId ?? null }
    }
    if (source?.kind === 'file') return { ...틀, kind: 'file', audioFileId: source.audioFileId }
    // 기본값으로 되돌리기 — **기본값이 무엇인지는 서버만 안다**(저녁 마무리 음원 폴백처럼 DB 를
    // 봐야 하는 것이 있다). 화면이 지어내지 않고 "저장하면 반영된다"고 말한다.
    return { ...틀, origin: 'pending-default' }
  }

  const updateStepSource = (id, source) =>
    onChange(steps.map(s => {
      if (s.id !== id) return s
      const 표시 = { sourceResolved: 고른것표시(s, source) }
      if (source === undefined) {
        const { source: _지움, ...나머지 } = s; void _지움
        return { ...나머지, ...표시 }
      }
      return { ...s, source, ...표시 }
    }))

  // 이 단계의 음원·영상 재생 배속(0.5~1.5). null이면 정속 — 볼륨과 같은 원칙으로
  // 전역 설정을 안 건드리고 이 단계에만 실린다.
  const updateStepRate = (id, rate) =>
    onChange(steps.map(s => s.id === id ? { ...s, rate } : s))

  // **컴포넌트를 만들지 않는다 — 속성 묶음만 만든다.**
  //
  // 처음엔 `const BgmSourcePanel = ({bgm}) => <BgmSourceFields …/>` 라는 **래퍼 컴포넌트**를
  // 여기 뒀다. `BgmSourceFields` 는 모듈 최상단으로 뺐는데 래퍼가 안쪽에 남아 있었고,
  // 래퍼가 렌더마다 **새 타입**이라 React 가 그 아래를 통째로 언마운트·리마운트했다 —
  // 결과는 하나도 안 고쳐진 것과 같았다.
  //
  // [FACT] EV-003916 — 브라우저에서 (당시) 키워드 칸에 한 글자씩 쳐 보니 **여섯 글자 모두**
  // `같은노드=false · 포커스유지=false` 였다. 소스만 봐서는 "밖으로 뺐으니 됐다"로 읽힌다.
  //
  // 함수를 돌려주는 것은 괜찮다 — **타입이 아니라 props 라서** React 가 재조정을 안 깬다.
  const bgm속성 = (bgm) => ({
    bgm,
    onDuration: (v) => onChange(steps.map(s => s.id === bgm.id ? { ...s, durationSec: v } : s)),
    // 시작(선행 초) — 이름은 서버가 읽는 것과 **같은 `bgm_delay`** 를 쓴다. 화면 전용
    // 이름을 새로 만들면 저장할 때 한 번 더 옮겨 적어야 하고, 그 자리가 어긋난다(UX-16 ①).
    onDelay:    (v) => onChange(steps.map(s => s.id === bgm.id ? { ...s, bgm_delay: v } : s)),
    // 이 방송의 기본 폴더(점심·저녁=식사용) — 「안 고름」 칸과 대신 트는 곳 안내가 쓴다. 규칙은 서버 기본역할과 같다.
    defaultRole: tab === 'lunch' || tab === 'dinner' ? 'meal' : 'broadcast',
    // 폴더 — 기본 폴더면 bgmRole, 사람이 만든 폴더면 bgmFolderId(둘 중 하나만 남긴다 — 값 하나에 폴더 하나).
    // 「안 고름」(null)이면 둘 다 비운다(= 서버가 방송 종류로 정한다). 사람이 만든 폴더는 용도의 기본 차례가
    // 없으므로 차례가 비었으면 랜덤으로 적는다(설계 검토 위험 8 — 보이는 것과 나가는 것이 같게).
    onFolder:   (source) => onChange(steps.map(s => {
      if (s.id !== bgm.id) return s
      const { bgmRole, bgmFolderId, bgmFileId } = stepFieldsOfSource(source)
      const n = { ...s, bgmRole, bgmFolderId, bgmFileId }
      if (bgmFolderId && !n.bgmOrder) n.bgmOrder = 'random'
      return n
    })),
    onOrder:    (v) => onChange(steps.map(s => s.id === bgm.id ? { ...s, bgmOrder: v } : s)),
  })

  // 커스텀 단계 추가 — tts/message(기존) + bgm/audio/chime/delay/video_file(방송 흐름 만들기와
  // 같은 필드명, server/services/broadcastSequencer.js의 runCustomExtraStep이 그대로 읽음)
  const CUSTOM_STEP_LABEL = {
    tts: 'TTS 방송', message: '안내 메시지', bgm: 'BGM', audio: '음원 재생',
    chime: '차임벨', delay: '대기', video_file: '업로드 영상',
  }
  const addCustomStep = (customType, atIndex) => {
    const id = 새단계id(customType)
    const extra =
      customType === 'tts' || customType === 'message' ? { content: '' } :
      customType === 'bgm'        ? { playlist: [{ bgm_type: BGM_DEFAULT_TYPE, bgm_value: '', bgm_title: '', bgm_delay: 5, duration_sec: 60 }] } :
      customType === 'audio'      ? { playlist: [] } :
      customType === 'delay'      ? { wait_sec: 5 } :
      customType === 'video_file' ? { playlist: [] } :
      {}
    // 넣을 자리(at)는 카드 사이의 ＋ 버튼이 정해서 준다. 위쪽 추가 버튼은 자리를 안 주므로
    // 예전처럼 맨 위로 간다 — 추가 버튼이 목록 상단에 있어 스크롤 없이 바로 보이기 때문이다.
    const newStep = { id, label: CUSTOM_STEP_LABEL[customType] || '새 단계', enabled: true, customType, ...extra }
    const at = Number.isInteger(atIndex) ? Math.max(0, Math.min(atIndex, steps.length)) : 0
    const next = [...steps.slice(0, at), newStep, ...steps.slice(at)]
    onChange(next.map((s, idx) => ({ ...s, order: idx })))
  }

  // ── 단계 미리듣기 ────────────────────────────────────────────────
  //
  // **절대 현장 PC로 신호를 보내지 않는다.** 여기서 서버가 SSE로 쏘는 API를 부르면
  // 미리듣기가 곧 실제 방송이 된다 — 홀에 소리가 나간다. 그래서 이 함수들이 쓰는 것은
  //   · GET /audio/... (정적 파일)          — 이 브라우저가 받아서 이 브라우저에서 튼다
  //   · POST /api/tts/preview               — mp3 바이트를 요청한 쪽에만 돌려준다
  //   · 브라우저 WebAudio 차임(browserChime) — 서버 차임(현장 스피커)을 쓰면 안 되는 이유가 그것
  // 셋 다 원격 PC에서 눌러도 현장은 조용하다.

  // 이 단계가 실제로 재생할 파일 하나를 고른다.
  // **서버와 같은 순서로 고른다** — stepAudioFile은 `ORDER BY id`의 trackIndex번째를 튼다.
  // 목록 API는 최신순(uploaded_at DESC)이라 그대로 쓰면 미리듣기와 실제 방송이 다른 파일이 된다.
  const resolveStepFile = async (step) => {
    const all = (await getAudioFiles()) || []
    if (step.customType === 'audio' || step.customType === 'video_file') {
      const first = (step.playlist || []).find(p => p?.audio_file_id) || null
      const id = first?.audio_file_id ?? step.audio_file_id ?? null
      const file = id ? all.find(f => f.id === Number(id)) : null
      return file ? { file, category: file.category } : null
    }
    const category = AUDIO_STEP_MAP[step.id]
    if (!category) return null
    const files = all.filter(f => f.category === category).sort((a, b) => a.id - b.id)
    const file = files[step.trackIndex ?? 0]
    return file ? { file, category } : null
  }

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      if (audioRef.current._blobUrl) URL.revokeObjectURL(audioRef.current._blobUrl)
      audioRef.current = null
    }
    // [audioBus] 미리듣기 오디오가 멎었다 — 장부 해제(끄는 문이 하나라 여기면 다 잡힌다)
    previewBusRef.current?.done(); previewBusRef.current = null
    setPreviewingId(null)
  }

  // 음원/영상 파일 미리듣기 — 이 브라우저에서만 난다
  const handleAudioPreview = async (step, my = null) => {
    const stepId = typeof step === 'string' ? step : step.id
    const target = typeof step === 'string' ? steps.find(s => s.id === step) : step
    if (my === null && previewingId === stepId) { stopPreview(); return }
    if (!target) return
    setPreviewingId(stepId)
    try {
      const found = await resolveStepFile(target)
      // 파일을 찾는 사이에 사람이 다른 것을 눌렀으면 틀지 않는다
      if (my !== null && !최신인가(my)) return
      if (!found) { alert('이 단계에 등록된 파일이 없습니다.'); setPreviewingId(null); return }
      stopPreview()
      setPreviewingId(stepId)
      const media = new Audio(`/audio/${found.category}/${found.file.filename}`)
      // 실제 방송과 같은 속도로 들려준다 — 미리듣기가 실제와 다르면 확인하는 의미가 없다
      if (target.rate) {
        try { media.preservesPitch = true } catch { /* 지원 안 하는 브라우저는 그냥 둔다 */ }
        media.playbackRate = target.rate
      }
      audioRef.current = media
      // [audioBus] 단계 음원 미리듣기 등록 — 자연 종료는 addEventListener로 해제(onended 유지)
      previewBusRef.current?.done()
      // stop을 함께 넘긴다 — 실제 방송이 시작되면 장부가 이 손잡이로 미리듣기를 비키게 한다(H9)
      previewBusRef.current = audioBus.register({
        kind: 'preview-audio',
        label: found.file.original_name || found.file.filename,
        stop: () => stopAllPreview(),
      })
      media.addEventListener('ended', () => { previewBusRef.current?.done(); previewBusRef.current = null })
      media.play().catch(e => { alert('재생 오류: ' + e.message); setPreviewingId(null) })
      media.onended = () => setPreviewingId(null)
      media.onerror = () => { alert('재생 오류'); setPreviewingId(null) }
    } catch (e) {
      alert('미리듣기 오류: ' + e.message)
      setPreviewingId(null)
    }
  }

  // 차임벨 미리듣기 — 브라우저 WebAudio. 서버 차임은 현장 스피커로 나가므로 쓰면 안 된다.
  const handleChimePreview = (stepId) => {
    playBrowserChime()
    setPreviewingId(stepId)
    setTimeout(() => setPreviewingId(cur => (cur === stepId ? null : cur)), 2500)
  }

  // 이 단계를 미리 들을 수 있는가. 들을 수 없는 것에 버튼을 띄우면 눌러도 아무 일이 없다.
  const canPreview = (step, kind, ttsText = '') => {
    if (kind === 'chime') return true
    if (kind === 'audio') return true
    if (step.customType === 'video_file') return true
    if (VIDEO_STEP_IDS.has(step.id)) return false   // 방송 뒤 배경 영상 — 소리가 없다
    // BGM은 그 용도 폴더에서 한 곡 받아 이 브라우저에서 깐다. 폴더가 비었으면 누를 때 이유를
    // 말한다 — **눌러보기 전에는 알 수 없던 것**이 이 화면의 오랜 불만이었다.
    if (kind === 'bgm') return true
    if (kind === 'tts') return !!String(ttsText || '').trim()
    return false
  }

  // 단계별 TTS 미리듣기 — 브라우저에서 재생 (서버 스피커 아님)
  const handlePreview = async (stepId, my = null) => {
    const step = steps.find(s => s.id === stepId)
    const text = step?.customType
      ? (step.content || '')
      : (ttsContents[stepId] || '')
    if (!text.trim()) return

    // 이전 재생 중단
    if (audioRef.current) {
      audioRef.current.pause()
      if (audioRef.current._blobUrl) URL.revokeObjectURL(audioRef.current._blobUrl)
    }

    setPreviewingId(stepId)
    try {
      const blob = await ttsPreview({ text: text.trim() })
      // 음성을 만드는 사이에 사람이 다른 것을 눌렀으면 틀지 않는다
      if (my !== null && !최신인가(my)) return
      const url  = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio._blobUrl  = url
      audioRef.current = audio
      // [audioBus] 단계 TTS 미리듣기 등록 — 자연 종료는 addEventListener로 해제(onended 유지)
      previewBusRef.current?.done()
      previewBusRef.current = audioBus.register({
        kind: 'preview-tts', label: 'TTS 미리듣기', stop: () => stopAllPreview(),
      })
      audio.addEventListener('ended', () => { previewBusRef.current?.done(); previewBusRef.current = null })
      audio.play()
      audio.onended = () => { setPreviewingId(null); URL.revokeObjectURL(url) }
    } catch {
      setPreviewingId(null)
    }
  }

  // ── 전체 미리듣기 ──────────────────────────────────────────────
  //
  // 단계별 미리듣기는 이미 있다. 없던 것은 **처음부터 끝까지 이어서** 듣는 것이다 —
  // 한 단계씩 눌러 들으면 "이 안내 다음에 저 음악이 나온다"는 흐름이 안 잡힌다.
  //
  // 위와 같은 안전 규칙을 그대로 따른다: 정적 파일·TTS 미리듣기 API·브라우저 차임만 쓴다.
  // **현장 PC로 가는 신호는 하나도 없다.** 여기서 실제 방송 API를 부르면 리허설이 곧 방송이 된다.
  //
  // 대기 단계는 실제 시간만큼 기다리지 않고 건너뛴다. 투약 안내 6분을 진짜로 세고 있으면
  // 사람이 창을 닫아버린다 — 확인하려는 것은 소리지 침묵이 아니다.
  const previewAllRef = useRef({ stop: false, skip: false })
  const [previewAll, setPreviewAll] = useState(null)   // { idx, total, label, note }
  // **어느 행이 구간 묶음을 켰나**(2026-09-03 실기 신고 "미리듣기하면 못 끄잖아").
  // BGM 단계는 단일 재생(previewingId)이 아니라 구간 묶음(previewAll)으로 돈다. 행 버튼이
  // previewingId만 보고 있어서 소리는 나는데 버튼은 계속 '미리듣기'였다 — 누르면 실제로
  // 꺼졌지만 화면이 그렇게 말하지 않으니 사람은 끄는 방법이 없다고 본다.
  const [previewSpanId, setPreviewSpanId] = useState(null)

  // 재생이 끝날 때까지 기다린다. 「멈춤」·「다음으로」가 들어오면 그 자리에서 끊는다.
  const playAndWait = (media, my = null) => new Promise((resolve) => {
    // [audioBus] 이어듣기 한 곡 등록 — 자연 종료·멈춤·건너뜀 어느 길이든 finish가 해제한다
    // stop은 **이 곡만 끊는 것이 아니라 루프를 세운다** — 끊기만 하면 다음 단계가 이어서
    // 소리를 낸다(실제 방송 위에 얹히는 그 사고 그대로다).
    const reg = audioBus.register({
      kind: 'preview-loop',
      label: media.src || '이어듣기',
      stop: () => { previewAllRef.current.stop = true; finish() },
    })
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearInterval(timer)
      reg.done()   // [audioBus] 이 곡의 장부 해제
      try { media.pause() } catch { /* 이미 끝났으면 그만 */ }
      if (media._blobUrl) URL.revokeObjectURL(media._blobUrl)
      resolve()
    }
    const timer = setInterval(() => {
      const c = previewAllRef.current
      // 세대가 바뀌었으면 이 재생은 낡은 것이다 — 표시(stop)만 보면 못 잡는다.
      // 새 미리듣기가 previewAllRef를 새 객체로 갈아끼우면 옛 루프는 stop:false를 보게 된다.
      if (my !== null && !최신인가(my)) { finish(); return }
      if (c.stop || c.skip) { c.skip = false; finish() }
    }, 200)
    media.onended = finish
    media.onerror = finish
    audioRef.current = media
    media.play().catch(finish)
  })

  // 소리가 없는 단계를 잠깐 보여주고 넘어간다(차임 여운·"건너뜁니다" 안내를 읽을 시간)
  const holdOrSkip = (ms) => new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const c = previewAllRef.current
      if (c.stop || c.skip || Date.now() - started >= ms) { c.skip = false; clearInterval(timer); resolve() }
    }, 100)
  })

  // 미리듣기용 BGM은 **이 화면의 오디오 하나**가 낸다. 곡은 서버에서 받지만 서버는 소리를 안 낸다
  // (GET /api/audio/bgm/preview) — 현장 스피커는 조용하다. 안내가 얹혀 들리도록 조금 작게 깐다.
  const startPreviewBgm = (url, title) => {
    stopPreviewBgm()
    const a = new Audio(url)
    a.loop = true
    a.volume = 0.45
    previewBgmRef.current = a
    previewBgmBusRef.current = audioBus.register({ kind: 'preview-bgm', label: title || 'BGM 미리듣기', stop: () => stopAllPreview() })
    // 거절이 늦게 오면 그 사이 다른 곡이 깔렸을 수 있다 — **이 곡이 아직 현재일 때만** 끈다
    // (앞 곡을 pause 하며 난 거절이 새 곡까지 끄던 것, Codex 3단계 1회차 Medium).
    a.play().catch(() => { if (previewBgmRef.current === a) stopPreviewBgm() })
  }
  // **우리가 깐 것만 끈다** — 실제 방송 BGM 은 다른 재생기(MusicPlayer)라 여기서 닿지 않는다.
  const stopPreviewBgm = () => {
    const a = previewBgmRef.current
    previewBgmRef.current = null
    if (a) { try { a.pause() } catch { /* 이미 멎었다 */ } }
    previewBgmBusRef.current?.done(); previewBgmBusRef.current = null
  }

  // 이 BGM 단계로 무엇을 틀지 정하고 실제로 깐다.
  // **전체 미리듣기와 단계별 미리듣기가 같은 함수를 쓴다** — 갈라지면 한쪽만 고쳐져
  // "전체로는 나는데 단계별로는 안 난다"가 된다. 이 화면은 그런 사고를 이미 겪었다.
  // @returns {{ok:true,label:string}|{ok:false,reason:string}}
  const layBgmFor = async (bgmStep, my = null) => {
    const plan = bgmPreviewPlan(bgmStep, tab)
    if (plan?.kind !== 'local') return { ok: false, reason: '미리듣기가 안 됩니다' }
    const r = await getBgmPreview(plan.role, plan.folderId, plan.fileId)
    // 곡을 받는 사이에 사람이 화면을 떠났거나 다른 것을 눌렀으면 **켜지 않는다.**
    // 이게 없어서 쉬운화면으로 나간 뒤에 음악이 다시 시작되곤 했다.
    if (my !== null && !최신인가(my)) return { ok: false, reason: '취소됨' }
    if (!r?.ok) return { ok: false, reason: r?.reason || 'BGM 폴더에 곡이 없습니다' }
    startPreviewBgm(r.url, r.name)
    // 서버는 방송할 때 그 용도의 차례로 다시 고른다 — 같은 곡을 약속하지 않는다.
    return { ok: true, label: plan.fileId ? `BGM: ${r.name}` : `BGM: ${r.name} (실제 방송은 차례대로 다시 고릅니다)` }
  }

  // 행의 미리듣기 버튼 하나로 종류를 다 다룬다.
  //
  // **BGM이 깔려 있는 단계는 그 BGM부터 깔고 위에 얹는다.** 실제 방송이 그렇게 나가는데
  // 맨목소리로만 들어보면 "음악에 묻히지 않는지"를 확인할 수 없다 — 미리듣기가 실제와
  // 다르면 확인하는 의미가 없다는 이 화면의 원칙 그대로다. 깔린 BGM이 무엇인지는
  // 왼쪽 분홍 선과 **같은 근거**(bgmCover)를 본다.
  // 끄는 것은 stopAllPreview 하나로 모았다 — 갈래마다 따로 끄면 하나씩 빠뜨린다.
  const handleRowPreview = async (step, i, kind) => {
    // 같은 버튼을 다시 누르면 끈다. 다른 버튼이면 **돌고 있던 것을 먼저 전부 끄고** 시작한다 —
    // 예전엔 BGM만 껐고 이어듣기 루프는 살아 있어서, 다음 단계 소리가 위에 얹혔다.
    const 켜져있음 = previewingId === step.id || (kind === 'bgm' && previewAll)
    stopAllPreview()
    if (켜져있음) return
    const my = previewSessionRef.current

    // **BGM 단계는 그 구간을 묶어서 들려준다(2026-09-02).**
    // 음악만 따로 들어봐야 알 수 있는 게 없다 — 확인하고 싶은 것은 "이 음악 위에 안내가
    // 얹혔을 때 묻히지 않는가"다. 그래서 BGM부터 깔고, 그 아래 덮인 단계들을 순서대로
    // 이어서 들려준다(전체 미리듣기와 같은 기계, 구간만 좁힌 것).
    if (kind === 'bgm') {
      const span = new Set([step.id])
      for (let j = i + 1; j < steps.length; j++) {
        const c = String(bgmCover[j] || '')
        if (!c || c.startsWith('start')) break   // 구간이 끝났거나 다음 BGM이 시작한다
        span.add(steps[j].id)
      }
      setPreviewSpanId(step.id)   // 이 행이 켠 구간 — 버튼이 '멈춤'으로 바뀌는 근거
      await startPreviewAll(span)
      return
    }

    // 이 칸에 BGM이 깔려 있으면(구간의 시작이 아니라 그 아래라면) 그 BGM을 먼저 깐다.
    // 못 깔면 그냥 맨소리로 들려준다 — 여기서 경고창을 띄우면 매번 걸리적거린다.
    const cell = String(bgmCover[i] || '')
    if (cell && !cell.startsWith('start')) {
      for (let j = i - 1; j >= 0; j--) {
        if (String(bgmCover[j] || '').startsWith('start')) { await layBgmFor(steps[j], my); break }
      }
    }
    if (!최신인가(my)) return   // BGM을 찾는 사이에 사람이 다른 것을 눌렀다

    if (kind === 'chime') handleChimePreview(step.id)
    else if (kind === 'tts') handlePreview(step.id, my)
    else handleAudioPreview(step, my)
  }

  const stopPreviewAll = () => {
    previewAllRef.current.stop = true
    stopPreview()
    stopPreviewBgm()
    setPreviewAll(null)
    setPreviewSpanId(null)
  }

  // 미리듣기를 끄는 **단 하나의 문**. 새로 시작하기 전에도, 화면을 떠날 때도 여기를 지난다.
  // 소리를 내는 갈래가 셋이라(음원·TTS 오디오 / BGM / 이어듣기 루프) 하나라도
  // 빠뜨리면 그 갈래만 남아서 계속 난다 — 실제로 루프가 남아 다음 단계를 계속 틀었다.
  const stopAllPreview = () => {
    previewSessionRef.current += 1     // 잠들어 있는 옛 경로들을 전부 낡게 만든다
    previewAllRef.current.stop = true  // 지금 객체에 표시한다(갈아끼우면 옛 루프가 못 본다)
    stopPreview()                      // 음원·TTS 오디오
    stopPreviewBgm()                   // BGM
    setPreviewAll(null)
    setPreviewingId(null)
    setPreviewSpanId(null)
  }

  // **이 화면을 떠나면 미리듣기를 끊는다(2026-09-02).**
  // 미리듣기가 화면을 넘어 살아남으면 사이드바로 넘어가거나 다른 자동순서 탭을 열어도 음악이
  // 계속 흐른다(사용자 신고, 당시엔 앱 수준 재생기를 빌려 썼다). 떠날 때 끈다.
  useEffect(() => () => { stopAllPreview() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // **실제 방송이 왕이다(2026-09-02, td09 H9).**
  // 현장 PC(leader 창)에서 미리듣는 중에 정시 방송이 발화되면, 예전에는 미리듣기가
  // 실제 방송 위에서 계속 돌았다 — 이 화면은 방송 신호를 하나도 안 들었다.
  // 이제 방송이 시작되거나(broadcast-started) 사람이 정지를 누르면(stop-broadcast)
  // 미리듣기가 비킨다. 반대 방향은 없다 — 미리듣기는 실제 방송을 절대 세우지 않는다.
  useEffect(() => {
    const 비켜라 = () => {
      stopAllPreview()                    // 이 화면 것(세대 번호·BGM 플래그까지 정확히)
      audioBus.stopKinds(['preview-'])    // 다른 화면이 켠 미리듣기까지 — 장부에 위임한다
    }
    window.addEventListener('carecast:broadcast-started', 비켜라)
    window.addEventListener('carecast:stop-broadcast',    비켜라)
    return () => {
      window.removeEventListener('carecast:broadcast-started', 비켜라)
      window.removeEventListener('carecast:stop-broadcast',    비켜라)
    }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // onlyIds를 주면 그 단계들만 이어서 들려준다 — BGM 단계의 "구간 묶음 미리듣기"가 쓴다.
  // 판정(어느 단계가 나가고 무엇이 빠지는가)은 여전히 서버 계산(estimateSteps)을 따른다.
  const startPreviewAll = async (onlyIds = null) => {
    // 큰 버튼(전체 미리듣기)은 토글이다. 구간 묶음(onlyIds)은 돌던 것을 끄고 새로 시작한다 —
    // 호출부(handleRowPreview)가 이미 꺼 놓고 들어오므로 여기서 또 토글하면 켜지지 않는다.
    if (previewAll && !onlyIds) { stopAllPreview(); return }
    stopAllPreview()
    const my = previewSessionRef.current
    previewAllRef.current = { stop: false, skip: false }

    // **서버가 계산한 단계 목록을 따라간다** — 꺼진 단계·빠지는 단계 판정이 실제 방송과
    // 같아야 리허설이 의미가 있다. 화면 목록을 따로 거르면 그 판정이 두 벌이 된다.
    // 부모가 서버 계산 결과를 그대로 내려준다 — 어느 단계가 나가고 무엇이 빠지는지의
    // 판정을 화면에서 다시 만들지 않는다(두 벌이 되면 갈라진다).
    const order = estimateSteps
      .map(e => ({ e, step: steps.find(x => x.id === e.id) }))
      .filter(x => x.step && (!onlyIds || onlyIds.has(x.step.id)))
    if (!order.length) {
      alert(onlyIds ? '이 구간에서 미리들을 단계가 없습니다.' : '미리들을 단계가 없습니다.')
      return
    }

    for (let i = 0; i < order.length; i++) {
      // 세대 먼저 본다 — 새 미리듣기가 previewAllRef를 갈아끼우면 옛 루프는 stop을 못 본다.
      if (!최신인가(my) || previewAllRef.current.stop) break
      const { e, step } = order[i]
      const show = (note) => setPreviewAll({ idx: i + 1, total: order.length, label: e.label || step.id, note })

      if (e.skip) { show(`건너뜀 — ${e.skip}`); await holdOrSkip(1200); continue }

      // **판정은 src/lib/previewKind.js가 한다.** 예전엔 여기 if-else 사슬이었는데,
      // 그중 canPreview(step,'audio')가 단계와 무관하게 늘 true라 BGM이 음원 분기로 새고
      // BGM 분기가 죽은 코드가 돼 있었다(사용자 신고로 발견). 순서가 곧 규칙이면 밖에 둔다.
      const pk = previewKindOf(step, { ttsIds: TTS_STEP_KEYS, audioCategory: AUDIO_STEP_MAP, sceneVideoIds: VIDEO_STEP_IDS })

      try {
        if (pk === 'chime') {
          show('차임벨'); playBrowserChime(); await holdOrSkip(2500)
        } else if (pk === 'delay') {
          show(`대기 ${step.wait_sec || 0}초 — 미리듣기에서는 건너뜁니다`); await holdOrSkip(1200)
        } else if (pk === 'tts') {
          const text = getTtsText(step).trim()
          if (!text) { show('문구가 비어 건너뜁니다'); await holdOrSkip(1000); continue }
          show('안내 음성')
          const blob = await ttsPreview({ text })
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url); audio._blobUrl = url
          await playAndWait(audio, my)
        } else if (pk === 'audio') {
          const found = await resolveStepFile(step)
          if (!found) {
            show('이 단계는 미리듣기가 안 됩니다'); await holdOrSkip(1200); continue
          }
          show(found.file.original_name || '음원')
          const media = new Audio(`/audio/${found.category}/${found.file.filename}`)
          if (step.rate) {
            try { media.preservesPitch = true } catch { /* 지원 안 하는 브라우저는 그냥 둔다 */ }
            media.playbackRate = step.rate
          }
          await playAndWait(media, my)
        } else if (pk === 'bgm') {
          // **BGM은 기다리지 않는다.** 실제 방송에서도 음악은 깔린 채로 다음 단계가 그 위에
          // 얹힌다 — 여기서 곡이 끝나기를 기다리면 미리듣기가 실제와 전혀 다른 것이 된다.
          // 무엇을 틀지 정하는 규칙은 layBgmFor 한 곳에 있다 — 단계별 미리듣기도 같은 것을 쓴다.
          const r = await layBgmFor(step, my)
          show(r.ok ? r.label : `BGM — ${r.reason}`)
          await holdOrSkip(1500)   // 음악이 얹히는 것을 듣고 다음으로 — 곡 끝을 기다리지 않는다
        } else {
          // 소리 없는 배경 영상 등 — 무엇을 건너뛰는지는 보여준다.
          show('소리가 없는 단계라 건너뜁니다'); await holdOrSkip(1200)
        }
      } catch (err) {
        show('재생 오류 — ' + (err?.message || '')); await holdOrSkip(1500)
      }
    }

    stopPreview()
    stopPreviewBgm()   // 깔아 둔 BGM을 끄지 않으면 미리듣기가 끝나도 음악만 계속 흐른다
    setPreviewAll(null)
  }

  // 해당 단계의 현재 TTS 텍스트
  const getTtsText = (step) =>
    (step.customType || step.id === 'medication_tts') ? (step.content || '') : (ttsContents[step.id] || '')

  // 카드 사이의 ＋ — **넣을 자리를 먼저 정하고** 종류를 고른다.
  //
  // 왜 넣었나(2026-08-31): 위쪽 추가 버튼은 새 단계를 맨 위에 만든다. 그래서 "영상 뒤에
  // BGM을 다시 깔기" 같은 흔한 일이 카드를 여섯 칸 끌어내리는 일이 된다 — 단계가 많은 탭에서는
  // 번거롭고, 터치 화면에서는 드래그 자체가 잘 안 된다. 자리를 먼저 누르면 드래그가 필요 없다.
  // 늘 보이게 둔다(hover에만 나타나면 터치 화면에서는 영영 못 찾는다).
  const renderInserter = (at) => (
    <div className="relative flex items-center gap-2 py-0.5" key={`ins-${at}`}>
      <span className="flex-1 border-t border-dashed border-ds-v3-line/70" />
      <button
        type="button"
        onClick={() => setInsertAt(insertAt === at ? null : at)}
        aria-expanded={insertAt === at}
        title="이 자리에 단계 추가"
        className={`flex items-center gap-1 px-2 py-1 min-h-[24px] rounded-full border t-sub font-semibold
          transition-colors cursor-pointer flex-shrink-0
          ${insertAt === at
            ? 'border-ds-v3-tts bg-ds-v3-tts-bg text-ds-v3-tts'
            : 'border-ds-v3-line/70 bg-white text-ds-v3-ink-2 hover:border-ds-v3-tts hover:text-ds-v3-tts'}`}
      >
        <Plus size={10} /> 여기에 추가
      </button>
      <span className="flex-1 border-t border-dashed border-ds-v3-line/70" />

      {insertAt === at && (
        <div className="absolute z-30 top-6 left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-1
                        p-1.5 rounded-2xl bg-white border border-ds-v3-line shadow-lg max-w-[420px]">
          {CUSTOM_STEP_TYPES.map(t => {
            const TIcon = t.icon
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => { addCustomStep(t.value, at); setInsertAt(null) }}
                className={`flex items-center gap-1.5 pl-2 pr-3 py-1.5 t-sub font-semibold rounded-full
                           cursor-pointer hover:scale-105 active:scale-95 transition-transform ${t.bg} ${t.text}`}
              >
                <TIcon size={11} />
                {t.label.replace(' 추가', '')}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  // 이 단계에 BGM이 깔려 있는가 — 왼쪽 분홍 선이 그리는 것(src/lib/bgmLane.js에 규칙과 근거).
  // 표는 이 파일에 그대로 두고 규칙만 가져다 쓴다.
  const bgmCover = bgmCoverage(steps, {
    bgmIds: BGM_STEP_IDS, videoIds: VIDEO_STEP_IDS, audioCategory: AUDIO_STEP_MAP,
  })

  return (
    <div className="space-y-2">
      {/* ── 전체 미리듣기 ──
          처음부터 끝까지 이어서 들어본다. **누른 PC에서만 난다** — 현장 스피커는 조용하다.
          어느 단계를 어떤 순서로 트는지는 서버가 계산한 목록(estimateSteps)을 그대로 따른다.
          작게 두면 아무도 못 찾는다 — 이 화면에서 제일 먼저 눈에 들어와야 하는 버튼이다. */}
      {estimateSteps.length > 0 && (
        <div className="rounded-2xl border border-ds-v3-flow-line bg-ds-v3-flow-bg/60 px-4 py-3 mb-1">
          {!previewAll ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={startPreviewAll}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-ds-v3-flow text-white
                           text-sm font-semibold shadow-sm hover:bg-ds-v3-flow active:scale-95 transition">
                <Play size={16} fill="currentColor" />
                전체 미리듣기
              </button>
              <div className="t-sub text-ds-v3-ink-2 leading-snug">
                <p className="font-semibold text-ds-v3-ink">처음부터 끝까지 이어서 들어봅니다</p>
                <p>이 기기의 기본 출력으로 재생됩니다 — 방송 PC 에서는 기본 출력이 홀 스피커인지 먼저 확인하세요</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="t-sub font-semibold text-ds-v3-flow">
                  {previewAll.idx} / {previewAll.total}
                </span>
                <span className="text-base font-semibold text-ds-v3-ink">{previewAll.label}</span>
                {previewAll.note && <span className="t-sub text-ds-v3-ink-2">{previewAll.note}</span>}
              </div>

              {/* 어디쯤 왔는지 — 숫자만으로는 남은 양이 안 잡힌다 */}
              <div className="h-2 rounded-full bg-ds-v3-flow-bg overflow-hidden">
                <div className="h-full bg-ds-v3-flow transition-all duration-300"
                     style={{ width: `${Math.round((previewAll.idx / Math.max(1, previewAll.total)) * 100)}%` }} />
              </div>

              {/* 버튼은 크게. 드래그나 작은 표적을 요구하지 않는다 */}
              <div className="flex gap-2">
                <button type="button" onClick={() => { previewAllRef.current.skip = true }}
                  className="flex-1 px-3 py-2 rounded-full bg-white border border-ds-v3-flow-line text-ds-v3-flow
                             text-sm font-semibold hover:bg-ds-v3-flow-bg active:scale-95 transition">
                  다음 단계로 ⏭
                </button>
                <button type="button" onClick={stopPreviewAll}
                  className="flex-1 px-3 py-2 rounded-full bg-white border border-ds-v3-line text-ds-v3-ink
                             text-sm font-semibold hover:bg-ds-v3-bg active:scale-95 transition">
                  멈춤 ■
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 단계 추가 버튼 (방송 흐름 만들기와 같은 종류 전부) ── */}
      <div className="flex gap-1.5 pb-1 flex-wrap">
        {CUSTOM_STEP_TYPES.map(t => {
          const TIcon = t.icon
          return (
            <button
              key={t.value}
              onClick={() => addCustomStep(t.value)}
              className={`flex items-center gap-1.5 pl-2.5 pr-3.5 py-2 t-sub font-semibold rounded-full
                         transition-all cursor-pointer hover:scale-105 active:scale-95 ${t.bg} ${t.text}`}
            >
              <span className="w-4 h-4 rounded-full bg-white/70 flex items-center justify-center"><Plus size={10} /></span>
              <TIcon size={12} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 왼쪽 분홍 선이 무엇인지 한 줄로 — 안 적으면 사람이 색인 줄 안다 */}
      {bgmCover.some(Boolean) && (
        <div className="flex items-center gap-1.5 pb-1 t-sub text-ds-v3-ink-2">
          <span className="w-[3px] h-3.5 rounded-full bg-ds-v3-bgm-line flex-shrink-0" />
          <span>왼쪽 선이 이어진 구간에는 <b className="font-semibold">배경음악이 함께 나옵니다</b> — 그 위로 안내 음성이 나갑니다.
            흐린 구간은 음원이 나가는 동안 잠시 멈춘 것이고, 영상 단계는 BGM을 끕니다.</span>
        </div>
      )}

      {/* ── 장식용 세로선을 **걷었다** (사용자 지적 2026-09-13) ────────────────────────
          *"저 정체불명에 파란선 쭉 이어져 있는건 뭐냐"* — 아무 뜻도 없는 선이었다.
          「워크플로우처럼 보이게」 하려고 넣은 장식(`left-[50px]` 의 회청색 세로선)인데,
          이 화면에는 **뜻이 있는 세로선이 이미 있다** — 카드 왼쪽의 BGM 레일(`BgmRail`,
          분홍). 뜻 없는 선이 그 옆에 나란히 서니 «이건 또 무슨 구간인가» 를 묻게 된다.
          정보를 나르지 않는 선은 정보를 나르는 선의 뜻을 흐린다. */}
      <div className="relative max-w-2xl">
        {카드목록.map(({ step, bgm: 접힌BGM, index: i, 시작 }, ci) => {
        const showTts  = hasTtsInline(step)
        const ttsText  = getTtsText(step)
        const isCustom = !!step.customType
        const isPreviewing = previewingId === step.id
        // 종류 판정은 `lib/bgmLane.stepKindOf` 한 곳 — 간편 화면 오늘 일과가 같은 함수를 쓴다.
        const kind  = stepKindOf(step, { videoIds: VIDEO_STEP_IDS, bgmIds: BGM_STEP_IDS, ttsKeys: TTS_STEP_KEYS, audioMap: AUDIO_STEP_MAP })
        const style = KIND_STYLE[kind]
        const KindIcon = style.icon
        const isExpanded = expandedIds.has(step.id)
        const summary = stepSummaryFor(step, kind, ttsText, allAudioFiles)
        // 「수정」·「삭제」 — 태블릿 이상은 머리 줄에, 폰은 머리 아래 따로 한 줄에 둔다(2026-10-23 QA:
        // 390px 에서 머리 줄에 넣으면 체크박스·펼치기가 카드 밖으로 밀렸다). 같은 요소를 두 자리에 그리고
        // 화면 폭으로 하나만 보인다.
        // 꺼진 단계의 흐림은 **이름·번호·아이콘에만** 건다(2026-10-23 디자인 검수). 예전엔 카드 전체에
        // 걸어서, 새로 넣은 「수정」「삭제」까지 흐려져 눌리지 않는 것처럼 보였다 — 지우고 싶은 단계가
        // 바로 이 꺼 둔 단계다.
        const 흐림 = step.enabled ? '' : 'opacity-50'
        const 동작버튼 = (
          <>
                {/* 수정 — 펼쳐서 내용을 고친다. 머리를 눌러도 펼쳐지지만 그걸 아는 사람이 없었다
                    (2026-10-23 사용자: 「삭제 수정 기능이 없다」). */}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); toggleExpanded(step.id) }}
                  onDragStart={e => e.stopPropagation()}
                  aria-label={isExpanded ? '수정 닫기' : '수정'}
                  title={isExpanded ? '수정 닫기' : '이 단계 내용 고치기'}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full t-sub font-normal bg-white/70
                             text-ds-v3-ink-2 hover:bg-white transition-colors flex-shrink-0 cursor-pointer"
                >
                  <Pencil size={11} />
                  {isExpanded ? '접기' : '수정'}
                </button>

                {/* 삭제 — **모든 단계**(2026-10-23). 예전엔 추가한 단계만 지울 수 있었다 — 기본 단계는
                    서버가 다시 채워 넣어서다. 이제 지운 표시(deleted)를 남겨 기본 단계도 지운다.
                    확인창 대신 **두 번 누르기**: 첫 번에 「정말 삭제」로 바뀌고, 다시 눌러야 지운다. */}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    if (지울후보 === step.id) deleteCard([step.id])
                    else set지울후보(step.id)
                  }}
                  onBlur={() => { if (지울후보 === step.id) set지울후보(null) }}
                  onDragStart={e => e.stopPropagation()}
                  aria-label={지울후보 === step.id ? '정말 삭제' : '단계 삭제'}
                  title={지울후보 === step.id ? '한 번 더 누르면 지웁니다' : '이 단계 삭제'}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full t-sub transition-colors flex-shrink-0 cursor-pointer
                    ${지울후보 === step.id
                      ? 'bg-ds-v3-warn text-white font-semibold'
                      : 'bg-white/70 text-ds-v3-ink-2 hover:text-ds-v3-warn hover:bg-white font-normal'}`}
                >
                  <Trash2 size={11} />
                  {지울후보 === step.id ? '정말 삭제' : '삭제'}
                </button>
          </>
        )
        const rowPlaying = previewingId === step.id || (!!previewAll && previewSpanId === step.id)

        return (
          <Fragment key={step.id}>
          {/* 이 카드 **앞자리**에 단계를 끼워 넣는 ＋ */}
          {renderInserter(시작)}
          <div
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => onDragOver(e, i)}
            onDragEnd={() => setDragIdx(null)}
            className={`relative mb-2.5 rounded-[20px] border transition-all duration-150 ${style.bg}
              ${dragIdx === i ? `${style.border} shadow-md scale-[1.01]` : 'border-transparent hover:shadow-sm'}`}
          >
            {/* BGM이 깔려 있는 구간 — 카드 왼쪽 분홍 레일. 목록만 봐서는 이 안내가 음악 위에
                얹히는지 맨목소리로 나가는지 알 수 없었다(특히 영상 단계가 BGM을 꺼 버린 뒤).
                규칙과 근거는 src/lib/bgmLane.js에 있다. 빗금(흐린 색)은 음원 재생 중 잠시 멈춤. */}
            <BgmRail cov={bgmCover[i]} />

            {/* ── 단계 헤더 행 ── */}
            {/* **키보드로도 열려야 한다**(UX-42). 예전에는 그냥 `div onClick` 이라
                마우스로만 열렸다 — 탭으로 닿지도 않고 보조기기에는 버튼으로 보이지도 않았다
                (2026-09-12 브라우저 실측: 헤더 7개 전부 `role=null`·`tabindex=null`).
                `button` 으로 바꾸지 않는 이유: 이 줄은 **드래그 손잡이**이기도 하고 안에
                버튼들이 들어 있어, 버튼 안에 버튼이 되면 그것들이 눌리지 않는다. */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              className="flex items-center gap-2.5 px-3.5 py-3 cursor-grab select-none
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-v3-tts"
              onClick={() => toggleExpanded(step.id)}
              onKeyDown={(e) => {
                // 스페이스·엔터만 받는다. 안쪽 버튼에서 올라온 것은 그 버튼이 처리한다.
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(step.id) }
              }}
            >
              <GripVertical size={14} className="text-ds-v3-ink-3 flex-shrink-0" />

              {/* 순서 이동 버튼 — 드래그 대안(고도화 제안 #26). 드래그는 그대로 남긴다.
                  마우스를 정확히 끌기 어려운 사람에게 드래그 전용 조작은 그 기능이 아예 없는
                  것과 같고, 현장 PC가 터치 화면이면 누구에게나 그렇다.
                  **늘 보이게 둔다** — hover로만 나타나면 터치 화면에서는 영영 못 찾는다
                  (카드 사이 ＋가 같은 이유로 늘 보인다. step-insert-position.test.js 사실 4). */}
              <span className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  // **카드 기준이다.** `i === 0` 으로 두면 접힌 BGM 때문에 첫 카드의
                  // index 가 1 이라 버튼이 살아 있고, 눌러도 화면은 그대로인데 배열만
                  // 바뀐다 — 사람은 자기가 방송을 바꿨다는 사실을 알 방법이 없다
                  // (2026-09-11 독립 검수 지적, 재현 1).
                  disabled={ci === 0}
                  title="위로 옮기기"
                  aria-label="위로 옮기기"
                  onClick={e => { e.stopPropagation(); moveStep(i, 카드목록[ci - 1].index) }}
                  onDragStart={e => e.stopPropagation()}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-ds-v3-line bg-white/85 shadow-sm
                             text-ds-v3-ink/70 hover:text-ds-v3-tts hover:border-ds-v3-tts/40 hover:bg-white transition-colors cursor-pointer
                             disabled:opacity-25 disabled:shadow-none disabled:hover:bg-white/85 disabled:hover:text-ds-v3-ink/70
                             disabled:hover:border-ds-v3-line disabled:cursor-default"
                >
                  <ArrowUp size={15} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  disabled={ci === 카드목록.length - 1}
                  title="아래로 옮기기"
                  aria-label="아래로 옮기기"
                  onClick={e => { e.stopPropagation(); moveStep(i, 카드목록[ci + 1].index) }}
                  onDragStart={e => e.stopPropagation()}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-ds-v3-line bg-white/85 shadow-sm
                             text-ds-v3-ink/70 hover:text-ds-v3-tts hover:border-ds-v3-tts/40 hover:bg-white transition-colors cursor-pointer
                             disabled:opacity-25 disabled:shadow-none disabled:hover:bg-white/85 disabled:hover:text-ds-v3-ink/70
                             disabled:hover:border-ds-v3-line disabled:cursor-default"
                >
                  <ArrowDown size={15} strokeWidth={2.5} />
                </button>
              </span>

              {/* 순서 번호 */}
              <span className={`w-6 h-6 flex items-center justify-center rounded-full ${style.solid} text-white t-sub font-semibold flex-shrink-0 shadow-sm ${흐림}`}>
                {i + 1}
              </span>

              {/* 성격 아이콘 배지 */}
              {KindIcon && (
                <span className={`w-7 h-7 rounded-full bg-white/70 flex items-center justify-center flex-shrink-0 ${style.text} ${흐림}`}>
                  <KindIcon size={13} />
                </span>
              )}

              {/* 대기 단계 — 분 입력 인라인 */}
              {step.id === 'wait_exercise' ? (
                <div className="flex-1 flex items-center gap-2 cursor-default select-text">
                  <span className="text-sm text-ds-v3-ink font-normal">체조 대기</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={step.waitMin ?? 5}
                    onClick={e => e.stopPropagation()}
                    onDragStart={e => e.stopPropagation()}
                    onChange={e => {
                      const val = Math.max(1, parseInt(e.target.value) || 1)
                      onChange(steps.map(s => s.id === 'wait_exercise' ? { ...s, waitMin: val } : s))
                    }}
                    className="w-14 border-0 rounded-full px-2 py-1 text-sm text-center bg-white/70 shadow-inner
                               text-ds-v3-ink focus:outline-none focus:ring-2 focus:ring-ds-v3-tts/40 nums cursor-text"
                  />
                  <span className="t-sub text-ds-v3-ink-2">분 대기</span>
                </div>
              ) : isCustom ? (
                /* 커스텀 단계 — 이름 편집 가능 */
                <input
                  value={step.label}
                  onChange={e => updateCustomLabel(step.id, e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onDragStart={e => e.stopPropagation()}
                  placeholder="단계 이름 입력"
                  className="flex-1 text-sm text-ds-v3-ink bg-transparent border-b border-ds-v3-line
                             focus:outline-none focus:border-ds-v3-tts px-1 cursor-text select-text"
                />
              ) : (
                <span className="flex-1 text-sm text-ds-v3-ink font-normal"><span className={흐림}>{step.label}</span>{!step.enabled && <span className="ml-1.5 t-sub text-ds-v3-ink-2">(꺼짐)</span>}</span>
              )}

              {/* 단계 미리듣기 버튼 — 누른 이 브라우저에서만 난다(현장은 조용하다).
                  BGM이 깔린 단계는 그 BGM부터 깔고 위에 얹는다(handleRowPreview). */}
              {/* 이 행이 지금 소리를 내고 있는가(rowPlaying) — 갈래가 둘이다. 단일 재생(previewingId)과
                  BGM 구간 묶음(previewAll + 이 행이 켠 것). 앞의 것만 보면 BGM 미리듣기 중에
                  버튼이 '미리듣기'로 남아, 끄는 방법이 없어 보인다(2026-09-03 실기 신고). */}
              {canPreview(step, kind, ttsText) && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    handleRowPreview(step, i, kind)
                  }}
                  onDragStart={e => e.stopPropagation()}
                  title={rowPlaying ? '눌러서 멈춥니다' : '이 PC에서만 들립니다 — 현장에는 나가지 않습니다'}
                  aria-label={rowPlaying ? '미리듣기 멈춤' : '미리듣기'}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full t-sub font-normal
                    transition-colors flex-shrink-0 cursor-pointer
                    ${rowPlaying
                      ? `${style.solid} text-white shadow-sm`
                      : 'bg-white/70 text-ds-v3-ink-2 hover:bg-white'}`}
                >
                  <Play size={9} className={rowPlaying ? 'animate-pulse' : ''} />
                  {/* 폰(390px)에서는 글자를 감추고 ▶ 만 — 글자가 자리를 먹어 체크·펼치기가 카드 밖으로 밀렸다
                      (2026-09-17 브라우저 전수 시험). 뜻은 aria-label·title 로 남는다. */}
                  {rowPlaying ? '멈춤 ■' : <span className="hidden tablet:inline">미리듣기</span>}
                </button>
              )}

              <span className="hidden tablet:flex items-center gap-2.5 flex-shrink-0">{동작버튼}</span>

              {/* 활성화 체크박스 */}
              <input
                type="checkbox"
                checked={step.enabled}
                onChange={() => toggleStep(step.id)}
                onClick={e => e.stopPropagation()}
                className="w-4 h-4 accent-ds-v3-tts cursor-pointer flex-shrink-0"
              />

              {/* 펼치기/접기 */}
              <span className={`flex-shrink-0 ${style.text}`}>
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </div>

            <div className="tablet:hidden flex justify-end gap-2 px-3.5 -mt-1.5 pb-2.5 [&>button]:min-h-[44px] [&>button]:px-4">{동작버튼}</div>

            {/* 접힌 상태 요약 한 줄 — 클릭하면 펼쳐짐.
                **접힌 BGM 도 여기 적는다**(UX-16) — 안 적으면 카드를 펼치기 전에는
                이 안내에 BGM 이 깔린다는 사실이 어디에도 안 보인다. 접기 전에는 제 카드로
                보이던 것이라, 안 적으면 그냥 없어진 것으로 읽힌다. */}
            {!isExpanded && (summary || 접힌BGM) && (
              <div
                role="button"
                tabIndex={0}
                aria-expanded={false}
                onClick={() => toggleExpanded(step.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(step.id) }
                }}
                className="px-3.5 pb-3 -mt-1.5 t-sub text-ds-v3-ink-2 truncate cursor-pointer
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-v3-tts"
              >
                {summary}
                {접힌BGM && (
                  <span className={접힌BGM.enabled ? 'text-ds-v3-bgm' : 'text-ds-v3-ink-3'}>
                    {summary ? ' · ' : ''}{bgm요약(접힌BGM, BGM폴더이름)}
                  </span>
                )}
              </div>
            )}

            {isExpanded && (
            <>
            {/* 꺼진 단계는 아래 설정 칸 대부분이 숨는다(켜진 단계에만 그린다). 「수정」을 눌렀는데
                고칠 것이 안 보이면 고장으로 읽힌다 — 이유를 한 줄로 말한다(2026-10-23 디자인 검수). */}
            {!step.enabled && (
              <p className="px-4 pb-2 t-sub text-ds-v3-ink-2">꺼 둔 단계입니다 — 체크를 켜면 내용을 고칠 수 있습니다.</p>
            )}
            {/* 이 단계에만 적용할 볼륨 — 어느 단계에 슬라이더를 안 그리는지까지 포함해
                morningEditorParts.jsx의 StepVolumePanel이 그린다(2026-09-03 이동). */}
            <StepVolumePanel step={step} onChange={(field, v) => updateStepVolume(step.id, field, v)} />
            {/* 재생 배속 — 서버가 배속을 실어 보내는 단계에만 보여준다(canSetRate).
                칸 자체는 morningEditorParts.jsx의 StepRatePanel이 그린다(2026-09-03 이동). */}
            {canSetRate(step) && step.enabled && (
              <StepRatePanel step={step} onChange={rate => updateStepRate(step.id, rate)} />
            )}

            {/* ── 방송 뒤 배경 영상 (morning_video / lunch_video_after / dinner_video_after) ──
                2026-09-21: 이 PC 의 「배경 영상」 폴더에서 고른다. 어느 폴더·차례인지는 아래
                「나가는 파일」 칸이 정하고, 여기는 얼마나 띄울지만 정한다. */}
            {VIDEO_STEP_IDS.has(step.id) && step.enabled && (
              <div className="px-3.5 pb-3.5 border-t border-white/60">
                <div className="mt-2.5 space-y-2.5">
                  <p className="inline-flex items-center gap-1.5 t-sub text-ds-v3-ink-2 font-normal">
                    <Film size={12} className="flex-shrink-0" />
                    배경 영상 — 소리 없이 나가고, 소리는 함께 트는 BGM이 냅니다
                  </p>
                  <div className="flex items-center gap-2 bg-white/60 rounded-full px-3 py-1.5 w-fit">
                    <label className="t-sub text-ds-v3-ink-2">영상+BGM</label>
                    <input
                      type="number" min={1} max={120}
                      value={step.durationMin ?? 30}
                      onChange={e => updateVideoField(step.id, 'durationMin', Math.max(1, parseInt(e.target.value) || 30))}
                      onClick={e => e.stopPropagation()}
                      onDragStart={e => e.stopPropagation()}
                      className="w-10 border-0 bg-transparent t-sub text-center
                                 text-ds-v3-ink focus:outline-none nums cursor-text"
                    />
                    <span className="t-sub text-ds-v3-ink-2">분 후 자동 종료</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── BGM 설정 (짝을 못 찾아 제 카드로 남은 BGM 단계) ──
                UX-16 뒤로 대부분의 BGM 은 위 TTS 카드 안으로 접힌다. 여기 남는 것은
                사람이 순서를 바꿔 **뒤에 TTS 가 없어진** BGM 뿐이다. 그때도 편집은 돼야 한다. */}
            {hasBgmInline(step) && step.enabled && (
              <div className="px-3.5 pb-3.5 border-t border-white/60">
                <BgmSourceFields {...bgm속성(step)} />
              </div>
            )}

            {/* ── 커스텀 BGM 재생목록 설정 (여러 곡을 담아 순서대로 재생) ── */}
            {step.customType === 'bgm' && step.enabled && (() => {
              const bgmItems = (step.playlist && step.playlist.length)
                ? step.playlist
                : [{ bgm_type: step.bgm_type || BGM_DEFAULT_TYPE, bgm_value: step.bgm_value || '', bgm_title: step.bgm_title || '', bgm_delay: step.bgm_delay ?? 5, duration_sec: 60 }]
              return (
                <div className="px-3.5 pb-3.5 border-t border-white/60" onDragStart={e => e.stopPropagation()}>
                  <div className="mt-2.5">
                    <BgmPlaylistEditor
                      items={bgmItems}
                      onUpdateItem={(idx, patch) => updatePlaylistItem(step.id, bgmItems, idx, patch)}
                      onAdd={() => addPlaylistItem(step.id, bgmItems, { bgm_type: BGM_DEFAULT_TYPE, bgm_value: '', bgm_title: '', bgm_delay: 5, duration_sec: 60 })}
                      onRemove={idx => removePlaylistItem(step.id, bgmItems, idx)}
                      onReorder={(from, to) => reorderPlaylistItem(step.id, bgmItems, from, to)}
                    />
                  </div>
                </div>
              )
            })()}

            {/* ── 커스텀 음원 재생목록 설정 ── */}
            {step.customType === 'audio' && step.enabled && (() => {
              const options = allAudioFiles.filter(af => !VIDEO_CATEGORIES.includes(af.category))
              const selectedIds = ((step.playlist && step.playlist.length) ? step.playlist : (step.audio_file_id ? [step.audio_file_id] : [])).map(String)
              return (
                <div className="px-3.5 pb-3.5 border-t border-white/60" onDragStart={e => e.stopPropagation()}>
                  <div className="mt-2.5">
                    <PlaylistChips
                      options={options}
                      selectedIds={selectedIds}
                      onChange={ids => updateVideoField(step.id, 'playlist', ids)}
                      accent="bg-ds-v3-ink-3"
                      emptyText="업로드된 음원이 없습니다."
                    />
                  </div>
                </div>
              )
            })()}

            {/* ── 커스텀 대기 단계 설정 ── */}
            {step.customType === 'delay' && step.enabled && (
              <div className="px-3.5 pb-3.5 border-t border-white/60" onDragStart={e => e.stopPropagation()}>
                <div className="mt-2.5 flex items-center gap-2 bg-white/60 rounded-full px-3.5 py-2 w-fit">
                  <input type="number" min={1} max={600} value={step.wait_sec ?? 5} onClick={e => e.stopPropagation()}
                    onChange={e => updateVideoField(step.id, 'wait_sec', Number(e.target.value))}
                    className="w-12 border-0 bg-transparent t-sub text-ds-v3-ink text-center nums focus:outline-none cursor-text" />
                  <span className="t-sub text-ds-v3-ink-2">초 대기 후 다음 단계</span>
                </div>
              </div>
            )}

            {/* ── 커스텀 업로드 영상 재생목록 설정 ── */}
            {step.customType === 'video_file' && step.enabled && (() => {
              const options = allAudioFiles.filter(af => VIDEO_CATEGORIES.includes(af.category) && af.filename)
              // 재생목록 항목은 파일 id만일 수도, { id, rate, volume } 객체일 수도 있다.
              // 옛 저장분은 전부 앞의 모양이고, 값이 없으면 단계 설정을 따른다.
              const raw   = (step.playlist && step.playlist.length) ? step.playlist
                          : (step.audio_file_id ? [step.audio_file_id] : [])
              const items = normalizePlaylistItems(raw)
              const selectedIds = items.map(it => String(it.id))
              const nameOf = (id) =>
                options.find(o => String(o.id) === String(id))?.original_name || `영상 #${id}`
              const patchItem = (id, patch) => updateVideoField(step.id, 'playlist',
                denormalizePlaylistItems(items.map(it =>
                  String(it.id) === String(id) ? { ...it, ...patch } : it)))
              return (
                <div className="px-3.5 pb-3.5 border-t border-white/60" onDragStart={e => e.stopPropagation()}>
                  <div className="mt-2.5 space-y-2.5">
                    <PlaylistChips
                      options={options}
                      selectedIds={selectedIds}
                      onChange={ids => updateVideoField(step.id, 'playlist', reconcilePlaylist(raw, ids))}
                      accent="bg-ds-v3-ink"
                      emptyText="업로드된 영상이 없습니다. 음원 및 동영상 관리에서 먼저 업로드하세요."
                    />

                    {/* 영상마다 따로 — 담은 영상이 둘 이상일 때만 보여준다. 하나뿐이면
                        위의 단계 설정으로 충분한데 같은 것을 두 군데 두면 어느 쪽이 이기는지 헷갈린다. */}
                    {items.length > 1 && (
                      <div className="space-y-1.5">
                        <p className="t-sub text-ds-v3-ink-2">
                          영상마다 다르게 — <b>비워 두면 위의 단계 설정</b>을 따릅니다.
                        </p>
                        {items.map(it => (
                          <div key={it.id} className="flex items-center gap-2 flex-wrap bg-white/60 rounded-2xl px-3 py-2">
                            <span className="t-sub text-ds-v3-ink font-normal truncate max-w-[160px]">{nameOf(it.id)}</span>
                            <Gauge size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
                            <div onClick={e => e.stopPropagation()} className="flex items-center gap-1.5">
                              <RateInput
                                percent={rateToPercent(it.rate ?? step.rate ?? 1)}
                                onChange={pct => patchItem(it.id, { rate: percentToRate(pct) })}
                              />
                              {/* 이 영상만 따로 정한 값을 지운다 — 다시 위의 단계 설정을 따른다.
                                  RateInput 안의 "정속"은 100%를 **명시**하는 것이라 뜻이 다르다. */}
                              {it.rate !== null && (
                                <button
                                  onClick={e => { e.stopPropagation(); patchItem(it.id, { rate: null }) }}
                                  className="h-7 px-2 rounded-btn t-sub text-ds-v3-ink-2 bg-white/70 hover:bg-white
                                             border border-ds-v3-line/60 transition-colors">
                                  단계 따름
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 ml-auto">
                              <Volume2 size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
                              <input type="number" min={0} max={100}
                                value={it.volume ?? ''}
                                placeholder="기본"
                                onClick={e => e.stopPropagation()}
                                onChange={e => {
                                  const v = e.target.value
                                  patchItem(it.id, { volume: v === '' ? null : Math.max(0, Math.min(100, Number(v))) })
                                }}
                                className="w-14 border border-ds-v3-line rounded-full px-2 py-0.5 t-sub text-ds-v3-ink
                                           text-center nums bg-white focus:outline-none focus:border-ds-v3-tts" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* ── 인라인 TTS 편집 영역 (TTS 단계이고 활성화된 경우만) ── */}
            {/* ── BGM 토글 (UX-16) ──
                사용자 원문: *"그냥 TTS인데, 안에 토글로 BGM이 내제될 수 있게"*.
                **켜고 끄는 것은 그 BGM 단계의 `enabled` 하나다** — 원래 카드에 있던 바로 그
                스위치이고 자리만 여기로 옮겼다. 새 저장 규칙이 생기지 않고, 끄면 시퀀서가
                그 단계를 건너뛴다(예전과 똑같다).

                **`step.enabled` 를 조건에 넣지 않는다.** TTS 를 끄면 이 칸이 사라지는데
                BGM 단계는 따로라 **여전히 방송에 나간다** — 화면에서만 사라지는 것이
                이 저장소에서 가장 비싼 실패다. TTS 가 꺼져 있으면 그 사실을 말해 준다. */}
            {/* ── 연결 고르개 — "이 자리에서 무엇이 나가나" (2026-09-13, 설계 §3-D) ────────
                예전엔 이 자리에 아무것도 없었다. 단계가 어느 파일을 트는지는 **코드에 박힌
                카테고리 이름**이 정했고, 화면에는 그 이름을 적은 접이식 표만 있었다.

                **식사 안내 단계는 뺀다** — 그 셋은 이미 「녹음 파일 선택」 칸(`GraceFilePanel`)을
                갖고 있다. 같은 일을 하는 길이 둘이면 어느 것이 이기는지 사람이 물어야 한다.
                (`sourceResolved.media` 는 그 셋에도 붙어 있으므로 **id 로 가른다.**)

                판정 근거는 서버가 내려준 `sourceResolved` 하나다 — 화면이 다시 계산하면
                방송이 고르는 것과 화면이 말하는 것이 갈린다. */}
            {step.sourceResolved?.media && !GRACE_STEP_MAP[step.id] && (
              <div className="px-3.5 pb-3.5 border-t border-white/60">
                <p className="t-sub text-ds-v3-ink-2 mt-2.5">나가는 파일</p>
                <StepSourcePicker step={step} onChange={src => updateStepSource(step.id, src)} />
                {/* 영상은 폴더에서 랜덤·차례로도 돌린다(2026-09-21 「영상도 마찬가지로」).
                    **음원(녹음 등)에는 안 붙인다** — 그 자리는 늘 같은 녹음이 나가야 한다.
                    안 고르면 예전처럼 맨 앞 파일 — 서버 broadcastSteps.stepVideoFile 과 같은 규칙. */}
                {step.sourceResolved.media === 'video' && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="t-sub text-ds-v3-ink-2 w-10 flex-shrink-0">차례</span>
                    {/* 방송 뒤 배경 영상은 「맨 앞 파일」이 없다 — 서버(stepVideoAfter)가 안 고르면 랜덤이다 */}
                    {(VIDEO_STEP_IDS.has(step.id) ? BGM_ORDERS : [{ id: undefined, label: '맨 앞 파일', desc: '늘 목록 맨 앞 영상 하나' }, ...BGM_ORDERS]).map(o => (
                      <button key={o.id ?? 'first'} type="button" title={o.desc}
                        aria-pressed={(VIDEO_STEP_IDS.has(step.id) ? (step.mediaOrder || 'random') : step.mediaOrder) === o.id}
                        onClick={e => { e.stopPropagation(); updateVideoField(step.id, 'mediaOrder', o.id) }}
                        onDragStart={e => e.stopPropagation()}
                        className={`px-3 py-1.5 rounded-full t-sub font-semibold transition-colors cursor-pointer
                          ${(VIDEO_STEP_IDS.has(step.id) ? (step.mediaOrder || 'random') : step.mediaOrder) === o.id ? 'bg-ds-v3-bgm text-white shadow-sm' : 'bg-white/70 text-ds-v3-ink-2 hover:bg-white'}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {접힌BGM && (
              <div className="px-3.5 pb-3.5 border-t border-white/60">
                <div className="mt-2.5 rounded-xl bg-ds-v3-bgm-bg/60 border border-ds-v3-bgm-bg px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Volume2 size={12} className="text-ds-v3-bgm shrink-0" />
                    <span className="t-sub font-semibold text-ds-v3-ink">이 안내에 BGM 재생</span>
                    <span className="t-sub text-ds-v3-ink-2 truncate">
                      {bgm요약(접힌BGM, BGM폴더이름)}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); toggleStep(접힌BGM.id) }}
                      onDragStart={e => e.stopPropagation()}
                      role="switch"
                      aria-checked={!!접힌BGM.enabled}
                      aria-label="이 안내에 BGM 재생"
                      className={`ml-auto shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer relative
                        ${접힌BGM.enabled ? 'bg-ds-v3-bgm-line' : 'bg-ds-v3-line-2'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all
                        ${접힌BGM.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {!step.enabled && 접힌BGM.enabled && (
                    <p className="mt-1.5 t-sub text-ds-v3-bgm leading-relaxed">
                      이 안내는 꺼져 있지만 <strong>BGM 은 그대로 나갑니다.</strong>
                      함께 끄려면 위 스위치도 끄세요.
                    </p>
                  )}
                  {접힌BGM.enabled && <BgmSourceFields {...bgm속성(접힌BGM)} />}
                </div>
              </div>
            )}

            {showTts && step.enabled && (
              <div className="px-3.5 pb-3.5 border-t border-white/60">
                {/* 투약 안내: 대기 시간 + 종료일 설정 */}
                {step.id === 'medication_tts' && (
                  <div className="mt-2.5 mb-2 flex flex-wrap gap-4 items-end">
                    <div>
                      <label className="block t-sub text-ds-v3-ink-2 mb-1">BGM 시작 후 대기 시간</label>
                      <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-3 py-1.5 w-fit">
                        <input
                          type="number" min={1} max={60}
                          value={step.delay_min ?? 6}
                          onChange={e => onChange(steps.map(s => s.id === step.id ? { ...s, delay_min: Math.max(1, parseInt(e.target.value) || 6) } : s))}
                          onClick={e => e.stopPropagation()}
                          onDragStart={e => e.stopPropagation()}
                          className="w-10 border-0 bg-transparent t-sub text-ds-v3-ink
                                     focus:outline-none nums text-center cursor-text"
                        />
                        <span className="t-sub text-ds-v3-ink-2">분</span>
                      </div>
                    </div>
                    <div>
                      <label className="block t-sub text-ds-v3-ink-2 mb-1">방송 종료일 (선택)</label>
                      <input
                        type="date"
                        value={step.end_date || ''}
                        onChange={e => onChange(steps.map(s => s.id === step.id ? { ...s, end_date: e.target.value || null } : s))}
                        onClick={e => e.stopPropagation()}
                        onDragStart={e => e.stopPropagation()}
                        placeholder="미설정 시 무기한"
                        className="border-0 rounded-full px-3 py-1.5 t-sub text-ds-v3-ink bg-white/70 shadow-inner
                                   focus:outline-none focus:ring-2 focus:ring-ds-v3-tts cursor-text"
                      />
                      {step.end_date && (
                        <button
                          onClick={e => { e.stopPropagation(); onChange(steps.map(s => s.id === step.id ? { ...s, end_date: null } : s)) }}
                          onDragStart={e => e.stopPropagation()}
                          className="ml-1.5 t-sub text-ds-v3-ink-2 hover:text-ds-v3-warn transition-colors cursor-pointer"
                        >
                          ✕ 해제
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {/* 식사 안내: 녹음 파일 선택 */}
                {GRACE_STEP_MAP[step.id] && (
                  <GraceFilePanel
                    category={GRACE_STEP_MAP[step.id]}
                    useGraceAudio={step.useGraceAudio}
                    onToggle={val => updateGraceAudio(step.id, val)}
                  />
                )}
                {/* 음성 선택 */}
                <div className="flex items-center gap-2 mt-2.5 mb-2">
                  <Mic size={11} className="text-ds-v3-ink-2 flex-shrink-0" />
                  <span className="t-sub text-ds-v3-ink-2">음성</span>
                  {[
                    { id: 'female', label: '여자' },
                    { id: 'male',   label: '남자' },
                  ].map(v => (
                    <button
                      key={v.id}
                      onClick={e => { e.stopPropagation(); updateTtsVoice(step.id, v.id) }}
                      onDragStart={e => e.stopPropagation()}
                      className={`px-3 py-1 rounded-full t-sub font-semibold transition-colors cursor-pointer
                        ${(step.ttsVoice || 'female') === v.id
                          ? 'bg-ds-v3-tts text-white shadow-sm'
                          : 'bg-white/70 text-ds-v3-ink-2 hover:bg-white'}`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <textarea
                    value={ttsText}
                    onChange={e => {
                      if (isCustom || step.id === 'medication_tts') updateCustomContent(step.id, e.target.value)
                      else onTtsChange?.(step.id, e.target.value)
                    }}
                    onClick={e => e.stopPropagation()}
                    onDragStart={e => e.stopPropagation()}
                    rows={3}
                    placeholder="TTS로 읽을 텍스트를 입력하세요..."
                    className="flex-1 border-0 rounded-2xl px-3.5 py-2.5 text-sm text-ds-v3-ink bg-white/80 shadow-inner
                               leading-relaxed focus:outline-none focus:ring-2 focus:ring-ds-v3-tts resize-none
                               cursor-text select-text"
                  />
                  {/* 미리듣기 버튼 */}
                  <button
                    onClick={e => { e.stopPropagation(); handlePreview(step.id) }}
                    disabled={!ttsText.trim() || !!previewingId}
                    title="브라우저에서 미리듣기"
                    className="self-end flex items-center gap-1.5 px-3.5 py-2.5 bg-white/70 hover:bg-white
                               text-ds-v3-ink rounded-2xl t-sub shadow-sm
                               font-semibold disabled:opacity-40 transition-colors flex-shrink-0 cursor-pointer"
                  >
                    <Play size={12} className={isPreviewing ? 'animate-pulse text-ds-v3-tts' : ''} />
                    {isPreviewing ? '재생 중' : '미리듣기'}
                  </button>
                </div>
              </div>
            )}
            </>
            )}
          </div>
          </Fragment>
        )
      })}
      {/* 맨 끝자리 */}
      {renderInserter(steps.length)}

      {/* 지운 기본 단계 — 되살릴 길을 남긴다. 추가한 단계는 지우면 끝이라 여기 안 온다. */}
      {지운단계.length > 0 && (
        <div className="mt-3 rounded-2xl border border-dashed border-ds-v3-line px-4 py-3">
          <p className="t-sub text-ds-v3-ink-2 mb-2">지운 단계 {지운단계.length}개 — 방송에서 빠졌습니다. 되살리면 목록 맨 아래로 돌아옵니다.</p>
          <ul className="m-0 list-none p-0 space-y-1.5">
            {지운단계.map(s => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-ds-v3-ink-2 line-through">{s.label || s.id}</span>
                <button
                  type="button"
                  onClick={() => restoreStep(s.id)}
                  className="flex items-center gap-1 px-4 min-h-[44px] tablet:px-2.5 tablet:min-h-0 py-1 rounded-full t-sub font-normal bg-white/70 border border-ds-v3-line
                             text-ds-v3-ink-2 hover:bg-white transition-colors flex-shrink-0 cursor-pointer"
                >
                  <RotateCcw size={11} />
                  되살리기
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}


export default StepList
