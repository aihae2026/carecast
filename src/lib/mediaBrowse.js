// 음원·동영상 탐색기의 **찾기와 줄 세우기** (UX-27, 2026-09-11).
//
// 사용자 지시: *"'음원 및 동영상 관리'는 구글 드라이브나 아이클라우드처럼 해줬으면 좋겠어,
// 직관적이고"*. 폴더 트리·경로 표시·격자/목록 전환은 이미 있었다. **없던 것은 검색과 정렬**이다.
//
// 화면이 아니라 여기 두는 이유: 순수 함수라 **실제로 돌려 보는 검사**를 쓸 수 있다.
// 화면 안에 두면 소스 글자만 보는 검사밖에 못 쓰고, 그런 검사가 결함을 놓친 적이 있다
// (2026-09-11 BGM 이력).

/**
 * 검색어를 견주기 좋게 다듬는다.
 *
 * **공백을 지운다** — 파일 이름은 사람이 붙이는 것이라 "가을 노래"와 "가을노래"가 섞인다.
 * **대소문자를 접는다** — `Autumn.mp3` 를 `autumn` 으로 찾을 수 있어야 한다.
 * 한글 자모 분해(NFD)로 들어오는 이름이 있으므로 **NFC 로 모은다** — 맥·아이폰에서 올린
 * 파일이 그렇다(CLAUDE.md 의 업로드 파일명 규칙과 같은 이유).
 */
export function 검색키(s) {
  return String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '')
}

export function 이름이맞나(이름, 검색어) {
  const q = 검색키(검색어)
  if (!q) return true
  return 검색키(이름).includes(q)
}

// 줄 세우는 규칙. 화면의 고르개와 **같은 값**을 쓴다(라벨도 여기서 준다).
export const 정렬규칙 = [
  { id: 'recent',   label: '최근 올린 순' },
  { id: 'name',     label: '이름순' },
  { id: 'duration', label: '길이순' },
]

const 이름of = (f) => f.original_name || f.filename || ''

/**
 * 파일 목록을 거르고 줄 세운다.
 *
 * **원본을 안 건드린다**(복사본을 정렬한다) — 예전에 다른 화면에서 `sort()` 가 원본을
 * 뒤집어 놓아 다음 렌더가 어긋난 적이 있다.
 *
 * `duration` 이 없는 줄(길이를 아직 못 읽은 파일)은 **길이순에서 맨 뒤**로 보낸다.
 * 0으로 치면 "가장 짧은 것"으로 올라와서 사람이 잘못 읽는다.
 */
export function 파일고르기(files, { 검색어 = '', 정렬 = 'recent' } = {}) {
  const 걸러진 = (files || []).filter(f => 이름이맞나(이름of(f), 검색어))
  const out = [...걸러진]
  if (정렬 === 'name') {
    out.sort((a, b) => 이름of(a).localeCompare(이름of(b), 'ko'))
  } else if (정렬 === 'duration') {
    out.sort((a, b) => {
      const x = Number(a.duration), y = Number(b.duration)
      const xa = Number.isFinite(x) && x > 0, ya = Number.isFinite(y) && y > 0
      if (!xa && !ya) return 0
      if (!xa) return 1          // 모르는 것은 뒤로
      if (!ya) return -1
      return x - y
    })
  } else {
    // 최근 올린 순 — 서버가 이미 그 순서로 주지만, 전체 검색으로 여러 폴더를 합치면
    // 카테고리별로 묶여 오므로 여기서 다시 세운다.
    out.sort((a, b) => String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || '')))
  }
  return out
}

/** 폴더는 이름으로만 거른다. 줄 세우기는 늘 이름순이다 — 폴더에 '길이'가 없다. */
export function 폴더고르기(folders, { 검색어 = '' } = {}) {
  return (folders || [])
    .filter(f => 이름이맞나(f.name, 검색어))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'))
}

// 옮기기의 판정과 실행은 **`mediaMove.js`** 에 있다. 이 파일은 「찾기와 줄 세우기」 한 가지만
// 한다 — 옮기기까지 들이면 한 문장으로 설명되지 않는다(CLAUDE.md 「구조 단순성」 3).
