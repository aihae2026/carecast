// PC 자동 종료 스케줄러 — 매일 지정 시각에 Windows shutdown 명령 실행
//
// ── 진행 중 검사를 **의도적으로 넣지 않았다** (2026-09-06 사용자 결정) ──────────
//
// autoUpdate 에는 `restartWhenIdle` 이 있어서 방송 중이면 재시작을 미룬다. 여기엔 없다.
// 빠뜨린 것이 아니라 **넣지 않기로 한 것**이다:
//
//   종료 시각에는 방송이 없다. 그 시각에는 그냥 꺼지는 것이 맞고,
//   **종료가 미뤄지는 것이 오히려 원하지 않는 동작이다.**
//
// autoUpdate 와 다른 이유: 재시작은 미뤄도 다음 주기에 또 온다(손해가 없다).
// 종료는 미루면 PC 가 밤새 켜져 있게 된다 — 그것이 이 기능이 막으려던 바로 그 일이다.
//
// **그러니 "여기 안전장치가 빠졌네" 하고 다시 넣지 말 것.** 넣으려면 먼저,
// 종료 시각에 방송이 겹치도록 시각이 바뀌었는지부터 확인한다(아래 경고가 그것을 알린다).
// ───────────────────────────────────────────────────────────────────
const { rawSetting } = require('../domain/settingsRead')
const { exec } = require('child_process')
const { getDB } = require('../db/schema')

let shutdownTimer = null

// ── 종료 명령이 나가는 **유일한 문** (2026-09-13) ─────────────────────────────
//
// 예전엔 `exec('shutdown …')` 이 두 자리에 흩어져 있었다(예약 발동·취소). 자리가 둘이면
// 막는 것도 둘이어야 하고, 그러면 언젠가 하나를 빠뜨린다. **한 문으로 모은다.**
//
// 여기서 막는 것 하나: **테스트 환경**. `pc_role` 이 무엇이든, 어느 브랜치든 상관없이
// 시험 프로세스에서는 진짜 `shutdown` 이 안 나간다.
//
// 왜 개별 시험 DB 에 `dev` 를 넣는 것으로 끝내면 안 되나(사용자 지시):
//   · 그 방법은 **그 시험 파일에만** 걸린다. 새 시험이 이 경로를 건드리면 또 뚫린다.
//   · 현장 PC(`main`)에서 `npm test` 를 돌리면 역할 판정이 **맞아도** SITE 라 걸린다.
// 그래서 DB 가 아니라 **프로세스가 시험인지**로 막는다 — 한 곳에서, 부류로.
// **판정은 `domain/testMode.js` 한 곳에 있다**(2026-09-14). 같은 판정을 `db/schema.js` 도
// 보게 되면서 사본이 둘이 됐다 — 한쪽만 고치면 두 안전장치가 조용히 갈린다.
// 규칙은 한 글자도 안 바뀌었다.
const { 테스트중 } = require('../domain/testMode')

/**
 * 종료 명령 실행. **모든 shutdown 호출이 여기를 지난다.**
 * @returns {boolean} 실제로 명령을 내보냈으면 true
 */
function 종료명령(cmd, 왜, 실행기 = exec) {
  if (테스트중()) {
    console.log(`[자동종료] 시험 환경 — "${cmd}" 를 실행하지 않습니다 (${왜})`)
    return false
  }
  실행기(cmd, (err) => { if (err) console.error('[자동종료] 오류:', err.message) })
  return true
}

/**
 * @param {object} [opts] 테스트 이음새 — { 실행기, branch, override }
 *   `실행기` 는 `exec` 를 대신한다(모의 처리). `branch`·`override` 는 역할 판정을 고정한다.
 * @returns {{예약함: boolean, 사유: string}} 왜 걸었는지/안 걸었는지. 시험이 이것을 본다.
 */
