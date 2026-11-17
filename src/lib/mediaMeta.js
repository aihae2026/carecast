// 음원·영상의 **작은 표시**(길이·용량)를 사람 말로 옮기는 단일 출처 (2026-09-12).
//
// 사용자 지시: *"목록형으로 하면 작은 표시로 MB나 음성길이·영상길이 이런 것도"*.
// 아이클라우드·드라이브의 목록이 그렇듯, 이름 옆에 작게 붙는 부가 정보다.
//
// 화면이 아니라 여기 두는 이유는 `mediaBrowse.js` 와 같다 — 순수 함수라 **실제로 돌려 보는
// 검사**를 쓸 수 있다. 그리고 목록·카드·상세 세 자리가 같은 문구를 써야 한다.
//
// **모르는 것은 모른다고 한다.** 길이는 브라우저가 재서 보내 주기 전까지 0 이고, 용량은
// 파일이 없으면 null 이다. 그것을 `0:00` 이나 `0 MB` 로 적으면 **"길이가 0인 파일"** 로
// 읽힌다 — 이 저장소에서 가장 비싼 실패가 조용한 오독이다.

/**
 * 초 → `3:07` / `1:02:03`. 모르면 null.
 * 반올림하지 않고 버린다 — `0:59.7` 을 `1:00` 으로 적으면 목록과 재생기가 어긋나 보인다.
 */
export function 길이글(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return null
  const 총 = Math.floor(s)
  const 시 = Math.floor(총 / 3600)
  const 분 = Math.floor((총 % 3600) / 60)
  const 초 = 총 % 60
  const 두자리 = (n) => String(n).padStart(2, '0')
  return 시 > 0 ? `${시}:${두자리(분)}:${두자리(초)}` : `${분}:${두자리(초)}`
}

/**
 * 바이트 → `4.2 MB`. 모르면 null.
 *
 * 1024 로 나눈다(KB·MB 표기). 1000 단위로 세는 표기도 있지만 윈도 탐색기가 1024 라,
 * 현장에서 탐색기와 이 화면을 나란히 볼 때 숫자가 갈리면 안 된다.
 * 1MB 미만은 소수를 안 붙인다 — `0.3 MB` 보다 `312 KB` 가 읽기 쉽다.
 */
export function 용량글(bytes) {
  // **`null` 을 먼저 걸러낸다.** `Number(null)` 은 0 이라, 이 줄이 없으면 "모른다"가
  // "0 B"로 둔갑한다. 진짜 0바이트 파일은 `0` 으로 들어오고 그때는 `0 B` 가 맞다.
  if (bytes === null || bytes === undefined || bytes === '') return null
  const b = Number(bytes)
  if (!Number.isFinite(b) || b < 0) return null
  if (b < 1024) return `${Math.round(b)} B`
  const kb = b / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/**
 * 올린 날짜를 짧게. 오늘·어제는 시각으로, 그 밖은 날짜로.
 * 목록에 `2026. 9. 12. 오전 9:04:33` 이 전부 들어가면 정작 이름이 잘린다.
 */
export function 올린때글(iso, now = new Date()) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const 같은날 = (a, b) => a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const 어제 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const 두자리 = (n) => String(n).padStart(2, '0')
  if (같은날(d, now)) return `오늘 ${두자리(d.getHours())}:${두자리(d.getMinutes())}`
  if (같은날(d, 어제)) return `어제 ${두자리(d.getHours())}:${두자리(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

/**
 * 목록 한 줄에 붙는 작은 표시들. 아는 것만 순서대로 담는다.
 * 비면 빈 배열이고, 부르는 쪽은 그때 아무것도 안 그린다.
 */
export function 작은표시(file, now = new Date()) {
  const out = []
  const 길 = 길이글(file?.duration)
  if (길) out.push(길)
  const 용 = 용량글(file?.size_bytes)
  if (용) out.push(용)
  const 때 = 올린때글(file?.uploaded_at, now)
  if (때) out.push(때)
  return out
}
