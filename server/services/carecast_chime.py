"""
차임벨 — 소리를 합성한다. 표준 라이브러리만 사용(pip install 불필요).

내보내는 방법 두 가지. 파형을 만드는 코드는 하나이고 마지막 단계만 갈린다.
  1) 인자 2개 (type, volume)            → Windows WaveOut으로 직접 재생 (현장 PC, 기존 그대로)
  2) 인자 3개 (type, volume, out.wav)   → WAV 파일로 저장만 하고 끝 (재생은 Node가 맡는다)

왜 (2)가 생겼나: `ctypes.windll`은 **맥에 아예 없다.** 예전에는 이 줄이 파일 맨 위에 있어서
import하는 순간 AttributeError로 죽었고, 그래서 맥에서는 차임이 통째로 안 났다.
맥 재생은 audioBackend.js가 맡는다 — 재생의 플랫폼 분기는 거기 한 곳에서만 한다는 규칙이다.
"""
import sys, os, struct, time, math, wave

WAVE_FORMAT_PCM = 1
SR = 44100

def make_bell(freq, dur=2.2):
    n = int(SR * dur)
    out = bytearray(n * 2)
    PI2 = 2 * math.pi
    for i in range(n):
        t = i / SR
        env = math.exp(-t * 4.5)
        s = (math.sin(PI2 * freq         * t) * 0.55
           + math.sin(PI2 * freq * 2.756 * t) * 0.18
           + math.sin(PI2 * freq * 5.404 * t) * 0.07) * env
        v = int(max(-1.0, min(1.0, s)) * 32767)
        struct.pack_into('<h', out, i * 2, v)
    return bytes(out)

PATTERNS = {
    'general': [(523.25, 0.0), (659.25, 0.5), (783.99, 1.0)],
    'end':     [(783.99, 0.0), (659.25, 0.5), (523.25, 1.0)],
}

type_  = sys.argv[1] if len(sys.argv) > 1 else 'general'
# 볼륨은 0~1 이다. 받은 값을 그대로 믿지 않는다 (P-18, 2026-09-08).
#
# 이 저장소에는 볼륨 단위가 두 층이다 — 화면·DB 는 0~100, 여기는 0~1.
# 앱 경로 둘은 `/100` 을 거쳐 들어오지만, **이 스크립트를 직접 부르는 사람**이
# 0~100 단위로 80 을 넘기면 `:58` 의 `scale = 0.75 * VOLUME * 32767 / mx` 에서
# 진폭이 80배가 되어 **홀에 굉음이 난다.** 되돌릴 수 없는 종류의 사고다.
# 음수도 막는다 — 위상이 뒤집힌 소리가 나간다.
VOLUME = min(1.0, max(0.0, float(sys.argv[2]))) if len(sys.argv) > 2 else 0.8
notes  = PATTERNS.get(type_, PATTERNS['general'])

total = int(SR * (max(t for _, t in notes) + 2.5))
mix   = bytearray(total * 2)

