// R2 の画面・試合・停止復帰を SessionController 実体で検査する。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_STATES,
  SessionController,
} from '../src/js/session.js';
import { Game } from '../src/js/game.js';
import { GameClock } from '../src/js/clock.js';

function makeHarness({ visible = true, portrait = true, operable = true } = {}) {
  const calls = {
    gameStart: [],
    gamePause: [],
    gameResume: 0,
    gameStop: 0,
    gameClearInputs: 0,
    clockStart: [],
    clockPause: [],
    clockResume: [],
    clearPressed: 0,
    states: [],
    countdown: [],
    invalidations: [],
  };
  let gameQueue = [];
  const game = {
    state: 'IDLE',
    roundId: 0,
    started: false,
    get queue() { return gameQueue; },
    set queue(value) { gameQueue = value; },
    start(mode) {
      this.started = true;
      this.state = 'PLAYING';
      this.roundId += 1;
      calls.gameStart.push(mode);
    },
    pause(options) {
      this.state = 'PAUSED';
      calls.gamePause.push(options);
      return true;
    },
    resume() {
      if (!this.started) return false;
      this.state = 'PLAYING';
      calls.gameResume++;
      return true;
    },
    stop() {
      this.state = 'IDLE';
      this.started = false;
      this.gameQueue = [];
      calls.gameStop++;
      return true;
    },
    clearInputs() {
      gameQueue = [];
      calls.gameClearInputs++;
    },
  };
  const clock = {
    running: false,
    start(wall) { this.running = true; calls.clockStart.push(wall); },
    pause(wall) { this.running = false; calls.clockPause.push(wall); },
    resume(wall) { this.running = true; calls.clockResume.push(wall); },
  };
  const input = { clearPressed() { calls.clearPressed++; } };
  const session = new SessionController({
    game,
    clock,
    input,
    isVisible: () => visible,
    isPortrait: () => portrait,
    isOperable: () => operable,
    onStateChange: (state) => calls.states.push(state),
    onCountdown: (value) => calls.countdown.push(value),
    onInvalidate: (value) => calls.invalidations.push(value),
    countdownStepMs: 100,
  });
  return { session, game, clock, calls };
}

function activateNormal(harness, startWall = 0) {
  const { session } = harness;
  assert.equal(session.start('normal', startWall), true);
  assert.equal(session.state, SESSION_STATES.COUNTDOWN);
  assert.equal(session.tick(startWall + 300), true);
  assert.equal(session.state, SESSION_STATES.PLAYING);
}

