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

  // 入力の固定順。時刻が一致したときの採用結果を端末や描画頻度から独立させる。
  INPUT_DIRECTIONS: ['L', 'DL', 'D', 'DR', 'R'],

  // 配送保証より短い間隔を作らない。実際の各ティア間隔はこれより十分長いが、
  // 注入設定や将来の調整でも 50ms 以下へ落ちないようにする。
  MIN_INTERVAL_MS: 51,

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

// R4で固定する成功数の境界。段階は成功数がこの値に達した時点で上がる。
export const DIFFICULTY_SUCCESS_BOUNDARIES = Object.freeze(
  [0, 3, 6, 9, 12, 16, 20, 24, 28, 32, 36, 41, 46, 51, 56, 62, 68, 74, 81, 88],
);

/**
 * 20段階のティアを生成する。
 * 前半(〜ティア10): 速度を詰めつつ「速度ランダム性(speedJitter)」を 0→最大 へ。
 * 段階7（成功20）から2連、段階13（成功46）から3連を抽選する。
 * tapWeights: [p(1回), p(2回), p(3回)] の確率分布。
 */
function buildTiers() {
  const out = [];
  for (let n = 0; n < DIFFICULTY_SUCCESS_BOUNDARIES.length; n++) {
    const speedT = smooth(clamp(n / 9, 0, 1));      // ティア10で速度は床に到達
    const visibleMs = Math.round(lerp(980, 440, speedT));
    const intervalMs = Math.round(lerp(1080, 540, speedT));
    const speedJitter = +clamp((n / 9) * 0.35, 0, 0.35).toFixed(3); // ±割合。ティア10で最大0.35

    // 速度を詰めた後に分割攻撃を増やし、突然すべてが3連にならないようにする。
    const p2 = n < 6 ? 0 : clamp(0.08 + (n - 6) * 0.04, 0, 0.5);
    const p3 = n < 12 ? 0 : clamp(0.06 + (n - 12) * 0.04, 0, 0.3);
    const p1 = Math.max(0, 1 - p2 - p3);
    const maxTaps = p3 > 0 ? 3 : p2 > 0 ? 2 : 1;

    out.push({
      successAt: DIFFICULTY_SUCCESS_BOUNDARIES[n],
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
