// 음원 파일 관리 라우트 + 기존 TTS 오디오 스토어 라우트
const { rawSetting, writeSetting } = require('../domain/settingsRead')
const express  = require('express')
const path     = require('path')
const fs       = require('fs')
const crypto   = require('crypto')
const multer   = require('multer')
const { getDB }        = require('../db/schema')
const { consumeAudio } = require('../services/audioStore')
const { deleteTmpFile, mimeOf } = require('../services/tts')
const { repairMojibake }      = require('../domain/text')
const { normalize: normalizeCues } = require('../domain/captions')
const nowPlaying = require('../services/nowPlaying')
const { fetchGeminiWithRetry } = require('../services/geminiClient')
const { primaryFileId, makePrimary } = require('../domain/categoryPick')
// 올린 파일이 진짜 무엇인가 — 이름이 아니라 내용으로 가른다(UX-06). 규칙은 그 모듈 한 곳이다.
const { 받아도되나, 머리크기: 파일머리크기 } = require('../domain/fileKind')
// 이 파일을 지금 쓰는 곳(예약·흐름·자동방송). 모으는 규칙은 그 모듈 한 곳이다(UX-29).
const { 쓰는곳 } = require('../domain/fileRefs')
// 올린 파일의 보이는 이름·저장 실패 안내의 단일 출처(UX-29).
const { 안겹치는이름, 업로드오류문구 } = require('../domain/uploadNames')
// 식사 안내 정본 표는 domain/graceText.js가 단일 출처다(2026-09-05). 예전엔 이 파일과
// scripts/caption-draft.cjs에 같은 표가 두 벌 있었다.
const { canonicalGraceText } = require('../domain/graceText')
// 받아쓰기 엔진과 자동 초안 대기열은 services/captionDraft.js가 맡는다(2026-09-05).
// 접수창구가 그 속(진행 상태·대기열)을 직접 만지지 않도록 창구 넷만 가져다 쓴다.
const {
  SPEECH_CATS, prefillGraceSubtitle, isTranscribing, transcribe, queueDraft, progressSnapshot,
  installStt,
} = require('../services/captionDraft')

const CATEGORIES   = ['bgm', 'morning-prayer', 'lunch-prayer', 'dinner-prayer', 'evening-prayer', 'staff', 'breakfast-grace', 'lunch-grace', 'dinner-grace', 'exercise', 'exercise-video', 'lunch-video', 'dinner-video', 'scene-video', 'misc', 'misc-audio', 'misc-video']
// 'misc'/'misc-audio'/'misc-video' — 방송 엔진(broadcastSequencer.js)이 절대 참조하지 않는
// pseudo-카테고리. 사용자가 자유롭게 만드는 폴더(content_folders)를 담는 용도 —
// misc=내 폴더 그룹 최상위, misc-audio/misc-video=오디오·영상 그룹 안에서 시스템
// 카테고리와 나란히 두는 사용자 폴더.
const VIDEO_CATS   = new Set(['exercise-video', 'lunch-video', 'dinner-video', 'scene-video', 'misc-video'])
// 실제 방송 트리거가 있는 영상 3종 — misc-video(순수 보관용)는 파일 형식 검증(VIDEO_CATS)은
// 같이 쓰되, 재생목록(활성 항목) 자동등록 대상에서는 제외한다.
// scene-video(배경 영상, 2026-09-21): 아침·점심·저녁 방송 뒤 소리 없이 띄우는 영상. 예전엔 외부 동영상 서비스에서
// 계절 자연 영상을 검색해 띄웠다 — 외부 연동을 걷어내며 이 PC 에 올린 영상으로 바꿨다(사용자 결정).
const SYSTEM_VIDEO_CATS = new Set(['exercise-video', 'lunch-video', 'dinner-video', 'scene-video'])
// 사람이 말하는 음원. 업로드하면 여기 것만 자동으로 받아쓴다.
// **bgm과 exercise는 뺀다** — 노래·체조 음악은 받아쓸 말이 없는데 CPU만 몇 분 문다.

const MAX_SIZE     = 500 * 1024 * 1024  // 500MB (동영상 포함)
// 음원 경로는 domain/audioPaths.js가 단일 출처다(2026-09-05). 예전엔 네 곳이 각자 계산했다.
const { audioCategoryDir, audioFilePath } = require('../domain/audioPaths')
// 재생시간을 받아 적는 규칙도 단일 출처다 — `routes/morning.js` 와 같은 것을 쓴다.
const { recordMeasuredDuration } = require('../domain/mediaDuration')

// multer 스토리지 — 카테고리 폴더에 타임스탬프+랜덤 파일명으로 저장
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const cat = CATEGORIES.includes(req.query.category) ? req.query.category : 'bgm'
    const dir = audioCategoryDir(cat)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase()
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
    cb(null, name)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const cat = CATEGORIES.includes(req.query.category) ? req.query.category : 'bgm'
    if (VIDEO_CATS.has(cat)) {
      if (['.mp4', '.webm', '.mov', '.avi'].includes(ext)) return cb(null, true)
      return cb(new Error('동영상 카테고리에는 MP4, WebM, MOV, AVI 파일만 업로드 가능합니다.'))
    }
    if (['.mp3', '.wav'].includes(ext)) return cb(null, true)
    cb(new Error('MP3, WAV 파일만 업로드 가능합니다.'))
  },
})

const router = express.Router()

// ── 음원 관리 라우트 ─────────────────────────────────────────────

// 카테고리별 음원 목록 조회.
// folder_id 쿼리파라미터를 안 보내면 기존과 동일하게 카테고리 전체(폴더 무관) 반환 —
// 방송 엔진 등 폴더 개념을 모르는 기존 호출부와의 하위호환용. folder_id를 보내면
// (빈 문자열='루트') 딱 그 폴더 레벨에 있는 파일만 반환(Finder처럼 한 단계씩 탐색).
// 파일이 디스크에서 차지하는 크기. **표에 두지 않고 그때그때 잰다**(2026-09-12).
//
// 왜 컬럼이 아닌가: 컬럼으로 두면 마이그레이션이 필요하고, 그 값이 실제 파일과 어긋날 길이
// 생긴다(사람이 폴더에서 지우거나 바꿔 넣는 경우). `statSync` 는 수백 개 목록에서도
// 눈에 안 띄고, **틀릴 수가 없다** — 없으면 없다고 말한다.
// 파일 이름이 빈 행(예전 링크 등록)은 로컬 파일이 없다.
function 파일크기(row) {
  if (!row || !row.filename) return null
  try { return fs.statSync(audioFilePath(row.category, row.filename)).size }
  catch { return null }   // 지워졌거나 못 읽는다 — **0 이라고 하지 않는다**
}

router.get('/', (req, res) => {
  const db  = getDB()
  const cat = req.query.category
  const hasFolderFilter = req.query.folder_id !== undefined
  const folderId = req.query.folder_id ? parseInt(req.query.folder_id) : null

  let rows
  if (cat && hasFolderFilter) {
    rows = folderId
      ? db.prepare('SELECT * FROM audio_files WHERE category = ? AND folder_id = ? ORDER BY uploaded_at DESC').all(cat, folderId)
      : db.prepare('SELECT * FROM audio_files WHERE category = ? AND folder_id IS NULL ORDER BY uploaded_at DESC').all(cat)
  } else if (cat) {
    rows = db.prepare('SELECT * FROM audio_files WHERE category = ? ORDER BY uploaded_at DESC').all(cat)
  } else {
    rows = db.prepare('SELECT * FROM audio_files ORDER BY category, uploaded_at DESC').all()
  }

  // 자막 상태만 한 글자 얹는다 — cues 본문은 안 싣는다(3분짜리가 10KB를 넘어서, 목록에
  // 섞으면 화면을 열 때마다 그 덩어리가 전부 따라온다). 카드에 "자막 있음/초안"을 띄우고,
  // 업로드 뒤 초안이 만들어졌는지 알려면 이 한 글자가 필요하다.
  try {
    const 상태 = new Map(db.prepare('SELECT audio_file_id, status FROM audio_subtitles').all()
      .map(r => [r.audio_file_id, r.status]))
    // **"지금 나가는 것"은 서버가 판정한다.** 화면이 다시 계산하면 규칙이 갈린다 — 실제로
    // 그랬다(화면은 "무작위"라 적고 목록은 최신순인데 실행부는 올린 순 첫 번째를 틀었다).
    const 나가는것 = new Map()
    for (const cat of new Set(rows.map(r => r.category))) {
      if (cat === 'bgm') continue     // BGM은 활성 항목을 전부 튼다 — "하나만 나감"이 아니다
      나가는것.set(cat, primaryFileId(db, cat))
    }
    rows = rows.map(r => ({
      ...r,
      subtitle_status: 상태.get(r.id) ?? null,
      is_primary: 나가는것.get(r.category) === r.id,
      size_bytes: 파일크기(r),
    }))
  } catch (e) {
    console.warn('[자막] 목록에 자막·재생 상태를 못 붙였습니다(목록은 정상):', e.message)
  }
  res.json(rows)
})

