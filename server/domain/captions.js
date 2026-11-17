// 자막 단일 소스 — TTS가 낸 어절 시각도, 사람이 손으로 찍은 음원 타이밍도 여기서 만든 같은
// 모양으로만 화면에 간다. React도 DB도 모르는 순수 모듈이라 node --test가 그대로 돌린다.
//
// 왜 두 갈래를 한 포맷으로 묶나: 화면(BroadcastCaption)이 자막의 출처를 알 필요가 없어야
// 렌더러가 하나로 유지된다. 출처가 늘 때마다 화면을 고치면 노래방 색칠 같은 세밀한 것이
// 갈래마다 어긋난다.
//
// 포맷 v1 (시간 단위는 전부 초, float):
//   { v: 1, src: 'tts'|'manual'|'stt'|'prefill',
//     lines: [ { s, e, text, w?: [[s, e, '어절'], ...] } ] }
//
// lines 가 화면을 넘기는 단위(노래방 가사처럼 줄이 올라간다), w 가 색칠 단위.
// w 가 없으면 화면이 줄 안에서 글자 수 비례로 보간한다 — 사람이 줄 단위로만 찍은 경우다.
// 음절 단위는 저장하지 않는다. 어절 안 보간으로 충분하고, 음절까지 두면 편집기에서 사람이
// 감당할 수 없다.
'use strict'

const FORMAT_VERSION = 1

// 한 줄에 넣을 글자 수. **자막 글씨 크기와 짝이다**(BroadcastCaption.jsx의 CUR_SIZE).
// 글씨를 키우면 한 줄에 들어가는 글자도 그만큼 줄어야 한다 — 안 그러면 저절로 줄바꿈되어
// 앞줄·현재줄·다음줄 3줄 배치가 무너진다.
//
// 브라우저에서 재 보면 들어가는 글자 수가 화면 폭마다 다르다(clamp(2.4rem, 9vw, 6.75rem),
// 좌우 여백 40px씩): 1920px에서 19자, 1280px에서 12자, 1024px에서 11자. 글씨가 상한에 걸려
// 굳는 1200~1900px 구간 때문에 폭에 비례하지도 않는다.
//
// 가장 좁은 쪽(12자)에 맞추면 "선생님들께 / 안내드립니다."처럼 잘게 쪼개진다. 그래서 이
// 값은 **읽기 좋은 길이**로 두고, 화면에 안 들어가는 줄은 BroadcastCaption이 그 줄만 살짝
// 줄여서 맞춘다(줄바꿈이 일어나면 3줄 배치가 무너지므로 줄바꿈은 안 한다).
//
// 상한이 아니라 목표다 — 문장을 이 길이에 가깝게 고르게 쪼갠다.
//
// ── **16 → 13** (사용자 요청 2026-09-15: *"방송 자막 좀 크게 해줘"*) ───────────────
// 글씨 크기만 키우면 소용이 없다. 한 줄이 상자보다 넓어지면 `BroadcastCaption` 이
// **그 줄만 줄여서** 맞추므로, 키운 만큼 도로 줄어든다. 둘은 **짝**이다.
//
// 실제로 정하는 것은 **한 줄에 몇 글자냐**다. 1920px 화면에서 상자 폭은 약 1840px 이고
// 한글은 글씨 크기만큼 넓으니 —
//   · 16자면 한 글자에 115px 까지 → 옛 상한 108px 이 그대로 쓰였다
//   · 13자면 한 글자에 141px 까지 → 새 상한 136px 이 다 쓰인다(약 26% 크다)
// 좁은 화면에서도 같은 방향이다(1280px 실측 추정: 73px → 90px).
//
// **13 아래로는 내리지 않는다.** 12자로 잡았더니 "선생님들께 / 안내드립니다." 처럼
// 잘게 쪼개졌다(위 문단이 그때 기록이다). 읽기 좋은 길이가 먼저다.
const MAX_CHARS = 13

