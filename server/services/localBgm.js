// 로컬 배경음악 고르기 — 용도 폴더(또는 지정 폴더)에서 랜덤·차례로 (2026-09-21).
//
// 예전엔 로컬 BGM 을 내는 세 곳(/bgm/start · bgmScheduler · 자동방송 단계)이 각자 같은 SQL 로
// **bgm 재생목록 전체**를 보냈다. 폴더를 나눠도 식사 중에 happy 곡이 섞였다. 이제 셋 다 이것을 쓴다.
//
// **아무거나 틀지 않는다 — 알리지 않고는 넘어가지 않는다.** `로컬BGM고르기` 는 고른 폴더가 없거나
// 비었으면 `{ok:false, 사유}` 를 준다(미리듣기·세기가 이것을 쓴다 — 대신 튼 결과를 보이면 거짓이다).
// 방송이 부르는 `방송BGM고르기` 만 **사람이 만든 폴더**를 못 쓸 때 그 방송의 기본 용도 폴더로 대신
// 틀고 경보를 낸다(2026-09-22 설계 검토 — 곡을 옮겨 폴더가 비는 일은 삭제 막기로 못 막는다).
// 용도 폴더끼리는 서로 대신하지 않는다 — 식사 중에 happy 곡이 섞이지 않게(dc93cc79).
// 부르는 쪽이 사유를 로그·단계 기록에 남긴다(「조회 실패」와 「정말 비어 있음」을 가른다 — CC-038).
//
// **폴더 = 그 폴더와 그 아래 하위 폴더 전부**(2026-09-21 QA 재현). 사람이 용도 폴더 안에 하위
// 폴더를 만들어 곡을 정리하면, 예전 판은 그 곡을 조용히 뺐다. 단 **다른 용도 폴더가 그 아래에
// 들어가 있으면 그 가지는 뺀다** — 방송용을 식사용 안으로 옮겨도 식사 중에 happy 곡이 섞이지 않게.
'use strict'

const { rawSetting, writeSetting } = require('../domain/settingsRead')
const { 역할들, 역할찾기, 재생순서, 차례키, 순서들, 번호읽기 } = require('../domain/bgmRoles')

/** 용도의 폴더를 찾는다. */
function 역할폴더(db, role) {
  const r = 역할찾기(role)
  if (!r) return { ok: false, 사유: `모르는 용도입니다: ${role}` }
  const id = parseInt(rawSetting(db, r.폴더키) ?? '', 10)
  // 「서버를 다시 켜면 만들어진다」고 적지 않는다 — 첫 부팅 보정은 한 번만 돈다(QA 재현).
  if (!id) return { ok: false, 사유: `「${r.이름}」 폴더가 정해져 있지 않습니다. 관리자에게 알려 주세요.` }
  const 폴더 = db.prepare("SELECT id, name FROM content_folders WHERE id = ? AND category = 'bgm'").get(id)
  if (!폴더) return { ok: false, 사유: `「${r.이름}」 폴더가 없어졌습니다. 관리자에게 알려 주세요.` }
  return { ok: true, folderId: 폴더.id, folderName: 폴더.name, 역할: r }
}

/** 용도의 기본 순서(설정). */
function 역할순서(db, role) {
  const r = 역할찾기(role)
  const v = r ? rawSetting(db, r.순서키) : null
  return 순서들.includes(v) ? v : (r?.기본순서 || 'random')
}

// 이 폴더와 그 아래 폴더 번호들. 다른 용도 폴더(와 그 아래)는 뺀다.
function 가지(db, rootId) {
  const 아래 = (id) => db.prepare(`
    WITH RECURSIVE t(id) AS (
      SELECT ? UNION ALL SELECT cf.id FROM content_folders cf JOIN t ON cf.parent_id = t.id
    ) SELECT id FROM t`).all(id).map(r => r.id)
  const 모두 = new Set(아래(rootId))
  for (const r of 역할들) {
    const 다른 = parseInt(rawSetting(db, r.폴더키) ?? '', 10)
    if (다른 && 다른 !== rootId && 모두.has(다른)) for (const x of 아래(다른)) 모두.delete(x)
  }
  return [...모두]
}

// 폴더 가지 안의 곡. active 로 거르지 않고 돌려준다 — 「비었다」와 「전부 꺼 뒀다」를 가르려고.
function 가지곡(db, 폴더들) {
  if (!폴더들.length) return []
  return db.prepare(`
    SELECT af.filename, af.original_name, ap.active
    FROM   audio_playlist ap
    JOIN   audio_files    af ON af.id = ap.audio_file_id
    WHERE  ap.category = 'bgm' AND af.folder_id IN (${폴더들.map(() => '?').join(',')})
    ORDER  BY ap.sort_order
  `).all(...폴더들)
}

