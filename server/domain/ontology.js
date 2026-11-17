// 방송 유형 온톨로지 — "언제"가 아니라 **"무엇을 방송하는가"**를 문장에서 읽어내는 어휘 사전.
//
// 왜 필요했나: scheduler.js(fireSchedule)는 chime/audio/video/bgm/flow/text
// 여섯 가지를 실행할 줄 아는데, 자연어로 만든 예약은 두 경로(규칙 파서 schedulePhrase.js,
// AI 파서 scheduleDrafts.js) 모두 broadcast_type을 'text'로만 만들고 있었다. 그래서
// "저녁 6시에 차임벨 울려줘"라고 하면 차임벨이 아니라 TTS가 그 문장을 그대로 읽었다.
// 실행 분기는 이미 다 있는데 자연어에서 도달할 방법만 없던 셈이라, 문장의 낱말과
// broadcast_type을 잇는 사전 하나를 두는 것으로 여섯 갈래가 한꺼번에 열린다.
//
// 왜 한 파일로 빼는가: 같은 어휘를 규칙 파서와 Gemini 프롬프트가 동시에 봐야 한다.
// 흩어두면 "차임벨 동의어 추가" 같은 수정이 두 곳에서 따로 놀고, 같은 문장인데 어느
// 경로로 들어왔느냐에 따라 결과가 달라진다.
//
// 원칙(schedulePhrase.js와 동일): **못 읽은 건 조용히 추측하지 않는다.** 낱말만 걸리고
// 확신이 없으면 유형을 바꾸되 confidence: 'weak'으로 알려서 사람이 확인 카드에서 보게 한다.
'use strict'

// 재생 동작을 가리키는 신호 — 이게 매체 낱말 뒤에 붙으면 "그걸 틀어달라"는 뜻이 분명하다.
// 꼬리말(주세요/줘)까지 함께 잡아야 내용에서 걷어낼 때 "줘"가 남지 않는다.
// 대안 순서 주의: 긴 것(재생해)이 짧은 것(재생)보다 앞에 와야 온전히 매칭된다.
const ACTION_CUES = /(틀어|재생해|재생|울려|송출해|송출|내보내|켜)\s*(주세요|주라|줘요|줘)?/

// 반대로 이게 있으면 TTS 안내 방송일 가능성이 높다 — "음악 감상 프로그램 안내"처럼
// 매체 낱말이 방송 '주제'로만 쓰인 경우를 유형 변경에서 제외하는 데 쓴다.
const TTS_CUES = /(안내|공지|알림|멘트|방송문|말해|읽어)/

// 재생 동작은 **매체 낱말 바로 뒤에** 있어야 그 낱말을 가리키는 것으로 본다.
// 처음에는 문장 어디든 동작이 있으면 확신(strong)으로 쳤는데, 그러면
// "음악 감상 프로그램 안내를 틀어줘"가 BGM이 돼서 안내 방송이 통째로 사라진다.
// 3글자는 조사와 짧은 부사("음악을 좀 틀어줘")까지만 허용하는 폭이다 — 더 늘리면
// 앞쪽 매체 낱말이 뒤 낱말의 '틀어'를 가로채 엉뚱한 유형으로 잡힌다.
const MAX_ACTION_GAP = 3

// 낱말과 재생 동작 사이에 **조사·부사만** 끼었다면, 글자 수가 좀 넘더라도 그 동작은 이
// 낱말을 가리킨다고 본다.
//
// 왜 필요했나(2026-08-29 리뷰): "음악을 좀 틀어줘"가 weak으로 떨어졌다. "음악" 끝과
// "틀어줘" 사이가 "을 좀 "(4자)라 3을 넘기 때문이다. 정작 "음악 좀 틀어줘"(2자)는 strong이라
// 조사 하나 붙였다고 판정이 갈렸다.
//
// 숫자만 4로 올리면 "음악을 조금 틀어줘"(5자)가 또 걸린다. 조사·부사는 얼마든지 길어질 수
// 있어서 글자 수로는 끝이 없다. 대신 **사이에 낀 것이 무엇인지**를 본다 — 조사·공백·정도
// 부사뿐이면 붙은 것으로 보고, 다른 낱말이 끼면 예전처럼 끊는다.
// ("음악 방송 틀어줘"는 사이에 '방송'이 있어 예전과 똑같이 안 붙는다.)
const FILLER_BETWEEN = /^[을를이가은는도만와과랑\s]*(좀|조금|한번|한 번|잠깐|약간|살짝|다시|얼른|빨리)?[을를\s]*$/
// 조사·부사만 끼어도 이만큼을 넘으면 문장이 딴 데로 샌 것으로 본다
const MAX_FILLER_GAP = 8

