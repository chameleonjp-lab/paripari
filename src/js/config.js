// パリパリ チューニング定数（要件 §2.4 §3 §5）
// すべてのバランス調整はこのファイルで完結する。

export const CONFIG = {
  // --- 判定窓 (ms) ---
  PERFECT_WINDOW: 60,   // |Δ| <= これ → PERFECT
  GOOD_WINDOW: 140,     // |Δ| <= これ → GOOD（超過は MISS）

  // --- スコア ---
  BASE_PERFECT: 300,
  BASE_GOOD: 100,
  COMBO_STEP: 5,        // この連数ごとに倍率+COMBO_STEP_BONUS
  COMBO_STEP_BONUS: 0.5,
  COMBO_MAX_MULT: 4.0,
  TIMING_BONUS_MAX: 50,

  // --- ライフ ---
  MAX_HP: 3,
  HEAL_EVERY_PERFECT_STREAK: 10, // PERFECT連続でハート回復

  // --- 演出 ---
  HITSTOP_PERFECT_MS: 110,
  HITSTOP_GOOD_MS: 50,
  SLOWMO_SCALE: 0.25,        // PERFECT時のdtスケール
  SLOWMO_MS: 140,
  SHAKE_MISS: 14,            // px
  DPR_CAP: 3,

  // --- ランクしきい値（総スコア）---
  RANKS: [
    { rank: 'S', min: 12000 },
    { rank: 'A', min: 7000 },
    { rank: 'B', min: 3500 },
    { rank: 'C', min: 0 },
  ],

  // --- 難易度ティア（要件 §5.3）---
  // visibleMs: 予兆+接近の合計可視時間 / intervalMs: 次攻撃までの基準間隔
  // directions: 出現方向 / feint: フェイント確率 / doubleRate: 2連確率
  TIERS: [
    { successAt: 0,  visibleMs: 1000, intervalMs: 1100, directions: ['L', 'R'], feint: 0,    doubleRate: 0 },
    { successAt: 8,  visibleMs: 850,  intervalMs: 950,  directions: ['L', 'R'], feint: 0,    doubleRate: 0 },
    { successAt: 20, visibleMs: 700,  intervalMs: 800,  directions: ['L', 'R'], feint: 0,    doubleRate: 0.2 },
    { successAt: 36, visibleMs: 600,  intervalMs: 720,  directions: ['L', 'R', 'U', 'D'], feint: 0, doubleRate: 0.25 },
    { successAt: 56, visibleMs: 520,  intervalMs: 640,  directions: ['L', 'R', 'U', 'D'], feint: 0.12, doubleRate: 0.3 },
    { successAt: 80, visibleMs: 450,  intervalMs: 560,  directions: ['L', 'R', 'U', 'D'], feint: 0.2,  doubleRate: 0.35 },
  ],

  INTERVAL_JITTER: 0.18, // ±18% 間隔ゆらぎ
};

// 攻撃方向 → 受け流しに必要な入力方向（反対側）
export const OPPOSITE = { L: 'R', R: 'L', U: 'D', D: 'U' };

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
