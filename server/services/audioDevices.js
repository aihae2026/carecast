// Windows waveOut 오디오 출력 장치 목록 조회 + 인덱스 resolve
// PowerShell 인라인 C# → winmm.dll waveOutGetDevCapsW 호출
// 첫 호출 시 C# → DLL 컴파일(3-5초), 이후 DLL 로드로 빠르게 동작 (volumeControl.js와 동일 패턴)
const { spawn } = require('child_process')
const { hasBrokenText } = require('../domain/text')
const { hardwareDisabled } = require('./hardwareMode')
const path       = require('path')
const os         = require('os')
const fs         = require('fs')

// C# 소스 — winmm.dll P/Invoke로 waveOut 장치 목록 열거
// waveOut 인덱스는 MCI setaudio to device N 에서 사용하는 번호와 동일
const CS_SRC = `using System;
using System.Runtime.InteropServices;
public static class WaveDevEnum {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct WAVEOUTCAPS {
    public ushort wMid, wPid;
    public uint vDriverVersion;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)]
    public string szPname;
    public uint dwFormats, wChannels, wReserved1, dwSupport;
  }
  // 마이크(입력) 열거용 — 출력(WAVEOUTCAPS)과 구조가 거의 같고 뒤쪽 필드만 다르다
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct WAVEINCAPS {
    public ushort wMid, wPid;
    public uint vDriverVersion;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)]
    public string szPname;
    public uint dwFormats;
    public ushort wChannels, wReserved1;
  }
  [DllImport("winmm.dll")] public static extern int waveOutGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)]
  public static extern int waveOutGetDevCapsW(uint id, ref WAVEOUTCAPS caps, int sz);
  [DllImport("winmm.dll")] public static extern int waveInGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)]
  public static extern int waveInGetDevCapsW(uint id, ref WAVEINCAPS caps, int sz);
  public static void Run() {
    int n = waveOutGetNumDevs();
    for (int i = 0; i < n; i++) {
      var c = new WAVEOUTCAPS();
      if (waveOutGetDevCapsW((uint)i, ref c, Marshal.SizeOf(c)) == 0)
        Console.WriteLine(i + "\\t" + c.szPname);
    }
  }
  // 입력 장치 전용 — 출력과 섞이지 않도록 별도 진입점
  public static void RunIn() {
    int n = waveInGetNumDevs();
    for (int i = 0; i < n; i++) {
      var c = new WAVEINCAPS();
      if (waveInGetDevCapsW((uint)i, ref c, Marshal.SizeOf(c)) == 0)
        Console.WriteLine(i + "\\t" + c.szPname);
    }
  }
}`

// C# 소스에 waveIn 열거가 추가됐으므로 캐시 DLL 파일명을 v2로 올린다 —
// v1 DLL이 남아있는 PC에서 옛 DLL을 그대로 로드해 RunIn()이 없다고 실패하는 것 방지
const DLL_PATH = path.join(os.tmpdir(), 'carecast_wavedev_v2.dll')
const CS_PATH  = DLL_PATH.replace('.dll', '.cs')

let dllReady = fs.existsSync(DLL_PATH)
let compileP = null

// C# → DLL 컴파일 (최초 1회, 이후 재사용). 실패해도 인라인 컴파일로 fallback 가능하도록 성공 여부만 반환
// DLL 컴파일 제한시간. runPS보다 길게 잡는다 — Add-Type은 C# 컴파일이라 찬 PC에서
// 수십 초가 걸릴 수 있다. 다만 **반드시 끝나야 한다**: compileDll은 `if (compileP) return
// compileP`로 메모이즈돼 있어서, 한 번 매달리면 그 미결 Promise가 캐시되어 이후 호출부가
// 전부 영구히 멈춘다(runPS는 매번 새로 만들어 1회 실패로 끝나는 것과 다르다).
//
// 시간이 넘으면 resolve(false)로 끝내고 **재시도를 열지 않는다.** false를 받은 호출부는
// 인라인 Add-Type(runPS 경유, 이쪽은 타임아웃이 있다)으로 폴백해 기능이 유지된다.
// 여기서 compileP를 비워 재시도를 허용하면, 계속 매달리는 환경에서 방송 중 볼륨 변경마다
// 이 시간을 통째로 기다리게 된다 — 한 번 포기하고 폴백을 쓰는 편이 낫다.
const COMPILE_TIMEOUT_MS = 60000

