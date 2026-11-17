// 대시보드/쉬운화면의 "시스템 상태" 카드 4개를 /api/status 실측값으로 만든다.
//
// 예전에는 이 카드들이 src/data/dummy.js의 고정 문자열("CPU 23%", "−12 dB", "대기 중")이었다.
// 네트워크(IP)만 실제 값으로 덮어쓰고 나머지 3개는 늘 같은 값이라, 현장에서 오디오 장치가
// 빠져도 "정상 출력"으로 보이는 사각지대가 있었다.
//
// 원칙: 서버가 값을 못 주면 가짜 값을 만들지 말고 'unknown'(회색 "확인 불가")으로 둔다.
// status는 online/warning/offline만 색이 있고, 그 외(unknown 포함)는 회색으로 렌더링된다.

const UNKNOWN = { status: 'unknown', value: '확인 불가', detail: '상태를 읽을 수 없습니다' }

export function buildStatusCards(live) {
  return [
    { id: 'pc',    name: '방송 PC',     ...pcCard(live)    },
    { id: 'net',   name: '네트워크',    ...netCard(live)   },
    { id: 'audio', name: '오디오 출력', ...audioCard(live) },
    { id: 'mic',   name: '마이크',      ...micCard(live)   },
  ]
}

function pcCard(live) {
  const cpu = live?.cpu
  if (!cpu) return UNKNOWN

  // usagePct는 첫 호출에선 null(직전 스냅샷이 없어 델타를 못 구함) — 잠시 후 값이 들어온다
  if (cpu.usagePct == null) {
    return { status: 'online', value: '측정 중…', detail: `${cpu.cores ?? '?'}코어` }
  }

  const mem = live?.memory?.usedPct
  return {
    // 90% 이상이면 경고 — 방송이 밀릴 수 있는 수준
    status: cpu.usagePct >= 90 ? 'warning' : 'online',
    value:  `CPU ${cpu.usagePct}%`,
    detail: mem != null ? `${cpu.cores}코어 · 메모리 ${mem}%` : `${cpu.cores}코어`,
  }
}

// 랜 주소만 보고 "연결됨"이라고 하지 않는다.
//
// 예전에는 `live.ip`가 있으면 무조건 초록 "연결됨"이었다(CC-025). 랜 주소는 공유기가
// 인터넷에서 끊겨도 그대로 있으므로, 안내 음성·날씨·AI 가 전부 죽은 상태에서도
// 화면은 정상으로 보였다. 서버가 실제 외부 통신 성패(live.net)를 실어 준다.
function netCard(live) {
  if (!live?.ip) return UNKNOWN
  const net = live.net

  // 옛 서버 응답에는 net이 없다 — 화면이 깨지지 않게 랜 연결까지만 말한다
  if (!net || net.online == null) {
    return { status: 'online', value: '내부망 연결', detail: `${live.ip} · 인터넷 확인 전` }
  }
  if (net.online === false) {
    const 마지막 = net.lastOkAt ? ` · 마지막 연결 ${시각(net.lastOkAt)}` : ''
    return {
      status: 'warning',
      value:  '인터넷 끊김',
      detail: `${net.lastSource ? net.lastSource + ' 통신 실패' : '바깥 통신 실패'}${마지막}`,
    }
  }
  return { status: 'online', value: '인터넷 연결됨', detail: live.ip }
}

