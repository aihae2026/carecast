"""
Windows 오디오 장치 목록 — winmm waveOutGetDevCapsW / waveInGetDevCapsW (ctypes, 표준 라이브러리만).

audioDevices.js 는 PowerShell 로 C# 을 컴파일해 임시 폴더에 DLL 을 만들어 같은 함수를 부른다. 설치판 노트북에서는
그 컴파일·DLL 이 백신(V3) 검사에 걸려 목록이 비었다(사용자 신고 2026-09-17 「어느 스피커로 내보낼까요」에 기본 장치만).
이 스크립트는 **같은 함수**를 부르므로 번호·이름이 똑같다 — PowerShell 길이 실패하거나 0개일 때 대신 쓴다.

인자: out | in   출력: 한 줄에 "번호<TAB>이름" (UTF-8 — 콘솔 코드페이지를 안 탄다)
"""
import ctypes, sys
from ctypes import wintypes


class WAVEOUTCAPSW(ctypes.Structure):
    _fields_ = [('wMid', wintypes.WORD), ('wPid', wintypes.WORD), ('vDriverVersion', wintypes.UINT),
                ('szPname', ctypes.c_wchar * 32), ('dwFormats', wintypes.DWORD), ('wChannels', wintypes.WORD),
                ('wReserved1', wintypes.WORD), ('dwSupport', wintypes.DWORD)]


class WAVEINCAPSW(ctypes.Structure):
    _fields_ = [('wMid', wintypes.WORD), ('wPid', wintypes.WORD), ('vDriverVersion', wintypes.UINT),
                ('szPname', ctypes.c_wchar * 32), ('dwFormats', wintypes.DWORD), ('wChannels', wintypes.WORD),
                ('wReserved1', wintypes.WORD)]


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else 'out'
    winmm = ctypes.windll.winmm
    if kind == 'in':
        n, caps, get = winmm.waveInGetNumDevs(), WAVEINCAPSW, winmm.waveInGetDevCapsW
    else:
        n, caps, get = winmm.waveOutGetNumDevs(), WAVEOUTCAPSW, winmm.waveOutGetDevCapsW
    lines = []
    for i in range(n):
        c = caps()
        if get(ctypes.c_uint(i), ctypes.byref(c), ctypes.sizeof(c)) == 0:
            lines.append('%d\t%s' % (i, c.szPname))
    sys.stdout.buffer.write(('\n'.join(lines) + ('\n' if lines else '')).encode('utf-8'))


main()
