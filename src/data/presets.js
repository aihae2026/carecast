// ============================================================
// CareCast AI 방송 프리셋 모음 (구 dummy.js)
// ============================================================
// 프로토타입 시절 더미 데이터 파일이었는데, 가짜 데이터는 아래 (삭제됨) 기록대로
// 전부 실제 API 값으로 교체됐고 진짜 운영 데이터 둘(TTS 음성 목록, 비상방송
// 프리셋 문구)만 남았다. 남은 것이 더미가 아니므로 이름을 바로잡음(2026-08-30).

// (삭제됨) systemStatus — CPU/오디오/마이크가 고정 자리표시자라 현장에서 오디오 장치가
// 빠져도 "정상 출력"으로 보이던 사각지대였다. 이제 /api/status의 실측값으로 카드를 만든다
// (src/lib/systemStatus.js의 buildStatusCards).

// (삭제됨) featureToggles — 10개 중 6개가 켜고 꺼도 아무 동작을 하지 않았다. 실제로 동작하는
// 항목만 남겨 Dashboard.jsx로 옮겼고(각 항목이 진짜 제어 키·라우트 가드에 연결됨),
// 중복(Calendar/BGM)과 미구현('방송 승인')은 화면에서 제거했다.

// (삭제됨) broadcastLogs / scheduledBroadcasts / musicNowPlaying / aiDummyResult / todaySummary
// — 백엔드가 생기기 전 프로토타입용 가짜 데이터였는데, 실제 데이터가 비어있을 때 화면에
// 그대로 남아 "아침 종합 방송 / 오전 약 복용 안내 / 점심식사 안내" 같은 존재하지 않는
// 방송이 진짜처럼 보이는 문제가 있었다. 전부 실제 API 값을 쓰도록 바꾸고 여기서 제거함.

// TTS 음성 목록 — Azure 음성(선택 엔진)의 실제 한국어 목소리만(서버 정본 domain/ttsVoices.js 의 부분집합)
export const ttsVoices = [
  { value: 'ko-KR-SunHiNeural',  label: '여성 — SunHi (기본)' },
  { value: 'ko-KR-InJoonNeural', label: '남성 — InJoon' },
]

// 비상 방송 프리셋
export const emergencyPresets = [
  {
    id: 'fire',
    title: '화재',
    icon: 'Flame',
    color: 'danger',
    content: '화재 경보! 화재 경보! 모든 입원자 및 직원분들은 즉시 지정된 대피로를 통해 건물 밖으로 대피해 주시기 바랍니다. 엘리베이터는 사용하지 마십시오.',
  },
  {
    id: 'missing',
    title: '실종',
    icon: 'UserX',
    color: 'warning',
    content: '안내 말씀 드립니다. 현재 어르신 한 분이 발견되지 않고 있습니다. 모든 직원분들은 담당 구역을 즉시 확인하고 발견 시 간호사실로 연락 바랍니다.',
  },
  {
    id: 'emergency',
    title: '응급상황',
    icon: 'AlertTriangle',
    color: 'danger',
    content: '응급상황 발생! 의료팀은 즉시 해당 호실로 이동해 주시기 바랍니다. 일반 방문객 및 보호자분들께서는 잠시 대기해 주십시오.',
  },
  {
    id: 'assembly',
    title: '직원 집합',
    icon: 'Users',
    color: 'primary',
    content: '전 직원 안내 말씀입니다. 모든 직원분들은 업무를 잠시 중단하고 1층 로비로 집합해 주시기 바랍니다. 반복합니다. 전 직원 1층 로비로 집합해 주십시오.',
  },
]

// (삭제됨) weatherDummy / favoritePresets / quickLinks — 위와 같은 이유로 제거.
// 날씨는 /api/weather, 즐겨찾기는 /api/favorites 실제 값을 쓴다.