// 문장이 끝나는 자리. 여기서 끊으면 사람이 읽기에 가장 자연스럽다.
const SENTENCE_END = /[.!?。…]["')\]』」]*$/
// 문장이 너무 길 때 두 번째로 좋은 자리.
const CLAUSE_END = /[,、:;·]["')\]』」]*$/

const SRC = new Set(['tts', 'manual', 'stt', 'prefill'])

// ── 어절 시각을 원문에 다시 붙이기 ──────────────────────────────
//
// 어절 시각 목록은 구두점을 뗀 알맹이만 담을 수 있다("여러분," → "여러분"). 그대로 화면에
// 쓰면 자막에서 쉼표와 마침표가 통째로 사라진다. 그래서 원문을 앞에서부터 훑으며 어절을
// 순서대로 찾아, 어절과 어절 사이에 낀 글자(구두점·따옴표)를 앞 어절에 붙여 되살린다.
//
// 순서대로만 찾는 것이 중요하다. 같은 낱말이 여러 번 나오는 문장("네, 네 알겠습니다")에서
// 전역 검색을 하면 뒤 어절이 앞 위치를 집어 시간이 거꾸로 간다.
function alignWordsToText(text, words) {
  const spans = []
  let cursor = 0

  for (const word of words) {
    const token = String(word?.[2] ?? '').trim()
    if (!token) continue

    const at = text.indexOf(token, cursor)
    if (at < 0) {
      // 원문에 없는 어절 — 엔진이 숫자나 기호를 읽어서 편 경우다("3" → "삼").
      // 자막에서 그 어절만 빠지는 것이 통째로 어긋나는 것보다 낫다.
      continue
    }
    spans.push({ at, end: at + token.length, s: Number(word[0]), e: Number(word[1]) })
    cursor = at + token.length
  }

  // 각 어절이 차지하는 글자 범위를 "다음 어절 직전까지"로 넓혀 구두점을 되살린다.
  return spans.map((span, i) => {
    const until = i + 1 < spans.length ? spans[i + 1].at : text.length
    return { text: text.slice(span.at, until).trim(), s: span.s, e: span.e }
  }).filter((p) => p.text)
}

// ── 조각을 줄로 묶기 ────────────────────────────────────────────
//
// 먼저 문장으로 끊고, 긴 문장은 **고르게** 쪼갠다. 앞줄부터 꽉 채우고 남는 것을 뒤로 미는
// 방식(그리디)은 "…투약해 주시기 / 바랍니다." 처럼 마지막에 토막을 남긴다. 글씨가 화면
// 높이의 6분의 1만 한 자막에서는 그 토막 한 줄이 통째로 낭비다.
//
// 그래서 문장 길이를 보고 몇 줄이 될지 먼저 정하고(ceil), 그 줄 수로 나눈 목표 길이에
// 가깝게 끊는다. 쉼표가 목표 근처에 있으면 거기를 고른다 — 사람이 읽을 때 쉬는 자리다.
const lenOf = (buf) => buf.reduce((n, p) => n + p.text.length, 0) + Math.max(buf.length - 1, 0)

function splitSentence(pieces, maxChars) {
  const out = []
  let i = 0

  while (i < pieces.length) {
    const remaining = pieces.slice(i)
    const remLen = lenOf(remaining)
    // **줄을 하나 낼 때마다 남은 것으로 다시 계획한다.** 줄 수를 처음에 못 박으면, 앞에서
    // 쉼표를 따라 짧게 끊었을 때 그 빚이 전부 마지막 줄로 몰려 혼자 화면을 넘친다
    // (실제로 26자가 나왔다). 여기서는 마지막 줄이 남은 전부를 받아도 maxChars 이하다.
    const parts = Math.max(1, Math.ceil(remLen / maxChars))
    if (parts === 1) { out.push(remaining); break }

    const target = remLen / parts
    const buf = []
    let k = i
    for (; k < pieces.length; k++) {
      buf.push(pieces[k])
      if (k === pieces.length - 1) break
      const here = lenOf(buf)
      const next = here + 1 + pieces[k + 1].text.length
      // **넘기지 않는다.** 여유를 두면(1.25배까지 허용했었다) 15자짜리 줄이 나오는데,
      // 9vw 글씨로는 그게 곧 줄바꿈이고 3줄 배치가 무너진다. 목표보다 짧아지는 편이 낫다.
      // 낱말 하나가 통째로 상한보다 길면 어쩔 수 없이 그 줄만 넘는다.
      if (next > maxChars) break
      // 쉼표에서 끊으면 목표를 조금 벗어나도 그쪽이 낫다 — 사람이 읽을 때 쉬는 자리다.
      // 다만 양쪽 끝에서는 안 준다: 이미 한 줄을 넘겼으면(읽기 좋자고 화면을 넘기면 본말전도),
      // 그리고 아직 너무 짧으면("오늘," 세 글자가 큰 글씨 한 줄을 통째로 차지한다).
      const wideEnough = here >= Math.max(4, target * 0.45)
      const bonus = CLAUSE_END.test(pieces[k].text) && here <= maxChars && wideEnough ? target * 0.3 : 0
      if (Math.abs(here - target) - bonus <= Math.abs(next - target)) break
    }
    out.push(buf)
    i = k + 1
  }
  return out
}

function packIntoLines(pieces, maxChars) {
  // 1) 문장 단위로 자른다
  const sentences = []
  let cur = []
  for (const piece of pieces) {
    cur.push(piece)
    if (SENTENCE_END.test(piece.text)) { sentences.push(cur); cur = [] }
  }
  if (cur.length) sentences.push(cur)

  // 2) 긴 문장은 고르게 쪼갠다
  const lines = []
  for (const sentence of sentences) {
    for (const buf of splitSentence(sentence, maxChars)) {
      if (!buf.length) continue
      lines.push({
        s: buf[0].s,
        e: buf[buf.length - 1].e,
        text: buf.map((p) => p.text).join(' '),
        w: buf.map((p) => [p.s, p.e, p.text]),
      })
    }
  }
  return lines
}

/**
 * 어절 시각 목록([시작, 끝, 어절]) + 원문 → 자막 cue.
 * @param {string} text  TTS가 읽은 원문
 * @param {Array<[number, number, string]>} words  [시작초, 끝초, 어절]
 * @returns {{v:number, src:string, lines:Array}|null}  어절이 하나도 안 맞으면 null
 */
function wordsToLines(text, words, opts = {}) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!source || !Array.isArray(words) || !words.length) return null

  const pieces = alignWordsToText(source, words)
  if (!pieces.length) return null

  const lines = packIntoLines(pieces, Number(opts.maxChars) || MAX_CHARS)
  return normalize({ v: FORMAT_VERSION, src: opts.src || 'tts', lines })
}