/**
 * @param {{role?: string, folderId?: number, order?: string}} 요청 — folderId 가 있으면 그 폴더,
 *   없으면 role 의 폴더. order 가 없으면 용도의 기본 순서.
 * @returns {{ok: true, files: {url,name}[], title: string, folderId: number, folderName: string, order: string}
 *          | {ok: false, 사유: string}}
 */
function 로컬BGM고르기(db, 요청 = {}) {
  let folderId, folderName
  if (요청.folderId != null && 요청.folderId !== '') {
    const id = 번호읽기(요청.folderId)
    const 폴더 = id ? db.prepare("SELECT id, name FROM content_folders WHERE id = ? AND category = 'bgm'").get(id) : null
    if (!폴더) return { ok: false, 사유: '고른 배경음악 폴더가 없습니다.' }
    folderId = 폴더.id; folderName = 폴더.name
  } else {
    const 찾음 = 역할폴더(db, 요청.role || 'broadcast')
    if (!찾음.ok) return 찾음
    folderId = 찾음.folderId; folderName = 찾음.folderName
  }
  const order = 순서들.includes(요청.order) ? 요청.order : 역할순서(db, 요청.role || 'broadcast')

  const 전부 = 가지곡(db, 가지(db, folderId))
  const 곡들 = 전부.filter(f => f.active === 1)
  if (!곡들.length) {
    return { ok: false, 사유: 전부.length
      ? `「${folderName}」 폴더의 곡이 모두 꺼져 있습니다. 업로드 › 배경음악의 순서 편집에서 켜 주세요.`
      : `「${folderName}」 폴더가 비어 있습니다. 업로드 › 배경음악에서 곡을 올리거나 옮겨 주세요.` }
  }

  const 키 = 차례키(folderId)
  const 시작 = parseInt(rawSetting(db, 키) ?? '0', 10) || 0
  const { 목록, 다음자리 } = 재생순서(곡들, order, 시작)
  if (order === 'seq') writeSetting(db, 키, String(다음자리), '자동')

  const files = 목록.map(f => ({ url: `/audio/bgm/${f.filename}`, name: f.original_name }))
  return { ok: true, files, title: files[0].name, folderId, folderName, order }
}

/** 이 폴더가 용도 폴더면 그 용도(`broadcast`·`meal`), 아니면 null. */
function 폴더의용도(db, folderId) {
  const id = 번호읽기(folderId)
  if (!id) return null
  return 역할들.find(r => parseInt(rawSetting(db, r.폴더키) ?? '', 10) === id)?.role ?? null
}

/**
 * **방송이 부르는** 고르기 (2026-09-22). 사람이 만든 폴더(`folderId`)를 못 쓰면 — 없어졌거나·비었거나·
 * 곡이 전부 꺼졌으면 — 이 방송의 기본 용도(`role`) 폴더에서 대신 틀고 **경보를 낸다.** 무엇이 나갔는지
 * 거짓이 없게 결과에 `대체: true` 와 실제 폴더 이름을 싣는다.
 * 용도 폴더를 고른 것이면(번호로 왔어도) 용도로 읽고 대신하지 않는다 — 방송용·식사용이 섞이면 안 된다.
 * @param {{folderId?: number|string, role?: string, order?: string}} 요청 role = 이 방송의 기본 용도
 */
function 방송BGM고르기(db, 요청 = {}) {
  const role = 역할찾기(요청.role) ? 요청.role : 'broadcast'
  // 곡 하나를 고른 것(2026-09-22) — 그 곡이 없어졌으면 폴더와 같게 기본 폴더로 대신 틀고 경보를 낸다.
  if (요청.fileId != null && 요청.fileId !== '') {
    const 곡 = 곡하나고르기(db, 요청.fileId)
    if (곡.ok) return 곡
    // 곡 하나에는 차례가 없다 — 대신 틀 때도 랜덤으로 골라 기본 폴더의 「차례로」 자리를 밀지 않는다(Codex 2회차)
    return 대신틀기(db, 곡.사유, role, 'random')
  }
  // 번호가 **없으면** 용도 폴더. 번호가 있는데 못 읽는 값이면 없는 폴더로 본다(대신 틀고 경보 — 조용히 바꾸지 않는다).
  const 없음 = 요청.folderId == null || 요청.folderId === ''
  if (없음) return 로컬BGM고르기(db, { role, order: 요청.order })
  const id = 번호읽기(요청.folderId) ?? -1
  const 그용도 = 폴더의용도(db, id)
  if (그용도) return 로컬BGM고르기(db, { role: 그용도, order: 요청.order })
  // 사람이 만든 폴더는 용도의 기본 순서가 없다 — 적힌 것이 없으면 랜덤(설계 검토 위험 8).
  const 먼저 = 로컬BGM고르기(db, { folderId: id, order: 순서들.includes(요청.order) ? 요청.order : 'random' })
  if (먼저.ok) return 먼저
  return 대신틀기(db, 먼저.사유, role, 요청.order)
}