function compileDll() {
  if (dllReady) return Promise.resolve(true)
  if (compileP) return compileP

  compileP = new Promise(resolve => {
    try { fs.writeFileSync(CS_PATH, CS_SRC, 'utf8') } catch { return resolve(false) }
    const dllEsc = DLL_PATH.replace(/\\/g, '\\\\')
    const csEsc  = CS_PATH.replace(/\\/g, '\\\\')
    // -Path와 -Language를 같이 주면 PowerShell이 파라미터 세트를 못 정해서
    // AmbiguousParameterSet 에러로 매번 실패했음(volumeControl.js에서 실제 에러로 확인한 것과
    // 동일 원인 — .cs 확장자로 언어가 이미 정해지므로 -Path 사용 시 -Language는 불필요/충돌).
    const ps = `Add-Type -Path '${csEsc}' -OutputAssembly '${dllEsc}' 2>&1`
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])
    let done = false
    let timer = null
    const settle = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v) }
    timer = setTimeout(() => {
      try { proc.kill() } catch { /* 이미 죽었으면 무시 */ }
      console.warn(`[AudioDevices] DLL 컴파일이 ${COMPILE_TIMEOUT_MS / 1000}초 안에 안 끝나 포기합니다 (인라인 컴파일로 fallback)`)
      settle(false)
    }, COMPILE_TIMEOUT_MS)
    let err = ''
    proc.stderr.on('data', d => { err += d.toString() })
    // 리스너가 없으면 spawn 실패가 던져져 서버가 죽는다 — 컴파일은 실패해도 fallback이 있다
    proc.on('error', e => {
      console.warn('[AudioDevices] DLL 컴파일 프로세스 실행 실패 (인라인 컴파일로 fallback):', e.message)
      settle(false)
    })
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(DLL_PATH)) {
        dllReady = true
        console.log('[AudioDevices] DLL 컴파일 완료')
        settle(true)
      } else {
        console.warn('[AudioDevices] DLL 컴파일 실패 (매 호출마다 인라인 컴파일로 fallback):', err.trim() || `exit ${code}`)
        settle(false)
      }
    })
  })
  return compileP
}

// 장치 목록 메모리 캐시 — 서버 실행 중 장치가 바뀌지 않으므로 만료 없음
// clearDeviceCache() 호출 시 초기화됨 (관리자 강제 새로고침)
let deviceCache = null  // [{ index: number, name: string }] — 출력(waveOut)
let micCache    = null  // [{ index: number, name: string }] — 입력(waveIn)

// ── 조회 실패·0개일 때의 재시도 억제 ─────────────────────────────
// 예전엔 "장치가 1개 이상일 때만" 캐시에 넣었다. 그래서 이 PC처럼 waveOutGetNumDevs()가
// 0을 돌려주는 환경(2026-09-01 실측: out=0 in=0)에서는 캐시가 **영원히 비어 있고**,
// /api/status가 불릴 때마다 PowerShell을 두 개씩 새로 띄웠다. /api/status는 창마다 4초
// 간격으로 폴링된다(App.jsx useConnectionWatch) — 창 3개면 4초마다 PowerShell 6개다.
// 그 부하가 응답을 3초 밖으로 밀어내면 화면에 "서버 재연결 중" 오버레이가 뜬다.
//
// 그래서 "0개"와 "실패"도 **결과로 인정해서** 잠깐 기억한다. 영구 캐시로 안 하는 이유는
// 스피커를 꽂으면 다시 보여야 하기 때문 — 만료 후 한 번만 다시 확인한다.
const EMPTY_TTL_MS = 60_000   // 0개로 조회된 결과를 이 시간만큼 재사용
const FAIL_TTL_MS  = 60_000   // 조회 실패를 이 시간만큼 기억(같은 에러를 즉시 다시 던진다)