// ── 받아쓰기 시각을 정본에 붙이기 ──────────────────────────────
//
// 받아쓰기(STT)는 글자를 틀리게 듣는다 — 실측에서 드문 낱말의 한 글자를 바꿔 들었다(예: "정성스레"를
// "정성스래", "드십시오"를 "드십시요"). 그런데 여기 음원 대부분은 안내 멘트이고 **정확한 문구가 이미 코드에
// 있다**(broadcastDefaults.js). 그러니 받아쓰기가 글자까지 맡을 이유가 없다 — 시각만 가져오고
// 글자는 정본을 쓰면, 잘못 들은 낱말도 화면에는 바르게 나온다.
//
// 붙이는 방법은 글자 단위 최장공통부분수열이다. 낱말 단위로 맞추면 한 낱말만 틀려도 그
// 낱말이 통째로 빠지는데, 글자 단위면 "은[예/혜]로이"에서 세 글자가 살아남아 시각이 이어진다.
const LCS_MAX = 4000   // 이보다 길면 표가 32MB를 넘는다. 3분짜리 녹음 문안이 600자 안팎이다.

function lcsPairs(a, b) {
  const n = a.length, m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

/**
 * 받아쓰기 낱말 시각을 정본 문구에 붙여 자막 cue를 만든다.
 * @param {string} canonical  정본 문구(화면에 나갈 글자)
 * @param {Array<[number, number, string]>} sttWords  받아쓰기 결과 [시작초, 끝초, 들은낱말]
 * @returns {{cues: object|null, matched: number, total: number}}  matched/total이 낮으면
 *          받아쓰기가 딴소리를 한 것이다 — 부르는 쪽이 사람에게 알려야 한다.
 */
function alignSttToText(canonical, sttWords, opts = {}) {
  const source = String(canonical ?? '').replace(/\s+/g, ' ').trim()
  if (!source || !Array.isArray(sttWords) || !sttWords.length) return { cues: null, matched: 0, total: 0 }

  // 1) 받아쓴 글자마다 시각을 매긴다(낱말 안에서는 고르게 편다)
  const heard = []
  for (const w of sttWords) {
    const t = String(w?.[2] ?? '').replace(/\s/g, '')
    const s = Number(w?.[0]), e = Number(w?.[1])
    if (!t || !Number.isFinite(s) || !Number.isFinite(e)) continue
    for (let k = 0; k < t.length; k++) heard.push({ ch: t[k], t: s + ((e - s) * (k + 0.5)) / t.length })
  }

  // 2) 정본에서 공백을 뺀 글자열과 원문 위치를 함께 들고 있는다
  const canon = []
  for (let k = 0; k < source.length; k++) {
    if (/\s/.test(source[k])) continue
    canon.push({ ch: source[k], at: k })
  }
  if (!heard.length || !canon.length) return { cues: null, matched: 0, total: canon.length }
  if (heard.length > LCS_MAX || canon.length > LCS_MAX) {
    return { cues: null, matched: 0, total: canon.length, tooLong: true }
  }

  // 3) 맞는 글자끼리 잇는다
  const pairs = lcsPairs(heard.map(c => c.ch), canon.map(c => c.ch))
  if (!pairs.length) return { cues: null, matched: 0, total: canon.length }

  const time = new Array(canon.length).fill(null)
  for (const [hi, ci] of pairs) time[ci] = heard[hi].t

  // 4) 못 맞춘 글자는 앞뒤 시각 사이로 나눠 채운다. 양 끝은 가장 가까운 값으로 민다.
  const first = pairs[0][1], last = pairs[pairs.length - 1][1]
  for (let k = 0; k < canon.length; k++) {
    if (time[k] != null) continue
    let lo = k, hi = k
    while (lo >= 0 && time[lo] == null) lo--
    while (hi < canon.length && time[hi] == null) hi++
    const a = lo >= 0 ? time[lo] : time[first]
    const b = hi < canon.length ? time[hi] : time[last]
    time[k] = a + ((b - a) * (k - lo)) / Math.max(hi - lo, 1)
  }

  // 5) 정본의 어절마다 시작·끝 시각을 뽑아 평소 쓰는 줄 묶기에 넘긴다
  const words = []
  const re = /\S+/g
  let m
  while ((m = re.exec(source))) {
    const from = m.index, to = m.index + m[0].length
    let lo = Infinity, hi = -Infinity
    for (let k = 0; k < canon.length; k++) {
      if (canon[k].at < from || canon[k].at >= to) continue
      lo = Math.min(lo, time[k]); hi = Math.max(hi, time[k])
    }
    if (lo === Infinity) continue
    words.push([lo, hi, m[0]])
  }

  return {
    cues: wordsToLines(source, words, { ...opts, src: opts.src || 'stt' }),
    matched: pairs.length,
    total: canon.length,
  }
}

/**
 * 문구만 있고 소리를 아직 안 들어 본 자막 초안. 업로드할 때 "이 녹음엔 이 문구가 들어 있다"고
 * 아는 경우에 쓴다(식사 안내 녹음이 그 TTS 문구를 대신한다).
 *
 * 줄 나누기는 **평소와 같은 규칙**을 탄다 — 여기서 문장 단위로만 자르면 60자짜리 줄이 나와
 * 편집기에서도 화면에서도 한 줄에 안 들어간다. 낱말 시각을 글자 수에 비례해 지어내서
 * wordsToLines에 그대로 넘기면 줄 나누기가 한 곳에서만 결정된다.
 *
 * 타이밍은 어림이다. 사람이 편집기에서 스페이스바로 다시 찍는다.
 * @param {string} text
 * @param {number} durationSec  음원 길이(모르면 어림값)
 */
function draftFromText(text, durationSec, opts = {}) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  const words = wordsFromText(source, durationSec)
  if (!words) return null
  return wordsToLines(source, words, { ...opts, src: opts.src || 'prefill' })
}

