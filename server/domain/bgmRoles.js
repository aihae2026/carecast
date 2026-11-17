// 배경음악의 두 용도 — 방송용·식사용 (사용자 지시 2026-09-21).
//
// *"폴더별-방송용 BGM, 식사용 BGM 이렇게 나눠서 … 랜덤으로 자동재생, 순차적 재생"*
// *"클래식 음악은 거의 식사용으로 해주고 happy로 되어 있는건 TTS 방송할때 랜덤으로"*
//
// ── 폴더와 용도를 왜 설정 키로 잇나 ─────────────────────────────────────
// 폴더 번호는 PC 마다 달라 코드·기초값에 적을 수 없다. 이름으로 찾으면 사람이 폴더 이름을
// 바꾸는 순간 **조용히 무음**이 된다. 그래서 용도마다 키 하나(`bgm_folder_<용도>`)에 폴더
// 번호를 적는다. 폴더 표에 칸을 더하는 것보다 되돌리기 쉽고, 용도는 둘뿐이다.
//
// 순수 모듈이다. DB 는 services/localBgm.js 가 만진다.
'use strict'

const 역할들 = Object.freeze([
  Object.freeze({ role: 'broadcast', 이름: '방송용 BGM', 폴더키: 'bgm_folder_broadcast', 순서키: 'bgm_order_broadcast', 기본순서: 'random' }),
  Object.freeze({ role: 'meal',      이름: '식사용 BGM', 폴더키: 'bgm_folder_meal',      순서키: 'bgm_order_meal',      기본순서: 'random' }),
])
const 순서들 = Object.freeze(['random', 'seq'])

const 역할찾기 = (role) => 역할들.find(r => r.role === role) || null

// 자동방송 단계가 용도를 안 적었을 때 방송 종류로 정한다. 점심·저녁은 식사 시간 방송이라
// 식사용(클래식), 나머지(아침·체조·저녁 마무리 등)는 안내 방송이라 방송용(happy)이다.
// 단계에 `bgmRole` 을 적으면 그것이 이긴다.
// (예전 판은 'breakfast' 도 식사용으로 적었지만 자동방송은 그 이름을 쓰지 않는다 — 아침 방송은
// 'morning' 이다. 화면 설명 「점심·저녁은 식사용」과 어긋나 보여 뺐다, 화면 검수 지적 2026-09-21.)
function 기본역할(mealKey) {
  return mealKey === 'lunch' || mealKey === 'dinner' ? 'meal' : 'broadcast'
}

/**
 * 틀 순서를 정한다.
 * - `seq`: 저장된 시작 자리부터 돌려 세운다. 다음번 시작 자리는 **한 칸 뒤**다 — 서버는 곡이
 *   몇 개나 흘렀는지 모르므로(재생은 화면이 한다) 「틀 때마다 한 곡씩 밀린다」로 약속한다.
 * - `random`(그 밖의 값 포함): 곡을 한 번씩만 쓰고 순서를 섞는다(Fisher–Yates). 화면의 재생기는
 *   받은 순서대로 돌므로 섞은 순서가 곧 재생 순서다.
 * @returns {{목록: any[], 다음자리: number}}
 */
function 재생순서(files, order, 시작자리 = 0, rand = Math.random) {
  const n = files.length
  if (!n) return { 목록: [], 다음자리: 0 }
  if (order === 'seq') {
    const s = Number.isInteger(시작자리) && 시작자리 >= 0 ? 시작자리 % n : 0
    return { 목록: [...files.slice(s), ...files.slice(0, s)], 다음자리: (s + 1) % n }
  }
  const a = [...files]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return { 목록: a, 다음자리: 0 }
}

// 차례로 틀 때 시작 자리를 적는 키. `local_bgm_seq_` 로 시작한다 — 틀 때마다 기계가 쓰는
// 값이라 설정 변경 기록(settingsHistory)이 이 접두어를 빼고 센다.
const 차례키 = (folderId) => `local_bgm_seq_${folderId}`

// ── 사람이 만든 BGM 폴더 (사용자 결정 2026-09-22 「폴더를 자유롭게 늘림」) ─────────────
// 저장값은 `local_f<폴더 번호>`(+`_seq` 면 차례로)다. **번호로 잇는다** — 이름으로 잇으면 사람이
// 폴더 이름을 바꾸는 순간 끊긴다(위 머리말과 같은 까닭). 두 용도 폴더는 번호가 PC 마다 달라
// 기초값·AI 초안에 적을 수 없으므로 `local_broadcast`·`local_meal` 을 그대로 쓴다 — **폴더 하나에
// 저장값 하나**(화면이 용도 폴더를 고르면 용도 값으로 적는다). 이 규칙의 화면 쪽 짝은 src/lib/bgmTypes.js.
// 번호는 1~999999999 — 앞자리 0·아주 큰 수를 받지 않는다(QA: 1e23 이 parseInt 를 거쳐 1번 폴더로 조용히 바뀌었다,
// local_f012 는 서버와 화면이 다르게 읽었다). 화면 규칙(src/lib/bgmTypes.js)과 **같은 글자**여야 한다.
const 폴더값규칙 = /^local_f([1-9]\d{0,8})(_seq)?$/

/**
 * 번호 하나를 **엄격하게** 읽는다 — 정수(숫자)이거나 숫자만 든 글자일 때만. `true`·`[7]`·`'7.0'`·`'0x7'`·`'10abc'`
 * 같은 것을 `Number()`·`parseInt()` 로 읽으면 조용히 다른 번호가 된다(QA 2026-09-22). 범위 밖이면 null.
 */
function 번호읽기(v, 최소 = 1, 최대 = 999999999) {
  let n = null
  if (typeof v === 'number') n = v
  else if (typeof v === 'string' && /^\d{1,9}$/.test(v.trim())) n = Number(v.trim())
  return Number.isInteger(n) && n >= 최소 && n <= 최대 ? n : null
}

/** `local_f12_seq` → `{ folderId: 12, 차례: true }`, 아니면 null. */
function 폴더값(type) {
  const m = 폴더값규칙.exec(String(type || ''))
  if (!m) return null
  const folderId = parseInt(m[1], 10)
  return folderId > 0 ? { folderId, 차례: Boolean(m[2]) } : null
}

// ── 곡 하나 (사용자 지시 2026-09-22 「폴더별로도 할 수 있지만 개별적 파일로도」) ─────────────
// 저장값 `local_a<곡 번호>` — audio_files.id(bgm). 곡 하나라 차례(`_seq`)는 없다. 화면 쪽 짝은 src/lib/bgmTypes.js.
const 곡값규칙 = /^local_a([1-9]\d{0,8})$/
/** `local_a` 로 시작하면 곡 하나를 고르려던 값이다 — 모양이 틀려도 옛 값(방송용)으로 조용히 읽지 않는다. */
const 곡값인척 = (type) => /^local_a/.test(String(type || ''))
/** `local_a42` → `{ fileId: 42 }`, 아니면 null. */
function 곡값(type) {
  const m = 곡값규칙.exec(String(type || ''))
  return m ? { fileId: parseInt(m[1], 10) } : null
}

module.exports = { 역할들, 순서들, 역할찾기, 기본역할, 재생순서, 차례키, 폴더값, 번호읽기, 곡값, 곡값인척 }
