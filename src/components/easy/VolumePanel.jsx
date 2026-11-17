import { useState, useEffect, useRef, useCallback } from 'react'
import { Sliders, Volume2, VolumeX, Radio, Music2, Film, Mic } from 'lucide-react'
import { getVolume, saveVolume, saveBgmBroadcastDefault } from '../../lib/api'
import HelpTip from '../shared/HelpTip'

// 음소거를 풀 때 **기억이 없으면 돌아갈 값** (2026-09-11 독립 검수 지적).
//
// 처음엔 `음소거토글(key, value, 기본 = 50)` 로 **코드에 50 을 박았다.** 마스터는 저장까지
// 타는 채널이라(`소리만적용` 의 `saveVolume`) 그 숫자가 그대로 DB 에 남는다 — 볼륨 기본값이
// 8곳에 흩어져 있던 2026-08-28 사고를 다시 만드는 길이었다.
//
// **정본은 `server/domain/volume.js` 의 `fallback` 이다.** 여기 있는 것은 화면 쪽 사본이고,
// `server/test/volume-panel-ui.test.js` 가 두 값을 **대조한다** — 서버를 고치면 여기도 빨간불이다.
// (마이크는 이 표에 없다. 배율 채널이라 '끔'이 없고 음소거 버튼도 안 그린다.)
// 기본값은 `lib/volumeDefaults` 한 곳이다(UX-39). 예전엔 이 파일 안에만 있어서
// **다른 화면(`systemSettingsAudio`)이 각자 숫자를 박고 있었다** — 2026-08-28 볼륨 사고와
// 같은 모양이다(기본값이 8곳에 흩어져 한 곳만 고쳐짐).
import { 볼륨기본값 } from '../../lib/volumeDefaults'

// 모든 채널의 '끔'은 0 이다 — 마이크는 배율 채널이라 음소거 대상이 아니다.
// **부품 밖에 둔 이유**: 동기화 수신부(위)와 음소거 토글(아래)이 **둘 다** 이 값을 쓰는데,
// 부품 안 아래쪽에 두면 위에서 못 쓴다. 숫자를 두 곳에 적는 것이 이 저장소의 볼륨 사고 원인이다.
const 끈값 = 0

// (TV 송출 채널은 2026-09-21 걷어냈다 — 사용자 결정 「TV 볼륨 없애기」.)
const PRESETS = [
  { id: 'quiet',  label: '조용히',   master: 35,  tts: 55,  audio: 75,  media: 50,  bgm: 35  },
  { id: 'normal', label: '보통',     master: 65,  tts: 80,  audio: 100, media: 70,  bgm: 50  },
  { id: 'indoor', label: '실내방송', master: 80,  tts: 100, audio: 100, media: 80,  bgm: 60  },
  { id: 'max',    label: '최대',     master: 100, tts: 100, audio: 100, media: 100, bgm: 100 },
]

/**
 * @param {boolean} narrow
 *   **좁은 그릇 안에 들어갈 때 true.** 아래 격자는 `tablet:grid-cols-2` 인데, 그 판정은
 *   **화면 폭**이지 이 부품이 실제로 받은 폭이 아니다. 통합 홈의 서랍(300px)에 그대로
 *   넣었더니 1440 화면에서 두 칸이 되어 **라벨과 숫자가 겹쳤다**(2026-09-13 브라우저 실측).
 *   컨테이너 질의가 없는 저장소라, 그릇이 좁다는 사실을 **부르는 쪽이 알려 준다.**
 */
/**
 * @param {boolean} bare  껍데기를 벗고 서랍의 `HomePanel` 안으로 들어간다 — 그쪽이 이미
 *   카드와 제목줄을 준다. 여기서 또 두르면 뜻이 겹치는 제목 둘이 된다(G-35).
 */