// 저장된 흐름(flow_sequences)을 고르라는 신호. 흐름은 이름을 맞춰야 실행할 수 있는데,
// 이름이 "체조"처럼 짧고 흔한 말일 수 있어서 이름만으로는 "체조 안내"까지 흐름으로
// 오인한다. 그래서 흐름은 **이름 + 이 신호가 함께 있을 때만** 고른다.
const FLOW_CUES = /(흐름|순서|시퀀스|실행)/
// 「흐름을 부르려던 신호말」 — **이 말만 남고 읽을 것이 하나도 없을 때** 쓰는 목록이다
// (schedulePhrase 의 `flow_unnamed`). 위 `FLOW_CUES` 보다 넓다: 「자동」·「자동방송」이 더 있다.
//
// **detectFlow 에는 안 쓴다.** 거기에 「자동」을 넣으면 "자동으로 틀어줘" 같은 문장이 저장된
// 흐름으로 끌려간다. 여기서는 반대로 **아무것도 안 읽히는 경우만** 보므로 넓혀도 안전하다.
// 사용자 원문(2026-09-13): *"순서, 흐름, 자동 할 때 왜 저거 안내방송으로 TTS 로 읽히냐"*.
const FLOW_ONLY_CUES     = /(흐름|순서|시퀀스|실행|자동방송|자동)/
const FLOW_ONLY_CUES_ALL = /(흐름|순서|시퀀스|실행|자동방송|자동)/g

// 흐름을 "실행해달라"는 분명한 동사. 안내 방송 신호(TTS_CUES)가 함께 있는데 이게 없으면
// 흐름 이름이 방송 주제로 쓰인 것으로 본다("체조 순서 안내 방송" → 흐름이 아니라 TTS).
const FLOW_RUN_VERB = /(실행|재생|틀어)/

// 개념 목록. **순서가 우선순위다** — 확신(strong) 매칭끼리 겹칠 때 위에 있는 것이 이긴다.
//  - '음원'이 '음악'보다 위: "안내 음원"이 BGM으로 새지 않게
//  - needs: 'audio_file'은 audio_files 테이블에서 파일을 골라야 실행되는 유형.
//    문장만으로는 어느 파일인지 알 수 없으므로 자동으로 정하지 않고 사람에게 넘긴다.
//
// 동의어를 늘릴 때 주의: 낱말이 넓을수록 오탐이 는다. 위의 근접 규칙과 TTS_CUES가
// 막아주지만, '종'·'벨'처럼 다른 단어에 흔히 끼어드는 한 글자는 넣지 않는다
// ('종'은 "종료"·"종이"에, '벨'은 "벨트"에 걸린다).
const CONCEPTS = [
  {
    id: 'chime',
    broadcastType: 'chime',
    label: '차임벨',
    nouns: ['차임벨', '차임', '종소리', '벨소리', '식사종', '알림음', '시그널'],
    needs: null,
  },
  {
    id: 'audio',
    broadcastType: 'audio',
    label: '음원',
    nouns: ['음원 파일', '음원파일', '음원', '음성 파일', '음성파일', '녹음 파일', '녹음파일', '녹음', '오디오'],
    needs: 'audio_file',
  },
  {
    id: 'video',
    broadcastType: 'video',
    label: '영상',
    nouns: ['동영상', '영상', '비디오', '영화'],
    needs: 'audio_file',
  },
  {
    id: 'bgm',
    broadcastType: 'bgm',
    label: 'BGM',
    nouns: ['배경음악', '배경 음악', 'bgm', '음악', '노래', '클래식', '찬송가', '트로트', '가요'],
    needs: null,
  },
]

