// 음원 출처·이용 조건 칸의 값과 판정 (2026-09-21). 화면 두 곳(올리기 칸·상세)이 같이 쓴다.
// 정본 규칙은 서버(server/domain/audioSource.js)다 — 여기는 **보내기 전에 알려 주려는** 사본이고,
// 배경음악에서 출처·이용 조건이 빠지면 막는다는 한 가지만 같게 둔다.

export const 빈출처 = { source_name: '', source_url: '', license_note: '' }

// 「Pixabay 로 채우기」 — **미리 채워 두지 않는다.** 칸이 처음부터 차 있으면 다른 데서 받은
// 곡도 Pixabay 로 적힌 채 올라간다. 사람이 한 번 눌러 고르게 한다.
//
// 주소 칸은 **비워 둔다**(약관 조사 c7 조사 2, 2026-10-17). 예전엔 `https://pixabay.com/music/` 목록 주소를
// 넣었는데, 곡 하나를 가리키지 않아 나중에 「이 곡을 어디서 받았나」의 증빙이 되지 못했다. 사람이 곡 페이지
// 주소를 붙여 넣도록 자리표시 글(`PIXABAY주소자리`)로 안내한다. 이용 조건의 약관 판 날짜는 Pixabay
// Terms of Service 의 「Last updated」 값이다(2026-10-17 확인).
export const PIXABAY출처 = {
  source_name: 'Pixabay',
  source_url: '',
  license_note: 'Pixabay Content License(2024-11-18 판) · 상업적 이용 가능 · 출처 표시 불필요 · 파일 그대로 재배포 금지',
}

export const PIXABAY주소자리 = '곡 페이지 주소(예: https://pixabay.com/music/…-12345/)'

/**
 * 이미 적힌 주소가 Pixabay **곡 하나의** 주소면 「Pixabay 로 채우기」가 지우지 않고 남긴다.
 * 예전 기본값이던 목록 주소(`/music/`)나 사이트 첫 화면은 증빙이 못 되므로 남기지 않는다.
 */
export function Pixabay주소인가(url) {
  return /^https?:\/\/(www\.)?pixabay\.com\/(music|sound-effects)\/[^/?#\s]+/i.test(String(url || '').trim())
}

/** 배경음악에서 빠진 칸 이름들(비었으면 빈 배열). 서버와 같은 기준이다. */
export function 빠진출처칸(v) {
  return [!v?.source_name?.trim() && '출처', !v?.license_note?.trim() && '이용 조건'].filter(Boolean)
}
