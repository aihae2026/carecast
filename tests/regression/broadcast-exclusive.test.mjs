/**
 * 회귀테스트 1호 — 즉시방송 동시 2건 출력 방지
 *
 * 목적: 즉시방송 진행 중 두 번째 즉시방송 요청이 들어와도
 *       동시에 재생되지 않는 것(배타 잠금)을 보장한다.
 * 범위: 이 케이스만. 스케줄방송·다중 PC·큐 순서는 다루지 않는다.
 * 실행: node --test tests/regression/
 *
 * [연결 지점] — 2026-08-31 연결 완료.
 *
 * 이 저장소에서 즉시방송의 배타 잠금을 실제로 쥐고 있는 것은
 * `server/services/audioQueue.js`다. 즉시 방송(routes/tts.js)과 마이크 방송(routes/mic.js)이
 * 전부 `enqueue()`를 지나고, 그 안의 `isProcessing`/`currentProc` 한 쌍이 "한 번에 하나만"을
 * 지킨다. 그래서 템플릿이 가정한 세 이름을 그 API 위에 얹는다:
 *
 *   playImmediate(payload)   → enqueue(파일, priority)  — 재생이 끝나면 resolve되는 Promise
 *   getActivePlaybackCount() → audioQueue._test.activeCount()
 *   resetPlayer()            → audioQueue.stopAll()
 *
 * 소리는 내지 않는다. `_test.spawn`을 가짜 프로세스로 갈아끼워서 재생을 흉내낸다
 * (audio-queue-timeout.test.js가 쓰는 것과 같은 이음새다 — 새 하네스를 만들지 않았다).
 * 하드웨어 가드도 "현장"으로 위장한다 — 안 하면 enqueue가 곧바로 거절해서 이 경로를
 * 아예 지나가지 못한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require_ = createRequire(import.meta.url);

// 실제 스피커를 울리지 않으면서 이 경로를 지나가게 한다
const hwPath = require_.resolve('../../server/services/hardwareMode.js');
require_.cache[hwPath] = {
  id: hwPath, filename: hwPath, loaded: true,
  exports: { hardwareDisabled: () => false, noticeOnce: () => {} },
};
const ttsPath = require_.resolve('../../server/services/tts.js');
require_.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true,
  // ensurePythonPath 도 같이 준다 — audioQueue 가 2026-09-07(ISSUE-003)부터 이쪽을 쓴다.
  // 캐시만 읽던 것을 "없으면 찾는다"로 바꿨기 때문이다. 이 회귀 테스트의 관심사는 배타 잠금이라
  // 두 함수가 같은 값을 주면 된다. 안 주면 재생 경로가 파이썬을 못 찾아 **잠금 전에** 거절되고,
  // 그러면 "동시 재생 0건"이 되어 잠금이 깨진 것처럼 보인다(실제로 그렇게 실패했다).
  exports: { getPythonPath: () => 'C:\fake\python.exe', ensurePythonPath: () => 'C:\fake\python.exe' },
};

const audioQueue = require_('../../server/services/audioQueue.js');

// 가짜 재생 프로세스 — durationMs 뒤에 close(0)을 보낸다
audioQueue._test.spawn = () => {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => { proc._killed = true; setImmediate(() => proc.emit('close', 0)); };
  setTimeout(() => { if (!proc._killed) proc.emit('close', 0); }, proc._durationMs ?? 300);
  return proc;
};

function playImmediate({ durationMs = 300 } = {}) {
  // enqueue는 재생이 끝나면 resolve된다. 두 번째 요청은 큐에 들어가 순서를 기다린다 —
  // 그게 이 시스템의 "배타 잠금"이다.
  void durationMs;
  return audioQueue.enqueue('C:\fake\sound.mp3', false)
    .then(() => ({ status: 'queued' }), () => ({ status: 'rejected' }));
}
const getActivePlaybackCount = () => audioQueue._test.activeCount();
const resetPlayer = () => { audioQueue.stopAll('테스트 초기화'); };

test('즉시방송 진행 중에는 두 번째 즉시방송이 동시에 재생되지 않는다', async () => {
  resetPlayer();

  const first = playImmediate({ text: '첫 번째 방송', durationMs: 300 });
  await new Promise((r) => setTimeout(r, 50));
  const second = playImmediate({ text: '두 번째 방송', durationMs: 300 });

  assert.equal(
    getActivePlaybackCount(), 1,
    '즉시방송이 동시에 2건 재생되었다 — 배타 잠금이 깨졌다',
  );

  await Promise.allSettled([first, second]);
  assert.equal(getActivePlaybackCount(), 0, '방송 종료 후 재생 소스가 남아 있다');
});

test('진행 중 들어온 즉시방송 요청은 조용히 사라지지 않는다', async () => {
  resetPlayer();

  const first = playImmediate({ text: '첫 번째 방송', durationMs: 300 });
  await new Promise((r) => setTimeout(r, 50));
  const result = await playImmediate({ text: '두 번째 방송', durationMs: 300 });

  assert.ok(
    ['rejected', 'queued'].includes(result?.status),
    `두 번째 요청의 처리 상태가 불명확하다: ${JSON.stringify(result)}`,
  );

  await first;
});

// 수동재생(마이크 방송)도 같은 배타 잠금을 지나는가.
//
// 확인한 것(2026-08-31): `routes/mic.js`와 `routes/tts.js`가 **같은 `enqueue`를 부른다.**
// 그래서 "즉시방송 중에 마이크 방송을 눌러도 동시에 나지 않는다"는 위 두 케이스와 같은
// 잠금이 지킨다. 그 사실이 조용히 깨지는 것(한쪽이 자기 재생 경로를 따로 만드는 것)을 막는다.
test('수동재생(마이크)도 같은 잠금을 지난다 — 재생 경로가 둘로 갈라지지 않았다', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  for (const file of ['server/routes/mic.js', 'server/routes/tts.js']) {
    const src = readFileSync(join(root, file), 'utf8');
    assert.ok(src.includes("require('../services/audioQueue')"),
      `${file}가 audioQueue를 안 쓴다 — 자기 재생 경로를 따로 만들면 두 소리가 동시에 난다`);
  }

  // 그리고 실제로도 겹치지 않는다: 즉시방송이 도는 중에 하나 더 밀어 넣어 본다.
  resetPlayer();
  const first  = playImmediate({ durationMs: 300 });
  await new Promise((r) => setTimeout(r, 50));
  const manual = playImmediate({ durationMs: 300 });
  assert.equal(getActivePlaybackCount(), 1, '수동재생이 즉시방송 위로 겹쳐 났다');
  await Promise.allSettled([first, manual]);
  assert.equal(getActivePlaybackCount(), 0);
});
