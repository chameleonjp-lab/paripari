// 実 Game が生成した攻撃に対する入力記録を、描画と配送の条件を変えて再生する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/js/game.js';
import { createRandom } from '../src/js/random.js';
import { ParticlePool } from '../src/js/particles.js';

const END = 550_000;
const DIRECTIONS = ['L', 'DL', 'D', 'DR', 'R'];

function inputsFor(attack, index) {
  const kind = index % 100;
  // 正解、早め/遅めのGOOD、方向違い、無入力、期限後を混ぜる。
  // 十分な成功区間を残し、実際の難易度上昇で2連・3連まで進める。
  if (kind === 60) return [];
  return attack.segments.map((segment, part) => ({
    time: segment.impactAt + (part > 0 ? 0
      : kind === 10 ? -100 : kind === 20 ? 100 : kind === 90 ? 141 : 0),
    dir: kind === 30 && part === 0
      ? DIRECTIONS.find((dir) => dir !== attack.needDir) : attack.needDir,
  }));
}

function replay({ fps = 60, delay = 0, recorded = null, effects = false,
  reducedMotion = false, vibration = false } = {}) {
  const random = createRandom(0x20260922);
  const randomValues = [];
  const attacks = [];
  const observed = new Set();
  const inputs = recorded ? recorded.map((input) => ({ ...input })) : [];
  const results = [];
  let vibrationCalls = 0;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: vibration ? { vibrate() { vibrationCalls++; return true; } } : {},
  });

  const visualNoise = () => {
    if (effects && !reducedMotion) for (let i = 0; i < 12; i++) Math.random();
  };
  const renderer = {
    w: 400, lineY: 400,
    clearTransients: visualNoise, triggerFlash: visualNoise,
    triggerVignette: visualNoise, triggerShake: visualNoise,
    triggerShockwave: visualNoise, triggerDeflect: visualNoise,
    addScorePopup: visualNoise,
  };
  const game = new Game({
    renderer,
    particles: effects ? new ParticlePool() : null,
    settings: { reducedMotion, vibrate: vibration },
    ui: {},
    random: () => { const value = random(); randomValues.push(value); return value; },
    onGameOver: (result) => results.push(result),
  });

  try {
    game.start('normal');
    let inputIndex = 0;
    for (let frame = 0; ; frame++) {
      const wall = Math.min(END, frame * 1000 / fps);
      // These are original event/receipt times, not the observing frame time.
      // Deliveries occur before the next frame, exactly as queued DOM events do.
      while (inputIndex < inputs.length && inputs[inputIndex].time + delay <= wall) {
        const input = inputs[inputIndex++];
        assert.equal(game.enqueueAction({ ...input, receivedAt: input.time + delay }), true);
      }
      game.update(wall);
      visualNoise();
      const attack = game.attack;
      if (attack && !observed.has(attack)) {
        observed.add(attack);
        attacks.push(attack);
        if (!recorded) inputs.push(...inputsFor(attack, attacks.length - 1));
      }
      if (wall === END) break;
      assert.equal(game.state, 'PLAYING', 'the replay reaches the multi-part tiers');
    }

    const snapshot = {
      state: game.state, time: game.gameTime,
      score: game.score, hp: game.hp, combo: game.combo,
      maxCombo: game.maxCombo, successCount: game.successCount,
      perfectCount: game.perfectCount, perfectStreak: game.perfectStreak,
      totalAttempts: game.totalAttempts, warmupRemaining: game.warmupRemaining,
      nextSpawnAt: game.nextSpawnAt, randomValues, results,
      attacks: attacks.map((attack) => ({
        dir: attack.dir, needDir: attack.needDir, spawnAt: attack.spawnAt,
        visibleMs: attack.visibleMs, taps: attack.taps,
        warmup: attack.warmup, hpLost: attack.hpLost,
        intervalMs: attack.intervalMs, segIndex: attack.segIndex,
        resolved: attack.resolved, resolvedAt: attack.resolvedAt,
        result: attack.result,
        segments: attack.segments.map((segment) => ({ ...segment })),
      })),
    };
    return { inputs, snapshot, vibrationCalls };
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
}

test('T02/T03: generated attacks and mixed input replay are invariant across FPS and delivery delay', () => {
  const reference = replay();
  const { snapshot, inputs } = reference;
  assert.ok(snapshot.attacks.some((attack) => attack.taps === 2), 'generated 2-part attacks');
  assert.ok(snapshot.attacks.some((attack) => attack.taps === 3), 'generated 3-part attacks');
  for (const result of ['PERFECT', 'GOOD', 'MISS']) {
    assert.ok(snapshot.attacks.some((attack) => attack.segments.some((seg) => seg.result === result)));
  }
  for (const fps of [30, 60, 120]) {
    for (const delay of [0, 16, 50]) {
      assert.deepEqual(replay({ fps, delay, recorded: inputs }).snapshot, snapshot,
        `${fps}fps / ${delay}ms delivery`);
    }
  }
});

test('T06: real particles, visual random consumption, reduced motion and vibration preserve the game replay', () => {
  const reference = replay();
  for (const reducedMotion of [false, true]) {
    for (const vibration of [false, true]) {
      const actual = replay({ fps: 120, delay: 50, recorded: reference.inputs,
        effects: true, reducedMotion, vibration });
      assert.deepEqual(actual.snapshot, reference.snapshot,
        `motion=${reducedMotion}, vibration=${vibration}`);
      assert.equal(actual.vibrationCalls > 0, vibration);
    }
  }
});
