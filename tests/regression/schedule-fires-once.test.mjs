/**
 * 회귀테스트 2호 — 예약 하나가 해당 시각에 정확히 한 번만 트리거된다
 *
 * 목적: 매분 도는 스케줄러 tick이 같은 분(HH:MM)을 두 번 지나가도
 *       그 예약이 두 번 나가지 않는 것을 보장한다.
 * 범위: 이 케이스만. 큐 순서·차임벨 순서·볼륨 복귀는 다루지 않는다(4·5호).
 * 실행: npm run test:regression
 *
 * [연결 지점]
 *
 * 중복 발사를 실제로 막는 것은 tick 안의 두 조각 한 쌍이다(`server/services/scheduler.js`):
 *   · 조회의 `AND (last_fired IS NULL OR last_fired != 오늘)`
 *   · 발사 끝의 `finishScheduleFire()`가 찍는 `UPDATE schedules SET last_fired = 오늘`
 * 둘 중 하나만 빠져도 같은 분을 두 번 지나가는 순간 어르신이 같은 방송을 두 번 듣는다.
 * tick 함수는 export되지 않으므로 `node-cron`을 가짜로 갈아끼워 등록되는 콜백을 붙잡는다
 * (새 하네스를 만들지 않았다 — require.cache 스텁은 1호·server/test가 쓰는 것과 같은 이음새다).
 *
 * 소리는 내지 않는다: 차임벨 유형을 쓰고 chimePlayer·sse·tts·audioStore를 스텁한다.
 * "몇 번 트리거됐는가"는 브라우저로 나가는 SSE 수와 이력(broadcasts) 행 수로 센다.
 * 시계는 node:test의 mock.timers(Date만)로 고정한다 — 안 그러면 두 tick 사이에 분이
 * 바뀌어 두 번째가 애초에 조회에 안 걸리고, 테스트가 아무것도 검사하지 않은 채 통과한다.
 */

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';

const require_ = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TEST_DB_PATH = join(tmpdir(), `carecast_reg2_${process.pid}_${Date.now()}.db`);
process.env.CARECAST_DB_PATH = TEST_DB_PATH;

const stub = (path_, exports) => {
  require_.cache[path_] = { id: path_, filename: path_, loaded: true, exports };
};

// ── 소리·네트워크를 타지 않도록, scheduler가 require하기 전에 심는다 ──
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

// node-cron을 가짜로 — startScheduler()가 등록하는 콜백을 붙잡아 손으로 돌린다.
// scheduler.js가 보는 것과 같은 모듈을 갈아끼워야 하므로 server/services 기준으로 resolve한다.
const cronTasks = [];
stub(require_.resolve('node-cron', { paths: [join(root, 'server', 'services')] }), {
  schedule: (expr, fn) => { cronTasks.push({ expr, fn }); return { stop() {}, start() {} } },
});

const { initDB, getDB } = require_('../../server/db/schema.js');
const { startScheduler } = require_('../../server/services/scheduler.js');

// 자동방송 5종·SwitchBot과 겹치지 않는 시각으로 고정한다(수요일 14:23).
const FIRE_TIME = '14:23';
const FROZEN    = new Date(2026, 8, 2, 14, 23, 0);
const TODAY     = '2026-09-02';

let db;
let tick;

before(() => {
  // 시계 고정은 여기서 한 번만 — mock.timers는 두 번 enable하면 던진다.
  mock.timers.enable({ apis: ['Date'], now: FROZEN });
  initDB();
  db = getDB();
  startScheduler();
  tick = cronTasks.find(t => t.expr === '* * * * *')?.fn;
  assert.ok(tick, '매분 tick이 등록되지 않았다 — 스케줄러 배선이 바뀌었다');

  db.prepare(`
    INSERT INTO schedules (title, content, target, scheduled_time, broadcast_type,
                           active, repeat_weekdays, last_fired)
    VALUES (?, ?, ?, ?, 'chime', 1, '[0,1,2,3,4,5,6]', NULL)
  `).run('회귀 2호 예약', '차임벨', '전체', FIRE_TIME);
});

after(() => {
  mock.timers.reset();
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB_PATH + suffix) } catch { /* 파일이 없으면 지울 것도 없다 */ }
  }
});

// 매 케이스를 같은 자리에서 시작시킨다(앞 케이스의 발사 흔적을 지운다)
function resetCounters(lastFired = null) {
  sseEvents.length = 0;
  chimes.length = 0;
  db.prepare('DELETE FROM broadcasts').run();
  db.prepare('UPDATE schedules SET last_fired = ?').run(lastFired);
}
const firedCount = () => sseEvents.filter(e => e.event === 'chime_play').length;
const historyRows = () => db.prepare("SELECT * FROM broadcasts WHERE type = '예약'").all();

test('같은 시각을 두 번 지나가도 예약은 한 번만 나간다', async () => {
  resetCounters(null);

  await tick();
  await tick();   // 시계는 그대로 14:23 — cron이 같은 분을 두 번 지나간 상황

  assert.equal(firedCount(), 1,
    `예약이 ${firedCount()}번 트리거됐다 — 같은 분을 두 번 지나가면 방송이 두 번 나간다`);
  assert.equal(chimes.length, 1, '서버 스피커 차임벨도 한 번만 울려야 한다');
  assert.equal(historyRows().length, 1, '이력에도 한 줄만 남아야 한다');
  assert.equal(
    db.prepare('SELECT last_fired FROM schedules').get().last_fired, TODAY,
    'last_fired가 안 찍혔다 — 다음 tick이 이 예약을 또 발사한다',
  );
});

test('두 번이 아니라 아예 안 나가는 쪽으로 굳지도 않는다 — 어제 나간 예약은 오늘 다시 난다', async () => {
  resetCounters('2026-09-01');   // 어제 나갔던 예약

  await tick();

  assert.equal(firedCount(), 1,
    '어제 발사한 매일 예약이 오늘 안 나갔다 — 중복을 막다가 예약을 영구히 봉인한 것이다');
});
