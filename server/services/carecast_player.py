"""
실시간 마이크 오디오 재생 — Windows WaveOut API (ctypes, 표준 라이브러리만 사용)
pip install 불필요. PortAudio/sounddevice 의존 없음.
"""
import sys, os, struct, ctypes, threading, queue, time

# numpy 선택적 (없어도 동작)
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

# ── WaveOut API 정의 ───────────────────────────────────────────────
winmm = ctypes.windll.winmm

WAVE_FORMAT_PCM = 1
WAVE_MAPPER     = ctypes.c_uint(-1).value  # 0xFFFFFFFF = 기본 출력 장치

# 서버가 설정된 출력 장치의 인덱스를 실어 보낸다(services/audioDevices.js의 waveOutEnv).
# 이 프로세스는 상주형이라 **뜰 때의 값을 끝까지 쓴다** — 설정에서 장치를 바꾸면 서버가
# 이 프로세스를 내리고, 다음 생방송에서 새 값으로 다시 뜬다(routes/settings.js).
def _out_device():
    try:
        idx = int(os.environ.get('CARECAST_WAVEOUT_INDEX', ''))
    except ValueError:
        return WAVE_MAPPER
    return idx if idx >= 0 else WAVE_MAPPER
WHDR_DONE       = 0x00000001

class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [
        ('wFormatTag',      ctypes.c_ushort),
        ('nChannels',       ctypes.c_ushort),
        ('nSamplesPerSec',  ctypes.c_uint32),
        ('nAvgBytesPerSec', ctypes.c_uint32),
        ('nBlockAlign',     ctypes.c_ushort),
        ('wBitsPerSample',  ctypes.c_ushort),
        ('cbSize',          ctypes.c_ushort),
    ]

class WAVEHDR(ctypes.Structure):
    _fields_ = [
        ('lpData',          ctypes.c_void_p),
        ('dwBufferLength',  ctypes.c_uint32),
        ('dwBytesRecorded', ctypes.c_uint32),
        ('dwUser',          ctypes.c_size_t),
        ('dwFlags',         ctypes.c_uint32),
        ('dwLoops',         ctypes.c_uint32),
        ('lpNext',          ctypes.c_size_t),
        ('reserved',        ctypes.c_size_t),
    ]

# **줄마다 핸들을 따로 둔다** (2026-09-17, 2026-09-18 보강). 차임(44100)도 이 플레이어로 나가게 되면서,
# 차임 여운이 도는 중에 마이크가 들어오면 예전 방식(표본율이 바뀌면 닫고 다시 열기)은 **차임을 중간에 끊었다.**
#
# 처음엔 표본율만으로 갈랐는데, 그러면 **마이크가 44100 인 PC 에서 차임과 같은 핸들**이 된다.
# WaveOut 은 한 핸들에 제출된 버퍼를 순서대로 이어 내므로, 차임 3.5초 뒤에 온 목소리가 그만큼
# 늦게 나간다(적대적 검수 2026-09-18). 그래서 **표본율과 줄(차임/마이크)을 함께** 열쇠로 쓴다.
# 핸들은 몇 개 안 되고(줄 2 x 표본율 가짓수) 프로세스가 끝날 때 함께 닫힌다.
_handles = {}

def ensure_waveout(sr, is_chime=False):
    key = (sr, is_chime)
    if key in _handles:
        return _handles[key]

    wfx = WAVEFORMATEX()
    wfx.wFormatTag     = WAVE_FORMAT_PCM
    wfx.nChannels      = 1
    wfx.nSamplesPerSec = sr
    wfx.nAvgBytesPerSec= sr * 2  # 16-bit mono
    wfx.nBlockAlign    = 2
    wfx.wBitsPerSample = 16
    wfx.cbSize         = 0

    h = ctypes.c_void_p(0)
    r = winmm.waveOutOpen(ctypes.byref(h), ctypes.c_uint(_out_device()),
                          ctypes.byref(wfx), 0, 0, 0)
    if r != 0:
        raise RuntimeError(f'waveOutOpen 실패: code={r}')

    _handles[key] = h
    sys.stderr.write(f'DEVICE_OK:WaveOut sr={sr}\n')
    sys.stderr.flush()
    return h

