// R2 時刻境界とイベント時刻変換の検査。
// ゲーム時計を描画回数で進めたり、テストから game.gameTime を書き換えたりしない。
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/js/config.js';
import { judgeTiming } from '../src/js/judge.js';
import { Game } from '../src/js/game.js';
import {
  GameClock,
  INPUT_DELAY_MS,
  STALL_THRESHOLD_MS,
  normalizeEventTimestamp,
} from '../src/js/clock.js';

function makeClock(options = {}) {
  // GameClock is deliberately a class so a clock cannot accidentally be
  // shared between matches through a factory singleton.
  return new GameClock(options);
}

function assertClockRecord(actual, expected, message) {
  assert.ok(actual, `${message}: mapInput が null`);
  assert.equal(actual.time, expected.time, `${message}: game time`);
  assert.equal(actual.receivedAt, expected.receivedAt, `${message}: receivedAt`);
}

function noOpUI() {
  return {
    showBanner() {},
    hideBanner() {},
    updateHUD() {},
    popJudge() {},
    bumpCombo() {},
  };
}

function makeRenderer() {
  return {
    w: 640,
    lineY: 320,
    reducedMotion: false,
    clearTransients() {},
    triggerFlash() {},
    triggerVignette() {},
    triggerShake() {},
    triggerShockwave() {},
    triggerDeflect() {},
    addScorePopup() {},
    burstColors() { return ['#fff']; },
  };
}

function makeParticles() {
  return {
    clear() {},
    update() {},
    spawnBurst() {},
  };
}

function makeGame({ randomValues = [0.25], onGameOver = () => {} } = {}) {
  let randomIndex = 0;
  const randomCalls = [];
  const random = () => {
    const value = randomValues[randomIndex % randomValues.length];
    randomIndex++;
    randomCalls.push(value);
    return value;
  };
  const game = new Game({
    renderer: makeRenderer(),
    particles: makeParticles(),
    settings: { reducedMotion: false, vibrate: false },
    onGameOver,
    ui: noOpUI(),
    random,
  });
  return { game, randomCalls };
}

function installAttack(game, {
  impacts = [1_000],
  needDir = 'R',
  hp = 3,
} = {}) {
  // This is a test fixture for the existing attack shape. It only installs
  // future impact times; the Game clock remains exclusively update-driven.
  const opposite = { L: 'R', R: 'L', D: 'U', DL: 'UR', DR: 'UL' };
  game.mode = 'normal';
  game.state = 'PLAYING';
  game.warmupRemaining = 0;
  game.hp = hp;
  game.nextSpawnAt = Number.POSITIVE_INFINITY;
  game.attack = {
    id: 'timing-fixture',
    dir: opposite[needDir] || 'L',
    needDir,
    spawnAt: 0,
    visibleMs: impacts[0],
    taps: impacts.length,
    segments: impacts.map((impactAt) => ({ impactAt, resolved: false, result: null })),
    segIndex: 0,
    hpLost: false,
    warmup: false,
    resolved: false,
    resolvedAt: 0,
    result: null,
  };
  return game.attack;
}

function startFixture(options = {}) {
  const fixture = makeGame(options);
  fixture.game.start('normal');
  installAttack(fixture.game, options);
  return fixture;
}

function advanceTo(game, target, step = 100) {
  let now = Number(game.gameTime) || 0;
  while (now < target) {
    now = Math.min(target, now + step);
    game.update(now);
  }
}

function snapshotGame(game, randomCalls = []) {
  const attack = game.attack;
  return {
    state: game.state,
    gameTime: game.gameTime,
    hp: game.hp,
    score: game.score,
    combo: game.combo,
    maxCombo: game.maxCombo,
    successCount: game.successCount,
    perfectCount: game.perfectCount,
    totalAttempts: game.totalAttempts,
    nextSpawnAt: game.nextSpawnAt,
    attack: attack && {
      segIndex: attack.segIndex,
      resolved: attack.resolved,
      result: attack.result,
      resolvedAt: attack.resolvedAt,
      segments: attack.segments.map((segment) => ({
        impactAt: segment.impactAt,
        resolved: segment.resolved,
        result: segment.result,
      })),
    },
    randomCalls: [...randomCalls],
  };
}

