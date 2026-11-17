// 단계의 **연결 고르개** — "이 자리에서 무엇이 나가나"를 그 자리에서 고른다.
//
// 설계: `docs/audit/design-upload-flow.md` §3-D. 배경은 이렇다 — 지금까지 고정 단계가
// 어느 파일을 트는지는 **코드에 박힌 카테고리 이름**이 정했고, 화면에는 그 이름을 적어 둔
// 접이식 표(`morning-prayer`·`exercise-video` …)가 있을 뿐이었다. 사람이 할 수 있는 일은
// "그 이름의 카테고리에 파일을 올리는 것"뿐이었고, 새 시설은 쓰지도 않을 열두 칸을 받았다.
//
// **네 상태가 각각 다르게 보여야 한다**(설계 §7-6). 이것이 이 부품의 합격 조건이다:
//
//   ① 저장 안 함  — 「기본값 사용 중」 꼬리표. DB 에 아무것도 안 써져 있다.
//   ② 폴더        — 폴더 이름이 보인다.
//   ③ 파일        — 파일 이름이 보인다.
//   ④ 연결 안 함  — 흐리게 + 「건너뜁니다」. **기본값이 다시 붙지 않는다.**
//
// ①과 ④를 눈으로 갈라야 하는 이유: 둘 다 "고른 것이 없다"로 보이지만 뜻이 정반대다.
// ①은 기본값대로 나가고 ④는 안 나간다. 같아 보이면 사람이 ④를 ①로 읽고 "왜 안 나가지"가 된다.
//
// **해석은 서버가 한 번만 한다**(설계 §2-C). 이 부품은 `sourceResolved` 를 **읽기만** 하고
// 다시 계산하지 않는다 — 화면이 따로 해석하면 방송이 고르는 것과 화면이 말하는 것이 갈린다.
import { useEffect, useState } from 'react'
import { Folder, FileAudio, FileVideo, Ban, ChevronDown, AlertTriangle } from 'lucide-react'
import { getFolders, getAudioFiles } from '../../../lib/api'
import { CATEGORIES, PSEUDO_LABEL } from './musicManagementConst'

// 이 단계 자리에 들어갈 수 있는 갈래. 서버의 `미디어종류()` 와 같은 규칙(이름이 -video 로
// 끝나면 영상)인데, 여기서는 **서버가 내려준 `sourceResolved.media`** 를 그대로 쓴다.
const 갈래카테고리 = (media) => (media === 'video' ? 'misc-video' : 'misc-audio')

// 카테고리를 **사람 이름**으로 옮긴다.
//
// 슬러그(`morning-prayer`)를 그대로 적으면 설계가 없애기로 한 것이 다시 나온다
// (design-upload-flow §7-8: 화면에 슬러그 0개). 표는 업로드 화면이 쓰는 것과 **같은 것**을
// 본다 — 여기서 이름표를 새로 만들면 두 화면이 같은 폴더를 다르게 부른다.
// 표에 없는 이름이면(새 카테고리) 슬러그 대신 갈래 이름으로 떨어진다.
const 카테고리이름 = (key, media) =>
  CATEGORIES.find(c => c.key === key)?.label
  ?? PSEUDO_LABEL[key]
  ?? (media === 'video' ? '영상' : '음원')

// 상태 넷의 표시. **색으로 가르지 않는다**(G-1: 색은 tts·bgm·flow 셋뿐) — 글자와 아이콘으로 말한다.
function 상태표시(resolved) {
  if (!resolved) return { 글: '연결 정보 없음', 꼬리: null, 흐림: true, Icon: Ban }
  if (resolved.error) {
    return { 글: resolved.error.message, 꼬리: '연결 오류', 흐림: false, 경고: true, Icon: AlertTriangle }
  }
  if (resolved.kind === 'none') {
    // ④ 사람이 일부러 끊었다 · 방금 기본값으로 되돌렸다 · ⑤ 가리킬 것이 아예 없다
    if (resolved.origin === 'saved') {
      return { 글: '연결 안 함', 꼬리: '이 단계는 건너뜁니다', 흐림: true, Icon: Ban }
    }
    if (resolved.origin === 'pending-default') {
      // 기본값이 무엇인지는 서버만 안다(저녁 마무리 음원 폴백처럼 DB 를 봐야 하는 것이 있다).
      // **지어내지 않고** 저장하면 보인다고 말한다.
      return { 글: '기본값으로 되돌림', 꼬리: '저장하면 반영됩니다', 흐림: true, Icon: Ban }
    }
    return { 글: '연결할 수 있는 것이 없습니다', 꼬리: null, 흐림: true, Icon: Ban }
  }
  const Icon = resolved.media === 'video' ? FileVideo : FileAudio
  if (resolved.kind === 'file') {
    return { 글: '파일 하나', 꼬리: resolved.origin === 'default' ? '기본값 사용 중' : null, 흐림: false, Icon }
  }
  // 폴더 — folderId 가 없으면 "그 갈래 전체"다
  return {
    글: resolved.folderId == null ? `${카테고리이름(resolved.category, resolved.media)} 전체` : '폴더',
    꼬리: resolved.origin === 'default' ? '기본값 사용 중' : null,
    흐림: false,
    Icon: resolved.folderId == null ? Icon : Folder,
  }
}