// ── 두 번째 축: 설정 수식어(MODIFIERS) ───────────────────────
// CONCEPTS가 "무엇을 방송하는가"라면 이쪽은 "어떻게 내보내는가"다.
//   "오후 두시에 프로그램 안내해주고, 볼륨은 잔잔하게 시작해줘"
//     → 예약 1건 + 그 예약에만 적용되는 BGM 볼륨
//
// 설계 원칙 두 가지:
//  1) **시스템 설정을 바꾸지 않는다.** 수식어는 예약 행(schedules.bgm_volume)에만 저장되고
//     방송 이벤트에 실린다. 전역 볼륨을 임시로 바꿨다가 되돌리는 방식은, 되돌리기 전에
//     서버가 죽거나 다음 예약이 발동하면 값이 남는다(되돌릴 상태를 아예 만들지 않는다).
//  2) **정성어의 수치는 여기에 박지 않는다.** "잔잔하게"가 몇 %인지는 스피커·공간마다 달라서
//     현장에서 조정할 수 있어야 한다. 이 파일은 낱말 → 단계(quiet/normal/loud)까지만 정하고,
//     단계 → 숫자는 domain/volume.js가 settings에서 읽어 호출부가 주입한다.
const VOLUME_LEVELS = [
  { level: 'quiet',  label: '잔잔하게', words: ['잔잔하게', '잔잔히', '조용하게', '조용히', '작게', '낮게', '은은하게', '은은히'] },
  // '보통/평소대로'는 "시스템 기본값을 쓰라"는 뜻이라 숫자를 만들지 않는다
  { level: 'normal', label: '보통으로', words: ['보통으로', '보통', '평소대로', '평소처럼', '기본으로'] },
  { level: 'loud',   label: '크게',    words: ['크게', '크게크게', '우렁차게', '잘 들리게', '시끄럽게'] },
]

// 볼륨 이야기를 하고 있다는 신호. 이게 없으면 정성어를 볼륨으로 읽지 않는다 —
// "어르신들 조용히 해주세요"는 방송 문구지 볼륨 지시가 아니다.
const VOLUME_TARGET = /(볼륨|음량|소리|음악|노래|bgm|배경음)/i

// 어느 소리를 말하는지 가리키는 낱말.
//  main = 그 방송의 주 소리(안내 음성·차임벨·음원·영상), bgm = 배경 음악
// 명시하지 않으면 bgm으로 본다 — 요양원에서 **안내 방송을 작게 만드는 것이 훨씬 위험하기** 때문이다
// (어르신이 못 듣는다). 대신 confidence를 낮춰 화면이 "안내 음성이 아니라 BGM입니다"라고 묻게 한다.
const VOLUME_CHANNEL_WORDS = [
  { channel: 'bgm',  label: 'BGM',      words: ['배경음악', '배경 음악', '배경음', 'bgm', '음악', '노래'] },
  { channel: 'main', label: '안내 음성', words: ['안내 음성', '안내음성', '음성', '목소리', '말소리', '안내 방송 소리', '방송 소리'] },
]

// "볼륨 40으로" / "음량은 55%" — 숫자를 직접 말한 경우.
// 꼬리(%/퍼센트/으로/로)까지 함께 잡아야 내용에서 걷어낼 때 "으로"가 제목에 남지 않는다.
// 앞뒤 경계 두 개가 오탐을 막는다:
//  - (?<![가-힣]) : 종소리/벨소리/말소리의 '소리' 부분 문자열에 걸리지 않게 — "종소리 30초
//    울려줘"의 30이 볼륨 30%로 저장되고 내용이 "30초"로 망가지던 실사고
//  - (?!초|분|번…) : "방송 소리 30초"처럼 숫자가 횟수·시간 단위면 볼륨이 아니다
const VOLUME_NUMBER = /(?<![가-힣])(볼륨|음량|소리)\s*(?:은|는|을|를)?\s*(\d{1,3})(?!\s*(?:초|분|번|곡|개|회))\s*(?:%|퍼센트)?\s*(?:으로|로)?/i

/**
 * 문장에서 볼륨 지시를 읽는다.
 *
 * @param {string} text
 * @param {{quiet:number, loud:number}} levels 단계별 수치(호출부가 설정에서 읽어 넘긴다)
 * @returns {{channel, level, value, label, matched, strip}|null}
 *          value가 null이면 "시스템 기본값을 쓰라"는 뜻(normal).
 *          channel은 지금 'bgm'만 지원한다 — 예약 행에 볼륨을 담을 수 있는 채널이 BGM뿐이고,
 *          안내 음성은 재생 시점에 전역값을 읽으므로 예약별로 나눌 자리가 아직 없다.
 */