function runReplay({ fps, deliveryMs }) {
  const { game, randomCalls } = startFixture({ impacts: [1_000], needDir: 'R' });
  const receivedAt = 950 + deliveryMs;
  let delivered = false;
  const frameMs = 1_000 / fps;
  const action = {
    dir: 'R',
    time: 950,
    receivedAt,
    roundId: game.roundId,
  };

  for (let wall = 0; wall <= 1_300; wall += frameMs) {
    if (!delivered && wall >= receivedAt) {
      assert.equal(game.enqueueAction(action), true, `enqueue at ${fps}fps/${deliveryMs}ms`);
      delivered = true;
    }
    game.update(wall);
  }
  if (!delivered) assert.equal(game.enqueueAction(action), true, 'replay action delivered');
  game.update(1_300);
  return snapshotGame(game, randomCalls);
}

function permutations(values) {
  if (values.length <= 1) return [values];
  const out = [];
  values.forEach((value, index) => {
    const rest = values.slice(0, index).concat(values.slice(index + 1));
    for (const tail of permutations(rest)) out.push([value, ...tail]);
  });
  return out;
}

test('T01: 判定窓の全境界と方向違いを固定する', () => {
  const expected = new Map([
    [0, 'PERFECT'],
    [59, 'PERFECT'],
    [-59, 'PERFECT'],
    [60, 'PERFECT'],
    [-60, 'PERFECT'],
    [61, 'GOOD'],
    [-61, 'GOOD'],
    [139, 'GOOD'],
    [-139, 'GOOD'],
    [140, 'GOOD'],
    [-140, 'GOOD'],
    [141, 'MISS'],
    [-141, 'MISS'],
  ]);

  assert.equal(CONFIG.PERFECT_WINDOW, 60);
  assert.equal(CONFIG.GOOD_WINDOW, 140);
  for (const [delta, result] of expected) {
    assert.equal(judgeTiming(delta, true), result, `delta=${delta}`);
    assert.equal(judgeTiming(delta, false), 'MISS', `wrong direction delta=${delta}`);
  }
});

test('R2 clock constants keep the adopted delivery and stall boundaries', () => {
  assert.equal(INPUT_DELAY_MS, 50, 'delivery guarantee is 50ms');
  assert.equal(STALL_THRESHOLD_MS, 250, 'stall threshold is 250ms');
});

test('T02/T05: clock sampling uses the complete wall-clock delta', () => {
  const clock = makeClock({ timeOrigin: 10_000 });
  clock.start(1_000);

  assert.equal(clock.now(1_000), 0);
  assert.equal(clock.now(1_050), 50);
  // An 80ms frame is not truncated to the old 50ms cap.
  assert.equal(clock.now(1_130), 130);
  assert.equal(clock.now(1_380), 380);
  // Sampling is pure: repeating the same wall time does not add another frame.
  assert.equal(clock.now(1_380), 380);
});

test('T07: start resets the match clock and pause/resume excludes stopped time', () => {
  const clock = makeClock({ timeOrigin: 20_000 });
  clock.start(2_000);
  assert.equal(clock.now(2_125), 125);

  clock.pause(2_200);
  assert.equal(clock.now(2_200), 200);
  assert.equal(clock.now(2_900), 200, 'paused wall time does not advance game time');

  clock.resume(3_000);
  assert.equal(clock.now(3_050), 250, 'resume continues from the frozen game time');
  assert.equal(clock.now(3_300), 500);

  clock.start(4_000);
  assert.equal(clock.now(4_000), 0, 'new start begins at game time zero');
  assert.equal(clock.now(4_080), 80);
});

test('T07: event timestamps normalize performance and time-origin epoch values', () => {
  const timeOrigin = 1_700_000_000_000;
  assert.equal(normalizeEventTimestamp(275, 300, timeOrigin), 275, 'performance timestamp');
  assert.equal(
    normalizeEventTimestamp(timeOrigin + 275, 300, timeOrigin),
    275,
    'epoch timestamp converted to performance time',
  );

  for (const value of [-1, '275', timeOrigin + 350]) {
    assert.equal(
      normalizeEventTimestamp(value, 300, timeOrigin),
      null,
      `invalid/future timestamp ${String(value)} is rejected`,
    );
  }
  for (const value of [null, undefined, 0, NaN, Infinity, -Infinity]) {
    assert.equal(
      normalizeEventTimestamp(value, 300, timeOrigin),
      300,
      `missing/non-finite timestamp ${String(value)} falls back to receive time`,
    );
  }
});

