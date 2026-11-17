// 자막 초안 만들기 — 받아쓰기 엔진과 업로드 뒤 자동 초안 대기열.
//
// `routes/audio.js`에서 내려왔다(2026-09-05, TD-10 기회식). **여기는 순수 이동이 아니다** —
// 라우트 네 곳이 이 파일의 모듈 상태를 직접 읽고 있었기 때문에, 그 자리를 **창구 넷**으로
// 바꿨다(isTranscribing · transcribe · queueDraft · progressSnapshot). 옮긴 알맹이는 그대로다.
//
// 왜 갈랐나: 이 덩어리는 접수창구가 할 일이 아니다. 파이썬을 띄우고, 진행률을 들고 있고,
// 방송 중이면 스스로 미루는 **일하는 부서**다. routes/에 있으면 그 파일을 여는 사람마다
// "여기가 무슨 일을 하는 곳인지"를 다시 읽어야 한다.
//
// 지키는 선 셋(옮기기 전과 같다):
//  · **한 번에 하나만 돈다.** 전사가 CPU를 오래 물어서, 겹치면 이 PC가 방송을 못 낸다.
//  · **방송 중에는 미룬다.** 이 PC의 일은 정시 방송이 먼저다.
//  · **언제나 draft.** 사람이 확인해야 방송에 나간다(CLAUDE.md 검토 게이트).
'use strict'

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { getDB } = require('../db/schema')
const { audioFilePath } = require('../domain/audioPaths')
const { canonicalGraceText } = require('../domain/graceText')
const { normalize: normalizeCues, draftFromText, alignSttToText, wordsToLines } = require('../domain/captions')
const { ensurePythonPath } = require('./tts')
const nowPlaying = require('./nowPlaying')

// 말소리가 든 카테고리 — 여기 올라온 것만 자동으로 받아쓴다.
const SPEECH_CATS = new Set([
  'morning-prayer', 'lunch-prayer', 'dinner-prayer', 'evening-prayer',
  'breakfast-grace', 'lunch-grace', 'dinner-grace', 'staff', 'misc-audio',
])

// 한국어 안내 음성은 초당 3.5자쯤 나간다(0.8배속 기준, tts.js의 대기 시간 추정과 같은 값).
// 업로드 시점에는 음원 길이를 모르므로(duration은 재생 뒤에 채워진다) 이 값으로 어림한다.
// 어차피 사람이 편집기에서 스페이스바로 다시 찍을 타이밍이고, 여기서 하는 일은 **글자를
// 미리 채워 두는 것**이다.
const CHARS_PER_SEC = 3.5

function prefillGraceSubtitle(db, audioFileId, category) {
  const text = canonicalGraceText(db, category)
  if (!text) return

  try {
    const cues = draftFromText(text, Math.max(5, text.length / CHARS_PER_SEC))
    if (!cues) return
    // **초안이다.** 타이밍은 어림이고 녹음이 이 문구와 다를 수도 있으니, 사람이 편집기에서
    // 확인하고 올려야 방송에 나간다(CLAUDE.md 검토 게이트).
    db.prepare(`INSERT INTO audio_subtitles (audio_file_id, cues, source, status, updated_at)
                VALUES (?, ?, 'prefill', 'draft', ?)
                ON CONFLICT(audio_file_id) DO NOTHING`)
      .run(audioFileId, JSON.stringify(cues), new Date().toISOString())
  } catch (e) {
    // 초안을 못 깔아도 업로드는 성공이다 — 사람이 편집기에서 직접 적으면 된다.
    console.warn('[자막] 정본 문구 초안을 깔지 못했습니다(업로드는 정상):', e.message)
  }
}

