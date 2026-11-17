import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Music2, Video, Upload, Play, Pause, Trash2,
  X, List, AlertCircle, Pencil, Check,
  ChevronRight,
  Folder, FolderPlus, FolderInput, LayoutGrid, ArrowUpToLine,
  Captions, Search, RotateCcw,
} from 'lucide-react'
import {
  AUDIO_URL,
  getAudioFiles, uploadAudioFile, deleteAudioFile, moveAudioFile, makeAudioPrimary, recordAudioDuration,
  getPlaylist, savePlaylist,
  renameAudioFile, updateAudioSource,
  getFolders, createFolder, renameFolder, deleteFolder,
} from '../../../lib/api'
import { audioBus } from '../../../lib/audioBus'
import {
  CATEGORIES, GROUP_META, referenceBadge,
} from './musicManagementConst'
import {
  PlaylistModal, NewFolderModal, MoveFileModal,
} from './musicManagementModals'
import { SubtitleEditor } from './subtitleEditorModal'
import { SourceUploadFields, SourceDetail, BgmRolePanel } from './musicManagementSource'
import { useBgmFolders, BGM_FOLDERS_CHANGED } from '../../../lib/bgmFolders'
import { bgmFoldersNow } from '../../../lib/bgmFolderCache'
import { 빈출처, 빠진출처칸 } from '../../../lib/audioSourceForm'
// 찾기·줄 세우기는 순수 함수 한 곳에 있다 — 화면이 제 규칙을 또 적으면 라벨과 동작이 갈린다.
import { 파일고르기, 폴더고르기, 정렬규칙 } from '../../../lib/mediaBrowse'
// 옮기기의 판정과 **도는 자리**도 화면 밖에 있다 — 시험이 옮기는 창구를 대역으로 갈아 끼워
// 몇 번·어떤 id 로 불렀는지까지 재려면 여기 있어야 한다(V③ R16 지적 1).
import { 옮기기실행, 옮기기안내 } from '../../../lib/mediaMove'
// 목록의 작은 표시(길이 · 용량 · 올린 때)도 순수 함수 한 곳이 짓는다.
import { 작은표시 } from '../../../lib/mediaMeta'
import {
  Badge, TreeNode, GroupHeader,
} from './musicManagementTree'

// 자막이 있는지, 아직 초안인지 한눈에. 업로드하면 뒤에서 초안이 만들어지므로 이게 없으면
// 사람이 "됐나 안 됐나"를 알 방법이 없다.
// 이 파일이 지금 그 자리에서 나가는 것인지. 판정은 서버가 한다(file.is_primary).

// ── 자막 꼬리표 — **갈래 옆에 선다** (사용자 지시 2026-09-16) ──────────────────
// *"자막이 편집해서 붙으면 갈래 옆에다가 #자막 태그도 달았으면 좋겠는데"*
//
// 앞 판은 이 꼬리표를 **파일 이름 단추 안**에 뒀다. 두 가지가 나빴다:
//   · 이름이 그만큼 더 잘렸다 — 줄에서 가장 중요한 것이 이름인데 그 자리를 뺏었다.
//   · 단추 안의 뱃지라 **눌러도 아무 일이 없는 것**이 단추처럼 보였다.
// 이제 갈래 칸으로 옮긴다. 갈래와 자막은 둘 다 「이 파일이 어떤 것인가」라 한자리가 맞다.
//
// `#` 을 붙이는 이유: 갈래는 **하나만** 붙는 분류(아침 방송·BGM…)이고 자막은 **있고 없고**다.
// 같은 모양으로 그리면 「자막」이라는 갈래가 있는 것처럼 읽힌다. `#` 이 그 둘을 가른다.
function SubtitleBadge({ status }) {
  if (!status) return null
  const 방송용 = status === 'ready'
  return (
    <span
      title={방송용 ? '자막이 붙어 있습니다 — 방송에 나갑니다' : '자막 초안입니다 — 아직 방송에 안 나갑니다'}
      className={'flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full '
        + 'text-[10px] font-semibold border '
        + (방송용
          ? 'border-ds-v3-tts/30 bg-ds-v3-tts/10 text-ds-v3-tts'
          : 'border-ds-v3-line bg-ds-v3-surface-2 text-ds-v3-ink-3')}>
      <Captions size={10} aria-hidden="true" />
      {방송용 ? '#자막' : '#초안'}
    </span>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────
// 처음부터 펼쳐 두는 그룹. **이 표가 초기 불러오기의 근거다** — 아래 effect 가 이것을 보고
// 첫 요청을 낸다. 여기만 고치면 펼침과 불러오기가 같이 따라온다(두 벌로 두면 한쪽만 고친다).
// 컴포넌트 **밖**에 둔다 — 안에 두면 매 렌더마다 새 객체라 effect 의 의존성이 계속 바뀐다.
// **음원이 먼저 나온다**(사용자 지시 2026-09-12). 예전엔 「내 폴더」가 맨 위에서 펼쳐진 채였고,
// 정작 이 화면에 온 사람이 찾는 것(음원)은 접혀 있었다.
// 배경음악도 처음부터 편다(2026-09-22) — 방송용·식사용 폴더가 여기 있다는 것을 찾지 않아도 보이게.
const 초기펼침 = { audio: true, bgm: true, video: false, my: false }

// 화면을 열면 **바로 오디오 목록이 보인다.** 예전엔 `cat: null` 로 시작해 "왼쪽 트리에서
// 폴더를 선택하세요"만 떠 있었다 — 음원을 보러 온 사람에게 한 번 더 누르라고 시키는 자리다.
const 첫자리 = { cat: 'misc-audio', path: [] }

// 내부 드래그의 이름표 — **보내는 쪽과 받는 쪽의 단일 출처**.
// 두 곳에 글자로 적어 두었더니 목록을 다시 짜면서 보내는 쪽만 `text/plain` 으로 바뀌었고,
// 받는 쪽은 그대로라 **파일을 폴더로 끌어다 놔도 아무 일이 안 일어났다**(V③ R15 지적 2).
// 상수 하나로 두면 한쪽만 바뀌는 일이 안 생긴다.
const 내부드래그 = 'application/x-carecast-audio-file-id'

// 주소가 가리키는 첫 자리 — 고르개의 「곡 넣으러 가기」가 `/upload?cat=bgm&folder=<번호>` 로 온다(2026-09-22 화면 검수 High).
// 그 폴더 **안**에서 열어야 곡이 그 폴더로 올라간다(음원 자리에서 열리면 어느 방송에서도 안 나가는 곡이 된다).
// 폴더 이름은 고르개가 들고 온 목록에서 찾는다(없으면 번호만으로 열고 이름은 빵부스러기가 「BGM 폴더」로 적는다).
function 주소첫자리() {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('cat') !== 'bgm') return 첫자리
    const id = parseInt(q.get('folder') || '', 10)
    if (!id) return { cat: 'bgm', path: [] }
    const f = (bgmFoldersNow() || []).find(x => x.id === id)
    return { cat: 'bgm', path: [{ id, name: f?.name || 'BGM 폴더' }] }
  } catch { return 첫자리 }
}