// 종류별 조회 상태. inflight는 **동시 요청 합치기**용 — 폴링이 겹칠 때 PowerShell이
// 여러 개 뜨는 걸 막는다(캐시가 비어 있는 동안에도).
const probeState = {
  out: { emptyAt: 0, failAt: 0, failErr: null, inflight: null, warned: false },
  in:  { emptyAt: 0, failAt: 0, failErr: null, inflight: null, warned: false },
}

function resetProbeState(st) {
  st.emptyAt = 0
  st.failAt  = 0
  st.failErr = null
  st.warned  = false
}

// PowerShell 명령 실행 헬퍼
// 반드시 끝나야 한다 — 예전엔 타임아웃도 on('error')도 없어서 두 가지로 조용히 무너졌다.
//   (1) spawn 실패(ENOENT 등) → 'error'가 던져져 **서버 프로세스가 죽음**
//   (2) PowerShell이 안 끝남 → Promise가 영영 미결 → 호출부가 그대로 멈춤
// timeoutMs는 테스트에서 짧게 줄 수 있게 인자로 열어 둔다(운영은 기본값).
const PS_TIMEOUT_MS = 20000

// PowerShell 출력은 **부모 콘솔의 코드페이지**를 따라간다. 한국어 Windows 기본은 CP949라,
// 그대로 두면 Node의 utf8 디코딩과 어긋나 한글 장치 이름이 U+FFFD로 무너진다(2026-08-30 실측:
// "헤드폰" -> c7 ec b5 e5 c6 f9 -> efbfbd efbfbd efbfbd). 그 깨진 이름이 화면 목록에 뜨고,
// 사람이 그걸 골라 저장하면서 DB에 들어앉았다 -- 그 뒤로 모든 방송이 조용히 엉뚱한 장치로 나갔다.
//
// 서버를 어느 창에서 띄웠느냐에 따라 멀쩡하기도 하고 깨지기도 했다(같은 PC에서 두 결과를 다 봤다).
// 그래서 부르는 쪽에 맡기지 않고 **여기서 스스로** UTF-8을 강제한다.
// audio-device-guard.test.js가 실제 왕복으로 고정한다.
const FORCE_UTF8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '

function runPS(cmd, timeoutMs = PS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', FORCE_UTF8 + cmd])
    let out = '', err = '', done = false
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v) }
    const timer = setTimeout(() => {
      try { proc.kill() } catch { /* 이미 죽었으면 무시 */ }
      finish(reject, new Error(`PowerShell 응답 없음 (${timeoutMs}ms 초과)`))
    }, timeoutMs)
    proc.stdout.on('data', d => { out += d.toString() })
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('error', e => finish(reject, e))
    proc.on('close', code =>
      code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error(err.trim() || `exit ${code}`))
    )
  })
}

// "인덱스\t이름" 줄들을 풀어 [{index, name}] 로
function 줄풀기(out) {
  return out.split('\n')
    .map(line => {
      const tab = line.indexOf('\t')
      if (tab < 0) return null
      const index = parseInt(line.slice(0, tab))
      const name  = line.slice(tab + 1).trim()
      return isNaN(index) ? null : { index, name }
    })
    .filter(Boolean)
}

// C# 진입점(Run=출력 / RunIn=입력)을 PowerShell 로 실행
async function PS로열거(entryPoint) {
  const ready  = await compileDll()
  const dllEsc = DLL_PATH.replace(/\\/g, '\\\\')
  const ps = ready
    ? `[void][Reflection.Assembly]::LoadFrom('${dllEsc}'); [WaveDevEnum]::${entryPoint}()`
    : `Add-Type -TypeDefinition @'\n${CS_SRC.replace(/'/g, "''")}\n'@ -Language CSharp; [WaveDevEnum]::${entryPoint}()`
  return 줄풀기(await runPS(ps))
}

