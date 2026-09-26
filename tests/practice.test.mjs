import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, PRACTICE_DIRECTIONS } from '../src/js/game.js';
import { GameClock } from '../src/js/clock.js';
import { SessionController } from '../src/js/session.js';

function harness() {
  let wall = 1000;
  let visible = true;
  let completed = 0;
  const results = [];
  const guides = [];
  const judges = [];
  const clock = new GameClock();
  let session;
  const game = new Game({ settings: { vibrate: false }, random: () => 0.25,
    ui: { setPracticeGuide: (data) => guides.push(data),
      popJudge: (...data) => judges.push(data) },
    onGameOver: (data) => session.finish(data, data.roundId) });
  session = new SessionController({ game, clock, wallNow: () => wall,
    isVisible: () => visible, onPracticeComplete: () => completed++,
    onResult: (data) => results.push(data) });
  const advance = (ms) => {
    const end = wall + ms;
    while (wall < end) {
      wall = Math.min(end, wall + 16);
      const observed = session.observeFrame(wall);
      if (!observed.stalled) {
        session.tick(wall);
        if (session.canHandleAction()) game.update(clock.now(wall));
      }
    }
  };
  const spawn = () => {
    advance(Math.max(0, game.nextSpawnAt - clock.now(wall)) + 16);
    assert.ok(game.attack && !game.attack.resolved);
    return game.attack;
  };
  const resolve = (kind = 'PERFECT') => {
    const a = spawn();
    const time = a.segments[0].impactAt + (kind === 'GOOD' ? 100 : 0);
    if (kind !== 'timeout') {
      advance(time - clock.now(wall));
      game.enqueueAction({ dir: kind === 'wrong' ? (a.needDir === 'L' ? 'R' : 'L') : a.needDir,
        time, receivedAt: time });
      advance(64);
    } else advance(time + 240 - clock.now(wall));
    return a;
  };
  return { game, session, clock, results, guides, judges, advance, resolve,
    get wall() { return wall; }, get completed() { return completed; },
    setVisible(value) { visible = value; } };
}

function assertClean(game) {
  for (const key of ['score', 'combo', 'maxCombo', 'successCount', 'perfectCount', 'perfectStreak', 'totalAttempts']) {
    assert.equal(game[key], 0, `practice must not affect ${key}`);
  }
  assert.equal(game.hp, 3);
}

test('G01/G02: every missed practice repeats; five distinct successes are required and never enter normal stats', () => {
  const h = harness();
  h.session.navigate('HOWTO', h.wall);
  h.session.start('practice', h.wall);
  for (let i = 0; i < 7; i++) {
    assert.equal(h.resolve(i % 2 ? 'wrong' : 'timeout').dir, 'L');
    assert.equal(h.game.warmupRemaining, 5);
    assertClean(h.game);
    assert.equal(h.completed, 0);
  }
  for (const [index, dir] of PRACTICE_DIRECTIONS.entries()) {
    assert.equal(h.resolve('wrong').dir, dir);
    assert.equal(h.game.warmupRemaining, 5 - index);
    assert.equal(h.resolve(index % 2 ? 'GOOD' : 'PERFECT').dir, dir);
    assert.equal(h.game.warmupRemaining, 4 - index);
    assertClean(h.game);
    assert.equal(h.guides.at(-1).step, index + 1);
  }
  assert.equal(h.session.state, 'PRACTICE_COMPLETE');
  assert.equal(h.completed, 1);
  assert.equal(h.results.length, 0);
  h.advance(10_000);
  assert.equal(h.session.state, 'PRACTICE_COMPLETE', 'optional practice never auto-starts');
});

test('G02/G03: first-use completion enters a fresh countdown and normal death without success has zero aggregates', () => {
  const h = harness();
  h.session.start('practice', h.wall, { tutorial: true });
  const practiceRound = h.game.roundId;
  for (let i = 0; i < 5; i++) h.resolve();
  assert.equal(h.session.state, 'COUNTDOWN');
  assert.equal(h.completed, 1);
  assertClean(h.game);
  assert.equal(h.session.finish({ practiceDone: true }, practiceRound), false);
  h.advance(2200);
  assert.equal(h.session.state, 'PLAYING');
  assert.equal(h.game.warmupRemaining, 0, 'no second warmup');
  assertClean(h.game);
  for (let i = 0; i < 3; i++) assert.equal(h.resolve('timeout').warmup, false);
  assert.equal(h.session.state, 'RESULT');
  assert.equal(h.results.length, 1);
  assert.deepEqual([h.results[0].score, h.results[0].maxCombo, h.results[0].perfectRate], [0, 0, 0]);
  assert.equal(h.game.perfectStreak, 0);
  assert.equal(h.game.totalAttempts, 3);
  h.session.start('normal', h.wall);
  assert.equal(h.session.state, 'COUNTDOWN');
  h.advance(2200);
  assert.equal(h.game.warmupRemaining, 0);
});

test('G01/S05: Home aborts practice and invalidates its completion and queued inputs', () => {
  const h = harness();
  h.session.start('practice', h.wall, { tutorial: true });
  h.resolve();
  const round = h.game.roundId;
  h.session.home(h.wall);
  h.advance(5000);
  assert.equal(h.session.finish({ practiceDone: true }, round), false);
  assert.equal(h.completed, 0);
  assert.equal(h.session.state, 'HOME');
  h.session.start('practice', h.wall, { tutorial: true });
  assert.equal(h.game.warmupRemaining, 5);
  assert.equal(h.resolve().dir, 'L');
  assert.equal(h.session.finish({ practiceDone: true }, round), false);
});

test('G03/S02: practice pause preserves tutorial destination; interrupted normal countdown cannot start while hidden', () => {
  const h = harness();
  h.session.start('practice', h.wall, { tutorial: true });
  h.resolve();
  h.session.pause('manual', { wall: h.wall });
  assert.equal(h.session.start('normal', h.wall), false, 'practice pause cannot bypass tutorial');
  h.advance(3000);
  assert.equal(h.game.warmupRemaining, 4);
  h.session.resume(h.wall);
  h.advance(2200);
  for (let i = 0; i < 4; i++) h.resolve();
  assert.equal(h.session.state, 'COUNTDOWN');
  h.setVisible(false);
  h.session.handleVisibility(true, h.wall);
  h.advance(5000);
  assert.equal(h.session.state, 'PAUSED');
  assert.equal(h.game.roundId, 1);
  h.setVisible(true);
  h.advance(1000);
  assert.equal(h.session.state, 'PAUSED');
  h.session.resume(h.wall);
  h.advance(2200);
  assert.equal(h.session.state, 'PLAYING');
  assert.equal(h.game.roundId, 2);
  assertClean(h.game);
});

test('G03: optional practice can be repeated from its completion screen without creating a normal result', () => {
  const h = harness();
  h.session.navigate('HOWTO', h.wall);
  for (let run = 0; run < 2; run++) {
    assert.equal(h.session.start('practice', h.wall), true);
    for (let i = 0; i < 5; i++) h.resolve();
    assert.equal(h.session.state, 'PRACTICE_COMPLETE');
  }
  assert.equal(h.completed, 2);
  assert.equal(h.results.length, 0);
});
