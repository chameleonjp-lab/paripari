// ゲーム状態機械・進行制御 要件 §2 §3 §5
import { CONFIG, tierForSuccess, rankForScore } from './config.js';
import { judgeTiming } from './judge.js';
import { calcGain } from './scoring.js';
import { createAttack, nextInterval } from './enemy.js';
import * as audio from './audio.js';
import { vibrate, HAPTICS } from './haptics.js';
import * as ui from './ui.js';
import { getBest, setBest } from './storage.js';

const PRACTICE_GOAL = 3;

export class Game {
  constructor({ renderer, particles, settings, onGameOver }) {
    this.r = renderer;
    this.particles = particles;
    this.settings = settings;
    this.onGameOver = onGameOver || (() => {});

    this.state = 'IDLE';       // IDLE | PLAYING | OVER
    this.mode = 'normal';      // normal | practice
    this.gameTime = 0;         // ms（main が進める）

    // 演出タイマー（壁時計ms, main が減算）
    this.hitstopMs = 0;
    this.slowmoMs = 0;

    this._currentTierIndex = -1;
    this._resetStats();
  }

  setSettings(s) { this.settings = s; }

  _resetStats() {
    this.hp = CONFIG.MAX_HP;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.successCount = 0;
    this.perfectCount = 0;
    this.perfectStreak = 0;
    this.totalAttempts = 0;     // 成功＋失敗（判定された攻撃数）
    this.attack = null;
    this.nextSpawnAt = 0;
    this._currentTierIndex = -1;
  }

  start(mode = 'normal') {
    this.mode = mode;
    this.state = 'PLAYING';
    this._resetStats();
    this.nextSpawnAt = this.gameTime + 600;
    this._applyTierUI();
    ui.updateHUD(this);
  }

  isPlaying() { return this.state === 'PLAYING'; }

  // --- 入力処理（main からプレイ中のみ呼ばれる）---
  handleAction(dir) {
    if (this.state !== 'PLAYING') return;
    const a = this.attack;
    // 攻撃が未提示 / 既に判定済み → 空打ち（ペナルティなし）
    if (!a || a.resolved || this.gameTime < a.spawnAt) {
      audio.play('tap');
      return;
    }
    const delta = this.gameTime - a.impactAt;
    const dirOk = dir === a.needDir;
    const result = judgeTiming(delta, dirOk);
    this._resolve(a, result, delta);
  }

  // --- フレーム更新（main からプレイ中のみ呼ばれる）---
  update(dtSec) {
    const now = this.gameTime;
    const a = this.attack;
    if (a && !a.resolved && now >= a.windowEnd) {
      this._resolve(a, 'MISS', a.windowEnd - a.impactAt, true); // 無入力タイムアウト
    }
    if ((!this.attack || this.attack.resolved) && now >= this.nextSpawnAt && this.state === 'PLAYING') {
      this._spawn();
    }
    this.particles.update(dtSec);
  }

  _spawn() {
    const tier = this.mode === 'practice' ? CONFIG.TIERS[0] : tierForSuccess(this.successCount);
    this.attack = createAttack(this.gameTime, tier);
    this._applyTierUI();
  }

  _applyTierUI() {
    const tier = this.mode === 'practice' ? CONFIG.TIERS[0] : tierForSuccess(this.successCount);
    const idx = CONFIG.TIERS.indexOf(tier);
    if (idx !== this._currentTierIndex) {
      this._currentTierIndex = idx;
      ui.setFourDir(tier.directions.length > 2);
    }
  }

  _resolve(a, result, delta, timeout = false) {
    a.resolved = true;
    a.resolvedAt = this.gameTime;
    a.result = result;
    this.totalAttempts++;

    const cx = this.r.w / 2;
    const cy = this.r.lineY;
    const reduced = this.settings.reducedMotion;

    if (result === 'MISS') {
      this.combo = 0;
      this.perfectStreak = 0;
      if (this.mode === 'normal') this.hp = Math.max(0, this.hp - 1);
      audio.play('miss');
      vibrate(HAPTICS.miss);
      this.r.triggerFlash('#5a0a14', 0.5);
      if (!reduced) this.r.triggerShake(CONFIG.SHAKE_MISS);
      this.particles.spawnBurst(cx, cy, {
        count: 14, speed: 220, colors: this.r.burstColors('MISS'), size: 3, life: 0.45, gravity: 700,
      });
      ui.popJudge('MISS', delta);
    } else {
      // 成功
      this.combo++;
      this.successCount++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const gain = calcGain(result, this.combo, delta);
      this.score += gain;

      if (result === 'PERFECT') {
        this.perfectCount++;
        this.perfectStreak++;
        audio.play('perfect');
        vibrate(HAPTICS.perfect);
        this.r.triggerFlash('#fff7df', 0.85);
        this.hitstopMs = CONFIG.HITSTOP_PERFECT_MS;
        if (!reduced) this.slowmoMs = CONFIG.SLOWMO_MS;
        this.particles.spawnBurst(cx, cy, {
          count: 30, speed: 420, colors: this.r.burstColors('PERFECT'), size: 4, life: 0.6, gravity: 500,
        });
        // PERFECT連続で回復
        if (this.perfectStreak > 0 && this.perfectStreak % CONFIG.HEAL_EVERY_PERFECT_STREAK === 0) {
          this.hp = Math.min(CONFIG.MAX_HP, this.hp + 1);
        }
      } else {
        this.perfectStreak = 0;
        audio.play('good');
        vibrate(HAPTICS.good);
        this.r.triggerFlash('#bfefff', 0.5);
        this.hitstopMs = CONFIG.HITSTOP_GOOD_MS;
        this.particles.spawnBurst(cx, cy, {
          count: 18, speed: 320, colors: this.r.burstColors('GOOD'), size: 3, life: 0.5, gravity: 600,
        });
      }
      ui.popJudge(result, delta);
      if (this.combo >= 2) ui.bumpCombo();
      if (this.combo > 0 && this.combo % CONFIG.COMBO_STEP === 0) audio.play('combo');
    }

    ui.updateHUD(this);

    // 次の攻撃を予約
    const tier = this.mode === 'practice' ? CONFIG.TIERS[0] : tierForSuccess(this.successCount);
    this.nextSpawnAt = this.gameTime + nextInterval(tier);

    // 終了判定
    if (this.mode === 'normal' && this.hp <= 0) {
      this._gameOver();
    } else if (this.mode === 'practice' && this.successCount >= PRACTICE_GOAL) {
      this.state = 'IDLE';
      this.attack = null;
      this.onGameOver({ practiceDone: true });
    }
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
    return { now: this.gameTime, attack: this.attack };
  }
}