// ── **PowerShell·C# 길이 막히면 파이썬으로 같은 함수를 부른다** (사용자 신고 2026-09-17) ─────────────
// 설치판 노트북에서 「어느 스피커로 내보낼까요」에 기본 장치 하나만 나왔다. 위 길은 C# 을 컴파일해 임시 폴더에
// DLL 을 만드는데, 새로 생긴 DLL·컴파일러 실행이 백신 검사에 걸린다. carecast_devices.py 는 **같은 winmm 함수**를
// ctypes 로 불러 번호·이름이 같다. **PowerShell 결과가 있으면 그대로 쓴다** — 현장 PC 의 동작은 바뀌지 않는다.
const DEVICES_SCRIPT = path.join(__dirname, 'carecast_devices.py')
function 파이썬으로열거(entryPoint, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let python = null
    try { python = require('./tts').ensurePythonPath() } catch { /* 없으면 아래에서 거절 */ }
    if (!python) return reject(new Error('Python 없음'))
    const proc = spawn(python, [DEVICES_SCRIPT, entryPoint === 'RunIn' ? 'in' : 'out'], { windowsHide: true })
    let out = '', done = false
    const 끝 = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v) }
    const timer = setTimeout(() => { try { proc.kill() } catch { /* 이미 끝남 */ } 끝(reject, new Error('파이썬 장치 조회 시간 초과')) }, timeoutMs)
    proc.stdout.on('data', d => { out += d.toString('utf8') })
    proc.on('error', e => 끝(reject, e))
    proc.on('close', code => (code === 0 ? 끝(resolve, out) : 끝(reject, new Error(`파이썬 장치 조회 실패 (exit ${code})`))))
  })
}

async function enumerateDevices(entryPoint) {
  let 목록 = null, 오류 = null
  try { 목록 = await PS로열거(entryPoint) } catch (e) { 오류 = e }
  if (목록 && 목록.length > 0) return 목록
  try {
    const 대신 = 줄풀기(await 파이썬으로열거(entryPoint))
    if (대신.length > 0) {
      console.warn(`[AudioDevices] PowerShell 조회가 ${오류 ? '실패' : '0개'}라 파이썬으로 찾았습니다 — ${대신.length}개`)
      return 대신
    }
  } catch { /* 파이썬도 못 찾으면 PowerShell 결과(또는 오류)를 그대로 낸다 */ }
  if (오류) throw 오류
  return 목록 || []
}

// waveOut 출력 장치 목록 조회
// forceRefresh=true 이면 캐시 무시하고 PowerShell 재실행
// 반환값: [{ index: number, name: string }]
// 실패 시 예외를 던짐 (호출부에서 fallback 여부 결정 — resolveDeviceIndex는 조용히 fallback, /devices 라우트는 에러를 그대로 응답)
// macOS/리눅스 개발 환경 가드 — volumeControl.js와 같은 이유(PowerShell 전용).
const IS_WINDOWS = process.platform === 'win32'
let _nonWinLogged = false
function nonWinNotice() {
  if (_nonWinLogged) return
  _nonWinLogged = true
  console.log('[오디오 장치] Windows 전용 — 출력장치 목록·전환을 비활성화합니다 (macOS/리눅스 개발 환경)')
}

