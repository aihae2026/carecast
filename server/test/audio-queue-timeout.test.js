// 서버 스피커 대기열이 영영 멈추는 것을 막는다. (전수검수 CC-019)
//
// 무엇이 문제였나: 재생 자식은 파이썬에서 `mcis('play cc wait', ...)`을 부른다 — **재생이
// 끝날 때까지 블록되는** MCI 호출이다. audioQueue는 `close`와 `error` 이벤트만 받고 있어서
// "영영 안 끝나는 경우"를 받는 곳이 없었다. MCI가 매달리면(장치를 다른 프로그램이 점유,
// 재생 중 장치가 빠짐, 드라이버 행) `close`가 안 오고 → `isProcessing`이 영원히 true →
// **그 뒤로 서버 스피커로 나가는 모든 방송이 조용히 사라진다.**
//
// 죽는 범위(실측): 즉시 방송(routes/tts.js)과 마이크 방송(routes/mic.js).
// 정시 방송 6회는 브라우저에서 나가므로 무관하다. 비상방송(priority)은 매달린 프로세스를
// kill해서 큐를 되살리므로 살아난다 — 아래 마지막 테스트가 그 성질을 지킨다.
//
// 왜 이음새를 뒀나: 이 경로는 "프로세스가 영영 안 끝난다"는 병적 상황이라 진짜 재생으로는
// 재현할 수 없고, 재현하려 들면 개발 PC 스피커가 울린다. 그래서 audioQueue가 쓰는 spawn과
// 제한시간을 테스트가 갈아끼울 수 있게 열어 뒀다. **운영 코드는 기본값만 쓴다.**
'use strict'

// ── **임시 DB 를 제품 모듈보다 먼저 정한다** (2026-09-14 실측으로 발견) ─────────────
// `audioQueue` 는 음량을 읽을 때 `getDB()` 를 부른다(`audioQueue.js:56`). 이 파일이
// `CARECAST_DB_PATH` 를 안 정하고 있어서 그 읽기가 **기본 경로의 DB** 로 갔다 —
// 개발 PC 에서는 개발 DB 를, **현장 PC 에서 `npm test` 를 돌리면 운영 DB** 를 연다.
// 없으면 새로 만들기까지 한다(빈 작업 트리에서 `server/db/database.db` 가 생기는 것을
// 이분탐색으로 확인했다). `pc-role.test.js` 가 같은 구멍을 다른 파일에서 막고 있었다.
//
// **`require` 보다 위여야 한다** — `db/schema.js` 는 로드 시점에 경로를 굳힌다.
const os   = require('node:os')
const path = require('node:path')
process.env.CARECAST_DB_PATH =
  path.join(os.tmpdir(), `carecast_test_audioqueue_${process.pid}_${Date.now()}.db`)

const test   = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')

// 소리 경계를 지나가야 하므로 하드웨어 가드를 현장 조건으로 위장한다.
// 아래에서 spawn을 가짜로 갈아끼우므로 실제로는 아무 프로세스도 안 뜨고 소리도 안 난다.
const hwPath = require.resolve('../services/hardwareMode')
require.cache[hwPath] = {
  id: hwPath, filename: hwPath, loaded: true,
  exports: { hardwareDisabled: () => false, noticeOnce: () => {} },
}

// Python 경로 조회와 볼륨 조회가 DB·파일시스템을 타지 않게 막는다
const ttsPath = require.resolve('../services/tts')
require.cache[ttsPath] = {
  id: ttsPath, filename: ttsPath, loaded: true,
  // ensurePythonPath 도 같이 준다 — audioQueue 가 2026-09-07(ISSUE-003)부터 이쪽을 쓴다.
  exports: { getPythonPath: () => 'C:\\fake\\python.exe', ensurePythonPath: () => 'C:\\fake\\python.exe' },
}

// 경보를 관찰한다
const raised = []
const alertPath = require.resolve('../services/alert')
require.cache[alertPath] = {
  id: alertPath, filename: alertPath, loaded: true,
  exports: { raise: (kind, message) => raised.push({ kind, message }), MAX_MESSAGE: 300 },
}

const audioQueue = require('../services/audioQueue')

// ── 가짜 재생 프로세스 ────────────────────────────────────────
// 진짜 spawn 대신 이걸 돌려준다. hang=true면 close를 영영 안 보낸다(매달린 MCI 흉내).
const spawned = []
function fakeSpawn({ hang = false, exitCode = 0, delay = 5 } = {}) {
  return () => {
    const proc = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.killed = false
    proc.kill = function () { this.killed = true; setTimeout(() => proc.emit('close', null), 1) }
    spawned.push(proc)
    if (!hang) setTimeout(() => proc.emit('close', exitCode), delay)
    return proc
  }
}