// ── 받아쓰기 ──────────────────────────────────────────────────
//
// 정본이 있는 카테고리(식사 안내)면 **글자는 정본을 쓰고 시각만 받아쓰기에서 가져온다** —
// "정성스레"를 "정성스래"로 들어도 화면에는 바르게 나온다. 정본이 없으면 받아쓴 글자를
// 그대로 주고, 오타는 사람이 편집기에서 고친다.
//
// **한 번에 하나만 돈다.** 전사가 CPU를 오래 물어서, 여러 개가 겹치면 이 PC가 방송을 못 낸다.
let 받아쓰는중 = false

// 지금 무엇을 몇 퍼센트까지 받아썼는지. 화면이 1초마다 물어본다 —
// 전사는 음원 길이의 1/3쯤 걸려서 아무 표시가 없으면 사람이 다시 누르거나 창을 닫는다.
let 진행 = null   // null | { fileId, name, percent, doneSec, totalSec, startedAt }

function 받아쓰기(db, file) {
  return new Promise((resolve, reject) => {
    const audioPath = audioFilePath(file.category, file.filename)
    if (!fs.existsSync(audioPath)) return reject(new Error('음원 파일이 없습니다.'))

    const python = ensurePythonPath()
    if (!python) return reject(new Error('이 PC에서 Python을 찾지 못했습니다. 개발 담당자에게 알려주세요.'))

    const outPath = path.join(os.tmpdir(), `carecast_stt_${process.pid}_${Date.now()}.json`)
    const script  = path.join(__dirname, '..', '..', 'scripts', 'caption_stt.py')
    // PYTHONIOENCODING을 안 주면 파이썬이 내는 한글이 콘솔 코드페이지(CP949)로 와서
    // 화면에 "faster-whisper?? ?????"처럼 깨져 뜬다 — 실제로 그렇게 나왔다.
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' }

    받아쓰는중 = true
    진행 = { fileId: file.id, name: file.original_name, percent: 0, doneSec: 0, totalSec: 0, startedAt: Date.now() }
    // 파이썬이 흘리는 진행률 파일을 1초마다 읽는다. 프로세스 stdout으로 받지 않는 이유는
    // 앞서 겪은 그것이다 — spawn된 파이썬 출력은 콘솔 코드페이지를 타서 깨진다.
    const 진행타이머 = setInterval(() => {
      try {
        const p = JSON.parse(fs.readFileSync(`${outPath}.progress`, 'utf8'))
        if (진행) 진행 = { ...진행, ...p }
      } catch { /* 아직 안 만들어졌거나 쓰는 중 — 다음 초에 다시 본다 */ }
    }, 1000)

    // **앞말을 함께 준다** (사용자 신고 2026-09-16 — 녹음 문안 속 드문 낱말을 잘못 받아씀).
    // 이게 없으면 whisper 가 무슨 방송인지 모르고 더 흔한 낱말로 듣는다.
    // 목록은 `domain/sttVocabulary` 한 곳이고 AI 다듬기도 같은 것을 본다 — 갈리면
    // 받아쓰기가 새로 틀리는 낱말을 다듬기가 못 고친다.
    const { 앞말 } = require('../domain/sttVocabulary')
    execFile(python, [script, audioPath, outPath, 'small', 앞말()],
      { timeout: 15 * 60 * 1000, encoding: 'utf8', env }, (err, _out, stderr) => {
        받아쓰는중 = false
        clearInterval(진행타이머)
        진행 = null
        try { fs.unlinkSync(`${outPath}.progress`) } catch { /* 파이썬이 이미 지웠으면 그만 */ }
        try {
          if (err) {
            const 없다 = /faster-whisper가 없습니다/.test(stderr || '')
            // ── **없을 때는 화면이 그 사실을 알아볼 수 있어야 한다** (사용자 지시 2026-09-15) ──
            // 예전에는 *"개발 담당자에게 요청해주세요"* 라고만 했다. 그런데 이건
            // **그 자리에서 받을 수 있는 것**이라, 화면이 「설치하기」 단추를 띄울 수 있게
            // 표식(`code`)을 함께 준다. 문구 짝맞추기로 가르면 문구를 다듬는 날 조용히 끊긴다.
            const e = new Error(없다
              ? '받아쓰기 프로그램(faster-whisper)이 이 PC에 없습니다.'
              : `받아쓰기에 실패했습니다: ${(stderr || err.message).slice(0, 200)}`)
            if (없다) e.code = 'STT_MISSING'
            return reject(e)
          }
          const stt = JSON.parse(fs.readFileSync(outPath, 'utf8'))
          if (!stt.words?.length) return reject(new Error('이 음원에서 말소리를 찾지 못했습니다.'))

          const canonical = canonicalGraceText(db, file.category)
          if (canonical) {
            const r = alignSttToText(canonical, stt.words)
            if (!r.cues) return reject(new Error('받아쓴 내용을 문구에 붙이지 못했습니다.'))
            return resolve({ cues: r.cues, canonical: true, matched: r.matched, total: r.total,
                             audioSec: stt.audioSec, sttSec: stt.sttSec })
          }
          const cues = wordsToLines(stt.text, stt.words, { src: 'stt' })
          if (!cues) return reject(new Error('받아쓴 내용으로 자막 줄을 만들지 못했습니다.'))
          resolve({ cues, canonical: false, audioSec: stt.audioSec, sttSec: stt.sttSec })
        } catch (e) {
          reject(new Error(`받아쓰기 결과를 읽지 못했습니다: ${e.message}`))
        } finally {
          try { fs.unlinkSync(outPath) } catch { /* 이미 없으면 그만 */ }
        }
      })
  })
}

