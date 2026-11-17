// 음원/동영상 관리 화면의 상수표와 순수 함수.
//
// 왜 갈라냈나: MusicManagement.jsx가 1198줄이라 모달·트리·본체가 한 파일에 뒤엉켜 있었다.
// 상태도 화면도 없는 이것부터 뗐다. **컴포넌트와 같은 파일에 두지 않는다** — 한 파일이
// 컴포넌트와 상수·함수를 함께 내보내면 Fast Refresh가 깨진다(eslint가 잡는다).

const CATEGORIES = [
  { key: 'bgm',              label: 'BGM',          desc: '방송·식사 배경음악 (방송용·식사용 폴더)',                          type: 'audio' },
  { key: 'morning-prayer',   label: '아침 기도·묵상(선택)', desc: '아침 방송 「기도·묵상 시간(선택)」 단계 음원',  type: 'audio' },
  { key: 'lunch-prayer',     label: '점심 기도·묵상(선택)', desc: '점심 방송 「기도·묵상 시간(선택)」 단계 음원',  type: 'audio' },
  { key: 'staff',            label: '직원멘트',      desc: '랜덤 직원 음성',                             type: 'audio' },
  { key: 'breakfast-grace',  label: '🍚 아침 식사 안내', desc: '아침 식사 안내 녹음 (없으면 TTS 자동 재생)', type: 'audio' },
  { key: 'lunch-grace',      label: '🍚 점심 식사 안내', desc: '점심 식사 안내 녹음 (없으면 TTS 자동 재생)', type: 'audio' },
  { key: 'dinner-grace',     label: '🍚 저녁 식사 안내', desc: '저녁 식사 안내 녹음 (없으면 TTS 자동 재생)', type: 'audio' },
  { key: 'dinner-prayer',    label: '저녁 기도·묵상(선택)', desc: '저녁 마무리 「기도·묵상 시간(선택)」 단계 음원',                                          type: 'audio' },
  { key: 'evening-prayer',   label: '저녁 기도·묵상 2(선택)', desc: '저녁 마무리 두 번째 「기도·묵상 시간(선택)」 음원',                           type: 'audio' },
  { key: 'exercise-video',   label: '체조 영상',     desc: '국민체조 동영상',                             type: 'video' },
  { key: 'lunch-video',      label: '점심 영상',     desc: '점심 식사전 체조 동영상',                     type: 'video' },
  { key: 'dinner-video',     label: '저녁 영상',     desc: '저녁 식사전 체조 동영상',                     type: 'video' },
  { key: 'scene-video',      label: '배경 영상',     desc: '방송 뒤 소리 없이 띄우는 영상 (아침·점심·저녁)', type: 'video' },
]

// 트리 최상위 3그룹 — 각각 pseudo-카테고리(misc 계열)를 갖고, 그 안에 사용자가
// 직접 폴더를 만들 수 있다(오디오/영상은 거기에 더해 시스템 카테고리 9/3개도 고정 표시).
const GROUP_META = {
  my:    { cat: 'misc',       label: '내 폴더' },
  audio: { cat: 'misc-audio', label: '오디오' },
  // 배경음악(2026-09-22) — 방송용·식사용 기본 폴더와 사람이 만든 BGM 폴더. 시스템 갈래 중 이것만 왼쪽에 둔다:
  // 폴더 이름을 사람이 바꾸고 방송이 그 폴더를 고르므로 「사람의 폴더」다(2026-09-13 결정의 예외 까닭).
  bgm:   { cat: 'bgm',        label: '배경음악' },
  video: { cat: 'misc-video', label: '영상' },
}
const PSEUDO_LABEL = { misc: '내 폴더', 'misc-audio': '오디오', 'misc-video': '영상' }

// 파일이 어떤 방송에 쓰이는지 알려주는 작은 참조 뱃지 — 새 API 없이 이미 아는 정보로 계산
// "지금 나가는 것"은 **서버가 판정해서 내려준다**(`file.is_primary`, domain/categoryPick).
// 예전엔 이 함수가 서버 규칙을 화면에서 다시 구현하다가 틀렸다:
//   · 녹음 음원 자리에 "무작위 후보로 사용"이라 적었다 → 실제로는 첫 번째 하나만 고정으로 나간다
//   · BGM 2번째 이후를 "대기 중(비활성)"이라 적었다 → 실제로는 활성 항목이 전부 나간다
// 규칙을 두 번 쓰면 반드시 갈린다. 여기서는 서버가 준 값을 말로 옮기기만 한다.
function referenceBadge(file, playlist) {
  const cat = CATEGORIES.find(c => c.key === file.category)
  if (!cat) return { text: '자동방송 미사용 · 수동 방송(음원선택)에서 고를 수 있음', tone: 'neutral' }

  if (file.category === 'bgm') {
    const row = playlist.find(p => p.audio_file_id === file.id)
    if (!row)         return { text: '재생목록 미등록 — 순서 편집에서 추가하세요', tone: 'warn' }
    if (!row.active)  return { text: '재생목록에서 꺼둠 — 안 나갑니다', tone: 'neutral' }
    return { text: 'BGM 재생목록에 있음 — 순서대로 나갑니다', tone: 'active' }
  }

  if (file.is_primary) return { text: `${cat.label}에서 지금 나가는 파일`, tone: 'active' }
  return { text: '대기 — 「이걸로 바꾸기」를 누르면 이게 나갑니다', tone: 'neutral' }
}

export { CATEGORIES, GROUP_META, PSEUDO_LABEL, referenceBadge }
