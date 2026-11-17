// **준비물 점검** — 이 PC 에 필요한 프로그램이 있나 (사용자 지시 2026-09-16).
//
// *"꼭 필수적으로 설치하는거 운영하기 위해서 체크리스트 세워서 없으면 하나하나씩
//   다운로드 받을 수 있게"*
//
// ── 무엇이 달라지나 ────────────────────────────────────────────────────────
// 앞서는 **없는 것을 쓰려고 할 때** 알게 됐다 — 받아쓰기 단추를 누르고 나서야
// *"이 PC에 없습니다"*. 그때는 이미 그 일을 하려던 참이라, 몇 분짜리 설치를 기다리거나
// 그 일을 포기해야 한다. 여기서 한 번에 보고 받아 두면 그런 일이 안 생긴다.
//
// ── 「빨간 X 다섯 개」로 겁주지 않는다 ─────────────────────────────────────
// 없는 것을 **고장**이라고 하지 않는다. 받아쓰기가 없어도 방송은 그대로 나간다 —
// 자막을 자동으로 못 만들 뿐이다. 그래서 항목마다 **없으면 무엇을 못 하는지**를 적는다.
// 사람이 보고 *"이건 지금 안 받아도 되겠다"* 를 판단할 수 있어야 한다.
import { useState, useEffect, useCallback } from 'react'
import { Check, X, Loader2, Download, RefreshCw, AlertTriangle } from 'lucide-react'
import { getPrerequisites, installSttEngine } from '../../../lib/api'

// 받아쓰기는 **의존성 200MB + 모델 460MB** 다. 몇 분 걸린다 — 도는 동안 아무 표시가
// 없으면 사람이 창을 닫거나 다시 누른다(사용자 지적: *"언제까지 기다려야할지 모르잖아"*).
// 퍼센트는 pip 가 안 알려 준다. 그래서 **무엇을 하는 중인지**를 단계로 말한다.
const 받아쓰기단계 = [
  '파이썬 꾸러미를 받는 중 (1/2)',
  '받아쓰기 모델을 받는 중 (2/2) — 약 460MB',
]

