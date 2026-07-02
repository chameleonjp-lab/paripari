// パリパリ チューニング定数（要件 §2.4 §3 §5）
// すべてのバランス調整はこのファイルで完結する。

export const CONFIG = {
  // --- 判定窓 (ms) ---
  PERFECT_WINDOW: 60,
  GOOD_WINDOW: 140,

  // --- スコア ---
  BASE_PERFECT: 300,
  BASE_GOOD: 100,
  COMBO_STEP: 5,
  COMBO_STEP_BONUS: 0.5,
  COMBO_MAX_MULT: 4.0,
  TIMING_BONUS_MAX: 50,

  // --- ライフ ---
  MAX_HP: 3,
  HEAL_EVERY_PERFECT_STREAK: 10,

  // --- 演出 ---
  HITSTOP_PERFECT_MS: 110,
  HITSTOP_GOOD_MS: 50,
  SLOWMO_SCALE: 0.25,
  SLOWMO_MS: 140,
  SHAKE_MISS: 14,
  DPR_CAP: 3,

  // --- ランクしきい値（総スコア）---
  RANKS: [
    { rank: 'S', min: 18000 },
    { rank: 'A', min: 10000 },
    { rank: 'B', min: 5000 },
    { rank: 'C', min: 0 },
  ],

  // 攻撃は上半分から来る5方向（下部はボタン専用エリア）
  DIRECTIONS: ['L', 'R', 'U', 'UL', 'UR'],

  // --- ウォームアップ（開始時の案内＋低速ノーダメージ準備）---
  WARMUP: { count: 5, visibleMs: 1200, intervalMs: 1150 },

  // --- 分割バー（マルチタップ）の各分割の到達間隔 ---
  SEGMENT_GAP: { ratio: 0.30, min: 155, max: 260 },

  // --- 最大ティア ---
  MAX_TIER: 20,

  INTERVAL_JITTER: 0.12, // 攻撃間隔の基本ゆらぎ（速度ジッタとは別）

  // TIERS は下で生成（20段階）
  TIERS: [],
};

// 攻撃方向 → 受け流しに必要な入力（反対側）
export const OPPOSITE = { L: 'R', R: 'L', U: 'D', UL: 'DR', UR: 'DL' };

// 受け流し方向（=ボタン）の角度（screen座標: 0=右, +y=下）
export const NEED_ANGLE = {
  R: 0,
  DR: Math.PI / 4,
  D: Math.PI / 2,
  DL: (3 * Math.PI) / 4,
  L: Math.PI,
};

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 20段階のティアを生成する。
 * 前半(〜ティア10): 速度を詰めつつ「速度ランダム性(speedJitter)」を 0→最大 へ。
 * 後半(ティア11〜): 速度ランダム性は出揃い、必要タップ数を 1→最大3 へ段階的に。
 * tapWeights: [p(1回), p(2回), p(3回)] の確率分布。
 */
function buildTiers() {
  const out = [];
  for (let n = 0; n < CONFIG.MAX_TIER; n++) {
    const speedT = smooth(clamp(n / 9, 0, 1));      // ティア10で速度は床に到達
    const visibleMs = Math.round(lerp(980, 440, speedT));
    const intervalMs = Math.round(lerp(1080, 540, speedT));
    const speedJitter = +clamp((n / 9) * 0.35, 0, 0.35).toFixed(3); // ±割合。ティア10で最大0.35

    // マルチタップの確率（ティア11〜で2回、ティア16〜で3回が混ざる）
    const p2 = clamp((n - 9) * 0.07, 0, 0.5);
    const p3 = clamp((n - 14) * 0.06, 0, 0.3);
    const p1 = Math.max(0, 1 - p2 - p3);
    const maxTaps = p3 > 0 ? 3 : p2 > 0 ? 2 : 1;

    out.push({
      successAt: Math.round(5 * n + 0.5 * n * n),
      visibleMs,
      intervalMs,
      speedJitter,
      tapWeights: [p1, p2, p3],
      maxTaps,
    });
  }
  return out;
}

CONFIG.TIERS = buildTiers();

export function tierForSuccess(successCount) {
  const tiers = CONFIG.TIERS;
  let current = tiers[0];
  for (const t of tiers) {
    if (successCount >= t.successAt) current = t;
    else break;
  }
  return current;
}

export function rankForScore(score) {
  for (const r of CONFIG.RANKS) {
    if (score >= r.min) return r.rank;
  }
  return 'C';
}
