// 방송 유형 → **색 갈래 셋**. 통합 홈이 쓰는 유일한 색 규칙이다.
//
// 사용자 결정(2026-09-13): **색은 셋뿐이다.**
//   말(TTS) 파랑 · 음악(BGM) 자주 · 순서(흐름) 보라.
// 차임벨·음원·영상에는 색을 주지 않는다 — 넷째 색을 만들면 화면이 지저분해지고,
// "이 색이 무슨 뜻이냐"를 사람이 더는 외우지 못한다.
//
// **왜 파일로 뺐나**: 오늘 일과 목록(`HomeToday`)과 초안 카드(`QuickSchedulePhrase`)가
// 같은 규칙을 봐야 한다. 두 벌로 두면 같은 방송이 목록에서는 파랑, 카드에서는 무색이
// 되는 날이 온다 — 이 저장소가 `scheduleBatch`·`volume` 에서 이미 겪은 모양이다.
//
// **유형 낱말의 단일 출처는 서버의 `domain/ontology.js` 다.** 여기는 그 유형을 **색으로**
// 옮기는 자리일 뿐, 문장에서 유형을 알아내는 일은 하지 않는다(그건 서버가 한다).

/** 색 갈래의 사람 말 이름 — 초안 카드의 갈래 알약이 쓴다(목업 `KINDS`). */
export const KIND_LABEL = { tts: '안내방송', bgm: '배경음악', flow: '순서 흐름' }

/** 목록 줄의 태그 이름. 좁은 줄에 들어가야 해서 흐름만 짧다(목업 `plan` 의 `g`). */
const ROW_LABEL = { tts: '안내방송', bgm: '배경음악', flow: '흐름' }

/**
 * 예약의 `broadcast_type` 을 색 갈래로 옮긴다.
 * @param {string} type `text` · `bgm` · `flow` · `chime` · `audio` · `video`
 * @returns {'tts'|'bgm'|'flow'|''} 색이 없으면 빈 문자열
 */
export function kindOfType(type) {
  const t = String(type || '')
  if (t === 'flow') return 'flow'
  if (t === 'bgm') return 'bgm'
  if (t === 'text') return 'tts'
  return ''
}

/**
 * 한 **항목**을 색 갈래로 옮긴다. 화면마다 항목의 생김새가 달라서 둘 다 본다 —
 * 오늘 목록은 `{ kind, type }`, 달력은 `{ _isAuto, broadcast_type }` 이다.
 *
 * **이것은 캘린더 전용이다. 오늘 목록은 `tagOfRow` 를 쓴다.**
 * 예전엔 둘이 같은 것을 썼고, 자동 일과방송을 흐름(보라)으로 올렸다. 그랬더니 오늘 목록의
 * 여덟 줄이 **전부** 색 알약을 달았다(G-2 위반). 갈라 놓는 근거는 이렇다 —
 * **색은 개별 방송 한 건의 "무슨 소리인가"에만 쓴다.** 캘린더에서 자동방송은 하루치를 접은
 * **묶음 칩**이라 색 규칙 밖이고, 사용자가 *"캘린더 색 이대로 가"* 로 얼려 뒀다.
 * 오늘 목록에서 자동방송은 **한 줄 한 건**이고 그 목록의 **다수**라, 칠하면 위계가 평평해진다.
 */
export function kindOfItem(item) {
  if (item?.kind === 'auto' || item?._isAuto) return 'flow'
  return kindOfType(item?.type ?? item?.broadcast_type)
}

