// スコア/コンボ計算（純粋関数・テスト対象） 要件 §3
import { CONFIG } from './config.js';

export function comboMultiplier(combo, cfg = CONFIG) {
  const mult = 1 + Math.floor(combo / cfg.COMBO_STEP) * cfg.COMBO_STEP_BONUS;
  return Math.min(mult, cfg.COMBO_MAX_MULT);
}

export function timingBonus(deltaMs, cfg = CONFIG) {
  const ratio = 1 - Math.abs(deltaMs) / cfg.GOOD_WINDOW;
  const bonus = Math.round(ratio * cfg.TIMING_BONUS_MAX);
  return Math.max(0, Math.min(cfg.TIMING_BONUS_MAX, bonus));
}

/**
 * 1攻撃あたりの獲得点。
 * @param {'PERFECT'|'GOOD'|'MISS'} judge
 * @param {number} combo  この成功時点のコンボ（加点前/この成功を含む値を渡す側で統一）
 * @param {number} deltaMs
 */
export function calcGain(judge, combo, deltaMs, cfg = CONFIG) {
  const base = judge === 'PERFECT' ? cfg.BASE_PERFECT : judge === 'GOOD' ? cfg.BASE_GOOD : 0;
  if (base === 0) return 0;
  return Math.round(base * comboMultiplier(combo, cfg) + timingBonus(deltaMs, cfg));
}