// 출력·입력 공통 조회부. 캐시 규칙이 두 벌이 되면 한쪽만 고치는 날이 온다.
//   1개 이상  → 영구 캐시 (서버 도는 동안 장치는 안 바뀐다 — 기존 동작 그대로)
//   0개       → EMPTY_TTL_MS 동안 그 결과를 재사용 (매 요청 PowerShell 방지)
//   실패      → FAIL_TTL_MS 동안 같은 에러를 즉시 다시 던진다 (호출부 계약은 "실패 시 throw")
//   동시 호출 → inflight 하나에 합류
async function probeDevices(kind, entryPoint, forceRefresh, getCache, setCache) {
  const st = probeState[kind]
  if (forceRefresh) { st.inflight = null; resetProbeState(st) }

  const cached = getCache()
  if (cached && !forceRefresh) {
    if (cached.length > 0) return cached
    if (Date.now() - st.emptyAt < EMPTY_TTL_MS) return cached
  }
  if (!forceRefresh && st.failErr && Date.now() - st.failAt < FAIL_TTL_MS) throw st.failErr
  if (st.inflight) return st.inflight

  st.inflight = enumerateDevices(entryPoint)
    .then(devices => {
      setCache(devices)
      st.emptyAt = devices.length === 0 ? Date.now() : 0
      st.failAt  = 0
      st.failErr = null
      if (devices.length === 0 && !st.warned) {
        // 조용히 넘기면 대시보드에 "확인 불가"만 뜨고 왜인지 알 방법이 없다 — 한 번은 남긴다.
        st.warned = true
        console.warn(`[AudioDevices] ${kind === 'out' ? '출력' : '입력'} 장치가 0개로 조회됩니다 — ${EMPTY_TTL_MS / 1000}초 뒤 다시 확인합니다`)
      }
      return devices
    })
    .catch(err => {
      st.failAt  = Date.now()
      st.failErr = err
      if (!st.warned) {
        st.warned = true
        console.warn(`[AudioDevices] ${kind === 'out' ? '출력' : '입력'} 장치 조회 실패 — ${FAIL_TTL_MS / 1000}초간 재시도하지 않습니다:`, err.message)
      }
      throw err
    })
    .finally(() => { st.inflight = null })

  return st.inflight
}

async function listWaveOutDevices(forceRefresh = false) {
  if (!IS_WINDOWS) { nonWinNotice(); return [] }
  return probeDevices('out', 'Run', forceRefresh, () => deviceCache, v => { deviceCache = v })
}

// 저장된 장치명으로 waveOut 인덱스 resolve
// 반환값: { index: number|null, found: boolean, warning: string|null }
//   index=null  → 기본 장치 사용 (deviceName 미설정 또는 매칭 실패)
async function resolveDeviceIndex(deviceName) {
  // 맥/리눅스에서도 **반환 형태는 지킨다** — 위 주석의 { index, found, warning } 계약이다.
  // null을 돌려주면 호출부(routes/tts.js)의 구조분해가 TypeError로 터져 TTS 방송 전체가
  // 500으로 실패한다(2026-08-30 맥북에서 실제로 발생). 기능을 끄는 것과 계약을 깨는 것은 다르다.
  if (!IS_WINDOWS) { nonWinNotice(); return { index: null, found: true, warning: null } }
  if (!deviceName || !deviceName.trim()) {
    // 설정 안 됨 → 기본 장치 사용 (정상 상태)
    return { index: null, found: true, warning: null }
  }

  let devices
  try {
    devices = await listWaveOutDevices()
  } catch (err) {
    // PowerShell 조회 실패 → 기본 장치 fallback (경고 없음, 방송은 계속 진행)
    console.warn('[AudioDevices] waveOut 장치 목록 조회 실패:', err.message)
    return { index: null, found: true, warning: null }
  }
  if (devices.length === 0) {
    // 조회는 성공했으나 장치가 0개 → 기본 장치 fallback
    return { index: null, found: true, warning: null }
  }

  // 1순위: 정확히 일치
  const exact = devices.find(d => d.name === deviceName)
  if (exact) return { index: exact.index, found: true, warning: null }

  // 2순위: 부분 일치 — winmm이 32자로 잘라 저장하므로 앞부분 매칭
  const partial = devices.find(d =>
    deviceName.startsWith(d.name) || d.name.startsWith(deviceName)
  )
  if (partial) return { index: partial.index, found: true, warning: null }

  // 매칭 실패 → 기본 장치 사용 + 경고 반환
  return {
    index:   null,
    found:   false,
    warning: `설정된 장치 "${deviceName}"를 찾을 수 없어 기본 장치로 재생됩니다.`,
  }
}

// waveIn(마이크) 장치 목록 조회 — 대시보드 시스템 상태 카드용.
// 출력 장치와 캐시를 분리한다(용도가 달라 같이 무효화될 이유가 없음).
async function listWaveInDevices(forceRefresh = false) {
  if (!IS_WINDOWS) { nonWinNotice(); return [] }
  return probeDevices('in', 'RunIn', forceRefresh, () => micCache, v => { micCache = v })
}

