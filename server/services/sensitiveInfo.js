// 방송 민감정보 탐지기.
//
// 요양원 방송은 여러 직원이 자유 텍스트로 입력해 스피커로 내보낸다. 한 번 나간 방송은
// 되돌릴 수 없으므로, 개인정보가 섞이면 사전에 막는다.
//
//   차단(blocked) : 주민등록번호 / 휴대폰번호 / 생년월일 — 방송할 이유가 없는 정보
//   경고(warnings): 이름 — 어르신을 찾는 방송처럼 꼭 필요한 경우가 있어 막지 않고 확인만 받는다
//
// 설계에서 가장 신경 쓴 건 "막는 것"이 아니라 **엉뚱한 걸 막지 않는 것**이다:
//   - 아침 방송은 매일 "오늘은 2026년 8월 27일입니다"를 말한다. 날짜를 전부 막으면
//     매일 나가는 자동방송이 그대로 깨진다.
//   - 이름을 한글 2~3글자로 잡으면 "김치찌개", "박수 쳐주세요"까지 걸린다.
// 그래서 두 항목 모두 '맥락'을 함께 요구하도록 만들었다.
'use strict'

// 생년월일로 볼 연도 경계 — 이보다 최근 연도는 행사·공지 날짜로 보고 통과시킨다.
// (요양원 특성상 15년 이내 출생자를 방송할 일은 사실상 없다)
const BIRTH_YEAR_MARGIN = 15

// 흔한 성씨 — 이름 경고의 1차 조건. 여기 없는 성씨는 놓칠 수 있지만,
// 놓치는 쪽이 매번 헛경고가 뜨는 것보다 낫다(경고는 차단이 아니므로 비용이 작다).
const SURNAMES = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모탁국여진어은편용'

// 이름 뒤에 붙는 호칭
const TITLES = '님|씨|어르신|할머니|할아버지|보호자|선생님|여사|옹|환자분|보호자분'
// 이름 앞에 오는 맥락어
const PREFIXES = '어르신|입소자|보호자|환자|가족'

// 이름 후보를 캡처해서 아래 STOPWORDS로 한 번 더 거른다
const NAME_AFTER_RE  = new RegExp(`([${SURNAMES}][가-힣]{1,2})\\s*(?:${TITLES})`, 'g')
const NAME_BEFORE_RE = new RegExp(`(?:${PREFIXES})\\s+([${SURNAMES}][가-힣]{1,2})`, 'g')

// 한국 성씨는 대부분 한 글자라 흔한 낱말의 첫 글자와 겹친다. 그래서 구조만으로는
// "반드시 어르신", "선생님들께", "어르신 여러분" 같은 문장이 이름으로 잡힌다
// (실제 투약 안내·아침 인사 문구에서 발생한 오탐). 헛경고가 반복되면 직원이 확인창을
// 습관적으로 눌러버려 정작 진짜 이름을 놓치므로, 방송문에 자주 쓰이는 낱말은 제외한다.
const STOPWORDS = new Set([
  '반드시', '여러분', '선생', '선생님', '어르신', '보호자', '감사', '안내', '확인', '주의',
  '조심', '오늘', '내일', '어제', '지금', '잠시', '다시', '모두', '함께', '천천', '조용',
  '편안', '안전', '건강', '식사', '점심', '저녁', '아침', '방송', '준비', '시작', '종료',
  '이용', '사용', '참여', '신청', '정말', '이번', '박수', '김치', '고맙', '죄송', '실례',
  '문의', '연락', '자리', '시간', '장소', '식당', '병원', '간호', '직원', '가족', '면회',
  '성함', '얼굴', '호명', '투약', '예방', '사고', '경우', '상황', '기간', '변경', '취소',
  // 식사 기도문(「하나님 아버지…」)의 「하나님」이 성씨 「하」+이름+호칭 「님」으로 잡혀, 일과방송을
  // 저장할 때마다 확인창이 떴다(2026-11-01 검수 — 그 저장이 기도문 칸까지 검사하게 된 뒤).
  '하나',
])

