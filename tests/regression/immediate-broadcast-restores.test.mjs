/**
 * 회귀테스트 6호 — 즉시방송 종료 후 중단됐던 BGM/예약 상태로 복귀한다
 *
 * 목적: 사람이 「지금 방송」을 눌러 하나를 즉시 내보낸 뒤에도 **나머지가 그대로**인 것을
 *       보장한다 — 시스템 볼륨, 다른 예약들의 활성/발사 상태, 그리고 다음 방송이 나갈 수
 *       있는 상태(세션이 잠긴 채 남지 않는 것).
 * 범위: 이 케이스만. 마이크 입력은 타지 않고(규칙에 그렇게 적혀 있다), 브라우저 안에서
 *       BGM이 실제로 다시 흐르는지는 화면(MusicPlayer)의 몫이라 여기서 다루지 않는다.
 * 실행: npm run test:regression
 *
 * [연결 지점]
 *
 * 즉시방송은 `POST /api/schedules/:id/trigger` → `fireSchedule()`이다. **매분 tick과 같은
 * 함수**를 지나므로, 여기서 남는 흔적은 예약 방송이 남기는 흔적과 같다.
 *
 * 세 가지를 본다.
 *   · **볼륨** — 방송은 전역 설정을 안 건드리고 이벤트에만 값을 싣는다(4호와 같은 규칙).
 *   · **남의 예약** — 즉시방송이 자기 것 말고 다른 예약의 active·last_fired를 건드리면,
 *     한 번 눌렀다가 그날 다른 방송이 통째로 사라진다. 조용해서 아무도 못 찾는다.
 *   · **세션이 닫히는가** — 즉시방송이 끝난 뒤 다음 방송이 나가야 한다. 잠금이 남으면
 *     그 뒤 예약이 전부 조용히 삼켜진다(1호가 막는 배타 잠금의 반대편 실패다).
 *
 * 소리는 내지 않는다: sse·chimePlayer·tts·audioStore를 스텁한다(1~4호와 같은 이음새).
 * 차임벨 유형을 쓴다 — TTS 생성·대기를 타지 않아 빠르고, 서버 스피커 경로까지 함께 본다.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';

const require_ = createRequire(import.meta.url);

const TEST_DB_PATH = join(tmpdir(), `carecast_reg6_${process.pid}_${Date.now()}.db`);
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

const { initDB, getDB } = require_('../../server/db/schema.js');
const { fireSchedule }  = require_('../../server/services/scheduler.js');
const { readVolume, writeVolumes } = require_('../../server/domain/volume.js');

const BEFORE = { bgm: 55, tts: 65, audio: 45 };

let db;
let target;    // 즉시 내보낼 예약
let bystander; // 건드리면 안 되는 옆 예약

const insert = (title, time) => db.prepare(`
  INSERT INTO schedules (title, content, target, scheduled_time, broadcast_type,
                         active, repeat_weekdays, last_fired)
  VALUES (?, ?, '전체', ?, 'chime', 1, '[0,1,2,3,4,5,6]', NULL)
`).run(title, '차임벨', time).lastInsertRowid;

before(() => {
  initDB();
  db = getDB();
  writeVolumes(db, BEFORE);
  target    = insert('회귀 6호 — 즉시방송 대상', '14:23');
  bystander = insert('회귀 6호 — 옆 예약',       '15:47');
});

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일이 없으면 지울 것도 없다 */ }
  }
});

const rowOf = (id) => db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
const activeCount = () => db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE active = 1').get().n;

test('즉시방송 전후로 시스템 볼륨이 같다', async () => {
  const before_ = { bgm: readVolume(db, 'bgm'), tts: readVolume(db, 'tts'), audio: readVolume(db, 'audio') };

  await fireSchedule(rowOf(target), db);

  assert.equal(readVolume(db, 'bgm'),   before_.bgm,   'BGM 볼륨이 바뀌어 남았다');
  assert.equal(readVolume(db, 'tts'),   before_.tts,   '안내 음성 볼륨이 바뀌어 남았다');
  assert.equal(readVolume(db, 'audio'), before_.audio, '음원 볼륨이 바뀌어 남았다');
});

test('즉시방송이 다른 예약을 건드리지 않는다 — 눌렀다가 그날 다른 방송이 사라지면 안 된다', async () => {
  // **앞 테스트가 남긴 흔적을 먼저 지운다.** 안 지우면 옆 예약이 이미 "오늘 나갔다"로
  // 표시된 상태에서 재기 시작해, 전후가 똑같아 보이고 이 테스트가 아무것도 안 잡는다
  // (실제로 돌연변이 검증에서 그렇게 통과해 버렸다).
  db.prepare('UPDATE schedules SET last_fired = NULL, active = 1 WHERE id = ?').run(bystander);

  const before_ = rowOf(bystander);
  const beforeActive = activeCount();

  await fireSchedule(rowOf(target), db);

  const after_ = rowOf(bystander);
  assert.equal(after_.active, before_.active, '옆 예약이 꺼졌다');
  assert.equal(after_.last_fired, before_.last_fired,
    '옆 예약에 "오늘 나갔다" 표시가 찍혔다 — 그 예약은 오늘 조용히 사라진다');
  assert.equal(activeCount(), beforeActive, `활성 예약 수가 ${beforeActive} → ${activeCount()}로 바뀌었다`);
});

test('즉시방송이 끝나면 다음 방송이 나간다 — 세션이 잠긴 채 남지 않는다', async () => {
  await fireSchedule(rowOf(target), db);

  sseEvents.length = 0;
  await fireSchedule(rowOf(bystander), db);

  assert.ok(sseEvents.some(e => e.event === 'chime_play'),
    '앞선 즉시방송이 끝난 뒤에도 다음 방송이 안 나갔다 — 잠금이 남아 뒤 예약이 전부 삼켜진다');
});