// 저장하기 전에 장치 이름이 멀쩡한지 본다.
//
// 실제로 일어난 일(2026-08-30): settings.audio_device에 U+FFFD(글자 깨짐 표시)로 뒤덮인
// 값이 들어앉아 있었다. 원래 "헤드폰(거실 Stereo)"였던 이름이 PowerShell 쪽 인코딩(CP949)을
// 거치면서 **되살릴 수 없게** 깨진 것이다. 그 뒤로 resolveDeviceIndex()가 어떤 장치와도
// 매칭되지 않아 방송이 매번 Windows 기본 장치(모니터 HDMI)로 나갔다 — 스피커는 조용한데
// 화면·이력 어디에도 실패가 안 남는다. 사람이 "오디오가 또 불량"이라고 말해야 알게 된다.
//
// U+FFFD는 정상적인 장치 이름에 절대 안 들어간다. 들어 있다는 것 자체가 "이 값은 이미
// 깨졌다"는 증거이므로, 저장을 거부하는 편이 조용히 받아 두는 것보다 훨씬 낫다.
// 제어문자도 같이 막는다 — 이 이름은 PowerShell 인자로 실려 나간다.
//
// @returns {{ok: true, value: string} | {ok: false, error: string}}
function sanitizeDeviceName(name) {
  const raw = String(name ?? '').trim()
  if (!raw) return { ok: true, value: '' }   // 빈 값 = 기본 장치 사용(정상 상태)

  // 깨진 글자·제어문자 판정은 domain/text.js 한 곳에 있다(2026-08-31). 예전엔 이 함수만의
  // 검사였는데, 같은 사고가 방송 문구·예약·기록에서도 나서 위로 올렸다 — 두 벌이 되면 한쪽만
  // 고치는 날이 온다.
  // 이름이라 줄바꿈도 거부한다 — 이 값은 PowerShell 인자에 그대로 실린다.
  if (hasBrokenText(raw, { allowNewlines: false })) {
    return { ok: false, error: '장치 이름의 글자가 깨져 있습니다. 목록에서 다시 골라주세요.' }
  }
  // 둥근 홑따옴표(‘ ’ ‚ ‛)는 PowerShell 이 따옴표로 읽는다 — 이 이름은 명령 문자열에 실린다
  // (audioDeviceWatcher). Windows 장치 이름에는 안 쓰이는 글자라 거부해도 정상 장치를 잃지 않는다.
  if (/[‘’‚‛]/.test(raw)) {
    return { ok: false, error: '장치 이름에 쓸 수 없는 따옴표가 있습니다. 목록에서 다시 골라주세요.' }
  }
  return { ok: true, value: raw }
}

// 캐시 초기화 — 관리자가 장치 목록을 강제 새로고침할 때 호출
function clearDeviceCache() {
  deviceCache = null
  micCache    = null
  // 0개·실패 기억도 같이 지운다 — 안 지우면 "강제 새로고침"을 눌러도 최대 1분간
  // 옛 결과(0개/에러)를 그대로 돌려줘서 버튼이 안 듣는 것처럼 보인다.
  resetProbeState(probeState.out)
  resetProbeState(probeState.in)
}

// 서버 시작 시 백그라운드 컴파일 (Windows에서만 — PowerShell이 없는 환경에서 spawn하지 않는다)
// 하드웨어 접근 없음 모드(테스트·맥 개발)에서는 건너뛴다 — require만 해도 PowerShell이 뜨는 것을
// 막는다(CC-050). 실제로 필요해지면 호출부의 await compileDll()이 그때 컴파일한다.
if (IS_WINDOWS && !hardwareDisabled()) compileDll()

