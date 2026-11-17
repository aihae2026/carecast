/**
 * **이 프로세스가 시험인가.** 한 곳에서, 부류로 판정한다.
 *
 * ── 왜 따로 뺐나 (2026-09-14) ────────────────────────────────────────────────
 * 같은 판정이 `services/autoShutdown.js` 에 있었고, 거기 적힌 이유가 그대로 옳다:
 *   *"개별 시험 DB 에 값을 넣는 것으로 끝내면 그 시험 파일에만 걸린다. 새 시험이 이 경로를
 *     건드리면 또 뚫린다. 그래서 DB 가 아니라 **프로세스가 시험인지**로 막는다."*
 * 2026-09-14 에 **두 번째 소비자**가 생겼다 — `db/schema.js` 가 시험 중에 기본 경로의 DB
 * 를 여는 것을 막는다(현장 PC 에서 `npm test` 를 돌리면 운영 DB 를 연다). 사본을 두면
 * 한쪽만 고쳤을 때 두 안전장치가 조용히 갈린다. 그래서 **지금** 합친다(추상화는 두 번째
 * 사례가 생겼을 때 만든다 — `CLAUDE.md` 구조 단순성 ⑤).
 *
 * `db/` 도 `services/` 도 여기를 부를 수 있어야 해서 `domain/` 에 둔다 —
 * 이 파일은 **아무것도 require 하지 않는다**(순수 판정).
 */
'use strict'

function 테스트중() {
  // ① node 의 시험 러너가 자식 프로세스에 세운다
  if (process.env.NODE_TEST_CONTEXT) return true
  // ② 시험 파일을 **직접** 돌리면(`node test/x.test.js`) ①이 없다. `node:test` 를
  //    불러왔다는 사실로 본다 — 평범한 서버 기동에는 이 항목이 없다(실측).
  if (process.moduleLoadList?.some(m => m === 'NativeModule test')) return true
  // ③ 다른 하네스를 위한 명시 스위치. 소리 스위치(`CARECAST_NO_HARDWARE`)와 **일부러 가른다** —
  //    그것은 소리를 막는 것이고, 여기서 막는 것은 소리가 아니다.
  return process.env.CARECAST_TEST === '1'
}

module.exports = { 테스트중 }
