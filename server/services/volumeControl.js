// Windows Core Audio API를 통한 시스템 마스터 볼륨 제어
// 첫 호출 시 C# → DLL 컴파일(3-5초), 이후 DLL 로드로 빠르게 동작
const { spawn } = require('child_process')
const { hardwareDisabled } = require('./hardwareMode')
const path      = require('path')
const os        = require('os')
const fs        = require('fs')

const DLL_PATH = path.join(os.tmpdir(), 'carecast_winvol_v2.dll')
const CS_PATH  = DLL_PATH.replace('.dll', '.cs')

// IMMDeviceEnumerator의 f1()/f2() 더미 메서드는 COM vtable에서 GetDefaultAudioEndpoint
// 앞에 있는 슬롯 수만큼 있어야 하는데, 실제 vtable(mmdeviceapi.h 기준: EnumAudioEndpoints
// 하나만 앞에 있음)과 다르게 2개(f1,f2)로 선언돼 있어서 실제로는 한 칸 뒤의 메서드(GetDevice,
// 시그니처가 전혀 다름: string 인자)를 잘못 호출하고 있었음 — 이게 매번
// System.AccessViolationException으로 죽던 진짜 원인. f1() 하나만 남기는 게 맞는 매핑.
const CS_SRC = `using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume{int f1();int f2();int f3();int f4();int SetMasterVolumeLevelScalar(float fLevel,Guid pguidEventContext);int f6();int GetMasterVolumeLevelScalar(out float pfLevel);int f8();int f9();int f10();int f11();int SetMute([MarshalAs(UnmanagedType.Bool)]bool bMute,Guid pguidEventContext);int GetMute(out bool pbMute);}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice{int Activate(ref Guid iid,int dwClsCtx,IntPtr pParams,[MarshalAs(UnmanagedType.IUnknown)]out object ppIface);}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator{int f1();int GetDefaultAudioEndpoint(int dataFlow,int role,out IMMDevice ppEndpoint);}
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject{}
public static class WinVol{
  static IAudioEndpointVolume Epv(){var e=new MMDeviceEnumeratorComObject()as IMMDeviceEnumerator;IMMDevice d;e.GetDefaultAudioEndpoint(0,1,out d);object o;var id=typeof(IAudioEndpointVolume).GUID;d.Activate(ref id,23,IntPtr.Zero,out o);return o as IAudioEndpointVolume;}
  public static void Set(float v){Epv().SetMasterVolumeLevelScalar(v,Guid.Empty);}
  public static float Get(){float v=0;Epv().GetMasterVolumeLevelScalar(out v);return v;}
}`

let dllReady   = fs.existsSync(DLL_PATH)
let compileP   = null

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
    // -Path와 -Language를 같이 주면 PowerShell이 파라미터 세트를 못 정해서
    // AmbiguousParameterSet 에러로 매번 실패했음(.cs 확장자로 언어가 이미 정해지므로
    // -Language는 -Path 사용 시 불필요/충돌 — 실제 에러로 확인).
    const ps = `Add-Type -Path '${csEsc}' -OutputAssembly '${dllEsc}' 2>&1`
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])
    let done = false
    let timer = null
    const settle = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v) }
    timer = setTimeout(() => {
      try { proc.kill() } catch { /* 이미 죽었으면 무시 */ }
      console.warn(`[VolumeControl] DLL 컴파일이 ${COMPILE_TIMEOUT_MS / 1000}초 안에 안 끝나 포기합니다 (인라인 컴파일로 fallback)`)
      settle(false)
    }, COMPILE_TIMEOUT_MS)
    // 리스너가 없으면 spawn 실패가 던져져 서버가 죽는다 — 컴파일은 실패해도 fallback이 있다
    proc.on('error', e => {
      console.warn('[VolumeControl] DLL 컴파일 프로세스 실행 실패 (fallback 사용):', e.message)
      settle(false)
    })
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(DLL_PATH)) {
        dllReady = true
        console.log('[VolumeControl] DLL 컴파일 완료')
        settle(true)
      } else {
        console.warn('[VolumeControl] DLL 컴파일 실패 (fallback 사용)')
        settle(false)
      }
    })
  })
  return compileP
}

// 반드시 끝나야 한다 — 예전엔 타임아웃도 on('error')도 없어서 두 가지로 조용히 무너졌다.
//   (1) spawn 실패(ENOENT 등) → 'error'가 던져져 **서버 프로세스가 죽음**
//   (2) PowerShell이 안 끝남 → Promise가 영영 미결 → 호출부가 그대로 멈춤
// timeoutMs는 테스트에서 짧게 줄 수 있게 인자로 열어 둔다(운영은 기본값).
const PS_TIMEOUT_MS = 20000

function runPS(cmd, timeoutMs = PS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd])
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

// macOS/리눅스 개발 환경 가드 — 이 모듈은 Windows 전용(PowerShell + Core Audio COM)이다.
// 기능은 끄되 이유를 분명히 남긴다(침묵 실패 금지). 현장 PC는 Windows라 동작 변화 없음.
const IS_WINDOWS = process.platform === 'win32'
let _nonWinLogged = false
function nonWinNotice() {
  if (_nonWinLogged) return
  _nonWinLogged = true
  console.log('[볼륨] Windows 전용 — 시스템(마스터) 볼륨 제어를 비활성화합니다 (macOS/리눅스 개발 환경)')
}

async function setSystemVolume(level) {
  if (!IS_WINDOWS) { nonWinNotice(); return }
  const v = Math.max(0, Math.min(100, Math.round(level))) / 100
  const ready = await compileDll()
  const dllEsc = DLL_PATH.replace(/\\/g, '\\\\')

  // ${v}f의 "f"는 C# float 리터럴 접미사인데, 이 문자열 전체가 PowerShell 명령으로
  // 실행되는 거라 PowerShell 파서가 "f"를 별도 토큰으로 오인해 매번 파싱 에러가 났음
  // (실제 에러: MissingEndParenthesisInMethodCall) — PowerShell은 숫자를 메서드가
  // 요구하는 타입(float)으로 알아서 변환해주므로 접미사 자체가 불필요.
  const ps = ready
    ? `[void][Reflection.Assembly]::LoadFrom('${dllEsc}'); [WinVol]::Set(${v})`
    : `Add-Type -TypeDefinition @'\n${CS_SRC.replace(/'/g, "''")}\n'@ -Language CSharp; [WinVol]::Set(${v})`

  await runPS(ps)
}

async function getSystemVolume() {
  if (!IS_WINDOWS) { nonWinNotice(); return 70 }  // 기존 실패 폴백과 같은 값
  const ready = await compileDll()
  if (!ready) return 70
  const dllEsc = DLL_PATH.replace(/\\/g, '\\\\')
  try {
    const out = await runPS(`[void][Reflection.Assembly]::LoadFrom('${dllEsc}'); [WinVol]::Get()`)
    return Math.round(parseFloat(out) * 100)
  } catch { return 70 }
}

// 서버 시작 시 백그라운드 컴파일 (Windows에서만 — PowerShell이 없는 환경에서 spawn하지 않는다)
// 하드웨어 접근 없음 모드(테스트·맥 개발)에서는 건너뛴다 — require만 해도 PowerShell이 뜨는 것을
// 막는다(CC-050). 실제로 필요해지면 호출부의 await compileDll()이 그때 컴파일한다.
if (IS_WINDOWS && !hardwareDisabled()) compileDll()

module.exports = { setSystemVolume, getSystemVolume, runPS }