/**
 * 설정된 출력 장치의 waveOut 인덱스를 **기다리지 않고** 준다.
 *
 * resolveDeviceIndex는 장치 목록을 PowerShell로 캐 오느라 수백 ms가 걸린다. 차임벨은
 * **안내 음성보다 먼저** 나야 신호 노릇을 하는데 그만큼 늦으면 의미가 없고, 상주형
 * 마이크 플레이어는 spawn 시점에 동기로 정해야 한다. 그래서 **이미 캐 둔 목록에서만**
 * 찾는다 — 없으면 null이고, 그건 지금까지의 동작(기본 장치)과 같다.
 *
 * 이름이 정확히 같을 때만 고른다. resolveDeviceIndex의 느슨한 짝맞추기까지 흉내 내면
 * 두 경로가 서로 다른 장치를 고르는 날이 온다 — 그건 지금 부채보다 나쁘다.
 */
function cachedDeviceIndex(deviceName) {
  if (!IS_WINDOWS) return null
  const name = String(deviceName || '').trim()
  if (!name || !deviceCache) return null
  const exact = deviceCache.find(d => d.name === name)
  return exact ? exact.index : null
}

/**
 * 파이썬 재생 프로세스에 실어 보낼 환경변수. 값이 없으면 빈 객체 — 기본 장치로 나간다.
 *
 * 왜 인자가 아니라 환경변수인가: carecast_chime.py의 셋째 인자는 이미 "WAV로 저장할
 * 경로"다(맥·리눅스 경로). 여기에 넷째를 더하면 두 실행 경로의 인자 순서가 얽힌다.
 */
function waveOutEnv() {
  try {
    const { getDB } = require('../db/schema')
    const { rawSetting } = require('../domain/settingsRead')
    const idx = cachedDeviceIndex(rawSetting(getDB(), 'audio_device') || '')
    return idx == null ? {} : { CARECAST_WAVEOUT_INDEX: String(idx) }
  } catch {
    return {}   // DB가 아직 없거나 못 읽어도 소리는 나야 한다 — 기본 장치로 간다
  }
}

/**
 * 출력 장치 목록을 **미리 한 번** 캐 온다. 결과를 안 쓰고 캐시만 데운다.
 *
 * 왜 필요한가: cachedDeviceIndex는 기다리지 않는다 — 캐시가 비어 있으면 null(기본 장치)이다.
 * 그런데 캐시를 채우는 곳은 resolveDeviceIndex뿐이고, 그건 **안내 음성 방송이 한 번 나가야**
 * 불린다. 장치 감시(audioDeviceWatcher)는 자기 C# DLL을 쓰므로 이 캐시를 안 채운다.
 * 그래서 서버를 새로 띄운 뒤 첫 TTS 방송 전까지는 차임벨과 마이크 생방송이 계속 기본 장치로
 * 나갔다 — 특히 상주형 마이크 플레이어는 **뜰 때의 값을 끝까지 쓰므로** 서버가 사는 내내 그랬다.
 *
 * 던지지 않는다. 못 캐 오면 지금까지처럼 기본 장치로 나갈 뿐, 소리가 사라지지는 않는다.
 * 설정된 장치가 없으면 물어볼 것도 없다(기본 장치가 정답이다).
 */
async function warmDeviceCache() {
  if (!IS_WINDOWS) return
  // 소리를 끈 설정에서는 이 캐시를 쓰는 곳(서버 스피커 재생)이 없다 — PowerShell·DLL 컴파일을 띄우지 않는다
  // (2026-10-17 설치 시험 c12, no-hardware-skips-device-warm.test.js). 장치 목록 화면은 그대로 캔다.
  if (hardwareDisabled()) return
  try {
    const { getDB } = require('../db/schema')
    const { rawSetting } = require('./../domain/settingsRead')
    if (!String(rawSetting(getDB(), 'audio_device') || '').trim()) return
    await listWaveOutDevices()
  } catch { /* DB가 아직 없거나 PowerShell이 실패해도 방송은 그대로 나간다 */ }
}

module.exports = { listWaveOutDevices, listWaveInDevices, resolveDeviceIndex, sanitizeDeviceName, clearDeviceCache, runPS, cachedDeviceIndex, waveOutEnv, warmDeviceCache }