// ── 폴더(content_folders) 관리 ───────────────────────────────────
// parent_id 없으면(빈 문자열/미지정) 해당 category의 최상위 폴더 목록
router.get('/folders', (req, res) => {
  const db  = getDB()
  const cat = req.query.category
  if (!cat) return res.status(400).json({ error: 'category가 필요합니다.' })
  const parentId = req.query.parent_id ? parseInt(req.query.parent_id) : null
  const rows = parentId
    ? db.prepare('SELECT * FROM content_folders WHERE category = ? AND parent_id = ? ORDER BY name').all(cat, parentId)
    : db.prepare('SELECT * FROM content_folders WHERE category = ? AND parent_id IS NULL ORDER BY name').all(cat)
  res.json(rows)
})

// GET /api/audio/folders/usage — **자동순서가 무엇을 쓰고 있나** (2026-09-13, 설계 §4-C)
//
// 화면 둘이 읽는다:
//   · 업로드 목록 — 폴더·카테고리 옆의 「N곳에서 씀」
//   · 폴더 삭제 — 지우기 전에 "여기서 쓰고 있습니다"를 미리 보여 준다
//
// **판정은 서버가 한다.** 화면이 자기 나름대로 세면 삭제를 막는 근거와 보여 주는 숫자가
// 갈린다 — 그러면 "쓰는 데 없다는데 왜 안 지워지지"가 된다.
//
// ⚠ 이 라우트는 `/folders/:id` **보다 위**에 있어야 한다. 아래에 두면 Express 가
// `usage` 를 `:id` 로 읽어 `parseInt('usage') = NaN` 이 되고 늘 404 가 난다.
router.get('/folders/usage', (req, res) => {
  try {
    const { readSourceUsage } = require('../domain/broadcastScheduleRead')
    const { folders, files, categories } = readSourceUsage(getDB())
    const 펴기 = (m) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, v]))
    res.json({ folders: 펴기(folders), files: 펴기(files), categories: 펴기(categories) })
  } catch (err) {
    console.error('[audio/folders/usage]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// 폴더 생성 — category는 시스템 12종 또는 순수 사용자 폴더용 'misc'
router.post('/folders', (req, res) => {
  const { category, parent_id, name } = req.body
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: '올바르지 않은 카테고리입니다.' })
  const trimmed = name?.trim()
  if (!trimmed) return res.status(400).json({ error: '폴더 이름을 입력해주세요.' })

  const db = getDB()
  if (parent_id) {
    const parent = db.prepare('SELECT id FROM content_folders WHERE id = ? AND category = ?').get(parent_id, category)
    if (!parent) return res.status(400).json({ error: '상위 폴더를 찾을 수 없습니다.' })
  }
  const result = db.prepare(
    'INSERT INTO content_folders (category, parent_id, name, created_at) VALUES (?, ?, ?, ?)'
  ).run(category, parent_id || null, trimmed, new Date().toISOString())
  const folder = db.prepare('SELECT * FROM content_folders WHERE id = ?').get(result.lastInsertRowid)
  res.json(folder)
})

// 폴더 이름 변경 및/또는 이동(parent_id 변경). 둘 다 선택적이지만 최소 하나는 필요.
router.patch('/folders/:id', (req, res) => {
  const db = getDB()
  const id = parseInt(req.params.id)
  const folder = db.prepare('SELECT * FROM content_folders WHERE id = ?').get(id)
  if (!folder) return res.status(404).json({ error: '폴더를 찾을 수 없습니다.' })

  const hasName   = req.body.name !== undefined
  const hasParent = req.body.parent_id !== undefined
  if (!hasName && !hasParent) return res.status(400).json({ error: '변경할 내용이 없습니다.' })

  if (hasName) {
    const name = req.body.name?.trim()
    if (!name) return res.status(400).json({ error: '이름이 비어 있습니다.' })
    db.prepare('UPDATE content_folders SET name = ? WHERE id = ?').run(name, id)
  }

  if (hasParent) {
    const newParentId = req.body.parent_id ? parseInt(req.body.parent_id) : null
    if (newParentId === id) {
      return res.status(400).json({ error: '폴더를 자기 자신 안으로 이동할 수 없습니다.' })
    }
    if (newParentId) {
      const newParent = db.prepare('SELECT * FROM content_folders WHERE id = ?').get(newParentId)
      if (!newParent || newParent.category !== folder.category) {
        return res.status(400).json({ error: '대상 폴더를 찾을 수 없습니다.' })
      }
      // 자기 자신의 하위(자손)로는 이동 불가 — 대상 폴더에서 부모를 타고 올라가며 확인
      let cursor = newParent
      while (cursor) {
        if (cursor.id === id) {
          return res.status(400).json({ error: '폴더를 자기 자신의 하위 폴더로 이동할 수 없습니다.' })
        }
        cursor = cursor.parent_id ? db.prepare('SELECT * FROM content_folders WHERE id = ?').get(cursor.parent_id) : null
      }
    }
    db.prepare('UPDATE content_folders SET parent_id = ? WHERE id = ?').run(newParentId, id)
  }

  res.json({ ok: true })
})

// 폴더 삭제 — 비어있을 때만 (하위폴더도 파일도 없어야 함).
// 이 앱엔 휴지통이 없어서 잘못 지우면 되돌릴 방법이 없으므로 안전하게 막는다.
router.delete('/folders/:id', (req, res) => {
  const db = getDB()
  const id = parseInt(req.params.id)
  const folder = db.prepare('SELECT id FROM content_folders WHERE id = ?').get(id)
  if (!folder) return res.status(404).json({ error: '폴더를 찾을 수 없습니다.' })

  // ⓪ 배경음악 용도 폴더(방송용·식사용)는 **비었든 아니든** 지우지 않는다(2026-09-21). 방송이 이
  // 폴더를 번호로 찾는다(domain/bgmRoles.js) — 지우면 그 용도의 배경음악이 통째로 멈춘다. 이름은
  // 바꿔도 된다. **「비어 있나」보다 먼저 본다** — 뒤에 두면 곡이 든 용도 폴더에 「먼저 비워 주세요」라고
  // 해서, 비우면 지워질 것처럼 안내했다(Codex 3회차).
  {
    const { rawSetting } = require('../domain/settingsRead')
    const 용도 = require('../domain/bgmRoles').역할들.find(r => parseInt(rawSetting(db, r.폴더키) ?? '', 10) === id)
    if (용도) {
      return res.status(409).json({ error: `「${용도.이름}」은 방송이 쓰는 폴더라 지울 수 없습니다. 이름은 바꿀 수 있습니다.` })
    }
  }

  // ① 비어 있나 — **기존 규칙 그대로**(사용자 결정 2026-09-13: 이 규칙은 안 바꾼다).
  // 하위폴더 처리도 여기 그대로다. 이 검사가 먼저라, 통과한 폴더에는 자손이 없다 —
  // 그래서 아래 참조 검사는 **이 폴더 자신**만 보면 된다.
  const childFolders = db.prepare('SELECT COUNT(*) as c FROM content_folders WHERE parent_id = ?').get(id).c
  const childFiles   = db.prepare('SELECT COUNT(*) as c FROM audio_files WHERE folder_id = ?').get(id).c
  if (childFolders > 0 || childFiles > 0) {
    return res.status(400).json({ error: '폴더 안에 파일 또는 하위폴더가 있어 삭제할 수 없습니다. 먼저 비워주세요.' })
  }

  // ② 자동순서가 쓰고 있나 — **비어 있어도 막는다**(설계 §4-C).
  //
  // 빈 폴더라도 단계가 그것을 가리키고 있으면, 지우는 순간 그 단계는 **연결 오류**가 되어
  // 건너뛰어진다. 지금은 파일이 없어 어차피 안 나가지만, 나중에 파일을 채워 되살릴 자리를
  // 없애는 것이라 사람에게 먼저 알린다. **어디서 쓰는지 이름을 대고 말한다** — "쓰고 있어서
  // 못 지웁니다"만 나오면 사람이 어디를 고쳐야 할지 모른다.
  //
  // 화면만 막으면 API 로 우회되므로 서버가 판정한다. 409 는 "지금 상태와 충돌한다"는 뜻이다.
  try {
    const { readSourceUsage } = require('../domain/broadcastScheduleRead')
    const 쓰임 = readSourceUsage(db).folders.get(id) || []
    if (쓰임.length) {
      return res.status(409).json({
        error: '이 폴더를 자동순서에서 쓰고 있어 삭제할 수 없습니다. 먼저 그 단계의 연결을 바꾸거나 해제해 주세요.',
        usedBy: 쓰임,
      })
    }
  } catch (err) {
    // 참조 검사가 고장 났으면 **지우지 않는다.** 휴지통이 없어 되돌릴 방법이 없다 —
    // 확인 못 한 채 지우는 쪽보다 못 지우는 쪽이 낫다(fail-closed).
    console.error('[audio/folders DELETE] 참조 검사 실패:', err.message)
    return res.status(500).json({ error: '자동순서에서 쓰는지 확인하지 못해 삭제를 멈췄습니다.' })
  }

  // ③ 사람이 만든 BGM 폴더를 예약·흐름·자동방송이 고르고 있나(2026-09-22) — 지우면 그 방송은 대신 트는
  // 폴더로 나가고 경보가 매번 뜬다. ②와 같이 **어디서 쓰는지 이름을 댄다**, 확인 못 하면 지우지 않는다.
  try {
    const { readBgmFolderUsage } = require('../domain/broadcastScheduleRead')
    const 자리 = readBgmFolderUsage(db).get(id) || []
    if (자리.length) {
      return res.status(409).json({
        error: `이 BGM 폴더를 ${자리.length}곳에서 쓰고 있어 지울 수 없습니다: ${자리.join(', ')}. 그곳에서 다른 폴더로 바꾼 뒤 지워 주세요.`,
        bgmUsedBy: 자리,
      })
    }
  } catch (err) {
    console.error('[audio/folders DELETE] BGM 폴더 쓰임 검사 실패:', err.message)
    return res.status(500).json({ error: '예약·흐름에서 이 BGM 폴더를 쓰는지 확인하지 못해 삭제를 멈췄습니다.' })
  }

  db.prepare('DELETE FROM content_folders WHERE id = ?').run(id)
  res.json({ ok: true })
})

