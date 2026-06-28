// 3段階判定（純粋関数・テスト対象） 要件 §2.4
import { CONFIG } from './config.js';

/**
 * @param {number} deltaMs  入力時刻 - インパクト時刻T（負=早い, 正=遅い）
 * @param {boolean} dirOk    入力方向が正しい（攻撃の反対側）か
 * @param {object} cfg       判定窓を持つ設定（既定 CONFIG）
 * @returns {'PERFECT'|'GOOD'|'MISS'}
 */
export function judgeTiming(deltaMs, dirOk, cfg = CONFIG) {
  if (!dirOk) return 'MISS';
  const a = Math.abs(deltaMs);
  if (a <= cfg.PERFECT_WINDOW) return 'PERFECT';
  if (a <= cfg.GOOD_WINDOW) return 'GOOD';
  return 'MISS';
}
