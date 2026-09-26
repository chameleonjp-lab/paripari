import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, tierForSuccess } from '../src/js/config.js';
import { Game } from '../src/js/game.js';
import { createAttack, nextInterval } from '../src/js/enemy.js';
import { createRandom } from '../src/js/random.js';

const SUCCESS_BOUNDARIES = [0, 3, 6, 9, 12, 16, 20, 24, 28, 32, 36, 41, 46, 51, 56, 62, 68, 74, 81, 88];
const FIRST_TWO_TAP_TIER = 7;
const FIRST_THREE_TAP_TIER = 13;
const SERIES_COUNT = 1000;
const SERIES_SEED_BASE = 0x52040000;
const SERIES_DURATION_MS = 120_000;
const MAX_SAFE_VISIBLE_MS = 2_000;
const MAX_SAFE_INTERVAL_MS = 2_000;

function tierIndex(tier) {
  return CONFIG.TIERS.indexOf(tier);
}

function drivePerfectAttack(game) {
  const attack = game.attack;
  assert.ok(attack && !attack.resolved, 'expected a live generated attack');
  for (const segment of attack.segments) {
    assert.equal(game.enqueueAction({
      dir: attack.needDir,
      time: segment.impactAt,
      receivedAt: segment.impactAt,
    }), true);
  }
  const resolveAt = attack.segments.at(-1).impactAt + 51;
  game.update(resolveAt);
  return attack;
}