// 파일을 다른 폴더로 이동 (folder_id가 null이면 카테고리 최상위로 이동)
/**
 * 이 파일을 **이 폴더에 둬도 되나.** 두 자리(이동·업로드)가 같은 판정을 쓴다.
 *
 * 왜 한 곳에 두나(V③ R19 지적 5, 2026-09-14): **이동만 검사하고 있었다.**
 * 업로드는 받은 `folder_id` 를 그대로 `INSERT` 해서, 다른 카테고리의 실존
 * 폴더 번호를 보내면 **카테고리로 폴더를 훑는 목록에서 그 파일이 안 보이는 조합**이 만들어졌다.
 * 파일은 DB 에 있는데 화면 어디에도 안 나온다 — 오류도 안 난다.
 * 판정이 한 곳이면 새 등록 경로가 생겨도 같은 것을 쓴다.
 *
 * @returns {{ok:true}|{ok:false, 사유:string}}
 */
function 폴더에둬도되나(db, folderId, category) {
  if (!folderId) return { ok: true }   // 맨 위(폴더 없음)는 언제나 된다
  const folder = db.prepare('SELECT id FROM content_folders WHERE id = ? AND category = ?')
    .get(folderId, category)
  if (!folder) return { ok: false, 사유: '대상 폴더를 찾을 수 없습니다.' }
  return { ok: true }
}

router.post('/files/:id/move', (req, res) => {
  const db = getDB()
  const id = parseInt(req.params.id)
  const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)
  if (!file) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' })

  const folderId = req.body.folder_id ? parseInt(req.body.folder_id) : null
  const 판정 = 폴더에둬도되나(db, folderId, file.category)
  if (!판정.ok) return res.status(400).json({ error: 판정.사유 })
  db.prepare('UPDATE audio_files SET folder_id = ? WHERE id = ?').run(folderId, id)
  res.json({ ok: true })
})

// ── 음원 자막 ────────────────────────────────────────────────────
//
// 자막을 audio_files 목록에 얹지 않고 따로 받아 가게 한 이유는 부피다 — 3분짜리 녹음 문안
// 자막이 10KB를 넘어서, 목록에 섞으면 화면이 열릴 때마다 그 덩어리가 전부 따라온다.
// 재생하는 그 파일 것만 그때 받아 가면 된다.

// POST /api/audio/files/:id/duration — 화면이 잰 재생시간을 받아 적는다 (2026-09-12)
//
// 업로드 라우트는 `duration` 을 늘 0 으로 넣는다. 길이를 아는 것은 브라우저뿐이라
// 예전에는 **그 파일이 한 번 방송으로 나가야** 채워졌다(`routes/morning.js` 의 종료 보고).
// 그래서 올린 적은 있는데 튼 적은 없는 파일은 목록에서 길이가 영영 빈칸이었고,
// 흐름·시퀀서도 그 파일을 "모르는 길이"의 상한(180초)으로 기다렸다.
//
// 이제 관리 화면이 목록을 그리면서 조용히 재어 보낸다. **소리는 안 난다** —
// `preload='metadata'` 는 길이만 읽고 재생하지 않는다.
// 규칙(이미 값이 있으면 안 덮어쓴다)은 `domain/mediaDuration.js` 한 곳에 있다.
router.post('/files/:id/duration', (req, res) => {
  const 썼나 = recordMeasuredDuration(getDB(), req.params.id, req.body?.seconds)
  res.json({ ok: true, recorded: 썼나 })
})

// GET /api/audio/files/:id/subtitle — 없으면 200에 null (없는 것은 오류가 아니다)
router.get('/files/:id/subtitle', (req, res) => {
  // 고쳐 저장한 자막이 **다음 방송에 바로** 나가야 한다 — 어떤 층에서도 옛 응답을 쓰지 않게 한다
  // (2026-11-01 현장 보고: 오타를 고쳤는데 다음 예약에 옛 자막이 떴다).
  res.set('Cache-Control', 'no-store')
  const row = getDB().prepare('SELECT * FROM audio_subtitles WHERE audio_file_id = ?').get(parseInt(req.params.id))
  if (!row) return res.json({ subtitle: null })
  let cues
  try {
    cues = JSON.parse(row.cues)
  } catch (e) {
    // 저장할 때 검사를 통과한 것이라 여기까지 깨져 오면 사람 손이나 다른 도구가 건드린 것이다.
    console.error(`[자막] ${req.params.id}번 자막을 읽을 수 없습니다:`, e.message)
    return res.json({ subtitle: null })
  }
  res.json({ subtitle: { cues, source: row.source, status: row.status, updated_at: row.updated_at } })
})

// PUT /api/audio/files/:id/subtitle — { cues, source?, status? }
router.put('/files/:id/subtitle', (req, res) => {
  const db = getDB()
  const id = parseInt(req.params.id)
  const file = db.prepare('SELECT id FROM audio_files WHERE id = ?').get(id)
  if (!file) return res.status(404).json({ error: '음원을 찾을 수 없습니다.' })

  let cues
  try {
    cues = normalizeCues(req.body?.cues)
  } catch (e) {
    // 시간이 거꾸로 가거나 빈 자막은 화면에서 조용히 튄다 — 저장 단계에서 막는다.
    return res.status(400).json({ error: `자막을 저장할 수 없습니다: ${e.message}` })
  }

  const source = ['manual', 'stt', 'prefill'].includes(req.body?.source) ? req.body.source : 'manual'
  // **기본은 초안이다.** 받아쓰기·AI가 만든 것을 사람 확인 없이 방송에 내보내지 않는다.
  const status = req.body?.status === 'ready' ? 'ready' : 'draft'

  db.prepare(`INSERT INTO audio_subtitles (audio_file_id, cues, source, status, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(audio_file_id) DO UPDATE SET
                cues = excluded.cues, source = excluded.source,
                status = excluded.status, updated_at = excluded.updated_at`)
    .run(id, JSON.stringify(cues), source, status, new Date().toISOString())

  res.json({ ok: true, lines: cues.lines.length, status })
})

// DELETE /api/audio/files/:id/subtitle
router.delete('/files/:id/subtitle', (req, res) => {
  getDB().prepare('DELETE FROM audio_subtitles WHERE audio_file_id = ?').run(parseInt(req.params.id))
  res.json({ ok: true })
})

// POST /api/audio/files/:id/subtitle/transcribe — 받아쓰기 결과를 **저장하지 않고** 돌려준다.
// 편집기 칸을 채워 줄 뿐이고, 사람이 보고 고친 다음 저장한다.
router.post('/files/:id/subtitle/transcribe', async (req, res) => {
  const db = getDB()
  const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(parseInt(req.params.id))
  if (!file) return res.status(404).json({ error: '음원을 찾을 수 없습니다.' })
  if (!file.filename) return res.status(400).json({ error: '이 PC 에 파일이 없는 항목은 받아쓸 수 없습니다.' })
  if (nowPlaying.get().broadcast) {
    return res.status(409).json({ error: '방송이 나가는 중입니다. 방송이 끝난 뒤에 다시 눌러주세요.' })
  }
  if (isTranscribing()) return res.status(409).json({ error: '이미 다른 음원을 받아쓰는 중입니다. 잠시 뒤에 다시 눌러주세요.' })

  try {
    const r = await transcribe(db, file)
    res.json({ ...r, source: 'stt' })
  } catch (e) {
    // **무엇 때문에 실패했는지 화면이 알아볼 수 있게** 표식을 함께 준다(2026-09-15).
    // 문구 짝맞추기로 가르면 문구를 다듬는 날 조용히 끊긴다.
    res.status(400).json({ error: e.message, code: e.code || null })
  }
})

