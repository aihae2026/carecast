// **라이선스 · 고지** — 제 화면 (사용자 지시 2026-10-07).
//
// *"실제 게시문 뽑아서 출력할 수 있도록 따로 설정에서 만들어주면 좋을듯"*
//
// 한 화면에 셋을 둔다:
//  ① **게시문** — 기관 이름을 넣어 그대로 인쇄한다. 인쇄하면 이 한 장만 나온다(`index.css` 의
//     `@media print` 와 `.print-only`). Open RAIL-M 이용 제한 (e) 「기계가 만든 것임을 밝힌다」를
//     지키는 실제 수단이 이 종이다 — 방송을 듣는 어르신이 볼 수 있게 붙인다.
//  ② **이용 조건 동의** — 처음 설정에서 건너뛴 현장이 여기서 동의한다(관리 화면 알림 띠가 이리로 보낸다).
//  ③ **이용 제한 요약 · 함께 쓰는 것들** — 글은 전부 `lib/licenseNotice`·`lib/dataCredits` 에서 온다.
import { useEffect, useState } from 'react'
import { Printer, ShieldCheck, Scale, Check } from 'lucide-react'
import { getOrgInfo, getLicenseConsent, saveLicenseConsent } from '../../../lib/api'
import { 약관판, 약관항목, 이용제한, 원문안내, 게시문, 동의필요, 동의날짜 } from '../../../lib/licenseNotice'
import { 출처들 } from '../../../lib/dataCredits'

const 함께쓰는것 = [
  { 이름: 'CareCast', 조건: 'Apache-2.0 · Copyright 2026 jung-svg' },
  { 이름: 'Supertonic 3 음성 모델 (Supertone Inc.)', 조건: 'BigScience Open RAIL-M — 이용 제한 있음(위)' },
  { 이름: 'sherpa-onnx · ONNX Runtime', 조건: 'Apache-2.0 · MIT' },
  { 이름: 'espeak-ng · piper-phonemize (sherpa-onnx 실행 파일 안에 포함)', 조건: 'GPL-3.0 · MIT — 설치판을 나눠 줄 때 GPL 고지와 소스 제공 조건을 따른다(LICENSES.md 2-1절)' },
  { 이름: 'Node.js · Python · React 등 프로그램 부품', 조건: '각자의 라이선스 — THIRD-PARTY-NOTICES.md' },
]

