// 합성(synthesis) 캐시 열쇠의 공용 규칙 — 문안 정규화와 **엔진 소금**. 재생 볼륨과는 다른 층이다.
//
// 엔진마다 자기 소금을 넘긴다(ttsEngines/*.js 의 SALT — 모델판·화자·출력 형식). 소금이 바뀌면 열쇠가 바뀌어
// 옛 소리가 저절로 밀려난다 — 모델을 바꿨는데 옛 음성이 캐시로 계속 나가는 일이 없다.
//
// 2026-09-21: 예전 인터넷 엔진을 걷어내며 그 엔진 전용 상수(고정 게인 +2dB · SSML 판번호 · 엔진판 소금)도
// 걷었다. 그 게인은 실측상 **실제로는 한 번도 걸리지 않았다**(2026-09-20 확인) — 지워도 소리는 그대로다.
// 새 엔진(Supertonic)의 음량이 예전과 같은지는 **현장 스피커에서 사람이 귀로** 확인한다(코드로 판단 못 한다).
'use strict'

const crypto = require('crypto')

// 전각 → 반각. 사람이 다른 자판·다른 기기에서 붙여 넣으면 섞여 들어온다.
// 영숫자와 문장부호만 바꾼다 — 한글은 손대지 않는다.
function toHalfWidth(s) {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')   // 전각 공백
}

/**
 * 문안 정규화. **캐시 키를 만들기 직전에만** 쓴다(읽어 주는 문장 자체는 안 바꾼다).
 *
 * 표기만 다른 같은 문장이 서로 다른 키가 되면, 매번 새로 합성하느라 캐시가 무용지물이 된다.
 * 반대로 너무 많이 지우면 다른 문장이 같은 키가 되어 **엉뚱한 음성이 나간다** — 그래서
 * 공백·전각·유니코드 표기까지만 손대고 낱말은 건드리지 않는다.
 */
function normalizeText(text) {
  if (text === null || text === undefined) return ''
  return toHalfWidth(String(text))
    .normalize('NFC')          // 맥·아이폰이 보내는 자모 분리(NFD)를 완성형으로
    .replace(/\s+/g, ' ')      // 탭·줄바꿈 포함 연속 공백을 한 칸으로
    .trim()
}

/**
 * 캐시 키. **합성 결과 바이트를 바꾸는 값만** 들어간다.
 *
 * 들어가는 것: 문안(정규화 후) · voice · rate · pitch · salt(엔진·모델판·화자·출력 형식)
 * 안 들어가는 것: **볼륨**. 볼륨은 재생 시점 값이고(SSE 의 ttsVolume), 키에 넣으면
 *   같은 문장을 볼륨 가짓수만큼 다시 합성하게 된다 — 정시성을 위한 캐시가 합성을 늘린다.
 *
 * 구분자는 NUL 이다(문장·음성·속도 어디에도 나올 수 없어 서로 다른 조합이 같은 키가
 * 되지 않는다). 소스에는 반드시 escape 로 적는다 — 실제 바이트를 넣으면 git 이 이 파일을
 * 바이너리로 취급해 사람이 diff 를 못 본다(CLAUDE.md).
 */
function cacheKeyFor({ text, voice, rate, pitch }, salt = '') {
  const parts = [normalizeText(text), voice, rate, pitch]
  // 소금이 있으면 넣는다(엔진들은 늘 넘긴다 — 열쇠 값은 소금 도입 때와 같다).
  if (salt) parts.push(salt)
  return crypto.createHash('sha1').update(parts.join(String.fromCharCode(0))).digest('hex')
}

module.exports = { normalizeText, cacheKeyFor }