test('T07: mapInput returns match-relative event and delivery times, with receive fallback', () => {
  const timeOrigin = 1_700_000_000_000;
  const clock = makeClock({ timeOrigin });
  clock.start(100);

  assertClockRecord(
    clock.mapInput(150, 160),
    { time: 50, receivedAt: 60 },
    'performance timestamp',
  );
  assertClockRecord(
    clock.mapInput(timeOrigin + 150, 160),
    { time: 50, receivedAt: 60 },
    'epoch timestamp',
  );
  assertClockRecord(
    clock.mapInput(0, 160),
    { time: 60, receivedAt: 60 },
    'zero timestamp falls back to delivery',
  );
  assert.equal(clock.mapInput(NaN, 160).time, 60, 'non-finite timestamp falls back to delivery');
});

test('T07: input is not mapped while the game clock is paused', () => {
  const clock = makeClock({ timeOrigin: 30_000 });
  clock.start(100);
  clock.pause(200);

  assert.equal(clock.mapInput(250, 300), null, 'paused input is rejected before enqueue');

  clock.resume(500);
  assertClockRecord(
    clock.mapInput(550, 550),
    { time: 150, receivedAt: 150 },
    'input received after resume',
  );
});

test('T02/T03: 30/60/120fps and 0/16/50ms delivery produce one identical replay', () => {
  const baseline = runReplay({ fps: 30, deliveryMs: 0 });
  assert.equal(baseline.successCount, 1, 'the replay action succeeds exactly once');
  assert.equal(baseline.attack?.segments[0]?.result, 'PERFECT');

  for (const fps of [30, 60, 120]) {
    for (const deliveryMs of [0, 16, 50]) {
      const actual = runReplay({ fps, deliveryMs });
      assert.deepEqual(
        actual,
        baseline,
        `replay differs at ${fps}fps/${deliveryMs}ms delivery`,
      );
    }
  }
});

test('T03/T04: timeout waits for the 50ms delivery watermark and resolves at its deadline', () => {
  const snapshots = [];
  for (const fps of [30, 60, 120]) {
    const { game } = startFixture({ impacts: [1_000], needDir: 'R' });
    advanceTo(game, 1_140, 1_000 / fps);
    assert.equal(game.attack.segments[0].resolved, false, `${fps}fps: +140 timeout waits`);
    advanceTo(game, 1_190.001, 1_000 / fps);
    const segment = game.attack.segments[0];
    assert.equal(segment.result, 'MISS', `${fps}fps: timeout result`);
    assert.equal(segment.resolvedAt, 1_140, `${fps}fps: timeout keeps logical deadline`);
    snapshots.push({
      hp: game.hp,
      result: segment.result,
      resolvedAt: segment.resolvedAt,
      nextSpawnAt: game.nextSpawnAt,
    });
  }
  assert.deepEqual(snapshots[1], snapshots[0], '60fps timeout differs from 30fps');
  assert.deepEqual(snapshots[2], snapshots[0], '120fps timeout differs from 30fps');
});

test('T04: +140 input wins the equal-time timeout, while +141 remains MISS', () => {
  const atDeadline = startFixture({ impacts: [1_000], needDir: 'R' });
  // Let the timeout pump reach the exact 50ms watermark first. The late input
  // is still allowed to arrive at that same wall/game horizon.
  advanceTo(atDeadline.game, 1_190);
  assert.equal(atDeadline.game.attack.segments[0].resolved, false);
  assert.equal(atDeadline.game.enqueueAction({
    dir: 'R', time: 1_140, receivedAt: 1_190, roundId: atDeadline.game.roundId,
  }), true);
  atDeadline.game.update(1_190);
  assert.equal(atDeadline.game.attack.segments[0].resolved, false, 'exact 50ms remains pending');
  atDeadline.game.update(1_190.001);
  assert.equal(atDeadline.game.attack.segments[0].result, 'GOOD');
  assert.equal(atDeadline.game.successCount, 1);
  assert.equal(atDeadline.game.hp, 3);

  const afterDeadline = startFixture({ impacts: [1_000], needDir: 'R' });
  advanceTo(afterDeadline.game, 1_190);
  assert.equal(afterDeadline.game.enqueueAction({
    dir: 'R', time: 1_141, receivedAt: 1_191, roundId: afterDeadline.game.roundId,
  }), true);
  afterDeadline.game.update(1_191);
  assert.equal(afterDeadline.game.attack.segments[0].result, 'MISS');
  assert.equal(afterDeadline.game.successCount, 0);
  assert.equal(afterDeadline.game.hp, 2);

  const overGuarantee = startFixture({ impacts: [1_000], needDir: 'R' });
  assert.equal(overGuarantee.game.enqueueAction({
    dir: 'R', time: 1_140, receivedAt: 1_190.001, roundId: overGuarantee.game.roundId,
  }), false, 'delivery beyond 50ms is rejected at enqueue');
});

