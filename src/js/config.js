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
    { rank: 'S', min: 12000 },
    { rank: 'A', min: 7000 },
    { rank: 'B', min: 3500 },
    { rank: 'C', min: 0 },
  ],

  // 攻撃は上半分から来る5方向（下部はボタン専用エリア）
  // L=左, R=右, U=上, UL=左斜め上, UR=右斜め上
  DIRECTIONS: ['L', 'R', 'U', 'UL', 'UR'],

  // --- ウォームアップ（開始時の案内＋低速ノーダメージ準備）---
  WARMUP: { count: 5, visibleMs: 1200, intervalMs: 1150 },

  // --- 難易度ティア（方向は常に5方向。速度・密度のみで難化）---
  TIERS: [
    { successAt: 0,  visibleMs: 980, intervalMs: 1080 },
    { successAt: 8,  visibleMs: 850, intervalMs: 950 },
    { successAt: 20, visibleMs: 720, intervalMs: 820 },
    { successAt: 34, visibleMs: 620, intervalMs: 720 },
    { successAt: 50, visibleMs: 540, intervalMs: 640 },
    { successAt: 70, visibleMs: 470, intervalMs: 560 },
  ],

  INTERVAL_JITTER: 0.18,
};

// 攻撃方向 → 受け流しに必要な入力（反対側）
// 上半分の攻撃 ↔ 下半分のボタン が対応する
export const OPPOSITE = { L: 'R', R: 'L', U: 'D', UL: 'DR', UR: 'DL' };

// 受け流し方向（=ボタン）の角度（screen座標: 0=右, +y=下）
export const NEED_ANGLE = {
  R: 0,
  DR: Math.PI / 4,
  D: Math.PI / 2,
  DL: (3 * Math.PI) / 4,
  L: Math.PI,
};

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
