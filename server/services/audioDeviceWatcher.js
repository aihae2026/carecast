// Windows 기본 오디오 출력 장치 감시 — 설정된 장치로 자동 복원
// 이 시스템은 Core Audio 엔드포인트가 UNPLUGGED 상태이므로 WaveOut API 사용
const { spawn } = require('child_process')
const { hardwareDisabled, noticeOnce } = require('./hardwareMode')
const path      = require('path')
const os        = require('os')
const fs        = require('fs')

const DLL_PATH = path.join(os.tmpdir(), 'carecast_audwatcher2.dll')
const CS_PATH  = DLL_PATH.replace('.dll', '.cs')

// C# -- WaveOut API (winmm.dll): 현재 기본 장치 조회 + 기본 장치 설정
const CS_SRC = `using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AudioDevCtl {
  const uint WAVE_MAPPER = 0xFFFFFFFF;
  const uint DRVM_MAPPER_PREFERRED_GET = 0x2015;
  const uint DRVM_MAPPER_PREFERRED_SET = 0x2016;

  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)]
  struct WAVEOUTCAPS {
    public ushort wMid,wPid; public uint vDriverVersion;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string szPname;
    public uint dwFormats,wChannels; public ushort wReserved1; public uint dwSupport;
  }

  [DllImport("winmm.dll")] static extern int waveOutMessage(IntPtr hwo,uint uMsg,ref uint dwParam1,ref uint dwParam2);
  [DllImport("winmm.dll",CharSet=CharSet.Auto)] static extern int waveOutGetDevCaps(uint uDeviceID,ref WAVEOUTCAPS lpCaps,uint cbwoc);
  [DllImport("winmm.dll",CharSet=CharSet.Auto)] static extern int waveOutGetNumDevs();

  public static string GetPreferredName(){
    try{
      uint devId=0,flags=0;
      waveOutMessage((IntPtr)(-1),DRVM_MAPPER_PREFERRED_GET,ref devId,ref flags);
      var caps=new WAVEOUTCAPS();
      int r=waveOutGetDevCaps(devId,ref caps,(uint)Marshal.SizeOf(caps));
      return r==0?caps.szPname:"";
    }catch(Exception ex){Console.Error.WriteLine(ex.Message);return "";}
  }

  public static string GetNameByIndex(uint idx){
    var caps=new WAVEOUTCAPS();
    return waveOutGetDevCaps(idx,ref caps,(uint)Marshal.SizeOf(caps))==0?caps.szPname:"";
  }

  public static bool SetPreferred(string name){
    try{
      int total=waveOutGetNumDevs();
      for(uint i=0;i<total;i++){
        string dn=GetNameByIndex(i);
        if(string.IsNullOrEmpty(dn))continue;
        int cmp=Math.Min(name.Length,Math.Min(dn.Length,20));
        bool match=(dn==name)||(cmp==20&&name.Substring(0,20)==dn.Substring(0,20));
        if(!match)continue;
        uint devId=i,flags=0;
        waveOutMessage((IntPtr)(-1),DRVM_MAPPER_PREFERRED_SET,ref devId,ref flags);
        return true;
      }
    }catch(Exception ex){Console.Error.WriteLine(ex.Message);}
    return false;
  }
}`

