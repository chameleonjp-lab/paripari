// ゲーム状態機械・進行制御。
// ゲーム時刻は外部から与えられる絶対値で進め、入力はキューへ積んでから
// update(nowGameMs) で確定する。描画や演出の時間はこの状態機械を進めない。
import { CONFIG, NEED_ANGLE, tierForSuccess, rankForScore } from './config.js';
import { INPUT_DELAY_MS } from './clock.js';
import { judgeTiming } from './judge.js';
import { calcGain } from './scoring.js';
import { createAttack, nextInterval, pickTaps, currentSegment } from './enemy.js';
import { vibrate, HAPTICS } from './haptics.js';
import * as defaultUi from './ui.js';
import { getBest, setBest } from './storage.js';
import { createRandom } from './random.js';

export const PRACTICE_DIRECTIONS = Object.freeze(['L', 'R', 'U', 'UL', 'UR']);
const PRACTICE_GOAL = PRACTICE_DIRECTIONS.length;
const INPUT_ORDER = Object.freeze(
  (CONFIG.INPUT_DIRECTIONS || ['L', 'DL', 'D', 'DR', 'R']).slice(),
);
const INPUT_RANK = new Map(INPUT_ORDER.map((dir, index) => [dir, index]));
const makeEmptyRenderer = () => ({
  w: 0,
  h: 0,
  lineY: 0,
  reducedMotion: false,
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export class Game {
  /**
   * @param {object} options
   * @param {object} options.renderer 既存Renderer（純粋検査では省略可）
   * @param {object} options.particles 既存ParticlePool（純粋検査では省略可）
   * @param {object} options.settings 設定
   * @param {(data: object) => void} options.onGameOver 結果通知
   * @param {object} options.ui UI実装（省略時は既存ui.js）
   * @param {() => number} options.random ゲーム専用乱数
   */
  constructor({
    renderer = null,
    particles = null,
    settings = {},
    onGameOver = null,
    ui = defaultUi,
    random = null,
  } = {}) {
    this.r = renderer || makeEmptyRenderer();
    this.particles = particles || null;
    this.settings = { reducedMotion: false, vibrate: true, ...settings };
    this.onGameOver = typeof onGameOver === 'function' ? onGameOver : () => {};
    this.ui = ui || defaultUi;
    this.random = typeof random === 'function' ? random : createRandom();

    this.state = 'IDLE';
    this.mode = 'normal';
    this.gameTime = 0;
    this.roundId = 0;
    this._roundActive = false;
    this._processingTime = 0;
    this._inputQueue = [];
    this._inputSequence = 0;
    this._gameOverNotified = false;
    this._lastUpdateTime = 0;

    // 旧配線から参照される値は残す。演出はゲーム時計を止める用途に使わない。
    this.hitstopMs = 0;
    this.slowmoMs = 0;

    this._tierIndex = -1;
    this._maxTaps = 1;
    this._resetStats();
  }

  setSettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    if (this.r) this.r.reducedMotion = !!this.settings.reducedMotion;
  }

  _resetStats() {
    this.hp = CONFIG.MAX_HP;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.successCount = 0;
    this.perfectCount = 0;
    this.perfectStreak = 0;
    this.totalAttempts = 0;
    this.attack = null;
    this.nextSpawnAt = 0;
    this.warmupRemaining = 0;
    this._tierIndex = -1;
    this._maxTaps = 1;
  }

  /** Start a new isolated round at game time zero. */
  start(mode = 'normal') {
    this.mode = mode === 'practice' ? 'practice' : 'normal';
    this.state = 'PLAYING';
    this.roundId += 1;
    this._roundActive = true;
    this._gameOverNotified = false;
    this.gameTime = 0;
    this._lastUpdateTime = 0;
    this._processingTime = 0;
    this.clearInputs();
    this._resetStats();
    this.r.reducedMotion = !!this.settings.reducedMotion;
    this._callRenderer('clearTransients');
    this._callParticles('clear');
    this.warmupRemaining = this.mode === 'practice' ? PRACTICE_GOAL : 0;
    // 出現予定時刻はここから固定され、攻撃の早期解決で前倒ししない。
    this.nextSpawnAt = 500;
    if (this.mode === 'practice') {
      this._ui('setPracticeGuide', { step: 1, total: PRACTICE_GOAL, dir: 'L', needDir: 'R' });
    }
    this._ui('updateHUD', this);
    return this.roundId;
  }

  isPlaying() {
    return this.state === 'PLAYING' && this._roundActive;
  }

  inWarmup() {
    return this.warmupRemaining > 0;
  }

  /**
   * Queue one input. This method intentionally has no immediate game-state effect.
   * `time` and `receivedAt` are already game-clock milliseconds.
   */
  enqueueAction({ dir, time, receivedAt, roundId = this.roundId } = {}) {
    if (!this.isPlaying()) return false;
    if (!INPUT_RANK.has(dir)) return false;
    if (roundId !== this.roundId) return false;

    const eventTime = time;
    const receiptTime = receivedAt;
    if (!finite(eventTime) || !finite(receiptTime)) return false;
    // future event and delivery outside the 0..50ms guarantee are invalid.
    if (eventTime > receiptTime || receiptTime - eventTime > INPUT_DELAY_MS) return false;
    // A timestamp before this round cannot affect a fresh round. Do not clamp it.
    if (eventTime < 0 || receiptTime < 0) return false;

    this._inputQueue.push({
      dir,
      time: eventTime,
      receivedAt: receiptTime,
      roundId,
      sequence: this._inputSequence++,
    });
    return true;
  }

  /** Compatibility name for old input wiring; it still only enqueues. */
  handleAction(action) {
    return this.enqueueAction(action || {});
  }

  clearInputs() {
    this._inputQueue.length = 0;
  }

  /** Freeze this round. Pending inputs are retained unless explicitly discarded. */
  pause({ discardInputs = false } = {}) {
    if (!this.isPlaying()) return false;
    this.state = 'PAUSED';
    if (discardInputs) this.clearInputs();
    return true;
  }

  resume() {
    if (this.state !== 'PAUSED' || !this._roundActive) return false;
    this.state = 'PLAYING';
    return true;
  }

  /** Invalidate the active round, its attack, and all queued input. */
  stop() {
    this._roundActive = false;
    this.state = 'IDLE';
    this.attack = null;
    this.clearInputs();
    this.hitstopMs = 0;
    this.slowmoMs = 0;
    return true;
  }

  /**
   * Advance to an absolute game-time horizon and drain ready input/timeout events.
   * Input at exactly horizon-50 remains pending. A timeout is held through the
   * same strict delivery watermark; the following sample settles the logical
   * deadline, with a ready equal-time input selected first.
   */
  update(nowGameMs) {
    if (!this.isPlaying()) return this.gameTime;
    const requested = Number(nowGameMs);
    const horizon = finite(requested) ? Math.max(this.gameTime, requested) : this.gameTime;
    const previous = this.gameTime;
    const roundAtStart = this.roundId;
    this._drainUntil(horizon);
    // Keep the sampled absolute time even when this update ends the round. A
    // reentrant onGameOver callback may have started a fresh round; in that case
    // its reset clock must win.
    if (this.roundId === roundAtStart) this.gameTime = horizon;
    const dt = Math.max(0, horizon - previous) / 1000;
    this._callParticles('update', dt);
    this._lastUpdateTime = horizon;
    return this.gameTime;
  }

  _drainUntil(horizon) {
    let cursor = this.gameTime;
    let guard = 0;

    while (this.isPlaying() && guard++ < 10000) {
      this._discardStaleInputs();
      const candidate = this._peekReadyInput(horizon);
      const hasActiveAttack = !!(this.attack && !this.attack.resolved);
      const scheduledSpawn = !hasActiveAttack && finite(this.nextSpawnAt) && this.nextSpawnAt <= horizon;

      if (scheduledSpawn) {
        // Inputs before an absent attack's planned appearance are empty presses.
        if (candidate && candidate.time < this.nextSpawnAt) {
          this._discardInputGroup(candidate.time);
          continue;
        }
        const spawnAt = Math.max(cursor, this.nextSpawnAt);
        this._processingTime = spawnAt;
        this._spawn(this.nextSpawnAt);
        cursor = Math.max(cursor, this.nextSpawnAt);
        continue;
      }

      if (hasActiveAttack) {
        const seg = currentSegment(this.attack);
        const timeoutAt = seg && !seg.resolved
          ? seg.impactAt + CONFIG.GOOD_WINDOW
          : Infinity;

        // Both input and timeout at the same event time are ordered input first.
        if (candidate && candidate.time <= timeoutAt) {
          this._discardInputGroup(candidate.time, (winner) => {
            const processAt = Math.max(cursor, winner.time);
            this._processingTime = processAt;
            this._applyQueuedInput(winner);
            cursor = Math.max(cursor, processAt);
          });
          continue;
        }

        // Keep the timeout open for the same 0..50ms delivery guarantee as input.
        // The logical deadline itself remains fixed, independent of the frame
        // that finally observes the now-50ms watermark.
        const timeoutWatermark = horizon - INPUT_DELAY_MS;
        // Both timeout and input use a strict watermark. At exactly deadline+50
        // the timeout remains open for a possible delivery; the next sample
        // gives an input at +140 its guaranteed chance to win.
        if (finite(timeoutAt) && timeoutAt < timeoutWatermark) {
          this._processingTime = timeoutAt;
          this._resolveSegment(this.attack, seg, 'MISS', CONFIG.GOOD_WINDOW, timeoutAt, 'timeout');
          cursor = Math.max(cursor, timeoutAt);
          continue;
        }

        // A ready input after the timeout is discarded once the timeout has won.
        if (candidate && finite(timeoutAt) && candidate.time > timeoutAt) {
          // The next iteration resolves the timeout when it is due; if it is not
          // due yet, leave the input queued until that exact boundary.
        }
        break;
      }

      // No attack is present and no spawn is due. A ready press cannot be carried
      // into a future attack; discard it now.
      if (candidate) {
        this._discardInputGroup(candidate.time);
        continue;
      }
      break;
    }

    // If a test or old caller supplied an already-advanced gameTime, retain it;
    // update() sets the public render clock after all state transitions.
    this._processingTime = horizon;
  }

  _discardStaleInputs() {
    if (!this._inputQueue.length) return;
    this._inputQueue = this._inputQueue.filter((input) => input.roundId === this.roundId);
  }

  _peekReadyInput(horizon) {
    const cutoff = horizon - INPUT_DELAY_MS;
    const available = this._inputQueue.filter((input) => (
      input.roundId === this.roundId &&
      input.receivedAt <= horizon &&
      input.time < cutoff
    ));
    if (!available.length) return null;
    available.sort((a, b) => a.time - b.time ||
      (INPUT_RANK.get(a.dir) - INPUT_RANK.get(b.dir)) ||
      a.sequence - b.sequence);
    return available[0];
  }

  /** Remove one exact-time group and optionally process its fixed-order winner. */
  _discardInputGroup(time, consume = null) {
    const group = this._inputQueue
      .filter((input) => input.roundId === this.roundId && input.time === time)
      .sort((a, b) => INPUT_RANK.get(a.dir) - INPUT_RANK.get(b.dir) || a.sequence - b.sequence);
    if (!group.length) return;
    const winner = group[0];
    const remove = new Set(group);
    this._inputQueue = this._inputQueue.filter((input) => !remove.has(input));
    if (typeof consume === 'function') consume(winner);
  }

  _applyQueuedInput(input) {
    const a = this.attack;
    if (!a || a.resolved || !this.isPlaying()) return;
    // An input from before the attack appeared is ignored. Once the attack is
    // visible, an early first-segment press is a normal MISS.
    if (input.time < a.spawnAt) return;
    const seg = currentSegment(a);
    if (!seg || seg.resolved) return;

    const index = a.segIndex;
    if (index > 0) {
      const previous = a.segments[index - 1];
      // Future-segment spam is ignored until the previous segment is resolved and
      // this segment's own -140ms acceptance window has opened.
      if (!previous?.resolved || input.time < seg.impactAt - CONFIG.GOOD_WINDOW) return;
      if (finite(previous.resolvedAt) && input.time < previous.resolvedAt) return;
    }

    const delta = input.time - seg.impactAt;
    const result = judgeTiming(delta, input.dir === a.needDir);
    // Store the logical event time so state snapshots and the resolved trail are
    // independent of which frame delivered the queued action. The current frame
    // remains the render horizon in getRenderState().
    const reason = input.dir !== a.needDir ? 'direction' : delta < 0 ? 'early' : 'late';
    this._resolveSegment(a, seg, result, delta, input.time, reason);
  }

  _tier() {
    return this.mode === 'practice' ? CONFIG.TIERS[0] : tierForSuccess(this.successCount);
  }

  _spawn(scheduledAt = this.nextSpawnAt) {
    if (!this.isPlaying()) return null;
    const spawnAt = finite(scheduledAt) ? scheduledAt : this.gameTime;
    const warm = this.inWarmup();
    const tier = this._tier();
    const opts = warm
      ? {
        baseVisibleMs: CONFIG.WARMUP.visibleMs,
        speedJitter: 0,
        taps: 1,
        dirs: [PRACTICE_DIRECTIONS[PRACTICE_GOAL - this.warmupRemaining]],
        random: this.random,
      }
      : {
        baseVisibleMs: tier.visibleMs,
        speedJitter: tier.speedJitter,
        taps: pickTaps(tier.tapWeights, this.random),
        random: this.random,
      };
    this.attack = createAttack(spawnAt, opts);
    this.attack.warmup = warm;
    this.attack.scheduledSpawnAt = spawnAt;
    if (this.mode === 'practice') {
      this._ui('setPracticeGuide', {
        step: PRACTICE_GOAL - this.warmupRemaining + 1,
        total: PRACTICE_GOAL,
        dir: this.attack.dir,
        needDir: this.attack.needDir,
      });
    }
    this._checkTierUp();
    return this.attack;
  }

  _checkTierUp() {
    if (this.inWarmup() || this.mode !== 'normal') return;
    const tier = tierForSuccess(this.successCount);
    const idx = CONFIG.TIERS.indexOf(tier);
    if (this._tierIndex >= 0 && idx > this._tierIndex) {
      if (tier.maxTaps > this._maxTaps && tier.maxTaps >= 2) {
        this._ui('showBanner', `${tier.maxTaps}連 受け流し！`, '同じ向きに連続タップ', 1500);
      } else {
        this._ui('showBanner', '難しさアップ', null, 900);
      }
    }
    this._tierIndex = idx;
    this._maxTaps = tier.maxTaps;
  }

  _resolveSegment(a, seg, result, delta, resolvedAt = this._processingTime, reason = 'timeout') {
    if (!this.isPlaying() || !a || a.resolved || !seg || seg.resolved) return false;
    seg.resolved = true;
    seg.result = result;
    seg.resolvedAt = resolvedAt;
    a.resolvedAt = resolvedAt;
    a.result = result;

    const warmup = this.mode === 'practice';
    const reduced = !!this.settings.reducedMotion;
    const { cx, cy } = this._center();

    // Every settled live segment is an attempt, including misses. Warmup remains
    // outside the normal-round aggregate.
    if (!warmup) this.totalAttempts++;

    if (result === 'MISS') {
      this.combo = 0;
      this.perfectStreak = 0;
      // 1攻撃あたりのHP減は最大1（分割を全部外しても即死しない）。
      if (this.mode === 'normal' && !warmup && !a.hpLost) {
        this.hp = Math.max(0, this.hp - 1);
        a.hpLost = true;
      }
      this._callHaptics(HAPTICS.miss);
      this._callRenderer('triggerFlash', '#5a0a14', 0.45);
      this._callRenderer('triggerVignette', '150,20,40', warmup ? 0.4 : 0.7);
      this._callRenderer('triggerShake', CONFIG.SHAKE_MISS);
      this._callRenderer('triggerShockwave', 'MISS');
      this._spawnParticles(cx, cy, {
        count: 16,
        speed: 240,
        colors: this._burstColors('MISS'),
        size: 3,
        life: 0.45,
        gravity: 700,
      });
      this._ui('popJudge', 'MISS', delta, reason);
    } else {
      if (!warmup) {
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.successCount++;
        const gain = calcGain(result, this.combo, delta);
        this.score += gain;
        this._callRenderer('addScorePopup', gain, result);
      }
      this._callRenderer('triggerDeflect', a.needDir, result);
      this._callRenderer('triggerShockwave', result);

      if (result === 'PERFECT') {
        if (!warmup) {
          this.perfectCount++;
          this.perfectStreak++;
        }
        this._callHaptics(HAPTICS.perfect);
        this._callRenderer('triggerFlash', '#fff7df', 0.5);
        // Hitstop/slowmo never changes gameTime. Keep these legacy fields at zero
        // so old render loops cannot accidentally slow the simulation.
        this.hitstopMs = 0;
        this.slowmoMs = 0;
        this._spawnParticles(cx, cy, {
          count: 34,
          speed: 460,
          colors: this._burstColors('PERFECT'),
          size: 4,
          life: 0.65,
          gravity: 480,
        });
        this._spawnParticles(cx, cy, {
          count: 12,
          speed: 520,
          spread: 0.7,
          angle: this._dirAngle(a.needDir),
          colors: this._burstColors('PERFECT'),
          size: 3,
          life: 0.5,
          gravity: 300,
        });
        if (!warmup && this.perfectStreak % CONFIG.HEAL_EVERY_PERFECT_STREAK === 0) {
          this.hp = Math.min(CONFIG.MAX_HP, this.hp + 1);
        }
      } else {
        this.perfectStreak = 0;
        this._callHaptics(HAPTICS.good);
        this._callRenderer('triggerFlash', '#bfefff', 0.3);
        this.hitstopMs = 0;
        this.slowmoMs = 0;
        this._spawnParticles(cx, cy, {
          count: 20,
          speed: 340,
          spread: 1.4,
          angle: this._dirAngle(a.needDir),
          colors: this._burstColors('GOOD'),
          size: 3,
          life: 0.5,
          gravity: 600,
        });
      }
      this._ui('popJudge', result, delta);
      if (this.combo >= 2) this._ui('bumpCombo');
    }

    this._ui('updateHUD', this);

    // HP0 ends the round immediately, even when another segment remains.
    if (this.mode === 'normal' && this.hp <= 0) {
      this._gameOver();
      return true;
    }

    a.segIndex++;
    if (a.segIndex >= a.segments.length) this._onAttackResolved(a);
    return true;
  }

  _onAttackResolved(a) {
    if (!a || a.resolved) return;
    a.resolved = true;
    a.lastImpactAt = a.segments[a.segments.length - 1]?.impactAt ?? a.spawnAt;

    if (this.mode === 'practice' && a.segments.every((seg) => seg.result !== 'MISS')) {
      this.warmupRemaining = Math.max(0, this.warmupRemaining - 1);
    }

    const intervalMs = this.inWarmup()
      ? CONFIG.WARMUP.intervalMs
      : this._tier().intervalMs;
    const interval = nextInterval(intervalMs, this.random);
    a.intervalMs = interval;
    // The schedule is anchored to the planned final impact, never resolution or
    // presentation time. This remains stable under early input and hit effects.
    this.nextSpawnAt = a.lastImpactAt + CONFIG.GOOD_WINDOW + interval;

    if (this.mode === 'practice' && this.warmupRemaining <= 0) {
      this._finishPractice();
    }
  }

  _finishPractice() {
    if (!this._roundActive || this._gameOverNotified) return;
    this._gameOverNotified = true;
    this._roundActive = false;
    this.state = 'IDLE';
    this.attack = null;
    this.clearInputs();
    this.onGameOver({ practiceDone: true, roundId: this.roundId });
  }

  _dirAngle(dir) {
    return NEED_ANGLE[dir] != null ? NEED_ANGLE[dir] : 0;
  }

  _gameOver() {
    if (this._gameOverNotified) return;
    this._gameOverNotified = true;
    this._roundActive = false;
    this.state = 'OVER';
    this.attack = null;
    this.clearInputs();
    const best = getBest();
    const isBest = this.score > best;
    const storedBest = isBest ? setBest(this.score) : best;
    const perfectRate = this.totalAttempts > 0
      ? Math.round((this.perfectCount / Math.max(1, this.successCount)) * 100)
      : 0;
    const tierNum = CONFIG.TIERS.indexOf(tierForSuccess(this.successCount)) + 1;
    this._ui('updateHUD', this);
    this.onGameOver({
      practiceDone: false,
      score: this.score,
      best: Math.max(storedBest, this.score),
      isBest,
      maxCombo: this.maxCombo,
      perfectRate,
      tier: tierNum,
      rank: rankForScore(this.score),
      roundId: this.roundId,
    });
  }

  _center() {
    const width = finite(this.r?.w) ? this.r.w : 0;
    const height = finite(this.r?.lineY) ? this.r.lineY : 0;
    return { cx: width / 2, cy: height };
  }

  _burstColors(result) {
    if (typeof this.r?.burstColors === 'function') return this.r.burstColors(result);
    if (result === 'PERFECT') return ['#fff', '#ffd35b', '#5bdcff', '#ffea9e'];
    if (result === 'GOOD') return ['#fff', '#5bdcff'];
    return ['#ff3b54', '#ff8a5b'];
  }

  _spawnParticles(x, y, options) {
    if (typeof this.particles?.spawnBurst === 'function') this.particles.spawnBurst(x, y, options);
  }

  _callParticles(method, ...args) {
    if (typeof this.particles?.[method] === 'function') this.particles[method](...args);
  }

  _callRenderer(method, ...args) {
    if (typeof this.r?.[method] === 'function') this.r[method](...args);
  }

  _callHaptics(pattern) {
    if (this.settings.vibrate !== false) vibrate(pattern);
  }

  _ui(method, ...args) {
    if (typeof this.ui?.[method] === 'function') this.ui[method](...args);
  }

  getRenderState() {
    return {
      now: this.gameTime,
      attack: this.attack,
      combo: this.combo,
      hp: this.hp,
      warmup: this.inWarmup(),
    };
  }
}
