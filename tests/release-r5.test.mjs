import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/js/game.js';
import { GameClock } from '../src/js/clock.js';
import { SessionController, SESSION_STATES } from '../src/js/session.js';
import { createRandom } from '../src/js/random.js';
import { setupInput } from '../src/js/input.js';
import { ParticlePool } from '../src/js/particles.js';

const VIRTUAL_PLAY_MS = 30 * 60 * 1000;
const FRAME_MS = 100;
const COUNTDOWN_MS = 2_100;
const RETRY_COUNT = 100;
const FIXED_GAME_SEED = 0x5205_0927;

class ListenerTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) this.listeners.delete(type);
  }

  activeListenerCount() {
    let count = 0;
    for (const handlers of this.listeners.values()) count += handlers.size;
    return count;
  }
}

function makeButton(dir) {
  const target = new ListenerTarget();
  target.getAttribute = (name) => name === 'data-dir' ? dir : null;
  target.classList = { add() {}, remove() {} };
  return target;
}

function installInputProbe(t) {
  const buttons = ['L', 'DL', 'D', 'DR', 'R'].map(makeButton);
  const windowTarget = new ListenerTarget();
  windowTarget.PointerEvent = class PointerEvent {};
  const documentTarget = new ListenerTarget();
  documentTarget.querySelectorAll = () => buttons;

  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowTarget,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentTarget,
  });

  const controls = setupInput({ onAction() {}, canHandleAction: () => true });
  const listenerCount = () => (
    windowTarget.activeListenerCount()
    + documentTarget.activeListenerCount()
    + buttons.reduce((sum, button) => sum + button.activeListenerCount(), 0)
  );
  const initialCount = listenerCount();
  assert.ok(initialCount > 0, 'input wiring registers listeners once');

  t.after(() => {
    controls.destroy();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete globalThis.window;
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else delete globalThis.document;
  });

  return { controls, initialCount, listenerCount };
}

