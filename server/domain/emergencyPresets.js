'use strict'
// **비상방송 문안 — 고칠 수 있게 한다** (사용자 지시 2026-09-16).
//
// *"비상방송관리는 수정 편집할 수 있게 해줘야지"* (사용자 지시, 낱말은 다듬어 옮긴다)
//
// ── 왜 못 고치고 있었나 ────────────────────────────────────────────────────
// 문안이 `src/data/presets.js` 라는 **소스 파일에 박혀 있었다.** 고치려면 개발자가
// 코드를 바꾸고 배포해야 한다. 그런데 이 문안은 **그 시설의 말**이다 — 대피로 이름,
// 집합 장소("1층 로비"), 부르는 호칭이 시설마다 다르다. 급할 때 읽히는 글인데
// 현장에서 손댈 수 없다는 것이 문제였다.
//
// ── 어디에 두나 ────────────────────────────────────────────────────────────
// `settings` 표에 **JSON 한 줄**로 둔다. 새 표를 만들지 않는 이유:
//   · 행이 넷뿐이고 서로 순서만 갖는다 — 표가 할 일이 없다.
//   · 스키마 변경은 마이그레이션 세 벌이 한 세트다(CLAUDE.md §4). 값어치에 비해 비싸다.
//
// **소스의 기본값은 그대로 둔다.** 설정이 비어 있으면 그것을 쓴다 — 새로 설치한 PC 가
// 빈 화면으로 시작하면 급할 때 읽을 것이 없다.
//
// ── 무엇을 검사하나 ────────────────────────────────────────────────────────
// 이 글은 **사람이 급할 때 누르면 그대로 방송된다.** 그래서 저장 단계에서 막는다:
//   · 빈 내용 — 누르면 아무 소리도 안 나는 단추가 된다
//   · 너무 긴 글 — TTS 합성이 길어져 정작 급한 순간에 늦는다
//   · 아는 갈래(색·그림)가 아닌 값 — 화면이 못 그린다

const 설정키 = 'emergency_presets'

/** 화면이 그릴 수 있는 그림·색. 여기 없는 값은 안 받는다. */
const 그림들 = ['Flame', 'UserX', 'AlertTriangle', 'Users', 'Radio', 'Bell']
const 색들 = ['danger', 'warning', 'primary']

/** 한 문안의 길이 상한. 넘으면 합성이 길어져 급한 순간에 늦는다. */
const 최대글자 = 500
const 최대개수 = 8

// 기본 문안 — `src/data/presets.js` 와 **같은 내용**이다.
// 화면은 자기 것을 쓰고 서버는 이것을 쓴다. 두 벌이지만 **역할이 다르다**:
// 화면은 서버가 안 뜰 때의 마지막 폴백이고, 여기는 저장 전의 기본값이다.
// 갈리지 않게 `server/test/emergency-presets.test.js` 가 둘을 맞춰 본다.
const 기본문안 = [
  {
    id: 'fire', title: '화재', icon: 'Flame', color: 'danger',
    content: '화재 경보! 화재 경보! 모든 입원자 및 직원분들은 즉시 지정된 대피로를 통해 건물 밖으로 대피해 주시기 바랍니다. 엘리베이터는 사용하지 마십시오.',
  },
  {
    id: 'missing', title: '실종', icon: 'UserX', color: 'warning',
    content: '안내 말씀 드립니다. 현재 어르신 한 분이 발견되지 않고 있습니다. 모든 직원분들은 담당 구역을 즉시 확인하고 발견 시 간호사실로 연락 바랍니다.',
  },
  {
    id: 'emergency', title: '응급상황', icon: 'AlertTriangle', color: 'danger',
    content: '응급상황 발생! 의료팀은 즉시 해당 호실로 이동해 주시기 바랍니다. 일반 방문객 및 보호자분들께서는 잠시 대기해 주십시오.',
  },
  {
    id: 'assembly', title: '직원 집합', icon: 'Users', color: 'primary',
    content: '전 직원 안내 말씀입니다. 모든 직원분들은 업무를 잠시 중단하고 1층 로비로 집합해 주시기 바랍니다. 반복합니다. 전 직원 1층 로비로 집합해 주십시오.',
  },
]

/**
 * 보낸 목록이 쓸 만한가. 아니면 **왜 아닌지 한 문장으로.**
 *
 * 「대충 고쳐서 저장해 두고 급할 때 눌렀더니 아무 소리도 안 났다」를 막는 것이
 * 이 함수의 전부다. 조용히 고쳐서 받지 않는다 — 사람이 적은 것과 다른 것이 나가면
 * 그게 더 나쁘다.
 *
 * @returns {{ok:true, 값:Array}|{ok:false, 사유:string}}
 */
function 목록읽기(raw) {
  if (!Array.isArray(raw)) return { ok: false, 사유: '문안 목록이 필요합니다.' }
  if (!raw.length) return { ok: false, 사유: '문안이 하나도 없습니다. 최소 하나는 있어야 합니다.' }
  if (raw.length > 최대개수) return { ok: false, 사유: `문안은 ${최대개수}개까지입니다.` }

  const 나온id = new Set()
  const 값 = []
  for (const [i, p] of raw.entries()) {
    const 자리 = `${i + 1}번째 문안`
    if (!p || typeof p !== 'object') return { ok: false, 사유: `${자리}의 모양이 잘못됐습니다.` }

    const id = String(p.id ?? '').trim()
    if (!/^[a-z0-9_-]{1,40}$/.test(id)) return { ok: false, 사유: `${자리}의 이름표(id)가 잘못됐습니다.` }
    if (나온id.has(id)) return { ok: false, 사유: `이름표가 겹칩니다: ${id}` }
    나온id.add(id)

    const title = String(p.title ?? '').trim()
    if (!title) return { ok: false, 사유: `${자리}의 제목이 비었습니다.` }
    if (title.length > 20) return { ok: false, 사유: `${자리}의 제목이 너무 깁니다(20자 이내).` }

    // **빈 내용을 막는 것이 이 검사의 핵심이다.** 빈 채로 저장하면 급할 때 누르는
    // 단추가 아무 소리도 안 낸다 — 그리고 그 순간에는 아무도 이유를 못 찾는다.
    const content = String(p.content ?? '').trim()
    if (!content) return { ok: false, 사유: `「${title}」의 방송 내용이 비었습니다.` }
    if (content.length > 최대글자) {
      return { ok: false, 사유: `「${title}」이 너무 깁니다(${content.length}자 / ${최대글자}자까지). 급할 때는 짧아야 빨리 나갑니다.` }
    }

    const icon = 그림들.includes(p.icon) ? p.icon : 'AlertTriangle'
    const color = 색들.includes(p.color) ? p.color : 'danger'
    값.push({ id, title, icon, color, content })
  }
  return { ok: true, 값 }
}

module.exports = { 설정키, 기본문안, 목록읽기, 그림들, 색들, 최대글자, 최대개수 }