// 번호 모양 — **숫자만 이어 붙인 것** 전체와 맞춘다(구분자·경계는 아래 `번호찾기` 가 다룬다).
// 주민등록번호 — 월(01-12)·일(01-31)·성별자리(1-4)를 함께 검사해 임의의 13자리 숫자 오탐을 막는다
const RRN_DIGITS   = /^\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[1-4]\d{6}$/
// 휴대폰 번호 — 01X + 7~8자리
const PHONE_DIGITS = /^01[016789]\d{7,8}$/

// 날짜 표기 두 가지 (연도를 캡처해 과거 여부를 판단한다)
const DATE_KO_RE  = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
const DATE_NUM_RE = /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g

const BIRTH_CONTEXT_RE = /생년월일|생일|출생|생신/

// ── 번호 찾기: **숫자 칸의 경계를 지키며** 이어 붙여 본다 ──────────────────────────────
// 막아야 하는 우회(스피커로는 전부 똑같이 읽힌다):
//   "0 1 0 - 1 2 3 4 - 5 6 7 8"  띄어 쓴 숫자      "０１０-１２３４-５６７８"  전각 숫자
//   "010-1234-5678 201호"        번호 뒤에 다른 숫자  "10시 30분 010 1234 5678"  번호 앞에 다른 숫자
//
// 예전엔 숫자 사이 구분자를 **통째로 지운 뒤** 정규식을 댔다. 그러면 마지막 줄의 두 경우에서
// 번호와 옆 숫자가 한 덩어리(「01012345678201」)로 붙어 번호 모양이 깨졌고, 방송 검사·Gemini
// 가림·잔여 검사가 함께 놓쳤다(전문가 2차 검토 4-1).
//
// 이제 원문의 숫자 덩어리(= **숫자 칸**)를 원래 위치와 함께 모으고, 구분자로만 이어진 이웃 칸들을
// **어느 칸에서 시작해 어느 칸에서 끝나든** 이어 붙여 번호 모양과 통째로 맞춰 본다. 칸 안을 자르지는
// 않으므로 「2026 08 27」 같은 날짜가 엉뚱하게 잘려 번호가 되지 않는다.
//
// **구분자 목록은 이 한 곳에 둔다**(2026-11-01 검수). 한글 IME 전각 모드는 숫자와 함께 하이픈도
// 전각(－ U+FF0D)으로 넣는다.
//   \s . -  · ‐‑‒–—― (U+2010~2015) · － ． (전각) · − (U+2212 수학 빼기) · ﹣ (U+FE63)
const 번호구분자 = /[\s.\-‐-―－．−﹣]/
const 구분자만 = new RegExp(`^${번호구분자.source}+$`)
// 전각 숫자는 같은 자리의 반각 숫자로 — 한 글자가 한 글자로 바뀌므로 위치가 그대로다.
const 반각숫자 = (text) => String(text ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))

/**
 * 글에서 주민등록번호·휴대폰번호를 **원문 위치**와 함께 찾는다.
 *
 * @param {string} text
 * @param {(사이: string) => boolean} [이어지나]  두 숫자 칸 사이 글자가 이것을 만족하면 같은 번호의
 *        조각으로 본다. 기본은 번호 구분자만. Gemini 잔여 검사는 더 느슨한 것을 넘긴다.
 * @returns {Array<{type:'rrn'|'phone', start:number, end:number, digits:string}>}
 *          겹치지 않는다. 같은 칸에서 시작하면 가장 긴 것을 고른다.
 */
