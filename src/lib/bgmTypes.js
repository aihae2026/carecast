// BGM 을 **어느 폴더에서** 가져오고 **어떤 차례로** 트는지 — 화면 여럿이 같이 쓰는 단일 출처.
//
// 예전엔 이 목록이 **세 파일에 그대로 복사**돼 있었다(morningEditorConst.js · FlowBuilder.jsx ·
// ScheduleModal.jsx). 한 곳만 고치면 화면마다 다른 것을 고르게 된다(사용자 지적 2026-09-13).
//
// 2026-09-21: 외부 동영상 서비스 연동(검색어·즐겨찾기·주소)을 걷어냈다(사용자 지시).
// 2026-09-22: BGM 폴더를 **자유롭게 늘린다**(사용자 결정). 기본 두 폴더(방송용·식사용) 말고도 사람이 업로드
// 화면에서 만든 폴더를 어디서든 고른다. 폴더 이름은 코드에 적지 않고 서버에서 읽는다(src/lib/bgmFolders.js).
//
// 저장되는 값(`bgm_type`)의 규칙 — 서버 server/domain/bgmRoles.js 와 **같은 규칙**이다:
//   local_broadcast · local_meal (+`_seq`)     ← 기본 두 폴더(용도). 번호가 PC 마다 달라 용도 이름으로 적는다
//   local_f<폴더 번호> (+`_seq`)                ← 사람이 만든 폴더. **번호로 잇는다** — 이름을 바꿔도 안 끊긴다
// 폴더 하나에 저장값 하나: 고르개가 용도 폴더를 고르면 용도 값으로 적는다.
// **그 밖의 옛 값**(검색어·즐겨찾기·주소, 빈 값)은 서버가 방송용으로 읽는다(끝이 `_seq` 면 차례로) —
// 화면도 같은 규칙으로 보여 준다. 둘이 다르면 화면에 보이는 것과 실제로 나가는 것이 갈린다.
import { bgmFoldersNow, bgmSongsNow } from './bgmFolderCache.js'

// 기본 두 폴더 — 이름은 **서버 목록이 없을 때만** 쓰는 대체 글자다(이름은 사람이 바꾼다).
export const BGM_LOCAL = [
  { id: 'local_broadcast', role: 'broadcast', label: '방송용 BGM' },
  { id: 'local_meal',      role: 'meal',      label: '식사용 BGM' },
]
const 용도값들 = BGM_LOCAL.map(s => s.id)
const 폴더값규칙 = /^local_f([1-9]\d{0,8})$/   // 서버 domain/bgmRoles.js 와 같은 글자(1~999999999)
// 곡 하나(2026-09-22 「개별적 파일로도」) — `local_a<곡 번호>`. 차례(`_seq`)가 없다. 서버 bgmRoles.곡값 과 같은 글자.
const 곡값규칙 = /^local_a([1-9]\d{0,8})$/
/** 고른 것이 곡 하나인가 */
export const 곡하나인가 = (source) => 곡값규칙.test(String(source || ''))

// 새로 만드는 BGM 의 기본 갈래 — 이 PC 의 방송용 폴더.
export const BGM_DEFAULT_TYPE = 'local_broadcast'

// 「어떤 차례로」 — 두 줄째.
export const BGM_ORDERS = [
  // 설명은 실제 동작 그대로(2026-09-21 화면 검수): 차례로는 「올린 순서」가 아니라 **순서 편집에서
  // 정한 순서**이고, 틀 때마다 시작 곡이 한 칸씩 밀린다(server/domain/bgmRoles.js 재생순서).
  { id: 'random', label: '랜덤',  desc: '틀 때마다 섞어서' },
  { id: 'seq',    label: '차례로', desc: '순서 편집에서 정한 순서대로, 틀 때마다 다음 곡부터' },
]

/** 고른 것(차례를 뗀 값)이 알아듣는 갈래인가 — `local_broadcast` · `local_meal` · `local_f12` */
const 아는갈래 = (source) => 용도값들.includes(source) || 폴더값규칙.test(String(source || '')) || 곡하나인가(source)

/** 저장된 `bgm_type` → 폴더 갈래(차례를 뗀 값). 옛 값·빈 값은 서버처럼 방송용이다. */
export function bgmSourceOf(bgmType) {
  const s = String(bgmType || '').replace(/_seq$/, '')
  return 아는갈래(s) ? s : BGM_DEFAULT_TYPE
}

/** 첫 줄에서 고른 것이 「차례」를 묻는 갈래인가 — 폴더는 다 묻는다. */
export const 차례를묻나 = (source) => 아는갈래(source)