/**
 * 어절 시각을 **글자 수 비례로 지어낸** 목록 — `[[시작초, 끝초, 어절], …]`.
 * 합성 엔진이 어절 시각을 안 주는 경우(Supertonic, 2026-09-21)의 자막 사이드카가 이 모양이다 —
 * `services/tts.js` 의 readCues 가 wordsToLines 로 읽는 것과 **같은 형식**이라 뒤쪽은 그대로 돈다.
 * 소리 길이는 합성 결과에서 정확히 안다. 어절 안의 시각만 어림이다.
 * @param {string} text
 * @param {number} durationSec
 * @returns {Array<[number, number, string]>|null}
 */
function wordsFromText(text, durationSec) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  const total = Number(durationSec)
  if (!source || !(total > 0)) return null
  const tokens = source.split(' ').filter(Boolean)
  const chars = tokens.reduce((n, t) => n + t.length, 0) || 1
  let at = 0
  return tokens.map((t) => {
    const span = (t.length / chars) * total
    const w = [at, at + span, t]
    at += span
    return w
  })
}

/**
 * 타이밍이 없는 줄에 글자 수 비례로 시간을 나눠 준다. 사람이 손으로 찍기 전 초안용이고,
 * 이대로 방송에 나가라고 만든 것이 아니다 — 초안은 편집기에서 사람이 확정한다.
 * @param {string[]} textLines
 * @param {number} durationSec  음원 전체 길이
 */