export default function MusicManagement() {
  const [selection, setSelection] = useState(주소첫자리) // 현재 탐색 위치
  // 고르개에서 새 창으로 왔나(?from=picker) — 「창 닫고 돌아가기」 줄을 띄운다
  const [고르개에서옴] = useState(() => { try { return new URLSearchParams(window.location.search).get('from') === 'picker' } catch { return false } })
  const [닫기안됨, set닫기안됨] = useState(false)
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('mm_view') || 'grid' } catch { return 'grid' }
  })

  // 트리 상태
  const [groupExpanded, setGroupExpanded] = useState(초기펼침)
  const [expanded,    setExpanded]    = useState(() => new Set())
  const [childrenMap, setChildrenMap] = useState({})
  const [loadingKeys, setLoadingKeys] = useState(() => new Set())
  // 그룹 자체(내 폴더/오디오/영상)에 사용자가 직접 만든 폴더 — 시스템 카테고리와 나란히 표시됨
  const [groupFolders, setGroupFolders] = useState({ misc: null, 'misc-audio': null, bgm: null, 'misc-video': null })
  // BGM 폴더의 용도(기본 폴더인가)·곡 수 — 고르개들과 같은 한 벌(src/lib/bgmFolders.js)
  const { folders: bgm목록 } = useBgmFolders()

  // 현재 위치 콘텐츠
  const [subfolders,   setSubfolders]   = useState([])
  const [files,        setFiles]        = useState([])
  const [playlist,     setPlaylist]     = useState([])
  const [contentLoading, setContentLoading] = useState(false)
  // **"못 불러왔다"와 "비었다"를 가른다.** 예전엔 목록을 못 불러오면 조용히 빈 목록이 됐는데,
  // 그건 화면에서 "음원이 하나도 없다"와 똑같이 보인다 — 이 프로젝트에서 실제로 "없어졌다"는
  // 신고가 여러 번 있었고 대개 원인은 다른 데(빈 DB·서버 미기동)였다. 구별해서 말해 준다.
  const [loadError, setLoadError] = useState('')
  const [showModal,    setShowModal]    = useState(false)
  // 자막을 편집할 음원·영상(없으면 null).
  const [subtitleFile, setSubtitleFile] = useState(null)
  const [showNewFolder,setShowNewFolder]= useState(false)
  const [moveTarget,   setMoveTarget]   = useState(null)
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState('')
  // UX-06 — 진행·성공·재시도. 실패한 파일을 들고 있어야 한 번 더 누를 수 있다.
  const [uploadPct,    setUploadPct]    = useState(0)
  const [uploadName,   setUploadName]   = useState('')
  const [uploadOk,     setUploadOk]     = useState('')
  const [failedFile,   setFailedFile]   = useState(null)
  // 올리기 전에 적는 출처·이용 조건 — 이번에 올리는 파일 전부에 들어간다(2026-09-21).
  const [uploadSource, setUploadSource] = useState(빈출처)
  // 삭제가 막힌 이유(UX-29) — 쓰고 있는 파일이면 서버가 어디서 쓰는지 알려준다.
  const [deleteError,  setDeleteError]  = useState('')
  const okTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(okTimerRef.current), [])
  const [playingId,    setPlayingId]    = useState(null)
  const [renameVal,    setRenameVal]    = useState('')
  const [dragOverMain, setDragOverMain] = useState(false)
  // ── 3단 구성이 새로 쓰는 상태 둘 (2026-09-13) ────────────────────────────────
  // `고른것` 은 **줄 열쇠**를 담는다(`f<파일id>` · `d<폴더id>`) — 파일과 폴더가 같은
  // 목록에 섞여 있어서 숫자 id 만으로는 둘을 못 가른다.
  const [고른것, setz고른것] = useState(() => new Set())
  // 오른쪽에 펼친 것. `{ 종류: 'file'|'folder', 것 }`
  const [상세, set상세] = useState(null)
  const fileInputRef = useRef(null)
  const previewRef   = useRef(null)
  const previewBusRef = useRef(null)   // [audioBus] 미리듣기 장부 등록 손잡이

  // ── 세 칸이 들어갈 폭이 있나 — **화면 폭이 아니라 이 자리의 폭**을 잰다 (2026-09-13) ──
  //
  // 이 화면은 두 껍데기에서 돈다. 통합 홈(`/upload`)에서는 1280px 를 거의 다 쓰지만,
  // 설정(`/admin?section=musicManagement`)에서는 **왼쪽 사이드바가 먼저 280px 을 가져간다.**
  // 그 좁은 자리에 세 칸을 그대로 밀어 넣으니 이름 칸이 「아…」 로 잘렸다(사용자 지적).
  //
  // `laptop:` 같은 미디어 질의로는 못 고친다 — 그건 **화면 폭**을 보므로 1920 모니터에서는
  // 두 껍데기가 똑같이 「넓다」로 판정된다. 실제로 남은 폭을 재야 한다.
  const 판ref = useRef(null)
  const [판폭, set판폭] = useState(1280)
  useEffect(() => {
    const el = 판ref.current
    if (!el) return
    const 재기 = () => set판폭(el.clientWidth || 1280)
    재기()
    if (typeof ResizeObserver === 'undefined') return   // 아주 낡은 브라우저 — 넓다고 보고 간다
    const ro = new ResizeObserver(재기)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 왼쪽 176 + 오른쪽 288 + 사이 여백 24 = 488. 가운데가 이름·갈래·정보 세 칸을 담으려면
  // 최소 420 은 있어야 한다(이름 칸이 두 글자로 줄던 실측이 그 아래였다).
  // 2026-09-22: 왼쪽을 176 → 256 으로 넓혔다(사용자 지적 「좌측 패널이 너무 좁아, 폴더 이름 깨지잖아」). 그만큼 문턱도 올린다.
  const 좁나 = 판폭 < 988
  // 배경음악으로 곧장 온 것이면 좁은 화면에서도 왼쪽 목록을 편다 — 「배경음악」 글자가 보여야 어디인지 안다.
  const [트리열림, set트리열림] = useState(() => selection.cat === 'bgm')

  const { cat: activeTab, path: folderPath } = selection
  const sysCat        = CATEGORIES.find(c => c.key === activeTab)
  const isVideo       = sysCat?.type === 'video' || activeTab === 'misc-video'
  const currentFolderId = folderPath.length ? folderPath[folderPath.length - 1].id : null
  // 배경음악만 출처·이용 조건이 필수다 — 서버 규칙(server/domain/audioSource.js)과 같다.
  const 출처필수 = activeTab === 'bgm'
  // 배경음악 맨 위 — 여기에는 곡을 올리지 않는다(폴더를 먼저 고른다). 아래 올리기 단추·끌어 놓기가 이것을 본다.
  const 배경맨위 = activeTab === 'bgm' && !currentFolderId

  // 자동방송이 지금 이 폴더의 음원을 실제로 쓰는지. BGM 폴더를 열 때만 묻는다 —
  // 다른 폴더에서는 쓸 데가 없고, 편집기에서 방식을 바꾼 뒤 돌아오면 새 값으로 다시 묻는다.
  const hasPlaylist  = activeTab === 'bgm' || sysCat?.type === 'video' // 시스템 카테고리만 — pseudo는 재생목록 개념 없음
  // ── 찾기·줄 세우기 (UX-27) ────────────────────────────────────
  // 폴더 트리·경로바·격자/목록은 이미 있었다. **없던 것이 검색과 정렬**이다.
  // 범위가 '전체'면 서버에서 모든 파일을 한 번 받아 온다(`GET /api/audio` 는 인자가 없으면
  // 전부 준다) — 폴더를 하나씩 열어 보지 않고 찾을 수 있어야 "드라이브처럼"이 된다.
  const [query,    setQuery]    = useState('')
  // 「이 폴더 / 모든 폴더」 단추는 뺐다(사용자 지시 2026-09-22 「쓸데 없으면 빼버려」) — 찾기는 지금 자리에서만 한다.
  // 음원·영상 맨 위(모아 보기)는 이미 그 종류 전부를 보이므로 거기서 찾으면 전체에서 찾는 셈이다.
  const scope = 'folder'
  const [sortBy,   setSortBy]   = useState('recent')
  const [allFiles, setAllFiles] = useState(null)

  const 전체검색중 = scope === 'all' && query.trim() !== ''
  // 따로 loading 상태를 두지 않는다 — `allFiles === null` 이 곧 "아직 못 받았다"이고,
  // 상태를 하나 더 두면 effect 안에서 곧바로 setState 하게 돼 렌더가 한 번 더 돈다.

  useEffect(() => {
    if (!전체검색중 || allFiles !== null) return
    let alive = true
    getAudioFiles()
      .then(d => { if (alive) setAllFiles(d) })
      .catch(() => { if (alive) setAllFiles([]) })   // 못 받아 오면 빈 결과 — 가짜를 만들지 않는다
    return () => { alive = false }
  }, [전체검색중, allFiles])

  const 보일파일   = 파일고르기(전체검색중 ? (allFiles || []) : files, { 검색어: query, 정렬: sortBy })
  const 보일폴더   = 전체검색중 ? [] : 폴더고르기(subfolders, { 검색어: query })
  const 찾는중     = query.trim() !== ''

  // 시스템 카테고리(BGM·아침 방송 …)는 **왼쪽에서 내렸다**(2026-09-13, 사용자 지시).
  // 예전엔 "파일이 있는 칸만 왼쪽에 그린다"로 빈 칸을 숨겼는데, 그래도 사람이 만든 폴더와
  // 같은 모양으로 섞여 있었다. 이제 카테고리는 **줄의 꼬리표**다 — 파일이 있어야 줄이 있고,
  // 줄이 있어야 꼬리표가 있으므로 "빈 칸이 서 있는" 문제가 구조적으로 사라졌다.


  // ── 보기모드 저장 ──────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem('mm_view', view) } catch { /* 저장 불가해도 화면은 그대로 동작 */ }
  }, [view])

  // ── 브라우저 히스토리 연동 — 폴더 이동을 뒤로가기로 되짚을 수 있게 ──
  const navigateTo = useCallback((cat, path) => {
    // ── **히스토리를 쌓지 않는다** (사용자 지시 2026-09-14) ──────────────────────────
    // *"업로드에서 페이지 뒤로가기 하면 바로 뒤 탐색기로 가야지, 그게 사용성이 맞지"*
    //
    // 그전에는 자리를 옮길 때마다 `pushState` 라 폴더를 다섯 번 드나들면 히스토리에
    // 여섯 칸이 쌓였다. 그러면 **뒤로가기를 여섯 번** 눌러야 이 화면을 벗어난다 —
    // 폴더 이동은 화면 **안**의 일인데 페이지 이동처럼 취급한 것이다.
    // `replaceState` 면 주소는 그대로 따라오되(새로고침·링크 공유는 살아 있다)
    // 뒤로가기 한 번이 곧 «이 화면을 떠난다» 가 된다.
    // 폴더를 거슬러 올라가는 길은 따로 있다 — 빵부스러기·「위로」·왼쪽 트리 셋이다.
    window.history.replaceState({ mmNav: { cat, path } }, '')
    // 자리를 옮기면 **고른 것과 상세를 비운다.** 안 비우면 화면에 없는 줄이 골라진 채
    // 남아서, 「삭제」가 보이지 않는 것을 지운다.
    setz고른것(new Set())
    set상세(null)
    setSelection({ cat, path })
    set상세(null)
  }, [])

  useEffect(() => {
    // 이 화면 진입 시점의 히스토리 엔트리를 태깅 — 첫 뒤로가기가 화면 밖으로 바로 안 나가고
    // "선택 없음" 상태부터 순서대로 소비되게 함
    window.history.replaceState({ mmNav: { cat: null, path: [] } }, '')
    const onPopState = (e) => {
      const nav = e.state?.mmNav
      setSelection(nav ? { cat: nav.cat, path: nav.path } : { cat: null, path: [] })
      set상세(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const goUp = () => {
    if (folderPath.length === 0) return navigateTo(null, [])
    navigateTo(activeTab, folderPath.slice(0, -1))
  }

  // ── 트리 펼치기/불러오기 ──────────────────────────────────────
  // 폴더 목록을 받아 오는 자리는 **여기 하나**다. 두 벌로 두면 한쪽만 고치게 된다.
  const 그룹폴더불러오기 = async (pseudoCat) => {
    const data = await getFolders(pseudoCat).catch(() => [])
    setGroupFolders(prev => ({ ...prev, [pseudoCat]: data }))
  }

  // **처음부터 펼쳐져 있는 그룹은 아무도 안 불러왔다.** 불러오기가 `toggleGroup` 에만
  // 걸려 있는데 「내 폴더」는 `my: true` 로 시작하므로, 사용자가 **접었다 다시 펴기 전에는**
  // 영영 "불러오는 중..." 이었다(2026-09-12 브라우저 실측). 화면은 로딩처럼 보이는데
  // 요청은 한 번도 안 나간 상태라, 기다려도 아무 일이 안 일어난다.
  //
  // **`misc`(옛 「내 폴더」)도 늘 같이 묻는다**(2026-09-12). 그 그룹은 화면에서 없앴는데,
  // 옛 저장소에 그 아래 폴더가 남아 있으면 **그것이 통째로 안 보이게 된다.** 비어 있으면
  // 아무것도 안 그리고, 하나라도 있으면 아래쪽에 그 그룹만 되살려 보여준다.
  useEffect(() => {
    let alive = true
    const 처음펼친것 = [...new Set([...Object.keys(GROUP_META).filter(g => 초기펼침[g]), 'my'])]
    Promise.all(처음펼친것.map(g => getFolders(GROUP_META[g].cat).catch(() => [])))
      .then(목록들 => {
        if (!alive) return
        setGroupFolders(prev => {
          const next = { ...prev }
          처음펼친것.forEach((g, i) => { next[GROUP_META[g].cat] = 목록들[i] })
          return next
        })
      })
    return () => { alive = false }
  }, [])

  const toggleGroup = async (g) => {
    const willExpand = !groupExpanded[g]
    setGroupExpanded(prev => ({ ...prev, [g]: willExpand }))
    const pseudoCat = GROUP_META[g].cat
    if (willExpand && groupFolders[pseudoCat] === null) await 그룹폴더불러오기(pseudoCat)
  }

  const toggleNode = async (key, category, folderId) => {
    const willExpand = !expanded.has(key)
    setExpanded(prev => {
      const next = new Set(prev)
      if (willExpand) next.add(key); else next.delete(key)
      return next
    })
    if (willExpand && !childrenMap[key]) {
      setLoadingKeys(prev => new Set(prev).add(key))
      const data = await getFolders(category, folderId || undefined).catch(() => [])
      setChildrenMap(prev => ({ ...prev, [key]: data }))
      setLoadingKeys(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  // 트리/본문에서 폴더를 새로 만들거나 지우면, 그 폴더의 부모 노드를 트리에서도 갱신
  const refreshTreeChildrenOf = useCallback(async (category, parentFolderId) => {
    const key = `${category}:${parentFolderId ?? 'root'}`
    if (!parentFolderId && ['misc', 'misc-audio', 'bgm', 'misc-video'].includes(category)) {
      const data = await getFolders(category).catch(() => [])
      setGroupFolders(prev => ({ ...prev, [category]: data }))
      return
    }
    if (childrenMap[key] !== undefined || expanded.has(key)) {
      const data = await getFolders(category, parentFolderId || undefined).catch(() => [])
      setChildrenMap(prev => ({ ...prev, [key]: data }))
    }
  }, [childrenMap, expanded])

  // ── 현재 위치 콘텐츠 로드 ─────────────────────────────────────
  // 오디오·영상 **맨 위 자리**에서는 그 종류의 음원을 **전부** 모아 보여준다 (2026-09-12).
  //
  // 사용자 지시: *"지금 폴더처럼 들어가 있잖아, 실질 음원으로 들어가서 표기되게끔 해야지."*
  // 예전엔 맨 위에 카테고리 카드 9개만 있고 실제 파일은 하나도 안 보였다 — 아이클라우드에서
  // 드라이브를 열었는데 폴더 아이콘만 있는 꼴이다. 폴더 카드는 그대로 두고, **그 아래에
  // 실제 파일을 이어서** 놓는다. 어느 폴더의 것인지는 각 줄의 뱃지가 말한다.
  const 모아보기 = folderPath.length === 0 && (activeTab === 'misc-audio' || activeTab === 'misc-video')
  const 이종류 = activeTab === 'misc-video' ? 'video' : 'audio'

  const loadCurrent = useCallback(async () => {
    if (!activeTab) return
    setContentLoading(true)
    setLoadError('')
    try {
      const [subs, data] = await Promise.all([
        getFolders(activeTab, currentFolderId || undefined),
        // 모아 보기에서는 카테고리를 안 걸고 전부 받아, 이 종류의 것만 남긴다.
        // 서버에 새 질의를 만들지 않는다 — 이미 "전부 주는" 길이 있고(전체 검색이 그것을 쓴다),
        // 이 시설의 음원 수는 목록 하나에 들어가는 규모다.
        모아보기
          ? getAudioFiles().then(all => (all || []).filter(f => {
            const c = CATEGORIES.find(x => x.key === f.category)
            const 종류 = c ? c.type : (f.category === 'misc-video' ? 'video' : 'audio')
            return 종류 === 이종류
          }))
          : getAudioFiles(activeTab, currentFolderId),
      ])
      setSubfolders(subs)
      setFiles(data)
      // 배경음악 자리에서 무엇이 바뀌었으면(폴더 만들기·이름 바꾸기·지우기·곡 올리기·옮기기 — 모두 끝에 이것을 부른다)
      // 고르개들의 폴더 목록도 다시 읽게 한다. 안 그러면 이름을 바꿔도 다른 화면엔 옛 이름이 남는다.
      if (activeTab === 'bgm') window.dispatchEvent(new CustomEvent(BGM_FOLDERS_CHANGED))
      if (activeTab === 'bgm' || CATEGORIES.find(c => c.key === activeTab)?.type === 'video') {
        const pl = await getPlaylist(activeTab)
        setPlaylist(pl)
      } else {
        setPlaylist([])
      }
    } catch (err) {
      // 목록을 비우지 않는다 — 먼저 불러왔던 것이 있으면 그대로 두고, 실패했다는 사실만 얹는다.
      setLoadError(err?.message || '목록을 불러오지 못했습니다.')
    }
    finally { setContentLoading(false) }
  }, [activeTab, currentFolderId, 모아보기, 이종류])

  useEffect(() => { loadCurrent() }, [loadCurrent])

  // ── 길이를 모르는 파일은 여기서 조용히 재어 서버에 알려 준다 (2026-09-12) ──
  //
  // **소리는 안 난다.** `preload='metadata'` 는 길이만 읽고 재생하지 않는다.
  // 예전에는 그 파일이 **한 번 방송으로 나가야** `duration` 이 채워졌다(`routes/morning.js` 의
  // 종료 보고). 그래서 올리기만 한 파일은 목록에서 길이가 영영 빈칸이고, 흐름·시퀀서도
  // 그 파일을 "모르는 길이"의 상한(180초)으로 기다렸다.
  //
  // 한 번에 하나씩만 잰다 — 스무 개를 동시에 열면 네트워크가 목록 자체를 늦춘다.
  // 파일 이름이 빈 행(예전 링크 등록)은 건너뛴다(우리 쪽에 파일이 없다).
  // 한 번 해 본 파일은 다시 안 잰다. **이 표식이 없으면 되풀이한다** — 못 읽는 형식은
  // 늘 실패하는데, 성공한 것 때문에 `files` 가 바뀌면 이 effect 가 또 돌아 그 실패를
  // 다시 시도한다. 화면을 떠났다 오면 표식도 같이 사라지므로 그때는 다시 해 본다.
  const 길이잰것Ref = useRef(new Set())
  useEffect(() => {
    const 잴것 = files.filter(f => f.filename
      && !(Number(f.duration) > 0) && !길이잰것Ref.current.has(f.id))
    if (잴것.length === 0) return
    let 살아있음 = true
    const 잰것 = []
    const 하나씩 = async () => {
      for (const f of 잴것) {
        if (!살아있음) return
        길이잰것Ref.current.add(f.id)   // 해 보기 **전에** 찍는다 — 실패해도 다시 안 한다
        const 초 = await new Promise((resolve) => {
          const el = document.createElement(f.category.includes('video') ? 'video' : 'audio')
          el.preload = 'metadata'
          el.muted = true                    // 어떤 경로로도 소리가 새지 않게
          const 끝 = (v) => { el.removeAttribute('src'); el.load?.(); resolve(v) }
          el.onloadedmetadata = () => 끝(el.duration)
          el.onerror = () => 끝(0)
          // 못 읽는 형식이면 영영 안 돌아온다 — 8초에 포기한다
          setTimeout(() => 끝(0), 8000)
          el.src = `${AUDIO_URL}/${f.category}/${f.filename}`
        })
        if (!살아있음) return
        if (Number.isFinite(초) && 초 > 0) {
          await recordAudioDuration(f.id, 초).catch(() => {})
          잰것.push({ id: f.id, 초: Math.round(초) })
        }
      }
      // 한 번만 다시 그린다 — 잰 값을 화면에도 반영한다(목록을 다시 받아오지 않는다).
      if (살아있음 && 잰것.length > 0) {
        setFiles(prev => prev.map(f => {
          const m = 잰것.find(x => x.id === f.id)
          return m ? { ...f, duration: m.초 } : f
        }))
      }
    }
    하나씩()
    return () => { 살아있음 = false }
  }, [files])

  // VideoPlayer가 자연 종료될 때 버튼 상태 초기화
  useEffect(() => {
    const reset = () => setPlayingId(null)
    window.addEventListener('carecast:video-player-closed', reset)
    return () => window.removeEventListener('carecast:video-player-closed', reset)
  }, [])

  // ── 폴더 만들기/이름변경/삭제 ────────────────────────────────
  // 이 파일이 영상인가 — 카테고리 이름이 `-video` 로 끝나면 영상이다(서버와 같은 규칙).
  const isVideoFile = (f) => String(f?.category || '').endsWith('-video')

  // 여러 개를 한 번에 지운다 — **없던 기능**이다(사용자 지적: "올라간 파일들은 어떻게
  // 삭제 및 수정 이동할건데"). 확인은 한 번만 묻고, 막힌 것이 있으면 그 사유를 남긴다.
  const 일괄삭제 = async () => {
    const 파일 = 줄들.filter(r => r.종류 === 'file' && 고른것.has(r.id)).map(r => r.것)
    const 폴더 = 줄들.filter(r => r.종류 === 'folder' && 고른것.has(r.id)).map(r => r.것)
    if (!파일.length && !폴더.length) return
    const 몇 = 파일.length + 폴더.length
    if (!confirm(`${몇}개를 삭제할까요? 되돌릴 수 없습니다.`)) return
    setDeleteError('')
    const 막힌것 = []
    for (const f of 파일) {
      try { await deleteAudioFile(f.id) } catch (e) { 막힌것.push(`${f.original_name}: ${e.message}`) }
    }
    for (const d of 폴더) {
      try { await deleteFolder(d.id) } catch (e) {
        const 쓰는곳 = e?.data?.usedBy
        const 꼬리 = Array.isArray(쓰는곳) && 쓰는곳.length
          ? ' (' + 쓰는곳.map(u => `${u.time} ${u.broadcast} ${u.stepNo}단계`).join(' · ') + ')'
          : ''
        막힌것.push(`${d.name}: ${e.message}${꼬리}`)
      }
    }
    setz고른것(new Set()); set상세(null)
    await loadCurrent()
    await refreshTreeChildrenOf(activeTab, currentFolderId)
    if (막힌것.length) setDeleteError('지우지 못한 것 ' + 막힌것.length + '개 — ' + 막힌것.join(' / '))
  }

  const handleCreateFolder = async (name) => {
    await createFolder(activeTab, currentFolderId, name)
    setShowNewFolder(false)
    await loadCurrent()
    await refreshTreeChildrenOf(activeTab, currentFolderId)
  }

  const handleDeleteFolder = async (folder) => {
    if (!confirm(`"${folder.name}" 폴더를 삭제할까요?`)) return
    setDeleteError('')
    try {
      await deleteFolder(folder.id)
      await loadCurrent()
      await refreshTreeChildrenOf(activeTab, currentFolderId)
    } catch (err) {
      // ── 막힌 이유를 **문장으로** 보여 준다 (2026-09-13, 브라우저 검증에서 고침) ──────
      //
      // 여기는 `alert(err.message)` 였는데, `apiDelete` 가 응답 **본문을 통째로** 던지고
      // 있어서 화면에 `{"error":"…","usedBy":[…]}` 라는 JSON 이 그대로 떴다. 서버는
      // 제대로 막고 사용처까지 실어 보내는데 **사람에게는 안 읽히는 상태**였다.
      //
      // 이제 `err.data.usedBy` 로 **어디서 쓰는지 이름을 대고** 말한다 — 그것을 모르면
      // 사람은 무엇을 고쳐야 할지 모른 채 같은 단추를 다시 누른다(설계 §4-C).
      // 자리는 이미 있던 `deleteError` 띠를 쓴다 — 닫기 전까지 남아서, 사라진 alert 를
      // 놓친 사람도 다시 읽을 수 있다.
      const 쓰는곳 = err?.data?.usedBy
      const 꼬리 = Array.isArray(쓰는곳) && 쓰는곳.length
        ? ' — ' + 쓰는곳.map(u => `${u.time} ${u.broadcast} ${u.stepNo}단계 「${u.stepLabel}」`).join(' · ')
        : ''
      setDeleteError((err?.message || '삭제하지 못했습니다.') + 꼬리)
    }
  }

  const handleRenameFolder = async (folder, newName) => {
    if (!newName?.trim() || newName === folder.name) return
    try {
      await renameFolder(folder.id, newName.trim())
      await loadCurrent()
      await refreshTreeChildrenOf(activeTab, currentFolderId)
    } catch (err) {
      alert(err.message || '이름 변경 실패')
    }
  }

  // 왼쪽 목록에서 바로 — 이름 바꾸기(연필)·새 폴더(+) (사용자 지시 2026-09-22 「폴더 이름 수정할 수 있게, 추가도」)
  const 트리이름바꾸기 = async (folder) => {
    const n = window.prompt('새 폴더 이름', folder.name)
    if (!n?.trim() || n.trim() === folder.name) return
    try {
      await renameFolder(folder.id, n.trim())
      await 그룹폴더불러오기(folder.category)
      await loadCurrent()
      // 지금 보고 있는 경로에 그 폴더가 있으면 빵부스러기 이름도 바꾼다
      if (folderPath.some(p => p.id === folder.id)) navigateTo(activeTab, folderPath.map(p => (p.id === folder.id ? { ...p, name: n.trim() } : p)))
      if (folder.category === 'bgm') window.dispatchEvent(new CustomEvent(BGM_FOLDERS_CHANGED))
    } catch (err) { alert(err.message || '이름 변경 실패') }
  }
  const 트리새폴더 = async (category) => {
    const n = window.prompt(category === 'bgm' ? '새 배경음악 폴더 이름 (예: 클래식)' : '새 폴더 이름')
    if (!n?.trim()) return
    try {
      await createFolder(category, null, n.trim())
      await 그룹폴더불러오기(category)
      if (category === 'bgm') window.dispatchEvent(new CustomEvent(BGM_FOLDERS_CHANGED))
    } catch (err) { alert(err.message || '폴더를 만들지 못했습니다') }
  }

  // ── 파일 미리듣기 ─────────────────────────────────────────────
  // 이 화면의 미리듣기만 끈다 — 전역 정지 신호는 쏘지 않는다(실제 방송은 우리 것이 아니다)
  const stopPreview = () => {
    if (previewRef.current) {
      try { previewRef.current.pause() } catch { /* 이미 끝났으면 그만 */ }
      previewRef.current = null
    }
    // [audioBus] 재생 중이던 미리듣기를 끈다 — 장부 해제
    previewBusRef.current?.done(); previewBusRef.current = null
    setPlayingId(null)
  }

  const handlePreview = (file) => {
    if (previewRef.current) {
      const 같은파일 = playingId === file.id
      stopPreview()
      if (같은파일) return   // 같은 버튼을 다시 누르면 끄기만 한다
    }
    const audio = new Audio(`${AUDIO_URL}/${file.category}/${file.filename}`)
    previewRef.current = audio
    // [audioBus] 음원 파일 미리듣기 등록 — 자연 종료는 addEventListener로 해제(onended 유지).
    // stop을 함께 넘긴다 — 실제 방송이 시작되면 장부가 이 손잡이로 비키게 한다(td09 H9)
    previewBusRef.current = audioBus.register({
      kind: 'preview-audio', label: file.original_name || file.filename, stop: () => stopPreview(),
    })
    audio.addEventListener('ended', () => { previewBusRef.current?.done(); previewBusRef.current = null })
    setPlayingId(file.id)
    audio.play().catch(() => setPlayingId(null))
    audio.onended = () => { setPlayingId(null); previewRef.current = null }
  }

  // **화면을 떠나면 이 화면의 미리듣기를 끊는다(2026-09-02, td09 H4).**
  // 자기 것만 끈다 — 전역 정지 신호도 stopKinds도 부르지 않는다(다른 화면 미리듣기까지 죽는다).
  useEffect(() => () => { stopPreview() }, [])

  // ── 파일 업로드 (파일선택 + 드래그앤드롭 공용) ──────────────────
  // 업로드는 **진행·성공·실패·재시도**가 다 보여야 한다(UX-06).
  //   · 진행: 500MB 영상이 올라가는 동안 "업로드 중…" 한 줄이면 사람은 멈춘 줄 알고
  //           다시 누른다 — 그러면 같은 파일이 둘 올라간다. 진행률이 그것을 막는다.
  //   · 성공: 아무 말이 없으면 올라갔는지 모른다. 목록을 눈으로 뒤져야 한다.
  //   · 재시도: 실패한 파일을 들고 있어야 한 번 더 누를 수 있다. 안 들고 있으면
  //           파일 선택부터 다시 해야 하고, 그러면 사람은 그냥 포기한다.
  // 한 파일을 올린다. 성공하면 true — 여러 개를 이어 올릴 때 몇 개가 됐는지 센다.
  const doUpload = async (file) => {
    const maxSize = isVideo ? 500 * 1024 * 1024 : 20 * 1024 * 1024
    if (file.size > maxSize) {
      setUploadError(isVideo ? '동영상 파일 크기는 500MB를 초과할 수 없습니다.' : '파일 크기는 20MB를 초과할 수 없습니다.')
      setFailedFile(file)
      return false
    }
    // 배경음악은 출처·이용 조건이 있어야 서버가 받는다. **보내기 전에** 알려 준다 —
    // 500MB 가 아니어도 올라가는 동안 기다렸다가 거절당하면 사람은 무엇이 틀렸는지 늦게 안다.
    // (「다시」 단추처럼 여기로 바로 오는 길도 있어 한 번 더 본다 — 문구·조사는 한 곳에서 짓는다.)
    if (!출처먼저확인()) return false
    // 배경음악 맨 위에는 올리지 않는다 — 어느 폴더에도 안 속한 곡은 어떤 방송에서도 안 나간다(2026-09-22).
    if (배경맨위) {
      setUploadError('곡을 넣을 BGM 폴더를 먼저 고르세요 — 왼쪽 「배경음악」 아래 폴더를 누른 뒤 올려 주세요.')
      return false
    }
    setUploading(true)
    setUploadError('')
    setUploadOk('')
    setFailedFile(null)
    setUploadPct(0)
    setUploadName(file.name)
    try {
      await uploadAudioFile(activeTab, file, currentFolderId, setUploadPct, isVideo ? null : uploadSource)
      await loadCurrent()
      setUploadOk(`"${file.name}" 올렸습니다.`)
      // 성공 알림은 스스로 사라진다 — 남겨 두면 다음 업로드 때 옛 성공이 붙어 있어
      // 방금 것이 된 줄 안다.
      clearTimeout(okTimerRef.current)
      okTimerRef.current = setTimeout(() => setUploadOk(''), 4000)
      return true
    } catch (err) {
      setUploadError(err.message || '업로드 실패')
      setFailedFile(file)   // 재시도용으로 들고 있는다
      return false
    } finally {
      setUploading(false)
      setUploadPct(0)
      setUploadName('')
    }
  }

  // 여러 파일을 **차례로** 올린다(2026-09-21 — Pixabay 곡 십여 개를 하나씩 고르게 하지 않으려고).
  // 동시에 보내지 않는다: 진행률 막대가 하나라 어느 파일인지 섞이고, 실패한 것을 다시 누를
  // 「다시」 단추도 하나다. 하나가 실패해도 나머지는 계속 올린다 — 마지막에 몇 개가 됐는지 말한다.
  const doUploadMany = async (fileList) => {
    const list = Array.from(fileList || [])
    if (!출처먼저확인()) return
    if (list.length <= 1) { if (list[0]) await doUpload(list[0]); return }
    // **못 올린 파일 이름을 모은다**(2026-09-21 화면 검수). 예전엔 파일마다 앞 파일의 오류를 지워서
    // 끝나면 「N개 중 M개」만 성공 문구로 남았다 — 0개여도 성공처럼 보였고 어느 파일이 빠졌는지 몰랐다.
    const 못올린것 = []
    let 된것 = 0
    for (const f of list) { if (await doUpload(f)) 된것 += 1; else 못올린것.push(f.name) }
    clearTimeout(okTimerRef.current)
    if (못올린것.length) {
      setUploadOk('')
      setUploadError(된것
        ? `${list.length}개 중 ${된것}개 올렸습니다. 못 올린 파일(${못올린것.length}): ${못올린것.join(', ')}`
        : `하나도 못 올렸습니다(${list.length}개): ${못올린것.join(', ')}`)
      return
    }
    setUploadOk(`${list.length}개 모두 올렸습니다.`)
    okTimerRef.current = setTimeout(() => setUploadOk(''), 6000)
  }

  // 배경음악은 출처·이용 조건이 먼저다 — **파일 창을 열기 전에** 알린다(2026-09-21 화면 검수 High).
  // 예전엔 파일을 고르고 나서야 거절당했다. 끌어다 놓기도 같은 검사를 거친다(doUploadMany).
  const 출처먼저확인 = () => {
    const 빠진것 = 출처필수 ? 빠진출처칸(uploadSource) : []
    if (!빠진것.length) return true
    setUploadOk('')
    setUploadError(`배경음악은 올리기 전에 위 칸에 ${빠진것.length === 2 ? '출처와 이용 조건을' : 빠진것[0] === '출처' ? '출처를' : '이용 조건을'} 적어 주세요.`)
    return false
  }
  const 파일창열기 = () => { if (출처먼저확인()) fileInputRef.current?.click() }

  const handleUploadInput = (e) => {
    const files = e.target.files
    const list = files ? Array.from(files) : []
    e.target.value = ''
    if (list.length) doUploadMany(list)
  }

  // ── 드래그앤드롭: 파일 이동(내부) 또는 업로드(OS) 공용 핸들러 ─────
  const handleDropOnFolder = async (e, targetCategory, targetFolderId) => {
    const internalId = e.dataTransfer.getData(내부드래그)
    if (internalId) {
      // **조용히 넘기지 않는다.** 다른 카테고리의 폴더에 끌어다 놓으면 서버가 400을 준다
      // (`/files/:id/move` — 폴더는 자기 카테고리 파일만 받는다). 예전엔 그걸 삼켜서,
      // 사람은 끌어다 놨는데 파일이 안 움직이고 **왜인지 알 길이 없었다.**
      // 이 화면의 다른 실패(폴더 삭제·이름 변경)와 같은 방식으로 말해 준다.
      try {
        await moveAudioFile(Number(internalId), targetFolderId)
      } catch (err) {
        alert(err.message || '옮기지 못했습니다. 같은 종류의 폴더로만 옮길 수 있습니다.')
        return
      }
      if (targetCategory === activeTab) await loadCurrent()
      return
    }
    if (e.dataTransfer.files?.length && targetCategory === activeTab) {
      await doUploadMany(e.dataTransfer.files)
    }
  }

  const handleMainDrop = async (e) => {
    e.preventDefault()
    setDragOverMain(false)
    await handleDropOnFolder(e, activeTab, currentFolderId)
  }

  // ── 파일 삭제/이동 ────────────────────────────────────────────
  const handleDelete = async (file) => {
    if (!confirm(`"${file.original_name}" 을(를) 삭제할까요?`)) return
    if (previewRef.current && playingId === file.id) {
      previewRef.current.pause()
      previewRef.current = null
      setPlayingId(null)
    }
    setDeleteError('')
    try {
      await deleteAudioFile(file.id)
      set상세(null)
      await loadCurrent()
    } catch (e) {
      // **콘솔에만 남기지 않는다**(UX-29). 서버는 *"지금 쓰고 있어서 지울 수 없습니다 —
      // 예약 "환기 방송"(09:10)"* 처럼 **어디서 쓰는지**를 돌려준다. 그 문장을 화면에
      // 안 띄우면 사람은 버튼이 고장 난 줄 알고 계속 누른다.
      // 목록은 그대로 남는다 — 지워진 것처럼 보이면 더 나쁘다.
      console.error('[음원관리] 삭제 실패:', e.message)
      setDeleteError(e.message || '삭제하지 못했습니다.')
    }
  }

  // 옮기기는 **한 개와 여러 개 둘 다** 받는다. 「일괄 옮기기」 버튼이 `{ 여럿: [...] }` 를
  // 넣는데 여기는 `moveTarget.id` 하나만 읽고 있었다 — 여러 개를 골라 옮기면
  // **`undefined` 를 서버로 보냈다**(V③ R15 지적 3, 2026-09-13).
  //
  // **판정도 도는 자리도 화면 밖(`lib/mediaMove.js`)에 있다.** 여기 두면 시험이 글자로만
  // 확인하게 되고, 그러면 **옮기는 창구를 통째로 지워도 초록**이다(V③ R16 지적 1).
  // 여기 남는 것은 화면의 몫뿐이다 — 창 닫기, 목록 새로고침, 사람에게 말하기.
  const handleMoveFile = async (targetFolderId) => {
    const 결과 = await 옮기기실행({ 옮길것: moveTarget, 목적지: targetFolderId, 옮기기: moveAudioFile })
    setMoveTarget(null)
    await loadCurrent()
    const 안내 = 옮기기안내(결과)
    if (안내) alert(안내)
  }

  // ── 재생목록 저장 ─────────────────────────────────────────────
  const handleSavePlaylist = async (reorderedList) => {
    try {
      await savePlaylist(activeTab, reorderedList.map((item, i) => ({
        audio_file_id: item.audio_file_id,
        sort_order:    i,
        active:        item.active ?? 1,
      })))
      setPlaylist(reorderedList)
      setShowModal(false)
    } catch (e) { console.error('[음원관리] 재생목록 저장 실패:', e.message) }  // 모달을 닫지 않아 사람이 다시 시도할 수 있다
  }

  // ── 이 파일이 나가게 바꾸기 ──────────────────────────────────
  //
  // 예전엔 녹음 음원 자리에 파일이 둘이면 **먼저 올린 것만** 나가고 바꿀 방법이 삭제뿐이었다.
  // 사람이 새 녹음을 올려 바꾼 줄 알았는데 예전 것이 계속 나갔다.
  const handleMakePrimary = async (file) => {
    try {
      await makeAudioPrimary(file.id)
      await loadCurrent()          // "지금 나감" 표시는 서버가 판정한다 — 다시 받아 온다
    } catch (e) {
      setUploadError(e.message || '바꾸지 못했습니다')
    }
  }

  // ── 이름 수정 ────────────────────────────────────────────────
  const handleRename = async (file) => {
    const newName = renameVal.trim()
    if (newName && newName !== file.original_name) {
      try {
        await renameAudioFile(file.id, newName)
        setFiles(prev => prev.map(f => f.id === file.id ? { ...f, original_name: newName } : f))
      } catch (e) { console.error('[음원관리] 이름 변경 실패:', e.message) }  // 화면의 이름도 그대로 둔다(서버 값과 어긋나면 안 된다)
    }
  }

  // 폴더 메모는 화면에서 뺐다(2026-09-04, 사용자 요청). 서버 라우트와 category_notes 표는
  // 남겨 뒀다 — 이미 적어 둔 메모가 있으면 지우지 않는다.
  //
  // **왼쪽에서 시스템 카테고리를 내렸다**(2026-09-13). 사람이 만든 폴더와 코드가 정한 칸이
  // 같은 모양으로 섞여 있어서 무엇이 내 폴더인지 구별이 안 됐다. 카테고리는 이제 **줄의
  // 꼬리표**이고, 누르면 그 갈래만 걸러 본다(`보일카테고리` 는 그 꼬리표가 아는 이름을 준다).

  // ── 3단 구성 (2026-09-13, 사용자 지시로 다시 짰다) ────────────────────────────
  //
  // 사용자 원문: *"구글드라이브가 저렇게 되어있어? 왼쪽에 지저분하게 안되어있잖아 …
  // 옆에 메뉴는 음원 누르면 음원 좌르르, 영상 누르면 영상 좌르르, 어떤 플로우에서
  // 선택하면 꼬리표만 붙여주면되잖아 … 차라리 구성을 구글 노트북 llm처럼 하던가,
  // 왼쪽에는 폴더별 분류, 가운데에는 파일들 또는 (당시) 링크 입력창, 오른쪽은 그 영상이나
  // 음원 정보와 자막설정창"*
  //
  // 무엇이 잘못이었나:
  //  ① 왼쪽에 **시스템 카테고리 아홉**이 폴더인 척 서 있었다. 사람이 만든 폴더와 코드가
  //     정한 칸이 같은 모양으로 섞여, 무엇이 내 폴더인지 구별이 안 됐다.
  //  ② 파일을 **지우거나 옮길 길이 목록에 없었다.** 카드에 마우스를 올려야 나오는
  //     아이콘뿐이었고, 여러 개를 한 번에 하는 길은 아예 없었다.
  //  ③ 「← 나감」은 **우리끼리 쓰는 말**이다. 사람은 무엇이 나간다는 건지 모른다.
  //
  // 그래서 드라이브의 문법을 그대로 따른다 — 왼쪽 갈래, 가운데 목록, 오른쪽 상세.
  // **카테고리는 왼쪽에서 내리고 줄의 꼬리표로 옮긴다.** 꼬리표를 누르면 그 갈래만 걸러 본다.
  const 오디오폴더 = groupFolders['misc-audio'] || []
  const 영상폴더   = groupFolders['misc-video'] || []
  // 배경음악 폴더 — **기본 폴더(방송용·식사용)가 먼저**, 그다음 사람이 만든 것을 이름순으로(고르개와 같은 순서).
  const 용도순서 = { broadcast: 0, meal: 1 }
  const 용도of = (id) => (bgm목록 || []).find(f => f.id === id)?.role ?? null
  const 배경폴더 = [...(groupFolders.bgm || [])].sort((a, b) => {
    const ra = 용도of(a.id), rb = 용도of(b.id)
    if (ra && rb) return 용도순서[ra] - 용도순서[rb]
    if (ra || rb) return ra ? -1 : 1
    return String(a.name).localeCompare(String(b.name), 'ko')
  })
  const 옛폴더     = groupFolders.misc || []

  // 지금 자리의 이름 — 빵부스러기와 오른쪽 빈 화면이 함께 쓴다
  // 목록에 그릴 것 — **폴더가 언제나 위**다(사용자 지시). 드라이브·탐색기의 규칙이고,
  // 섞이면 "내 폴더가 어디 갔지"가 된다.
  const 줄들 = [
    ...보일폴더.map(f => ({ 종류: 'folder', id: `d${f.id}`, 것: f })),
    ...보일파일.map(f => ({ 종류: 'file', id: `f${f.id}`, 것: f })),
  ]
  // 오른쪽 칸에 자막 편집기가 펴져 있나 — 칸 폭을 그것이 정한다
  const 자막폄 = Boolean(상세?.종류 === 'file' && subtitleFile?.id === 상세.것.id)

  // ── 줄의 곁칸 둘도 **재서** 정한다 (2026-09-13, 브라우저에서 재 보고 고쳤다) ─────
  //
  // 이 둘은 `hidden laptop:flex` · `hidden wide:block` 이었다. 위 `좁나` 와 **같은 뿌리의
  // 실수**다 — 미디어 질의는 화면 폭을 보므로, 1440 모니터의 설정 껍데기에서는 남은 폭이
  // 976 뿐인데도 "넓다"로 보고 곁칸 둘(112+112)을 다 펼쳤다. 실측: **이름 칸 30px**.
  // 이름이 안 보이는 목록은 목록이 아니다.
  //
  // 그래서 가운데가 실제로 쓸 폭을 계산해 그 안에서 곁칸을 켠다. 자막을 펴면 오른쪽이
  // 넓어지므로 가운데가 줄고, 그만큼 곁칸이 먼저 접힌다 — 이름이 마지막까지 남는다.
  // ── **자막 칸을 1.5 배로** (사용자 지시 2026-09-16) ───────────────────────────
  // *"자막편집 반응형으로 굿 잘됐는데 좀 더 넓혀주자 지금의 1.5배 넓혀"*
  //
  // 440 × 1.5 = **660**. 자막 편집기는 안에서 「문구 | 방송 화면 미리보기」 두 칸으로
  // 또 갈리므로, 440 에서는 그 두 칸이 각각 200 언저리였다. 660 이면 문구 칸이 한 줄에
  // 문장 하나를 담는다.
  //
  // **숫자를 한 곳에만 둔다.** 앞 판은 여기 `440` 과 아래 클래스 `w-[440px]` 로 **두 벌**
  // 이었다 — 한쪽만 고치면 화면은 넓어지는데 곁칸 계산은 옛 폭으로 남아, 이름 칸이
  // 조용히 뭉개진다. 이제 아래는 이 값을 그대로 style 로 받는다.
  const 오른쪽폭 = 자막폄 ? 660 : 288
  const 가운데폭 = 좁나 ? 판폭 : Math.max(0, 판폭 - 176 - 오른쪽폭 - 24)

  // ── **가운데가 좁아지면 곁칸부터 줄인다** (사용자 지시 2026-09-16) ─────────────
  // *"그리고 줄어드는 가운데 부분은 글짜 깨지지 않게 조금 줄여주고"*
  //
  // 오른쪽이 220px 을 더 가져가면 그만큼 가운데가 줄어든다. 곁칸은 **고정폭**이라
  // 줄지 않고, 줄어드는 것은 `flex-1 min-w-0` 인 **이름 칸 하나뿐**이다 — 그래서
  // 이름이 먼저 뭉갠다. 자막을 편 동안에는 갈래 칸을 176 → 112 로 좁혀 그 64px 을
  // 이름에 돌려준다. 갈래 꼬리표는 `truncate` 라 좁아져도 깨지지 않고 「…」로 준다.
  // 2026-09-22 사용자 지시 「음원 이름이 왤케 좁아 갈래를 옆으로 쫌 빼면」 — 갈래 꼬리표는 짧다(BGM·음원…). 176 → 120 으로
  // 줄여 이름에 돌려준다. 자막 꼬리표가 같이 서서 넘치면 truncate 로 「…」가 된다.
  const 갈래칸폭 = 자막폄 ? 96 : 120
  const 가운데여유 = 가운데폭 - Math.max(0, 갈래칸폭 - 112)
  // 곁칸 하나가 112, 이름이 읽히려면 최소 150 은 남아야 한다(체크박스·동작·여백 168 별도).
  const 갈래칸보임 = 가운데여유 >= 430
  const 정보칸보임 = 가운데여유 >= 580
  const 다선택됨 = 줄들.length > 0 && 줄들.every(r => 고른것.has(r.id))
  const 고른파일 = 줄들.filter(r => r.종류 === 'file' && 고른것.has(r.id)).map(r => r.것)

  const 줄토글 = (rid) => setz고른것(prev => {
    const n = new Set(prev)
    if (n.has(rid)) n.delete(rid); else n.add(rid)
    return n
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="t-section text-ds-v3-ink">업로드</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">
          왼쪽에서 갈래·폴더를 고르고, 가운데에서 올리거나 정리하고, 오른쪽에서 그 파일을 봅니다.
        </p>
      </div>

      {/* 고르개(「곡 넣으러 가기」·「업로드에서 폴더 보기」)에서 **새 창으로** 온 것 — 쓰던 방송 화면은 그대로 있다.
          닫으면 그 화면으로 돌아가고, 그 화면의 폴더 목록은 창이 다시 보일 때 새로 읽는다(bgmFolders visibilitychange). */}
      {고르개에서옴 && (
        <div className="flex flex-wrap items-center gap-3 rounded-btn border border-ds-v3-bgm/30 bg-ds-v3-bgm-bg px-3 py-2.5">
          <p className="t-sub text-ds-v3-ink flex-1 min-w-[200px]">
            곡을 다 넣었으면 <b>이 창을 닫으세요.</b> 쓰던 방송 화면은 그대로 열려 있고, 곡 수도 새로 보입니다.
          </p>
          <button type="button" onClick={() => { window.close(); set닫기안됨(true) }}
            className="px-4 min-h-[44px] rounded-btn bg-ds-v3-ink text-white t-sub font-semibold btn-press">
            창 닫고 돌아가기
          </button>
          {닫기안됨 && <p className="t-sub text-ds-v3-warn w-full">이 창은 자동으로 닫히지 않습니다 — 위쪽 탭의 × 로 닫아 주세요.</p>}
        </div>
      )}

      {/* 좁을 때는 왼쪽 트리를 접어 둔다 — 손잡이가 그 자리를 대신한다 */}
      {좁나 && (
        <button onClick={() => set트리열림(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-btn border border-ds-v3-line
                     t-sub font-semibold text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors">
          <Folder size={13} /> 폴더 {트리열림 ? '접기' : '펼치기'}
        </button>
      )}

      <div ref={판ref} className={좁나 ? 'flex flex-col gap-3' : 'flex gap-3 items-start'}>
        {/* ══ 왼쪽 — 갈래와 폴더만 (카테고리는 줄의 꼬리표로 내려갔다) ══════════════ */}
        <div className={(좁나
          ? (트리열림 ? 'w-full card-base p-2 space-y-1' : 'hidden')
          : 'w-64 flex-shrink-0 card-base p-2 space-y-1 sticky top-4 max-h-[calc(100vh/var(--cc-zoom,1)-140px)] overflow-y-auto')}>
          <GroupHeader title="음원" icon={<Music2 size={14} className="text-ds-v3-ink-2" />}
            hint="한 번 틀고 끝나는 소리 — 안내 녹음·효과음. 예약·자동순서에서 파일로 고릅니다."
            onAdd={() => 트리새폴더('misc-audio')}
            expanded={groupExpanded.audio} onToggle={() => toggleGroup('audio')}
            isSelected={activeTab === 'misc-audio' && folderPath.length === 0}
            onSelect={() => navigateTo('misc-audio', [])}>
            {오디오폴더.length === 0 && (
              <p className="t-sub text-ds-v3-ink-2 px-2 py-1">폴더 없음</p>
            )}
            {오디오폴더.map(f => (
              <TreeNode key={f.id} category="misc-audio" folderId={f.id} name={f.name} onRename={트리이름바꾸기}
                ancestorPath={[]} depth={1} icon={<Folder size={13} className="text-ds-v3-ink-2 flex-shrink-0" />}
                expanded={expanded} childrenMap={childrenMap} loadingKeys={loadingKeys}
                selection={selection} onToggle={toggleNode} onSelect={navigateTo} onDropFile={handleDropOnFolder} />
            ))}
          </GroupHeader>

          {/* 배경음악 — 방송용·식사용(기본)과 사람이 만든 BGM 폴더(2026-09-22 사용자 지적: 분류가 없어 곡을 못 넣었다) */}
          <GroupHeader title="배경음악" icon={<Music2 size={14} className="text-ds-v3-bgm" />}
            hint="안내 밑에 깔리는 음악 — 폴더째(랜덤·차례로) 또는 곡 하나를 골라 틉니다."
            onAdd={() => 트리새폴더('bgm')}
            expanded={groupExpanded.bgm} onToggle={() => toggleGroup('bgm')}
            isSelected={activeTab === 'bgm' && folderPath.length === 0}
            onSelect={() => navigateTo('bgm', [])}>
            {배경폴더.length === 0 && (
              <p className="t-sub text-ds-v3-ink-2 px-2 py-1">폴더 없음</p>
            )}
            {배경폴더.map(f => (
              <TreeNode key={f.id} category="bgm" folderId={f.id} name={f.name}
                ancestorPath={[]} depth={1} icon={<Folder size={13} className={(용도of(f.id) ? 'text-ds-v3-bgm' : 'text-ds-v3-ink-2') + ' flex-shrink-0'} />}
                badge={용도of(f.id) ? '기본' : null} onRename={트리이름바꾸기}
                expanded={expanded} childrenMap={childrenMap} loadingKeys={loadingKeys}
                selection={selection} onToggle={toggleNode} onSelect={navigateTo} onDropFile={handleDropOnFolder} />
            ))}
          </GroupHeader>

          <GroupHeader title="영상" icon={<Video size={14} className="text-ds-v3-tts" />}
            onAdd={() => 트리새폴더('misc-video')}
            expanded={groupExpanded.video} onToggle={() => toggleGroup('video')}
            isSelected={activeTab === 'misc-video' && folderPath.length === 0}
            onSelect={() => navigateTo('misc-video', [])}>
            {영상폴더.length === 0 && (
              <p className="t-sub text-ds-v3-ink-2 px-2 py-1">폴더 없음</p>
            )}
            {영상폴더.map(f => (
              <TreeNode key={f.id} category="misc-video" folderId={f.id} name={f.name} onRename={트리이름바꾸기}
                ancestorPath={[]} depth={1} icon={<Folder size={13} className="text-ds-v3-ink-2 flex-shrink-0" />}
                expanded={expanded} childrenMap={childrenMap} loadingKeys={loadingKeys}
                selection={selection} onToggle={toggleNode} onSelect={navigateTo} onDropFile={handleDropOnFolder} />
            ))}
          </GroupHeader>

          {/* 출처·이용 조건 — 넓은 화면에서는 **여기 세로로 줄여** 둔다(사용자 지시 2026-09-22). 올리기 단추보다
              먼저 눈에 들어오는 자리라 「단추를 누른 뒤에야 거절」(2026-09-21 화면 검수 High)도 그대로 막는다. */}
          {!좁나 && !isVideo && !배경맨위 && (
            <div className="mt-2 pt-2 px-1 border-t border-ds-v3-line">
              <SourceUploadFields compact value={uploadSource} onChange={setUploadSource} required={출처필수} />
            </div>
          )}

          {/* 옛 「내 폴더」 — 내용이 있을 때만. 새로 만들 길은 안 준다. */}
          {옛폴더.length > 0 && (
            <GroupHeader title="예전 폴더" icon={<Folder size={14} className="text-ds-v3-ink-2" />}
              expanded={groupExpanded.my} onToggle={() => toggleGroup('my')}
              isSelected={activeTab === 'misc' && folderPath.length === 0}
              onSelect={() => navigateTo('misc', [])}>
              {옛폴더.map(f => (
                <TreeNode key={f.id} category="misc" folderId={f.id} name={f.name}
                  ancestorPath={[]} depth={1} icon={<Folder size={13} className="text-ds-v3-ink-2 flex-shrink-0" />}
                  expanded={expanded} childrenMap={childrenMap} loadingKeys={loadingKeys}
                  selection={selection} onToggle={toggleNode} onSelect={navigateTo} onDropFile={handleDropOnFolder} />
              ))}
            </GroupHeader>
          )}
        </div>

        {/* ══ 가운데 — 목록 · 업로드 ═══════════════════════════════ */}
        <div className="flex-1 min-w-0 space-y-3"
          onDragOver={e => { e.preventDefault(); setDragOverMain(true) }}
          onDragLeave={() => setDragOverMain(false)}
          onDrop={handleMainDrop}>

          {/* 도구줄 — **빵부스러기가 이 카드 안으로 들어왔다** (사용자 지적 2026-09-13):
              *"음원 글씨 하나 때문에 안맞잖아 맞춰 높이 윗 끝"*. 맞다. 빵부스러기가 카드
              **밖 위**에 있어서 가운데 카드만 24px 아래에서 시작했고, 세 칸의 윗변이 어긋났다.
              카드 안 첫 줄로 넣으면 왼쪽·가운데·오른쪽이 같은 y 에서 시작한다. */}
          <div className="card-base p-3 space-y-3">
          <div className="flex items-center gap-1.5 t-sub text-ds-v3-ink-2 flex-wrap">
            <button onClick={() => navigateTo(activeTab === 'bgm' ? 'bgm' : activeTab === 'misc-video' ? 'misc-video' : 'misc-audio', [])}
              className="hover:text-ds-v3-ink transition-colors">
              {activeTab === 'bgm' ? '배경음악' : activeTab === 'misc-video' || sysCat?.type === 'video' ? '영상' : '음원'}
            </button>
            {sysCat && activeTab !== 'bgm' && (
              <>
                <ChevronRight size={12} className="flex-shrink-0" />
                <span className="text-ds-v3-ink font-semibold">{sysCat.label}</span>
              </>
            )}
            {folderPath.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1.5">
                <ChevronRight size={12} className="flex-shrink-0" />
                <button onClick={() => navigateTo(activeTab, folderPath.slice(0, i + 1))}
                  className={i === folderPath.length - 1
                    ? 'text-ds-v3-ink font-semibold' : 'hover:text-ds-v3-ink transition-colors'}>
                  {p.name}
                </button>
              </span>
            ))}
            {(folderPath.length > 0 || sysCat) && (
              <button onClick={goUp}
                className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full border border-ds-v3-line
                           hover:bg-ds-v3-bg btn-press transition-colors">
                <ArrowUpToLine size={11} /> 위로
              </button>
            )}
          </div>

            <div className="h-px bg-ds-v3-line/60" />

            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-v3-ink-2" />
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="이름으로 찾기"
                  className="input-base w-full pl-9" />
              </div>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                className="input-base w-auto">
                {정렬규칙.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
                className="p-2 rounded-btn border border-ds-v3-line text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press"
                title={view === 'grid' ? '목록으로' : '격자로'}>
                {view === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
              </button>
            </div>

            {/* 배경음악 두 용도(방송용·식사용)의 곡 수·기본 차례 — 안 나가는 곡이 있으면 여기서 알린다. */}
            {/* 다시 세는 때: 파일 수가 바뀔 때 **와** 순서 편집에서 켜기·끄기가 바뀔 때(Codex 2단계 6회차 Low —
                유일한 곡을 끄고 저장해도 「1곡 나감」이 남았다). */}
            {activeTab === 'bgm' && (
              <BgmRolePanel refreshKey={`${files.length}:${playlist.map(p => `${p.audio_file_id}${p.active ?? 1}`).join(',')}`} />
            )}

            {/* 출처·이용 조건 — **올리기 단추보다 위에** 둔다(2026-09-21 화면 검수 High: 단추를 먼저 눌러
                파일을 고른 뒤에야 거절당했다). 음원 자리에서만(영상은 다음 단계). 배경음악은 필수. */}
            {/* 배경음악 맨 위에서는 올리기가 막혀 있다 — 출처 칸을 먼저 보이면 다 채운 뒤에야 막힌 줄 안다(화면 검수 Low) */}
            {좁나 && !isVideo && !배경맨위 && (
              <SourceUploadFields value={uploadSource} onChange={setUploadSource} required={출처필수} />
            )}
            {배경맨위 && (
              <p className="t-sub text-ds-v3-ink-2">곡을 넣을 <b className="text-ds-v3-ink">BGM 폴더를 먼저 고르세요</b> — 왼쪽 「배경음악」 아래 폴더를 누르거나, 「새 폴더」로 만들 수 있습니다. 폴더 이름을 바꾸면 예약·자동방송 고르개에도 새 이름으로 보입니다.</p>
            )}

            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => setShowNewFolder(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-ds-v3-line rounded-btn
                           t-sub text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors">
                <FolderPlus size={14} /> 새 폴더
              </button>
              <button onClick={파일창열기} disabled={uploading || 배경맨위}
                className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-ink hover:bg-black
                           text-white rounded-btn t-sub font-semibold btn-press transition-colors disabled:opacity-60">
                <Upload size={14} />
                {uploading ? `올리는 중… ${uploadPct}%` : isVideo ? '영상 올리기' : '음원 올리기'}
              </button>
              <input ref={fileInputRef} type="file" multiple accept={isVideo ? '.mp4,.webm,.mov,.avi' : '.mp3,.wav'}
                className="hidden" onChange={handleUploadInput} />
              {hasPlaylist && (
                <button onClick={() => setShowModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 border border-ds-v3-line rounded-btn
                             t-sub text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors">
                  <List size={14} /> 순서 편집
                </button>
              )}
              <span className="t-sub text-ds-v3-ink-2 ml-auto">
                {isVideo ? 'MP4·WEBM·MOV' : 'MP3·WAV'} · 이 안 어디든 끌어다 놓으면 바로 올라갑니다
              </span>
            </div>

            {uploading && (
              <div className="space-y-1">
                <p className="t-sub text-ds-v3-ink-2 truncate">{uploadName}</p>
                <div className="h-1.5 bg-ds-v3-bg rounded-full overflow-hidden">
                  <div className="h-full bg-ds-v3-ink transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              </div>
            )}
            {uploadOk && <p className="t-sub text-ds-v3-ink-3">{uploadOk}</p>}
            {uploadError && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-ds-v3-warn-bg border border-ds-v3-line rounded-btn">
                <AlertCircle size={14} className="text-ds-v3-warn flex-shrink-0 mt-0.5" />
                <p className="t-sub text-ds-v3-warn flex-1">{uploadError}</p>
                {/* ── 「다시」는 **눌러서 달라질 때만** 보여 준다 (UX-06) ─────────────
                    파일 **내용**이 그 칸과 안 맞아서 막힌 것이면(`노래.mp3` 라는 이름의
                    영상 파일 같은 것) 다시 눌러도 똑같이 막힌다. 고쳐야 할 것은 파일이지
                    누르는 횟수가 아니다 — 그때 「다시」를 띄우는 것은 거짓 희망이다.
                    `file-kind.test.js` 가 이 조건을 고정한다. */}
                {failedFile && !/내용/.test(uploadError) && (
                  <button onClick={() => doUpload(failedFile)}
                    className="t-sub text-ds-v3-warn font-semibold flex items-center gap-1">
                    <RotateCcw size={12} /> 다시
                  </button>
                )}
                <button onClick={() => setUploadError('')} aria-label="닫기"><X size={14} className="text-ds-v3-warn" /></button>
              </div>
            )}
            {deleteError && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-ds-v3-surface-2 border border-ds-v3-line rounded-btn">
                <AlertCircle size={14} className="text-ds-v3-ink-2 flex-shrink-0 mt-0.5" />
                <p className="t-sub text-ds-v3-ink-2 flex-1 leading-relaxed">{deleteError}</p>
                <button onClick={() => setDeleteError('')} aria-label="닫기"><X size={14} className="text-ds-v3-ink-2" /></button>
              </div>
            )}
          </div>

          {/* ── 여러 개 고른 뒤 한 번에 — 없던 것이다(사용자 지적) ──────────────────── */}
          {고른것.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-btn
                            border border-ds-v3-line-2 bg-ds-v3-bg">
              <span className="t-sub font-semibold text-ds-v3-ink">{고른것.size}개 선택</span>
              {고른파일.length > 0 && (
                <button onClick={() => setMoveTarget({ 여럿: 고른파일 })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn t-sub
                             border border-ds-v3-line bg-white hover:bg-ds-v3-bg btn-press transition-colors">
                  <FolderInput size={13} /> 옮기기
                </button>
              )}
              <button onClick={일괄삭제}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn t-sub
                           border border-ds-v3-line bg-white text-ds-v3-warn hover:bg-ds-v3-warn-bg btn-press transition-colors">
                <Trash2 size={13} /> 삭제
              </button>
              <button onClick={() => setz고른것(new Set())}
                className="ml-auto t-sub text-ds-v3-ink-2 hover:text-ds-v3-ink">선택 해제</button>
            </div>
          )}

          {/* ── 목록 ─────────────────────────────────────────────────────────── */}
          <div className={`card-base p-0 overflow-hidden ${dragOverMain ? 'ring-2 ring-ds-v3-ink' : ''}`}>
            {/* 머리줄 — 전체 선택이 여기 있다 */}
            {줄들.length > 0 && (
              <div className="flex items-center gap-3 px-3 py-2 border-b border-ds-v3-line bg-ds-v3-bg/60">
                <input type="checkbox" checked={다선택됨} aria-label="전체 선택"
                  onChange={() => setz고른것(다선택됨 ? new Set() : new Set(줄들.map(r => r.id)))}
                  className="w-4 h-4 flex-shrink-0" />
                <span className="t-sub text-ds-v3-ink-2 flex-1">이름</span>
                {/* 머리글 폭은 **줄의 폭과 같아야 한다** — 다르면 표가 어긋난다.
                    갈래 칸은 자막 꼬리표가 함께 서서 넓은 화면에서 넓어진다(2026-09-16). */}
                <span className={'t-sub text-ds-v3-ink-2 ' + (갈래칸보임 ? 'block' : 'hidden')}
                  style={{ width: 갈래칸폭 }}>갈래</span>
                <span className={`t-sub text-ds-v3-ink-2 w-28 ${정보칸보임 ? 'block' : 'hidden'}`}>정보</span>
                <span className="w-20" />
              </div>
            )}

            {contentLoading ? (
              <p className="t-sub text-ds-v3-ink-2 text-center py-10">불러오는 중…</p>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-sm font-semibold text-ds-v3-warn">목록을 불러오지 못했습니다</p>
                <p className="t-sub text-ds-v3-ink-2 text-center max-w-md">
                  {loadError}<br /><b>음원이 사라진 것이 아닙니다.</b> 서버가 떠 있는지 확인하고 다시 시도해 주세요.
                </p>
                <button onClick={loadCurrent}
                  className="px-3 py-2 border border-ds-v3-line rounded-btn t-sub text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press">
                  다시 불러오기
                </button>
              </div>
            ) : 줄들.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3">
                <div className="w-14 h-14 rounded-full bg-ds-v3-bg border border-ds-v3-line flex items-center justify-center">
                  {isVideo ? <Video size={24} className="text-ds-v3-line-2" /> : <Music2 size={24} className="text-ds-v3-line-2" />}
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-ds-v3-ink">
                    {찾는중 ? '찾는 것이 없습니다' : '아직 올린 것이 없습니다'}
                  </p>
                  <p className="t-sub text-ds-v3-ink-2 mt-1">
                    {찾는중 ? '다른 낱말로 찾아보거나, 왼쪽 맨 위(「음원」·「영상」)에서 찾으면 그 종류 전부에서 찾습니다.'
                      : activeTab === 'bgm' && currentFolderId
                        ? `이 폴더에 곡을 올리면 「${folderPath[folderPath.length - 1]?.name}」을 고른 방송에서 나갑니다.`
                        : `${isVideo ? '영상' : '음원'} 파일을 올리거나, 폴더를 먼저 만들어 정리할 수 있습니다.`}
                  </p>
                </div>
                {!찾는중 && (
                  <div className="flex flex-wrap gap-2 justify-center">
                    <button onClick={파일창열기} disabled={uploading || 배경맨위}
                      className="flex items-center gap-1.5 px-3 py-2 bg-ds-v3-ink hover:bg-black
                                 text-white rounded-btn t-sub font-semibold btn-press transition-colors disabled:opacity-60">
                      <Upload size={14} /> {isVideo ? '영상 올리기' : '음원 올리기'}
                    </button>
                    <button onClick={() => setShowNewFolder(true)}
                      className="flex items-center gap-1.5 px-3 py-2 border border-ds-v3-line rounded-btn
                                 t-sub text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors">
                      <FolderPlus size={14} /> 새 폴더
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-ds-v3-line">
                {줄들.map(({ 종류, id: rid, 것: it }) => {
                  const 골랐나 = 고른것.has(rid)
                  const 보는중 = 종류 === 'file' ? 상세?.종류 === 'file' && 상세.것.id === it.id
                    : 상세?.종류 === 'folder' && 상세.것.id === it.id
                  const 갈래 = 종류 === 'file' ? CATEGORIES.find(c => c.key === it.category) : null
                  return (
                    <li key={rid}
                      className={`flex items-center gap-3 px-3 py-2.5 transition-colors
                        ${보는중 ? 'bg-ds-v3-tts-bg' : 골랐나 ? 'bg-ds-v3-bg' : 'hover:bg-ds-v3-bg/60'}`}
                      draggable={종류 === 'file'}
                      onDragStart={e => {
                        // **받는 쪽과 같은 이름표로 싣는다.** `handleDropOnFolder` 는 `내부드래그`
                        // 이름표만 읽는데 여기서 `text/plain` 으로 보내고 있었다 — 내부 드래그에는
                        // `dataTransfer.files` 도 없어서 **끌어다 놔도 아무 일이 안 일어났다**
                        // (V③ R15 지적 2, 2026-09-13). `text/plain` 도 같이 싣는다 — 브라우저가
                        // 끄는 모양을 그릴 때 쓴다.
                        if (종류 !== 'file') return
                        e.dataTransfer.setData(내부드래그, String(it.id))
                        e.dataTransfer.setData('text/plain', String(it.id))
                      }}
                      onDragOver={e => { if (종류 === 'folder') e.preventDefault() }}
                      onDrop={e => { if (종류 === 'folder') { e.stopPropagation(); handleDropOnFolder(e, it.category, it.id) } }}>

                      <input type="checkbox" checked={골랐나} onChange={() => 줄토글(rid)}
                        aria-label={`${it.name || it.original_name} 선택`} className="w-4 h-4 flex-shrink-0" />

                      {/* 이름 — **폴더는 두 번 눌러 들어간다**(사용자 지시 2026-09-13).
                          드라이브·탐색기와 같은 규칙이다. 한 번 누르면 고른 것이 되고
                          (오른쪽에 이름·쓰임이 뜬다), 두 번 눌러야 자리를 옮긴다.
                          한 번에 들어가면 **이름을 보려고 눌렀을 뿐인데 화면이 바뀐다.**
                          파일은 그대로 한 번 — 파일에는 「들어간다」가 없다. */}
                      <button
                        onClick={() => 종류 === 'folder'
                          ? set상세({ 종류: 'folder', 것: it })
                          : set상세({ 종류: 'file', 것: it })}
                        onDoubleClick={() => { if (종류 === 'folder') navigateTo(it.category, [...folderPath, { id: it.id, name: it.name }]) }}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        title={종류 === 'folder' ? `${it.name} — 두 번 누르면 들어갑니다` : it.original_name}>
                        {종류 === 'folder'
                          ? <Folder size={16} className="text-ds-v3-ink-2 flex-shrink-0" />
                          : isVideoFile(it) ? <Video size={16} className="text-ds-v3-tts flex-shrink-0" />
                            : <Music2 size={16} className="text-ds-v3-ink-2 flex-shrink-0" />}
                        <span className="truncate text-sm text-ds-v3-ink">{it.name || it.original_name}</span>
                        {/* 출처 — 이름 뒤에 작게. 줄 높이를 늘리지 않는다(이름이 먼저다). */}
                        {종류 === 'file' && it.source_name && (
                          <span className="truncate t-sub text-ds-v3-ink-3 flex-shrink max-w-[30%]">· {it.source_name}</span>
                        )}
                      </button>

                      {/* 갈래 — **꼬리표만**. 「무엇에 쓰이는지」 문장은 오른쪽 상세에 있다.
                          줄에서는 **이름이 먼저다** — 여기에 문장까지 넣었더니 이름이
                          「아침…」으로 뭉개졌다(브라우저에서 재 보고 고쳤다: 이름 62px).
                          누르면 그 갈래만 걸러 본다 — 왼쪽에서 내린 카테고리로 가는 길이다. */}
                      {/* 갈래 칸에 **자막 꼬리표가 함께 선다**(사용자 지시 2026-09-16).
                          그래서 `w-28`(112px) 로는 좁다 — 「저녁 마무리 #자막」이 안 들어간다.
                          넓은 화면에서만 늘린다(`laptop:w-44`): 좁은 화면에서는 이 칸이
                          애초에 감춰진다(`갈래칸보임`). **머리글 폭도 같이 바꿔야 한다** —
                          다르면 표가 통째로 어긋난다(musicmanagement.test.js 가 맞춰 본다). */}
                      <div className={(갈래칸보임 ? 'flex' : 'hidden') + ' items-center gap-1 flex-shrink-0'}
                        style={{ width: 갈래칸폭 }}>
                        {종류 === 'folder' ? (
                          <span className="t-sub text-ds-v3-ink-2">폴더</span>
                        ) : 갈래 ? (
                          <button onClick={() => navigateTo(it.category, [])}
                            title={`${갈래.label} 만 보기`}
                            className="t-sub px-1.5 py-0.5 rounded-full border border-ds-v3-line
                                       text-ds-v3-ink-2 hover:bg-ds-v3-bg btn-press transition-colors truncate min-w-0">
                            {갈래.label}
                          </button>
                        ) : <span className="t-sub text-ds-v3-ink-2 truncate min-w-0">자유 보관</span>}
                        {종류 === 'file' && <SubtitleBadge status={it.subtitle_status} />}
                      </div>

                      <span className={`${정보칸보임 ? 'block' : 'hidden'} w-28 flex-shrink-0 t-sub text-ds-v3-ink-2 truncate`}>
                        {종류 === 'file' ? 작은표시(it).join(' · ') : ''}
                      </span>

                      {/* 줄 동작 — **늘 보인다.** 마우스를 올려야 나오면 있는 줄도 모른다 */}
                      <div className="flex items-center gap-0.5 w-20 flex-shrink-0 justify-end">
                        {종류 === 'file' && it.filename && (
                          <button onClick={() => handlePreview(it)} title="미리듣기"
                            className="w-7 h-7 rounded-full flex items-center justify-center
                                       text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-white btn-press">
                            {playingId === it.id ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                        )}
                        <button
                          onClick={() => 종류 === 'folder'
                            ? (() => { const n = prompt('새 폴더 이름', it.name); if (n) handleRenameFolder(it, n) })()
                            : set상세({ 종류: 'file', 것: it })}
                          title={종류 === 'folder' ? '이름 변경' : '자세히'}
                          className="w-7 h-7 rounded-full flex items-center justify-center
                                     text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-white btn-press">
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => 종류 === 'folder' ? handleDeleteFolder(it) : handleDelete(it)}
                          title="삭제"
                          className="w-7 h-7 rounded-full flex items-center justify-center
                                     text-ds-v3-ink-2 hover:text-ds-v3-warn hover:bg-white btn-press">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ══ 오른쪽 — 고른 것의 정보와 자막 ═══════════════════════════════════
            **자막을 열면 이 칸이 넓어지고 가운데가 그만큼 양보한다** (사용자 지적 2026-09-13):
            *"정보에서 자막 작업하려면 반응형으로 나머지것이 좀 옆으로 가야하지 않겠니"*.
            288px 안에서 자막 편집기를 그리니 문구 칸이 한 글자씩 세로로 흘렀다.
            자막 편집기는 「문구 | 방송 화면」 두 칸짜리라 최소 420 은 있어야 읽힌다.
            좁은 자리에서는 옆이 아니라 **아래**로 간다 — 옆으로 밀 폭 자체가 없다. */}
        <div className={좁나
          ? 'w-full card-base p-4 space-y-3'
          : 'flex-shrink-0 card-base p-4 sticky top-4 max-h-[calc(100vh/var(--cc-zoom,1)-140px)] '
            + 'overflow-y-auto space-y-3 transition-[width] duration-200'}
          style={좁나 ? undefined : { width: 오른쪽폭 }}>
          {!상세 ? (
            <div className="text-center py-10 space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-ds-v3-bg border border-ds-v3-line
                              flex items-center justify-center">
                <Music2 size={20} className="text-ds-v3-line-2" />
              </div>
              <p className="t-sub text-ds-v3-ink-2">
                줄을 누르면 여기에 그 파일의 정보와 자막이 나옵니다.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <p className="flex-1 text-sm font-semibold text-ds-v3-ink break-all">
                  {상세.것.original_name || 상세.것.name}
                </p>
                <button onClick={() => set상세(null)} aria-label="닫기"
                  className="text-ds-v3-ink-2 hover:text-ds-v3-ink flex-shrink-0"><X size={15} /></button>
              </div>

              {/* 폴더를 골랐을 때 — 들어가기·이름·삭제만. 파일에만 있는 것(미리듣기·
                  자막·재생목록)은 안 그린다. 폴더를 한 번 눌러도 무엇을 고른 건지
                  보이게 하려고 두는 칸이다(두 번 누르면 그냥 들어간다). */}
              {상세.종류 === 'folder' ? (
                <div className="space-y-3">
                  <p className="t-sub text-ds-v3-ink-2">폴더 · 두 번 누르면 들어갑니다</p>
                  <button onClick={() => navigateTo(상세.것.category, [...folderPath, { id: 상세.것.id, name: 상세.것.name }])}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-btn
                               border border-ds-v3-line t-sub font-semibold text-ds-v3-ink-2
                               hover:text-ds-v3-ink btn-press transition-colors">
                    <Folder size={14} /> 이 폴더 열기
                  </button>
                  <div className="flex gap-1.5">
                    <button onClick={() => { const n = prompt('새 폴더 이름', 상세.것.name); if (n) handleRenameFolder(상세.것, n) }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-btn
                                 border border-ds-v3-line t-sub text-ds-v3-ink-2 hover:text-ds-v3-ink btn-press transition-colors">
                      <Pencil size={13} /> 이름 바꾸기
                    </button>
                    <button onClick={() => handleDeleteFolder(상세.것)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-btn
                                 border border-ds-v3-line t-sub text-ds-v3-warn hover:bg-ds-v3-warn-bg btn-press transition-colors">
                      <Trash2 size={13} /> 삭제
                    </button>
                  </div>
                </div>
              ) : (
              <>
              <dl className="space-y-1.5">
                {[
                  ['갈래', CATEGORIES.find(c => c.key === 상세.것.category)?.label || 상세.것.category],
                  ['길이·용량·올린 때', 작은표시(상세.것).join(' · ') || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2 t-sub">
                    <dt className="w-28 flex-shrink-0 text-ds-v3-ink-2">{k}</dt>
                    <dd className="flex-1 text-ds-v3-ink break-all">{v}</dd>
                  </div>
                ))}
              </dl>

              {/* 쓰임 — 문장으로 적는다(「← 나감」 같은 줄임말을 안 쓴다) */}
              {(() => {
                const b = referenceBadge(상세.것, playlist)
                return b ? <Badge tone={b.tone}>{b.text}</Badge> : null
              })()}

              {/* 이름 바꾸기 */}
              <div className="space-y-1.5">
                <label className="t-sub text-ds-v3-ink-2">이름</label>
                <div className="flex gap-1.5">
                  <input defaultValue={상세.것.original_name} key={상세.것.id}
                    onChange={e => setRenameVal(e.target.value)}
                    className="input-base flex-1" />
                  <button onClick={() => handleRename(상세.것)}
                    className="px-3 rounded-btn border border-ds-v3-line t-sub text-ds-v3-ink-2
                               hover:text-ds-v3-ink btn-press transition-colors">
                    <Check size={14} />
                  </button>
                </div>
              </div>

              {/* 출처·이용 조건 — 올린 뒤에도 고친다. 저장하면 목록과 상세가 같은 값을 본다. */}
              {상세.것.filename && (
                <SourceDetail key={상세.것.id} file={상세.것} onSave={async (값) => {
                  await updateAudioSource(상세.것.id, 값)
                  const 다듬음 = Object.fromEntries(Object.entries(값).map(([k, v]) => [k, v.trim() || null]))
                  setFiles(prev => prev.map(f => f.id === 상세.것.id ? { ...f, ...다듬음 } : f))
                  set상세(s => (s && s.것.id === 상세.것.id ? { ...s, 것: { ...s.것, ...다듬음 } } : s))
                }} />
              )}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {상세.것.filename && (
                  <button onClick={() => handlePreview(상세.것)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn t-sub
                               border border-ds-v3-line hover:bg-ds-v3-bg btn-press transition-colors">
                    {playingId === 상세.것.id ? <Pause size={13} /> : <Play size={13} />} 미리듣기
                  </button>
                )}
                <button onClick={() => setMoveTarget(상세.것)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn t-sub
                             border border-ds-v3-line hover:bg-ds-v3-bg btn-press transition-colors">
                  <FolderInput size={13} /> 옮기기
                </button>
                {!상세.것.is_primary && 상세.것.category !== 'bgm' && (
                  <button onClick={() => handleMakePrimary(상세.것)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn t-sub
                               border border-ds-v3-line hover:bg-ds-v3-bg btn-press transition-colors">
                    <ArrowUpToLine size={13} /> 이걸로 바꾸기
                  </button>
                )}
                <button onClick={() => handleDelete(상세.것)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn t-sub
                             border border-ds-v3-line text-ds-v3-warn hover:bg-ds-v3-warn-bg btn-press transition-colors">
                  <Trash2 size={13} /> 삭제
                </button>
              </div>

              {/* 자막 — **업로드한 영상에도 붙인다.** 빠지는 것은 이 PC 에 파일이 없는 행뿐이다 —
                  재생 위치를 못 잡는다(2026-09-12 결정).
                  화면을 다시 짜면서 `!isVideoFile(...)` 이 끼어들어 **로컬 영상의 자막 편집
                  진입점이 통째로 사라졌다** — 그 결정을 뒤집은 줄이었다(V③ R15 지적 5, 2026-09-13). */}
              {상세.것.filename && (
                <div className="pt-2 border-t border-ds-v3-line">
                  <button onClick={() => setSubtitleFile(subtitleFile?.id === 상세.것.id ? null : 상세.것)}
                    className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-btn t-sub
                                font-semibold btn-press transition-colors border
                      ${subtitleFile?.id === 상세.것.id
                        ? 'bg-ds-v3-tts text-white border-ds-v3-tts'
                        : 'border-ds-v3-line text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
                    <Captions size={14} /> 자막 {subtitleFile?.id === 상세.것.id ? '닫기' : '편집'}
                  </button>
                  {subtitleFile?.id === 상세.것.id && (
                    <div className="mt-2">
                      <SubtitleEditor file={상세.것} embedded onClose={() => setSubtitleFile(null)} onChanged={loadCurrent} />
                    </div>
                  )}
                </div>
              )}
              </>
              )}
            </>
          )}
        </div>
      </div>

      {showModal && (
        <PlaylistModal categoryLabel={sysCat?.label} items={playlist} onSave={handleSavePlaylist} onClose={() => setShowModal(false)} />
      )}
      {showNewFolder && (
        <NewFolderModal onCreate={handleCreateFolder} onClose={() => setShowNewFolder(false)} />
      )}
      {moveTarget && (
        <MoveFileModal category={activeTab} file={moveTarget} onMove={handleMoveFile} onClose={() => setMoveTarget(null)} />
      )}
    </div>
  )
}
