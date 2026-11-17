import { useState, useEffect } from 'react'
import { Bell, PowerOff, Plus, Trash2, Star, Save } from 'lucide-react'
import { getFavorites, createFavorite, updateFavorite, deleteFavoriteBtn } from '../../../lib/api'
import { SystemSettingsBroadcast } from './systemSettingsBroadcast'
import { SystemSettingsEtc }       from './systemSettingsEtc'
import { SystemSettingsWatch }     from './systemSettingsWatch'
import SystemSettingsPc            from './systemSettingsPc'

export function FavoritesEditor() {
  const [favs,    setFavs]    = useState([])
  const [saving,  setSaving]  = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [draft,   setDraft]   = useState({})

  const load = () => getFavorites().then(data => {
    setFavs(data)
    const d = {}
    data.forEach(f => { d[f.id] = { label: f.label, content: f.content } })
    setDraft(d)
  }).catch(() => {})

  useEffect(() => { load() }, [])

  const setField = (id, field, val) =>
    setDraft(d => ({ ...d, [id]: { ...d[id], [field]: val } }))

  const handleSave = async (fav) => {
    const { label, content } = draft[fav.id] || {}
    if (!label?.trim() || !content?.trim()) return
    setSaving(fav.id)
    try {
      await updateFavorite(fav.id, { label: label.trim(), content: content.trim(), voice: fav.voice || 'ko-KR-SunHiNeural' })
      await load()
    } catch (e) { console.error('[설정] 즐겨찾기 버튼 저장 실패:', e.message) }  // 목록을 다시 부르지 않으므로 화면은 예전 값 그대로다
    finally { setSaving(null) }
  }

  const handleDelete = async (id) => {
    setDeleting(id)
    try { await deleteFavoriteBtn(id); await load() } catch (e) { console.error('[설정] 즐겨찾기 버튼 삭제 실패:', e.message) }  // 목록에 그대로 남는다 — 지워진 것처럼 보이면 더 나쁘다
    finally { setDeleting(null) }
  }

  const handleAdd = async () => {
    setSaving('new')
    try {
      await createFavorite({ label: '새 버튼', content: '방송 내용을 입력하세요.', voice: 'ko-KR-SunHiNeural' })
      await load()
    } catch (e) { console.error('[설정] 즐겨찾기 버튼 추가 실패:', e.message) }  // 목록이 안 늘어난 것으로 사람이 알아챈다
    finally { setSaving(null) }
  }

  return (
    <div className="card-base p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star size={15} className="text-ds-v3-warn" />
          <span className="t-label font-semibold text-ds-v3-ink">즐겨찾기 버튼 관리</span>
          <span className="text-xs text-ds-v3-ink-2">(쉬운화면 즉시방송 버튼 · 최대 4개)</span>
        </div>
        {favs.length < 4 && (
          <button onClick={handleAdd} disabled={saving === 'new'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-ds-v3-ink hover:bg-black
                       text-white text-xs font-semibold rounded-btn disabled:opacity-60 btn-press">
            <Plus size={12} /> {saving === 'new' ? '추가 중...' : '버튼 추가'}
          </button>
        )}
      </div>

      {favs.length === 0 && (
        <p className="text-sm text-ds-v3-ink-2 text-center py-4">즐겨찾기 버튼이 없습니다. 위 버튼으로 추가하세요.</p>
      )}

      <div className="space-y-3">
        {favs.map((fav, i) => {
          const d = draft[fav.id] || { label: fav.label, content: fav.content }
          const changed = d.label !== fav.label || d.content !== fav.content
          return (
            <div key={fav.id} className="border border-ds-v3-line rounded-[10px] p-3.5 bg-ds-v3-bg space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ds-v3-ink-2 w-4">{i + 1}</span>
                <input
                  value={d.label}
                  onChange={e => setField(fav.id, 'label', e.target.value)}
                  placeholder="버튼 라벨"
                  className="w-32 border border-ds-v3-line rounded-btn px-2.5 py-1.5 text-sm font-semibold
                             bg-white text-ds-v3-ink focus:outline-none focus:border-ds-v3-tts"
                />
                <span className="text-xs text-ds-v3-ink-2">→ 쉬운화면에 표시되는 이름</span>
              </div>
              <div className="flex gap-2 ml-6">
                <textarea
                  value={d.content}
                  onChange={e => setField(fav.id, 'content', e.target.value)}
                  rows={2}
                  placeholder="방송 내용 (TTS로 읽힙니다)"
                  className="flex-1 border border-ds-v3-line rounded-btn px-2.5 py-1.5 text-sm
                             bg-white text-ds-v3-ink resize-none focus:outline-none focus:border-ds-v3-tts"
                />
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => handleSave(fav)}
                    disabled={!changed || saving === fav.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-ds-v3-ink hover:bg-black
                               text-white text-xs font-semibold rounded-btn disabled:opacity-40 btn-press whitespace-nowrap">
                    <Save size={11} /> {saving === fav.id ? '저장 중' : '저장'}
                  </button>
                  <button
                    onClick={() => handleDelete(fav.id)}
                    disabled={deleting === fav.id}
                    className="flex items-center gap-1 px-3 py-1.5 border border-ds-v3-warn/30
                               text-ds-v3-warn hover:bg-ds-v3-warn-bg text-xs font-semibold rounded-btn
                               disabled:opacity-40 btn-press whitespace-nowrap">
                    <Trash2 size={11} /> {deleting === fav.id ? '삭제 중' : '삭제'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {favs.length >= 4 && (
        <p className="text-xs text-ds-v3-ink-2 text-center">최대 4개까지 등록할 수 있습니다.</p>
      )}
    </div>
  )
}

const 설정갈래 = [
  // 2026-09-11: '오디오 · 방송 출력'과 'TTS 설정'을 **'음량 및 TTS' 메뉴로 옮겼다**
  // (사용자 지시 UX-37). 소리 설정이 세 곳에 흩어져 있어 "어디서 조절하나"에 답이 셋이었다.
  // 옛 링크(`?section=ttsSettings`·`?section=apiSettings` 등)는 AdminMode 의
  // LEGACY_REDIRECTS 가 새 자리로 보낸다.
  //
  // ── 제목 밑에 **무엇이 들어 있는지 한 줄** (사용자 지시 2026-09-13) ────────────
  // 제목만 있으면 「기타」 같은 이름은 아무것도 안 가리킨다. 설정은 **가끔 와서 정확히
  // 고치고 나가는 화면**이라, 안 열어 보고도 "여기 있겠구나"를 알 수 있어야 한다.
  // 그래서 갈래 이름을 푸는 것이 아니라 **안에 무엇이 있는지**를 적는다 —
  // 「기타」의 설명이 "그 밖의 것"이면 한 줄을 버린 것이다.
  //
  // ── 「AI · API 연동」은 **제 화면으로 나갔다** (사용자 지시 2026-09-13) ─────────
  // 셋 중 그 갈래만 3258px 였다(실측). 한 화면에 든 셋 중 하나가 나머지 둘을 합친 것보다
  // 길면 그것은 이미 다른 화면이고, 나머지를 보려고 그 길이를 매번 지나야 한다.
  // 옛 주소(`?section=aiSettings`·`apiSettings`)는 그 화면으로 간다(`LEGACY_REDIRECTS`).
  { id: 'broadcast', title: '방송 운영 · 자동화', icon: PowerOff,
    desc: '홀 TV 화면 문구, PC 자동 종료, 기상특보 자동방송, 방송 감시·백업 시각을 정합니다.' },
  { id: 'etc',       title: '기타',               icon: Bell,
    desc: '자동 업데이트처럼 자주 건드리지 않는 것들입니다.' },
]

// 갈래 하나. **접이식이 아니다**(사용자 지시 2026-09-12: *"시스템 설정 빠지면서 휑한데
// 한번 정리하지? 굳이 접이식으로 해야 하나? 많이 빠졌는데"*).
//
// 재어 보고 고쳤다(브라우저 실측, 화면 높이 900):
//   · 기타 **389px** — 한 화면의 절반도 안 되는 것을 접어 두고 있었다. 순수한 마찰이다
//   · 방송 운영 1193px
//   · AI·API 3258px — 이것만 길다
// 2026-09-11 에 '오디오 · 방송 출력'과 'TTS 설정'이 '음량 및 TTS' 메뉴로 빠져나가(UX-37)
// 남은 분량이 줄었는데 접이식은 그대로였다. 셋 다 닫으면 큰 화면에 **가느다란 막대 셋**만
// 남는다 — 그것이 "휑하다"의 정체다.
//
// 그래서 **다 펼쳐 두고, 긴 쪽은 바로가기로 건너뛴다.** 스크롤은 숨기지 않는다 —
// 접이식은 "여기에 무엇이 있는지"를 감추고, 시설 실무자가 유지보수하는 화면에서 그것이
// 가장 비싸다(CLAUDE.md 구조 단순성: 사람이 읽고 이해할 수 있는가가 먼저다).
function SettingsSection({ id, title, desc, icon: Icon, children }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-5">
      {/* 제목과 설명은 **한 덩어리**다 — 사이를 `space-y-5` 가 벌리면 설명이 아래 카드에
          붙어 보인다. 그래서 둘을 감싸서 묶고, 간격은 안에서 따로 준다. */}
      <div>
        <h2 className="t-group m-0 flex items-center gap-2 pt-1 text-ds-v3-ink">
          <Icon size={15} className="text-ds-v3-ink-2" />
          {title}
        </h2>
        {desc && <p className="mt-1 mb-0 t-sub text-ds-v3-ink-2">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

export default function SystemSettings({ initialGroup }) {
  // 다른 화면에서 `?section=…` 으로 들어오면 **펼치는 대신 그 자리로 옮겨 준다.**
  // 펼칠 것이 없으니 할 일은 스크롤뿐이다.
  useEffect(() => {
    if (!initialGroup) return
    const el = document.getElementById(`설정-${initialGroup}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [initialGroup])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-section text-ds-v3-ink">시스템 설정</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">서버 및 방송 시스템 환경을 설정합니다.</p>
      </div>

      {/* 바로가기 — 4800px 짜리 한 장이라 위에서 건너뛸 자리가 필요하다.
          접이식과 다른 점: **무엇이 있는지는 다 보이고**, 이동만 도와준다. */}
      <nav aria-label="설정 갈래 바로가기"
        className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-ds-v3-bg/95 backdrop-blur flex flex-wrap gap-2">
        {설정갈래.map(g => (
          <a key={g.id} href={`#설정-${g.id}`}
            className="inline-flex items-center gap-1.5 min-h-[24px] px-2.5 py-1 rounded-full border
                       border-ds-v3-line bg-ds-v3-surface text-xs font-semibold text-ds-v3-ink-2
                       hover:text-ds-v3-ink hover:border-ds-v3-line-2 transition-colors">
            <g.icon size={12} /> {g.title}
          </a>
        ))}
      </nav>

      {설정갈래.map(g => (
        <SettingsSection key={g.id} id={`설정-${g.id}`} title={g.title} desc={g.desc} icon={g.icon}>
          {g.id === 'broadcast' && (
            <>
              <SystemSettingsBroadcast />
              {/* 방송 감시·백업(2026-09-23) — 서버는 읽는데 바꾸는 칸이 없던 넷 */}
              <SystemSettingsWatch />
            </>
          )}

          {g.id === 'etc' && (
            <>
              {/* ── 이 PC 에 관한 것 (사용자 지시 2026-09-16) ────────────────────
                  *"모바일 마이크는 시스템 설정으로 가도되고, 이 pc의 역할은 시스템
                    설정으로"* — 둘 다 소리 설정이 아니라 **이 PC 에 관한 것**이라
                  「음량 및 TTS」에서 여기로 옮겼다. */}
              <SystemSettingsPc />
              <SystemSettingsEtc />
            </>
          )}
        </SettingsSection>
      ))}
    </div>
  )
}