// 고른 폴더·곡을 못 쓸 때 — 기본 용도 폴더로 대신 틀고 경보(무엇이 나갔는지 결과에 싣는다).
function 대신틀기(db, 사유, role, order) {
  const 대신 = 로컬BGM고르기(db, { role, order })
  const 알림 = 대신.ok
    ? `${사유} 이번 방송은 「${대신.folderName}」 폴더 곡으로 대신 나갑니다. 예약·자동방송에서 BGM 을 다시 골라 주세요.`
    : `${사유} 대신 틀 「${역할찾기(role).이름}」 폴더도 쓸 수 없어 배경음악 없이 나갑니다. (${대신.사유})`
  try { require('./alert').raise('배경음악', 알림) } catch (e) { console.error('[배경음악] 경보 전달 실패:', e.message) }
  return 대신.ok ? { ...대신, 대체: true, 대체사유: 사유 } : 대신
}

/**
 * 곡 하나 — 사람이 **그 곡**을 골랐다. 재생목록에서 꺼 둔 곡이어도 튼다(끄기는 「폴더째 틀 때 빼기」다).
 * 「차례로」 자리를 밀지 않는다(곡 하나라 차례가 없다).
 */
function 곡하나고르기(db, fileId) {
  const id = 번호읽기(fileId)
  const f = id ? db.prepare("SELECT id, filename, original_name, folder_id FROM audio_files WHERE id = ? AND category = 'bgm'").get(id) : null
  if (!f || !f.filename) return { ok: false, 사유: '고른 배경음악 곡이 없어졌습니다.' }
  // 목록에는 있는데 파일이 없으면(지워졌거나 옮겨졌으면) 못 쓴다 — 폴더째와 달리 넘어갈 다음 곡이 없어
  // 그대로 내보내면 **무음인데 성공**으로 남는다(Codex 2026-09-22 High).
  const { audioFilePath } = require('../domain/audioPaths')
  if (!require('fs').existsSync(audioFilePath('bgm', f.filename))) {
    return { ok: false, 사유: `고른 배경음악 곡 「${f.original_name}」의 파일이 없습니다.` }
  }
  const 폴더 = f.folder_id ? db.prepare('SELECT name FROM content_folders WHERE id = ?').get(f.folder_id) : null
  const files = [{ url: `/audio/bgm/${f.filename}`, name: f.original_name }]
  return { ok: true, files, title: f.original_name, folderId: f.folder_id ?? null, folderName: 폴더?.name || '배경음악', order: 'random', 곡하나: true }
}

/** 고르개가 곡 하나를 고를 목록 — 배경음악 곡 전부(이름·폴더). 틀지 않고 읽기만 한다. */
function 곡목록(db) {
  return db.prepare("SELECT id, original_name AS name, folder_id FROM audio_files WHERE category = 'bgm' AND filename IS NOT NULL AND filename != '' ORDER BY original_name").all()
}

/**
 * 모든 BGM 폴더 — 고르개·업로드 화면이 **지금 이름**과 곡 수를 그리는 근거(2026-09-22).
 * 곡 수는 그 폴더 가지(하위 폴더 포함, 다른 용도 폴더의 가지는 뺌)의 켜진 곡이다 — 방송이 트는 것과 같은 셈.
 * 틀지 않고 세기만 한다.
 * @returns {{id:number, name:string, parent_id:number|null, role:string|null, count:number, offCount:number}[]}
 */
function 폴더목록(db) {
  const 폴더들 = db.prepare("SELECT id, name, parent_id FROM content_folders WHERE category = 'bgm' ORDER BY name").all()
  return 폴더들.map(f => {
    const 곡 = 가지곡(db, 가지(db, f.id))
    return {
      id: f.id, name: f.name, parent_id: f.parent_id ?? null, role: 폴더의용도(db, f.id),
      count: 곡.filter(x => x.active === 1).length, offCount: 곡.filter(x => x.active !== 1).length,
    }
  })
}

/**
 * 두 용도의 상태 — 화면이 「방송용 12곡」「비어 있음」「용도 밖 3곡(안 나감)」을 적는 근거.
 * **틀지 않고 세기만 한다**(차례 자리를 밀지 않는다).
 */