// ── 업로드하면 알아서 초안을 만든다 ────────────────────────────
//
// 자막을 "따로 하는 일"로 두면 아무도 안 한다. 올리는 김에 초안까지 만들어 두고, 사람은
// 확인하고 올리기만 하면 되게 한다.
//
// 지키는 선 셋:
//  · 말소리 카테고리만(SPEECH_CATS). BGM·체조 음악은 받아쓸 말이 없다.
//  · 한 번에 하나씩, 방송 중에는 미룬다. 이 PC의 일은 정시 방송이 먼저다.
//  · **언제나 draft.** 사람이 확인해야 방송에 나간다(CLAUDE.md 검토 게이트).
const 초안대기열 = []
let 대기열도는중 = false

function 초안예약(fileId) { 초안대기열.push(fileId); setTimeout(대기열돌리기, 1500) }

async function 대기열돌리기() {
  if (대기열도는중 || !초안대기열.length) return
  // 방송이 나가는 중이면 미룬다 — 끝나고 다시 본다.
  if (nowPlaying.get().broadcast || 받아쓰는중) { setTimeout(대기열돌리기, 30000); return }

  대기열도는중 = true
  const id = 초안대기열.shift()
  try {
    const db = getDB()
    const file = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)
    const 이미 = db.prepare('SELECT status, source, updated_at FROM audio_subtitles WHERE audio_file_id = ?').get(id)
    // **prefill은 덮어쓴다.** 식사 안내 음원은 업로드 때 정본 문구가 먼저 깔리는데(글자는 맞고
    // 타이밍은 글자 수로 나눈 어림값이다), 그것을 "이미 있음"으로 보고 건너뛰면 받아쓰기가
    // 잡아 줄 **진짜 시각**이 영영 안 들어온다 — 실측에서 셋째 줄부터 1.8초가 밀렸다.
    // 받아쓰기는 정본이 있으면 글자를 정본에서 가져오므로, 덮어써도 글자는 그대로다.
    //
    // 사람이 손댄 것(manual)과 이미 확정한 것(ready)은 건드리지 않는다.
    const 덮어쓸것 = !이미 || (이미.source === 'prefill' && 이미.status === 'draft')
    if (file && 덮어쓸것) {
      const r = await 받아쓰기실행(db, file)
      // **끝났을 때 다시 본다 — 시작할 때 본 그대로일 때만 쓴다**(전문가 2차 검토 5-1). 받아쓰기는
      // 음원 길이의 1/3쯤 걸리는데, 그 사이 사람이 편집기에서 고쳐 「방송에 쓰기」를 누르면 예전엔 그
      // 수정과 ready 상태를 STT 초안으로 덮어써 다음 방송에 자막이 안 나왔다. 확인과 쓰기를 **한 문장**
      // 으로 묶어 그 틈을 없앤다: 처음에 없었으면 「아직 없을 때만 넣기」, prefill 초안이었으면 「그 행이
      // 그대로(같은 updated_at)일 때만 고치기」. 사람이 저장하면 updated_at 이 바뀌어 아무것도 안 쓴다.
      const cues = JSON.stringify(normalizeCues(r.cues))
      const 지금 = new Date().toISOString()
      const 씀 = 이미
        ? db.prepare(`UPDATE audio_subtitles SET cues = ?, source = 'stt', status = 'draft', updated_at = ?
                      WHERE audio_file_id = ? AND source = 'prefill' AND status = 'draft' AND updated_at = ?`)
          .run(cues, 지금, id, 이미.updated_at).changes
        : db.prepare(`INSERT INTO audio_subtitles (audio_file_id, cues, source, status, updated_at)
                      VALUES (?, ?, 'stt', 'draft', ?) ON CONFLICT(audio_file_id) DO NOTHING`)
          .run(id, cues, 지금).changes
      if (씀) console.log(`[자막] ${file.original_name} 초안 생성 (${r.cues.lines.length}줄, ${r.sttSec}초)`)
      else console.log(`[자막] ${file.original_name} 받아쓰는 사이 사람이 자막을 저장해, 받아쓰기 초안은 버렸습니다`)
    }
  } catch (e) {
    // 초안을 못 만들어도 업로드는 성공이다 — 사람이 편집기에서 직접 만들면 된다.
    console.warn(`[자막] ${id}번 초안 생성 실패(업로드는 정상):`, e.message)
  } finally {
    대기열도는중 = false
    if (초안대기열.length) setTimeout(대기열돌리기, 1000)
  }
}