def f32_to_pcm16(raw, n):
    """float32 bytes → int16 bytes"""
    if HAS_NUMPY:
        arr = np.frombuffer(raw, dtype=np.float32)
        return (np.clip(arr, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
    # numpy 없을 때: 순수 struct 변환
    floats = struct.unpack_from(f'<{n}f', raw)
    pcm = bytearray(n * 2)
    for i, f in enumerate(floats):
        s = int(max(-1.0, min(1.0, f)) * 32767)
        struct.pack_into('<h', pcm, i * 2, s)
    return bytes(pcm)

# ── 오디오 큐 + 플레이어 스레드 (비차단 WaveOut 큐잉) ─────────────────
q = queue.Queue(maxsize=16)

def player():
    """
    WaveOut에 청크를 즉시 제출하고 다음 청크를 기다림.
    WaveOut이 내부 큐로 버퍼를 이어서 재생 → 청크 간 갭 제거.
    """
    sys.stderr.write('BACKEND:WaveOut-ctypes\n')
    sys.stderr.flush()

    pending = []   # (buf, hdr, 핸들) — WaveOut이 사용 중인 버퍼, GC 방지용. 핸들이 표본율마다 달라 함께 둔다

    while True:
        item = q.get()
        if item is None:
            break
        sr, raw, n, is_chime = item
        try:
            h = ensure_waveout(sr, is_chime)

            # 완료된 버퍼 정리
            done, still = [], []
            for (b, hd, hh) in pending:
                (done if hd.dwFlags & WHDR_DONE else still).append((b, hd, hh))
            for (b, hd, hh) in done:
                winmm.waveOutUnprepareHeader(hh, ctypes.byref(hd), ctypes.sizeof(WAVEHDR))
            pending = still

            # 새 버퍼를 WaveOut에 즉시 제출 (블로킹 없음)
            pcm = f32_to_pcm16(raw, n)
            buf = ctypes.create_string_buffer(pcm)
            hdr = WAVEHDR()
            hdr.lpData         = ctypes.addressof(buf)
            hdr.dwBufferLength = len(pcm)
            hdr.dwFlags        = 0

            r = winmm.waveOutPrepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(WAVEHDR))
            if r != 0:
                raise RuntimeError(f'PrepareHeader 실패: {r}')
            r = winmm.waveOutWrite(h, ctypes.byref(hdr), ctypes.sizeof(WAVEHDR))
            if r != 0:
                winmm.waveOutUnprepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(WAVEHDR))
                raise RuntimeError(f'Write 실패: {r}')

            pending.append((buf, hdr, h))   # 재생 완료까지 참조 유지

        except Exception as e:
            sys.stderr.write(f'PLAY_ERROR:{e}\n')
            sys.stderr.flush()

t = threading.Thread(target=player, daemon=True)
t.start()

sys.stderr.write('READY\n')
sys.stderr.flush()

# ── 메인 루프: Node.js stdin에서 오디오 청크 읽기 ──────────────────
while True:
    hdr_bytes = sys.stdin.buffer.read(8)
    if len(hdr_bytes) < 8:
        break
    sr_raw, n = struct.unpack('<II', hdr_bytes)
    # 맨 윗 비트는 「차임 줄」 표시다(audioPlayer.js 의 `차임줄표시`). 표본율은 8000~96000 이라 그 비트를 안 쓴다.
    is_chime = bool(sr_raw & 0x80000000)
    sr = sr_raw & 0x7FFFFFFF
    raw = sys.stdin.buffer.read(n * 4)
    if len(raw) < n * 4:
        break
    try:
        q.put_nowait((sr, raw, n, is_chime))
    except queue.Full:
        pass  # 버퍼 초과 시 드롭 (실시간 우선)

q.put(None)