// "오후 3:20" 형태. 날짜가 다르면 날짜도 붙인다.
function 시각(iso) {
  try {
    const d = new Date(iso)
    const 오늘 = new Date()
    const 같은날 = d.toDateString() === 오늘.toDateString()
    const t = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
    return 같은날 ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`
  } catch { return '' }
}

// 출력장치는 네 가지를 가른다 (UX-35, 2026-09-11):
//   정상 · 미설정 · 연결 끊김(설정한 장치가 안 보임) · 확인 불가
//
// 예전엔 **장치가 몇 개 보이느냐**만 봤다. 그래서 `audio_device` 를 안 정했어도 초록
// "3개" 였다 — 그런데 안 정하면 방송이 **Windows 기본 장치**로 나가고, 엉뚱한 데서
// 소리가 난다(CLAUDE.md "새 PC 를 세팅할 때 손으로 넣어야 하는 값"). 그것이 **가짜 정상**이다.
// 설정해 둔 이름이 목록에 없으면 그건 "연결 끊김" 이고, 그 상태에서 방송하면 소리가
// 엉뚱한 데로 가거나 아예 안 난다 — 2026-08-30 에 실제로 겪은 자리다.
function audioCard(live) {
  const out = live?.audio?.output
  if (!out) return UNKNOWN
  // **개수가 숫자가 아니면 모른다고 말한다**(2026-09-12). 모양이 어긋난 응답이 오면
  // 예전에는 화면에 `undefined개` 가 그대로 떴다 — 숫자 자리에 낱말이 아닌 것이 박히면
  // 사람은 그것을 "고장"이 아니라 "읽을 줄 모르는 화면"으로 본다. 이 카드의 다른 가지들이
  // 전부 "모르면 모른다"로 쓰여 있는데 이 자리만 빠져 있었다.
  if (!Number.isFinite(Number(out.count))) return UNKNOWN
  if (out.count === 0) {
    // 스피커가 연결 안 됐거나 드라이버가 없는 상태 — 방송이 실제로 안 나가는 조건이라 경고
    return { status: 'warning', value: '장치 없음', detail: '출력 장치를 찾을 수 없습니다' }
  }

  const 정한것 = live?.audio?.configuredOutput
  // 옛 서버 응답에는 이 값이 없다(`undefined`). 그때는 **모른다고 말한다** —
  // 빈 문자열(진짜 미설정)과 섞으면 없는 사실을 지어내는 것이다.
  if (정한것 === undefined) {
    return { status: 'online', value: `${out.count}개`, detail: `${out.first ?? '출력 장치 연결됨'} · 지정 장치 확인 전` }
  }
  if (정한것 === '') {
    return {
      status: 'warning',
      value:  '미설정',
      detail: `장치 ${out.count}개 · 지정 안 함 — 기본 장치로 나갑니다`,
    }
  }
  // 설정해 뒀는데 목록에 없다 — 이름이 바뀌었거나 빠졌다.
  const 있나 = out.names ? out.names.includes(정한것) : (out.first === 정한것 || null)
  if (있나 === false) {
    return { status: 'offline', value: '연결 끊김', detail: `"${정한것}" 을(를) 찾을 수 없습니다` }
  }
  if (있나 === null) {
    // 목록 전체를 못 받았다 — 첫 장치만으로는 **없다고 단정할 수 없다.**
    return { status: 'online', value: `${out.count}개`, detail: `${정한것} · 목록 일부만 확인` }
  }
  return { status: 'online', value: `${out.count}개`, detail: 정한것 }
}

// 방송장비 전원(SwitchBot)도 **같은 네 낱말**을 쓴다 (UX-35, 2026-09-12).
//
// 예전에는 이 카드만 `Dashboard.jsx` 안에서 손으로 만들어져 어휘가 갈렸다 —
// 다른 카드가 "확인 불가" 라고 하는 자리에서 혼자 **"조회 실패"** 라고 했고,
// "연결 끊김" 은 아예 없었다. 같은 뜻에 이름이 둘이면 사람이 둘을 다른 일로 읽는다.
//
// **ON/OFF 는 상태가 아니라 값이다.** 장치가 성한지(status)와 지금 켜졌는지(value)를
// 섞지 않는다 — 섞으면 "OFF" 가 고장인지 꺼 둔 것인지 구별되지 않는다.
//
// 주의: 이 기능은 **연결된 실장치가 없는 미완성 기능**이다(PROJECT_PROFILE §1-1).
// 그래서 여기서 하는 일은 "상태를 정직하게 말하는 것" 까지다.
export function switchbotCard(sb) {
  if (sb == null) return { id: 'switchbot', name: '방송장비 전원', ...UNKNOWN }
  if (!sb.configured) {
    return { id: 'switchbot', name: '방송장비 전원',
      status: 'unknown', value: '미설정', detail: 'API 연동 설정 필요' }
  }
  if (sb.error) {
    return { id: 'switchbot', name: '방송장비 전원',
      status: 'offline', value: '연결 끊김', detail: '장치에 닿지 못했습니다' }
  }
  // 설정도 됐고 오류도 없는데 값이 없다 — **모른다고 말한다.** 꺼진 것으로 읽으면 거짓이다.
  if (sb.power == null) {
    return { id: 'switchbot', name: '방송장비 전원',
      status: 'unknown', value: '확인 불가', detail: '상태를 읽을 수 없습니다' }
  }
  const on = sb.power === 'on'
  return { id: 'switchbot', name: '방송장비 전원',
    status: 'online', value: on ? 'ON' : 'OFF',
    detail: sb.next ? `${sb.next.time} 자동 ${sb.next.action === 'on' ? 'ON' : 'OFF'}` : '자동 제어 비활성' }
}

function micCard(live) {
  const mic = live?.audio?.input
  if (!mic) return UNKNOWN
  if (!Number.isFinite(Number(mic.count))) return UNKNOWN   // 위와 같은 이유
  if (mic.count === 0) {
    // 마이크는 없어도 자동방송은 정상 동작하므로 offline이 아니라 warning
    return { status: 'warning', value: '장치 없음', detail: '입력 장치를 찾을 수 없습니다' }
  }
  return {
    status: 'online',
    value:  `${mic.count}개`,
    detail: mic.first ?? '입력 장치 연결됨',
  }
}