const 예상초 = (총초) => 4 + (총초 > 0 ? 총초 * 0.6 : 30)   // 모델 여는 데 4초 + 음원의 0.6배(실측)

// ── 창구 ──────────────────────────────────────────────────────
//
// 라우트가 모듈 상태를 직접 만지지 않게 하는 자리다. 예전에는 `if (받아쓰는중)`처럼 변수를
// 그대로 읽었는데, 그러면 이 부서의 속을 접수창구가 알아야 한다.

/** 지금 받아쓰는 중인가. 겹쳐 돌리면 이 PC가 방송을 못 내므로 라우트가 먼저 묻는다. */
function isTranscribing() { return 받아쓰는중 }

/** 이 음원을 받아쓴다(한 번에 하나). 결과는 저장하지 않고 돌려준다 — 사람이 확인해야 한다. */
function transcribe(db, file) { return 받아쓰기(db, file) }

/** 업로드 뒤 자동 초안을 예약한다. 방송 중이면 알아서 미룬다. */
function queueDraft(fileId) { return 초안예약(fileId) }

/**
 * 진행률 응답 그대로. 퍼센트가 **둘 중 큰 값**이라는 규칙이 엔진 옆에 있어야 갈리지 않는다.
 * (실측: 32초 음원에서 15초 동안 0%였다가 80%로 튄다 — 시간 추정과 큰 쪽을 쓴다.)
 */
function progressSnapshot() {
  if (!진행) return { running: false }
  const 경과 = (Date.now() - 진행.startedAt) / 1000
  const 시간추정 = Math.min(95, Math.round((경과 / 예상초(진행.totalSec)) * 100))
  return {
    running: true,
    fileId: 진행.fileId,
    name: 진행.name,
    percent: Math.max(진행.percent, 시간추정),
    doneSec: 진행.doneSec,
    totalSec: 진행.totalSec,
    elapsedSec: Math.round((Date.now() - 진행.startedAt) / 1000),
    queued: 초안대기열.length,
  }
}

