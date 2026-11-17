// 음원 자막 **초안**을 받아쓰기로 채운다. 개발 PC에서 손으로 돌리는 도구다.
//
//   node scripts/caption-draft.cjs --category=lunch-grace
//   node scripts/caption-draft.cjs --id=12 --id=13
//   node scripts/caption-draft.cjs --category=lunch-grace --model=base --dry
//
// 무엇을 하나:
//   1. 음원을 받아쓴다(faster-whisper). 받아쓰기는 글자를 틀리게 듣는다.
//   2. **정본이 있으면 글자는 정본을 쓰고 시각만 받아쓰기에서 가져온다.** 식사 안내 녹음은
//      그 TTS 문구를 대신하는 것이라 무슨 말이 들어 있는지 이미 안다(routes/audio.js GRACE_TEXT).
//      그래서 "정성스래"로 잘못 들어도 화면에는 "정성스레"가 나온다.
//   3. 정본이 없으면(직원 멘트 등) 받아쓴 글자를 그대로 초안으로 쓴다. 오타는 사람이 편집기에서 고친다.
//   4. **status는 언제나 draft다.** 사람이 편집기에서 확인하고 "방송에 쓰기"를 눌러야 화면에
//      나간다(CLAUDE.md 검토 게이트). 잘못 들은 자막이 홀에 그대로 뜨는 것이 가장 나쁜 결과다.
//
// 왜 현장 PC에 안 두나: 첫 실행에 모델을 내려받고(small 464MB) 전사가 CPU를 오래 문다.
// 방송 시간과 겹치면 정시 예산을 침범한다. 음원은 십수 개뿐이라 여기서 한 번 돌리면 끝이다.
'use strict'

const fs      = require('fs')
const os      = require('os')
const path    = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const { getDB } = require(path.join(ROOT, 'server', 'db', 'schema'))
const { alignSttToText, wordsToLines, normalize } = require(path.join(ROOT, 'server', 'domain', 'captions'))
// 식사 안내 정본 표는 domain/graceText.js가 단일 출처다(2026-09-05). 예전엔 여기에 사본이 있었다.
const { canonicalGraceText } = require(path.join(ROOT, 'server', 'domain', 'graceText'))

// 음원 경로는 domain/audioPaths.js가 단일 출처다(2026-09-05).
const { audioFilePath } = require(path.join(ROOT, 'server', 'domain', 'audioPaths'))

// 받아쓰기가 정본과 이만큼도 안 맞으면 시각을 믿을 수 없다 — 그 파일은 건너뛰고 사람에게 알린다.
// 실측(faster-whisper small, 녹음 안내 음원)에서는 94.5%가 맞았다.
const MIN_MATCH = 0.6

function parseArgs(argv) {
  const out = { ids: [], category: null, model: 'small', dry: false, python: null }
  for (const a of argv) {
    if (a.startsWith('--id='))       out.ids.push(parseInt(a.slice(5)))
    else if (a.startsWith('--category=')) out.category = a.slice(11)
    else if (a.startsWith('--model='))    out.model = a.slice(8)
    else if (a.startsWith('--python='))   out.python = a.slice(9)
    else if (a === '--dry')               out.dry = true
  }
  return out
}