test('T04/I04: every same-time direction permutation has one fixed winner', () => {
  const directions = ['L', 'DL', 'D', 'DR', 'R'];
  let baseline = null;
  for (const order of permutations(directions)) {
    const { game, randomCalls } = startFixture({ impacts: [1_000], needDir: 'L' });
    for (const dir of order) {
      assert.equal(game.enqueueAction({
        dir,
        time: 1_000,
        receivedAt: 1_000,
        roundId: game.roundId,
      }), true, `same-time enqueue ${order.join(',')}`);
    }
    advanceTo(game, 1_051);
    const actual = snapshotGame(game, randomCalls);
    if (!baseline) baseline = actual;
    assert.deepEqual(actual, baseline, `same-time order changed result: ${order.join(',')}`);
    assert.equal(actual.successCount, 1, `same-time order double-counted: ${order.join(',')}`);
    assert.equal(actual.attack?.segments[0]?.result, 'PERFECT');
  }
});

test('I04/I06: duplicate and pre-acceptance spam cannot consume a future segment', () => {
  const { game } = startFixture({ impacts: [1_000, 1_180, 1_360], needDir: 'R' });
  const enqueue = (time, receivedAt = time, dir = 'R') => game.enqueueAction({
    dir,
    time,
    receivedAt,
    roundId: game.roundId,
  });

  assert.equal(enqueue(1_000), true);
  assert.equal(enqueue(1_000), true, 'queue may receive a duplicate, Game must collapse it');
  advanceTo(game, 1_051);
  assert.equal(game.successCount, 1, 'duplicate first input scored once');
  assert.equal(game.attack.segIndex, 1, 'first segment only is resolved');

  // This arrives after the first segment but before segment 2's acceptance
  // window (impact 1180 - GOOD_WINDOW = 1040).
  assert.equal(enqueue(1_039), true);
  assert.equal(enqueue(1_039), true);
  advanceTo(game, 1_090);
  assert.equal(game.successCount, 1, 'early spam does not consume segment 2');
  assert.equal(game.attack.segIndex, 1, 'early spam leaves segment 2 pending');
  assert.equal(game.hp, 3, 'early spam is ignored rather than causing a second result');

  assert.equal(enqueue(1_180), true);
  advanceTo(game, 1_231);
  assert.equal(enqueue(1_360), true);
  advanceTo(game, 1_411);
  assert.equal(game.successCount, 3, 'legal segment inputs resolve once each');
  assert.equal(game.attack.segIndex, 3);
  assert.equal(game.attack.resolved, true);
});

test('S06: final HP miss creates exactly one result and rejects post-game input', () => {
  const results = [];
  const { game } = startFixture({
    impacts: [1_000, 1_180, 1_360],
    needDir: 'R',
    hp: 1,
    onGameOver: (result) => results.push(result),
  });

  assert.equal(game.enqueueAction({
    dir: 'L',
    time: 1_000,
    receivedAt: 1_000,
    roundId: game.roundId,
  }), true);
  // Queue later perfect inputs before the first miss. They must be cleared
  // with the round and cannot heal, score, or resurrect the result.
  assert.equal(game.enqueueAction({
    dir: 'R', time: 1_180, receivedAt: 1_180, roundId: game.roundId,
  }), true);
  assert.equal(game.enqueueAction({
    dir: 'R', time: 1_360, receivedAt: 1_360, roundId: game.roundId,
  }), true);
  advanceTo(game, 1_051);
  assert.equal(game.state, 'OVER');
  assert.equal(game.hp, 0);
  assert.equal(game.score, 0, 'future perfect inputs cannot add score after HP0');
  assert.equal(game.perfectCount, 0, 'future perfect inputs cannot trigger recovery');
  assert.equal(results.length, 1, 'game over callback fires once');

  assert.equal(game.enqueueAction({
    dir: 'R',
    time: 1_100,
    receivedAt: 1_100,
    roundId: game.roundId,
  }), false, 'post-game input is rejected');
  advanceTo(game, 1_500);
  assert.equal(results.length, 1, 'post-game updates do not recreate the result');
});