// POST /api/audio/subtitle/install-stt — 받아쓰기 프로그램을 이 PC에 설치한다.
//
// *"없으면 자동으로 다운받게 하면 안돼?"* (사용자 지시 2026-09-15)
// **서버가 뜰 때 자동으로는 안 한다** — 무거워서 부팅마다 하면 방송이 밀린다
// (이유는 `captionDraft.installStt` 머리말). 사람이 누를 때 한 번 돈다.
//
// **방송 중에는 막는다.** 설치가 CPU 를 몇 분간 잡아먹는다 — 받아쓰기를 막는 것과 같은 이유다.
router.post('/subtitle/install-stt', async (req, res) => {
  if (nowPlaying.get().broadcast) {
    return res.status(409).json({ error: '방송이 나가는 중입니다. 방송이 끝난 뒤에 눌러주세요.' })
  }
  if (isTranscribing()) {
    return res.status(409).json({ error: '받아쓰기가 도는 중입니다. 끝난 뒤에 눌러주세요.' })
  }
  try {
    const r = await installStt()
    res.json({
      ok: true,
      message: r.model
        ? '설치했습니다. 이제 「자동으로 만들기」를 다시 눌러 주세요.'
        : '설치했습니다. 다만 자막 모델은 아직 못 받았습니다 — 자막을 처음 만들 때 내려받습니다(약 460MB).',
    })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// POST /api/audio/files/:id/subtitle/polish — 받아쓴 글자를 AI로 다듬는다.
//
// 왜 필요한가: 받아쓰기는 시각을 잘 잡는데 글자를 종종 틀린다(실측에서 한 글자씩 바꿔 들음.
// 예: "정성스레"→"정성스래", "건강하게"→"건강아게"). 정본이 있는 음원은 그 문구를 쓰면 되지만,
// 안내 음원·직원 멘트처럼 정본이 없는 것은 받아쓴 글자가 그대로 자막이 된다.
//
// **시각은 손대지 않는다.** 줄 수가 하나라도 달라지면 타이밍이 통째로 어긋나므로, 같은 줄
// 수로 돌아오지 않으면 거절한다 — 조용히 밀린 자막이 가장 나쁜 결과다.
//
// **저장하지 않는다.** 편집기 칸을 고쳐 줄 뿐이고 사람이 확인하고 저장한다(검토 게이트).
// **어휘를 실제로 준다** (사용자 신고 2026-09-16: *"ai 써도 오탈자 못잡아내는 것 같은데"*).
//
// 앞 판은 「고유 어휘와 높임말이 많다」고 **말만 하고 낱말을 하나도 안 줬다.** 그러니
// AI 에게는 흔한 낱말로 잘못 적힌 시설 고유 낱말을 되돌릴 근거가 없다 — 둘 다 말이 되는 한국어다.
// 낱말 목록은 `domain/sttVocabulary` 한 곳이고, **받아쓰기도 같은 목록을 앞말로 받는다.**
// 갈리면 받아쓰기가 새로 틀리는 낱말을 다듬기가 못 고친다.
const POLISH_PROMPT = [
  '너는 한국어 음성 받아쓰기 결과의 오탈자를 고치는 교정기다.',
  '요양원 방송에 쓰는 안내 멘트라 높임말이 많고, 시설에 따라 종교 어휘가 섞일 수 있다.',
  '',
  require('../domain/sttVocabulary').다듬기안내(),
  '',
  '규칙:',
  '1. 잘못 들은 낱말만 고친다. 뜻을 바꾸거나 문장을 다시 쓰지 않는다.',
  '2. 띄어쓰기와 문장부호를 바로잡는다.',
  '3. **줄 수를 바꾸지 않는다.** 줄을 합치거나 나누지 않는다. 받은 줄 수와 같아야 한다.',
  '4. 고칠 것이 없는 줄은 그대로 둔다.',
  '5. 설명 없이 JSON 배열만 출력한다. 예: ["첫 줄", "둘째 줄"]',
].join('\n')

router.post('/files/:id/subtitle/polish', async (req, res) => {
  const 원본 = Array.isArray(req.body?.lines)
    ? req.body.lines.map((l) => String(l ?? '').trim()).filter(Boolean)
    : []
  if (!원본.length) return res.status(400).json({ error: '다듬을 문구가 없습니다.' })
  if (원본.length > 200) return res.status(400).json({ error: '줄이 너무 많습니다(200줄 넘음).' })

  const db = getDB()
  const apiKey = rawSetting(db, 'gemini_api_key')
  const model = require('../domain/geminiModel').currentGeminiModel(db)

  // ── 3단 폴백의 2·3차 (2026-09-06) ────────────────────────────────────
  //
  // 예전에는 키가 없으면 400, API 가 죽으면 502 로 끝났다. 그러면 사람이 편집기에서
  // **할 수 있는 일이 없다.** 이제는 원문을 그대로 돌려주고 어느 단계가 썼는지 밝힌다.
  // 3차가 "그대로"인 이유는 llmGateway.js 에 적었다 — 받아쓴 글자를 고칠 규칙이 없다.
  //
  // **줄 수는 어느 단계에서도 안 바뀐다.** AI 가 줄 수를 바꿔 오면 그 결과를 버린다.
  const { polishWithFallback, viaLabel } = require('../services/llmGateway')

  async function 제미나이로(원본줄) {
    // 직접 fetch하지 않는다 — 503 재시도와 타임아웃이 이 래퍼에 들어 있다(CLAUDE.md 규칙).
    const r = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(원본줄) }] }],
          systemInstruction: { parts: [{ text: POLISH_PROMPT }] },
          // temperature 0 — 교정이지 창작이 아니다.
          generationConfig: { maxOutputTokens: 4000, temperature: 0 },
        }),
      },
      // 기본 20초로는 모자란다 — 여러 줄을 한꺼번에 보고 고쳐야 해서 "생각" 토큰을 많이 쓴다
      // (실측: 6줄에 20초 초과). 사람이 버튼을 누르고 기다리는 자리이고 방송 경로가 아니라,
      // 그 자리에서 실패하는 것보다 조금 더 기다리는 편이 낫다.
      { timeoutMs: 60000 }
    )
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error?.message || `Gemini 오류 (${r.status})`)
    }
    const data = await r.json()
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
    // 모델이 코드펜스를 두르는 일이 잦다 — 벗겨 내고 배열만 읽는다.
    const 벗김 = text.replace(/```json|```/g, '').trim()
    try { return JSON.parse(벗김) } catch { throw new Error('AI 응답을 읽지 못했습니다.') }
  }

  const t0 = Date.now()
  const out = await polishWithFallback({
    lines: 원본,
    // 키가 없으면 2차를 아예 안 태운다 — 없는 키로 부르는 것은 시간만 쓴다
    callApi: apiKey ? 제미나이로 : null,
  })
  console.log(`[자막다듬기] ${viaLabel(out.via)}(${Date.now() - t0}ms)` + (out.reason ? ` — ${out.reason}` : ''))

  res.json({
    lines: out.lines,
    changed: out.lines.filter((l, i) => l !== 원본[i]).length,
    // **어느 단계가 썼는지 반드시 실어 보낸다.** 없으면 화면이 "고칠 곳이 없었습니다"로
    // 적는데, 그것은 AI 가 죽은 것과 정말 깨끗한 원고를 **같은 말로** 만든다.
    via: out.via, via_label: viaLabel(out.via), via_reason: out.reason,
  })
})

// GET /api/audio/subtitle/progress — 지금 받아쓰는 중인 것과 퍼센트.
// 편집기 진행 바와 목록의 "자막 만드는 중 45%" 뱃지가 이걸 1초마다 본다.
//
// 퍼센트는 **둘 중 큰 값**이다:
//  · 실제로 어디까지 들었는지(파이썬이 알려준다) — 정확하지만 **덩어리로 뛴다.**
//    실측: 32초 음원에서 15초 동안 0%였다가 80%로 한 번에 튀었다. 멈춘 것처럼 보인다.
//  · 걸린 시간으로 friendly 추정 — 부드럽지만 어림이다.
// 큰 쪽을 쓰면 막대가 꾸준히 움직이면서, 진짜 값이 앞서면 그쪽으로 따라붙는다.
// 뒤로는 안 간다(둘 다 시간이 갈수록 커진다). 95%에서 멈춰 기다리는 것은 정상이다 —
// 다 끝나면 화면이 결과로 바뀐다.

router.get('/subtitle/progress', (req, res) => {
  res.json(progressSnapshot())
})

// GET /api/audio/files/:id/subtitle/default-text — 이 카테고리의 정본 문구(없으면 null)
router.get('/files/:id/subtitle/default-text', (req, res) => {
  const db = getDB()
  const file = db.prepare('SELECT category FROM audio_files WHERE id = ?').get(parseInt(req.params.id))
  if (!file) return res.status(404).json({ error: '음원을 찾을 수 없습니다.' })
  res.json({ text: canonicalGraceText(db, file.category) })
})

// POST /api/audio/files/:id/make-primary — 이 파일이 그 자리에서 나가게 만든다.
//
// 예전엔 녹음 음원 자리에 파일이 둘이면 **먼저 올린 것만** 나가고 바꿀 방법이 삭제뿐이었다
// (`ORDER BY id`의 첫 번째). 사람이 새 녹음을 올려 바꾼 줄 알았는데 예전 것이 계속 나갔다.
// 이제 재생목록 순서가 이기고, 이 라우트가 그 순서를 바꾼다.
router.post('/files/:id/make-primary', (req, res) => {
  const db = getDB()
  const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(parseInt(req.params.id))
  if (!file) return res.status(404).json({ error: '음원을 찾을 수 없습니다.' })
  if (file.category === 'bgm') {
    // BGM은 활성 항목을 전부 순서대로 튼다 — "하나만 나감"이 성립하지 않는다.
    return res.status(400).json({ error: 'BGM은 목록 전체가 순서대로 나갑니다. 순서 편집을 쓰세요.' })
  }
  const n = makePrimary(db, file.category, file.id)
  res.json({ ok: true, category: file.category, total: n })
})