/**
 * @param {object}   props.step      단계 객체(서버가 `sourceResolved` 를 얹어 준다)
 * @param {function} props.onChange  (source) => void. `source` 는 저장될 값 그대로다:
 *                                   객체(폴더·파일) · `null`(해제) · `undefined`(기본값으로 되돌리기)
 * @param {object}   props.usage     `GET /folders/usage` 결과(없어도 된다) — 「N곳에서 씀」용
 */
export default function StepSourcePicker({ step, onChange }) {
  const resolved = step?.sourceResolved
  const [열림,   설정열림]   = useState(false)
  const [폴더들, 설정폴더들] = useState(null)
  const [파일들, 설정파일들] = useState(null)

  const media = resolved?.media || null
  const 그갈래 = 갈래카테고리(media)

  // 창을 열 때만 받아 온다 — 단계가 여덟 개인 화면에서 미리 받으면 요청이 여덟 번 난다.
  useEffect(() => {
    if (!열림) return
    let 살아있음 = true
    Promise.all([getFolders(그갈래), getAudioFiles()])
      .then(([f, a]) => {
        if (!살아있음) return
        설정폴더들(f || [])
        // 이 자리에 들어갈 수 있는 것만 — 음원 자리에 영상을 고르면 서버가 400 으로 막는다.
        // 막히기 전에 **애초에 안 보여 주는** 것이 낫다.
        설정파일들((a || []).filter(x => {
          const 영상 = String(x.category || '').endsWith('-video')
          return media === 'video' ? 영상 : !영상
        }))
      })
      .catch(() => { if (살아있음) { 설정폴더들([]); 설정파일들([]) } })
    return () => { 살아있음 = false }
  }, [열림, 그갈래, media])

  // 지금 무엇에 연결돼 있는지 한 줄로.
  //
  // **상태로 두지 않는다.** 처음엔 `useEffect` + `useState` 로 뒀다가 eslint 가 막았고,
  // 막은 것이 맞다 — 이 값은 `resolved` 와 받아 온 목록에서 **계산되는 것**이라 상태로
  // 두면 둘이 어긋나는 순간(목록이 늦게 오는 그 한 프레임) 빈칸이 보인다.
  // 목록을 아직 못 받았으면 번호로라도 말한다 — 빈칸을 두면 "연결이 없다"로 읽힌다.
  const 이름 = (() => {
    if (!resolved) return ''
    if (resolved.kind === 'folder' && resolved.folderId != null) {
      return (폴더들 || []).find(x => x.id === resolved.folderId)?.name ?? `폴더 #${resolved.folderId}`
    }
    if (resolved.kind === 'file' && resolved.audioFileId != null) {
      return (파일들 || []).find(x => x.id === resolved.audioFileId)?.original_name ?? `파일 #${resolved.audioFileId}`
    }
    return ''
  })()

  const 표시 = 상태표시(resolved)
  const Icon = 표시.Icon

  const 고르기 = (source) => { 설정열림(false); onChange(source) }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => 설정열림(v => !v)}
        aria-expanded={열림}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-btn border text-left
                    btn-press transition-colors t-sub
                    ${표시.경고 ? 'border-ds-v3-warn/50 bg-white'
                      : 'border-ds-v3-line bg-white hover:border-ds-v3-line-2'}`}
      >
        <Icon size={14} className={표시.경고 ? 'text-ds-v3-warn flex-shrink-0'
          : 표시.흐림 ? 'text-ds-v3-ink-2 flex-shrink-0' : 'text-ds-v3-ink flex-shrink-0'} />
        <span className={`flex-1 min-w-0 truncate ${표시.흐림 ? 'text-ds-v3-ink-2' : 'text-ds-v3-ink'}`}>
          {이름 || 표시.글}
        </span>
        {표시.꼬리 && (
          <span className="t-sub flex-shrink-0 text-ds-v3-ink-2 bg-ds-v3-bg rounded px-1.5 py-0.5">
            {표시.꼬리}
          </span>
        )}
        <ChevronDown size={13} className={`flex-shrink-0 text-ds-v3-ink-2 transition-transform ${열림 ? 'rotate-180' : ''}`} />
      </button>

      {/* 사유는 **위 단추가 이미 말한다** — 여기서 되풀이하지 않는다(브라우저 검증 2026-09-13:
          같은 문장이 두 번 나왔다). 여기서 더할 것은 **사람이 모르는 사실 하나**다:
          "그래서 지금 어떻게 되는가". 기본값으로 조용히 돌아가지 않았다는 것이 그것이고,
          그것을 알아야 "왜 이 방송이 안 나갔지"가 풀린다. */}
      {표시.경고 && (
        <p className="t-sub text-ds-v3-warn mt-1.5 px-1">
          기본값으로 바꾸지 않았습니다 — 이 단계는 건너뜁니다.
        </p>
      )}

      {열림 && (
        <div className="mt-1.5 rounded-btn border border-ds-v3-line bg-white p-2 space-y-2">
          {/* ── 폴더 ── */}
          <div>
            <p className="t-sub font-semibold text-ds-v3-ink-2 px-1 mb-1">폴더</p>
            {폴더들 === null ? (
              <p className="t-sub text-ds-v3-ink-2 px-1 py-1">불러오는 중…</p>
            ) : 폴더들.length === 0 ? (
              // 빈 상태를 **말로** 채운다 — 빈 목록만 두면 "고장인가"가 된다.
              <p className="t-sub text-ds-v3-ink-2 px-1 py-1">
                아직 만든 폴더가 없습니다. 업로드 화면에서 파일을 올리며 만들 수 있습니다.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {폴더들.map(f => (
                  <li key={f.id}>
                    <button type="button"
                      onClick={() => 고르기({ kind: 'folder', category: 그갈래, folderId: f.id })}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-btn t-sub text-left
                                 text-ds-v3-ink hover:bg-ds-v3-bg btn-press transition-colors">
                      <Folder size={13} className="text-ds-v3-ink-2 flex-shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── 파일 하나 ── */}
          <div className="border-t border-ds-v3-line pt-2">
            <p className="t-sub font-semibold text-ds-v3-ink-2 px-1 mb-1">파일 하나</p>
            {파일들 === null ? (
              <p className="t-sub text-ds-v3-ink-2 px-1 py-1">불러오는 중…</p>
            ) : 파일들.length === 0 ? (
              <p className="t-sub text-ds-v3-ink-2 px-1 py-1">올린 파일이 없습니다.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto space-y-0.5">
                {파일들.map(a => (
                  <li key={a.id}>
                    <button type="button"
                      onClick={() => 고르기({ kind: 'file', audioFileId: a.id })}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-btn t-sub text-left
                                 text-ds-v3-ink hover:bg-ds-v3-bg btn-press transition-colors">
                      {media === 'video'
                        ? <FileVideo size={13} className="text-ds-v3-tts flex-shrink-0" />
                        : <FileAudio size={13} className="text-ds-v3-ink-2 flex-shrink-0" />}
                      <span className="truncate">{a.original_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── 해제 · 기본값으로 ── */}
          <div className="border-t border-ds-v3-line pt-2 flex flex-wrap gap-1.5">
            <button type="button"
              onClick={() => 고르기(null)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-btn t-sub
                         text-ds-v3-ink-2 border border-ds-v3-line hover:bg-ds-v3-bg btn-press transition-colors">
              <Ban size={13} /> 연결 안 함 (건너뜀)
            </button>
            {/* ①로 되돌리기 — `undefined` 를 주면 부르는 쪽이 `source` 키를 **지운다**.
                `null` 과 다르다: 이쪽은 다시 기본값대로 나간다. */}
            <button type="button"
              onClick={() => 고르기(undefined)}
              className="px-2.5 py-1.5 rounded-btn t-sub text-ds-v3-ink-2
                         border border-ds-v3-line hover:bg-ds-v3-bg btn-press transition-colors">
              기본값으로 되돌리기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