/**
 * **목록 한 줄에 태그를 달까? 달면 무슨 태그인가.**
 *
 * 가이드라인 G-2 · G-18 · G-34 의 자리다.
 *
 * 처음엔 색을 줄 수 있으면 다 줬다. 그랬더니 오늘 목록 여덟 줄이 **전부** 색 알약을 달았고
 * (자동 5종이 보라, 환기가 파랑), 사용자가 *"AI 냄새난다"* 고 했다. 맞는 말이다 —
 * **한 목록에서 색 붙은 줄이 절반을 넘으면 그 색은 아무것도 가리키지 못한다.**
 * 목업은 여덟 줄 중 **둘**만 색이다.
 *
 * 그래서 규칙이 셋이다:
 *   ① **자동 일과방송**(`kind === 'auto'`)은 **무채색 「자동」**.
 *      색을 안 주는 이유 둘 — 오늘 목록에서 이것이 **다수**라 칠하면 위계가 평평해지고,
 *      차임 → 안내 → 음원 → 대기가 이어지는 **묶음**이라 한 가지 소리가 아니다.
 *   ② **묶음으로 접힌 줄**(환기방송 1·2차처럼 `group_id` 로 묶인 것)은 **태그 없음**.
 *      매일 같은 시각에 도는 그 목록의 기본값이라, 태그가 말해 줄 것이 없다.
 *   ③ 그 밖(일회성·예약 TTS·BGM·흐름)만 **색 태그**. 하루에 0~2줄이다.
 *
 * @returns {{kind:string, label:string}|null} null 이면 **태그를 안 단다**
 */
export function tagOfRow(item) {
  if (!item) return null
  if (item.kind === 'auto' || item._isAuto) return { kind: '', label: '자동' }
  if (item.group_id || item._isGroup) return null
  const k = kindOfType(item.type ?? item.broadcast_type)
  return k ? { kind: k, label: ROW_LABEL[k] } : null
}

// ── 타이핑하는 동안의 힌트 (목업 v3 의 `guessKind`) ─────────────────────────
//
// 목업은 검색창에 글을 치는 동안 **무슨 종류로 읽혔는지**를 바로 보여 준다 —
// 검색창 테두리가 그 색이 되고, 배경 물감 두 방울이 그쪽으로 움직인다
// (`v3.html:125-130,149-151,1163-1167`). 말이 색으로 먼저 돌아오는 자리다.
//
// **이것은 판정이 아니라 힌트다.** 진짜 판정은 서버의 `ontology.js` 가 한다.
// 여기 낱말을 두는 이유는 하나뿐이다 — 글자를 칠 때마다 서버를 부를 수 없어서다.
// (`/api/schedules/parse-phrase` 는 규칙이 시각을 못 읽으면 **Gemini 를 부른다** —
//  유료이고 10.5초다. 타이핑 중에 부를 경로가 아니다.)
//
// **사전을 두 벌로 만든 것이 아니다.** 이 목록이 서버 사전과 어긋나면
// `server/test/kind-hints.test.js` 가 빨간불을 낸다 — 그 시험은 `ontology.js` 를
// 실제로 읽어 대조한다. 서버에 낱말이 하나 늘면 여기도 늘어야 통과한다.
export const KIND_HINTS = {
  // 음악 — `CONCEPTS` 의 bgm
  bgm: ['배경음악', '배경 음악', 'bgm', '음악', '노래', '클래식', '찬송가', '트로트', '가요'],
  // 순서 — `FLOW_CUES`
  flow: ['흐름', '순서', '시퀀스', '실행'],
  // 말 — `TTS_CUES`
  tts: ['안내', '공지', '알림', '멘트', '방송문', '말해', '읽어'],
}

/**
 * 친 글에서 종류를 **짐작**한다. 못 짐작하면 빈 문자열이다.
 *
 * **아무 말에나 색을 주지 않는다**(G-2). 목업은 아무것도 안 걸리면 `tts` 로 떨어뜨리는데,
 * 그러면 글자를 치는 순간 늘 파랑이 되어 색이 아무것도 못 가리킨다. 여기서는 **단서가
 * 실제로 나왔을 때만** 색이 선다. 「11시에 점심」은 무색, 「11시에 점심 **안내**」는 파랑이다.
 *
 * 보는 순서는 음악 → 순서 → 말이다. 말(`안내`·`알림`)의 낱말이 가장 흔해서, 먼저 보면
 * 「음악 안내 방송」 같은 문장이 전부 파랑이 된다.
 *
 * @param {string} text
 * @returns {'tts'|'bgm'|'flow'|''}
 */
export function guessKindFromText(text) {
  const t = String(text ?? '').toLowerCase()
  if (!t.trim()) return ''
  for (const kind of ['bgm', 'flow', 'tts'])
    if (KIND_HINTS[kind].some(w => t.includes(w))) return kind
  return ''
}