function 번호찾기(text, 이어지나 = (사이) => 구분자만.test(사이)) {
  const 글 = 반각숫자(text)
  const 칸들 = [...글.matchAll(/\d+/g)].map(m => ({ s: m.index, e: m.index + m[0].length, d: m[0] }))
  const out = []
  let i = 0
  while (i < 칸들.length) {
    let 찾음 = null
    let 붙인 = ''
    for (let j = i; j < 칸들.length; j++) {
      if (j > i && !이어지나(글.slice(칸들[j - 1].e, 칸들[j].s))) break
      붙인 += 칸들[j].d
      if (붙인.length > 13) break        // 주민번호(13)보다 길면 더 볼 것이 없다
      const type = RRN_DIGITS.test(붙인) ? 'rrn' : PHONE_DIGITS.test(붙인) ? 'phone' : null
      if (type) 찾음 = { type, start: 칸들[i].s, end: 칸들[j].e, digits: 붙인, 끝칸: j }
    }
    if (찾음) { out.push({ type: 찾음.type, start: 찾음.start, end: 찾음.end, digits: 찾음.digits }); i = 찾음.끝칸 + 1 }
    else i++
  }
  return out
}

// 민감값이 로그·응답에 통째로 남지 않도록 일부만 남긴다
function mask(s) {
  const str = String(s)
  if (str.length <= 4) return '*'.repeat(str.length)
  return str.slice(0, 2) + '*'.repeat(Math.max(0, str.length - 4)) + str.slice(-2)
}

const 번호이름 = { rrn: '주민등록번호', phone: '휴대폰번호' }

// 날짜가 '생년월일'로 보이는지 판단.
// (1) 근처에 생년월일/생일/출생 같은 맥락어가 있거나
// (2) 맥락어가 없어도 연도가 (올해 - 15) 이전이면 생년월일로 본다.
function looksLikeBirthDate(text, matchIndex, year) {
  const nowYear = new Date().getFullYear()
  if (year > nowYear) return false           // 미래 날짜는 생일이 아님
  if (year <= nowYear - BIRTH_YEAR_MARGIN) return true

  // 맥락어는 날짜 앞뒤 20자 안에서만 인정 — 문서 전체에 '생일'이 한 번 있다고
  // 무관한 날짜까지 막지 않도록 범위를 좁힌다.
  const from = Math.max(0, matchIndex - 20)
  const near = text.slice(from, matchIndex + 20)
  return BIRTH_CONTEXT_RE.test(near)
}

function collectBirthDates(out, text) {
  for (const re of [DATE_KO_RE, DATE_NUM_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const year  = parseInt(m[1], 10)
      const month = parseInt(m[2], 10)
      const day   = parseInt(m[3], 10)
      if (month < 1 || month > 12 || day < 1 || day > 31) continue
      if (looksLikeBirthDate(text, m.index, year)) {
        out.push({ type: 'birth', label: '생년월일', sample: mask(m[0]) })
      }
    }
  }
}

/**
 * 찾아낸 **이름 원문**을 순서대로 돌려준다.
 *
 * `detectSensitive` 의 `warnings` 는 이미 `mask()` 를 거쳐 `**` 가 되어 있어 **되돌릴 수
 * 없다.** 그런데 아래 `방송용가리기` 는 그 자리를 성씨로 바꾸려고 **진짜 글자**가 필요하다.
 * 두 곳이 각자 정규식을 돌리면 언젠가 한쪽만 고쳐져 **경고되는 이름과 가려지는 이름이
 * 달라진다** — 그 어긋남은 소리로 나가야 드러난다. 그래서 찾는 자리는 여기 하나다.
 */
