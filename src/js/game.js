// ゲーム状態機械・進行制御 要件 §2 §3 §5
import { CONFIG, NEED_ANGLE, tierForSuccess, rankForScore } from './config.js';
import { judgeTiming } from './judge.js';
import { calcGain } from './scoring.js';
import { createAttack, nextInterval } from './enemy.js';
import { vibrate, HAPTICS } from './haptics.js';
import * as ui from './ui.js';
import { getBest, setBest } from './storage.js';

const PRACTICE_GOAL = 5;

export class Game {
  constructor({ renderer, particles, settings, onGameOver }) {
    this.r = renderer;
    this.particles = particles;
    this.settings = settings;
    this.onGameOver = onGameOver || (() => {});

    this.state = 'IDLE';       // IDLE | PLAYING | OVER
    this.mode = 'normal';      // normal | practice
    this.gameTime = 0;

    this.hitstopMs = 0;
    this.slowmoMs = 0;

    this._tierIndex = -1;
    this._resetStats();
  }

  setSettings(s) { this.settings = s; if (this.r) this.r.reducedMotion = !!s.reducedMotion; }

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
    this.warmupRemaining = 0;   // >0 の間はノーダメージ・低速の準備フェーズ
    this._tierIndex = -1;
  }

  start(mode = 'normal') {
    this.mode = mode;
    this.state = 'PLAYING';
    this._resetStats();
    this.r.reducedMotion = !!this.settings.reducedMotion;
    this.r.clearTransients();
    this.particles.clear();
    // 開始時のウォームアップ（案内＋低速ノーダメージ）
    this.warmupRemaining = mode === 'normal' ? CONFIG.WARMUP.count : PRACTICE_GOAL;
    this.nextSpawnAt = this.gameTime + 500;
    if (mode === 'normal') ui.showBanner('WARM UP', '来た方向の【反対】を押す');
    ui.updateHUD(this);
  }

  isPlaying() { return this.state === 'PLAYING'; }
  inWarmup() { return this.warmupRemaining > 0; }

  handleAction(dir) {
    if (this.state !== 'PLAYING') return;
    const a = this.attack;
    if (!a || a.resolved || this.gameTime < a.spawnAt) return; // 空打ち
    const delta = this.gameTime - a.impactAt;
    const dirOk = dir === a.needDir;
    const result = judgeTiming(delta, dirOk);
    this._resolve(a, result, delta);
  }

  update(dtSec) {
    const now = this.gameTime;
    const a = this.attack;
    if (a && !a.resolved && now >= a.windowEnd) {
      this._resolve(a, 'MISS', a.windowEnd - a.impactAt);
    }
    if ((!this.attack || this.attack.resolved) && now >= this.nextSpawnAt && this.state === 'PLAYING') {
      this._spawn();
    }
    this.particles.update(dtSec);
  }

  _spawn() {
    const visibleMs = this.inWarmup() ? CONFIG.WARMUP.visibleMs : this._tier().visibleMs;
    this.attack = createAttack(this.gameTime, visibleMs);
    this._checkTierUp();
  }

  _tier() {
    return this.mode === 'practice' ? CONFIG.TIERS[0] : tierForSuccess(this.successCount);
  }

  _checkTierUp() {
    if (this.inWarmup() || this.mode !== 'normal') return;
    const idx = CONFIG.TIERS.indexOf(tierForSuccess(this.successCount));
    if (this._tierIndex >= 0 && idx > this._tierIndex) {
      ui.showBanner('SPEED UP', null, 900); // 認知のための変化サイン
    }
    this._tierIndex = idx;
  }

  _resolve(a, result, delta) {
    a.resolved = true;
    a.resolvedAt = this.gameTime;
    a.result = result;

    const warmup = this.inWarmup();
    const cx = this.r.w / 2;
    const cy = this.r.lineY;
    const reduced = this.settings.reducedMotion;

    if (result === 'MISS') {
      this.combo = 0;
      this.perfectStreak = 0;
      // ウォームアップ/練習中はノーダメージ
      if (this.mode === 'normal' && !warmup) this.hp = Math.max(0, this.hp - 1);
      vibrate(HAPTICS.miss);
      this.r.triggerFlash('#5a0a14', 0.45);
      this.r.triggerVignette('150,20,40', warmup ? 0.4 : 0.7);
      this.r.triggerShake(CONFIG.SHAKE_MISS);
      this.r.triggerShockwave('MISS');
      this.particles.spawnBurst(cx, cy, {
        count: 16, speed: 240, colors: this.r.burstColors('MISS'), size: 3, life: 0.45, gravity: 700,
      });
      ui.popJudge('MISS', delta);
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (!warmup) {
        this.successCount++;
        this.totalAttempts++;
        const gain = calcGain(result, this.combo, delta);
        this.score += gain;
        this.r.addScorePopup(gain, result);
      }
      this.r.triggerDeflect(a.needDir, result);
      this.r.triggerShockwave(result);

      if (result === 'PERFECT') {
        this.perfectCount += warmup ? 0 : 1;
        this.perfectStreak++;
        vibrate(HAPTICS.perfect);
        this.r.triggerFlash('#fff7df', 0.5);
        this.hitstopMs = CONFIG.HITSTOP_PERFECT_MS;
        if (!reduced) this.slowmoMs = CONFIG.SLOWMO_MS;
        this.particles.spawnBurst(cx, cy, {
          count: 34, speed: 460, colors: this.r.burstColors('PERFECT'), size: 4, life: 0.65, gravity: 480,
        });
        this.particles.spawnBurst(cx, cy, {
          count: 12, speed: 520, spread: 0.7, angle: this._dirAngle(a.needDir),
          colors: this.r.burstColors('PERFECT'), size: 3, life: 0.5, gravity: 300,
        });
        if (!warmup && this.perfectStreak > 0 && this.perfectStreak % CONFIG.HEAL_EVERY_PERFECT_STREAK === 0) {
          this.hp = Math.min(CONFIG.MAX_HP, this.hp + 1);
        }
      } else {
        this.perfectStreak = 0;
        vibrate(HAPTICS.good);
        this.r.triggerFlash('#bfefff', 0.3);
        this.hitstopMs = CONFIG.HITSTOP_GOOD_MS;
        this.particles.spawnBurst(cx, cy, {
          count: 20, speed: 340, spread: 1.4, angle: this._dirAngle(a.needDir),
          colors: this.r.burstColors('GOOD'), size: 3, life: 0.5, gravity: 600,
        });
      }
      ui.popJudge(result, delta);
      if (this.combo >= 2) ui.bumpCombo();
    }

    // ウォームアップ消化 → 本番開始
    if (warmup) {
      this.warmupRemaining--;
      if (this.warmupRemaining <= 0 && this.mode === 'normal') {
        this.combo = 0;
        this.perfectStreak = 0;
        this._tierIndex = CONFIG.TIERS.indexOf(tierForSuccess(0));
        ui.showBanner('START!', null, 800);
      }
    }

    ui.updateHUD(this);

    const intervalMs = this.inWarmup() ? CONFIG.WARMUP.intervalMs : this._tier().intervalMs;
    this.nextSpawnAt = this.gameTime + nextInterval(intervalMs);

    if (this.mode === 'normal' && this.hp <= 0) {
      this._gameOver();
    } else if (this.mode === 'practice' && this.warmupRemaining <= 0) {
      this.state = 'IDLE';
      this.attack = null;
      this.onGameOver({ practiceDone: true });
    }
  }

  _dirAngle(dir) {
    return NEED_ANGLE[dir] != null ? NEED_ANGLE[dir] : 0;
  }

  _gameOver() {
    this.state = 'OVER';
    this.attack = null;
    const best = getBest();
    const isBest = this.score > best;
    if (isBest) setBest(this.score);
    const perfectRate = this.totalAttempts > 0
      ? Math.round((this.perfectCount / Math.max(1, this.successCount)) * 100) : 0;
    const tierNum = CONFIG.TIERS.indexOf(tierForSuccess(this.successCount)) + 1;
    this.onGameOver({
      practiceDone: false,
      score: this.score,
      best: Math.max(best, this.score),
      isBest,
      maxCombo: this.maxCombo,
      perfectRate,
      tier: tierNum,
      rank: rankForScore(this.score),
    });
  }

  getRenderState() {
    return { now: this.gameTime, attack: this.attack, combo: this.combo, hp: this.hp, warmup: this.inWarmup() };
  }
}