function detectVolume(text, levels = {}) {
  if (typeof text !== 'string' || !text.trim()) return null

  // 어느 소리를 말하는지 먼저 본다. 못 찾으면 bgm으로 두되 확신하지 않는다.
  let channel = 'bgm'
  let channelExplicit = false
  outer:
  for (const spec of VOLUME_CHANNEL_WORDS) {
    for (const word of [...spec.words].sort((a, b) => b.length - a.length)) {
      if (new RegExp(escapeRe(word), 'i').test(text)) {
        channel = spec.channel
        channelExplicit = true
        break outer
      }
    }
  }

  // 숫자를 직접 말했으면 그게 가장 분명하다
  const num = text.match(VOLUME_NUMBER)
  if (num) {
    const n = Number(num[2])
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      return {
        channel, channelExplicit, level: 'exact', value: n,
        label: `${n}%`, matched: num[0], strip: [num[0]],
      }
    }
  }

  // 채널을 짚어 말했으면("안내 음성은 크게") 그 자체가 소리 이야기라는 신호다
  if (!channelExplicit && !VOLUME_TARGET.test(text)) return null

  for (const spec of VOLUME_LEVELS) {
    // 긴 낱말부터 봐야 '조용하게'가 '조용히'에 앞서 온전히 잡힌다
    for (const word of [...spec.words].sort((a, b) => b.length - a.length)) {
      const hit = text.match(new RegExp(`(?:(?:볼륨|음량|소리)\\s*(?:은|는|을|를)?\\s*)?${escapeRe(word)}`, 'i'))
      if (!hit) continue
      const value = spec.level === 'normal' ? null : clampLevel(levels[spec.level])
      return {
        channel, channelExplicit, level: spec.level, value,
        label: spec.label, matched: hit[0], strip: [hit[0]],
      }
    }
  }
  return null
}

