/**
 * 회귀테스트 3호 — 외부 API가 실패해도 예정된 방송은 그대로 나간다
 *
 * 목적: 날씨·미세먼지·특보·자외선·체감온도·캘린더가 **전부 실패**해도 아침 종합 방송이
 *       그대로 나가는 것을 보장한다. 요양원에서는 "날씨 안내가 빠진 방송"보다
 *       "방송이 통째로 안 나간 아침"이 훨씬 나쁘다.
 * 범위: 이 케이스만. 어떤 값이 빠지는지는 검사하지 않는다(규칙에 그렇게 적혀 있다).
 *       차임벨 순서·볼륨 복귀·큐 순서는 다루지 않는다(4·5호).
 * 실행: npm run test:regression
 *
 * [연결 지점]
 *
 * 아침방송만 루프에 들어가기 **전에** 외부 데이터를 받아 온다
 * (`broadcastSequencer.js`의 LANES.morning.prepare → `morning.js`의 getMorningData).
 * 그 자리가 던지면 `runBroadcastLane`의 catch로 떨어져 **방송이 통째로 취소된다** —
 * 단계 하나가 실패하는 것과 달리 아무 소리도 안 난다. 지금은 두 겹으로 막고 있다:
 *   · 여섯 개 조회를 `Promise.allSettled`로 받아 실패를 값 없음으로 바꾼다
 *   · 캘린더는 따로 try/catch로 감싸고 경보만 올린다(CC-043)
 * 둘 중 하나라도 풀리면 인터넷이 끊긴 아침에 방송이 통째로 사라진다.
 *
 * 소리는 내지 않는다: sse·chimePlayer·tts·audioStore를 스텁한다(1·2호와 같은 이음새,
 * 새 하네스를 만들지 않았다). 실행시간을 줄이려고 **단계를 하나만 켠 구성**으로 돌린다 —
 * 사람이 편집기에서 단계를 끄는 것과 같은 방식이고, 켜 둔 6분짜리 투약 대기를 실제로
 * 기다리면 테스트가 끝나지 않는다.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';

const require_ = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
void root;

const TEST_DB_PATH = join(tmpdir(), `carecast_reg3_${process.pid}_${Date.now()}.db`);
process.env.CARECAST_DB_PATH = TEST_DB_PATH;

const stub = (path_, exports) => {
  require_.cache[path_] = { id: path_, filename: path_, loaded: true, exports };
};

// ── 소리를 타지 않게 ────────────────────────────────────────
const sseEvents = [];
stub(require_.resolve('../../server/services/sse.js'), {
  broadcastSSE: (event, payload) => { sseEvents.push({ event, payload }); return 1 },
  localClientCount: () => 1, localAliveCount: () => 1,
  clientCount: () => 1,
  addClient: () => {},
  soundOwner: () => null,
});
stub(require_.resolve('../../server/services/chimePlayer.js'), {
  playChime: () => {},
  resolveChimeVolume: () => 0.8,
});
stub(require_.resolve('../../server/services/tts.js'), {
  generateTTS:          async () => '/tmp/fake.mp3',
  generateTTSWithRetry: async () => '/tmp/fake.mp3',
  deleteTmpFile: () => {},
  readCues: () => null,
  rateToStr:  () => '+0%',
  pitchToStr: () => '+0Hz',
  getPythonPath: () => null,
});
stub(require_.resolve('../../server/services/audioStore.js'), {
  storeAudio: () => 'fake-audio-id',
  consumeAudio: () => null,
});

// ── 여기가 이 테스트의 본론: 외부 API를 전부 실패시킨다 ──────
const fail = (name) => async () => { throw new Error(`${name} 실패(주입)`) };
stub(require_.resolve('../../server/services/weather.js'), {
  fetchWeather:      fail('초단기예보'),
  fetchAirQuality:   fail('미세먼지'),
  fetchWeatherAlert: fail('기상특보'),
  fetchMinMaxTemp:   fail('최저최고기온'),
  fetchUVIndex:      fail('자외선지수'),
  fetchApparentTemp: fail('체감온도'),
  clearWeatherCache: () => {},
});
stub(require_.resolve('../../server/services/calendar.js'), {
  isConnected:    () => true,          // 연결은 돼 있는데 조회가 깨지는 상황이 더 위험하다
  getTodayEvents: fail('캘린더 일정'),
});

const { initDB, getDB } = require_('../../server/db/schema.js');
const { getMorningData } = require_('../../server/services/morning.js');
const { fireMorningBroadcast } = require_('../../server/services/broadcastSequencer.js');

let db;

before(() => {
  initDB();
  db = getDB();

  // 단계 하나만 켠다 — 투약 안내(6분 대기)와 영상 단계를 실제로 기다리면 끝나지 않는다.
  // 사람이 편집기에서 단계를 끄는 것과 같은 방식이다.
  const steps = [
    { id: 'bgm',                   label: 'BGM 시작',               enabled: false, order: 0 },
    { id: 'date_weather_schedule', label: '날짜/요일/날씨/일정 안내', enabled: true,  order: 1 },
    { id: 'morning_prayer_intro',  label: '기도·묵상 시간 안내 (선택)',      enabled: false, order: 2 },
    { id: 'morning_prayer',        label: '기도·묵상 시간 음원 (선택)',            enabled: false, order: 3 },
    { id: 'breakfast_prayer_tts',  label: '아침 식사 안내 (TTS)', enabled: false, order: 4 },
    { id: 'bgm_after',             label: 'BGM 재시작 (식사 안내 후)',    enabled: false, order: 5 },
    { id: 'medication_tts',        label: '투약 안내 (TTS)',          enabled: false, order: 6 },
    { id: 'morning_video',         label: '아침 후 YouTube 영상',    enabled: false, order: 7 },
  ];
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('morning_steps', JSON.stringify(steps));
});

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일이 없으면 지울 것도 없다 */ }
  }
});

test('외부 조회가 전부 실패해도 아침 데이터 준비가 던지지 않는다', async () => {
  const info = await getMorningData();
  assert.ok(info, '외부 API 실패가 그대로 튀어나왔다 — 방송 진입 전에 통째로 취소된다');
});

test('외부 API가 전부 실패해도 아침 방송은 그대로 나간다', async () => {
  sseEvents.length = 0;
  db.prepare('DELETE FROM broadcasts').run();

  await fireMorningBroadcast(db);

  const steps = sseEvents.filter(e => e.event === 'broadcast_step');
  assert.ok(steps.length >= 1,
    '단계가 하나도 안 돌았다 — 인터넷이 끊긴 아침에 방송이 통째로 사라진다');

  const rows = db.prepare("SELECT * FROM broadcasts WHERE type = '자동'").all();
  assert.equal(rows.length, 1, `이력이 ${rows.length}줄이다 — 한 줄이어야 한다`);
  assert.equal(rows[0].content, '아침 방송',
    '실패 이력으로 남았다 — 외부 API 실패가 방송 실패로 번졌다');
  assert.equal(rows[0].success, 1, '방송이 실패로 기록됐다');
});

test('큐가 멈추지 않는다 — 실패 다음에도 방송을 한 번 더 낼 수 있다', async () => {
  sseEvents.length = 0;
  db.prepare('DELETE FROM broadcasts').run();

  await fireMorningBroadcast(db);

  assert.ok(sseEvents.some(e => e.event === 'broadcast_step'),
    '앞선 실패가 다음 방송까지 막았다 — 한 번 끊기면 그날 내내 안 나간다');
});