function 용도현황(db) {
  const 쓰는폴더 = new Set()
  const 용도 = 역할들.map(r => {
    const f = 역할폴더(db, r.role)
    const 곡 = f.ok ? 가지곡(db, 가지(db, f.folderId)) : []
    if (f.ok) for (const x of 가지(db, f.folderId)) 쓰는폴더.add(x)
    return {
      role: r.role, name: r.이름, order: 역할순서(db, r.role),
      count: 곡.filter(x => x.active === 1).length, offCount: 곡.filter(x => x.active !== 1).length,
      folderId: f.ok ? f.folderId : null, folderName: f.ok ? f.folderName : null, problem: f.ok ? null : f.사유,
    }
  })
  // 어느 방송에도 안 쓰여 **안 나가는** 곡 — 맨 위(폴더 없음)나, 어떤 예약·흐름·단계도 고르지 않은
  // 사람이 만든 폴더(2026-09-22: 사람이 만든 폴더도 고를 수 있게 되어 「용도 밖 = 안 나감」이 거짓이 됐다).
  try {
    const 쓰임 = require('../domain/broadcastScheduleRead').readBgmFolderUsage(db)
    for (const id of 쓰임.keys()) for (const x of 가지(db, id)) 쓰는폴더.add(x)
  } catch (e) { console.warn('[BGM 현황] 폴더 쓰임을 못 셌다(안 나가는 곡 수가 크게 나올 수 있다):', e.message) }
  const 밖 = db.prepare(`
    SELECT af.folder_id FROM audio_playlist ap JOIN audio_files af ON af.id = ap.audio_file_id
    WHERE ap.category = 'bgm' AND ap.active = 1`).all().filter(x => !쓰는폴더.has(x.folder_id)).length
  return { roles: 용도, outsideCount: 밖 }
}

/** 이 용도로 왜 못 트는지 — 사람에게 보일 한 줄(틀 수 있으면 null). 세기만 한다. */
function 용도사유(db, role) {
  const 현황 = 용도현황(db).roles.find(r => r.role === role)
  if (!현황) return `모르는 용도입니다: ${role}`
  if (현황.problem) return 현황.problem
  if (현황.count) return null
  return 현황.offCount
    ? `「${현황.folderName}」 폴더의 곡이 모두 꺼져 있습니다. 업로드 › 배경음악의 순서 편집에서 켜 주세요.`
    : `「${현황.folderName}」 폴더가 비어 있습니다. 업로드 › 배경음악에서 곡을 올리거나 옮겨 주세요.`
}

/**
 * 편집 화면 **미리듣기**용 한 곡 — 그 용도 폴더의 켜진 곡 중 아무거나.
 * **읽기만 한다**: 「차례로」 자리(차례키)를 밀지 않는다. 미리듣기가 방송 순서를 바꾸면 안 된다.
 * @returns {{ok:true, url:string, name:string, folderName:string}|{ok:false, 사유:string}}
 */
function 미리듣기곡(db, role, folderId = null) {
  // 사람이 만든 폴더(folderId)도 듣는다 — **대신 틀지 않는다**(비었으면 비었다고 답한다).
  if (folderId != null && folderId !== '') {
    const id = 번호읽기(folderId)
    const 폴더 = id ? db.prepare("SELECT id, name FROM content_folders WHERE id = ? AND category = 'bgm'").get(id) : null
    if (!폴더) return { ok: false, 사유: '고른 배경음악 폴더가 없습니다.' }
    const 전부 = 가지곡(db, 가지(db, 폴더.id))
    const 곡들 = 전부.filter(f => f.active === 1)
    if (!곡들.length) {
      return { ok: false, 사유: 전부.length
        ? `「${폴더.name}」 폴더의 곡이 모두 꺼져 있습니다. 업로드 › 배경음악의 순서 편집에서 켜 주세요.`
        : `「${폴더.name}」 폴더가 비어 있습니다. 업로드 › 배경음악에서 곡을 올려 주세요.` }
    }
    const f = 곡들[Math.floor(Math.random() * 곡들.length)]
    return { ok: true, url: `/audio/bgm/${f.filename}`, name: f.original_name, folderName: 폴더.name }
  }
  const 찾음 = 역할폴더(db, role || 'broadcast')
  if (!찾음.ok) return 찾음
  const 곡들 = 가지곡(db, 가지(db, 찾음.folderId)).filter(f => f.active === 1)
  if (!곡들.length) return { ok: false, 사유: 용도사유(db, role || 'broadcast') || '틀 곡이 없습니다.' }
  const f = 곡들[Math.floor(Math.random() * 곡들.length)]
  return { ok: true, url: `/audio/bgm/${f.filename}`, name: f.original_name, folderName: 찾음.folderName }
}

module.exports = { 로컬BGM고르기, 방송BGM고르기, 곡하나고르기, 곡목록, 폴더의용도, 폴더목록, 역할폴더, 역할순서, 용도현황, 용도사유, 미리듣기곡 }
