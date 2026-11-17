// 자연어 예약 누적 학습 — 2단계 "세어서 보여주기만 한다"
// (고도화 제안 #10, 설계·경계는 docs/nl-learning-design.md)
//
// 1단계(`13ce4aa`)가 승인 시점에 재료를 남기기 시작했다: schedule_id · approved_json ·
// edited_fields. 여기서는 **그 재료를 세기만 한다.** DB를 안 바꾸고, 사전을 안 바꾸고,
// 방송 동작을 안 바꾼다. 자동 반영은 설계가 명시적으로 금지한 것이다 —
// 요양원 방송에서 가장 찾기 어려운 실패가 조용한 오작동이라서다.
//
// **표본의 정의**(이 파일의 단일 출처):
//   status='approved' 이면서 edited_fields가 NULL이 아닌 행.
//   - 거절은 뺀다 — 왜 거절했는지가 없으면 "잘못 읽었다"인지 "마음이 바뀌었다"인지 모른다.
//   - edited_fields가 NULL인 옛 행도 뺀다. NULL은 "안 고쳤음"이 아니라 "모름"이다.
//     이 둘을 섞으면 수정률이 통째로 낮게 나온다(1단계 문서의 규칙).
'use strict'

const { isKnownWord } = require('./ontology')

// 표본이 이만큼 안 되면 지표를 아예 만들지 않는다. 서너 건으로 규칙을 세우면 그게 곧 오작동이다.
const DEFAULT_MIN_SAMPLES = 20
// 얼마나 거슬러 보나. 최근 것이 지금의 말버릇이다 — 반년 전 표현까지 같은 무게로 세면
// 이미 고쳐진 오독이 계속 상위에 남는다. 설정 키 nl_stats_window로 현장에서 조정한다.
const DEFAULT_WINDOW = 50
const DEFAULT_TOP_N = 10
// 한 번 나온 낱말은 후보가 아니다 — 목록이 방송 주제 낱말로 뒤덮여 쓸모가 없어진다.
const MIN_WORD_COUNT = 2

// 학습 재료로 비교하는 필드 — 1단계 approveDraft가 approved_json에 담는 것과 같은 목록이다.
const TRACKED_FIELDS = [
  'title', 'content', 'scheduled_time', 'repeat_start_date',
  'broadcast_type', 'main_volume', 'bgm_volume',
]

const FIELD_LABELS = {
  title: '제목',
  content: '내용',
  scheduled_time: '시각',
  repeat_start_date: '날짜',
  broadcast_type: '방송 유형',
  main_volume: '안내 음량',
  bgm_volume: 'BGM 음량',
}

// 조사 — **긴 것부터** 봐야 '에게서'가 '에'로 잘리지 않는다.
const JOSA = [
  '으로써', '에게서', '한테서', '이라고', '으로는', '에서는',
  '에게', '한테', '부터', '까지', '보다', '처럼', '같이', '마다', '조차', '으로', '이랑',
  '에서', '라고', '에는', '으로', '에다',
  '을', '를', '이', '가', '은', '는', '에', '로', '와', '과', '도', '만', '의', '랑', '께',
  // 복수 접미사도 뗀다 — '어르신'과 '어르신들'이 다른 낱말로 갈리면 둘 다 후보에 못 오른다
  '들',
]

// **서술어로 끝나는 토막은 후보에서 뺀다**(사용자 결정 2026-09-03, (나)안).
// 사전 후보는 명사다. 어미를 잘라 명사를 복원하려 들면 목록이 끝없이 늘고 자르다 명사가
// 깨진다 — 그래서 자르지 않고 통째로 버린다. 놓쳐도 손해가 작다(후보 하나 덜 보일 뿐).
//
// 두 갈래로 나눈 이유: '요·다·줘'로 끝나는 두 글자 낱말은 거의 없지만, '고·서·지·게·며'는
// 흔한 명사의 끝이다(광고·문서·편지·기계·연예). 그래서 그쪽은 세 글자부터 버린다.
// 한글로 쓴 시각도 후보가 아니다('두시'·'열한시'). 숫자로 쓴 것(11시)은 tokenize가 이미
// 버리는데, 한글로 쓰면 그대로 남아 상위 목록에 시각이 올라온다.
const TIME_WORD = /^(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두|스무)(시|시쯤|시경|시반)$/

const PREDICATE_TAIL_ANY  = /(줘|요|다|다고)$/
// '려'는 사용자가 준 목록에 없었는데, 데모 표본의 '보여드려'가 그대로 후보에 올라 넣었다.
// 세 글자부터라서 격려·배려·고려 같은 두 글자 명사는 안 다친다.
const PREDICATE_TAIL_LONG = /(고|게|서|며|지|려)$/