export default function LicenseNoticePage() {
  const [기관, set기관] = useState('')
  const [기록, set기록] = useState(undefined)     // undefined = 읽는 중, null = 동의한 적 없음
  const [못읽음, set못읽음] = useState(false)
  const [동의함, set동의함] = useState(false)
  const [동의자, set동의자] = useState('')
  const [저장중, set저장중] = useState(false)
  const [알림, set알림] = useState('')

  useEffect(() => {
    getOrgInfo().then((d) => set기관(d?.name || '')).catch(() => set기관(''))
    getLicenseConsent()
      .then((r) => { set기록(r?.consent ?? null); set못읽음(false) })
      .catch(() => { set기록(null); set못읽음(true) })
  }, [])

  const 글 = 게시문(기관)
  const 이름 = 동의자.trim()
  const 동의가능 = 동의함 && 이름 && 이름.length <= 40 && !저장중

  const 동의하기 = async () => {
    if (!동의가능) return
    set저장중(true); set알림('')
    try {
      const r = await saveLicenseConsent(약관판, 이름)
      set기록(r?.consent ?? null); set동의함(false); set동의자(''); set못읽음(false)
      // 미동의 띠가 같은 창에 떠 있으면 내려가게 알린다(LicenseConsentBanner 가 듣는다).
      try { window.dispatchEvent(new Event('cc-license-consent')) } catch { /* 없으면 새로고침 때 사라진다 */ }
    } catch (e) {
      set알림(`저장하지 못했습니다 — ${e?.message || '알 수 없는 오류'}`)
    } finally { set저장중(false) }
  }

  return (
    <div className="space-y-5">
      <div className="no-print">
        <h1 className="t-section text-ds-v3-ink">라이선스 · 고지</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">
          안내 방송 목소리는 오픈소스 합성 음성 모델로 만듭니다. 그 모델의 조건에 따라 <b>합성 음성이라는 것을
          어르신과 보호자께 알려야</b> 합니다. 아래 게시문을 인쇄해 방송 스피커 근처나 게시판에 붙여 주세요.
        </p>
      </div>

      {/* ① 게시문 — 인쇄하면 이 카드만 나온다 */}
      <div className="card-base">
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <h2 className="t-label font-semibold text-ds-v3-ink flex items-center gap-2">
            <Printer size={15} className="text-ds-v3-tts" /> 붙일 게시문
          </h2>
          <button type="button" onClick={() => window.print()}
            className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ds-v3-ink px-5 text-sm font-semibold text-white">
            <Printer size={15} /> 인쇄하기
          </button>
        </div>
        {!기관 && (
          <p className="no-print mb-3 text-xs text-ds-v3-ink-2">
            기관 이름이 비어 있어 「○○요양원」으로 나옵니다. 초기 설정 → 기관 정보에서 넣거나 인쇄한 뒤 손으로 적어 주세요.
          </p>
        )}
        <section className="print-only notice-sheet rounded-[14px] border border-ds-v3-line bg-white px-6 py-8 text-ds-v3-ink" aria-label="게시문 미리보기">
          <h3 className="text-[clamp(22px,3vw,30px)] font-semibold">{글.제목}</h3>
          <div className="mt-5 space-y-3 text-[clamp(17px,2.2vw,22px)] leading-relaxed">
            {글.본문.map((줄, i) => <p key={i} className={i === 1 ? 'font-semibold' : ''}>{줄}</p>)}
          </div>
          <p className="mt-8 text-right text-[clamp(17px,2.2vw,22px)] font-semibold">{글.서명}</p>
        </section>
      </div>

      {/* ② 동의 */}
      <div className="card-base no-print">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <ShieldCheck size={15} className="text-ds-v3-tts" /> 이용 조건 동의 <span className="font-normal text-ds-v3-ink-3">(판 {약관판})</span>
        </h2>
        {기록 === undefined ? <p className="text-xs text-ds-v3-ink-2">불러오는 중…</p>
          : 못읽음 ? <p className="text-xs text-ds-v3-warn">동의 기록을 못 읽었습니다. 서버가 켜져 있는지 보고 새로고침해 주세요.</p>
          : !동의필요(기록) ? (
            <p className="flex items-center gap-1.5 text-sm text-ds-v3-ink-2">
              <Check size={15} aria-hidden="true" /> {기록.by} 님이 {동의날짜(기록.at)} 에 동의했습니다.
            </p>
          ) : (
            <p className="text-xs text-ds-v3-ink-2">
              {기록 ? `옛 판(${기록.version})에 동의한 기록이 있습니다. 내용이 바뀌어 다시 동의가 필요합니다.` : '아직 동의한 기록이 없습니다.'}
              {' '}동의 버튼은 확인 기록입니다. <b>안내 음성 모델의 이용 제한은 동의 여부와 관계없이, 이 프로그램으로 모델을 쓰는 모든 기관에 적용됩니다.</b>
              {' '}동의하지 않아도 방송은 그대로 나갑니다.
            </p>
          )}
        <ol className="mt-4 m-0 list-none space-y-2.5 p-0">
          {약관항목.map((x, i) => (
            <li key={i} className="rounded-[10px] border border-ds-v3-line bg-ds-v3-bg px-3.5 py-3">
              <p className="text-sm font-semibold text-ds-v3-ink">{i + 1}. {x.제목}</p>
              <p className="text-xs text-ds-v3-ink-2 mt-1 leading-relaxed">{x.글}</p>
            </li>
          ))}
        </ol>
        {기록 !== undefined && 동의필요(기록) && (
          <div className="mt-4 space-y-3">
            <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold text-ds-v3-ink">
              <input type="checkbox" className="h-5 w-5" checked={동의함} onChange={(e) => set동의함(e.target.checked)} />
              위 내용과 아래 이용 제한을 읽었고 동의합니다
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input value={동의자} onChange={(e) => set동의자(e.target.value)} maxLength={40}
                placeholder="동의하는 분 (이름 또는 직책)" aria-label="동의하는 분"
                className="min-h-11 flex-1 min-w-[200px] rounded-[10px] border border-ds-v3-line-2 bg-white px-3 text-sm" />
              <button type="button" onClick={동의하기} disabled={!동의가능}
                className="min-h-11 rounded-full bg-ds-v3-ink px-5 text-sm font-semibold text-white disabled:opacity-50">
                {저장중 ? '저장 중…' : '동의하기'}
              </button>
            </div>
            {알림 && <p className="text-xs font-semibold text-ds-v3-warn" role="alert">{알림}</p>}
          </div>
        )}
      </div>

      {/* ③ 이용 제한 · 함께 쓰는 것 */}
      <div className="card-base no-print">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-1 flex items-center gap-2">
          <Scale size={15} className="text-ds-v3-tts" /> 음성 모델의 이용 제한 (Open RAIL-M)
        </h2>
        <ul className="mt-3 m-0 list-disc space-y-1.5 pl-5">
          {이용제한.map((x, i) => (
            <li key={i} className={'text-xs leading-relaxed ' + (x.특히 ? 'font-semibold text-ds-v3-ink' : 'text-ds-v3-ink-2')}>{x.글}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ds-v3-ink-3">{원문안내}</p>
      </div>

      <div className="card-base no-print">
        <h2 className="t-label font-semibold text-ds-v3-ink mb-3">함께 쓰는 것들</h2>
        <ul className="m-0 list-none space-y-2 p-0">
          {함께쓰는것.map((x) => (
            <li key={x.이름} className="text-xs"><b className="text-ds-v3-ink">{x.이름}</b> <span className="text-ds-v3-ink-2">— {x.조건}</span></li>
          ))}
          {출처들.map((s, i) => (
            <li key={'d' + i} className="text-xs">
              <b className="text-ds-v3-ink">{s.기관}</b> <span className="text-ds-v3-ink-2">— {s.자료} · {s.조건}</span>
              {s.링크 && <> · <a href={s.링크} target="_blank" rel="noreferrer" className="text-ds-v3-tts hover:underline">{s.링크글}</a></>}
              {s.조건링크 && <> · <a href={s.조건링크} target="_blank" rel="noreferrer" className="text-ds-v3-tts hover:underline">{s.조건링크글}</a></>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ds-v3-ink-3">전문은 설치 폴더의 LICENSE · NOTICE · LICENSES.md · THIRD-PARTY-NOTICES.md · licenses/ 에 있습니다.</p>
      </div>
    </div>
  )
}