function scheduleAutoShutdown(opts = {}) {
  if (shutdownTimer) { clearTimeout(shutdownTimer); shutdownTimer = null }

  // DB 핸들은 **한 번만** 얻어 아래로 넘긴다. 예전엔 여기와 역할 판정에서 각각 getDB()를
  // 불렀는데, 그러면 "두 번째 호출이 던지면?"이라는 밟을 수 없는 경로를 지키느라 방어 코드가
  // 늘어난다(2026-09-10 독립 검수 지적). 핸들 하나면 그 질문 자체가 없어진다.
  //
  // 못 읽으면 **예약하지 않고 부팅은 계속한다**(사용자 지시 2026-09-10) —
  // 부팅이 막히는 것보다 이 기능 하나가 꺼지는 편이 훨씬 싸다. index.js가 try 없이 부른다.
  // 예전엔 여기서 조용히 return 했다. 무인 현장 PC에서 그것은 "왜 안 꺼지는지 아무도 모름"이다.
  //
  // **다만 이 catch 는 운영 경로에서 도달하지 않는다** — 3회차 독립 검수가 짚었다:
  // getDB 는 memoize 되고(db/schema.js:10-34), index.js:139 의 initDB()→getDB() 가 먼저 돌며,
  // rawSetting 도 실패 시 null 을 낼 뿐 안 던진다(settingsRead.js:40-49).
  // 지우지 않고 남기는 이유는 **부팅 진입점의 값싼 방어**이기 때문이다 —
  // 이 함수는 settings 저장(routes/settings.js)과 재예약 타이머에서도 불리고,
  // 그 자리들은 initDB 보장 밖이다. "밟힌다"고 적지는 않는다.
  let db, timeStr
  try {
    db = getDB()
    timeStr = rawSetting(db, 'auto_shutdown_time')
  } catch (e) {
    console.warn(`[자동종료][WARN] 설정을 못 읽어 예약을 건너뜁니다: ${e.message}`)
    try {
      require('./alert').raise('자동종료',
        '설정을 읽지 못해 PC 자동종료를 예약하지 않았습니다. 시각 설정을 확인해주세요.')
    } catch (e2) { console.warn('[자동종료][WARN] 경보 전달도 실패:', e2.message) }
    return { 예약함: false, 사유: '설정을 못 읽음' }
  }

  if (!timeStr) return { 예약함: false, 사유: '시각 미설정' }
  // macOS/리눅스 개발 환경 가드 — shutdown /s는 Windows 명령이다. 시각이 저장돼 있어도
  // 예약하지 않고, 왜 안 걸었는지 분명히 남긴다(침묵 실패 금지).
  if (process.platform !== 'win32') {
    console.log('[자동종료] Windows 전용 — macOS/리눅스에서는 예약하지 않습니다')
    return { 예약함: false, 사유: 'Windows 아님' }
  }
  // 현장 PC 가드 — **DB 값에만 의존하면 테스트 한 번에 개발 PC가 꺼진다.**
  // 실제로 2026-09-06 검증 중에 그 사고가 날 뻔했다(값을 넣고 이 함수를 불렀더니
  // Windows 개발 PC에 진짜 종료 타이머가 걸렸다).
  //
  // CARECAST_NO_HARDWARE가 아니라 pcRole을 쓰는 이유: 그 스위치는 **소리**를 막는 것이고
  // 종료는 소리가 아니다. 그리고 pcRole은 "모르면 현장으로 본다"라 방향이 안전하다 —
  // 현장이 조용히 안 꺼지는 것보다 개발 PC가 안 꺼지는 쪽이 낫다.
  // audioDeviceWatcher가 이미 같은 방식을 쓴다(role !== SITE면 안 한다).
  //
  // **db를 반드시 넘긴다.** pcRole.readOverride(db)는 db가 없으면 빈 값을 돌려주고, getRole은
  // 그러면 브랜치 판정으로 폴백한다 — 즉 관리자가 정한 pc_role이 통째로 무시된다.
  // 예전엔 서버 전체에서 여기만 인자가 없었다(P-74). getRole은 던지지 않는다(pcRole.js의
  // catch 둘이 각각 ''를 돌려주고 roleFromBranch('')가 SITE를 낸다) — 그래서 try가 필요 없다.
  const { roleWithSource, roleLabel, SITE, 출처 } = require('./pcRole')
  const { role, source, branch } = roleWithSource(db, opts)
  if (role !== SITE) {
    console.log(`[자동종료] ${roleLabel(role)} — ${timeStr}이 설정돼 있지만 예약하지 않습니다 (현장 PC에서만 동작)`)
    return { 예약함: false, 사유: '개발 PC' }
  }
  // ── **판정을 못 했으면 끄지 않는다** (2026-09-13) ────────────────────────────
  //
  // `pcRole` 의 "모르면 현장으로 본다" 규칙은 **안전장치를 더 거는** 소비자에게 맞다.
  // 여기만 반대다 — 모를 때 PC 를 끄는 것은 안전한 쪽이 아니라 가장 위험한 쪽이다.
  //
  // 실제로 그렇게 됐다: git worktree 에서 `.git` 이 폴더가 아니라 파일이라 브랜치를
  // 못 읽었고, 빈 값이 `site` 로 떨어져 **개발 PC 에 진짜 종료 타이머(22.8시간)** 가 걸렸다.
  // 브랜치 읽기는 고쳤지만(`detectGitDir`), **읽기 실패가 곧 종료 허용이 되는 구조** 자체를
  // 끊어 둔다 — 다음에 또 못 읽는 상황이 와도(권한·파일시스템·경로 변경) 안 꺼진다.
  //
  // **명시한 현장 설정은 그대로 산다** — `pc_role='site'` 는 `source='override'` 라 지난다.
  // 지금 현장 PC 는 `pc_role` 없이 `main` 브랜치로 판정된다(`source='branch'`) — 그대로 지난다.
  if (source === 출처.모름) {
    console.warn(
      `[자동종료][WARN] 이 PC 가 현장인지 **확인하지 못했습니다** — ${timeStr} 예약을 건너뜁니다. `
      + '브랜치를 못 읽었습니다(저장소 정보 없음·읽기 실패). 현장 PC 라면 관리자 화면에서 '
      + 'PC 역할을 「현장」으로 명시해 주세요.')
    try {
      require('./alert').raise('자동종료',
        'PC 역할을 확인하지 못해 자동 종료를 예약하지 않았습니다. 관리자 화면에서 PC 역할을 정해 주세요.')
    } catch (e) { console.warn('[자동종료][WARN] 경보 전달도 실패:', e.message) }
    return { 예약함: false, 사유: '역할 판단 불가' }
  }
  void branch

  // ── **시험 환경이면 타이머를 안 건다** (사용자 지시 2026-09-13) ──────────────
  //
  // `pc_role` 이 무엇이든, 어느 브랜치든 상관없다. 개별 시험 DB 에 `dev` 를 넣는 것으로
  // 끝내지 않는 이유: 그 방법은 **그 시험 파일에만** 걸리고, 현장 PC(`main`)에서
  // `npm test` 를 돌리면 판정이 맞아도 SITE 라 그대로 걸린다.
  //
  // **역할 판정 뒤에 둔다.** 판정은 읽기만 하는 순수 조회라 시험에서 돌아도 해가 없고,
  // 오히려 그 배선(진짜 db 를 넘기는가)을 시험이 볼 수 있어야 한다(`pc-role.test.js`).
  // 막아야 하는 것은 판정이 아니라 **타이머와 명령**이다.
  if (테스트중()) {
    console.log(`[자동종료] 시험 환경 — ${timeStr} 이 설정돼 있지만 예약하지 않습니다`)
    return { 예약함: false, 사유: '시험 환경' }
  }

  const [h, m] = timeStr.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return { 예약함: false, 사유: '시각 형식 오류' }

  const now    = new Date()
  const target = new Date()
  target.setHours(h, m, 0, 0)
  if (target <= now) target.setDate(target.getDate() + 1)

  const ms = target - now
  console.log(`[자동종료] ${timeStr}에 PC 종료 예약됨 (${Math.round(ms / 60000)}분 후) — 취소: shutdown /a`)

  // 마지막 방송과 종료 시각이 얼마나 붙어 있는지 알린다.
  //
  // **이 경고의 목적은 종료를 막는 것이 아니다.** 종료는 예정대로 간다(위 머리말 참고).
  // 목적은 **방송 시각이나 종료 시각을 바꿨을 때 둘이 겹치는지 사람이 알아채게** 하는 것이다.
  // 지금은 저녁 마무리 방송 18:00 / 종료 18:21 로 여유가 있지만, 둘 중 하나만 옮겨도 그 여유가
  // 사라진다. 그때 아무도 모르면 재생 도중에 꺼진다.
  //
  // 판정은 새로 만들지 않고 domain/autoBroadcasts.js 의 시각·활성 키를 그대로 읽는다.
  try {
    const { AUTO_BROADCASTS, autoTime } = require('../domain/autoBroadcasts')
    const { getSetting } = require('../domain/settingsRead')
    const shutdownMin = h * 60 + m
    const 후보 = []
    for (const spec of AUTO_BROADCASTS) {
      if (getSetting(db, spec.enabledKey) !== 'true') continue
      // 빈 시각 = 사람이 끈 방송이다. 안 나갈 방송을 종료 경고의 근거로 세지 않는다(P-35).
      const t = autoTime(getSetting(db, spec.timeKey), spec)
      const parsed = t && /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t)
      if (!parsed) continue
      const 방송분 = Number(parsed[1]) * 60 + Number(parsed[2])
      if (방송분 <= shutdownMin) 후보.push({ label: spec.label, t, 방송분, 남는분: shutdownMin - 방송분 })
    }
    const 마지막 = 후보.sort((a, b) => a.남는분 - b.남는분)[0]
    if (마지막 && 마지막.남는분 <= 30) {
      // 사람이 판단하려면 "몇 분 뒤"가 아니라 **언제 끝나고 얼마가 남는지**가 필요하다.
      // 유예는 watchdog 과 같은 설정을 쓰고(기본 5분), 방송 길이는 저녁 마무리 방송 실측값을 쓴다.
      const 유예 = Number(getSetting(db, 'watchdog_grace_min')) || 5
      const 방송길이 = 6                       // 저녁 마무리 방송 약 5.6분(PROJECT_PROFILE §6 실측)
      const 예상끝 = 마지막.방송분 + 유예 + 방송길이
      const hhmm = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
      const 여유 = shutdownMin - 예상끝
      console.warn(
        `[자동종료] ⚠ ${마지막.label}(${마지막.t}) — 유예 ${유예}분 + 방송 약 ${방송길이}분 → `
        + `예상 종료 ${hhmm(예상끝)}, PC 종료 ${timeStr} (여유 ${여유}분). `
        + '종료는 예정대로 갑니다 — 시각을 바꿨다면 겹치는지 확인하세요. 취소: shutdown /a'
      )
    }
  } catch (e) {
    // 경고를 못 냈다고 종료 예약을 막지는 않는다 — 알림은 부가 기능이다.
    console.warn('[자동종료] 방송 시각 대조 실패(예약은 그대로):', e.message)
  }

  shutdownTimer = setTimeout(() => {
    shutdownTimer = null
    // ── **끄기 직전에 한 번 더 본다** (2026-09-13) ──────────────────────────
    //
    // 예약과 발동 사이는 최대 24시간이다. 그 사이에 이 PC 가 무엇인지에 대한 답이
    // 바뀔 수 있다 — 사람이 역할을 「개발」로 바꾸거나, 저장소가 옮겨져 브랜치를
    // 못 읽게 되거나. 예약할 때의 판정을 22시간 뒤에 그대로 믿고 전원을 내리지 않는다.
    // 되돌릴 수 없는 동작 앞에서는 **그 순간의 사실**을 본다.
    try {
      const { roleWithSource, SITE, 출처 } = require('./pcRole')
      const 지금 = roleWithSource(db, opts)
      if (지금.role !== SITE || 지금.source === 출처.모름) {
        console.warn(`[자동종료][WARN] 발동 직전 재확인에서 막혔습니다 `
          + `(역할=${지금.role}, 출처=${지금.source}) — PC 를 끄지 않습니다`)
        shutdownTimer = setTimeout(() => scheduleAutoShutdown(opts), 90 * 1000)
        return
      }
    } catch (e) {
      // 재확인을 못 했으면 **끄지 않는다.** 모를 때 전원을 내리는 것이 이 사고의 모양이었다.
      console.warn('[자동종료][WARN] 발동 직전 재확인 실패 — PC 를 끄지 않습니다:', e.message)
      shutdownTimer = setTimeout(() => scheduleAutoShutdown(opts), 90 * 1000)
      return
    }
    console.log('[자동종료] PC 종료 명령 실행')
    종료명령('shutdown /s /t 30', '예약 시각 도달', opts.실행기)
    // 다음날 동일 시각 재예약 (취소 가능하도록 shutdownTimer에 저장)
    shutdownTimer = setTimeout(() => scheduleAutoShutdown(opts), 90 * 1000)
  }, ms)
  return { 예약함: true, 사유: `${timeStr} 예약` }
}

function cancelAutoShutdown(opts = {}) {
  if (shutdownTimer) { clearTimeout(shutdownTimer); shutdownTimer = null }
  // 취소도 **같은 문**을 지난다 — 자리가 둘이면 언젠가 하나를 빠뜨린다.
  종료명령('shutdown /a', '취소 요청', opts.실행기)
  console.log('[자동종료] 종료 취소됨')
}

module.exports = { scheduleAutoShutdown, cancelAutoShutdown, 테스트중, 종료명령 }