// 사전 밖이지만 "동의어 후보"가 될 수 없는 말들 — 시각·날짜·요청 표현.
// 파서는 이것들을 낱말 사전이 아니라 숫자·규칙으로 읽으므로 ontology에는 없다.
// 여기 없으면 상위 목록이 '내일'·'예약'으로만 채워져 아무것도 못 본다.
const STOPWORDS = new Set([
  '오늘', '내일', '모레', '글피', '어제', '이따', '나중', '지금', '당장', '즉시',
  '오전', '오후', '아침', '점심', '저녁', '새벽', '정오', '자정', '낮', '밤',
  '매일', '매주', '매달', '평일', '주말', '이번', '다음', '담주', '주말마다',
  '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일',
  '예약', '방송', '해줘', '해주세요', '주세요', '부탁', '부탁해', '부탁드립니다',
  '그리고', '그다음', '다시', '한번', '좀', '요청', '시간', '시각', '분에', '시에',
  // 수사('영상 하나 틀어줘') — 세는 말이지 사전 후보가 아니다
  '하나', '둘', '셋', '넷',
])

// 표본을 고르는 질의도 여기 둔다 — 위 주석의 "표본의 정의"와 한 몸이라, 라우터에 흩어지면
// 정의가 두 곳이 된다. 통계에 필요한 열만 읽는 것도 규칙이다: `SELECT *`로 끌어오면 나중에
// 열이 늘 때 원문·개인정보가 화면 쪽으로 딸려 나갈 길이 생긴다(설계 §3 원문 노출 금지).
// 최근 것부터 창(LIMIT) 만큼만 읽는다 — 부르는 쪽이 창 크기를 인자로 준다.
const SAMPLE_SQL = `
  SELECT status, raw_input, scheduled_time, broadcast_type, approved_json, edited_fields
    FROM schedule_drafts
   WHERE status = 'approved' AND edited_fields IS NOT NULL
   ORDER BY id DESC
   LIMIT ?
`

/** 문장을 낱말로 쪼갠다. 조사를 떼고, 숫자가 섞인 토막(11시·30초)은 버린다. */
function tokenize(text) {
  const out = []
  for (const raw of String(text ?? '').toLowerCase().split(/[^가-힣a-z0-9]+/)) {
    if (!raw) continue
    if (/\d/.test(raw)) continue          // '11시'·'30분' — 파서가 숫자로 읽는 것
    let w = raw
    for (const j of JOSA) {
      // 조사를 떼고도 두 글자는 남아야 낱말이다('의'만 남는 것을 막는다)
      if (w.length > j.length + 1 && w.endsWith(j)) { w = w.slice(0, -j.length); break }
    }
    if (w.length < 2) continue
    if (TIME_WORD.test(w)) continue
    if (PREDICATE_TAIL_ANY.test(w)) continue
    if (w.length >= 3 && PREDICATE_TAIL_LONG.test(w)) continue
    out.push(w)
  }
  return out
}

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text)
    return v ?? fallback
  } catch { return fallback }
}

/** 'HH:MM' → 분. 모양이 아니면 null. */
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 오전/오후 오독 — 분은 같고 시만 정확히 12시간 어긋난 수정. */
function isAmPmFlip(before, after) {
  const a = toMinutes(before), b = toMinutes(after)
  if (a === null || b === null) return false
  return a % 60 === b % 60 && Math.abs(a - b) === 12 * 60
}

function topCounts(map, topN) {
  return [...map.entries()]
    .sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])))
    .slice(0, topN)
}

/**
 * 초안 행 목록에서 학습 통계를 낸다. **순수 함수다** — DB도 시계도 안 본다(테스트가 표본을 짠다).
 *
 * @param {Array} rows schedule_drafts 행들(그대로)
 * @param {{minSamples?:number, topN?:number}} opts
 */
