// BGM 폴더 목록 — 고르개·요약 줄·업로드 화면이 **같은 한 벌**을 본다 (2026-09-22 「폴더를 자유롭게 늘림」).
//
// 폴더 이름은 사람이 업로드 화면에서 바꾼다. 그래서 이름을 코드에 적지 않고 서버(GET /api/audio/bgm/folders)
// 에서 읽는다 — 이름을 바꾸면 모든 화면이 새 이름을 보인다. 저장값은 번호로 잇는다(src/lib/bgmTypes.js).
//
// 한 창에 고르개가 여럿 떠도 한 번만 묻는다(모듈 한 벌 + 구독). 업로드 화면이 폴더를 만들거나·이름을 바꾸거나·
// 지우거나·곡을 올리면 `carecast:bgm-folders-changed` 를 쏘고, 여기서 다시 읽는다.
import { useEffect, useSyncExternalStore } from 'react'
import { getBgmFolders } from './api'
import { setBgmFoldersNow } from './bgmFolderCache.js'

export const BGM_FOLDERS_CHANGED = 'carecast:bgm-folders-changed'

let 상태 = { folders: null, songs: null, state: 'idle', error: '' }   // state: idle | loading | ready | error
let 진행 = null
const 듣는이 = new Set()
const 알리기 = () => { for (const f of 듣는이) f(상태) }

/** 서버에서 다시 읽는다. 읽는 중이면 그 약속을 같이 기다린다. */
export function reloadBgmFolders() {
  if (진행) return 진행
  상태 = { ...상태, state: 상태.folders ? 상태.state : 'loading', error: '' }
  알리기()
  진행 = getBgmFolders()
    .then(r => {
      상태 = { folders: Array.isArray(r?.folders) ? r.folders : [], songs: Array.isArray(r?.songs) ? r.songs : [], state: 'ready', error: '' }
      setBgmFoldersNow(상태.folders, 상태.songs)
    })
    .catch(e => { 상태 = { ...상태, state: 상태.folders ? 'ready' : 'error', error: e?.message || '불러오지 못했습니다' } })
    .finally(() => { 진행 = null; 알리기() })
  return 진행
}

if (typeof window !== 'undefined') {
  window.addEventListener(BGM_FOLDERS_CHANGED, () => { reloadBgmFolders() })
  // 다른 기기(직원 폰·관리 PC)에서 이름을 바꾸거나 곡을 올리면 이 창은 모른다 — 창을 다시 볼 때 새로 읽는다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && 상태.state !== 'idle') reloadBgmFolders()
  })
}

/**
 * @returns {{ folders: object[]|null, state: 'loading'|'ready'|'error', error: string, reload: () => Promise }}
 */
export function useBgmFolders() {
  // 바깥 저장소 구독은 React 가 주는 그 훅으로 — 효과 안에서 상태를 맞추면 렌더가 한 번 더 돈다(lint set-state-in-effect).
  const 지금 = useSyncExternalStore(구독, () => 상태)
  // 고르개가 **뜰 때마다** 한 번 새로 읽는다(코드 검수 Low) — 다른 PC 에서 바꾼 이름·곡 수가 모달을 다시 열면
  // 보이게. 읽는 중이면 그 약속에 합쳐지고, 들고 있던 목록은 그동안 그대로 보인다(깜빡이지 않는다).
  useEffect(() => { reloadBgmFolders() }, [])
  return { ...지금, state: 지금.state === 'idle' ? 'loading' : 지금.state, reload: reloadBgmFolders }
}
function 구독(알림) {
  const f = () => 알림()
  듣는이.add(f)
  return () => { 듣는이.delete(f) }
}

/** 곡 넣으러 가는 길 — 업로드 화면의 배경음악 갈래. */
export const BGM_UPLOAD_PATH = '/upload?cat=bgm'

/** 그 폴더로 곧장 여는 길(업로드 화면이 `folder` 를 읽어 그 폴더 안에서 연다 — 화면 검수 High). */
// from=picker — 고르개에서 **새 창으로** 연 것(쓰던 방송 초안이 날아가지 않게, 사용자 지적 2026-09-22 「폴더 가면 다시 뒤로 되돌리기 어렵잖아」).
// 업로드 화면이 이것을 보고 「다 넣었으면 이 창을 닫으세요」 줄을 띄운다.
export const bgmUploadPathFor = (folderId) => (folderId ? `/upload?cat=bgm&folder=${folderId}&from=picker` : `${BGM_UPLOAD_PATH}&from=picker`)