# ── **numpy 가 있으면 한 번에 계산한다** (사용자 신고 2026-09-17 「차임 눌러도 소리 늦게 나가」) ──
# 아래 순수 파이썬 루프는 샘플 40만 개를 하나씩 돌아 1초를 넘긴다. 갓 설치한 PC 는 첫 기동 음성 합성과
# CPU 를 나눠 써 더 늦었다. 설치본에는 numpy 가 함께 들어간다(마이크 재생기용). **같은 식·같은 반올림
# (0 쪽으로 자르기)** 으로 계산해 바이트가 같다 — server/test/chime-numpy-parity 가 대조한다.
# numpy 가 없거나 실패하면 원래 루프로 간다(표준 라이브러리만으로도 울려야 한다).
def _numpy_pcm():
    import numpy as np
    mixv = np.zeros(total, dtype=np.int64)
    for freq, offset in notes:
        n = int(SR * 2.2)
        t = np.arange(n, dtype=np.float64) / SR
        s = (np.sin(2 * math.pi * freq * t) * 0.55
           + np.sin(2 * math.pi * freq * 2.756 * t) * 0.18
           + np.sin(2 * math.pi * freq * 5.404 * t) * 0.07) * np.exp(-t * 4.5)
        bell = np.trunc(np.clip(s, -1.0, 1.0) * 32767).astype(np.int64)
        start = int(offset * SR)
        end = min(total, start + n)
        if end <= start:
            continue
        seg = mixv[start:end] + bell[:end - start]
        mixv[start:end] = np.clip(seg, -32768, 32767)
    mx = int(np.abs(mixv).max()) if total else 1
    if mx > 0:
        scale = 0.75 * VOLUME * 32767 / mx
        mixv = np.clip(np.trunc(mixv.astype(np.float64) * scale), -32767, 32767).astype(np.int64)
    return mixv.astype('<i2').tobytes()

# ── **한 번 만든 파형은 저장해 두고 다시 읽는다** (사용자 신고 2026-09-17 「차임벨이 너무 늦게 나가 반응성이 느려」) ──
# 누를 때마다 numpy 를 불러와 계산했다 — 느린 노트북·백신 검사 아래서 그것만 0.3~1.5초다. 같은 유형·같은 볼륨이면
# 파형이 바이트까지 같으므로 임시 폴더에 원시 PCM 으로 남긴다(스크립트가 아니라 데이터라 백신이 매번 검사하지 않는다).
# 서버가 켜질 때 CARECAST_CHIME_PREPARE=1 로 소리 없이 미리 만들어 둔다(chimePlayer.차임미리만들기).
# 파일로 내보내는 경로(맥)와 순수 루프 대조 시험(CARECAST_CHIME_PURE)은 캐시를 안 쓴다 — 거긴 따로 WAV 캐시가 있다.
import tempfile
_cache = None
if len(sys.argv) <= 3 and os.environ.get('CARECAST_CHIME_PURE') != '1':
    _cache = os.path.join(tempfile.gettempdir(),
                          'carecast_chime_pcm_%s_%03d.raw' % (type_ if type_ in PATTERNS else 'general', int(round(VOLUME * 100))))

_pcm_fast = None
if _cache:
    try:
        with open(_cache, 'rb') as f:
            _raw = f.read()
        if len(_raw) == total * 2:
            _pcm_fast = _raw
    except Exception:
        _pcm_fast = None

if _pcm_fast is None and os.environ.get('CARECAST_CHIME_PURE') != '1':
    try:
        _pcm_fast = _numpy_pcm()
    except Exception:
        _pcm_fast = None

for freq, offset in ([] if _pcm_fast is not None else notes):
    bell = make_bell(freq)
    start = int(offset * SR) * 2
    for j in range(0, len(bell), 2):
        idx = start + j
        if idx + 1 >= len(mix):
            break
        a = struct.unpack_from('<h', mix,  idx)[0]
        b = struct.unpack_from('<h', bell, j  )[0]
        v = int(max(-32768, min(32767, a + b)))
        struct.pack_into('<h', mix, idx, v)

# 정규화 + 볼륨
if _pcm_fast is None:
    mx = max((abs(struct.unpack_from('<h', mix, i)[0]) for i in range(0, len(mix), 2)), default=1)
    if mx > 0:
        scale = 0.75 * VOLUME * 32767 / mx
        for i in range(0, len(mix), 2):
            v = int(struct.unpack_from('<h', mix, i)[0] * scale)
            struct.pack_into('<h', mix, i, max(-32767, min(32767, v)))

pcm = _pcm_fast if _pcm_fast is not None else bytes(mix)