function distributeEvenly(textLines, durationSec, opts = {}) {
  const lines = (textLines || []).map((t) => String(t ?? '').trim()).filter(Boolean)
  const total = Number(durationSec)
  if (!lines.length || !(total > 0)) return null

  const chars = lines.reduce((sum, t) => sum + t.length, 0) || 1
  let at = 0
  const out = lines.map((t) => {
    const span = (t.length / chars) * total
    const line = { s: at, e: at + span, text: t }
    at += span
    return line
  })
  return normalize({ v: FORMAT_VERSION, src: opts.src || 'prefill', lines: out })
}

/**
 * 저장·전송 전 마지막 관문. 시간이 거꾸로 가거나 비어 있는 줄을 걸러내고, 못 고칠 만큼
 * 망가졌으면 throw 한다 — 저장 라우트가 400을 돌려주는 근거가 여기다.
 * 화면에서 이진탐색으로 현재 줄을 찾으므로 정렬과 단조성이 깨지면 자막이 튄다.
 */
function normalize(cues) {
  if (!cues || typeof cues !== 'object') throw new Error('자막 데이터가 비어 있다')
  if (!Array.isArray(cues.lines)) throw new Error('자막에 lines 배열이 없다')

  const src = SRC.has(cues.src) ? cues.src : 'manual'
  const lines = cues.lines
    .map((line) => {
      const text = String(line?.text ?? '').trim()
      if (!text) return null
      const s = Number(line.s)
      const e = Number(line.e)
      if (!Number.isFinite(s) || s < 0) return null
      const words = Array.isArray(line.w)
        ? line.w
            .map((w) => [Number(w?.[0]), Number(w?.[1]), String(w?.[2] ?? '').trim()])
            .filter((w) => w[2] && Number.isFinite(w[0]) && Number.isFinite(w[1]) && w[1] >= w[0])
        : null
      return { s, e: Number.isFinite(e) && e > s ? e : s, text, ...(words?.length ? { w: words } : {}) }
    })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s)

  if (!lines.length) throw new Error('쓸 수 있는 자막 줄이 하나도 없다')

  // 앞 줄의 끝이 다음 줄 시작을 넘으면 잘라 준다. 겹치면 두 줄이 동시에 켜진다.
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].e > lines[i + 1].s) lines[i].e = lines[i + 1].s
  }

  return { v: FORMAT_VERSION, src, lines }
}

/** 자막 전체 길이(초). 마지막 줄의 끝. */
function durationOf(cues) {
  const lines = cues?.lines
  return Array.isArray(lines) && lines.length ? Number(lines[lines.length - 1].e) || 0 : 0
}

module.exports = {
  FORMAT_VERSION,
  MAX_CHARS,
  wordsToLines,
  alignSttToText,
  draftFromText,
  wordsFromText,
  distributeEvenly,
  normalize,
  durationOf,
}