function runFixedSeedSeries(seed, durationMs = SERIES_DURATION_MS, { initialHp = CONFIG.MAX_HP } = {}) {
  const game = new Game({
    settings: { vibrate: false },
    random: createRandom(seed),
    ui: {},
  });
  game.start('normal');
  game.hp = initialHp;

  const attacks = [];
  const firstTapAt = { 2: null, 3: null };
  let recoveryCount = 0;
  let missCount = 0;
  while (game.state === 'PLAYING' && game.gameTime < durationMs) {
    const spawnAt = Math.max(game.gameTime, game.nextSpawnAt);
    if (spawnAt >= durationMs) break;
    game.update(spawnAt);
    const attack = game.attack;
    assert.ok(attack && !attack.resolved, `seed ${seed}: spawn at ${spawnAt}`);

    const tier = tierForSuccess(game.successCount);
    const tierNumber = tierIndex(tier) + 1;
    attacks.push({ tier: tierNumber, taps: attack.taps, spawnAt: attack.spawnAt });
    if (attack.taps > 1 && firstTapAt[attack.taps] === null) {
      firstTapAt[attack.taps] = attack.spawnAt;
    }

    const lastImpact = attack.segments.at(-1).impactAt;
    if (lastImpact + 51 > durationMs) break;
    const hpBefore = game.hp;
    drivePerfectAttack(game);
    const outcome = {
      recoveries: game.hp > hpBefore ? game.hp - hpBefore : 0,
      misses: 0,
    };
    recoveryCount += outcome.recoveries;
    missCount += outcome.misses;
  }

  return {
    seed: seed >>> 0,
    firstTwoTapAtMs: firstTapAt[2],
    firstThreeTapAtMs: firstTapAt[3],
    maxTier: Math.max(0, ...attacks.map((attack) => attack.tier)),
    attacks,
    score: game.score,
    successes: game.successCount,
    attempts: game.totalAttempts,
    maxCombo: game.maxCombo,
    finalHp: game.hp,
    recoveryCount,
    missCount,
    endedByGameOver: game.state === 'OVER',
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function distribution(values) {
  return {
    observed: values.length,
    p10: percentile(values, 0.10),
    median: percentile(values, 0.50),
    p90: percentile(values, 0.90),
  };
}

function timeDistributionMs(values) {
  const result = distribution(values);
  return {
    observed: result.observed,
    p10Seconds: result.p10 === null ? null : result.p10 / 1000,
    medianSeconds: result.median === null ? null : result.median / 1000,
    p90Seconds: result.p90 === null ? null : result.p90 / 1000,
  };
}

/** Fixed-seed balance report data; timing quantiles are observations, not pass targets. */
export function collectDifficultySeriesReport({
  count = SERIES_COUNT,
  seedBase = SERIES_SEED_BASE,
  durationMs = SERIES_DURATION_MS,
} = {}) {
  const tierDistribution = Array.from({ length: CONFIG.TIERS.length }, (_, index) => ({
    tier: index + 1,
    attacks: 0,
    taps: { 1: 0, 2: 0, 3: 0 },
  }));
  const reachedTier = Array(CONFIG.TIERS.length).fill(0);
  const allTapCounts = { 1: 0, 2: 0, 3: 0 };
  const firstTwoTapTimes = [];
  const firstThreeTapTimes = [];
  const attackCounts = [];
  const scores = [];
  const successes = [];
  const recoveryCounts = [];
  const recoveryProbeCounts = [];
  const maxCombos = [];
  const finalHpCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let totalAttempts = 0;
  let totalMisses = 0;
  let endedByGameOver = 0;

  for (let index = 0; index < count; index++) {
    const series = runFixedSeedSeries((seedBase + index) >>> 0, durationMs);
    const recoveryProbe = runFixedSeedSeries((seedBase + index) >>> 0, durationMs, { initialHp: 1 });
    if (series.firstTwoTapAtMs !== null) firstTwoTapTimes.push(series.firstTwoTapAtMs);
    if (series.firstThreeTapAtMs !== null) firstThreeTapTimes.push(series.firstThreeTapAtMs);
    attackCounts.push(series.attacks.length);
    for (let tierIndex = 0; tierIndex < series.maxTier; tierIndex++) reachedTier[tierIndex]++;
    scores.push(series.score);
    successes.push(series.successes);
    recoveryCounts.push(series.recoveryCount);
    recoveryProbeCounts.push(recoveryProbe.recoveryCount);
    maxCombos.push(series.maxCombo);
    finalHpCounts[series.finalHp]++;
    totalAttempts += series.attempts;
    totalMisses += series.missCount;
    if (series.endedByGameOver) endedByGameOver++;
    for (const attack of series.attacks) {
      const tier = tierDistribution[attack.tier - 1];
      tier.attacks++;
      tier.taps[attack.taps]++;
      allTapCounts[attack.taps]++;
    }
  }

  return {
    count,
    seedBase: seedBase >>> 0,
    durationSeconds: durationMs / 1000,
    firstTwoTap: timeDistributionMs(firstTwoTapTimes),
    firstThreeTap: timeDistributionMs(firstThreeTapTimes),
    attacksPerSeries: distribution(attackCounts),
    reachedTierSeries: reachedTier.map((series, index) => ({ tier: index + 1, series })),
    totalAttacksByTapCount: allTapCounts,
    attacksByTier: tierDistribution,
    scores: distribution(scores),
    successes: distribution(successes),
    maxCombo: distribution(maxCombos),
    recoveriesPerSeries: distribution(recoveryCounts),
    recoveryProbeFromHpOnePerSeries: distribution(recoveryProbeCounts),
    finalHpSeries: finalHpCounts,
    segmentAccuracy: totalAttempts > 0 ? (totalAttempts - totalMisses) / totalAttempts : 0,
    totalAttempts,
    totalMisses,
    endedByGameOver,
  };
}

test('G06: the 20 explicit success boundaries are inclusive and tier selection never retreats', () => {
  assert.deepEqual(CONFIG.TIERS.map((tier) => tier.successAt), SUCCESS_BOUNDARIES);
  for (let index = 0; index < CONFIG.TIERS.length; index++) {
    const boundary = SUCCESS_BOUNDARIES[index];
    assert.equal(tierForSuccess(boundary), CONFIG.TIERS[index], `tier ${index + 1} begins at ${boundary}`);
    if (index > 0) {
      assert.equal(tierForSuccess(boundary - 1), CONFIG.TIERS[index - 1], `before tier ${index + 1}`);
    }
  }

  let previous = -1;
  for (let successes = 0; successes <= SUCCESS_BOUNDARIES.at(-1) + 500; successes++) {
    const current = tierIndex(tierForSuccess(successes));
    assert.ok(current >= previous, `tier retreated at success ${successes}`);
    previous = current;
  }
});

test('G06: every tier stays within safe timing bounds and speed jitter is monotonic', () => {
  let previousJitter = -1;
  for (const [index, tier] of CONFIG.TIERS.entries()) {
    assert.ok(Number.isFinite(tier.visibleMs) && tier.visibleMs >= 300 && tier.visibleMs <= MAX_SAFE_VISIBLE_MS,
      `tier ${index + 1} visibleMs=${tier.visibleMs}`);
    assert.ok(Number.isFinite(tier.intervalMs) && tier.intervalMs >= CONFIG.MIN_INTERVAL_MS
      && tier.intervalMs <= MAX_SAFE_INTERVAL_MS,
    `tier ${index + 1} intervalMs=${tier.intervalMs}`);
    assert.ok(Number.isFinite(tier.speedJitter) && tier.speedJitter >= previousJitter
      && tier.speedJitter >= 0 && tier.speedJitter <= 0.5,
    `tier ${index + 1} speedJitter=${tier.speedJitter}`);
    previousJitter = tier.speedJitter;

    assert.equal(tier.tapWeights.length, 3, `tier ${index + 1} tap weight count`);
    assert.ok(tier.tapWeights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1),
      `tier ${index + 1} contains an invalid tap probability`);
    assert.ok(Math.abs(tier.tapWeights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12,
      `tier ${index + 1} weights must sum to 1`);

    for (const randomValue of [0, 0.999999]) {
      const attack = createAttack(0, {
        baseVisibleMs: tier.visibleMs,
        speedJitter: tier.speedJitter,
        taps: 3,
        random: () => randomValue,
      });
      assert.ok(attack.visibleMs >= 300 && attack.visibleMs <= MAX_SAFE_VISIBLE_MS,
        `tier ${index + 1} generated visibleMs=${attack.visibleMs}`);
      const gaps = attack.segments.slice(1).map((segment, segmentIndex) => (
        segment.impactAt - attack.segments[segmentIndex].impactAt
      ));
      assert.ok(gaps.every((gap) => gap >= CONFIG.SEGMENT_GAP.min && gap <= CONFIG.SEGMENT_GAP.max),
        `tier ${index + 1} generated unsafe segment gap`);
      const interval = nextInterval(tier.intervalMs, () => randomValue);
      assert.ok(interval >= CONFIG.MIN_INTERVAL_MS && interval <= MAX_SAFE_INTERVAL_MS,
        `tier ${index + 1} generated unsafe interval=${interval}`);
    }
  }
});

test('G06: 2-tap and 3-tap probability starts at the documented tiers', () => {
  for (const [index, tier] of CONFIG.TIERS.entries()) {
    const tierNumber = index + 1;
    const successBoundary = tier.successAt;
    if (tierNumber < FIRST_TWO_TAP_TIER) assert.equal(tier.tapWeights[1], 0, `2-tap before tier ${FIRST_TWO_TAP_TIER}`);
    if (tierNumber >= FIRST_TWO_TAP_TIER) assert.ok(tier.tapWeights[1] > 0, `2-tap at tier ${tierNumber}`);
    if (tierNumber < FIRST_THREE_TAP_TIER) assert.equal(tier.tapWeights[2], 0, `3-tap before tier ${FIRST_THREE_TAP_TIER}`);
    if (tierNumber >= FIRST_THREE_TAP_TIER) assert.ok(tier.tapWeights[2] > 0, `3-tap at tier ${tierNumber}`);

    if (successBoundary < 20) assert.equal(tier.tapWeights[1], 0, `2-tap before success 20`);
    if (successBoundary < 46) assert.equal(tier.tapWeights[2], 0, `3-tap before success 46`);
  }
});

test('G07: 1,000 fixed-seed perfect-play series produce reproducible distributions', () => {
  const sampleSeed = (SERIES_SEED_BASE + 37) >>> 0;
  assert.deepEqual(runFixedSeedSeries(sampleSeed), runFixedSeedSeries(sampleSeed), 'same seed must replay identically');

  const report = collectDifficultySeriesReport();
  assert.equal(report.count, SERIES_COUNT);
  assert.equal(report.seedBase, SERIES_SEED_BASE >>> 0);
  assert.equal(report.attacksByTier.length, CONFIG.TIERS.length);
  assert.equal(report.reachedTierSeries.length, CONFIG.TIERS.length);
  assert.equal(report.attacksByTier.reduce((sum, tier) => sum + tier.attacks, 0),
    Object.values(report.totalAttacksByTapCount).reduce((sum, count) => sum + count, 0));
  assert.ok(report.attacksByTier.every((tier) => tier.attacks
    === tier.taps[1] + tier.taps[2] + tier.taps[3]));
  assert.equal(report.totalMisses, 0);
  assert.equal(report.segmentAccuracy, 1);
  assert.equal(report.recoveriesPerSeries.median, 0);
  assert.equal(report.recoveryProbeFromHpOnePerSeries.median, 2);
  assert.ok(report.endedByGameOver <= report.count);
  assert.ok(report.segmentAccuracy > 0 && report.segmentAccuracy <= 1);
  // Timing/score/healing distributions are evidence for review. No unproven
  // player-fun target is asserted as a pass condition.
});

test('G04/G05/G08: split misses lose one HP, recovery has a 9/10/11 boundary, and max tier continues', () => {
  const wrongDir = (needDir) => CONFIG.INPUT_DIRECTIONS.find((candidate) => candidate !== needDir);
  const resolveSegment = (game, attack, index, dir, timeOffset = 0) => {
    const segment = attack.segments[index];
    const eventTime = segment.impactAt + timeOffset;
    assert.equal(game.enqueueAction({ dir, time: eventTime, receivedAt: eventTime }), true);
    game.update(eventTime + 51);
  };

  const mixed = new Game({ settings: { vibrate: false }, random: () => 0.999999, ui: {} });
  mixed.start('normal');
  mixed.successCount = SUCCESS_BOUNDARIES[6];
  mixed.update(mixed.nextSpawnAt);
  const mixedAttack = mixed.attack;
  assert.equal(mixedAttack.taps, 2);
  resolveSegment(mixed, mixedAttack, 0, wrongDir(mixedAttack.needDir));
  assert.equal(mixed.hp, 2, 'the first split miss costs one HP');
  resolveSegment(mixed, mixedAttack, 1, mixedAttack.needDir, 100);
  assert.equal(mixed.hp, 2, 'a later success cannot undo the split miss');
  assert.equal(mixed.successCount, SUCCESS_BOUNDARIES[6] + 1, 'the successful split segment still counts');
  assert.equal(mixedAttack.segments[1].result, 'GOOD', 'a split can contain a GOOD result');

  const missReasons = [];
  const allMiss = new Game({
    settings: { vibrate: false },
    random: () => 0.999999,
    ui: { popJudge: (...args) => missReasons.push(args) },
  });
  allMiss.start('normal');
  allMiss.successCount = SUCCESS_BOUNDARIES[6];
  allMiss.update(allMiss.nextSpawnAt);
  const allMissAttack = allMiss.attack;
  resolveSegment(allMiss, allMissAttack, 0, wrongDir(allMissAttack.needDir));
  resolveSegment(allMiss, allMissAttack, 1, wrongDir(allMissAttack.needDir));
  assert.equal(allMiss.hp, 2, 'multiple misses in one split attack cost at most one HP');
  assert.equal(allMiss.successCount, SUCCESS_BOUNDARIES[6]);
  assert.equal(allMiss.state, 'PLAYING');
  assert.ok(missReasons.some(([result, , reason]) => result === 'MISS' && reason === 'direction'));

  const threeMiss = new Game({ settings: { vibrate: false }, random: () => 0.999999, ui: {} });
  threeMiss.start('normal');
  threeMiss.successCount = SUCCESS_BOUNDARIES[12];
  threeMiss.update(threeMiss.nextSpawnAt);
  const threeMissAttack = threeMiss.attack;
  assert.equal(threeMissAttack.taps, 3);
  for (let index = 0; index < threeMissAttack.segments.length; index++) {
    resolveSegment(threeMiss, threeMissAttack, index, wrongDir(threeMissAttack.needDir));
  }
  assert.equal(threeMiss.hp, 2, 'three split misses still cost one HP');
  assert.equal(threeMiss.successCount, SUCCESS_BOUNDARIES[12]);

  const threeMixedReasons = [];
  const threeMixed = new Game({
    settings: { vibrate: false },
    random: () => 0.999999,
    ui: { popJudge: (...args) => threeMixedReasons.push(args) },
  });
  threeMixed.start('normal');
  threeMixed.successCount = SUCCESS_BOUNDARIES[12];
  threeMixed.update(threeMixed.nextSpawnAt);
  const threeMixedAttack = threeMixed.attack;
  resolveSegment(threeMixed, threeMixedAttack, 0, threeMixedAttack.needDir);
  resolveSegment(threeMixed, threeMixedAttack, 1, threeMixedAttack.needDir, 100);
  resolveSegment(threeMixed, threeMixedAttack, 2, wrongDir(threeMixedAttack.needDir));
  assert.deepEqual(threeMixedAttack.segments.map((segment) => segment.result), ['PERFECT', 'GOOD', 'MISS']);
  assert.equal(threeMixed.hp, 2);
  assert.equal(threeMixed.successCount, SUCCESS_BOUNDARIES[12] + 2);
  assert.ok(threeMixedReasons.some(([result, , reason]) => result === 'MISS' && reason === 'direction'));

  const recovery = new Game({ settings: { vibrate: false }, random: () => 0, ui: {} });
  recovery.start('normal');
  recovery.hp = 1;
  for (let success = 1; success <= 11; success++) {
    recovery.update(recovery.nextSpawnAt);
    drivePerfectAttack(recovery);
    if (success === 9) assert.equal(recovery.hp, 1, '9 perfects do not heal');
    if (success === 10) assert.equal(recovery.hp, 2, 'the 10th perfect heals once');
    if (success === 11) assert.equal(recovery.hp, 2, 'the 11th perfect does not heal again');
  }

  const maxTier = new Game({ settings: { vibrate: false }, random: () => 0, ui: {} });
  maxTier.start('normal');
  maxTier.successCount = SUCCESS_BOUNDARIES.at(-1) + 500;
  maxTier.update(maxTier.nextSpawnAt);
  const maxTierAttack = maxTier.attack;
  assert.equal(maxTierAttack.taps, 1);
  resolveSegment(maxTier, maxTierAttack, 0, wrongDir(maxTierAttack.needDir));
  assert.equal(maxTier.hp, 2);
  assert.equal(maxTier.state, 'PLAYING');
  assert.equal(tierForSuccess(maxTier.successCount), CONFIG.TIERS.at(-1));
  for (let perfect = 0; perfect < CONFIG.HEAL_EVERY_PERFECT_STREAK; perfect++) {
    maxTier.update(maxTier.nextSpawnAt);
    drivePerfectAttack(maxTier);
  }
  assert.equal(maxTier.state, 'PLAYING');
  assert.equal(maxTier.hp, 3, 'maximum difficulty can recover after a miss');
  assert.equal(tierForSuccess(maxTier.successCount), CONFIG.TIERS.at(-1));
  assert.equal(maxTier.successCount, SUCCESS_BOUNDARIES.at(-1) + 500 + CONFIG.HEAL_EVERY_PERFECT_STREAK);
});

test('G08: success beyond tier 20 keeps spawning at the final tier and gameplay stays active', () => {
  const game = new Game({ settings: { vibrate: false }, random: createRandom(0x2048), ui: {} });
  game.start('normal');
  game.successCount = SUCCESS_BOUNDARIES.at(-1) + 500;
  game.update(game.nextSpawnAt);
  assert.equal(tierForSuccess(game.successCount), CONFIG.TIERS.at(-1));
  const finalTierAttack = drivePerfectAttack(game);
  assert.ok(finalTierAttack.taps >= 1 && finalTierAttack.taps <= 3);
  assert.equal(game.state, 'PLAYING');
  assert.equal(game.hp, CONFIG.MAX_HP);
  assert.equal(game.successCount, SUCCESS_BOUNDARIES.at(-1) + 500 + finalTierAttack.taps);

  game.update(game.nextSpawnAt);
  assert.ok(game.attack && !game.attack.resolved, 'another attack spawns after the maximum tier');
  assert.equal(tierForSuccess(game.successCount), CONFIG.TIERS.at(-1));
});

test('G04/U04: injected Game UI announces 2/3 attacks and reports remaining taps as they resolve', () => {
  const banners = [];
  const progress = [];
  const game = new Game({
    settings: { vibrate: false },
    // Below the relevant thresholds this chooses the only eligible tap count;
    // once a multi-tap weight opens, it selects the largest eligible count.
    random: () => 0.999999,
    ui: {
      showBanner: (...args) => banners.push(args),
      updateAttackProgress: (value) => progress.push(value),
    },
  });
  game.start('normal');

  const attackAtNextSpawn = () => {
    game.update(game.nextSpawnAt);
    assert.ok(game.attack && !game.attack.resolved);
    return game.attack;
  };
  const resolveFirstSegment = (attack) => {
    const segment = attack.segments[0];
    assert.equal(game.enqueueAction({ dir: attack.needDir, time: segment.impactAt, receivedAt: segment.impactAt }), true);
    game.update(segment.impactAt + 51);
  };

  while (game.successCount < 20) {
    const attack = attackAtNextSpawn();
    assert.equal(attack.taps, 1, 'multi-tap probability is still zero below success 20');
    drivePerfectAttack(game);
  }

  const twoTap = attackAtNextSpawn();
  assert.equal(twoTap.taps, 2);
  assert.ok(banners.some(([main]) => main === '2回攻撃に備える'));
  assert.ok(progress.some((value) => value?.required === 2 && value?.remaining === 2));
  resolveFirstSegment(twoTap);
  assert.equal(twoTap.segIndex, 1);
  assert.ok(progress.some((value) => value?.required === 2 && value?.remaining === 1));
  const secondTwoTap = twoTap.segments[1];
  assert.equal(game.enqueueAction({ dir: twoTap.needDir, time: secondTwoTap.impactAt, receivedAt: secondTwoTap.impactAt }), true);
  game.update(secondTwoTap.impactAt + 51);
  assert.ok(progress.includes(null), 'completed multi-attack clears its progress display');

  while (game.successCount < 46) {
    const attack = attackAtNextSpawn();
    assert.equal(attack.taps, 2, '3-tap probability is still zero below success 46');
    drivePerfectAttack(game);
  }

  const threeTap = attackAtNextSpawn();
  assert.equal(threeTap.taps, 3);
  assert.ok(banners.some(([main]) => main === '3回攻撃に備える'));
  assert.ok(progress.some((value) => value?.required === 3 && value?.remaining === 3));
  resolveFirstSegment(threeTap);
  assert.equal(threeTap.segIndex, 1);
  assert.ok(progress.some((value) => value?.required === 3 && value?.remaining === 2));
});