/** 저장된 `bgm_type` → 둘째 줄에서 눌러야 할 것. */
export function bgmOrderOf(bgmType) {
  return /_seq$/.test(String(bgmType || '')) ? 'seq' : 'random'
}

/** 두 줄에서 고른 것 → 저장할 `bgm_type`. 모르는 갈래는 기본 갈래로. */
export function bgmTypeFrom(source, order = 'random') {
  const s = 아는갈래(source) ? source : BGM_DEFAULT_TYPE
  if (곡하나인가(s)) return s   // 곡 하나에는 차례가 없다
  return order === 'seq' ? `${s}_seq` : s
}

/** 곡 하나 → 그 곡(목록에 없으면 null). */
export function songOfSource(source, songs = bgmSongsNow()) {
  const m = 곡값규칙.exec(String(source || ''))
  if (!m || !Array.isArray(songs)) return null
  return songs.find(s => s.id === Number(m[1])) || null
}

/** 서버 목록의 폴더 하나 → 그 폴더를 고를 때 저장할 갈래(용도 폴더면 용도 값 — 폴더 하나에 값 하나). */
export function sourceOfFolder(folder) {
  if (!folder) return BGM_DEFAULT_TYPE
  return folder.role ? `local_${folder.role}` : `local_f${folder.id}`
}

/** 갈래 → 서버 목록의 그 폴더(없으면 null — 지워졌거나 아직 못 불러옴). */
export function folderOfSource(source, folders = bgmFoldersNow()) {
  if (!Array.isArray(folders)) return null
  const 용도 = BGM_LOCAL.find(s => s.id === source)
  if (용도) return folders.find(f => f.role === 용도.role) || null
  const m = 폴더값규칙.exec(String(source || ''))
  return m ? folders.find(f => f.id === Number(m[1])) || null : null
}

/** 갈래 → 사람에게 보일 폴더 이름. 목록에 있으면 **지금 이름**, 없으면 대체 글자. */
export function bgmFolderName(source, folders = bgmFoldersNow()) {
  if (곡하나인가(source)) {
    const 곡 = songOfSource(source)
    return 곡 ? `곡: ${곡.name}` : (Array.isArray(bgmSongsNow()) ? '없어진 곡' : '고른 곡')
  }
  const f = folderOfSource(source, folders)
  if (f) return f.name
  const 용도 = BGM_LOCAL.find(s => s.id === source)
  if (용도) return 용도.label
  // 목록을 아직 못 불러왔으면 「없어졌다」고 단정하지 않는다.
  return Array.isArray(folders) ? '없어진 BGM 폴더' : 'BGM 폴더'
}

/** 사람에게 보여 줄 한 줄 — 「식사용 BGM · 랜덤」 */
export function bgmTypeLabel(bgmType, folders = bgmFoldersNow()) {
  if (곡하나인가(bgmSourceOf(bgmType))) return bgmFolderName(bgmSourceOf(bgmType), folders)
  const 이름 = bgmFolderName(bgmSourceOf(bgmType), folders)
  return `${이름} · ${BGM_ORDERS.find(o => o.id === bgmOrderOf(bgmType))?.label}`
}

/** 자동방송 단계(`bgmRole` · `bgmFolderId`) → 갈래. 둘 다 없으면 null(방송 종류로 정해짐). */
export function sourceOfStep(step) {
  const 곡 = Number(step?.bgmFileId)
  if (Number.isInteger(곡) && 곡 > 0) return `local_a${곡}`
  const id = Number(step?.bgmFolderId)
  if (Number.isInteger(id) && id > 0) return `local_f${id}`
  return BGM_LOCAL.find(s => s.role === step?.bgmRole)?.id || null
}

/** 갈래 → 자동방송 단계에 적을 값. 용도 폴더면 bgmRole, 사람이 만든 폴더면 bgmFolderId. null 이면 둘 다 비움. */
export function stepFieldsOfSource(source) {
  const 용도 = BGM_LOCAL.find(s => s.id === source)
  if (용도) return { bgmRole: 용도.role, bgmFolderId: undefined, bgmFileId: undefined }
  const m = 폴더값규칙.exec(String(source || ''))
  if (m) return { bgmRole: undefined, bgmFolderId: Number(m[1]), bgmFileId: undefined }
  const 곡 = 곡값규칙.exec(String(source || ''))
  if (곡) return { bgmRole: undefined, bgmFolderId: undefined, bgmFileId: Number(곡[1]) }
  return { bgmRole: undefined, bgmFolderId: undefined, bgmFileId: undefined }
}
