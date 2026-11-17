// 화면이 쓰는 "오늘"은 서버가 적는 "오늘"과 같아야 한다.
//
// 왜 이 파일이 있나(CC-015): 서버는 방송 이력·경보·last_fired 날짜를 로컬(KST)로 적는다
// (server/services/repeatSchedule.js의 todayStr이 단일 출처). 화면이 toISOString()으로
// 오늘을 구하면 KST 09시 이전에 하루가 어긋나서, 오늘 것이 어제로 보이거나 그 반대가 된다.
//
// 실제로 어긋났던 곳: 대시보드 달력의 오늘 표시, 자동방송 편집기가 새 흐름에 넣는
// repeat_start_date, 경보 배너의 오늘자 복원.
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