# 캐시에 남긴다 — 임시 이름으로 쓰고 바꿔 끼워, 동시에 읽는 쪽이 반쯤 쓰인 파일을 보지 않게 한다.
if _cache and not os.path.exists(_cache):
    try:
        _part = '%s.%d.part' % (_cache, os.getpid())
        with open(_part, 'wb') as f:
            f.write(pcm)
        os.replace(_part, _cache)
    except Exception:
        pass  # 못 남겨도 이번 차임은 울린다

# 미리 만들기만 하고 끝낸다 — 소리를 내지 않는다.
if os.environ.get('CARECAST_CHIME_PREPARE') == '1':
    sys.exit(0)

# ── 내보내기 ──────────────────────────────────────────────────
out_wav = sys.argv[3] if len(sys.argv) > 3 else None

if out_wav:
    # WAV로 저장만 한다. 볼륨은 위에서 이미 파형에 실렸으므로 재생 쪽에서 또 곱하면 안 된다.
    with wave.open(out_wav, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    sys.exit(0)

# 여기부터 Windows 전용 — winmm은 맥·리눅스에 없다. 위에서 이미 빠져나갔어야 한다.
import ctypes

WAVE_MAPPER = ctypes.c_uint(-1).value

# 서버가 설정된 출력 장치의 인덱스를 실어 보낸다(services/audioDevices.js의 waveOutEnv).
# 없으면 지금까지처럼 기본 장치다 — 이 값이 없다고 차임이 안 울리면 안 된다.
def _out_device():
    try:
        idx = int(os.environ.get('CARECAST_WAVEOUT_INDEX', ''))
    except ValueError:
        return WAVE_MAPPER
    return idx if idx >= 0 else WAVE_MAPPER
WHDR_DONE   = 0x00000001

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

winmm = ctypes.windll.winmm
n     = len(pcm)
buf   = ctypes.create_string_buffer(pcm)

wfx = WAVEFORMATEX()
wfx.wFormatTag     = WAVE_FORMAT_PCM
wfx.nChannels      = 1
wfx.nSamplesPerSec = SR
wfx.nAvgBytesPerSec= SR * 2
wfx.nBlockAlign    = 2
wfx.wBitsPerSample = 16
wfx.cbSize         = 0

h = ctypes.c_void_p(0)
r = winmm.waveOutOpen(ctypes.byref(h), ctypes.c_uint(_out_device()),
                      ctypes.byref(wfx), 0, 0, 0)
if r != 0:
    # 장치를 못 열었다 — **exit 3** 으로 알린다(2026-09-26 사용자 결정 T-36 ③). 예전엔 exit 0 이라 「소리 없이 성공」이 됐다
    # (주석은 「브라우저로 재생」이었지만 브라우저 수신은 꺼져 있었다). 서버(chimePlayer)가 3 을 받아 방송 화면이 대신 울리게 한다.
    sys.exit(3)

hdr = WAVEHDR()
hdr.lpData         = ctypes.addressof(buf)
hdr.dwBufferLength = n
hdr.dwFlags        = 0

winmm.waveOutPrepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(WAVEHDR))
# **소리가 실제로 나가기 시작하는 순간을 알린다** (사용자 신고 2026-09-17 「차임벨이랑 TTS 가 같이 나온다」).
# 서버는 이 줄을 보고 「차임 시작 + 여유」만큼 기다린 뒤 안내 음성을 낸다. 예전엔 프로세스를 **띄운 순간**부터
# 고정 시간만 기다려, 느린 PC 에서 파이썬·numpy 가 늦게 뜨면 차임과 안내가 겹쳤다.
try:
    print("CHIME_PLAYING", flush=True)
except Exception:
    pass
winmm.waveOutWrite(h, ctypes.byref(hdr), ctypes.sizeof(WAVEHDR))

while not (hdr.dwFlags & WHDR_DONE):
    time.sleep(0.01)

winmm.waveOutUnprepareHeader(h, ctypes.byref(hdr), ctypes.sizeof(WAVEHDR))
winmm.waveOutClose(h)
