// AI · API 연동 — **제 화면이다** (사용자 지시 2026-09-13).
//
// *"API설정은 시스템 운영에서 따로 하나 빼놔 모아서 그리고 쫀쫀하게 구성"*.
//
// 그전에는 「시스템 설정」 한 장 안의 세 갈래 중 하나였는데, 그 갈래만 **3258px** 였다
// (브라우저 실측). 한 화면에 든 셋 중 하나가 나머지 둘을 합친 것보다 길면 그것은
// 이미 다른 화면이다 — 나머지를 보려고 그 길이를 매번 지나야 한다.
//
// 여기 모이는 것: 키를 넣는 자리(날씨·미세먼지·구글 달력·AI 제공자)와
// **AI 가 방송문을 쓸 때 따르는 지침**. 지침이 여기 오는 이유는 그것이 "AI 를 어떻게
// 쓸 것인가"의 일부이기 때문이다 — 키만 넣고 지침은 다른 화면에 두면 둘이 갈린다.
import { useState, useEffect } from 'react'
import { Check, PenLine, RotateCcw } from 'lucide-react'
import { getBroadcastPrompt, saveBroadcastPrompt } from '../../../lib/api'
import APISettings from './APISettings'

export default function AiApiSettings() {
  const [promptText,    setPromptText]    = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [promptSaving,  setPromptSaving]  = useState(false)
  const [promptSaved,   setPromptSaved]   = useState(false)

  useEffect(() => {
    getBroadcastPrompt().then(d => {
      setDefaultPrompt(d.defaultPrompt || '')
      setPromptText(d.prompt || d.defaultPrompt || '')
    }).catch(() => {})
  }, [])

  const handleSavePrompt = async () => {
    setPromptSaving(true)
    try {
      // 기본값 텍스트 그대로면 "커스텀 없음" 상태로 저장(빈 문자열) — 코드 기본값이
      // 바뀌어도 계속 따라간다.
      const toSave = promptText.trim() === defaultPrompt.trim() ? '' : promptText
      await saveBroadcastPrompt(toSave)
      setPromptSaved(true)
      setTimeout(() => setPromptSaved(false), 2000)
    } catch { /* 저장 실패 — 사용자가 다시 시도 */ }
    finally { setPromptSaving(false) }
  }

  const handleResetPrompt = () => setPromptText(defaultPrompt)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="t-section text-ds-v3-ink">AI · API 연동</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">
          방송문을 짓는 AI와 날씨·미세먼지·구글 달력 연결을 정합니다. 키를 넣는 자리입니다.
        </p>
      </div>

      <APISettings />

      <div className="card-base">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <PenLine size={15} className="text-ds-v3-ink-2" />
          AI 방송문 작성 지침
        </h2>
        <p className="t-sub text-ds-v3-ink-2 mb-3">
          AI가 방송문을 쓸 때 따르는 지침입니다. 길이·말투·호칭 등을 원하는 대로 고쳐 쓸 수 있습니다.
        </p>
        {/* 10줄에서 8줄로 줄였다 — 이 칸은 늘려 볼 수 있고(`resize-y`), 기본값이 길면
            그만큼 아래 것들이 매번 밀려 내려간다(사용자 지시: *"쫀쫀하게"*). */}
        <textarea
          value={promptText}
          onChange={e => setPromptText(e.target.value)}
          rows={8}
          className="input-base font-mono t-sub leading-relaxed resize-y"
        />
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleSavePrompt}
            disabled={promptSaving || !promptText.trim()}
            className="flex min-h-[40px] items-center gap-1.5 rounded-btn px-4 t-body font-normal
                       bg-ds-v3-ink text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {promptSaved
              ? <><Check size={14} /> 저장됨</>
              : promptSaving ? '저장 중...' : '저장'}
          </button>
          <button
            onClick={handleResetPrompt}
            className="flex min-h-[40px] items-center gap-1.5 rounded-btn border border-ds-v3-line
                       px-3 t-body text-ds-v3-ink-2 transition-colors hover:text-ds-v3-ink"
          >
            <RotateCcw size={13} /> 기본값으로
          </button>
        </div>
      </div>
    </div>
  )
}
