"""음원 하나를 받아쓰고 낱말별 시각을 JSON으로 낸다. caption-draft.cjs가 부른다.

**개발 PC 전용이다.** 현장 PC에 올리지 않는 이유:
  · 첫 실행에 모델을 내려받는다(small 464MB). 현장 회선에서 부팅이 그만큼 멈춘다.
  · 전사가 CPU를 오래 문다. 방송 시간과 겹치면 정시 예산(15초)을 침범한다.
  · 음원은 십수 개뿐이라 개발 PC에서 한 번 돌리면 끝난다.

ffmpeg은 필요 없다 — faster-whisper가 쓰는 av 패키지에 디코더가 동봉되어 있다(실측 확인).

출력(stdout이 아니라 파일로 낸다 — spawn된 파이썬 stdout은 콘솔 코드페이지를 물려받아
한글이 깨진다):
  {"words": [[시작초, 끝초, "들은낱말"], ...], "text": "전체", "audioSec": 32.0}
"""
import json
import sys
import time


def main():
    if len(sys.argv) < 4:
        print('사용법: caption_stt.py <음원경로> <출력JSON경로> <모델> [앞말]', file=sys.stderr)
        return 2

    audio, out, model_size = sys.argv[1], sys.argv[2], sys.argv[3]
    # 넷째 인자는 **앞말**(initial_prompt)이다. 없으면 없는 대로 돈다 — 이 스크립트를
    # 손으로 부르는 자리(scripts/caption-draft.cjs)가 안 줘도 깨지지 않아야 한다.
    initial_prompt = sys.argv[4] if len(sys.argv) > 4 else None

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print('faster-whisper가 없습니다. 설치: pip install faster-whisper', file=sys.stderr)
        return 3

    t0 = time.time()
    model = WhisperModel(model_size, device='cpu', compute_type='int8')

    # word_timestamps가 이 스크립트의 존재 이유다. 끄면 문장 단위 시각만 와서
    # 낱말 색칠(노래방)을 못 한다.
    # ── **앞말을 준다** (사용자 신고 2026-09-16) ────────────────────────────────
    # 녹음 문안 속 드문 낱말을 더 흔한 비슷한 소리의 낱말로 적거나, 영문자로 잡는 일이 있었다.
    #
    # 앞말이 없으면 whisper 는 그저 한국어 음성으로 듣는다. 무슨 방송인지 모르니
    # 드문 낱말은 흔한 쪽으로 간다. 시설 고유 어휘는 sttVocabulary.js 의 설정 파일에서 더한다.
    # `initial_prompt` 는 "이 음성 앞에 이런 말이 있었다"로 쓰여 낱말 선택을 끌어당긴다.
    # 낱말 목록의 단일 출처는 server/domain/sttVocabulary.js 다 — 받아쓰기와 AI 다듬기가
    # **같은 목록**을 봐야, 받아쓰기가 새로 틀리는 낱말을 다듬기가 고칠 수 있다.
    segments, info = model.transcribe(
        audio, language='ko', word_timestamps=True, vad_filter=False,
        initial_prompt=initial_prompt)

    # 진행률을 파일로 흘린다. 전사는 음원 길이의 1/3쯤 걸려서, 아무 표시가 없으면
    # 사람이 "된 건가?" 하고 다시 누르거나 창을 닫는다. segments는 게으른 생성자라
    # 한 덩이 받을 때마다 "어디까지 들었는지"를 알 수 있다 — 그 값이 곧 진행률이다.
    progress_path = out + '.progress'

    def note(done_sec):
        try:
            pct = 0 if info.duration <= 0 else min(99, int(done_sec / info.duration * 100))
            with open(progress_path, 'w', encoding='utf-8') as f:
                json.dump({'percent': pct, 'doneSec': round(done_sec, 1),
                           'totalSec': round(info.duration, 1)}, f)
        except Exception:
            pass  # 진행률을 못 적어도 전사는 계속돼야 한다

    note(0)
    words, text = [], []
    for seg in segments:
        text.append(seg.text)
        for w in (seg.words or []):
            words.append([round(w.start, 3), round(w.end, 3), w.word.strip()])
        note(seg.end)

    with open(out, 'w', encoding='utf-8') as f:
        json.dump({
            'words': words,
            'text': ''.join(text).strip(),
            'audioSec': round(info.duration, 2),
            'sttSec': round(time.time() - t0, 1),
        }, f, ensure_ascii=False)

    try:
        import os
        os.unlink(progress_path)
    except Exception:
        pass  # 남아도 서버가 결과 파일을 보고 끝난 줄 안다
    return 0


if __name__ == '__main__':
    sys.exit(main())
