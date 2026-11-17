// ── 1회성 데이터 보정 (main 전용, 현장 PC 대상) ──────────────────────────────
// 점심·저녁 식사 전 동요 흐름의 BGM 단계에 "예약 시각"(config.at_time)을 채운다.
//
// 배경: 동요 음원이 늘어지면 뒤의 BGM·체조 준비 방송이 통째로 밀리는 사고가 실제로 났다.
// 이번에 흐름 단계에 예약 시각 기능이 들어갔지만(그 시각이 되면 앞을 끊고 시작), 흐름 구성은
// 현장 PC의 DB 데이터라 코드 배포만으로는 값이 안 채워진다. 개발 PC에서 현장 DB를 직접 만질
// 방법이 없어서, 자동 업데이트로 배포되는 이 코드가 부팅 시 딱 한 번 채워 넣는다(사용자 지시).
//
// 무엇을 건드리나 — 최대한 좁게:
//   · broadcast_type='flow'인 활성 예약 중 발동 시각이 10:00~11:14(점심) / 15:00~16:19(저녁)인 것
//   · 그 흐름 안에서 "음원(audio) 단계 뒤에 나오는 첫 BGM 단계" 하나
//     (BGM 선재생처럼 음원보다 앞에 있는 BGM은 건너뛴다 — 거기 시각을 걸면 엉뚱한 단계가 끊긴다)
//   · at_time이 이미 있으면 절대 덮어쓰지 않는다 (사람이 맞춘 값 보존 — 볼륨 시딩과 같은 원칙)
//   · 점심 → 11:15, 저녁 → 16:20 (사용자 지정 값)
//
// 한 번 실행되면 settings에 결과를 남기고 다시는 실행되지 않는다(재부팅해도).
// 대상을 못 찾으면 아무것도 바꾸지 않고 그 사실만 기록한다 — 추측으로 다른 단계를 건드리지 않는다.
// 되돌리기: 관리자 화면 흐름 편집기에서 해당 BGM 단계의 시각 뱃지 X를 누르면 된다.
const DONE_KEY = 'datafix_meal_flow_anchor_20260828'

const TARGETS = [
  { label: '점심', windowStart: '10:00', windowEnd: '11:15', atTime: '11:15' },
  { label: '저녁', windowStart: '15:00', windowEnd: '16:20', atTime: '16:20' },
]

function applyMealFlowAnchorFix(db) {
  try {
    const already = db.prepare('SELECT value FROM settings WHERE key = ?').get(DONE_KEY)
    if (already) return

    const results = []
    const schedules = db.prepare(`
      SELECT id, title, scheduled_time, flow_sequence_id FROM schedules
      WHERE broadcast_type = 'flow' AND active = 1 AND flow_sequence_id IS NOT NULL
    `).all()

    for (const target of TARGETS) {
      const candidates = schedules.filter(s =>
        s.scheduled_time >= target.windowStart && s.scheduled_time < target.windowEnd)
      if (candidates.length === 0) {
        results.push(`${target.label}: 대상 흐름 예약 없음(${target.windowStart}~${target.windowEnd})`)
        continue
      }
      for (const s of candidates) {
        const steps = db.prepare(
          'SELECT id, step_type, label, config FROM flow_sequence_steps WHERE flow_sequence_id = ? ORDER BY sort_order ASC'
        ).all(s.flow_sequence_id)

        // 음원 단계 "뒤에" 나오는 첫 BGM 단계를 찾는다
        let sawAudio = false
        let picked = null
        for (const st of steps) {
          if (st.step_type === 'audio') sawAudio = true
          if (sawAudio && st.step_type === 'bgm') { picked = st; break }
        }
        if (!picked) {
          results.push(`${target.label} "${s.title}": 음원 뒤 BGM 단계가 없어 건너뜀`)
          continue
        }
        let config = {}
        try { config = JSON.parse(picked.config || '{}') } catch { /* 깨진 config면 새로 시작 */ }
        if (config.at_time) {
          results.push(`${target.label} "${s.title}": 이미 예약 시각(${config.at_time}) 있음 — 보존`)
          continue
        }
        config.at_time = target.atTime
        db.prepare('UPDATE flow_sequence_steps SET config = ? WHERE id = ?')
          .run(JSON.stringify(config), picked.id)
        results.push(`${target.label} "${s.title}": BGM 단계(${picked.label || '무제'})에 ${target.atTime} 설정`)
      }
    }

    const summary = results.join(' | ') || '변경 없음'
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(DONE_KEY, `${new Date().toISOString()} :: ${summary}`)
    console.log(`[데이터보정] 식사 전 흐름 BGM 예약시각: ${summary}`)
  } catch (e) {
    // 보정 실패로 서버 기동이 막히면 본말전도 — 로그만 남기고 다음 부팅에 다시 시도한다
    console.error('[데이터보정] 식사 전 흐름 BGM 예약시각 실패:', e.message)
  }
}

module.exports = { applyMealFlowAnchorFix, DONE_KEY }
