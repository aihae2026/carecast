// 사람이 넣은 글이 "깨진 채로" 시스템에 들어오는 것을 막는 단 한 곳.
//
// U+FFFD는 디코딩에 실패한 자리에 남는 표시다. 한 번 박히면 원문 바이트가 사라져 되돌릴 수
// 없다 — 2026-08-31에 이 저장소의 8칸이 그렇게 망가져 있었고, 근거를 모아 손으로 다시 쓰는
// 수밖에 없었다(scripts/repair-mojibake-rows.cjs). 들어올 때 막는 것이 유일한 방어다.
//
// 어떻게 들어오나: Windows(Git Bash)에서 curl로 한글 JSON을 POST하면 본문이 CP949로 나가고
// 서버는 UTF-8로 읽는다. 요청은 200 OK다. PowerShell 출력, CP949로 저장된 파일 붙여넣기도
// 같은 결과를 낸다.
//
// 왜 방송에서 특히 나쁜가: 깨진 예약 문구는 그대로 TTS로 나가 어르신에게 읽힌다. 화면 이력은
// "나갔음"으로 남고, 아무도 무슨 방송이었는지 모른다.
//
// 이 검사는 audioDevices.sanitizeDeviceName이 출력장치 이름에 쓰던 것과 같은 것이다
// (2026-08-30). 같은 실패 모드에 두 벌을 만들지 않으려고 여기로 올렸다.
'use strict'

// 줄바꿈·탭·캐리지리턴은 **글**에서는 정상 입력이다 — TTS 문구가 여러 줄인 경우가 실제로 있다.
// 하지만 **이름**(출력장치 등)에서는 아니다: 그 값은 PowerShell 인자에 그대로 실려서 줄바꿈이
// 명령을 갈라놓는다. 그래서 allowNewlines로 두 규칙을 가른다 — 검사는 여전히 한 곳이다.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/**
 * 글자가 깨졌거나(U+FFFD) 쓸 수 없는 제어문자가 섞였는가.
 * @param {unknown} value 검사할 값(문자열이 아니면 false — 형식 검사는 호출부의 몫)
 * @param {{allowNewlines?: boolean}} [opts] 이름 칸이면 allowNewlines:false (줄바꿈도 거부)
 * @returns {boolean}
 */
function hasBrokenText(value, { allowNewlines = true } = {}) {
  if (typeof value !== 'string' || value === '') return false
  if (value.includes('\uFFFD')) return true
  if (FORBIDDEN_CONTROL.test(value)) return true
  // 이름 칸(출력장치 등)은 줄바꿈·탭도 거부한다 — 그 값은 PowerShell 인자에 그대로 실린다.
  return !allowNewlines && /[\t\n\r]/.test(value)
}

/**
 * 여러 칸을 한 번에 본다. 깨진 첫 칸의 사람이 읽는 이름을 돌려준다(없으면 null).
 * @param {Record<string, unknown>} fields { '제목': title, '내용': content }
 * @returns {string|null}
 */
function findBrokenField(fields) {
  for (const [label, value] of Object.entries(fields)) {
    if (hasBrokenText(value)) return label
  }
  return null
}

/** 라우트가 그대로 쓸 수 있는 안내 문구. 무엇을 해야 하는지까지 적는다. */
function brokenTextMessage(label) {
  return `${label}의 글자가 깨져 있습니다. 복사한 곳의 인코딩(UTF-8)을 확인하고 다시 입력해주세요.`
}

// ── 이미 깨져서 들어온 이름 되돌리기 ──────────────────────────────
//
// 위의 U+FFFD는 정보가 사라진 자리라 되돌릴 수 없다. 그런데 **아직 안 사라진** 깨짐이 하나
// 더 있다: multipart 업로드의 파일 이름이다. 브라우저는 UTF-8 바이트를 그대로 싣는데
// multer(busboy)의 기본값이 defParamCharset:'latin1'이라, 서버가 받는 originalname은
// 언제나 "UTF-8 바이트를 글자당 하나씩 Latin-1로 읽은 문자열"이다("국민체조" → "êµ­ë¯¼ì²´ì¡°").
// 바이트는 남아 있으므로 서버가 되돌려 읽으면 원래 이름이 그대로 나온다.
//
// 판정 기준은 **그 바이트열이 올바른 UTF-8이냐**다. 예전 audio.js는 "되돌린 결과에 완성형
// 한글(가-힣)이 있느냐"로 봤는데, 그러면 맥·아이폰이 보내는 자모 분리(NFD) 이름·자모만 있는
// 이름·일본어·악센트 라틴이 전부 조건에 안 걸려 깨진 채로 저장된다(2026-09-01 실측).
// 반대로 진짜 Latin-1 이름("café.mp3")은 UTF-8로 성립하지 않아 그대로 남는다.
const NEEDS_REPAIR = /[\u0080-\u00ff]/
const STRICT_UTF8  = new TextDecoder('utf-8', { fatal: true })

// 한 번만 되돌려 본다. 되돌릴 이유가 없거나 UTF-8이 아니면 null.
function reinterpretLatin1AsUtf8(value) {
  if (!NEEDS_REPAIR.test(value)) return null           // ASCII뿐 — 깨질 일이 없었다
  // 0xFF를 넘는 글자가 하나라도 있으면 Latin-1 바이트가 아니다 = 이미 제대로 읽힌 이름이다.
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > 0xff) return null
  try {
    const decoded = STRICT_UTF8.decode(Buffer.from(value, 'latin1'))
    return decoded === value ? null : decoded
  } catch {
    return null   // 올바른 UTF-8이 아니다 — 진짜 Latin-1 이름이니 건드리지 않는다
  }
}

/**
 * Latin-1로 잘못 읽힌 이름을 원래 글자로 되돌린다. 되돌릴 수 없으면 받은 값을 그대로 준다.
 * 두 번 깨진 이름(깨진 이름을 다시 올린 경우)까지 풀도록 반복하되 상한을 둔다.
 * 결과는 NFC로 모은다 — 맥·아이폰이 보내는 자모 분리 이름이 화면에서 한 글자로 보여야 한다.
 * @param {unknown} value 파일 이름 등(문자열이 아니면 그대로 돌려준다)
 * @returns {unknown}
 */
function repairMojibake(value) {
  if (typeof value !== 'string' || value === '') return value
  let out = value
  for (let round = 0; round < 3; round++) {
    const next = reinterpretLatin1AsUtf8(out)
    if (next === null) break
    out = next
  }
  return out.normalize('NFC')
}

module.exports = { hasBrokenText, findBrokenField, brokenTextMessage, repairMojibake }