test.beforeEach(() => {
  spawned.length = 0
  raised.length = 0
  audioQueue.stopAll('테스트 정리')
  audioQueue._test.timeoutMs = 60000
})

test.after(() => { audioQueue.stopAll('테스트 종료') })

// ── 1) 매달려도 큐가 살아난다 ─────────────────────────────────

test('재생이 제한시간을 넘으면 그 항목만 실패하고 다음 항목이 재생된다', async () => {
  audioQueue._test.timeoutMs = 60
  let call = 0
  audioQueue._test.spawn = (...args) => {
    // 첫 번째만 매달리게 한다 — 두 번째가 재생되면 큐가 살아난 것이다
    call++
    return (call === 1 ? fakeSpawn({ hang: true }) : fakeSpawn({ exitCode: 0 }))(...args)
  }

  const first  = audioQueue.enqueue('C:\\fake\\1.mp3').then(() => 'ok', e => e.message)
  const second = audioQueue.enqueue('C:\\fake\\2.mp3').then(() => 'ok', e => e.message)

  const r1 = await first
  assert.match(String(r1), /제한시간|응답이 없/, '매달린 재생은 실패로 끝나야 한다: ' + r1)

  const r2 = await second
  assert.equal(r2, 'ok', '앞 항목이 매달렸다고 뒤 항목이 영영 안 나가면 안 된다 — 그게 CC-019다')
  assert.equal(spawned[0].killed, true, '매달린 프로세스는 실제로 kill해야 한다(장치를 붙잡고 있다)')
})

test('제한시간에 걸리면 화면·이력·로그에 남는다', async () => {
  audioQueue._test.timeoutMs = 60
  audioQueue._test.spawn = fakeSpawn({ hang: true })

  await audioQueue.enqueue('C:\\fake\\hang.mp3').catch(() => {})
  await new Promise(r => setTimeout(r, 30))

  assert.equal(raised.length, 1, '조용히 넘기면 "왜 소리가 안 났지"가 또 미궁이 된다')
  assert.match(raised[0].message, /소리|재생/, '사람이 읽고 무슨 일인지 알 수 있어야 한다')
})

// ── 2) 정상 재생은 안 건드린다 ────────────────────────────────

test('정상 재생은 제한시간에 안 걸린다', async () => {
  audioQueue._test.timeoutMs = 5000
  audioQueue._test.spawn = fakeSpawn({ exitCode: 0, delay: 10 })

  await audioQueue.enqueue('C:\\fake\\ok.mp3')
  assert.equal(spawned[0].killed, false, '멀쩡히 끝난 재생을 죽이면 방송이 잘린다')
  assert.equal(raised.length, 0, '정상 재생에 경보가 뜨면 잔소리가 된다')
})

test('제한시간 타이머가 끝난 뒤까지 남아 다음 재생을 죽이지 않는다', async () => {
  audioQueue._test.timeoutMs = 80
  audioQueue._test.spawn = fakeSpawn({ exitCode: 0, delay: 5 })

  await audioQueue.enqueue('C:\\fake\\a.mp3')
  await new Promise(r => setTimeout(r, 120))     // 첫 항목의 제한시간이 지나갈 시간
  await audioQueue.enqueue('C:\\fake\\b.mp3')

  assert.equal(spawned[0].killed, false)
  assert.equal(spawned[1].killed, false, '앞 재생의 타이머가 살아 있으면 뒤 재생이 죽는다')
})

// ── 3) 기존 성질 보존 ─────────────────────────────────────────

test('비상방송은 지금처럼 매달린 재생을 끊고 즉시 나간다', async () => {
  audioQueue._test.timeoutMs = 60000            // 제한시간에 기대지 않고 kill로 되살아나야 한다
  let call = 0
  audioQueue._test.spawn = (...args) => {
    call++
    return (call === 1 ? fakeSpawn({ hang: true }) : fakeSpawn({ exitCode: 0 }))(...args)
  }

  const stuck = audioQueue.enqueue('C:\\fake\\stuck.mp3').catch(e => e.message)
  await new Promise(r => setTimeout(r, 20))

  const emergency = audioQueue.enqueue('C:\\fake\\emergency.mp3', true)
  await emergency                                // 매달린 큐를 뚫고 실제로 재생돼야 한다
  await stuck

  assert.equal(spawned[0].killed, true, '비상방송이 앞 재생을 끊어야 한다')
  assert.equal(spawned.length, 2, '비상방송이 실제로 재생돼야 한다')
})

test('stopAll은 제한시간 타이머도 같이 걷는다 — 종료 후에 타이머가 살아 있으면 안 된다', async () => {
  audioQueue._test.timeoutMs = 60
  audioQueue._test.spawn = fakeSpawn({ hang: true })

  const p = audioQueue.enqueue('C:\\fake\\x.mp3').catch(e => e.message)
  await new Promise(r => setTimeout(r, 10))
  const { killed } = audioQueue.stopAll('서버 종료로 중단')
  assert.equal(killed, true)

  await p
  await new Promise(r => setTimeout(r, 100))     // 원래 제한시간이 지나갈 시간
  assert.equal(raised.length, 0, '이미 끝난 재생에 뒤늦게 경보가 뜨면 안 된다')
})