// 음원 업로드 (POST /api/audio/upload?category=bgm)
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '파일 크기는 500MB를 초과할 수 없습니다.' })
    }
    if (err) {
      // **원문을 그대로 내보내지 않는다.** `ENOSPC: no space left on device, write` 는
      // 현장 직원에게 아무 뜻이 없다 — 무엇이 문제이고 다음에 뭘 하면 되는지로 바꾼다
      // (UX-29·UX-10). 모르는 오류는 지어내지 않고 원문을 그대로 준다.
      const 안내 = 업로드오류문구(err)
      if (안내) {
        // 반쯤 쓰다 만 파일이 남는다 — 안 지우면 DB 에 없는 파일이 폴더에 쌓인다.
        if (req.file?.path) { try { fs.unlinkSync(req.file.path) } catch { /* 이미 없으면 그만 */ } }
        return res.status(507).json({ error: 안내 })
      }
      return res.status(400).json({ error: err.message })
    }
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' })

    const db  = getDB()
    const cat = CATEGORIES.includes(req.query.category) ? req.query.category : 'bgm'
    const folderId = req.query.folder_id ? parseInt(req.query.folder_id) : null

    // **이동과 같은 검사를 여기서도 한다**(V③ R19 지적 5). 예전엔 받은 폴더 번호를 그대로
    // 넣어서, 다른 카테고리의 실존 폴더를 주면 **목록 어디에도 안 보이는 파일**이 됐다.
    // 파일이 이미 디스크에 있는 시점이라 **지우고** 400 을 준다 — 아래 내용 검사와 같은 규칙이다.
    const 폴더판정 = 폴더에둬도되나(db, folderId, cat)
    if (!폴더판정.ok) {
      try { fs.unlinkSync(req.file.path) } catch { /* 이미 없으면 그만이다 */ }
      return res.status(400).json({ error: 폴더판정.사유 })
    }

    // 출처·이용 조건(2026-09-21 사용자 지시). 배경음악은 없으면 못 올린다 — 분쟁 때 「어디서
    // 받았나」에 답할 기록이 없는 음원을 방송에 쓰지 않게. 폴더 검사와 같이 **지우고** 400.
    // 글자 칸은 multer 가 req.body 로 준다(화면이 파일보다 먼저 붙여 보낸다).
    const { 출처읽기, 출처가필수인가 } = require('../domain/audioSource')
    const 출처 = 출처읽기(req.body, { 필수: 출처가필수인가(cat) })
    if (!출처.ok) {
      try { fs.unlinkSync(req.file.path) } catch { /* 이미 없으면 그만이다 */ }
      return res.status(400).json({ error: 출처.사유 })
    }

    // **이름이 아니라 내용으로 가른다**(UX-06, 2026-09-11).
    //
    // `fileFilter` 는 확장자만 본다. 확장자는 사람이 붙이는 이름표라 틀릴 수 있고, 틀리면
    // **조용히 지나간다** — `노래.mp3` 라는 이름의 영상 파일이 음원 칸에 들어앉으면
    // 업로드할 때는 아무 말이 없고 **방송 시각에 소리가 안 난다.**
    //
    // 파일이 이미 디스크에 있는 시점이라, 안 맞으면 **지우고** 400 을 준다 —
    // 안 지우면 DB 에 없는 파일이 폴더에 쌓인다.
    try {
      const fd = fs.openSync(req.file.path, 'r')
      const 머리 = Buffer.alloc(파일머리크기)
      try { fs.readSync(fd, 머리, 0, 파일머리크기, 0) } finally { fs.closeSync(fd) }
      const 판정 = 받아도되나(VIDEO_CATS.has(cat) ? 'video' : 'audio', 머리)
      if (!판정.ok) {
        try { fs.unlinkSync(req.file.path) } catch { /* 이미 없으면 그만이다 */ }
        return res.status(400).json({ error: 판정.이유 })
      }
    } catch (e) {
      // **읽기 실패를 통과로 바꾸지 않는다.** 못 읽은 파일은 재생도 못 한다.
      try { fs.unlinkSync(req.file.path) } catch { /* 위와 같다 */ }
      return res.status(400).json({ error: `올린 파일을 읽지 못했습니다: ${e.message}` })
    }

    // multer(busboy)는 파일 이름을 Latin-1로 읽어서 준다 — UTF-8로 되돌린다.
    // 판정 규칙은 domain/text.js 한 곳에 있다(예전엔 여기서 "가-힣이 보이면"으로 봤고,
    // 그 바람에 맥·아이폰이 보낸 자모 분리 이름과 일본어·악센트 라틴이 깨진 채 저장됐다).
    const originalName = repairMojibake(req.file.originalname)

    // **같은 이름이 두 개면 사람이 구별할 수 없다**(UX-29). 디스크 파일명은 타임스탬프+랜덤이라
    // 부딪히지 않지만 목록에 보이는 이름은 똑같아진다 — 녹음 음원 자리처럼 카테고리로 고르는
    // 단계에서는 "먼저 올린 것만 나가는" 상태가 된다(`make-primary` 를 따로 만든 이유).
    // **막지 않고 이름을 바꿔 준다** — 거절하면 현장에서는 그냥 포기로 이어진다.
    const 같은자리 = db.prepare(
      `SELECT original_name FROM audio_files
        WHERE category = ? AND (folder_id IS ? OR folder_id = ?)`).all(cat, folderId, folderId)
    const 정한이름 = 안겹치는이름(originalName, 같은자리.map(r => r.original_name))

    const result = db.prepare(
      `INSERT INTO audio_files (category, filename, original_name, duration, uploaded_at, folder_id,
                                source_name, source_url, license_note) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).run(cat, req.file.filename, 정한이름.이름, new Date().toISOString(), folderId,
          출처.값.source_name, 출처.값.source_url, 출처.값.license_note)

    // 식사 안내 녹음이면 정해진 문구를 먼저 깔아 둔다(글자만, 타이밍은 어림).
    prefillGraceSubtitle(db, result.lastInsertRowid, cat)
    // 말소리 음원이면 받아쓰기로 타이밍까지 채운 초안을 뒤이어 만든다.
    // 응답을 붙잡지 않는다 — 업로드는 바로 끝나고, 초안은 뒤에서 만들어진다.
    if (SPEECH_CATS.has(cat)) queueDraft(result.lastInsertRowid)

    // BGM/영상 카테고리 업로드 시 재생목록에 자동 추가 (재생목록 = "실제 방송에 쓰이는 항목" 관리용)
    if (cat === 'bgm' || SYSTEM_VIDEO_CATS.has(cat)) {
      const maxOrder = db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) as m FROM audio_playlist WHERE category = ?'
      ).get(cat)?.m ?? -1
      db.prepare(
        'INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES (?, ?, ?, 1)'
      ).run(cat, result.lastInsertRowid, maxOrder + 1)
    }

    const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(result.lastInsertRowid)
    // 이름을 바꿨으면 **말해 준다.** 조용히 바꾸면 사람이 올린 이름을 목록에서 찾다 못 찾는다.
    res.json(정한이름.바뀜 ? { ...file, renamedFrom: originalName } : file)
  })
})

// 재생목록 조회 (명시적 경로 — /:id 보다 먼저 정의해야 함)
router.get('/playlist', (req, res) => {
  const db  = getDB()
  const cat = req.query.category || 'bgm'
  const rows = db.prepare(`
    SELECT ap.id as playlist_id, ap.sort_order, ap.active,
           af.id as audio_file_id, af.category, af.filename, af.original_name, af.duration
    FROM audio_playlist ap
    JOIN audio_files af ON af.id = ap.audio_file_id
    WHERE ap.category = ?
    ORDER BY ap.sort_order
  `).all(cat)
  res.json(rows)
})

// 재생목록 순서 저장
router.post('/playlist', (req, res) => {
  const db   = getDB()
  const { category = 'bgm', items } = req.body
  if (!Array.isArray(items)) return res.status(400).json({ error: '잘못된 형식' })

  // 기존 목록 삭제 후 재삽입
  db.prepare('DELETE FROM audio_playlist WHERE category = ?').run(category)
  const ins = db.prepare(
    'INSERT INTO audio_playlist (category, audio_file_id, sort_order, active) VALUES (?, ?, ?, ?)'
  )
  items.forEach((item, i) => ins.run(category, item.audio_file_id, i, item.active ?? 1))
  res.json({ ok: true })
})

// 랜덤 음원 선택 — 직전 재생과 다른 파일 우선 (직원멘트용)
router.get('/random', (req, res) => {
  const db  = getDB()
  const cat = req.query.category || 'staff'
  const all = db.prepare('SELECT * FROM audio_files WHERE category = ?').all(cat)
  if (all.length === 0) return res.json(null)

  const lastId   = rawSetting(db, `last_played_${cat}`)
  const pool     = all.length > 1 ? all.filter(f => String(f.id) !== lastId) : all
  const picked   = pool[Math.floor(Math.random() * pool.length)]

  // 설정 쓰기는 writeSetting 한 통로로만 간다 (P-21). 이 키는 기계 흔적이라
  // settingsHistory 가 걸러 기록은 안 남는다 — 통로만 하나로 맞추는 것이다.
  writeSetting(db, `last_played_${cat}`, String(picked.id), '자동')

  res.json({ ...picked, url: `/audio/${cat}/${picked.filename}` })
})

// BGM/식사 안내 시간 설정 조회
router.get('/schedule', (req, res) => {
  const db  = getDB()
  const get = (k, d) => rawSetting(db, k) ?? d

  const build = (meal, defStart, defEnd) => ({
    start:         get(`bgm_${meal}_start`,          defStart),
    end:           get(`bgm_${meal}_end`,            defEnd),
    enabled:       get(`bgm_${meal}_enabled`,        'false') === 'true',
    prayerEnabled: get(`bgm_${meal}_prayer_enabled`, 'false') === 'true',
    prayerOffset:  parseInt(get(`bgm_${meal}_prayer_offset`, '5')),
    prayerFileId:  get(`bgm_${meal}_prayer_file_id`, ''),
  })

  res.json({
    morning: build('morning', '07:00', '08:30'),
    lunch:   build('lunch',   '11:50', '12:40'),
    dinner:  build('dinner',  '17:50', '18:40'),
  })
})

// BGM/식사 안내 시간 설정 저장
router.post('/schedule', (req, res) => {
  const db = getDB()
  // 설정 쓰기는 writeSetting 한 통로로만 간다 (P-21).
  // 예전엔 여기서 upsert SQL 을 직접 썼다 — 결과는 같지만 `settings_history` 에
  // **이 6개 키만 변경 기록이 안 남았다.** `settingsRead.js:90-92` 가 "여기가 설정 쓰기의
  // 단일 통로다"라고 못박아 뒀는데 그 예외인 줄 아무도 몰랐다(빠져도 아무 데도 안 걸린다).
  const upsert = (k, v) => writeSetting(db, k, v == null ? '' : String(v))

  for (const [meal, cfg] of Object.entries(req.body)) {
    if (!cfg || !['morning', 'lunch', 'dinner'].includes(meal)) continue
    if (cfg.start         != null) upsert(`bgm_${meal}_start`,          cfg.start)
    if (cfg.end           != null) upsert(`bgm_${meal}_end`,            cfg.end)
    if (cfg.enabled       != null) upsert(`bgm_${meal}_enabled`,        String(cfg.enabled))
    if (cfg.prayerEnabled != null) upsert(`bgm_${meal}_prayer_enabled`, String(cfg.prayerEnabled))
    if (cfg.prayerOffset  != null) upsert(`bgm_${meal}_prayer_offset`,  String(cfg.prayerOffset))
    if (cfg.prayerFileId  != null) upsert(`bgm_${meal}_prayer_file_id`, String(cfg.prayerFileId))
  }
  res.json({ ok: true })
})

// 음원 이름·출처 변경 (PATCH /api/audio/:id)
// 이름만 보내는 기존 호출은 그대로 돈다. 출처 칸(source_name·source_url·license_note)을
// 하나라도 보내면 **셋을 한 묶음으로** 다시 읽는다 — 보낸 것은 새 값, 안 보낸 것은 지금 값.
// 배경음악은 올릴 때처럼 출처·이용 조건을 비울 수 없다(고치기로 우회하지 못하게).
const 출처칸 = ['source_name', 'source_url', 'license_note']
router.patch('/:id', (req, res) => {
  const db   = getDB()
  const id   = parseInt(req.params.id)
  const body = req.body || {}
  const 이름보냄 = Object.prototype.hasOwnProperty.call(body, 'original_name')
  const 출처보냄 = 출처칸.some(k => Object.prototype.hasOwnProperty.call(body, k))
  if (!이름보냄 && !출처보냄) return res.status(400).json({ error: '바꿀 내용이 없습니다.' })

  const name = 이름보냄 ? String(body.original_name ?? '').trim() : null
  if (이름보냄 && !name) return res.status(400).json({ error: '이름이 비어 있습니다.' })
  const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)
  if (!file) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' })

  let 출처 = null
  if (출처보냄) {
    const { 출처읽기, 출처가필수인가 } = require('../domain/audioSource')
    const 합친값 = Object.fromEntries(출처칸.map(k => [k, Object.prototype.hasOwnProperty.call(body, k) ? body[k] : file[k]]))
    출처 = 출처읽기(합친값, { 필수: 출처가필수인가(file.category) })
    if (!출처.ok) return res.status(400).json({ error: 출처.사유 })
  }

  if (이름보냄) db.prepare('UPDATE audio_files SET original_name = ? WHERE id = ?').run(name, id)
  if (출처) {
    db.prepare('UPDATE audio_files SET source_name = ?, source_url = ?, license_note = ? WHERE id = ?')
      .run(출처.값.source_name, 출처.값.source_url, 출처.값.license_note, id)
  }
  res.json({ ok: true })
})

// 음원 삭제
router.delete('/:id', (req, res) => {
  const db   = getDB()
  const id   = parseInt(req.params.id)
  const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)
  if (!file) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' })

  // **쓰고 있는 파일은 안 지운다**(UX-29, 2026-09-11). 예약이 쓰는 음원을 지우면 그 시각에
  // **홀이 조용하다** — 지운 사람은 그 사실을 모르고, 며칠 뒤 "그 방송 왜 안 나와요" 로 온다.
  // 되돌릴 수 없는 일이라, 어디서 쓰는지 말해 주고 막는다. 그 예약을 먼저 고치면 지워진다.
  const 쓰는데 = 쓰는곳(db, id)
  if (쓰는데.length > 0) {
    return res.status(409).json({
      error: `지금 쓰고 있어서 지울 수 없습니다 — ${쓰는데.join(' · ')}. 먼저 그쪽에서 다른 파일로 바꾸거나 빼 주세요.`,
      usedBy: 쓰는데,
    })
  }

  if (file.filename) {
    const filePath = audioFilePath(file.category, file.filename)
    try { fs.unlinkSync(filePath) } catch { /* 파일이 이미 없어도 DB 행 삭제는 계속돼야 한다 — 지워진 파일이 목록에 남는 쪽이 더 나쁘다 */ }
  }

  db.prepare('DELETE FROM audio_files WHERE id = ?').run(id)
  // 자막도 같이 지운다. node:sqlite는 외래키가 기본으로 꺼져 있어 ON DELETE CASCADE가 안 걸린다 —
  // 안 지우면 나중에 같은 id가 새 파일에 붙었을 때 **엉뚱한 자막이 딸려 나온다.**
  db.prepare('DELETE FROM audio_subtitles WHERE audio_file_id = ?').run(id)
  res.json({ ok: true })
})

// ── 폴더(카테고리)별 메모 ────────────────────────────────────────

// GET /api/audio/categories/:category/note
router.get('/categories/:category/note', (req, res) => {
  const db  = getDB()
  const row = db.prepare('SELECT note, updated_at FROM category_notes WHERE category = ?').get(req.params.category)
  res.json({ note: row?.note ?? '', updated_at: row?.updated_at ?? null })
})

// PUT /api/audio/categories/:category/note — upsert
router.put('/categories/:category/note', (req, res) => {
  const db = getDB()
  db.prepare(`
    INSERT INTO category_notes (category, note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run(req.params.category, req.body.note ?? '', new Date().toISOString())
  res.json({ ok: true })
})

