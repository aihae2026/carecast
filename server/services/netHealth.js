// 인터넷이 실제로 되는지 — 이미 하고 있는 통신의 결과로 판단한다.
//
// 왜 필요했나(전수검수 CC-025): 대시보드의 네트워크 카드가 **랜 카드 주소만 보고**
// "연결됨 초록"을 띄웠다. 공유기가 인터넷에서 끊겨도 랜 주소는 그대로 있으므로, 인터넷이
// 죽어도 화면은 정상으로 보였다. 그런데 케어캐스트는 안내 음성(Azure 를 쓸 때)·날씨·AI 가
// 전부 인터넷에 매달려 있어서, 끊기면 방송이 눈에 띄게 나빠진다. 아무도 모르는 채로.
//
// **인터넷을 확인하려고 새 요청을 보내지 않는다.** 날씨·안내 음성은 어차피 주기적으로
// 바깥과 통신한다. 그 결과를 주워 담기만 하면 공짜로 알 수 있다. 확인용 요청을 따로 쏘면
// 무인 PC에서 6개월간 쌓이는 트래픽이 되고, 그 자체가 또 하나의 실패 지점이 된다.
//
// finding은 "24시간 내 성공 없으면 경고"를 권했지만 따르지 않았다 — 대시보드는 **지금**을
// 보는 화면이라 24시간은 너무 굵다. 아침에 끊긴 인터넷을 저녁까지 초록으로 보여주게 된다.
// 대신 마지막 통신의 성패를 쓰고, 마지막 성공 시각을 함께 실어 사람이 판단하게 한다.
'use strict'

const state = {
  online:     null,   // null = 아직 아무 통신도 안 해봄
  lastOkAt:   null,   // ISO — 실패해도 지우지 않는다(얼마나 됐는지가 판단 재료다)
  lastFailAt: null,
  lastSource: null,   // 마지막 결과를 만든 곳. 무엇이 실패했는지 알아야 손을 쓴다
}

/**
 * 바깥으로 나간 통신 하나의 결과.
 * **절대 던지지 않는다** — 상태를 적으려다 방송이 멈추면 본말전도다.
 *
 * @param {boolean} ok
 * @param {string}  source  '날씨' · '안내음성' 처럼 사람이 읽을 이름
 */
function record(ok, source = null) {
  try {
    const now = new Date().toISOString()
    state.online     = !!ok
    state.lastSource = source ?? state.lastSource
    if (ok) state.lastOkAt = now
    else    state.lastFailAt = now
  } catch { /* 상태 갱신 실패가 호출부를 깨뜨리지 않게 */ }
}

/** /api/status가 실어 보내는 요약 */
function summary() {
  return { ...state }
}

function _resetForTest() {
  state.online = null
  state.lastOkAt = null
  state.lastFailAt = null
  state.lastSource = null
}

module.exports = { record, summary, _resetForTest }
