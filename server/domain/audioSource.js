// 음원의 출처와 이용 조건 — 무엇을 받고 무엇을 막나 (사용자 지시 2026-09-21).
//
// *"출처표기에 저작권한에 대해서도 적어서 분쟁안되게 로컬에서 등록해야한다고 적어주고"*
//
// 외부 동영상 연동을 걷어낸 뒤(2026-09-21) 배경음악은 기관이 직접 받아 이 PC 에 올린 파일이다. 「이 음악 어디서
// 났냐」는 물음에 **음원 행 하나로 답할 수 있어야** 해서 곡마다 셋을 적는다:
//   source_name  — 어디서 받았나 (예: Pixabay, 직접 구매)
//   source_url   — 받은 곳 주소 (없으면 비움)
//   license_note — 이용 조건 (예: Pixabay Content License · 출처 표시 불필요)
//
// **배경음악만 필수다.** 안내 녹음·식사 안내·직원 안내는 기관이 직접 녹음한 목소리라 적을 출처가
// 없다. 체조·영상은 지금 필수로 묶으면 이미 쓰던 업로드가 막힌다 — 비워도 되고 적을 수 있다.
//
// 순수 모듈이다. DB 도 express 도 모른다.
'use strict'

const 최대글자 = 300
// 이 카테고리는 출처·이용 조건 없이 못 올린다.
const 출처필수 = new Set(['bgm'])

// 글자만 받는다 — 객체가 오면 `String()` 이 「[object Object]」를 저장했다(QA 재현). 글자가 아니면 null.
const 다듬기 = (v) => (v == null ? '' : typeof v === 'string' || typeof v === 'number' ? String(v).trim() : null)

// 빠진 칸을 사람 말로 — 조사를 틀리지 않게 경우를 다 적는다(「출처과」·「출처을」이 나갔다, QA 재현).
const 빠진칸문장 = (이름없음, 조건없음) =>
  이름없음 && 조건없음 ? '출처와 이용 조건을' : 이름없음 ? '출처를' : '이용 조건을'

/**
 * 요청 본문에서 출처 셋을 읽는다.
 * @param {object} body
 * @param {{필수?: boolean}} opts 필수면 source_name·license_note 가 비어 있을 때 거절
 * @returns {{ok: true, 값: {source_name, source_url, license_note}} | {ok: false, 사유: string}}
 */
function 출처읽기(body, { 필수 = false } = {}) {
  const b = body || {}
  const 이름 = 다듬기(b.source_name)
  const 주소 = 다듬기(b.source_url)
  const 조건 = 다듬기(b.license_note)

  for (const [값, 칸] of [[이름, '출처는'], [주소, '출처 주소는'], [조건, '이용 조건은']]) {
    if (값 === null) return { ok: false, 사유: `${칸} 글자로 적어 주세요.` }
    if (값.length > 최대글자) return { ok: false, 사유: `${칸} ${최대글자}자까지 적을 수 있습니다.` }
  }
  // 주소는 눌러서 열어 볼 수 있는 것만 받는다 — `javascript:` 같은 것이 목록 링크로 나가면 안 된다.
  if (주소 && !/^https?:\/\/\S+$/i.test(주소)) {
    return { ok: false, 사유: '출처 주소는 http:// 또는 https:// 로 시작해야 합니다.' }
  }
  if (필수) {
    if (!이름 || !조건) {
      return { ok: false, 사유: `배경음악은 ${빠진칸문장(!이름, !조건)} 적어야 올릴 수 있습니다. 저작권이 확인된 음원만 등록해 주세요.` }
    }
  }
  return { ok: true, 값: { source_name: 이름 || null, source_url: 주소 || null, license_note: 조건 || null } }
}

const 출처가필수인가 = (category) => 출처필수.has(category)

module.exports = { 출처읽기, 출처가필수인가, 최대글자 }