export default function VolumePanel({ narrow = false, bare = false }) {
  const [master,   setMaster]   = useState(70)
  const [tts,      setTts]      = useState(80)
  const [micGain,  setMicGain]  = useState(() => parseFloat(localStorage.getItem('carecast:micGain') || '2.5'))
  const [audio,    setAudio]    = useState(100)  // 음원(녹음)
  const [media,    setMedia]    = useState(70)   // 영상(체조)
  const [bgm,      setBgm]      = useState(70)
  const [savingCount, setSavingCount] = useState(0)
  const saving = savingCount > 0
  const [saved,    setSaved]    = useState(false)
  const [saveErrors, setSaveErrors] = useState({})
  const saveError = Object.values(saveErrors).filter(Boolean).join(' ')
  const saveVersions = useRef({})
  const savedTimer = useRef(null)
  const mounted = useRef(true)
  const [loaded, setLoaded] = useState(false)
  const [loadKey, setLoadKey] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [activePreset, setActivePreset] = useState(null)
  // **지금 이 화면에서 잠깐 꺼 둔 채널** — `{ [key]: 끄기 전 값 }`. 왜 저장을 안 타는지,
  // 무엇이 「꺼짐」인지는 아래 음소거 절의 머리말에 적어 뒀다.
  const [음소거, set음소거] = useState({})

  const mr = useRef(70); const tr = useRef(80)
  const ar = useRef(100); const dr = useRef(70); const gr = useRef(70)
  // `음소거` 의 거울. 아래 동기화 수신부가 `[]` 의존으로 **한 번만** 등록돼서, 상태를 그대로
  // 닫아 두면 **첫 렌더의 빈 맵**만 본다 — 조용히 안 도는 종류라 거울을 둔다.
  const 음소거Ref = useRef({})
  음소거Ref.current = 음소거

  // **사람이 값을 고르면 그 채널의 「꺼 둠」은 끝난다**(V③ DEV-MERGE-R3, 2026-09-14).
  //
  // 슬라이더·프리셋·재생기 쪽 슬라이더는 전부 **사람이 소리 크기를 정한 것**이다. 그런데
  // 꺼 둔 기록을 안 지워서 둘이 어긋났다 — 화면은 55 인데 기록은 「꺼짐」이라, ① 버튼은
  // 계속 「켜기」라고 적혀 있고 ② 다음 동기화가 **소리만 0 으로** 되돌렸다(화면은 55 인 채).
  // 사람이 방금 올린 소리가 이유 없이 사라지는 것이고, 오류는 안 난다.
  const 직접골랐다 = (key) => set음소거(p => {
    if (p[key] === undefined) return p
    const n = { ...p }; delete n[key]; return n
  })
  const masterDebounce = useRef(null)
  const saveDebounce   = useRef(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // 사용자가 정한 음량은 화면 이동 직전에도 저장한다. 표시 타이머만 걷는다.
      clearTimeout(savedTimer.current)
    }
  }, [])

  // 별도 저장 하나가 실패하면 다른 저장 성공이 그 실패를 지우지 않는다.
  const trackSave = useCallback((key, request, message) => {
    if (!mounted.current) return request.catch(() => console.warn('[음량] 화면 이동 후 저장 실패:', message))
    const version = (saveVersions.current[key] || 0) + 1
    saveVersions.current[key] = version
    setSavingCount(n => n + 1); setSaved(false)
    const current = () => mounted.current && saveVersions.current[key] === version
    return request.then(() => {
      if (!current()) return
      setSaveErrors(errors => ({ ...errors, [key]: '' }))
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
    }).catch(() => {
      if (!current()) return
      setSaveErrors(errors => ({ ...errors, [key]: message }))
      setSaved(false)
    }).finally(() => { if (mounted.current) setSavingCount(n => n - 1) })
  }, [])

  useEffect(() => {
    let cancelled = false
    getVolume().then(d => {
      if (cancelled) return
      if (!d || typeof d !== 'object' || Array.isArray(d)
        || !['master', 'tts', 'broadcast', 'audio', 'media', 'bgm'].some(key => Number.isFinite(d[key]))) {
        throw new Error('음량 응답 형식 오류')
      }
      // 숫자를 여기 또 적지 않는다 — `볼륨기본값` 한 곳을 본다(UX-39).
      const m = d.master ?? 볼륨기본값.master
      const t = d.tts    ?? d.broadcast ?? 볼륨기본값.tts
      const a = d.audio  ?? 볼륨기본값.audio
      const e = d.media  ?? 볼륨기본값.media
      const g = d.bgm    ?? 볼륨기본값.bgm
      // **다시 불러오기도 다른 입구와 같은 규칙이다**(V③ DEV-MERGE-R5 가 물은 자리).
      // 처음 뜰 때는 꺼 둔 것이 없어서 티가 안 나지만, 사람이 「다시 불러오기」를 누르면
      // 이 자리가 다시 돈다 — 그때 꺼 둔 채널을 켜 버리면 패널만 켜지고 규칙이 어긋난다.
      // 값은 받아 적고, 꺼 둔 채널은 화면도 소리도 끈 채로 둔다.
      const 꺼둔것 = 음소거Ref.current
      const 끈채로 = (key, 값) => (꺼둔것[key] !== undefined ? 끈값 : 값)
      // 마스터만 예외다 — 끄면 실제로 저장되므로 서버가 준 값이 곧 지금 상태다.
      setMaster(m); mr.current = m
      tr.current = t; if (꺼둔것.tts   === undefined) setTts(t)
      ar.current = a; if (꺼둔것.audio === undefined) setAudio(a)
      dr.current = e; if (꺼둔것.media === undefined) setMedia(e)
      gr.current = g; if (꺼둔것.bgm   === undefined) setBgm(g)
      dispatchAll(m, 끈채로('tts', t), 끈채로('audio', a), 끈채로('media', e),
                  끈채로('bgm', g))
      setLoaded(true); setLoadError('')
    }).catch(() => {
      if (!cancelled) setLoadError('음량을 불러오지 못했습니다. 연결을 확인한 뒤 다시 불러와 주세요.')
    })
    return () => { cancelled = true }
  }, [loadKey])

  // 재생기(MusicPlayer)의 BGM 슬라이더에서 온 역방향 동기.
  //
  // **이 화면 밖에서 온 값은 「사람이 골랐다」로 보지 않는다**(V③ DEV-MERGE-R4, 2026-09-14).
  // 한 번은 그렇게 봤다가 두 가지로 틀렸다:
  //   · 이 이벤트를 **자동 방송도 쏜다**(`MusicPlayer` 의 `bgm_start`).
  //     사람이 아무것도 안 눌렀는데 꺼 둠이 풀렸다.
  //   · 이 이벤트는 **로컬 BGM 재생기에 닿지 않는다**(그쪽은 `carecast:bgm-volume` 을 듣는다).
  //     그래서 꺼 둠만 풀리고 소리는 0 인 채 — 화면은 「켜짐」인데 홀은 조용하다.
  //
  // 그래서 동기화 수신부와 **같은 규칙**을 쓴다: 값은 받아 적고, 꺼 둔 채널의 화면·소리는
  // 안 건드린다. 사람의 선택은 이 화면의 슬라이더·프리셋뿐이다 — 그것만 꺼 둠을 푼다.
  //
  // **그리고 0 을 다시 보낸다**(V③ DEV-MERGE-R5). 보내는 쪽(`MusicPlayer`)은
  // 이 이벤트를 쏘기 전에 **제 재생 음량을 이미 올려 놨다.** 그냥 돌아서면 패널만 「꺼짐」이고
  // 홀에서는 소리가 난다 — 사람이 분명히 껐는데 소리가 나는 것이라 더 나쁘다.
  useEffect(() => {
    const handler = (e) => {
      const v = Number(e.detail)
      gr.current = v
      if (음소거Ref.current.bgm !== undefined) {
        window.dispatchEvent(new CustomEvent('carecast:bgm-volume', { detail: 끈값 }))
        return
      }
      setBgm(v); setActivePreset(null)
    }
    window.addEventListener('carecast:bgm-volume-from-player', handler)
    return () => window.removeEventListener('carecast:bgm-volume-from-player', handler)
  }, [])

  // 다른 PC 볼륨 변경 또는 신규 접속 시 슬라이더 동기화
  useEffect(() => {
    // **이 화면에서 잠깐 꺼 둔 채널은 동기화가 도로 켜지 않는다**(V③ DEV-MERGE-R2, 2026-09-14).
    //
    // 음소거가 저장을 안 타게 고쳤더니 새 길이 열렸다 — 다른 채널을 저장하면 그 응답이
    // **끄기 전 값**을 싣고 돌아와 소리를 되살렸다. 버튼은 여전히 「켜기」라고 적혀 있는 채로다.
    // 이 저장소가 이미 한 번 겪은 모양이다(표시와 동작이 갈리는 것).
    //
    // 그래서 **값은 받아 적되**(그게 서버에 저장된 진짜 값이다) 화면과 소리는 끈 채로 둔다.
    // 재생기(`MusicPlayer`)는 같은 SSE 를 **먼저** 받아 제 볼륨을 이미 올려 놓으므로,
    // 꺼 둔 채널은 **0 을 다시 보내** 도로 내린다 — 음소거가 쓰는 바로 그 이벤트다.
    const handler = (e) => {
      const { tts, audio, media, bgm } = e.detail
      const 꺼둔것 = 음소거Ref.current
      const 꺼짐 = (key) => 꺼둔것[key] !== undefined
      const 보내기 = (name, v) => window.dispatchEvent(new CustomEvent(name, { detail: v }))

      if (bgm   !== undefined) {
        gr.current = bgm
        if (꺼짐('bgm')) 보내기('carecast:bgm-volume', 끈값)
        else { setBgm(bgm); 보내기('carecast:bgm-volume', bgm) }
      }
      if (tts   !== undefined) {
        tr.current = tts
        if (꺼짐('tts')) 보내기('carecast:tts-volume', 끈값)
        else setTts(tts)
      }
      if (audio !== undefined) {
        ar.current = audio
        if (꺼짐('audio')) 보내기('carecast:audio-volume', 끈값)
        else setAudio(audio)
      }
      if (media !== undefined) {
        dr.current = media
        if (꺼짐('media')) 보내기('carecast:media-volume', 끈값)
        else setMedia(media)
      }
      setActivePreset(null)
    }
    window.addEventListener('carecast:volume-sync', handler)
    return () => window.removeEventListener('carecast:volume-sync', handler)
  }, [])

  function dispatchAll(m, t, a, e, g) {
    window.dispatchEvent(new CustomEvent('carecast:bgm-volume',      { detail: g }))
    window.dispatchEvent(new CustomEvent('carecast:tts-volume',      { detail: t }))
    window.dispatchEvent(new CustomEvent('carecast:audio-volume',    { detail: a }))
    window.dispatchEvent(new CustomEvent('carecast:media-volume',    { detail: e }))
    window.dispatchEvent(new CustomEvent('carecast:broadcast-volume',{ detail: t })) // 하위호환
  }

  const scheduleSave = useCallback(() => {
    if (saveDebounce.current) clearTimeout(saveDebounce.current)
    saveDebounce.current = setTimeout(() => {
      trackSave('bulk', saveVolume({ master: mr.current, tts: tr.current, audio: ar.current, media: dr.current, bgm: gr.current }),
        '음량을 저장하지 못했습니다. 연결을 확인한 뒤 원하는 음량으로 다시 조절해 주세요.')
    }, 200)
  }, [trackSave])

  const changeMaster = (v) => {
    setMaster(v); mr.current = v; setActivePreset(null); 직접골랐다('master')
    if (masterDebounce.current) clearTimeout(masterDebounce.current)
    masterDebounce.current = setTimeout(() => {
      trackSave('master', saveVolume({ master: v }), '전체 소리를 적용하지 못했습니다. 연결을 확인한 뒤 다시 조절해 주세요.')
    }, 400)
    scheduleSave()
  }

  const changeTts = (v) => {
    setTts(v); tr.current = v; setActivePreset(null); 직접골랐다('tts')
    window.dispatchEvent(new CustomEvent('carecast:tts-volume',      { detail: v }))
    window.dispatchEvent(new CustomEvent('carecast:broadcast-volume',{ detail: v }))
    scheduleSave()
  }

  const changeMicGain = (v) => {
    setMicGain(v)
    localStorage.setItem('carecast:micGain', String(v))
    window.dispatchEvent(new CustomEvent('carecast:mic-gain', { detail: v }))
  }

  const changeAudio = (v) => {
    setAudio(v); ar.current = v; setActivePreset(null); 직접골랐다('audio')
    window.dispatchEvent(new CustomEvent('carecast:audio-volume', { detail: v }))
    scheduleSave()
  }

  const changeMedia = (v) => {
    setMedia(v); dr.current = v; setActivePreset(null); 직접골랐다('media')
    window.dispatchEvent(new CustomEvent('carecast:media-volume', { detail: v }))
    scheduleSave()
  }

  const changeBgm = (v) => {
    setBgm(v); gr.current = v; setActivePreset(null); 직접골랐다('bgm')
    window.dispatchEvent(new CustomEvent('carecast:bgm-volume', { detail: v }))
    scheduleSave()
    // 방송 BGM 기본 볼륨도 함께 저장 → 다음 방송부터도 동일 볼륨 유지
    trackSave('bgmDefault', saveBgmBroadcastDefault(v), 'BGM 기본 음량을 저장하지 못했습니다. 다음 방송에 반영하려면 다시 조절해 주세요.')
  }

  const applyPreset = (p) => {
    setActivePreset(p.id)
    // 프리셋은 **다섯 채널을 한 번에 고르는 것**이다 — 꺼 둔 것이 있으면 전부 풀린다.
    set음소거({})
    setMaster(p.master); mr.current = p.master
    setTts(p.tts);       tr.current = p.tts
    setAudio(p.audio);   ar.current = p.audio
    setMedia(p.media);   dr.current = p.media
    setBgm(p.bgm);       gr.current = p.bgm
    dispatchAll(p.master, p.tts, p.audio, p.media, p.bgm)
    trackSave('master', saveVolume({ master: p.master }), '전체 소리를 적용하지 못했습니다. 연결을 확인한 뒤 다시 조절해 주세요.')
    scheduleSave()
  }

  // 슬라이더 하나를 끌면 7행이 함께 다시 그려진다. 행을 memo로 떼는 안을 검토했다가 **접었다**
  // (2026-08-31): 사람이 손으로 끄는 동안의 리렌더고, 그리는 것은 작은 div 7개뿐이라 눈에
  // 보이는 값이 없다. 대신 대가는 핸들러 7개를 useCallback으로 바꾸며 의존성을 손으로 맞추는
  // 일인데, 이 패널은 현장 볼륨을 직접 건드리는 자리다(CC-052·053·055가 전부 여기서 났다).
  // 실제로 느려서 문제가 되면 그때 프로파일을 근거로 다시 본다.
  // ── 음소거 (2026-09-11 · 2026-09-11 독립 검수 지적으로 다시 씀) ──────────────
  //
  // **음소거는 저장하지 않는다. 이 자리에서 잠깐 소리만 끈다.**
  //
  // 첫 판은 각 채널의 `change*` 를 그대로 불렀다. 그랬더니 —
  //   · BGM 음소거가 `saveBgmBroadcastDefault(0)` 까지 타서 **방송 BGM 기본 볼륨이 0 으로
  //     저장됐다.** 다음 정시 방송의 BGM 이 무음으로 나간다.
  //   · 끄기 전 값이 메모리뿐이라 새로고침하면 70 으로 돌아왔다(현장 값 유실).
  //
  // 그래서 저장 경로를 아예 안 탄다 — 화면 상태와 재생 이벤트만 바꾼다.
  // 이 저장소가 볼륨에서 세운 원칙과 같다: **되돌릴 상태를 만들지 않는다.**
  // 새로고침하면 서버에 저장된 진짜 값으로 돌아온다(= 음소거가 풀린다). 그게 맞다 —
  // 음소거는 "지금 잠깐"이지 "이 예약의 볼륨"이 아니다.
  // 이 맵은 **화면 맨 위 상태 묶음**에 있다(`음소거`·`음소거Ref`). 여기 두면 위쪽의
  // 동기화 수신부·`change*` 가 못 본다 — 그 셋이 같은 것을 봐야 표시와 소리가 안 갈린다.

  // **저장될 값을 쥔 자리.** `scheduleSave` 가 읽는 곳이 여기 하나다 — 그래서 「무엇이
  // 저장되는가」는 이 ref 들에 무엇을 넣느냐로 정해진다(V③ DEV-MERGE-R1, 2026-09-14).
  const 저장될값 = { master: mr, tts: tr, audio: ar, media: dr, bgm: gr }

  // 저장 없이 화면·재생에만 반영한다. 각 채널의 `change*` 가 하는 일 중 **이벤트만** 골라 쓴다.
  //
  // **이 함수는 `저장될값` 을 건드리지 않는다** — 여기가 결함이었다(V③ DEV-MERGE-R1, HIGH).
  // 예전엔 화면 상태와 함께 ref 도 덮었다. 저장을 직접 부르지 않으니 안전해 보였지만,
  // 일괄 저장은 **그 ref 를 읽는다.** 그래서 안내 음성을 끈 뒤 BGM 슬라이더를 조금만
  // 움직이면 `tts: 0` 이 딸려 나가 **기본 음량이 0 으로 저장됐다.** 새로고침해도 0 이고,
  // 오류는 안 난다 — 어르신 앞에서 조용한 3분이 지나야 안다.
  // 껐다 켜는 것은 **값을 고르는 일이 아니다.** 고른 값은 `change*` 와 아래 해제 분기가 적는다.
  const 소리만적용 = (key, v) => {
    const 보내기 = (name) => window.dispatchEvent(new CustomEvent(name, { detail: v }))
    if (key === 'master') { setMaster(v); trackSave('master', saveVolume({ master: v }), '전체 소리를 적용하지 못했습니다. 연결을 확인한 뒤 다시 조절해 주세요.') }
    // 마스터만 예외다 — 이것은 **PC 시스템 음량**이라 서버가 실제로 OS 를 건드려야 소리가 준다.
    // 나머지는 브라우저·재생기가 이벤트를 듣고 제 볼륨을 바꾼다(저장은 안 한다).
    else if (key === 'tts')   { setTts(v);   보내기('carecast:tts-volume'); 보내기('carecast:broadcast-volume') }
    else if (key === 'bgm')   { setBgm(v);   보내기('carecast:bgm-volume') }
    else if (key === 'audio') { setAudio(v); 보내기('carecast:audio-volume') }
    else if (key === 'media') { setMedia(v); 보내기('carecast:media-volume') }
    else if (key === 'mic')   { setMicGain(v); 보내기('carecast:mic-gain') }
  }

  // **마이크에는 '끔'이라는 상태가 없다** (2026-09-11 독립 검수 지적).
  //
  // 배율 1.0× 는 무음이 아니라 **원음**이다. 그래서 마이크에는 음소거 버튼을 두지 않는다.
  // 전에는 `끈값('mic') = 1`(= 최소값)로 두고 그것을 '끔'으로 불렀는데, 표시만 그럴 때는
  // 무동작이라 티가 안 났다. 판정을 하나로 합치자(`꺼졌나`) **정상 1.0× 가 "꺼짐"으로
  // 잡혀 버튼이 켜기 분기로 들어갔고, 누르면 1.0× → 2.5× 로 이득이 뛰었다.**
  // 마이크 생방송 중 소리를 줄이려고 누르면 되레 커지는 것이라 하울링이 날 자리였다.
  const 음소거가능 = (key) => key !== 'mic'
  // 「끔」의 값은 `끈값`(파일 맨 위) 하나다. 위로 올린 이유는 거기 적어 뒀다.

  // **꺼져 있는가 — 표시와 동작이 이 함수 하나만 본다** (2026-09-11 독립 검수 지적).
  //
  // 전에는 판정이 둘이었다: 아이콘은 값을 보고(`음소거.master !== undefined || master === 0`),
  // 토글은 맵만 봤다(`음소거[key] === undefined`). 그래서 음소거 후 새로고침한 상태
  // (`master=0`, 맵은 비어 있음)에서 **버튼은 "해제"라고 적혀 있는데 누르면 0 → 0 이었다.**
  // 그 세션 내내 버튼으로는 소리를 못 켠다. 바로 옆 문구가 "반드시 다시 켜 주세요"라고
  // 가리키는 그 버튼이다 — 무음의 복구 동선이라 가장 나쁜 자리였다.
  const 꺼졌나 = (key, value) => 음소거[key] !== undefined || value <= 끈값

  // 켤 때 되돌릴 값. 맵에 기억해 둔 것이 있으면 그것, 없으면(슬라이더로 0 까지 내렸거나
  // 새로고침해서 맵이 비었다) **안전한 기본값**으로 켠다. 0 으로 "켜는" 것은 켜는 게 아니다.
  const 켤값 = (key, 기본) => {
    const 기억 = 음소거[key]
    if (기억 !== undefined && 기억 > 끈값) return 기억
    return 기본
  }

  // 기본값을 안 넘기면 `볼륨기본값` 에서 찾는다 — 코드에 숫자를 박지 않는다.
  const 음소거토글 = (key, value, 기본 = 볼륨기본값[key]) => {
    if (꺼졌나(key, value)) {
      const v = 켤값(key, 기본)
      set음소거(p => { const n = { ...p }; delete n[key]; return n })
      소리만적용(key, v)
      // **다시 켠 값은 사람이 고른 값이다.** 여기서 적어 두지 않으면, 서버 값이 0 인 채로
      // 켰을 때 화면만 올라가고 저장될 값은 0 으로 남는다 — 다른 채널을 만지는 순간 무음으로
      // 되돌아간다. 끌 때는 반대로 **안 적는다**(위 `소리만적용` 머리말).
      저장될값[key].current = v
    } else {
      set음소거(p => ({ ...p, [key]: value }))
      소리만적용(key, 끈값)
      // 마스터만 예외다 — 끄는 순간 실제로 저장된다(PC 시스템 음량). 저장된 값과 쥔 값이
      // 갈리면 다음 일괄 저장이 방금 끈 것을 조용히 되돌린다.
      if (key === 'master') mr.current = 끈값
    }
  }

  // 방송 종류별 채널. 마스터는 뜻이 달라서(=PC 전체) 위에 따로 크게 둔다.
  const 채널 = [
    { key: 'tts',   label: '안내 음성', sub: 'TTS 방송',  help: 'volTts',
    // ── **다섯 색을 셋으로** (사용자 지시 2026-09-15) ──────────────────────────
    //  *"색감 사용… 가이드라인 안 지켜져 있는 것들이 꽤 있는 것 같던데, 특히 음량."*
    //
    // 앞 판은 한 화면에서 **빨강·인디고·보라·회색·초록 다섯**을 썼다. 규칙은 셋뿐이다
    // (G-1: 말=파랑 · 음악=자주 · 순서=보라). 그리고 **빨강이 「안내 음성」을 뜻하고
    // 있었다** — 같은 제품의 재생바·경보에서 빨강은 **실패**다. 한 색이 두 뜻을 가지면
    // 사람은 둘 다 안 믿는다.
    //
    // 이제 **뜻이 있는 둘만 칠한다**: 안내 음성은 파랑(말), 배경음악은 자주(음악).
    // 음원·영상·마이크는 **무채색**이다 — G-2 그대로다. 「칠할 수 있으니 칠하는 것」이
    // 아니라 **예외를 가리키는 표시**이고, 여섯 줄 중 넷에 색이 붙으면 색이 아무것도
    // 가리키지 못한다. 무엇인지는 **아이콘과 이름**이 이미 말하고 있다.
      Icon: Radio,  color: 'text-ds-v3-tts',   ring: 'bg-ds-v3-tts-bg',
      value: tts,   onChange: changeTts,   기본: 볼륨기본값.tts },
    { key: 'bgm',   label: '배경음악',  sub: 'BGM',       help: 'volBgm',
      Icon: Music2, color: 'text-ds-v3-bgm',   ring: 'bg-ds-v3-bgm-bg',
      value: bgm,   onChange: changeBgm,   기본: 볼륨기본값.bgm },
    { key: 'audio', label: '음원',      sub: '안내 녹음',  help: 'volAudio',
      Icon: Volume2, color: 'text-ds-v3-ink-2', ring: 'bg-ds-v3-surface-2',
      value: audio, onChange: changeAudio, 기본: 볼륨기본값.audio },
    { key: 'media', label: '영상',      sub: '체조 영상',  help: 'volMedia',
      Icon: Film,   color: 'text-ds-v3-ink-2', ring: 'bg-ds-v3-surface-2',
      value: media, onChange: changeMedia, 기본: 볼륨기본값.media },
    // 마이크만 단위가 배율(×)이다 — 퍼센트와 나란히 두면 사람이 같은 눈금으로 읽는다.
    { key: 'mic',   label: '마이크',    sub: '즉시방송',   help: 'volMic',
      Icon: Mic,    color: 'text-ds-v3-ink-2', ring: 'bg-ds-v3-surface-2',
      value: micGain, onChange: changeMicGain,
      min: 1, max: 5, step: 0.5, 배율: true, 기본: 2.5 },
  ]

  // 전체 소리가 꺼진 상태인가. **토글이 보는 것과 같은 함수다** — 갈리면 버튼이
  // "해제"라고 적어 놓고 아무 일도 안 한다(2026-09-11 독립 검수 지적).
  const 마스터꺼짐 = 꺼졌나('master', master)

  return (
    <div className={bare ? "" : "easy-card bg-white"}>
      {/* 머리 — 제목 · 프리셋 · 저장 표시.
          `bare` 면 **제목만** 걷는다(서랍의 패널 머리줄이 그 일을 한다). **저장 표시는 남긴다** —
          "적용됐나"는 사람이 소리로 확인하기 전에 화면에서 봐야 하는 것이라, 제목과 달리
          겹치는 정보가 아니다. */}
      <div className={'flex items-center gap-2 flex-wrap ' + (bare ? 'mb-2' : 'mb-4')}>
        {!bare && (
          <>
            <span className="w-7 h-7 rounded-[9px] bg-ds-v3-tts-bg flex items-center justify-center shrink-0">
              <Sliders size={14} className="text-ds-v3-tts" />
            </span>
            <h3 className="text-sm font-semibold text-ds-v3-ink">음량 제어</h3>
            <HelpTip id="volumePanel" />
          </>
        )}
        <span className={`ml-auto text-xs font-normal transition-opacity
          ${saving ? 'text-ds-v3-ink-2 animate-pulse' : saved && !saveError ? 'text-ds-v3-ink-3' : 'opacity-0'}`}>
          {saving ? '적용 중…' : saved && !saveError ? '✓ 적용됨' : ''}
        </span>
      </div>

      {!loaded && !loadError && <p role="status" className="mb-3 text-sm text-ds-v3-ink-2">음량을 불러오는 중…</p>}
      {loadError && <div role="alert" className="mb-3 text-sm text-ds-v3-warn">
        <p>{loadError}</p>
        <button type="button" onClick={() => { setLoadError(''); setLoadKey(key => key + 1) }}
          className="mt-2 min-h-[44px] px-3 border border-ds-v3-line rounded-lg text-ds-v3-ink bg-white">
          음량 다시 불러오기
        </button>
      </div>}
      <fieldset disabled={!loaded} className="min-w-0 m-0 p-0 border-0 disabled:opacity-60">
      {/* 프리셋 — 한 번에 맞추는 지름길. 골라 놓은 것이 눈에 보여야 한다. */}
      <div className="flex items-center gap-1.5 p-1 bg-ds-v3-bg border border-ds-v3-line rounded-[12px] mb-4">
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => applyPreset(p)}
            aria-pressed={activePreset === p.id}
            className={`flex-1 py-2 rounded-[9px] text-sm font-semibold btn-press transition-all
              min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]
              ${activePreset === p.id
                ? 'bg-white text-ds-v3-tts shadow-sm ring-1 ring-ds-v3-tts/20'
                : 'text-ds-v3-ink-2 hover:text-ds-v3-ink hover:bg-white/70'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* 전체 소리 — 뜻이 다르다. PC 자체 음량이라 이 하나가 나머지 전부를 덮는다. */}
      <div className="rounded-[14px] border border-ds-v3-line bg-ds-v3-tts-bg p-4 mb-4">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-8 h-8 rounded-full bg-white border border-ds-v3-tts/20 flex items-center justify-center shrink-0">
            <Volume2 size={15} className="text-ds-v3-tts" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ds-v3-ink leading-tight flex items-center gap-1.5">
              전체 소리 <HelpTip id="volMaster" />
            </p>
          </div>
          <span className="ml-auto text-2xl font-semibold nums text-ds-v3-tts tabular-nums">{master}%</span>
          {/* **값도 함께 본다** — `음소거` 맵만 보면 슬라이더로 0 까지 내린 상태가
              "소리 켜짐"으로 그려진다. `음소거` 는 이 탭의 state 라 새로고침에 사라지는데
              서버가 준 `master=0` 은 남기 때문에, 새로고침 뒤 **0% 인데 켜짐 아이콘**이 된다.
              이 저장소에서 가장 비싼 실패(무음)의 표시가 사라지는 자리다.
              아래 종류별 카드(`꺼짐`)는 처음부터 값 조건을 갖고 있었다 — 여기만 빠져 있었다. */}
          <button
            onClick={() => 음소거토글('master', master)}
            aria-label={마스터꺼짐 ? '전체 소리 음소거 해제' : '전체 소리 음소거'}
            className={`shrink-0 w-11 h-11 laptop:w-9 laptop:h-9 rounded-full border flex items-center justify-center
              btn-press transition-colors min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]
              ${마스터꺼짐 ? 'border-ds-v3-warn/30 text-ds-v3-warn bg-ds-v3-warn-bg'
                           : 'border-ds-v3-line bg-white text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
            {마스터꺼짐 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>
        <p className="mb-3 text-xs text-ds-v3-ink-2">이 PC의 스피커 음량 — 아래 모든 소리를 함께 키우고 줄입니다</p>
        <input type="range" min={0} max={100} step={1} value={master}
          onChange={e => changeMaster(Number(e.target.value))}
          aria-label="전체 소리"
          style={{ '--pct': `${master}%` }}
          className="vol-range text-ds-v3-tts" />
      </div>

      {/* 방송 종류별 — 카드 하나에 한 채널. 한 줄짜리 막대 일곱 개보다 훨씬 집기 쉽다. */}
      <p className="text-xs font-semibold text-ds-v3-ink-2 mb-2 px-0.5">방송 종류별</p>
      <div className={"grid gap-2.5 " + (narrow ? "grid-cols-1" : "grid-cols-1 tablet:grid-cols-2")}>
        {채널.map(c => {
          // **토글과 같은 함수를 쓴다** — 갈리면 마스터에서 났던 것과 같은 일이 여기서도 난다
          // (버튼은 "해제"인데 눌러도 그대로). 마이크는 음소거 버튼이 없으므로 이 값은
          // 회색 표시에만 쓰이고, 1.0×(원음)는 **꺼짐이 아니다.**
          const 꺼짐 = 음소거가능(c.key) && 꺼졌나(c.key, c.value)
          const 최소 = c.min ?? 0
          const 최대 = c.max ?? 100
          const pct  = ((c.value - 최소) / (최대 - 최소)) * 100
          return (
            <div key={c.key}
              className={`rounded-[12px] border p-3 transition-colors
                ${꺼짐 ? 'border-ds-v3-line bg-ds-v3-bg' : 'border-ds-v3-line bg-white'}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-7 h-7 rounded-[9px] ${c.ring} flex items-center justify-center shrink-0`}>
                  <c.Icon size={13} className={c.color} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ds-v3-ink leading-tight flex items-center gap-1">
                    {c.label} <HelpTip id={c.help} />
                  </p>
                  <p className="text-xs text-ds-v3-ink-2 leading-tight">{c.sub}</p>
                </div>
                <span className={`ml-auto text-lg font-semibold nums ${꺼짐 ? 'text-ds-v3-ink-2' : c.color}`}>
                  {c.배율 ? `${c.value.toFixed(1)}×` : `${c.value}%`}
                </span>
                {/* **마이크에는 음소거 버튼을 안 그린다.** 배율 1.0× 는 무음이 아니라 원음이라
                    '끔'이라는 상태가 없다. 버튼을 두면 누르는 순간 이득이 오히려 뛴다
                    (2026-09-11 독립 검수 지적 — 하울링이 날 자리였다). */}
                {음소거가능(c.key) && (
                <button
                  onClick={() => 음소거토글(c.key, c.value, c.기본)}
                  aria-label={`${c.label} ${꺼짐 ? '음소거 해제' : '음소거'}`}
                  title="지금 이 자리에서만 잠깐 끕니다 — 저장하지 않습니다"
                  className={`shrink-0 w-11 h-11 laptop:w-8 laptop:h-8 rounded-full border flex items-center
                    justify-center btn-press transition-colors disabled:opacity-25 disabled:cursor-not-allowed
                    min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]
                    ${꺼짐 ? 'border-ds-v3-warn/30 text-ds-v3-warn bg-ds-v3-warn-bg'
                           : 'border-ds-v3-line bg-white text-ds-v3-ink-2 hover:text-ds-v3-ink'}`}>
                  {꺼짐 ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                )}
              </div>
              <input type="range" min={최소} max={최대} step={c.step ?? 1} value={c.value}
                onChange={e => c.onChange(Number(e.target.value))}
                aria-label={c.label}
                style={{ '--pct': `${pct}%` }}
                className={`vol-range ${c.color}`} />
            </div>
          )
        })}
      </div>

      </fieldset>

      {saveError && <p role="alert" className="mt-3 text-sm text-ds-v3-warn">{saveError}</p>}

      <p className="mt-3 text-xs text-ds-v3-ink-2 leading-relaxed">
        <span className="font-semibold text-ds-v3-ink">전체 소리</span>는 PC 자체 음량이라 처음 적용에 3~5초 걸립니다.
        <span className="font-semibold text-ds-v3-ink"> 마이크</span>만 배율(×)입니다 — 목소리를 몇 배로 키울지라서 퍼센트와 눈금이 다릅니다.
        <span className="font-semibold text-ds-v3-ink"> 음소거</span>는 지금 이 자리에서만 잠깐 끄는 것이라 저장되지 않습니다 — 새로고침하면 원래 크기로 돌아옵니다.
        {/* **예외를 숨기지 않는다**(2026-09-11 독립 검수 지적). 마스터는 PC 시스템 음량이라
            서버가 OS 를 건드려야 소리가 줄고, 그 값은 settings 에 남는다. 이 한 줄이 없으면
            직원이 "새로고침하면 돌아온다"고 믿고 전체 소리를 끈 채 퇴근한다 — 다음 날 아침
            방송이 통째로 무음이 되고, 화면상으로는 정상이다. */}
        <span className="block mt-1">
          다만 <span className="font-semibold text-ds-v3-ink">전체 소리</span>만은 PC 음량이라 끈 값이 그대로 저장됩니다 —
          새로고침해도 0%로 남으니 반드시 다시 켜 주세요.
        </span>
      </p>
    </div>
  )
}
