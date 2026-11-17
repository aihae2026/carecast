-- 예약 방송 render/play 분리 — 1단계 스키마 (2026-09-06)
--
-- 왜 필요한가: 12:00 예약이 12:01 전후에 나갔다. 사전 합성이 T-60초에 시작하는데
-- (scheduler.js:188) 그 안에 못 끝나면 **발사 경로가 다시 합성**하고(scheduler.js:435),
-- 그 예산이 15초다(tts.js:441). 60초 + 15초가 관측된 지연이다.
-- 설계·근거·흐름도: docs/flows/broadcast-pipeline.md
--
-- 이 마이그레이션은 **표와 컬럼을 더하기만 한다.** 기존 행의 값을 바꾸지 않는다.
-- 다만 새로 생긴 두 컬럼(content_source·urgency)은 **비워 두지 않고 채운다** — 이유는 아래.

-- ── audio_cache : 렌더 결과를 DB로 관리한다 ────────────────────────────────
--
-- 왜 파일시스템만으로 부족한가: 지금도 tts-cache/ 에 mp3가 쌓이지만, **언제 만들었는지·
-- 어느 예약 것인지·가변인지**를 아무도 모른다. 그래서 (1) 가변 문안의 오디오를 예약 시각
-- 뒤에 폐기할 수 없고 (2) 트리거 시각에 "준비됐나"를 파일 존재로만 판단해야 한다.
--
-- cache_key   : ttsSynthesis.cacheKeyFor() 결과(sha1 hex). 파일명과 같다.
--               **볼륨은 키에 없다** — 재생 시점 값이라, 넣으면 같은 문장을 볼륨
--               가짓수만큼 다시 합성하게 된다.
-- schedule_id : 어느 예약 것인가. NULL이면 예약과 무관한 렌더(즉시 방송 등).
--               외래키를 안 거는 것은 이 저장소의 다른 표들과 같은 이유다
--               (node:sqlite에서 FK가 기본 꺼져 있어 있어도 안 걸린다).
-- content_source : 이 오디오가 무엇으로 만들어졌나. 가변이면 예약 시각 뒤에 폐기한다.
-- salt        : 만들 때 쓴 엔진 salt. 엔진·SSML 템플릿·합성 게인이 바뀌면 값이 달라져
--               옛 오디오를 자동으로 밀어낸다.
-- expires_at  : 가변 문안의 폐기 예정 시각(ISO). 정적은 NULL — 기존 30일 청소를 따른다.
CREATE TABLE IF NOT EXISTS audio_cache (
  cache_key      TEXT PRIMARY KEY,
  schedule_id    INTEGER,
  content_source TEXT    NOT NULL DEFAULT 'manual',
  text_hash      TEXT,
  voice          TEXT,
  rate           TEXT,
  pitch          TEXT,
  salt           TEXT    NOT NULL,
  file_path      TEXT    NOT NULL,
  bytes          INTEGER,
  rendered_at    TEXT    NOT NULL,
  expires_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_audio_cache_schedule ON audio_cache (schedule_id);
CREATE INDEX IF NOT EXISTS idx_audio_cache_expires  ON audio_cache (expires_at);

-- ── schedules : 렌더 판정의 권위 ──────────────────────────────────────────
--
-- content_source 가 **여기** 있어야 하는 이유: 렌더 시점을 정하는 판단은 방송이 나가기
-- **전에** 일어난다. broadcasts 는 나간 뒤 쓰는 이력이라 그 판단에 쓸 수 없다.
-- 두 표에 같은 이름의 컬럼이 있고 **값이 다를 수 있다** — 등록 뒤 문안을 고치면
-- schedules 는 새 값, 지난 broadcasts 행은 그때의 값이다.
--   schedules.content_source  = 판정의 권위. 렌더 시점 결정은 여기만 읽는다.
--   broadcasts.content_source = 그때 무엇으로 나갔는지의 스냅샷.
ALTER TABLE schedules ADD COLUMN content_source TEXT DEFAULT 'manual';

-- urgency : 유예 판정 1순위. 'normal' | 'emergency'
--
-- **기존 행은 전부 'normal'(유예 5분)로 채운다.** 긴급으로 잘못 들어가면 유예 없이
-- 성공할 때까지 재시도하므로 무한 재시도가 된다. 긴급 지정은 사람이 명시적으로만 한다.
-- 참고: 2026-09-06 현재 긴급방송은 예약을 지나지 않는다(routes/tts.js:27 의 즉시 방송
-- 경로). 그럼에도 컬럼을 지금 넣는 것은 나중에 마이그레이션을 또 만들지 않기 위해서다.
ALTER TABLE schedules ADD COLUMN urgency TEXT DEFAULT 'normal';

-- ── broadcasts : 지연을 숫자로 남긴다 ─────────────────────────────────────
--
-- 지금은 prep_ms(발사에서 소리 지시까지)만 있어서 "예정보다 얼마나 늦었나"를 못 본다.
-- scheduled_at 이 있어야 지연이 계산된다.
ALTER TABLE broadcasts ADD COLUMN content_source TEXT;
ALTER TABLE broadcasts ADD COLUMN scheduled_at   TEXT;
ALTER TABLE broadcasts ADD COLUMN rendered_at    TEXT;
ALTER TABLE broadcasts ADD COLUMN played_at      TEXT;
ALTER TABLE broadcasts ADD COLUMN delay_ms       INTEGER;

-- ── 기존 행 채우기 ────────────────────────────────────────────────────────
--
-- 비워 두면 안 되는 이유: isVariable() 은 **모르는 값을 가변으로 본다**(안전한 쪽).
-- 비워 두면 기존 예약 전부가 가변으로 판정되어 매일 재합성 + 캐시 폐기가 반복된다 —
-- 정시성을 고치려는 작업이 합성량을 늘리는 역전이 일어난다.
--
-- 분류는 결정론적이다. 낱말로 추정하지 않는다:
--   1) 문안에 {{토큰}} 이 있으면            → manual_template
--   2) managed_by 가 있으면(시스템 관리)     → system_template
--   3) 그 외                                 → manual
--
-- 애매한 건(토큰 없이 날씨·미세먼지 낱말만 있는 문안)은 **자동 판단하지 않는다.**
-- 값은 manual 로 두어 **오늘과 똑같이 동작하게** 하고, 목록으로 뽑아 사람에게 보고한다:
--   node scripts/report-content-source.cjs
UPDATE schedules SET urgency = 'normal' WHERE urgency IS NULL;

UPDATE schedules SET content_source = 'manual_template'
 WHERE content_source = 'manual' AND content LIKE '%{{%' AND content LIKE '%}}%';

UPDATE schedules SET content_source = 'system_template'
 WHERE content_source = 'manual' AND managed_by = 'morning_editor';

-- 'ai' 는 자연어 초안에서 승인돼 만들어진 행이다. 시스템 서식이 아니라 LLM 문안이라
-- 폴백 정책이 갈릴 수 있다(외부 데이터 참조 여부). 개발 DB 에 'ai' 행이 없어
-- 처음엔 이 구분을 놓쳤다(2026-09-06).
UPDATE schedules SET content_source = 'llm'
 WHERE content_source = 'manual' AND managed_by = 'ai';

UPDATE schedules SET content_source = 'manual' WHERE content_source IS NULL;   -- 혹시 NULL이 남았다면
