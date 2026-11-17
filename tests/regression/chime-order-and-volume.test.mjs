/**
 * 회귀테스트 4호 — 차임벨 → 본방송 순서가 유지되고, BGM 볼륨이 원래 값으로 복귀한다
 *
 * 목적: 차임벨이 안내 음성보다 **먼저** 나가는 것과, 방송이 끝난 뒤 시스템 볼륨이
 *       방송 전과 **같은 값**으로 남아 있는 것을 보장한다.
 * 범위: 이 케이스만. 큐 꼬임·상태 복귀는 다루지 않는다(5·6호).
 * 실행: npm run test:regression
 *
 * [연결 지점]
 *
 * **"복귀"가 이 시스템에서 지켜지는 방식이 보통과 다르다.** 방송이 볼륨을 잠깐 낮췄다가
 * 되돌리는 게 아니라, **전역 설정을 아예 안 건드리고 그 방송 이벤트에만 값을 실어 보낸다**
 * (CLAUDE.md 볼륨 규칙 — "되돌릴 상태를 만들지 않는다"). 그래서 되돌리기 전에 서버가
 * 죽거나 다음 예약이 발동해도 값이 남지 않는다.
 *
 * 즉 여기서 검사할 것은 "끝나고 되돌렸는가"가 아니라 **"애초에 안 건드렸는가"**다.
 * 누군가 편하다는 이유로 `writeVolumes()`로 낮췄다가 되돌리는 구현으로 바꾸면 이 테스트가
 * 잡는다 — 그 구현은 서버가 그 사이에 죽으면 요양원 스피커가 하루 종일 작게 나간다.
 *
 * 순서는 흐름(flowRunner)이 단계를 배열 순서대로 도는 것으로 지켜진다. 차임 단계는 소리를
 * 낸 뒤 3초를 기다린 다음 다음 단계로 넘어간다 — 겹쳐 울리지 않게.
 *
 * 소리는 내지 않는다: sse·chimePlayer·tts·audioStore를 스텁한다(1~3호와 같은 이음새).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';

const require_ = createRequire(import.meta.url);

const TEST_DB_PATH = join(tmpdir(), `carecast_reg4_${process.pid}_${Date.now()}.db`);
process.env.CARECAST_DB_PATH = TEST_DB_PATH;

const stub = (path_, exports) => {
  require_.cache[path_] = { id: path_, filename: path_, loaded: true, exports };
};

const sseEvents = [];
stub(require_.resolve('../../server/services/sse.js'), {
  broadcastSSE: (event, payload) => { sseEvents.push({ event, payload }); return 1 },
  localClientCount: () => 1, localAliveCount: () => 1,
  clientCount: () => 1,
  addClient: () => {},
  soundOwner: () => null,
});
const chimes = [];
stub(require_.resolve('../../server/services/chimePlayer.js'), {
  playChime: (type, volumePct) => { chimes.push({ type, volumePct }) },
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

const { initDB, getDB } = require_('../../server/db/schema.js');
const { runFlow } = require_('../../server/services/flowRunner.js');
const { readVolume, writeVolumes } = require_('../../server/domain/volume.js');
const { replaceSteps } = require_('../../server/routes/flows.js');

// 방송 전에 맞춰 둔 시스템 볼륨. 방송이 끝난 뒤 이 값이 그대로여야 한다.
const BEFORE = { bgm: 55, tts: 65, audio: 45 };
const CHIME_STEP_VOLUME = 90;   // 이 단계에만 실려야 하는 값
const TTS_STEP_VOLUME   = 40;

let db;
let flowId;

before(() => {
  initDB();
  db = getDB();
  writeVolumes(db, BEFORE);

  const now = new Date().toISOString();
  flowId = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run('회귀 4호 흐름', now, now).lastInsertRowid;
  replaceSteps(db, flowId, [
    { step_type: 'chime', label: '차임벨', config: { volume: CHIME_STEP_VOLUME } },
    { step_type: 'tts',   label: '본방송', config: { content: '점심 식사 안내', volume: TTS_STEP_VOLUME } },
  ]);
});

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일이 없으면 지울 것도 없다 */ }
  }
});

test('차임벨이 본방송보다 먼저 나간다', async () => {
  sseEvents.length = 0;
  chimes.length = 0;

  await runFlow(db, flowId);

  const order = sseEvents.map(e => e.event);
  const chimeAt = order.indexOf('chime_play');
  const ttsAt   = order.indexOf('scheduled_broadcast');

  assert.notEqual(chimeAt, -1, '차임벨이 아예 안 울렸다');
  assert.notEqual(ttsAt, -1, '본방송이 안 나갔다');
  assert.ok(chimeAt < ttsAt,
    `본방송이 차임벨보다 먼저 나갔다(${order.join(' → ')}) — 안내가 시작된 뒤에 종이 울린다`);
  assert.equal(chimes.length, 1, '서버 스피커 차임벨은 한 번만 울려야 한다');
});

test('방송이 끝난 뒤 시스템 볼륨이 방송 전과 같다 — 되돌릴 상태를 만들지 않는다', async () => {
  await runFlow(db, flowId);

  const after_ = { bgm: readVolume(db, 'bgm'), tts: readVolume(db, 'tts'), audio: readVolume(db, 'audio') };
  assert.equal(after_.bgm, BEFORE.bgm,
    'BGM 볼륨이 방송 전과 다르다 — 방송이 전역 설정을 건드렸다. 되돌리기 전에 서버가 죽으면 그 값이 남는다');
  assert.equal(after_.tts, BEFORE.tts, '안내 음성 볼륨이 바뀌어 남았다');
  assert.equal(after_.audio, BEFORE.audio, '음원 볼륨이 바뀌어 남았다');
});

test('단계 볼륨은 그 방송 이벤트에만 실린다', async () => {
  sseEvents.length = 0;
  chimes.length = 0;

  await runFlow(db, flowId);

  const chime = sseEvents.find(e => e.event === 'chime_play');
  const tts   = sseEvents.find(e => e.event === 'scheduled_broadcast');
  assert.equal(chime.payload.volume, CHIME_STEP_VOLUME,
    '차임벨 단계 볼륨이 이벤트에 안 실렸다 — 화면이 시스템 기본값으로 낸다');
  assert.equal(tts.payload.ttsVolume, TTS_STEP_VOLUME,
    '본방송 단계 볼륨이 이벤트에 안 실렸다');
  assert.equal(chimes[0].volumePct, CHIME_STEP_VOLUME, '서버 스피커 차임벨도 같은 값으로 울려야 한다');
});