function computeNlStats(rows = [], opts = {}) {
  const minSamples = Number.isFinite(opts.minSamples) ? opts.minSamples : DEFAULT_MIN_SAMPLES
  const topN = Number.isFinite(opts.topN) ? opts.topN : DEFAULT_TOP_N

  const samples = rows.filter(r =>
    r && r.status === 'approved' && r.edited_fields !== null && r.edited_fields !== undefined)

  // 표본이 적으면 **아무 말도 안 한다.** 지표를 null로 두는 것과 0으로 두는 것은 다르다 —
  // 0은 "고친 적 없다"로 읽힌다.
  if (samples.length < minSamples) {
    return {
      samples: samples.length, minSamples, enough: false,
      fieldEdits: null, ampm: null, typeMisreads: null, unknownWords: null,
    }
  }

  const fieldCount = new Map()
  const typePairs = new Map()
  const wordCount = new Map()
  const wordWithTypeEdit = new Map()
  let ampmCount = 0
  let timeEdits = 0

  for (const row of samples) {
    const edited = parseJson(row.edited_fields, [])
    const approved = parseJson(row.approved_json, {})
    const editedSet = new Set(Array.isArray(edited) ? edited : [])

    for (const f of TRACKED_FIELDS) {
      if (editedSet.has(f)) fieldCount.set(f, (fieldCount.get(f) ?? 0) + 1)
    }

    if (editedSet.has('scheduled_time')) {
      timeEdits += 1
      if (isAmPmFlip(row.scheduled_time, approved.scheduled_time)) ampmCount += 1
    }

    const typeEdited = editedSet.has('broadcast_type')
      && row.broadcast_type && approved.broadcast_type
      && row.broadcast_type !== approved.broadcast_type
    if (typeEdited) {
      const key = `${row.broadcast_type}→${approved.broadcast_type}`
      typePairs.set(key, (typePairs.get(key) ?? 0) + 1)
    }

    // 낱말은 **문장당 한 번만** 센다. 한 문장에서 '체조'를 세 번 말했다고 세 건이 되면
    // 빈도가 사람 수가 아니라 말버릇을 재게 된다.
    const seen = new Set()
    for (const w of tokenize(row.raw_input)) {
      if (seen.has(w) || STOPWORDS.has(w) || isKnownWord(w)) continue
      seen.add(w)
      wordCount.set(w, (wordCount.get(w) ?? 0) + 1)
      if (typeEdited) wordWithTypeEdit.set(w, (wordWithTypeEdit.get(w) ?? 0) + 1)
    }
  }

  const n = samples.length
  const rate = (c) => Math.round((c / n) * 1000) / 10   // 소수 한 자리 %

  return {
    samples: n, minSamples, enough: true,

    // 어디를 자꾸 고치나 — 분모는 표본 전체
    fieldEdits: TRACKED_FIELDS
      .map(f => ({ field: f, label: FIELD_LABELS[f], count: fieldCount.get(f) ?? 0 }))
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(x => ({ ...x, rate: rate(x.count) })),

    // 확인 카드의 오전/오후 기본값을 조정할 근거
    ampm: { count: ampmCount, timeEdits, rate: rate(ampmCount) },

    // 되묻기 문구를 고칠 근거 — 어떤 유형을 어떤 유형으로 고쳤나
    typeMisreads: topCounts(typePairs, topN).map(([pair, count]) => {
      const [from, to] = pair.split('→')
      return { from, to, count }
    }),

    // 동의어 후보. withTypeEdit(그 낱말이 든 문장에서 사람이 유형까지 고친 횟수)가 함께 높으면
    // 사전에 넣을 값어치가 있다는 뜻이다 — 그냥 자주 나오는 말은 대개 방송 주제일 뿐이다.
    // 원문은 싣지 않는다(설계 §3: 집계 화면에 raw_input 전문을 띄우지 않는다).
    // **유형까지 고친 낱말이 위로 온다.** 빈도만으로 줄 세우면 그냥 자주 말하는 방송 주제
    // ('건강강좌')가 목록을 덮고, 정작 사전에 넣을 값어치가 있는 말이 아래로 밀린다.
    unknownWords: [...wordCount.entries()]
      .filter(([, c]) => c >= MIN_WORD_COUNT)
      .map(([word, count]) => ({ word, count, withTypeEdit: wordWithTypeEdit.get(word) ?? 0 }))
      .sort((a, b) => b.withTypeEdit - a.withTypeEdit || b.count - a.count
        || a.word.localeCompare(b.word))
      .slice(0, topN),
  }
}

// 설정에서 창·최소 표본을 읽어 표본을 뽑고 집계까지 한 번에 한다.
//
// **왜 여기 있나(2026-09-03)**: 이 세 줄(설정 읽기 → SAMPLE_SQL 실행 → computeNlStats)이
// 2단계 라우터와 3단계 제안기에 두 벌로 갈라져 있었다. 이 저장소에서 반복된 실패 유형이
// 정확히 그것이다 — "같은 일을 하는 둘"은 한쪽만 고치면 조용히 어긋난다. 화면이
// "아직 안 쌓였습니다"라고 말하는데 제안이 생기면 둘 다 못 믿게 된다.
// 값이 이상한 설정은 기본값으로 간다 — 설정 하나 때문에 화면이 깨지거나 제안이 폭주하면 안 된다.
function settingInt(db, key, fallback) {
  const { rawSetting } = require('./settingsRead')
  const n = Number(rawSetting(db, key))
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

function loadNlStats(db, opts = {}) {
  const windowN = opts.window ?? settingInt(db, 'nl_stats_window', DEFAULT_WINDOW)
  const minSamples = opts.minSamples ?? settingInt(db, 'nl_stats_min_samples', DEFAULT_MIN_SAMPLES)
  const rows = db.prepare(SAMPLE_SQL).all(windowN)
  return computeNlStats(rows, { minSamples, topN: opts.topN })
}

module.exports = {
  computeNlStats,
  loadNlStats,
  settingInt,
  SAMPLE_SQL,
  DEFAULT_MIN_SAMPLES,
  DEFAULT_WINDOW,
  TRACKED_FIELDS,
  FIELD_LABELS,
  // 테스트·진단용
  _test: { tokenize, isAmPmFlip },
}
