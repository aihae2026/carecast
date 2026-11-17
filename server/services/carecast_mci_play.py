"""
안내 음성(MP3) 서버 스피커 재생 — Windows MCI, **고정 스크립트 파일** (사용자 신고 2026-09-17 「전반적으로 너무 느려」).

예전에는 재생할 때마다 이 내용을 %TEMP% 에 새 .py 로 써서 실행했다(audioBackend.writeMciScript).
백신(V3 등)은 임시 폴더에 새로 생긴 스크립트를 매번 검사해, 느린 노트북에서 소리가 그만큼 늦게 났다.
차임(carecast_chime.py)·윈도우 음성(carecast_sapi.ps1)과 같은 방식으로 스크립트는 설치 폴더에 고정하고 값만 인자로 받는다.

인자: mp3경로  MCI볼륨(0~1000)  [출력장치 번호, 없거나 음수면 기본 장치]
명령 순서는 예전 스크립트와 한 줄도 다르지 않다 — `play cc wait` 이 빠지면 재생이 끝나기 전에 종료음이 겹친다.
"""
import ctypes, sys

mcis = ctypes.windll.winmm.mciSendStringW
p = sys.argv[1]
vol = int(sys.argv[2])
try:
    dev = int(sys.argv[3]) if len(sys.argv) > 3 else -1
except ValueError:
    dev = -1

# **형식을 박아서 연다** (2026-09-21 실측). 형식을 안 주면 MCI 가 확장자로 드라이버를 고르는데,
# .wav(Supertonic 안내 음성)는 열기부터 304 로 실패해 서버 스피커로 소리가 아예 안 났다.
# mpegvideo 로 열면 wav 도 mp3 와 똑같이 열리고 음량(setaudio volume)이 먹는다.
r = mcis('open "' + p + '" type mpegvideo alias cc', None, 0, None)
if r:
    sys.exit(r)
if dev >= 0:
    mcis(f'setaudio cc to device {dev}', None, 0, None)
mcis(f'setaudio cc volume to {vol}', None, 0, None)
mcis('play cc wait', None, 0, None)
mcis('close cc', None, 0, None)