// ── 4) 차임벨도 같은 실패 모드를 갖는다 ───────────────────────
//
// 차임은 큐가 없어 자기는 안 막힌다. 그런데 **매달린 차임 프로세스가 오디오 장치를 붙잡고
// 있으면 그다음 MCI 재생이 매달린다** — 즉 위의 큐 wedge를 일으키는 유력한 원인이다.
// 저장소 교훈: 같은 커밋에서 A에 안전장치를 달았으면 같은 실패 모드의 B에도 달렸는지 볼 것.

const fs = require('fs')
const CHIME_SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'chimePlayer.js'), 'utf8')

test('차임벨 재생 프로세스에도 제한시간이 걸려 있다', () => {
  assert.match(CHIME_SRC, /setTimeout/,
    '매달린 차임이 오디오 장치를 붙잡으면 그다음 방송이 통째로 막힌다')
  assert.match(CHIME_SRC, /\.kill\(\)/,
    '제한시간만 재고 죽이지 않으면 프로세스가 그대로 남는다')
})

// ── P-69 — **진짜** isBusy() 를 고정한다 (2026-09-10) ────────────────────
// P-66 의 테스트들은 audioQueue 를 통째로 스텁으로 갈아끼워 `isBusy: () => true` 를 넣는다.
// 그래서 **진짜 isBusy 가 바쁠 때 true 를 내는지는 아무도 안 봤다**([FACT] EV-002651 —
// 검수자가 임시로 한 번 돌려 확인했을 뿐 저장소에 안 남았다).
// 이 파일은 이미 hardwareMode·tts·spawn 을 갈아끼워 뒀으므로 여기가 그 자리다.
//
// **왜 중요한가**: 자동 업데이트가 이 값을 보고 재시작을 미룬다(P-66·P-68).
// 이 함수가 늘 false 를 내면 소리가 나가는 중에 서버가 재시작된다.

test('P-69: isBusy() 는 재생 중에 참이고, 끝나면 거짓으로 돌아온다', async () => {
  audioQueue._test.timeoutMs = 5000;
  audioQueue._test.spawn = fakeSpawn({ exitCode: 0, delay: 40 });

  assert.equal(audioQueue.isBusy(), false, '아무것도 안 트는데 바쁘다고 한다 — 재시작이 영영 미뤄진다');

  const 재생 = audioQueue.enqueue('C:/fake/busy.mp3');
  // enqueue 는 다음 틱에 재생을 시작한다 — 시작 전에 재면 늘 false 라 검사가 무의미해진다.
  await new Promise(r => setTimeout(r, 10));
  assert.equal(audioQueue.isBusy(), true,
    '재생 중인데 거짓을 낸다 — 자동 업데이트가 소리가 나가는 중에 서버를 재시작한다(P-66·P-68)');

  await 재생;
  await new Promise(r => setTimeout(r, 10));
  assert.equal(audioQueue.isBusy(), false, '끝났는데 참으로 남는다 — 재시작이 영영 안 온다');
});

test('P-69: stopAll 로 큐를 비우면 isBusy() 가 풀린다', async () => {
  audioQueue._test.timeoutMs = 5000;
  audioQueue._test.spawn = fakeSpawn({ hang: true });

  audioQueue.enqueue('C:/fake/hang2.mp3').catch(() => {});
  await new Promise(r => setTimeout(r, 10));
  assert.equal(audioQueue.isBusy(), true, '매달린 재생 중에는 바빠야 한다');

  audioQueue.stopAll('테스트: 굳은 큐 풀기');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(audioQueue.isBusy(), false,
    'stopAll 뒤에도 바쁜 채로 남으면 굳은 큐를 푸는 길이 없다(P-68)');
});