function clampLevel(value) {
  const n = typeof value === 'number' ? value : parseInt(value, 10)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

// scheduler.js가 실제로 실행할 줄 아는 유형(= 이 사전이 만들어도 되는 값)
const KNOWN_BROADCAST_TYPES = ['text', 'chime', 'audio', 'video', 'bgm', 'flow']

// 재생할 파일(audio_files)을 골라야 소리가 나는 유형 — CONCEPTS에서 파생시켜 목록이
// 두 곳에서 따로 놀지 않게 한다.
const NEEDS_AUDIO_FILE_TYPES = CONCEPTS.filter(c => c.needs === 'audio_file').map(c => c.broadcastType)

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// "지금 당장 안내방송 해줘"의 즉시 신호. '바로'는 일반 문장에 너무 흔해서("바로 안내드립니다")
// 일부러 뺀다 — 예약 문장이 즉시 방송으로 오독되는 쪽이 시각을 못 읽는 쪽보다 위험하다.
const IMMEDIATE_CUES = /지금|당장|즉시/

// 즉시 방송 요청인가. 시각이나 반복 표현이 읽혔으면 즉시가 아니다 —
// "지금부터 매일 오후 3시에"의 '지금'은 시작 시점이지 즉시 실행이 아니다.
// 판정을 이 한 곳에 두는 이유: 규칙 파서와 AI 초안 경로가 각자 판정하면
// 같은 문장이 화면에 따라 즉시가 되기도, 예약이 되기도 한다.
function isImmediateRequest(text, { hasTime = false, hasRepeat = false } = {}) {
  if (hasTime || hasRepeat) return false
  return typeof text === 'string' && IMMEDIATE_CUES.test(text)
}

function isKnownBroadcastType(type) {
  return KNOWN_BROADCAST_TYPES.includes(type)
}

function needsAudioFile(type) {
  return NEEDS_AUDIO_FILE_TYPES.includes(type)
}

// from 위치 바로 뒤(MAX_ACTION_GAP 이내)에 재생 동작이 있으면 그 문자열을 돌려준다.
function findActionAfter(text, from) {
  const scan = new RegExp(ACTION_CUES.source, 'g')
  let m
  while ((m = scan.exec(text)) !== null) {
    if (m.index < from) continue          // 낱말보다 앞에 있는 동작은 이 낱말을 가리키지 않는다
    const between = text.slice(from, m.index)
    if (between.length <= MAX_ACTION_GAP) return m[0]                                   // 예전 규칙 그대로
    if (between.length <= MAX_FILLER_GAP && FILLER_BETWEEN.test(between)) return m[0]   // 조사·부사만 끼었다
    return null                           // 뒤로 갈수록 더 멀어지므로 볼 것도 없다
  }
  return null
}

// 한 개념 안에서 가장 잘 맞는 낱말을 고른다.
// 긴 낱말('음원 파일')을 먼저 보고, 재생 동작이 붙은 낱말이 있으면 그것을 우선한다.
function matchConcept(text, concept) {
  let weak = null
  for (const noun of [...concept.nouns].sort((a, b) => b.length - a.length)) {
    const hit = text.match(new RegExp(escapeRe(noun), 'i'))
    if (!hit) continue
    const found = { concept, matched: hit[0], start: hit.index, end: hit.index + hit[0].length }
    const action = findActionAfter(text, found.end)
    if (action) return { ...found, action }
    weak = weak || { ...found, action: null }
  }
  return weak
}

// 두 매칭이 문장에서 같은 자리를 가리키는가 — "배경 음악"과 그 안의 "음악"처럼 한쪽이
// 다른 쪽을 품고 있으면 서로 다투는 후보가 아니라 같은 말이다.
function overlaps(a, b) {
  return a.start < b.end && b.start < a.end
}

/**
 * 문장에서 방송 유형을 읽는다.
 * @param   {string} text 사용자가 입력한 한 문장
 * @returns {{id, broadcastType, label, needs, matched, strip, confidence, alternatives}|null}
 *          매체를 가리키는 말이 없으면 null(= 기본값 'text' TTS 방송).
 *          confidence: 'strong'(낱말 바로 뒤에 재생 동작) | 'weak'(낱말만 — 사람 확인 필요)
 *          alternatives: 문장의 **다른 자리**에서 다른 유형도 걸린 경우 그 후보들.
 *            비어 있지 않으면 우리가 정할 일이 아니므로 호출부가 사람에게 확인받아야 한다.
 */
function detectBroadcastType(text) {
  if (typeof text !== 'string' || !text.trim()) return null

  const found = CONCEPTS.map(concept => matchConcept(text, concept)).filter(Boolean)
  if (!found.length) return null

  // 재생 동작이 붙은 매칭을 우선하고, 그것끼리 겹치면 CONCEPTS 선언 순서로 정한다.
  const best = found.find(f => f.action) || found[0]

  // 재생 동작 없이 낱말만 걸렸는데 안내 방송 신호까지 있으면, 그 낱말은 방송 '주제'다.
  // ("음악 감상 프로그램 안내" → BGM이 아니라 TTS 안내 방송)
  if (!best.action && TTS_CUES.test(text)) return null

  // 문장의 **다른 자리**에서 다른 유형이 또 걸렸으면 어느 쪽인지 우리가 정할 일이 아니다.
  // "음악이랑 영상 틀어줘"처럼 두 유형이 다 걸리면 조용히 하나를 고르지 말고
  // 후보를 같이 돌려줘서 사람이 확인하게 한다.
  // 자리가 겹치는 매칭('배경 음악' 안의 '음악')은 다투는 후보가 아니라 같은 말이므로 뺀다.
  const alternatives = found
    .filter(f => f.concept.broadcastType !== best.concept.broadcastType && !overlaps(f, best))
    .map(f => ({ broadcastType: f.concept.broadcastType, label: f.concept.label }))

  return {
    id:            best.concept.id,
    broadcastType: best.concept.broadcastType,
    label:         best.concept.label,
    needs:         best.concept.needs,
    matched:       best.matched,
    // 내용·제목에서 걷어낼 조각들 — 남겨두면 "차임벨 울려줘"가 그대로 제목이 된다
    strip:         [best.matched, best.action].filter(Boolean),
    confidence:    best.action ? 'strong' : 'weak',
    alternatives,
  }
}

/**
 * 문장에서 저장된 흐름(flow_sequences)을 고른다.
 * 사전(CONCEPTS)과 달리 DB에 있는 이름을 받아야 하므로 호출부가 목록을 넘긴다 —
 * 이 파일은 DB를 모르는 채로 두어 테스트에서 그대로 쓸 수 있게 한다.
 *
 * @param {string} text
 * @param {Array<{id:number, name:string}>} flows  flow_sequences 목록
 * @returns {{flowId, name, matched, alternatives}|null}
 *          alternatives: 이름이 함께 걸린 다른 흐름들. 비어 있지 않으면 사람이 골라야 한다.
 */
function detectFlow(text, flows) {
  if (typeof text !== 'string' || !text.trim()) return null
  if (!Array.isArray(flows) || !flows.length) return null
  // 이름만으로는 "체조 안내"까지 흐름으로 오인한다 — 명시적 신호를 함께 요구한다
  if (!FLOW_CUES.test(text)) return null
  // 매체 판별과 같은 보수적 규칙 — 안내 방송 신호가 있는데 실행 동사가 없으면 주제일 뿐이다
  if (TTS_CUES.test(text) && !FLOW_RUN_VERB.test(text)) return null

  const candidates = flows
    .filter(f => f && Number.isInteger(f.id) && typeof f.name === 'string')
    .map(f => ({ id: f.id, name: f.name, key: f.name.replace(/\s+/g, '') }))
    // 한 글자 이름은 아무 문장에나 걸리므로 제외한다(흐름 이름을 두 글자 이상 쓰게 유도)
    .filter(f => f.key.length >= 2)
    .sort((a, b) => b.key.length - a.key.length)   // 긴 이름이 먼저 — "아침 방송"이 "아침"을 이긴다

  const hits = []
  for (const flow of candidates) {
    // "아침 방송"과 "아침방송"을 모두 잡도록 글자 사이 공백을 허용한다
    const pattern = [...flow.key].map(escapeRe).join('\\s*')
    const hit = text.match(new RegExp(pattern))
    if (hit) hits.push({ flow, matched: hit[0], start: hit.index, end: hit.index + hit[0].length })
  }
  if (!hits.length) return null

  const best = hits[0]   // 후보는 이름이 긴 순으로 정렬돼 있다
  // 자리가 겹치지 않는 다른 흐름도 걸렸으면("아침 방송 끝나고 체조 흐름") 어느 쪽인지 우리가
  // 정할 일이 아니다 — 후보를 같이 돌려줘서 사람이 고르게 한다.
  const alternatives = hits
    .filter(h => h.flow.id !== best.flow.id && !overlaps(h, best))
    .map(h => ({ flowId: h.flow.id, name: h.flow.name }))

  // 흐름 방송은 읽을 문구가 없다(runFlow가 저장된 단계를 그대로 실행한다). 그래서 호출부는
  // 남은 글자를 내용으로 쓰지 않고 흐름 이름을 제목으로 쓴다 — 꼬리말을 걷어낼 필요가 없다.
  return { flowId: best.flow.id, name: best.flow.name, matched: best.matched, alternatives }
}

// ── 사전에 있는 낱말인가 ────────────────────────────────────
// 자연어 학습 통계(고도화 제안 #10 2단계)가 "사전에 **없는** 낱말"을 세어 동의어 후보를
// 뽑는다. 그 판정을 통계 쪽에 두면 사전이 두 벌이 된다 — 규칙 파서와 AI 파서가 같은 사전을
// 봐야 한다는 이 저장소의 규율(CLAUDE.md)이 곧바로 깨진다. 사전이 여기 있으니 "사전에 있나"도
// 여기서 답한다. 낱말 하나만 받는다(문장이 아니다) — 쪼개는 일은 부르는 쪽 몫이다.
//
// 신호 정규식(ACTION_CUES 등)까지 함께 보는 이유: '틀어줘'·'안내'는 CONCEPTS 목록에는 없지만
// 파서가 이미 읽어내는 말이라 "모르는 낱말"로 올라오면 안 된다.
const CUE_PATTERNS = [ACTION_CUES, TTS_CUES, FLOW_CUES, FLOW_RUN_VERB, VOLUME_TARGET]
const WORD_LISTS = [
  ...CONCEPTS.map(c => c.nouns),
  ...VOLUME_LEVELS.map(l => l.words),
  ...VOLUME_CHANNEL_WORDS.map(c => c.words),
]
// 사전의 여러 낱말은 띄어쓰기가 있다('배경 음악'). 쪼갠 낱말과 맞대려면 공백을 지우고 본다.
const KNOWN_WORDS = new Set(
  WORD_LISTS.flat().map(w => w.replace(/\s+/g, '').toLowerCase()),
)

function isKnownWord(word) {
  const w = String(word ?? '').replace(/\s+/g, '').toLowerCase()
  if (!w) return false
  if (KNOWN_WORDS.has(w)) return true
  return CUE_PATTERNS.some(re => re.test(w))
}

module.exports = {
  ACTION_CUES,
  isKnownWord,
  CONCEPTS,
  VOLUME_LEVELS,
  detectVolume,
  KNOWN_BROADCAST_TYPES,
  NEEDS_AUDIO_FILE_TYPES,
  MAX_ACTION_GAP,
  MAX_FILLER_GAP,
  isKnownBroadcastType,
  isImmediateRequest,
  needsAudioFile,
  detectBroadcastType,
  detectFlow,
  FLOW_ONLY_CUES,
  FLOW_ONLY_CUES_ALL,
}