// DLL 캐시 — 최초 컴파일 후 재사용 (volumeControl.js 동일 패턴)
let dllReady = fs.existsSync(DLL_PATH)
let compileP  = null

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
    proc.on('close', code => code === 0 ? finish(resolve, out.trim()) : finish(reject, new Error(err.trim() || `exit ${code}`)))
  })
}

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
  if (compileP)  return compileP
  compileP = new Promise(resolve => {
    try { fs.writeFileSync(CS_PATH, CS_SRC, 'utf8') } catch { return resolve(false) }
    const dllEsc = DLL_PATH.replace(/\\/g, '\\\\')
    const csEsc  = CS_PATH.replace(/\\/g, '\\\\')
    // -Path 방식은 인코딩 문제로 실패하는 경우가 있어, Get-Content로 UTF8 명시 후 -TypeDefinition에 전달
    const ps = `Add-Type -TypeDefinition (Get-Content '${csEsc}' -Raw -Encoding UTF8) -OutputAssembly '${dllEsc}' -Language CSharp 2>&1`
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])
    let done = false
    let timer = null
    const settle = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v) }
    timer = setTimeout(() => {
      try { proc.kill() } catch { /* 이미 죽었으면 무시 */ }
      // 이 파일에는 인라인 폴백이 없다(checkAndRestore가 ready=false면 그냥 돌아간다).
      // 다른 두 파일과 달리 감시 기능 자체가 꺼지므로 문구를 그에 맞춘다.
      console.warn(`[AudioDeviceWatcher] DLL 컴파일이 ${COMPILE_TIMEOUT_MS / 1000}초 안에 안 끝나 포기합니다 — 장치 감시 비활성`)
      settle(false)
    }, COMPILE_TIMEOUT_MS)
    // 리스너가 없으면 spawn 실패가 던져져 서버가 죽는다 — 감시는 못 켜도 서버는 살아야 한다
    proc.on('error', e => {
      console.warn('[AudioDeviceWatcher] DLL 컴파일 프로세스 실행 실패 — 장치 감시 비활성:', e.message)
      compileP = null   // 재시도 허용 (아래 실패 분기와 같은 이유)
      settle(false)
    })
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(DLL_PATH)) {
        dllReady = true
        console.log('[AudioDeviceWatcher] DLL 컴파일 완료')
        settle(true)
      } else {
        console.warn('[AudioDeviceWatcher] DLL 컴파일 실패 — 장치 감시 비활성')
        compileP = null  // 재시도 허용
        settle(false)
      }
    })
  })
  return compileP
}

// 설정 읽기는 domain/settingsRead 한 곳을 쓴다 — 같은 조회가 12곳에 복사돼 있었다(TD-04).
const { rawSetting } = require('../domain/settingsRead')

function getSetting(db, key, def = '') { return rawSetting(db, key) ?? def }

