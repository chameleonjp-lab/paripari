import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/js/game.js';
import { GameClock } from '../src/js/clock.js';
import { SessionController } from '../src/js/session.js';

function harness() {
  let wall = 1000;
  let visible = true;
  let randomCalls = 0;
  const clock = new GameClock();
  const counts = [];
  const results = [];
  let session;
  const game = new Game({ ui: {}, settings: { vibrate: false },
    random: () => { randomCalls++; return 0.25; },
    onGameOver: (data) => session.finish(data, data.roundId) });
  session = new SessionController({ game, clock, wallNow: () => wall,
    isVisible: () => visible,
    onCountdown: (value) => counts.push(value),
    onResult: (data) => results.push(data) });
  function frame(at) {
    wall = at;
    const observed = session.observeFrame(wall);
    if (!observed.stalled) {
      session.tick(wall);
      if (session.canHandleAction()) game.update(clock.now(wall));
    }
    return observed;
  }
  function advance(to) {
    while (wall < to) frame(Math.min(to, wall + 100));
  }
  function snapshot() {
    return JSON.parse(JSON.stringify({
      time: game.gameTime, clock: clock.now(wall), hp: game.hp,
      score: game.score, combo: game.combo, success: game.successCount,
      nextSpawnAt: game.nextSpawnAt, attack: game.attack, randomCalls,
    }));
  }
  return { game, clock, session, counts, results, frame, advance, snapshot,
    get wall() { return wall; },
    setVisible(value) { visible = value; } };
}

function start(h, mode = 'normal') {
  if (mode === 'practice') h.session.navigate('HOWTO', h.wall);
  assert.equal(h.session.start(mode, h.wall), true);
  if (mode === 'normal') h.advance(h.wall + 2100);
  assert.equal(h.game.state, 'PLAYING');
}

function attackFixture(game, impacts = [200]) {
  game.nextSpawnAt = Infinity;
  game.warmupRemaining = game.mode === 'practice' ? 5 : 0;
  game.attack = { id: 'pause-fixture', dir: 'L', needDir: 'R', spawnAt: 0,
    visibleMs: impacts[0], taps: impacts.length, segIndex: 0,
    resolved: false, hpLost: false, warmup: game.mode === 'practice',
    segments: impacts.map((impactAt) => ({ impactAt, resolved: false, result: null })) };
}

test('S01: hiding at each of 3/2/1 freezes the initial countdown and requires explicit resume', () => {
  for (const elapsed of [350, 1050, 1750]) {
    const h = harness();
    h.session.start('normal', h.wall);
    h.advance(h.wall + elapsed);
    assert.equal(h.counts.at(-1), 3 - Math.floor(elapsed / 700));
    h.setVisible(false);
    h.session.handleVisibility(true, h.wall);
    h.advance(h.wall + 5000);
    assert.equal(h.game.roundId, 0, 'hidden countdown never starts the game');
    h.setVisible(true);
    h.frame(h.wall + 16);
    assert.equal(h.session.state, 'PAUSED', 'returning alone does not resume');
    assert.equal(h.session.resume(h.wall), true);
    h.advance(h.wall + 2000);
    assert.equal(h.game.roundId, 0, 'fresh countdown has not finished');
    h.advance(h.wall + 100);
    assert.equal(h.game.roundId, 1);
    assert.equal(h.session.state, 'PLAYING');
    assert.equal(h.clock.now(h.wall), 0);
  }
});

test('S02/S03: actual game, clock, pending input and split attacks survive pause and repeated resume countdown', () => {
  for (const scenario of ['normal', 'practice', 'split', 'input-pending', 'timeout-pending']) {
    const h = harness();
    start(h, scenario === 'practice' ? 'practice' : 'normal');
    attackFixture(h.game, scenario === 'split' ? [200, 400] : [200]);
    const startWall = h.wall;
    if (scenario === 'split') {
      h.advance(startWall + 200);
      h.game.enqueueAction({ dir: 'R', time: 200, receivedAt: 200 });
      h.advance(startWall + 275);
      assert.equal(h.game.attack.segIndex, 1);
    } else if (scenario === 'input-pending') {
      h.advance(startWall + 205);
      h.game.enqueueAction({ dir: 'R', time: 190, receivedAt: 205 });
    } else {
      h.advance(startWall + (scenario === 'timeout-pending' ? 360 : 100));
    }
    assert.equal(h.session.pause('manual', { wall: h.wall }), true);
    const frozen = h.snapshot();
    const round = h.game.roundId;
    h.advance(h.wall + 10_000);
    assert.deepEqual(h.snapshot(), frozen, `${scenario}: stopped time`);
    assert.equal(h.clock.mapInput(h.wall, h.wall), null);
    h.session.resume(h.wall);
    assert.equal(h.session.resume(h.wall), false, 'duplicate resume is ignored');
    h.advance(h.wall + 800);
    h.session.handlePageHide(h.wall);
    assert.equal(h.session.state, 'PAUSED');
    assert.deepEqual(h.snapshot(), frozen, `${scenario}: interrupted resume countdown`);
    h.session.resume(h.wall);
    h.advance(h.wall + 2100);
    assert.equal(h.game.roundId, round, 'resume preserves the current match');
    assert.deepEqual(h.snapshot(), frozen, `${scenario}: completed resume countdown`);
    h.frame(h.wall + 51);
    if (scenario === 'input-pending') {
      assert.equal(h.game.attack.segments[0].result, 'PERFECT');
      assert.equal(h.game.successCount, 1);
    }
    if (scenario === 'timeout-pending') {
      assert.equal(h.game.attack.segments[0].result, 'MISS');
      assert.equal(h.game.hp, frozen.hp - 1);
    }
    assert.equal(h.results.length, 0);
  }
});

test('T05: 250ms advances the complete interval; 250ms plus epsilon freezes before any input or timeout', () => {
  for (const gap of [80, 250, 250.001]) {
    const h = harness();
    start(h);
    attackFixture(h.game, [100]);
    h.game.enqueueAction({ dir: 'R', time: 20, receivedAt: 20 });
    const before = h.snapshot();
    const frame = h.frame(h.wall + gap);
    if (gap <= 250) {
      assert.equal(frame.stalled, false);
      assert.equal(h.game.gameTime, gap, 'normal frames do not cap elapsed time');
      assert.equal(h.game.attack.segments[0].result, 'GOOD');
    } else {
      assert.equal(frame.stalled, true);
      assert.equal(h.session.state, 'PAUSED');
      assert.deepEqual(h.snapshot(), before, 'freeze at the last presented frame');
      h.session.resume(h.wall);
      h.advance(h.wall + 2100);
      h.advance(h.wall + 100);
      assert.equal(h.game.attack.segments[0].resolved, false, 'discarded input is not revived');
      assert.equal(h.game.score, 0);
    }
  }
});