export default function SetupPrereqs() {
  const [items, setItems] = useState(null)   // null = 아직 안 봄
  // **첫 확인은 열자마자 돈다.** 그래서 처음부터 참이다 — effect 안에서 동기로 켜면
  // `react-hooks/set-state-in-effect` 가 막고, 실제로도 한 박자 늦게 반영돼 첫 그림이
  // "확인 중"이 아니라 빈 목록이다.
  const [보는중, set보는중] = useState(true)
  const [설치중, set설치중] = useState(null)  // 설치 중인 항목 id
  const [진행, set진행] = useState(0)         // 받아쓰기 단계 번호
  const [알림, set알림] = useState('')
  const [오류, set오류] = useState('')

  const 보기 = useCallback(async () => {
    set보는중(true); set오류('')
    try { setItems((await getPrerequisites()).items || []) }
    catch (e) { set오류(e.message || '확인하지 못했습니다.') }
    set보는중(false)
  }, [])

  // 첫 확인은 **effect 안에서 직접** 돈다(위 상수 주석). 떠난 뒤 늦게 온 응답으로
  // 상태를 건드리지 않게 `살아있나` 로 막는다.
  useEffect(() => {
    let 살아있나 = true
    ;(async () => {
      try {
        const d = await getPrerequisites()
        if (살아있나) setItems(d.items || [])
      } catch (e) {
        if (살아있나) set오류(e.message || '확인하지 못했습니다.')
      } finally {
        if (살아있나) set보는중(false)
      }
    })()
    return () => { 살아있나 = false }
  }, [])

  const 받기 = async (item) => {
    set설치중(item.id); set알림(''); set오류(''); set진행(0)
    // 단계 표시는 **시늉이 아니다** — 첫 단계(꾸러미)가 대개 먼저 끝나고 모델이 오래
    // 걸린다. 그 전환을 시각으로 어림잡아 보여 준다. 정확한 퍼센트는 pip 가 안 준다.
    const 타이머 = setTimeout(() => set진행(1), 45_000)
    try {
      const r = await installSttEngine()
      set알림(r.message || '설치했습니다.')
      await 보기()
    } catch (e) {
      set오류(e.message || '설치하지 못했습니다.')
    } finally {
      clearTimeout(타이머)
      set설치중(null); set진행(0)
    }
  }

  const 없는것 = (items || []).filter(x => !x.있나)
  // 안내 음성 모델은 없어도 다음 엔진(Azure·윈도우 음성)으로 나간다 — 「중요한 것이 없다」로 겁주지 않는다.
  const 중요한것없나 = 없는것.some(x => x.id === 'python')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-ds-v3-ink-2">
          {items === null ? '이 PC 를 확인하는 중입니다…'
            : 없는것.length === 0 ? '필요한 것이 모두 있습니다.'
            : `${없는것.length}가지가 없습니다. 아래에서 받을 수 있습니다.`}
        </p>
        <button type="button" onClick={보기} disabled={보는중 || !!설치중}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn text-xs font-semibold
                     border border-ds-v3-line text-ds-v3-ink-2 hover:bg-ds-v3-bg btn-press disabled:opacity-50">
          <RefreshCw size={12} className={보는중 ? 'animate-spin' : ''} /> 다시 확인
        </button>
      </div>

      {중요한것없나 && (
        <div className="flex items-start gap-2 rounded-lg border border-ds-v3-warn/40 bg-ds-v3-warn/5 p-3">
          <AlertTriangle size={15} className="text-ds-v3-warn shrink-0 mt-0.5" />
          <p className="text-sm text-ds-v3-warn leading-relaxed">
            <b>안내 음성이 안 나가는 상태입니다.</b> 아래에서 파이썬과 음성 합성을 먼저 갖춰 주세요.
            음원 재생과 예약은 그대로 됩니다.
          </p>
        </div>
      )}

      <ul className="m-0 list-none space-y-2 p-0">
        {(items || []).map((x) => (
          <li key={x.id}
            className={'rounded-lg border p-3.5 '
              + (x.있나 ? 'border-ds-v3-line bg-ds-v3-bg' : 'border-ds-v3-line bg-white')}>
            <div className="flex items-start gap-2.5">
              <span className={'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 '
                + (x.있나 ? 'bg-ds-v3-tts text-white' : 'bg-ds-v3-surface-2 text-ds-v3-ink-2')}>
                {x.있나 ? <Check size={12} /> : <X size={12} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ds-v3-ink">{x.이름}</p>
                <p className="text-xs text-ds-v3-ink-2 mt-0.5">{x.쓰임}</p>
                {/* **없을 때만** 결과를 적는다. 있는 것 옆에 "없으면 …" 을 적으면
                    읽는 사람이 지금 상태와 헷갈린다. */}
                {!x.있나 && (
                  <p className="text-xs text-ds-v3-ink-3 mt-1.5 leading-relaxed">
                    {x.없으면.replace(/\*\*/g, '')}
                  </p>
                )}

                {!x.있나 && x.수동명령 && (
                  <div className="mt-2">
                    <p className="text-xs text-ds-v3-ink-2">
                      명령 창에서 아래를 한 번 실행한 뒤 「다시 확인」을 눌러 주세요.
                    </p>
                    <code className="mt-1 block rounded bg-ds-v3-bg border border-ds-v3-line px-2 py-1.5
                                     text-xs text-ds-v3-ink select-all break-all">
                      {x.수동명령}
                    </code>
                  </div>
                )}

                {!x.있나 && !x.수동명령 && !x.받을수있나 && (
                  <p className="text-xs text-ds-v3-ink-3 mt-2">파이썬을 먼저 갖춰야 받을 수 있습니다.</p>
                )}

                {/* 이 자리에서 받는 것은 받아쓰기뿐이다. 안내 음성 모델은 크기(139MB)가 커서
                    위의 명령(npm run setup:tts)으로 받는다 — 설치판에는 이미 담겨 있다. */}
                {!x.있나 && x.id === 'faster_whisper' && x.받을수있나 && (
                  <button type="button" onClick={() => 받기(x)} disabled={!!설치중}
                    className="mt-2 flex items-center gap-1.5 px-3 py-2 rounded-btn text-sm font-semibold
                               bg-ds-v3-tts hover:bg-ds-v3-ink text-white btn-press disabled:opacity-50">
                    {설치중 === x.id
                      ? <><Loader2 size={14} className="animate-spin" /> {받아쓰기단계[진행]}</>
                      : <><Download size={14} /> 지금 받기 (몇 분 걸립니다)</>}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {설치중 === 'faster_whisper' && (
        <p className="text-xs text-ds-v3-ink-2 leading-relaxed">
          창을 닫지 마세요. 받는 동안에도 <b>방송은 그대로 나갑니다.</b>
        </p>
      )}
      {알림 && <p className="text-sm text-ds-v3-ink-2">{알림}</p>}
      {오류 && (
        <p role="alert" className="text-sm text-ds-v3-warn whitespace-pre-wrap break-words">{오류}</p>
      )}
    </div>
  )
}