// ── 오디오 출력 장치 목록 ─────────────────────────────────────

// GET /api/audio/devices — 현재 PC의 waveOut 출력 장치 목록 조회
// 관리자가 "장치 목록 불러오기" 버튼을 클릭할 때 호출
router.get('/devices', async (req, res) => {
  try {
    const { listWaveOutDevices, clearDeviceCache } = require('../services/audioDevices')
    // 항상 최신 목록 조회 (캐시 무효화 후 재조회)
    clearDeviceCache()
    const devices = await listWaveOutDevices(true)
    res.json(devices)
  } catch (err) {
    console.error('[audio/devices]', err.message)
    res.status(500).json({ error: '오디오 장치 목록 조회 실패: ' + err.message })
  }
})

// ── 볼륨 설정 ─────────────────────────────────────────────────

// GET /api/audio/volume
router.get('/volume', (req, res) => {
  try {
    const { readVolumes } = require('../domain/volume')
    const vols = readVolumes(getDB())
    res.json({
      ...vols,
      // 하위호환 — 옛 클라이언트가 아직 broadcast 필드를 읽는다. 안내 음성과 같은 값이다.
      broadcast: vols.tts,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/audio/volume — DB 저장 + 실제 PC 볼륨 적용
router.post('/volume', async (req, res) => {
  const { master, tts, audio, media, bgm, broadcast } = req.body
  try {
    const { writeVolumes, invalidVolumeValue } = require('../domain/volume')
    // 범위 밖·숫자가 아닌 값은 조용히 자르지 않고 되묻는다 — 예약 저장(POST /api/schedules)과
    // 같은 규칙이다. 같은 값을 어디로 넣느냐에 따라 답이 다르면 사람은 둘 중 하나를 잘못 기억한다.
    // 슬라이더로는 나올 수 없는 값이라, 여기 걸리는 것은 잘못 만든 요청뿐이다.
    for (const [name, value] of Object.entries({ master, tts, audio, media, bgm, broadcast })) {
      if (invalidVolumeValue(value)) {
        return res.status(400).json({ error: `${name} 볼륨은 0~100 사이 숫자여야 합니다.` })
      }
    }
    // 정규 키와 옛 별칭을 함께 갱신하는 일은 writeVolumes가 맡는다 — 여기서 미러링을
    // 손으로 적던 시절엔 경로마다 미러 대상이 달라서 값이 갈라졌다.
    // broadcast는 옛 이름이고 안내 음성과 같은 채널이라 tts로 접어 넣는다.
    const applied = writeVolumes(getDB(), {
      master, audio, media, bgm,
      tts: tts != null ? tts : broadcast,
    })

    // 마스터 → 실제 Windows 볼륨 적용 (비동기, 실패해도 응답은 반환)
    if (master != null) {
      const { setSystemVolume } = require('../services/volumeControl')
      setSystemVolume(master).catch(e => console.warn('[volume/master]', e.message))
    }

    // 볼륨 변경 SSE 브로드캐스트 — 다른 PC에서도 실시간 동기화.
    // 이 요청에 실려온 필드만 보낸다(DB 전체를 다시 읽어 항상 5개 다 채워 보내면, 프리셋
    // 적용 시 master만 먼저 보내고 200ms 뒤 나머지를 debounce로 보내는 클라이언트 흐름에서
    // 첫 방송이 "아직 저장 안 된" 예전 tts/audio/media/bgm 값을 실어 보내 방금 바꾼 값을
    // 덮어써버리는 문제가 있었다. 받는 쪽(MusicPlayer.jsx/VolumePanel.jsx)은 이미 필드별
    // undefined 체크로 부분 업데이트를 지원하니, 여기서도 실제로 바뀐 필드만 보내면 된다.
    try {
      const { broadcastSSE } = require('../services/sse')
      // applied에는 이번에 실제로 저장된 채널만 들어 있다 — 0~100 보정까지 끝난 값이라
      // 여기서 다시 parseInt 할 필요가 없고, 화면이 받는 값과 DB 값이 어긋날 여지도 없다.
      broadcastSSE('volume_change', applied)
    } catch { /* SSE 통지 실패로 볼륨 저장 자체를 되돌리지 않는다 — 화면은 다음 갱신 때 맞춰진다 */ }

    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 수동 BGM 제어 ────────────────────────────────────────────────

// POST /api/audio/bgm/start — 배경음악 즉시 재생 (bgm_start SSE 발신)
// 본문 { role?: 'broadcast'|'meal', folderId?, order?: 'random'|'seq' } (2026-09-21).
// 예전엔 bgm 재생목록 **전체**를 보냈다. 이제 용도(또는 지정) 폴더의 곡만, 고른 순서로 보낸다.
// 아무것도 안 보내는 옛 호출은 식사용·그 용도의 기본 순서로 읽는다 — 예전 동작(로컬 배경음악은
// 식사 시간 음악이었다)과 가장 가깝다.
router.post('/bgm/start', (req, res) => {
  const db = getDB()
  try {
    const { broadcastSSE } = require('../services/sse')
    const { role, folderId, order } = req.body || {}
    const 고른것 = require('../services/localBgm').로컬BGM고르기(db, { role: role || 'meal', folderId, order })
    if (!고른것.ok) return res.status(400).json({ error: 고른것.사유 })
    const playlist = 고른것.files
    const bgmDefault = require('../domain/volume').readVolume(db, 'bgm')
    const { randomBytes } = require('crypto')
    const eventId = randomBytes(4).toString('hex')
    // 요청 출처 감지 — 현장 PC(localhost)냐 원격 PC냐에 따라 재생 대상 결정
    const rawIp = req.ip || req.socket?.remoteAddress || ''
    const origin = (rawIp === '127.0.0.1' || rawIp === '::1' || rawIp === '::ffff:127.0.0.1') ? 'local' : 'remote'
    broadcastSSE('bgm_start', {
      files:       playlist,       // 이미 {url, name} — 고른 폴더의 곡을 고른 순서로
      durationMin: 0,
      durationSec: 0,
      bgmDefault,
      eventId,
      origin,
    })
    res.json({ ok: true, folderName: 고른것.folderName, order: 고른것.order, title: 고른것.title, count: playlist.length })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/**
 * POST /api/audio/bgm/now — **배경음악을 지금 내보낸다. 예약 행을 안 만든다.**
 *
 * (2026-09-21 외부 동영상 연동을 걷어낼 때 예전 자리에서 이리 옮겼다 — 홈 「배경음방송」이 쓰는 길이라, 옛 파일을
 * 지우기 전에 먼저 옮겨야 기능이 안 끊긴다. 동작은 그대로다.)
 *
 * ── 왜 생겼나 (사용자 결정 2026-09-15) ──────────────────────────────────────
 * 그전까지 「배경음악」을 **지금** 내보내려면 화면이 `createSchedule` 로 **예약을 하나
 * 만들고** `triggerSchedule` 로 그것을 실행했다. 그 행은 「지금 시각 · 반복 없음 · 꺼짐」이라
 * 다시 울리지는 않지만 **지워지지도 않아** 즉시 방송을 쓸 때마다 달력에 흐린 줄이 쌓였다.
 * 사용자가 정한 규칙: **「즉시는 휘발성, 업로드는 영구」**(`docs/journal/decisions.md`).
 *
 * ── 스케줄러와 **같은 것**을 한다 ───────────────────────────────────────────
 * 푸는 것도(`resolveBGM`), 쏘는 것도(`bgmEmit`) 예약 경로와 똑같다. 다른 것은 **예약 행이
 * 없다**는 것뿐이다. 두 길이 다른 신호를 쏘면 화면이 둘을 다르게 재생한다.
 *
 * ── 이력은 남긴다 ──────────────────────────────────────────────────────────
 * 행을 안 남기는 것과 **무엇이 나갔는지 모르는 것은 다른 일이다.** **소리를 낼 창이 없으면
 * 성공으로 안 적는다** — 2026-09-14 저녁 마무리 방송 사고의 규칙 그대로다.
 */
router.post('/bgm/now', async (req, res) => {
  const db = getDB()
  const { 시작기록, 실패로정정, 사유 } = require('../domain/broadcastRecord')
  const b = req.body || {}
  const 제목 = String(b.bgm_title || '').trim() || '배경음악'

  const 이력id = 시작기록(db, { type: 'BGM', content: 제목, user: b.user || '수동' })
  try {
    const { resolveBGM } = require('../services/broadcastConfig')
    // `bgm_enabled: 1` 을 강제하는 것은 스케줄러의 `bgm` 갈래와 같다 — 이 길은 BGM 이
    // 곧 방송이라 「켰나」를 따로 물을 것이 없다.
    const 풀림 = await resolveBGM(db, {
      bgm_enabled: 1,
      bgm_type:   b.bgm_type,
      bgm_value:  b.bgm_value,
      bgm_title:  b.bgm_title,
      bgm_volume: b.bgm_volume,
    })
    if (!풀림) {
      // 인자 순서는 `(db, id, 로그용 메모, 이력에 남을 사유 코드)` 다.
      // **원본 메시지는 로그에만** 간다 — 이력에는 코드만 들어간다(0026 사용자 지시).
      실패로정정(db, 이력id, '배경음악을 찾지 못했다', 사유.기타)
      // 이 PC 음원(방송용·식사용)이면 **진짜 이유**를 준다(QA 재현).
      const 로컬 = require('../services/broadcastConfig').로컬용도(b.bgm_type)
      // 사람이 만든 폴더면 여기 오는 것은 **대신 틀 방송용까지 못 쓸 때**다 — 그 이유를 준다.
      const 폴더 = require('../domain/bgmRoles').폴더값(b.bgm_type) || require('../domain/bgmRoles').곡값(b.bgm_type)
      const { 용도사유 } = require('../services/localBgm')
      const 로컬사유 = 폴더
        ? `고른 폴더도, 대신 틀 방송용 BGM 도 쓸 수 없습니다. ${용도사유(db, 'broadcast') || ''}`.trim()
        : 로컬 ? 용도사유(db, 로컬.role) : null
      return res.status(400).json({ error: 로컬사유 || '배경음악을 찾지 못했습니다. 고른 음악을 확인해 주세요.' })
    }

    require('../services/bgmEmit').emitBGM(풀림, {
      // ── **얼마나 틀지 화면이 정할 수 있다** (사용자 지적 2026-09-15) ──────────
      // **0 은 「무제한」이다**(화면이 그렇게 적는다). 멈추는 일은 화면이 한다
      // (`useScheduledBroadcast` 의 `durationSec` 타이머) — 서버가 타이머를 들면 서버가 죽었을 때
      // 음악이 영영 안 꺼진다.
      durationSec: Math.max(0, Number(b.duration_sec) || 0),
    })

    const { hasSitePlayer, 소리낼수있나 } = require('../services/sitePlayer')
    const 들렸나 = hasSitePlayer() && 소리낼수있나()
    if (!들렸나) 실패로정정(db, 이력id, '소리를 낼 창이 없었다', 사유.화면없음)
    res.json({ ok: true, title: 풀림.bgmTitle, 들렸나 })
  } catch (e) {
    console.error('[BGM 즉시]', e.message)
    실패로정정(db, 이력id, e.message, 사유.기타)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/audio/bgm/roles — 두 용도(방송용·식사용)의 폴더·곡 수·기본 순서 (2026-09-21)
// → { roles: [{role,name,order,count,offCount,folderId,folderName,problem}], outsideCount }
// 곡 수는 **실제로 나가는 것**(재생목록에서 켜진 것)만 센다 — 꺼 둔 곡까지 세면 「3곡」이라
// 적혀 있는데 2곡만 도는 화면이 된다. `outsideCount` 는 어느 용도에도 안 들어가 **안 나가는** 곡 수
// (맨 위·사람이 만든 다른 폴더) — 화면이 「안 나가는 곡이 있다」고 알리는 근거다(QA 재현).
// 세기만 한다 — 「차례로」 자리를 밀지 않는다.
router.get('/bgm/roles', (_req, res) => {
  try {
    res.json(require('../services/localBgm').용도현황(getDB()))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/audio/bgm/folders — 모든 BGM 폴더 (2026-09-22 「폴더를 자유롭게 늘림」)
// → { folders: [{ id, name, parent_id, role, count, offCount }] }. 고르개·업로드 화면이 **지금 이름**을 그린다.
// 곡 수는 방송이 트는 것과 같은 셈(하위 폴더 포함, 켜진 곡). 세기만 한다.
router.get('/bgm/folders', (_req, res) => {
  try {
    // songs — 곡 하나를 고를 목록(2026-09-22 「개별적 파일로도」). 이름·폴더만(가볍게).
    const { 폴더목록, 곡목록 } = require('../services/localBgm')
    res.json({ folders: 폴더목록(getDB()), songs: 곡목록(getDB()) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/audio/bgm/preview?role=broadcast|meal  또는  ?folderId=<번호> — 편집 화면 미리듣기용 한 곡(2026-09-21).
// **SSE 를 쏘지 않는다** — 받은 브라우저만 튼다(현장 스피커는 조용하다). 「차례로」 자리도 안 민다.
// 미리듣기는 **대신 틀지 않는다** — 고른 폴더가 비었으면 비었다고 답한다(들은 것과 고른 것이 달라지면 거짓이다).
router.get('/bgm/preview', (req, res) => {
  try {
    const { 역할찾기 } = require('../domain/bgmRoles')
    // 곡 하나 미리듣기 — 그 곡 그대로
    if (req.query.fileId != null && req.query.fileId !== '') {
      const r = require('../services/localBgm').곡하나고르기(getDB(), req.query.fileId)
      return res.json(r.ok ? { ok: true, url: r.files[0].url, name: r.title, folderName: r.folderName } : { ok: false, reason: r.사유 })
    }
    if (req.query.folderId != null && req.query.folderId !== '') {
      const r = require('../services/localBgm').미리듣기곡(getDB(), null, req.query.folderId)
      return res.json(r.ok ? r : { ok: false, reason: r.사유 })
    }
    const role = String(req.query.role || 'broadcast')
    if (!역할찾기(role)) return res.status(400).json({ error: '모르는 용도입니다.' })
    const r = require('../services/localBgm').미리듣기곡(getDB(), role)
    res.json(r.ok ? r : { ok: false, reason: r.사유 })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/audio/bgm/roles/:role — 그 용도의 기본 순서 { order: 'random'|'seq' }
// 자동으로 나가는 방송(식사 시간 BGM·안내 방송 밑 BGM)이 이 순서를 쓴다.
router.put('/bgm/roles/:role', (req, res) => {
  const db = getDB()
  const { 역할찾기, 순서들 } = require('../domain/bgmRoles')
  const r = 역할찾기(req.params.role)
  if (!r) return res.status(404).json({ error: '모르는 용도입니다.' })
  const order = req.body?.order
  if (!순서들.includes(order)) return res.status(400).json({ error: '순서는 random(랜덤) 또는 seq(차례로)만 됩니다.' })
  require('../domain/settingsRead').writeSetting(db, r.순서키, order)
  res.json({ ok: true })
})

// POST /api/audio/bgm/stop — BGM 정지 (bgm_stop SSE 발신)
router.post('/bgm/stop', (_req, res) => {
  try {
    const { broadcastSSE } = require('../services/sse')
    broadcastSSE('bgm_stop', {})
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/audio/bgm/set-timer — BGM 재생 시간 제한 타이머 (bgm_set_timer SSE 발신)
router.post('/bgm/set-timer', (req, res) => {
  try {
    const { broadcastSSE } = require('../services/sse')
    const durationSec = Number(req.body?.durationSec) || 0
    broadcastSSE('bgm_set_timer', { durationSec })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── 기존 TTS 오디오 스토어 라우트 (UUID 기반, 항상 맨 마지막) ────
router.get('/:id', (req, res) => {
  const filePath = consumeAudio(req.params.id)
  if (!filePath) return res.status(404).json({ error: '오디오를 찾을 수 없습니다.' })

  res.setHeader('Content-Type', mimeOf(filePath))   // 안내 음성은 wav(Supertonic) 또는 mp3
  const stream = fs.createReadStream(filePath)
  stream.pipe(res)
  // deleteTmpFile은 mp3 옆의 자막 사이드카(.cues.json)도 같이 지운다. unlinkSync로 mp3만
  // 지우면 방송할 때마다 tmpdir에 고아 json이 하나씩 쌓인다.
  stream.on('end',   () => deleteTmpFile(filePath))
  stream.on('error', () => deleteTmpFile(filePath))
})

/**
 * POST /api/audio/play-now — **올려 둔 음원을 지금 내보낸다. 예약 행을 안 만든다.**
 *
 * ── 왜 생겼나 (사용자 결정 2026-09-15) ──────────────────────────────────────
 * 「즉시는 휘발성, 업로드는 영구」의 두 번째 조각이다(첫째는 배경음악,
 * 이 파일의 `/bgm/now`). 그전에는 이것들을 지금 내보낼 때도 **예약을
 * 하나 만들고 그것을 실행**했고, 그 꺼진 행이 지워지지 않아 **달력에 흐린 줄이 쌓였다.**
 *
 * **여기서 다루는 것은 「업로드에 등록된 것을 지금 트는 일」**이다. 트는 것은 휘발성이고
 * **등록된 파일 자체는 그대로 남는다** — 규칙의 두 쪽이 한 자리에서 만난다.
 *
 * ── 스케줄러와 **같은 신호**를 쏜다 ─────────────────────────────────────────
 * 음원은 `prayer_play` — 예약
 * 경로와 글자 그대로 같다. 다르면 화면이 둘을 다르게 재생하고, 그 어긋남은 소리로만 드러난다.
 *
 * ── **영상(`video`)은 아직 여기 없다** ──────────────────────────────────────
 * 영상 예약은 쏘기 전에 **BGM 을 끄고 1.5초 페이드를 기다린 뒤, 그 사이에 새 방송이
 * 끼어들지 않았는지 다시 확인**한다(`scheduler.js` 의 `video` 갈래, td09 H11).
 * 그 판단을 여기 **복사하면 두 벌이 되고**, 한쪽만 고치는 날 영상이 남의 소리 위로 나간다.
 * 먼저 그 자리를 한 곳으로 빼낸 다음에 옮긴다.
 */
router.post('/play-now', (req, res) => {
  const db = getDB()
  const { 시작기록, 실패로정정, 사유 } = require('../domain/broadcastRecord')
  const { resolveMainVolume } = require('../domain/volume')
  const { broadcastSSE } = require('../services/sse')
  const { hasSitePlayer, 소리낼수있나 } = require('../services/sitePlayer')
  const crypto = require('crypto')

  const b = req.body || {}
  const 유형 = String(b.broadcast_type || '')
  // 2026-09-21: 외부 동영상 송출 갈래를 걷어냈다(사용자 결정 — TV 송출은 삭제).
  if (유형 !== 'audio') {
    return res.status(400).json({ error: '이 길은 음원만 내보냅니다.' })
  }

  const file = b.audio_file_id
    ? db.prepare('SELECT * FROM audio_files WHERE id = ?').get(b.audio_file_id)
    : null

  const 이름 = file?.original_name || String(b.title || '').trim() || '음원'
  const 이력id = 시작기록(db, {
    type: '즉시',
    content: `음원 — ${이름.slice(0, 200)}`,
    user: b.user || '수동',
  })

  try {
    // 볼륨은 예약과 **같은 규칙**으로 푼다 — 이 방송에만 실리고 설정은 안 바꾼다.
    const mainVolume = resolveMainVolume(db, { ...b, broadcast_type: 유형 })
    let 보냈나 = false

    if (file) {
      broadcastSSE('prayer_play', {
        url:         `/audio/${file.category}/${file.filename}`,
        name:        file.original_name,
        token:       crypto.randomBytes(8).toString('hex'),
        restoreBGM:  false,
        volume:      mainVolume,
        rate:        b.playback_rate ?? null,
        // 화면이 이 값으로 자막을 찾는다 — 빠뜨리면 그 음원에만 자막이 안 나온다.
        audioFileId: file.id,
      })
      보냈나 = true
    }

    if (!보냈나) {
      실패로정정(db, 이력id, `보낼 것을 못 찾았다(id=${b.audio_file_id})`, 사유.기타)
      return res.status(400).json({ error: '내보낼 파일을 찾지 못했습니다. 업로드 목록에서 다시 골라 주세요.' })
    }

    // **소리 낼 창이 없으면 성공으로 안 적는다** — 2026-09-14 저녁 마무리 방송 사고의 규칙.
    const 들렸나 = hasSitePlayer() && 소리낼수있나()
    if (!들렸나) 실패로정정(db, 이력id, '소리를 낼 창이 없었다', 사유.화면없음)
    res.json({ ok: true, name: 이름, 들렸나 })
  } catch (e) {
    console.error('[음원 즉시]', e.message)
    실패로정정(db, 이력id, e.message, 사유.기타)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