function makeRealGame() {
  const ui = {
    showBanner() {},
    hideBanner() {},
    updateHUD() {},
    popJudge() {},
    bumpCombo() {},
  };
  const renderer = {
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
  const particles = { clear() {}, update() {}, spawnBurst() {} };
  const game = new Game({
    renderer,
    particles,
    settings: { reducedMotion: false, vibrate: false },
    ui,
    random: () => 0.25,
  });
  return game;
}

function installRealAttack(game, impactAt = 1_000) {
  game.mode = 'normal';
  game.state = 'PLAYING';
  game.warmupRemaining = 0;
  game.hp = 3;
  game.nextSpawnAt = Number.POSITIVE_INFINITY;
  game.attack = {
    id: 'session-stall-fixture',
    dir: 'L',
    needDir: 'R',
    spawnAt: 0,
    visibleMs: impactAt,
    taps: 1,
    segments: [{ impactAt, resolved: false, result: null }],
    segIndex: 0,
    hpLost: false,
    warmup: false,
    resolved: false,
    resolvedAt: 0,
    result: null,
  };
}

function makeRealSession() {
  const game = makeRealGame();
  const clock = new GameClock({ timeOrigin: 0 });
  let visible = true;
  const session = new SessionController({
    game,
    clock,
    input: { clearPressed() {} },
    isVisible: () => visible,
    isPortrait: () => true,
    isOperable: () => true,
    countdownStepMs: 100,
  });
  assert.equal(session.start('normal', 0), true);
  assert.equal(session.tick(300), true);
  assert.equal(session.state, SESSION_STATES.PLAYING);
  // The main loop presents a frame before any game update.
  session.observeFrame(300);
  session.observeFrame(400);
  game.update(clock.now(400));
  return { game, clock, session, setVisible(value) { visible = value; } };
}

test('S01: pausing the initial countdown and resuming starts the game once', () => {
  const harness = makeHarness();
  const { session, game, calls } = harness;

  assert.equal(session.start('normal', 0), true);
  assert.equal(session.state, SESSION_STATES.COUNTDOWN);
  assert.equal(session.pause('hidden', { wall: 40, discardInputs: true }), true);
  assert.equal(session.state, SESSION_STATES.PAUSED);
  assert.equal(calls.gameStart.length, 0, 'initial countdown has not started Game');

  assert.equal(session.resume(100), true);
  assert.equal(session.state, SESSION_STATES.RESUME_COUNTDOWN);
  assert.equal(session.tick(400), true);
  assert.equal(session.state, SESSION_STATES.PLAYING);
  assert.equal(calls.gameStart.length, 1, 'resume after initial countdown calls Game.start once');
  assert.equal(calls.gameResume, 0, 'initial countdown does not call Game.resume on an unstarted game');
  assert.equal(game.started, true);
});

test('S02: ordinary pause freezes and retains pending Game inputs', () => {
  const harness = makeHarness();
  const { session, game, calls } = harness;
  activateNormal(harness);
  // The real rAF loop updates this on every presented frame. Keep the
  // manual-pause sample on the current frame so it is not mistaken for a
  // long-gap stop.
  session.lastPresentedWall = 400;
  game.queue = [{ time: 100, dir: 'R' }];

  assert.equal(session.pause('manual', { wall: 400 }), true);
  assert.equal(session.state, SESSION_STATES.PAUSED);
  assert.equal(calls.gamePause.at(-1)?.discardInputs, false);
  assert.equal(calls.clockPause.at(-1), 400);
  assert.equal(game.queue.length, 1, 'ordinary pause retains pending input');

  assert.equal(session.resume(500), true);
  assert.equal(session.state, SESSION_STATES.RESUME_COUNTDOWN);
  assert.equal(session.tick(800), true);
  assert.equal(session.state, SESSION_STATES.PLAYING);
  assert.equal(calls.gameResume, 1);
  assert.equal(calls.clockResume.at(-1), 800);
});

test('S03: repeated resume and pause during resume countdown leave one active transition', () => {
  const harness = makeHarness();
  const { session, calls } = harness;
  activateNormal(harness);
  session.lastPresentedWall = 400;
  assert.equal(session.pause('manual', { wall: 400 }), true);
  assert.equal(session.resume(500), true);
  assert.equal(session.resume(550), false, 'second resume cannot create another countdown');
  assert.equal(session.pause('hidden', { wall: 600, discardInputs: true }), true);
  assert.equal(session.state, SESSION_STATES.PAUSED);
  assert.equal(session.resume(700), true);
  const completedBefore = calls.countdown.filter((value) => value === 0).length;
  assert.equal(session.tick(1_000), true);
  assert.equal(session.state, SESSION_STATES.PLAYING);
  assert.equal(calls.gameStart.length, 1);
  assert.equal(calls.gameResume, 1, 'resume countdown activates exactly once');
  assert.equal(
    calls.countdown.filter((value) => value === 0).length,
    completedBefore + 1,
    'resume countdown activates exactly once',
  );
});

test('T05/S02: a long frame gap stalls at the last presented wall time and discards input', () => {
  const harness = makeHarness();
  const { session, game, calls } = harness;
  activateNormal(harness);
  game.queue = [{ time: 100, dir: 'R' }];
  session.observeFrame(0);
  session.observeFrame(100);
  const result = session.observeFrame(351);

  assert.equal(result.stalled, true);
  assert.equal(session.state, SESSION_STATES.PAUSED);
  assert.equal(session.pauseReason, 'stall');
  assert.equal(calls.gamePause.at(-1)?.discardInputs, true);
  assert.equal(calls.clockPause.at(-1), 100, 'clock freezes at last presented wall time');
  assert.equal(game.queue.length, 0, 'stall discards pending input');
});

test('T05: real Game + GameClock + Session stall without advancing judgment or spawn', () => {
  const { game, clock, session } = makeRealSession();
  installRealAttack(game, 1_000);
  assert.equal(game.enqueueAction({
    dir: 'R',
    time: 900,
    receivedAt: 900,
    roundId: game.roundId,
  }), true);

  // The last presented frame is wall=400, game time=100. A 251ms gap must
  // freeze at that frame, before Game.update sees a later horizon.
  const observed = session.observeFrame(651);
  assert.equal(observed.stalled, true);
  assert.equal(session.state, SESSION_STATES.PAUSED);
  assert.equal(clock.now(2_000), 100, 'clock remains at the last presented game time');
  assert.equal(game.gameTime, 100, 'Game did not fast-forward through the gap');
  assert.equal(game.hp, 3, 'no timeout or miss was processed during the gap');
  assert.equal(game.attack.resolved, false, 'attack remains pending');
  assert.equal(game._inputQueue.length, 0, 'long stall discarded the pending queue');
});

test('S01/T05: hidden notification before the delayed rAF also freezes at the last frame', () => {
  const { game, clock, session } = makeRealSession();
  installRealAttack(game, 1_000);
  assert.equal(game.enqueueAction({
    dir: 'R',
    time: 900,
    receivedAt: 900,
    roundId: game.roundId,
  }), true);

  // Visibility can arrive before the rAF that would have observed the gap.
  assert.equal(session.handleVisibility(true, 651), true);
  assert.equal(session.state, SESSION_STATES.PAUSED);
  assert.equal(clock.now(2_000), 100, 'hidden path freezes at the last frame');
  assert.equal(game.gameTime, 100, 'hidden path does not fast-forward Game');
  assert.equal(game.hp, 3);
  assert.equal(game.attack.resolved, false);
  assert.equal(game._inputQueue.length, 0, 'hidden long-gap path discards pending queue');
});

test('S01/S04/S05: hidden, pagehide, and rotation after a long gap all freeze at the last frame', () => {
  const cases = [
    ['hidden', (session, wall) => session.handleVisibility(true, wall)],
    ['pagehide', (session, wall) => session.handlePageHide(wall)],
    ['orientation', (session, wall) => session.handleOrientation(false, wall)],
  ];
  for (const [reason, trigger] of cases) {
    const harness = makeHarness();
    const { session, game, calls } = harness;
    activateNormal(harness);
    game.queue = [{ time: 100, dir: 'R' }];
    session.observeFrame(0);
    session.observeFrame(100);
    assert.equal(trigger(session, 351), true, `${reason} pauses`);
    assert.equal(session.state, SESSION_STATES.PAUSED, `${reason} state`);
    assert.equal(session.pauseReason, reason, `${reason} reason`);
    assert.equal(calls.gamePause.at(-1)?.discardInputs, true, `${reason} discards input`);
    assert.equal(calls.clockPause.at(-1), 100, `${reason} freezes at last frame`);
    assert.equal(game.queue.length, 0, `${reason} queue cleared`);
  }
});

test('S02: each playing frame rechecks visibility/orientation before allowing game work', () => {
  let visible = true;
  const harness = makeHarness();
  const { session, game } = harness;
  // Replace the harness visibility closure with a mutable source for this case.
  // The controller calls the supplied predicate on every tick.
  const guarded = new SessionController({
    game,
    clock: harness.clock,
    input: { clearPressed() {} },
    isVisible: () => visible,
    isPortrait: () => true,
    isOperable: () => true,
    countdownStepMs: 100,
  });
  assert.equal(guarded.start('normal', 0), true);
  assert.equal(guarded.tick(300), true);
  assert.equal(guarded.state, SESSION_STATES.PLAYING);
  visible = false;
  guarded.tick(350);
  assert.equal(guarded.state, SESSION_STATES.PAUSED, 'playing tick pauses after environment loss');
  assert.equal(game.state, 'PAUSED');
});

test('S05/S06: stale result callbacks cannot resurrect a stopped or replaced match', () => {
  const results = [];
  const harness = makeHarness();
  const { session, game } = harness;
  const guarded = new SessionController({
    game,
    clock: harness.clock,
    input: { clearPressed() {} },
    onResult: (result) => results.push(result),
    countdownStepMs: 100,
  });
  assert.equal(guarded.start('normal', 0), true);
  assert.equal(guarded.tick(300), true);
  const oldRound = guarded.roundId;
  assert.equal(guarded.home(350), true);
  assert.equal(guarded.finish({ score: 999 }, oldRound), false);
  assert.equal(results.length, 0);
  assert.equal(guarded.start('normal', 500), true);
  assert.equal(guarded.tick(800), true);
  assert.equal(guarded.finish({ score: 10 }, oldRound), false);
  assert.equal(guarded.state, SESSION_STATES.PLAYING);
  assert.equal(results.length, 0);
});
