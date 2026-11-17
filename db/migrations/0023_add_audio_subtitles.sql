-- 음원 자막 (2026-09-04, 배리어프리 2단계)
--
-- 왜 필요한가: TTS 방송은 읽는 문장을 서버가 알고 있어서 자막이 저절로 따라오지만(1단계),
-- 업로드된 음원(안내 녹음·직원 멘트)은 소리만 있고 글자가 없다. 어르신 화면에 아무것도
-- 안 뜬다. 그 글자와 타이밍을 사람이 확인해서 여기에 남긴다.
--
-- 왜 audio_files에 컬럼을 더하지 않는가: 그 표는 `SELECT *`로 읽는 곳이 방송 경로에만 여섯
-- 군데다(broadcastSteps·scheduler·flowRunner·routes/audio). 자막 JSON은 3분짜리 녹음 문안이
-- 10KB를 넘어서, 컬럼으로 두면 목록 응답과 SSE 페이로드에 그 덩어리가 통째로 끌려 들어간다.
-- 자막은 재생 직전에 그 파일 것만 따로 받아 가면 된다.
--
-- audio_file_id : audio_files.id와 1:1. 외래키를 걸지 않는 것은 이 저장소의 다른 표들과 같은
--                 이유다(node:sqlite에서 FK가 기본 꺼져 있어 있어도 안 걸린다). 대신 삭제
--                 라우트가 같이 지운다.
-- cues          : server/domain/captions.js 포맷 v1 JSON. TTS 자막과 **같은 모양**이라 화면이
--                 출처를 몰라도 된다.
-- source        : manual(사람이 다 만듦) · stt(받아쓰기 초안) · prefill(기본 문구를 깔아 둠)
-- status        : draft · ready. **ready만 방송 화면에 나간다.** 받아쓰기와 AI가 만든 것은
--                 사람이 확인하고 올려야 한다(CLAUDE.md 검토 게이트) — 잘못 들은 자막이
--                 홀에 그대로 뜨는 것이 여기서 가장 나쁜 결과다.
--
-- 부피: 음원 하나당 한 행, 파일이 수십 개 규모라 무시할 수 있다.

CREATE TABLE IF NOT EXISTS audio_subtitles (
  audio_file_id INTEGER PRIMARY KEY,
  cues          TEXT    NOT NULL,
  source        TEXT    NOT NULL DEFAULT 'manual',
  status        TEXT    NOT NULL DEFAULT 'draft',
  updated_at    TEXT    NOT NULL
);
