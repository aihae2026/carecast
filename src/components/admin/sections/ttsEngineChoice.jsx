// 「먼저 쓸 안내 음성」 고르기 (사용자 지시 2026-09-22).
//
// *"설정에서 토글로 TTS에 폴백구조이긴 하지만 지금이랑 azure 이거랑 선택할 수 있게 해줘야지"*
// 고른 엔진이 맨 앞에 서고, 못 쓰면(키 없음·인터넷 끊김·모델 없음) 나머지가 뒤에서 받친다 — 무음은 없다.
// TTS 설정 화면과 「안내 음성 엔진」 카드 두 곳에서 같은 부품을 쓴다(말이 갈리지 않게).
//
// 2026-09-22: 설정 화면이 **실제로 맨 앞에 선 엔진**에 맞춰 목소리 칸을 바꾼다(이 PC 음성이면 이 PC 목소리,
// Azure 면 Azure 목소리·음높이) — 그래서 읽은 상태를 `onState` 로 밖에 알린다(설계 검토: 고른 것이 아니라
// 실제 맨 앞 — 모델이 없어 Azure 가 나가는데 Azure 목소리 칸이 숨어 있으면 안 된다).
import { useState, useEffect } from 'react'
import { getTtsEngines, saveTtsEnginePrimary } from '../../../lib/api'

const 선택지 = [
  { value: 'supertonic', 이름: '이 PC 음성 (Supertonic)', 설명: '인터넷 없이 이 PC 안에서 만듭니다' },
  { value: 'azure', 이름: 'Azure 음성', 설명: '인터넷으로 Microsoft 음성을 씁니다' },
]

/**
 * @param {(s: {primary?: string, front?: string|null, error?: boolean}) => void} [onState] 읽거나 바꿀 때마다 —
 *   primary = 사람이 고른 것, front = 지금 실제로 맨 앞(쓸 엔진이 없으면 null). 못 읽으면 { error: true }
 */
export default function TtsEngineChoice({ refreshKey = 0, onChanged, onState, voiceNote = null }) {
  const [상태, set상태] = useState(null)     // { engines, primary }
  const [저장중, set저장중] = useState(false)
  const [알림, set알림] = useState('')
  const [다시, set다시] = useState(0)
  const [못읽음, set못읽음] = useState(false)

  useEffect(() => {
    let 살아있음 = true
    getTtsEngines()
      .then((d) => { if (살아있음) { set상태(d); set알림(''); set못읽음(false) } })
      .catch((e) => { if (살아있음) { set알림('엔진 상태를 못 읽었습니다: ' + e.message); set못읽음(true) } })
    return () => { 살아있음 = false }
  }, [refreshKey, 다시])

  // 바깥(설정 화면)에 지금 상태를 알린다 — 읽은 뒤·바꾼 뒤.
  // 한 번도 못 읽었으면 그 사실도 알린다 — 안 알리면 설정 화면의 목소리 칸이 「확인 중」에 멈춘다(화면 검수 Medium).
  useEffect(() => {
    if (!상태) { if (못읽음) onState?.({ error: true }); return }
    onState?.({ primary: 상태.primary, front: 상태.engines?.find((e) => e.order === 0)?.name ?? null })
  }, [상태, 못읽음, onState])

  const 고르기 = async (value) => {
    if (!상태 || value === 상태.primary) return
    set저장중(true); set알림('')
    try {
      // **저장 응답으로 곧바로 그린다** (Codex ⑥ 1회차 Medium) — 다시 읽기가 실패하면 화면이 옛 선택으로
      // 남고, 그 옛 값 때문에 되돌리기 클릭까지 무시됐다. 응답에 차례·고른 값이 함께 온다.
      const r = await saveTtsEnginePrimary(value)
      set상태({ engines: r?.engines ?? 상태.engines, primary: r?.primary ?? value })
      onChanged?.()
    } catch (e) { set알림('저장 실패: ' + e.message) }
    finally { set저장중(false) }
  }

  const 엔진 = (name) => 상태?.engines?.find((e) => e.name === name)
  const 지금 = 상태?.engines?.find((e) => e.order === 0)
  const azure키없음 = 엔진('azure') && !엔진('azure').ok && /키/.test(엔진('azure').reason || '')

  return (
    <div className="space-y-2">
      <p className="t-sub text-ds-v3-ink-2" id="tts-engine-choice-label">
        먼저 쓸 안내 음성 <span className="text-ds-v3-ink-3">· 누르면 바로 적용됩니다</span>
      </p>
      <div role="radiogroup" aria-labelledby="tts-engine-choice-label" className="grid grid-cols-1 tablet:grid-cols-2 gap-2">
        {선택지.map((x) => {
          const 골랐나 = 상태?.primary === x.value
          const 막힘 = x.value === 'azure' && azure키없음
          return (
            <button key={x.value} type="button" role="radio" aria-checked={골랐나}
              disabled={!상태 || 저장중 || 막힘}
              onClick={() => 고르기(x.value)}
              className={`text-left px-3 py-2 rounded-btn border min-h-[44px] transition-colors disabled:opacity-50 ${
                골랐나 ? 'border-ds-v3-tts bg-ds-v3-tts-bg' : 'border-ds-v3-line bg-ds-v3-bg hover:bg-ds-v3-surface-2'}`}>
              <span className="block text-sm font-semibold text-ds-v3-ink">{골랐나 ? '● ' : '○ '}{x.이름}</span>
              <span className="block t-sub text-ds-v3-ink-2">
                {막힘 ? '키를 넣으면 고를 수 있습니다(설정 → AI · API 연동 → Azure 음성)' : x.설명}
              </span>
            </button>
          )
        })}
      </div>
      {지금 && (
        <p className="t-sub text-ds-v3-ink-2" role="status">
          {상태.primary !== 지금.name && '⚠ '}
          지금 실제로 나가는 목소리: <b className="text-ds-v3-ink">{지금.label.split(' (')[0]}{voiceNote && 지금.name === 'supertonic' ? ` · ${voiceNote}` : ''}</b>
          {상태.primary !== 지금.name && ' — 고른 엔진을 지금 쓸 수 없어 대신 나갑니다'}
          {' '}· 안 되면 나머지 엔진이 이어받습니다(무음 없음)
        </p>
      )}
      {알림 && (
        <p className="t-sub text-ds-v3-warn" role="alert">
          {알림}{' '}
          <button type="button" onClick={() => set다시((n) => n + 1)} className="underline font-semibold min-h-[44px] px-1">다시 시도</button>
        </p>
      )}
    </div>
  )
}