function makeRenderer() {
  return {
    w: 800,
    lineY: 400,
    reducedMotion: true,
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

function makeHarness(t) {
  const input = installInputProbe(t);
  const particles = new ParticlePool();
  const clock = new GameClock({ timeOrigin: 0 });
  let wall = 0;
  let session;
  let gameOverCount = 0;
  const game = new Game({
    renderer: makeRenderer(),
    particles,
    settings: { reducedMotion: true, vibrate: false },
    ui: {},
    random: createRandom(FIXED_GAME_SEED),
    onGameOver: (result) => {
      gameOverCount += 1;
      assert.equal(session.finish(result, result.roundId), true);
    },
  });
  session = new SessionController({
    game,
    clock,
    input: input.controls,
    wallNow: () => wall,
    isVisible: () => true,
    isPortrait: () => true,
    isOperable: () => true,
    countdownStepMs: 700,
  });

  let lastAttack = null;
  let lastAttackId = 0;
  let maxQueueLength = 0;
  let maxSegmentLength = 0;
  let maxActiveParticles = 0;
  const scheduledSegments = new WeakMap();

  function observeResourceBounds() {
    maxQueueLength = Math.max(maxQueueLength, game._inputQueue.length);
    assert.ok(game._inputQueue.length <= 3, 'input queue stays bounded by one attack');
    if (game.attack) {
      const { attack } = game;
      maxSegmentLength = Math.max(maxSegmentLength, attack.segments.length);
      assert.ok(attack.segments.length <= 3, 'current attack has at most three segments');
      if (lastAttack && attack !== lastAttack) assert.ok(attack.id > lastAttackId);
      if (attack !== lastAttack) {
        lastAttack = attack;
        lastAttackId = attack.id;
      }
    }
    assert.equal(particles.pool.length, 220, 'particle pool does not grow');
    const activeParticles = particles.pool.reduce((count, particle) => count + (particle.active ? 1 : 0), 0);
    maxActiveParticles = Math.max(maxActiveParticles, activeParticles);
    assert.ok(activeParticles <= particles.pool.length, 'active particles stay inside the fixed pool');
  }

  function queueDueInputs() {
    const { attack } = game;
    if (!attack || attack.resolved) return;
    let scheduled = scheduledSegments.get(attack);
    if (!scheduled) {
      scheduled = new Set();
      scheduledSegments.set(attack, scheduled);
    }
    const now = clock.now(wall);
    attack.segments.forEach((segment, index) => {
      if (segment.resolved || scheduled.has(index) || segment.impactAt + 10 > now) return;
      assert.equal(game.enqueueAction({
        dir: attack.needDir,
        time: segment.impactAt,
        receivedAt: segment.impactAt + 10,
        roundId: game.roundId,
      }), true);
      scheduled.add(index);
    });
  }

  function frame(nextWall, { autoPlay = false } = {}) {
    wall = nextWall;
    const observed = session.observeFrame(wall);
    assert.equal(observed.stalled, false, 'virtual frames do not create a stall');
    session.tick(wall);
    if (session.state === SESSION_STATES.PLAYING) {
      if (autoPlay) queueDueInputs();
      game.update(clock.now(wall));
    }
    observeResourceBounds();
  }

  function advanceToPlaying() {
    assert.equal(session.start('normal', wall), true);
    const target = wall + COUNTDOWN_MS;
    while (wall < target) frame(Math.min(target, wall + FRAME_MS));
    assert.equal(session.state, SESSION_STATES.PLAYING);
    assert.equal(game.state, 'PLAYING');
  }

  function runVirtualPlay(durationMs, autoPlay) {
    const startGameTime = clock.now(wall);
    const targetGameTime = startGameTime + durationMs;
    while (clock.now(wall) < targetGameTime) {
      frame(wall + FRAME_MS, { autoPlay });
    }
    return clock.now(wall) - startGameTime;
  }

  function runUntilResult(maxFrames = 300) {
    for (let i = 0; i < maxFrames; i++) {
      if (session.state === SESSION_STATES.RESULT) return;
      frame(wall + FRAME_MS);
    }
    assert.fail(`round did not finish within ${maxFrames} virtual frames`);
  }

  function pauseAndResume() {
    // Pause while an attack is active so the retained attack and clock horizon
    // are both part of the lifecycle assertion.
    const attackTarget = wall + 600;
    while (wall < attackTarget) frame(Math.min(attackTarget, wall + FRAME_MS));
    const beforePause = harnessSnapshot();
    assert.equal(session.pause('manual', { wall }), true);
    assert.equal(game.state, 'PAUSED');
    const frozen = harnessSnapshot();
    assert.deepEqual(frozen, beforePause, 'manual pause does not alter game values');

    const pausedUntil = wall + 10_000;
    while (wall < pausedUntil) frame(Math.min(pausedUntil, wall + FRAME_MS));
    assert.deepEqual(harnessSnapshot(), frozen, 'stopped time does not advance the round');

    assert.equal(session.resume(wall), true);
    const resumedUntil = wall + COUNTDOWN_MS;
    while (wall < resumedUntil) frame(Math.min(resumedUntil, wall + FRAME_MS));
    assert.equal(session.state, SESSION_STATES.PLAYING);
    assert.equal(game.state, 'PLAYING');
    assert.deepEqual(harnessSnapshot(), frozen, 'resume countdown does not advance game time');
    assert.equal(session._countdown, null, 'completed resume has no stale countdown');
  }

  function harnessSnapshot() {
    return JSON.parse(JSON.stringify({
      time: game.gameTime,
      clock: clock.now(wall),
      hp: game.hp,
      score: game.score,
      combo: game.combo,
      success: game.successCount,
      nextSpawnAt: game.nextSpawnAt,
      attack: game.attack,
      inputQueue: game._inputQueue,
    }));
  }

  return {
    game,
    clock,
    input,
    particles,
    session,
    frame,
    advanceToPlaying,
    runVirtualPlay,
    runUntilResult,
    pauseAndResume,
    get wall() { return wall; },
    get gameOverCount() { return gameOverCount; },
    get maxQueueLength() { return maxQueueLength; },
    get maxSegmentLength() { return maxSegmentLength; },
    get maxActiveParticles() { return maxActiveParticles; },
  };
}

test('Q02: 仮想30分の連続プレイと100回の再挑戦で状態・資源が増殖しない', (t) => {
  const harness = makeHarness(t);
  const { game, input, particles, session } = harness;
  const initialListeners = input.initialCount;
  const initialPoolLength = particles.pool.length;

  harness.advanceToPlaying();
  const played = harness.runVirtualPlay(VIRTUAL_PLAY_MS, true);

  assert.equal(played, VIRTUAL_PLAY_MS, '30分相当のゲーム時刻を進めた');
  assert.equal(session.state, SESSION_STATES.PLAYING, '連続プレイ中に終了しない');
  assert.ok(game.successCount > 0, '自動入力がゲームを継続させた');
  assert.equal(game._inputQueue.length, 0, '連続プレイ終了時に入力キューが滞留しない');
  assert.equal(input.listenerCount(), initialListeners, '連続プレイで入力リスナーが増えない');
  assert.equal(particles.pool.length, initialPoolLength, '連続プレイで粒子配列が増えない');

  assert.equal(session.home(harness.wall), true);
  assert.equal(session.state, SESSION_STATES.HOME);
  assert.equal(game.state, 'IDLE');
  assert.equal(game.attack, null);
  assert.equal(game._inputQueue.length, 0);

  for (let retry = 0; retry < RETRY_COUNT; retry++) {
    harness.advanceToPlaying();
    harness.pauseAndResume();
    harness.runUntilResult();

    assert.equal(session.state, SESSION_STATES.RESULT, `retry ${retry + 1} reaches result`);
    assert.equal(game.state, 'OVER', `retry ${retry + 1} stops the game`);
    assert.equal(game.attack, null, `retry ${retry + 1} releases the current attack`);
    assert.equal(game._inputQueue.length, 0, `retry ${retry + 1} clears input queue`);
    assert.equal(session._countdown, null, `retry ${retry + 1} leaves no countdown`);
    assert.equal(input.listenerCount(), initialListeners, `retry ${retry + 1} keeps listener count stable`);
    assert.equal(particles.pool.length, initialPoolLength, `retry ${retry + 1} keeps particle pool stable`);
  }

  assert.equal(harness.gameOverCount, RETRY_COUNT, '100回の再挑戦で結果通知は各1回');
  assert.ok(harness.maxQueueLength <= 3);
  assert.equal(harness.maxSegmentLength, 3, '攻撃の分割配列は最大3要素');
  assert.ok(harness.maxActiveParticles <= initialPoolLength);
  assert.equal(input.listenerCount(), initialListeners);

  // setupInput の破棄で登録が残らないことも同じ検査で確認する。
  input.controls.destroy();
  assert.equal(input.listenerCount(), 0, '入力配線の破棄後にリスナーが残らない');
});