// ── **받아쓰기 프로그램 설치** (사용자 지시 2026-09-15) ────────────────────────────
//
// *"파이썬 + faster-whisper 이게 없으면 자동으로 다운받게 하면 안돼?"*
//
// **서버가 뜰 때 자동으로 하지 않는다.** 예전 음성 합성 모듈은 그렇게 했지만, 그건
// 가볍고 이건 아니다 — 의존성 200MB+ 에 모델 464MB 다. 부팅마다 그 비용을 내면
// **방송이 밀린다**(현장 PC 는 자동 업데이트로 자주 재시작한다).
//
// 그래서 **사람이 누를 때** 한 번 돈다. 세 가지를 지킨다:
//   · **방송 중이면 안 한다** — 설치가 CPU 를 잡아먹는다(라우트가 막는다)
//   · **한 번에 하나만** — 두 번 눌러도 하나만 돈다
//   · **`execSync` 를 안 쓴다** — 몇 분짜리라 이벤트 루프가 멎으면 그 사이 방송이 죽는다
//
// 설치는 **시도일 뿐**이다. 실패해도 방송에는 아무 영향이 없다(자막은 부가 기능이다).
let 설치중 = false
function isInstallingStt() { return 설치중 }

function installStt() {
  if (설치중) return Promise.reject(new Error('이미 설치하는 중입니다. 잠시 뒤에 다시 봐 주세요.'))
  const python = ensurePythonPath()
  if (!python) {
    return Promise.reject(new Error(
      '이 PC에서 파이썬을 찾지 못했습니다. 파이썬을 먼저 설치해 주세요 — '
      + '음성 안내(TTS)도 파이썬이 필요합니다.'))
  }
  설치중 = true
  return new Promise((resolve, reject) => {
    // `--quiet` 로도 진행 표시는 안 나온다. 몇 분 걸리므로 화면은 「설치 중」만 띄우고
    // 끝나면 결과를 받는다. 상한 15분 — 느린 회선에서도 대개 그 안에 끝난다.
    execFile(python, ['-m', 'pip', 'install', 'faster-whisper', '--quiet'],
      { timeout: 15 * 60 * 1000, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, _out, stderr) => {
        if (err) {
          설치중 = false
          return reject(new Error(`설치에 실패했습니다: ${(stderr || err.message).slice(0, 200)}`))
        }
        // 모델은 **처음 쓸 때** 내려받는다(약 460MB). 여기서 미리 받아 두지 않으면
        // 사람이 자막 단추를 누르고 10분을 기다리게 된다 — 그때는 이유도 안 보인다.
        execFile(python, ['-c',
          "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"],
        { timeout: 20 * 60 * 1000, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
        (err2) => {
          설치중 = false
          // 모델을 못 받아도 **설치 자체는 된 것**이다. 다음에 자막을 만들 때 다시 받는다.
          resolve({ installed: true, model: !err2 })
        })
      })
  })
}

// 시험 이음새 — 받아쓰기(Python·모델)를 가짜로 바꿔 끼우고, 대기열을 한 번 돌려 끝날 때까지 기다린다.
let 받아쓰기실행 = 받아쓰기
function __setTranscriberForTests(fn) { 받아쓰기실행 = fn || 받아쓰기 }
async function __drainDraftQueueForTests(fileId) {
  초안대기열.push(fileId)
  await 대기열돌리기()
}

module.exports = {
  SPEECH_CATS, prefillGraceSubtitle,
  isTranscribing, transcribe, queueDraft, progressSnapshot,
  installStt, isInstallingStt,
  __setTranscriberForTests, __drainDraftQueueForTests,
}