function 이름찾기(text) {
  const out  = []
  const seen = new Set()
  for (const re of [NAME_AFTER_RE, NAME_BEFORE_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const name = (m[1] || '').trim()
      if (!name || STOPWORDS.has(name) || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/**
 * 방송 텍스트에서 민감정보를 찾는다.
 * @returns {{ blocked: Array<{type,label,sample}>, warnings: Array<{type,label,sample}> }}
 *          blocked가 하나라도 있으면 방송을 진행해서는 안 된다.
 */
function detectSensitive(text) {
  const blocked = []
  const warnings = []
  if (typeof text !== 'string' || !text.trim()) return { blocked, warnings }

  // 번호류는 숫자 칸 경계를 지키며 찾는다(공백·전각·옆 숫자 우회 차단 — `번호찾기`).
  // 주민번호를 앞에 둔다 — 응답 문구가 예전과 같은 순서로 나오게.
  const 번호들 = 번호찾기(text)
  for (const type of ['rrn', 'phone']) {
    for (const b of 번호들) if (b.type === type) blocked.push({ type, label: 번호이름[type], sample: mask(b.digits) })
  }
  collectBirthDates(blocked, text)

  // 이름은 성씨+이름 뒤에 호칭이 오거나, 앞에 맥락어가 있을 때만 경고하고,
  // 그마저도 흔한 낱말(STOPWORDS)이면 제외한다 — 찾는 규칙은 `이름찾기` 한 곳이다.
  for (const name of 이름찾기(text)) {
    warnings.push({ type: 'name', label: '이름', sample: mask(name) })
  }

  return { blocked, warnings }
}

// 사람이 읽는 한 줄 요약 (400/409 응답 메시지용)
function describe(items) {
  const labels = [...new Set(items.map(i => i.label))]
  return labels.join(', ')
}

// 마지막 글자의 받침 유무로 조사를 고른다 — "이름이 / 휴대폰번호가"처럼 자연스럽게.
// (안 하면 "이름이(가) 포함되어" 같은 어색한 안내문이 그대로 직원에게 보인다)
function withParticle(word, withJong, withoutJong) {
  const last = word.charCodeAt(word.length - 1)
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) return `${word}${withJong}`
  return `${word}${(last - 0xac00) % 28 !== 0 ? withJong : withoutJong}`
}

/**
 * 방송으로 나갈 문구 한 벌을 검사하고 **응답까지 정한다**.
 *
 * 판정을 이 한 곳에 모으는 이유(CC-037): 세 경로가 각자 라우트 안에서 detectSensitive를
 * 부르고 메시지를 따로 만들고 있었는데, 그중 AI 초안 승인 경로(approveDraft)는
 * insertSchedule을 직접 불러 **검사 자체를 건너뛰었다.** 검사 붙이는 자리가 라우트면
 * 라우트를 안 타는 경로가 생길 때마다 또 샌다.
 *
 * @param {string} text  방송으로 나갈 문구
 * @param {{acknowledged?: boolean, verb?: string}} opts
 *        acknowledged: 사람이 경고를 확인했는가(ackWarnings)
 *        verb: 안내문에 들어갈 동사 — '방송'이면 "방송할 수 없습니다 / 방송하시겠습니까?"
 * @returns {{ok: true} | {ok: false, status: 400|409, body: {error, blocked?, warnings?, needsConfirm?}}}
 *          body는 그대로 res.status(status).json(body)로 내보내면 된다.
 */
function checkSensitive(text, { acknowledged = false, verb = '저장' } = {}) {
  const { blocked, warnings } = detectSensitive(text ?? '')
  if (blocked.length) {
    return {
      ok: false, status: 400,
      body: {
        error: `${verb}할 수 없습니다 — 개인정보(${describe(blocked)})가 포함되어 있습니다. 해당 내용을 빼고 다시 시도해주세요.`,
        blocked,
      },
    }
  }
  if (warnings.length && !acknowledged) {
    return {
      ok: false, status: 409,
      body: {
        error: `방송 내용에 ${withParticle(describe(warnings), '이', '가')} 포함되어 있습니다. ${verb}하시겠습니까?`,
        warnings,
        needsConfirm: true,
      },
    }
  }
  return { ok: true }
}

/**
 * **사람에게 물어볼 수 없는 자리**에서 쓰는 가림 (사용자 결정 2026-09-15).
 *
 * ── 왜 따로 필요한가 ────────────────────────────────────────────────────────
 * `checkSensitive` 는 **되묻는다**(409 → "진행할까요?"). 그러려면 화면 앞에 사람이 있어야
 * 한다. 그런데 아침 종합 방송(07:50)은 **무인으로** 구글 캘린더를 읽어 그 제목을 그대로
 * 말한다(`morning.js`). 거기엔 물어볼 사람이 없다 — 그래서 그 경로는 여태 **검사 자체를
 * 안 지났다.** 캘린더에 「김영희 어르신 생신」이라고 적어 두면 그 글자가 그대로
 * 음성 합성으로 나가고 전관 스피커로 방송됐다.
 *
 * ── 무엇을 하나 ─────────────────────────────────────────────────────────────
 *  · **차단 항목**(주민등록번호·휴대폰번호·생년월일) → `텍스트: null`. 그 줄은 **통째로
 *    안 읽는다.** 이건 방송할 이유가 없는 정보라 가려서 읽을 것도 아니다.
 *  · **이름** → **성만 남긴다.** 「김영희 어르신」 → 「김 어르신」.
 *
 * ── `○` 를 쓰지 않는 이유 ──────────────────────────────────────────────────
 * 화면이면 「김○○」이 맞다. 그런데 **이 글자는 소리로 나간다** — 음성 합성기는 `○` 를
 * 글자로 읽어서 *"김 동그라미 동그라미 어르신"* 이 된다. 가리려다 더 이상한 방송이 된다.
 * 성씨만 남기면 「김 어르신」으로 **한국어로 자연스럽고**, 누구인지도 안 드러난다.
 *
 * **화면·캘린더 원본은 안 건드린다**(사용자 결정) — 직원은 누구인지 알아야 한다.
 * 가리는 것은 **스피커로 나가는 문장 하나**뿐이다.
 *
 * @param {string} text
 * @returns {{텍스트: string|null, 뺌: boolean, 가린이름: string[], 사유: string[]}}
 *          `가린이름` 은 **이미 `mask()` 를 거친 것**이다 — 경보·로그에 원문을 남기지 않는다.
 */
function 방송용가리기(text) {
  const s = String(text ?? '')
  const { blocked } = detectSensitive(s)
  if (blocked.length) {
    return { 텍스트: null, 뺌: true, 가린이름: [], 사유: [...new Set(blocked.map(b => b.label))] }
  }

  const 이름들 = 이름찾기(s)
  if (!이름들.length) return { 텍스트: s, 뺌: false, 가린이름: [], 사유: [] }

  let out = s
  for (const name of 이름들) {
    // 성씨는 한 글자다(이 저장소의 `SURNAMES` 가 전부 한 글자). 두 글자 성은 못 다루지만,
    // 그때는 이름 한 글자가 더 남을 뿐이고 **덜 가려지는 쪽으로는 안 틀린다** —
    // 「남궁민」이면 「남」이 남는다.
    out = out.split(name).join(name.slice(0, 1))
  }
  return { 텍스트: out, 뺌: false, 가린이름: 이름들.map(mask), 사유: [] }
}

// **번호 찾기를 밖으로 낸다**(2026-09-15, 2026-11-10 `번호찾기` 로 바꿈). `promptPrivacy.js` 가
// Gemini 로 나가는 글에서 같은 것을 뺀다 — 규칙을 거기 복사하면 한쪽만 고쳐지는 날 한쪽만 샌다.
// **생년월일은 안 넣는다.** 날짜는 프롬프트 어디에나 있고(「오늘 날짜: 2026-09-15」),
// 빼면 자연어 예약 파싱이 통째로 깨진다. 날짜 차단은 방송 경계에서만 한다.
module.exports = { detectSensitive, checkSensitive, describe, withParticle, 이름찾기, 방송용가리기, 번호찾기, 번호구분자 }