function transcribe(pythonPath, audioPath, model) {
  const out = path.join(os.tmpdir(), `carecast_stt_${process.pid}_${Date.now()}.json`)
  // 앞말(initial_prompt)은 서버 쪽과 **같은 목록**에서 온다 — 여기서만 빠지면
  // 손으로 돌린 초안만 낱말을 틀리게 되고, 그건 나중에 이유를 못 찾는다.
  const { 앞말 } = require('../server/domain/sttVocabulary')
  const r = spawnSync(pythonPath, [path.join(__dirname, 'caption_stt.py'), audioPath, out, model, 앞말()],
    { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) {
    try { fs.unlinkSync(out) } catch { /* 없으면 그만 */ }
    return null
  }
  try {
    const data = JSON.parse(fs.readFileSync(out, 'utf8'))
    fs.unlinkSync(out)
    return data
  } catch (e) {
    console.error('  받아쓰기 결과를 읽지 못했습니다:', e.message)
    return null
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const python = args.python
    || (process.platform === 'win32' ? 'python' : 'python3')

  if (!args.ids.length && !args.category) {
    console.error('사용법: node scripts/caption-draft.cjs --category=lunch-grace | --id=12 [--model=small] [--dry]')
    process.exit(2)
  }

  const db = getDB()
  const rows = args.ids.length
    ? args.ids.map(id => db.prepare('SELECT * FROM audio_files WHERE id = ?').get(id)).filter(Boolean)
    : db.prepare("SELECT * FROM audio_files WHERE category = ? AND filename != '' ORDER BY id").all(args.category)

  if (!rows.length) { console.log('대상 음원이 없습니다.'); return }
  console.log(`대상 ${rows.length}개 · 모델 ${args.model}${args.dry ? ' · 미리보기(저장 안 함)' : ''}\n`)

  let 저장 = 0, 건너뜀 = 0
  for (const file of rows) {
    const audioPath = audioFilePath(file.category, file.filename)
    console.log(`■ [${file.id}] ${file.original_name}`)
    if (!fs.existsSync(audioPath)) { console.log('  파일이 없습니다 — 건너뜁니다\n'); 건너뜀++; continue }

    const stt = transcribe(python, audioPath, args.model)
    if (!stt || !stt.words?.length) { console.log('  받아쓰기 실패 — 건너뜁니다\n'); 건너뜀++; continue }

    const canonical = canonicalGraceText(db, file.category)
    let cues, source, 요약

    if (canonical) {
      // 글자는 정본, 시각만 받아쓰기에서. 틀리게 들은 낱말도 화면에는 바르게 나온다.
      const r = alignSttToText(canonical, stt.words)
      const 비율 = r.total ? r.matched / r.total : 0
      if (!r.cues || 비율 < MIN_MATCH) {
        console.log(`  정본과 ${(비율 * 100).toFixed(0)}%밖에 안 맞습니다 — 녹음 내용이 다른 것 같습니다. 건너뜁니다\n`)
        건너뜀++; continue
      }
      cues = r.cues; source = 'stt'
      요약 = `정본에 붙임 (글자 ${(비율 * 100).toFixed(1)}% 일치)`
    } else {
      // 정본이 없는 음원(직원 멘트 등) — 받아쓴 글자를 그대로 초안으로. 오타는 사람이 고친다.
      cues = wordsToLines(stt.text, stt.words, { src: 'stt' })
      if (!cues) { console.log('  줄을 만들지 못했습니다 — 건너뜁니다\n'); 건너뜀++; continue }
      source = 'stt'
      요약 = '받아쓴 글자 그대로 (정본 없음 — 오타를 확인하세요)'
    }

    console.log(`  ${요약} · ${stt.audioSec}초 음원을 ${stt.sttSec}초에 받아씀 · ${cues.lines.length}줄`)
    for (const l of cues.lines.slice(0, 3)) console.log(`    ${l.s.toFixed(2)} | ${l.text}`)
    if (cues.lines.length > 3) console.log(`    … ${cues.lines.length - 3}줄 더`)

    if (!args.dry) {
      // **언제나 draft다.** 받아쓰기가 만든 것을 사람 확인 없이 방송에 내보내지 않는다.
      db.prepare(`INSERT INTO audio_subtitles (audio_file_id, cues, source, status, updated_at)
                  VALUES (?, ?, ?, 'draft', ?)
                  ON CONFLICT(audio_file_id) DO UPDATE SET
                    cues = excluded.cues, source = excluded.source,
                    status = 'draft', updated_at = excluded.updated_at`)
        .run(file.id, JSON.stringify(normalize(cues)), source, new Date().toISOString())
      저장++
    }
    console.log()
  }

  console.log(args.dry
    ? `미리보기 끝 — ${rows.length - 건너뜀}개가 만들어질 예정, ${건너뜀}개 건너뜀`
    : `초안 ${저장}개 저장, ${건너뜀}개 건너뜀`)
  console.log('\n초안은 아직 방송에 안 나갑니다. 관리자 화면 → 음원 관리 → 자막 편집에서'
    + ' 확인하고 "저장하고 방송에 쓰기"를 눌러야 화면에 나갑니다.')
}

main()