test('P-69: 여러 항목이 이어지는 동안 isBusy() 가 중간에 풀리지 않는다', async () => {
  // `isBusy()` 는 `isProcessing || queue.length > 0` 이다. **뒤 절이 왜 필요한가**를 고정한다.
  // 항목 하나가 끝나고 다음이 시작되기 전의 짧은 틈에 거짓이 되면, 그 순간을 자동 업데이트가
  // 보고 **소리가 이어지는 중에 서버를 재시작한다**(P-66·P-68).
  audioQueue._test.timeoutMs = 5000;
  audioQueue._test.spawn = fakeSpawn({ exitCode: 0, delay: 15 });

  const 셋 = [
    audioQueue.enqueue('C:/fake/a.mp3'),
    audioQueue.enqueue('C:/fake/b.mp3'),
    audioQueue.enqueue('C:/fake/c.mp3'),
  ];
  let 풀린적 = 0;
  const 감시 = setInterval(() => { if (!audioQueue.isBusy()) 풀린적 += 1; }, 3);
  await Promise.all(셋);
  clearInterval(감시);

  assert.equal(풀린적, 0,
    `세 항목이 이어지는 동안 isBusy() 가 ${풀린적}번 거짓이 됐다 — 그 틈에 서버가 재시작되면 소리가 끊긴다`);
  // **정직하게 남긴다**: 2026-09-10 변이 시험에서 `|| queue.length > 0` 을 떼도 이 검사가
  // 안 물었다([FACT] EV-003072). 지금 구현은 `isProcessing` 이 항목 사이에 안 풀리므로
  // 그 절은 **관측 불가한 방어**다(등가 변이). 검사가 약한 것이 아니라 그 줄이 지금은
  // 여분이라는 뜻이다 — 큐 처리 구조를 바꾸는 사람이 이 주석을 보고 다시 재기를 바란다.
  await new Promise(r => setTimeout(r, 10));
  assert.equal(audioQueue.isBusy(), false, '다 끝났는데도 바쁜 채로 남는다');
});

// ── P-60 — 늦게 도착한 종료가 지금 재생을 건드리면 안 된다 (2026-09-10) ──
// `finish()` 는 네 문장을 하는데 예전엔 **둘만** 소유권을 봤다.
// 안 보던 둘이 위험하다: ① `clearPlayTimer()` → 지금 재생의 제한시간이 사라져 매달림을
// 못 잡는다 ② `isProcessing=false; processNext()` → 큐가 이중 기동돼 두 소리가 겹친다.

test('P-60: 늦게 온 종료가 지금 재생의 제한시간을 걷지 않는다', async () => {
  audioQueue._test.timeoutMs = 80
  const 만든것 = []
  audioQueue._test.spawn = () => {
    const proc = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.killed = false
    proc.kill = function () { this.killed = true; setTimeout(() => proc.emit('close', null), 1) }
    만든것.push(proc)
    return proc                       // 스스로 끝나지 않는다 — 우리가 close 를 쏜다
  }

  const 첫째 = audioQueue.enqueue('C:/fake/p60-1.mp3').then(() => 'ok', (e) => e.message)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(만든것.length, 1, '표본 준비 실패 — 첫 재생이 안 떴다')

  // 첫째를 정상 종료시켜 둘째가 시작되게 한다
  만든것[0].emit('close', 0)
  const 둘째 = audioQueue.enqueue('C:/fake/p60-2.mp3').then(() => 'ok', (e) => e.message)
  await new Promise((r) => setTimeout(r, 15))
  assert.equal(만든것.length, 2, '둘째 재생이 안 떴다')

  // **여기서 첫째의 close 가 한 번 더 온다** — 늦게 도착한 종료다.
  만든것[0].emit('close', 0)
  await new Promise((r) => setTimeout(r, 10))

  // 둘째는 스스로 안 끝난다. 제한시간이 살아 있으면 80ms 뒤 거절돼야 한다.
  const r2 = await 둘째
  assert.match(String(r2), /제한시간|응답이 없/,
    `늦게 온 종료가 지금 재생의 제한시간을 걷어 갔다 — 매달린 재생을 영영 못 잡는다: ${r2}`)
  await 첫째
})

test('P-60: 늦게 온 종료가 큐를 이중 기동하지 않는다', async () => {
  audioQueue._test.timeoutMs = 5000
  const 만든것 = []
  audioQueue._test.spawn = () => {
    const proc = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.killed = false
    proc.kill = function () { this.killed = true; setTimeout(() => proc.emit('close', null), 1) }
    만든것.push(proc)
    return proc
  }

  const a = audioQueue.enqueue('C:/fake/q1.mp3').then(() => 'ok', (e) => e.message)
  await new Promise((r) => setTimeout(r, 10))
  const b = audioQueue.enqueue('C:/fake/q2.mp3').then(() => 'ok', (e) => e.message)
  const c = audioQueue.enqueue('C:/fake/q3.mp3').then(() => 'ok', (e) => e.message)

  만든것[0].emit('close', 0)                 // 첫째 끝 → 둘째 시작
  await new Promise((r) => setTimeout(r, 15))
  assert.equal(만든것.length, 2, '둘째가 안 떴다')

  만든것[0].emit('close', 0)                 // 늦게 온 첫째의 종료
  await new Promise((r) => setTimeout(r, 15))
  assert.equal(만든것.length, 2,
    `늦게 온 종료가 셋째까지 띄웠다(${만든것.length}개) — 두 소리가 동시에 나간다`)

  audioQueue.stopAll('테스트 정리')
  await Promise.all([a, b, c])
})