async function checkAndRestore(db) {
  const configured = getSetting(db, 'audio_device', '').trim()
  if (!configured) return  // 장치 미설정이면 감시 안 함

  const ready = await compileDll()
  if (!ready) return

  const dllEsc = DLL_PATH.replace(/\\/g, '\\\\')
  const load   = `[void][Reflection.Assembly]::LoadFrom('${dllEsc}')`

  try {
    const current = await runPS(`${load}; [AudioDevCtl]::GetPreferredName()`)
    if (!current) {
      // WaveOut 장치 없음 — WASAPI 전용 드라이버 환경에서 발생 (감시 스킵)
      return
    }

    // 이름 부분 일치 체크 (앞 20자 비교 — winmm 32자 제한 대응)
    const match = current === configured
      || (current.length >= 20 && configured.startsWith(current.substring(0, 20)))
      || (configured.length >= 20 && current.startsWith(configured.substring(0, 20)))

    if (!match) {
      console.log(`[AudioDeviceWatcher] 장치 불일치 — 현재: "${current}", 설정: "${configured}" → 복원 시도`)
      // **PowerShell 은 ASCII ' 말고도 ‘ ’ ‚ ‛(U+2018~U+201B)를 홑따옴표로 읽는다.** ASCII 만 두 번
      // 쓰면 「x’); 명령; #」 같은 이름이 따옴표를 닫고 명령을 실행한다(추가 점검 2026-11-01 — 이름은
      // 같은 랜의 누구나 설정 API 로 저장할 수 있다). 다섯 글자 모두 같은 글자를 하나 더 붙여 글자로 만든다.
      // 저장 단계(audioDevices.sanitizeDeviceName)도 둥근 따옴표를 거부한다 — 이것은 이미 저장된 값의 방어선이다.
      const nameEsc = configured.replace(/['‘’‚‛]/g, (q) => q + q)
      const result  = await runPS(`${load}; [AudioDevCtl]::SetPreferred('${nameEsc}')`)
      console.log(`[AudioDeviceWatcher] 복원 ${result === 'True' ? '완료 ✓' : '실패 (장치를 찾을 수 없음)'}`)
    }
  } catch (e) {
    console.warn('[AudioDeviceWatcher] 감시 오류:', e.message)
  }
}

// ── 공개 API ────────────────────────────────────────────────
let timer    = null
let watchDb  = null
const INTERVAL_MS = 2 * 60 * 1000  // 2분

// macOS/리눅스 개발 환경 가드 — 이 감시는 PowerShell 전용이다.
let _nonWinLogged = false
function nonWinNotice() {
  if (_nonWinLogged) return
  _nonWinLogged = true
  console.log('[AudioDeviceWatcher] Windows 전용 — 출력장치 감시를 비활성화합니다 (macOS/리눅스 개발 환경)')
}

// 왜 반환값이 있나: "안 떴다"는 사실을 테스트가 확인할 수 있어야 한다. 이 감시는 Windows
// 기본 출력장치를 실제로 바꾸는 유일한 코드라, 뜨면 안 되는 곳에서 뜬 것을 사후에 알아채기
// 어렵다(개발자가 "소리가 이상한데?" 하고 며칠 뒤에 안다).
// @returns {'started'|'not-windows'|'not-site'|'no-hardware'|'already'}
function startWatcher(db) {
  // **안 켜는 이유는 여럿일 수 있는데 반환값은 하나뿐이다.** 맥의 개발 PC는 "맥이라서"도
  // 맞고 "개발 PC라서"도 맞다. 먼저 걸린 하나만 말하면 나머지 사유가 통째로 사라져서,
  // 로그를 보는 사람이 "윈도우로 옮기면 되겠네"라고 잘못 읽는다(2026-08-30 맥북).
  //
  // 그래서 **플랫폼 안내는 판정보다 먼저, 무조건 남기고**, 반환값은 아래 순서로 정한다:
  //   역할 → 하드웨어 모드 → 플랫폼
  // 사람이 **바꿀 수 있는 사유를 먼저** 말하는 순서다(역할은 설정으로, 하드웨어 모드는
  // 환경변수로 바꿀 수 있고, 플랫폼은 못 바꾼다).
  //
  // Windows에서는 이 줄이 아무 일도 하지 않으므로 현장 동작은 그대로다 — 순서를 바꿔도
  // 플랫폼 분기에 걸리는 경우가 없다.
  const notWindows = process.platform !== 'win32'
  if (notWindows) nonWinNotice()

  // 현장 PC 전용 기능이다. 이 감시는 2분마다 **Windows 기본 출력장치를 설정값으로 강제
  // 복원**하는데, 현장에서는 안전장치지만 개발 PC에서는 개발자가 고른 사운드 장치를
  // 케어캐스트가 계속 뺏어가는 사고가 된다(2026-08-30 사용자 신고 "오디오 또 불량").
  // 개발 PC에서도 **재생할 장치를 고르는 것 자체는 그대로 된다** — 그건 MCI 장치 번호를
  // 지정하는 별개 경로(audioDevices.resolveDeviceIndex)라 Windows 기본 장치를 안 건드린다.
  const { getRole, roleLabel, SITE } = require('./pcRole')
  const role = getRole(db)
  if (role !== SITE) {
    console.log(`[AudioDeviceWatcher] ${roleLabel(role)} — 출력장치 강제 복원을 하지 않습니다 (이 PC의 사운드 설정은 사람이 정한다)`)
    return 'not-site'
  }
  // 하드웨어 접근 없음 모드(테스트·검증) — PowerShell을 띄우지도, 장치를 만지지도 않는다.
  if (hardwareDisabled()) {
    noticeOnce('AudioDeviceWatcher')
    return 'no-hardware'
  }
  // 여기부터는 PowerShell을 띄운다. 맥에서는 절대 내려가지 않는다(사유는 위에서 이미 남겼다).
  if (notWindows) return 'not-windows'
  if (timer) return 'already'
  watchDb = db
  compileDll()  // 미리 컴파일 (첫 체크 전 준비)

  const run = async () => {
    await checkAndRestore(watchDb).catch(() => {})
    timer = setTimeout(run, INTERVAL_MS)
  }
  timer = setTimeout(run, 20 * 1000)  // 서버 시작 20초 후 첫 체크
  console.log('[AudioDeviceWatcher] 오디오 장치 감시 시작 (2분 간격) — 현장 PC')
  return 'started'
}

function stopWatcher() {
  if (timer) { clearTimeout(timer); timer = null }
}

// 즉시 체크 (관리자 수동 호출용)
async function checkNow(db) {
  return checkAndRestore(db || watchDb)
}

module.exports = { startWatcher, stopWatcher, checkNow, runPS }
